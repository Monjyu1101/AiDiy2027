// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 公式の緊急修正版を系列ごとに比較する。診断中の外部通信は不要。
export const SECURITY_RELEASES = {
  python: {
    name: 'Python', date: '2026-10-25',
    fixed: ['3.14.10', '3.15.2'],
    source: 'https://blog.python.org/2026/10/python-3152-31410-31318-31216-31118/',
  },
  node: {
    name: 'Node.js', date: '2026-10-21',
    fixed: ['24.22.1', '26.12.1'],
    source: 'https://nodejs.org/en/blog/vulnerability/october-2026-security-releases',
  },
};

export function securityVersionWarning(id, version) {
  const policy = SECURITY_RELEASES[id];
  if (!policy) return null;
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version || '');
  const guidance = `確認基準: ${policy.date} の緊急修正版。対応版: ${policy.fixed.join(' / ')} 以降（各系列）。公式情報: ${policy.source}`;
  if (!match) return `セキュリティパッチ対応を確認できません。バージョン番号を確認してください。${guidance}`;
  const found = match.slice(1, 4).map(Number);
  const sameLine = value => id === 'python' ? value[0] === found[0] && value[1] === found[1] : value[0] === found[0];
  const required = policy.fixed.map(value => value.split('.').map(Number)).find(sameLine);
  if (!required) {
    const latest = policy.fixed.at(-1).split('.').map(Number);
    const older = found[0] < latest[0] || (found[0] === latest[0] && (id === 'node' || found[1] < latest[1]));
    return older
      ? `バージョンが古い！ この旧系列はセキュリティパッチ対応の判定対象外です。対応系列へ更新してください。${guidance}`
      : null; // 基準より未来の系列は、利用者指定の方針で対応済みとして扱う。
  }
  const difference = found.map((value, index) => value - required[index]).find(value => value !== 0) || 0;
  if (difference < 0 || (difference === 0 && match[4] && !match[4].startsWith('+'))) {
    return `バージョンが古い！ セキュリティパッチ未対応です。${policy.name} ${required.join('.')} 以降へ更新してください。${guidance}`;
  }
  if (match[4] && !match[4].startsWith('+')) return `開発版のためセキュリティパッチ対応は未確認です。${guidance}`;
  return null;
}

export function applySecurityVersionWarning(result) {
  if (!['OK', '注意'].includes(result.状態)) return result;
  const warning = securityVersionWarning(result.id, result.バージョン);
  return warning ? { ...result, 状態: '注意', 説明: `${warning} ${result.説明}` } : result;
}
