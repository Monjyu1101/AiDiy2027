// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.

export const 添付上限 = 5 * 1024 * 1024;
export const 添付合計上限 = 15 * 1024 * 1024;

export function 添付サイズ(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - padding;
}

export function 添付を読む(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reader.onabort = () => reject(new Error('添付ファイルを読み込めませんでした。'));
    reader.onload = () => {
      const value = String(reader.result ?? '');
      const comma = value.indexOf(',');
      if (comma < 0 || !value.slice(0, comma).endsWith(';base64')) {
        reject(new Error('添付ファイルを変換できませんでした。'));
        return;
      }
      resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function 画像形式(base64: string): string {
  let head: string;
  try {
    head = atob(base64.slice(0, 16));
  } catch {
    return '';
  }
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (head.startsWith('\xff\xd8\xff')) return 'image/jpeg';
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  return ''; // SVG、HTMLなどの能動コンテンツは画面で表示しない。
}

export function 添付Blob(base64: string, type = 'application/octet-stream'): Blob {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < base64.length; i += 32768) {
    parts.push(Uint8Array.from(atob(base64.slice(i, i + 32768)), c => c.charCodeAt(0)));
  }
  return new Blob(parts, { type });
}
