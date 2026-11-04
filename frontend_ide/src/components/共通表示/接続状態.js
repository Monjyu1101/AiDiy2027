// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 不完全な利用中応答を新セッションと解釈し、作業を破棄しない。
export function validConnectionState(value) {
  return !!value && !Array.isArray(value) && typeof value.active === 'boolean'
    && (!value.active || ['online','offline'].includes(value.mode)
      && Number.isFinite(value.startedAt) && value.startedAt > 0
      && typeof value.project?.path === 'string' && value.project.path.length > 0
      && value.project.path.length <= 4096 && !value.project.path.includes('\0'));
}
