/*!
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 */
// Avatarと同じinput_file/output_file形式。Node/renderer双方で境界を検証する。
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_COUNT = 10;
export const MAX_FILE_PACKET_CHARS = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4096;
export const MAX_THUMBNAIL_BYTES = 1024 * 1024;
export type FileUpload = { name: string; base64: string };
export type ChatAttachment = {
  key: string; kind: 'input_file' | 'output_file'; name: string; path: string;
  thumbnail: string; session: string; channel: string; revision?: string;
};
const plainName = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
  && value.length <= 255 && !/[\\/:\x00-\x1f\x7f]/.test(value) && value !== '.' && value !== '..';
function base64Bytes(value: unknown, max: number): number {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(max / 3) * 4
      || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return -1;
  const size = value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  return size > 0 && size <= max ? size : -1;
}
export function validateFileUpload(value: unknown): FileUpload {
  const file = value as Partial<FileUpload> | null;
  if (!file || !plainName(file.name)) throw new Error('ファイル名が不正です。');
  if (base64Bytes(file.base64, MAX_FILE_BYTES) < 0) throw new Error('空のファイル・不正なデータ・4 MiBを超えるファイルは送信できません。');
  return { name: file.name, base64: file.base64! };
}
// CoreのサムネイルはPNG。URLやSVGを画像として評価せず、寸法も確認して展開量を制限する。
export function safeThumbnail(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.startsWith('data:image/png;base64,') ? value.slice(22) : value;
  if (base64Bytes(raw, MAX_THUMBNAIL_BYTES) < 0) return '';
  try {
    const bytes = atob(raw.slice(0, 44));
    if (bytes.length < 33 || bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || bytes.slice(12, 16) !== 'IHDR') return '';
    const uint = (offset: number) => Array.from(bytes.slice(offset, offset + 4)).reduce((n, c) => n * 256 + c.charCodeAt(0), 0);
    const width = uint(16), height = uint(20);
    if (uint(8) !== 13 || !width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) return '';
    return 'data:image/png;base64,' + raw;
  } catch { return ''; }
}
export function fileAttachment(value: unknown, expectedSession: string, expectedChannel: string): ChatAttachment | undefined {
  const packet = value as Record<string, unknown> | null;
  if (!packet || !expectedSession || packet.セッションID !== expectedSession
      || packet.チャンネル !== undefined && String(packet.チャンネル) !== expectedChannel
      || packet.メッセージ識別 !== 'input_file' && packet.メッセージ識別 !== 'output_file') return;
  const path = packet.ファイル名;
  // 表示専用。pathからfetch・file URL・OS操作は生成しない。リンク/制御文字/遡りは受け付けない。
  if (typeof path !== 'string' || !path || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)
      || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path) && !/^[a-z]:[\\/]/i.test(path)
      || path.replace(/\\/g, '/').split('/').includes('..')) return;
  const leaf = path.replace(/\\/g, '/').split('/').pop() || '';
  if (!leaf || leaf === '.') return;
  const original = packet.元ファイル名;
  const content = typeof packet.メッセージ内容 === 'string' ? packet.メッセージ内容 : '';
  const fromText = /^(?:ファイル受信|ファイル入力|ファイル出力):\s*(.+)$/.exec(content)?.[1];
  const name = plainName(original) ? original : plainName(fromText) ? fromText : leaf;
  const kind = packet.メッセージ識別;
  const revision = kind === 'output_file' && typeof packet.ファイル版 === 'string' && /^[a-f0-9]{64}$/.test(packet.ファイル版) ? packet.ファイル版 : '';
  return { key: JSON.stringify([expectedSession, expectedChannel, kind, path, ...(revision ? [revision] : [])]), kind, name, path,
    thumbnail: safeThumbnail(packet.サムネイル画像), session: expectedSession, channel: expectedChannel, ...(revision ? { revision } : {}) };
}


export function isDuplicateAttachment(previous: ChatAttachment | undefined, next: ChatAttachment): boolean {
  if (!previous) return false;
  if (previous.key === next.key) return next.kind !== 'output_file' || !!next.revision || previous.thumbnail === next.thumbnail;
  // Coreの既存DB履歴は版fieldを持たない。同じPNGの再接続replayだけを除き、更新版は残す。
  return next.kind === 'output_file' && !next.revision && !!previous.revision && previous.kind === next.kind
    && previous.session === next.session && previous.channel === next.channel && previous.path === next.path
    && !!next.thumbnail && previous.thumbnail === next.thumbnail;
}
