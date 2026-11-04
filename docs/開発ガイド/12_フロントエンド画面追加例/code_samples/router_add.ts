// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// frontend_web/src/router/appsRouter.ts に追加するルート定義（M商品 実装例）

{
    path: '/Mマスタ/M商品/一覧',
    name: 'M商品一覧',
    component: () => import('../components/Mマスタ/M商品/M商品一覧.vue'),
    meta: { requiresAuth: true, title: 'M商品一覧' }
},
{
    path: '/Mマスタ/M商品/編集',
    name: 'M商品編集',
    component: () => import('../components/Mマスタ/M商品/M商品編集.vue'),
    meta: { requiresAuth: true, title: 'M商品編集' }
},

// ポイント:
// - M系は /Mマスタ/... 配下
// - 一覧/編集の2ルートを登録
// - meta.requiresAuth は true
// - title は画面名と揃える
// - M系ルートは appsRoutes 配列の「M系 (マスタ)」ブロックへ追加する
