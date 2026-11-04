// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue部品の論理名と機能別ソースの対応（テスト専用）。
export const componentPaths = {
  "RefreshButton": "components/共通表示/再読込ボタン.vue",
  "CodePanel": "components/コード/コードパネル.vue",
  "LivePanel": "components/ライブ/ライブパネル.vue",
  "ConsolePanel": "components/ターミナル/ターミナルパネル.vue",
  "TerminalProgress": "components/ターミナル/進捗表示.vue",
  "TerminalWelcome": "components/ターミナル/開始表示.vue",
  "SpaceView": "components/開発スペース/開発スペース.vue",
  "SpaceCanvas": "components/開発スペース/宇宙キャンバス.vue",
  "FileExplorer": "components/ファイル閲覧/ファイル一覧.vue",
  "ExplorerActionView": "components/ファイル閲覧/エクスプローラー操作表示.vue",
  "FileTypeIcon": "components/ファイル閲覧/ファイル種別アイコン.vue",
  "ViewerWindow": "components/ファイル閲覧/閲覧ウィンドウ.vue",
  "BrowserPanel": "components/ブラウザ/ブラウザパネル.vue",
  "FolderPages": "components/ファイル閲覧/フォルダページ.vue",
  "FileViewer": "components/ファイル閲覧/ファイルビューア.vue",
  "ViewerSession": "components/ファイル閲覧/閲覧セッション.vue",
  "AISearchPanel": "components/ファイル検索/AI検索パネル.vue",
  "FileAnalysisDialog": "dialog/ファイル解析ダイアログ.vue",
  "FileHistoryDialog": "dialog/ファイル履歴ダイアログ.vue",
  "DraftHandoffDialog": "dialog/下書き連携ダイアログ.vue",
  "StatusBar": "components/共通表示/状態バー.vue",
  "ModalDialog": "dialog/共通ダイアログ.vue"
};
export function componentName(path, owner) {
  const target = new URL(path, new URL(componentPaths[owner], 'file:///renderer/')).pathname;
  return Object.keys(componentPaths).find(name => new URL(componentPaths[name], 'file:///renderer/').pathname === target);
}
