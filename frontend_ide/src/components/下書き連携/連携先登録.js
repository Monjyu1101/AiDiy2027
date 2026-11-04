// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// Webパネルは表示名ではなく、実際のマウントごとに異なるIDで指定する。
export function createDraftTargetRegistry() {
  const ids = new WeakMap(); let sequence = 0;
  function targets(panels, projectPath) {
    return panels.flatMap(panel => {
      const info = panel?.draftTarget?.();
      if (!info || info.projectPath !== projectPath || !['code', 'live'].includes(info.kind)) return [];
      if (!ids.has(panel)) ids.set(panel, `web-draft-${++sequence}`);
      return [{ ...info, id: ids.get(panel) }];
    });
  }
  function insert(panels, current, request) {
    if (!current.sessionKey || request.sessionKey !== current.sessionKey || request.projectPath !== current.projectPath) return { ok: false, error: 'IDEの利用状態が変わりました。連携先を選び直してください。' };
    const panel = panels.find(item => ids.get(item) === request.targetId);
    const target = panel?.draftTarget?.();
    if (!target || target.contextId !== request.contextId || target.projectPath !== request.projectPath) return { ok: false, error: '連携先が閉じられたか会話が変わりました。連携先を選び直してください。' };
    return panel.insertDraft(request);
  }
  function snapshot(panels, projectPath, frontmostKind) {
    const current = targets(panels, projectPath);
    return { targets: current, frontmostTargetId: current.find(item => item.kind === frontmostKind)?.id || '' };
  }
  return { targets, insert, snapshot };
}
