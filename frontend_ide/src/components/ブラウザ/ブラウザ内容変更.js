// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// ウィンドウ寸法・接続状態・状態取得回数は内容の変更に含めない。
export function browserContentKey(page) {
  return JSON.stringify([page.session, page.activeTabId, page.url, page.title,
    page.navigationRevision, page.contentRevision,
    (page.tabs || []).map(tab => [tab.id, tab.url, tab.title])]);
}
