// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 通常の実行・自動航行がランダムに選ぶ待機画面。
export const NAVIGATION_RANDOM_SCENES = Object.freeze(['ナビ羽衣ライディング3D', 'ナビ花火3D', 'ナビアクアリウム3D', 'ナビ万華鏡2D', 'ナビ水面波紋3D', 'ナビ時計2D', 'ナビ迷路3D', 'ナビ依頼文3D']);
// メニューは描画方式で分類する。夜間飛行だけは手動選択専用。
export const NAVIGATION_SCENE_GROUPS = Object.freeze([
  Object.freeze({label:'2D',scenes:Object.freeze(['ナビ万華鏡2D','ナビ時計2D'])}),
  Object.freeze({label:'3D',scenes:Object.freeze(['ナビ羽衣ライディング3D','ナビ花火3D','ナビアクアリウム3D','ナビ水面波紋3D','ナビ迷路3D','ナビ依頼文3D','ナビ夜間飛行3D'])}),
]);
export const NAVIGATION_SCENES = Object.freeze(NAVIGATION_SCENE_GROUPS.flatMap(group=>group.scenes));
export const pickNavigationScene = (random = Math.random) => NAVIGATION_RANDOM_SCENES[Math.min(NAVIGATION_RANDOM_SCENES.length - 1, Math.max(0, Math.floor(random() * NAVIGATION_RANDOM_SCENES.length)))];
