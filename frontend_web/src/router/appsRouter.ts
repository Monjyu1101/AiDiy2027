// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// アプリ系ルーター (M系, T系, V系, S系)

import type { RouteRecordRaw } from 'vue-router'

export const appsRoutes: RouteRecordRaw[] = [

    // ---- M系 (マスタ) ----
    {
        path: '/Mマスタ',
        name: 'マスタ',
        component: () => import('../components/Mマスタ.vue'),
        meta: { requiresAuth: true, title: 'マスタ' }
    },
    {
        path: '/Mマスタ/M配車区分/一覧',
        name: 'M配車区分一覧',
        component: () => import('../components/Mマスタ/M配車区分/M配車区分一覧.vue'),
        meta: { requiresAuth: true, title: 'M配車区分一覧' }
    },
    {
        path: '/Mマスタ/M配車区分/編集',
        name: 'M配車区分編集',
        component: () => import('../components/Mマスタ/M配車区分/M配車区分編集.vue'),
        meta: { requiresAuth: true, title: 'M配車区分編集' }
    },
    {
        path: '/Mマスタ/M生産区分/一覧',
        name: 'M生産区分一覧',
        component: () => import('../components/Mマスタ/M生産区分/M生産区分一覧.vue'),
        meta: { requiresAuth: true, title: 'M生産区分一覧' }
    },
    {
        path: '/Mマスタ/M生産区分/編集',
        name: 'M生産区分編集',
        component: () => import('../components/Mマスタ/M生産区分/M生産区分編集.vue'),
        meta: { requiresAuth: true, title: 'M生産区分編集' }
    },
    {
        path: '/Mマスタ/M車両/一覧',
        name: 'M車両一覧',
        component: () => import('../components/Mマスタ/M車両/M車両一覧.vue'),
        meta: { requiresAuth: true, title: 'M車両一覧' }
    },
    {
        path: '/Mマスタ/M車両/編集',
        name: 'M車両編集',
        component: () => import('../components/Mマスタ/M車両/M車両編集.vue'),
        meta: { requiresAuth: true, title: 'M車両編集' }
    },
    {
        path: '/Mマスタ/M生産工程/一覧',
        name: 'M生産工程一覧',
        component: () => import('../components/Mマスタ/M生産工程/M生産工程一覧.vue'),
        meta: { requiresAuth: true, title: 'M生産工程一覧' }
    },
    {
        path: '/Mマスタ/M生産工程/編集',
        name: 'M生産工程編集',
        component: () => import('../components/Mマスタ/M生産工程/M生産工程編集.vue'),
        meta: { requiresAuth: true, title: 'M生産工程編集' }
    },
    {
        path: '/Mマスタ/M商品分類/一覧',
        name: 'M商品分類一覧',
        component: () => import('../components/Mマスタ/M商品分類/M商品分類一覧.vue'),
        meta: { requiresAuth: true, title: 'M商品分類一覧' }
    },
    {
        path: '/Mマスタ/M商品分類/編集',
        name: 'M商品分類編集',
        component: () => import('../components/Mマスタ/M商品分類/M商品分類編集.vue'),
        meta: { requiresAuth: true, title: 'M商品分類編集' }
    },
    {
        path: '/Mマスタ/M取引先分類/一覧',
        name: 'M取引先分類一覧',
        component: () => import('../components/Mマスタ/M取引先分類/M取引先分類一覧.vue'),
        meta: { requiresAuth: true, title: 'M取引先分類一覧' }
    },
    {
        path: '/Mマスタ/M取引先分類/編集',
        name: 'M取引先分類編集',
        component: () => import('../components/Mマスタ/M取引先分類/M取引先分類編集.vue'),
        meta: { requiresAuth: true, title: 'M取引先分類編集' }
    },
    {
        path: '/Mマスタ/M取引先/一覧',
        name: 'M取引先一覧',
        component: () => import('../components/Mマスタ/M取引先/M取引先一覧.vue'),
        meta: { requiresAuth: true, title: 'M取引先一覧' }
    },
    {
        path: '/Mマスタ/M取引先/編集',
        name: 'M取引先編集',
        component: () => import('../components/Mマスタ/M取引先/M取引先編集.vue'),
        meta: { requiresAuth: true, title: 'M取引先編集' }
    },
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
    {
        path: '/Mマスタ/M商品構成/一覧',
        name: 'M商品構成一覧',
        component: () => import('../components/Mマスタ/M商品構成/M商品構成一覧.vue'),
        meta: { requiresAuth: true, title: 'M商品構成一覧' }
    },
    {
        path: '/Mマスタ/M商品構成/編集',
        name: 'M商品構成編集',
        component: () => import('../components/Mマスタ/M商品構成/M商品構成編集.vue'),
        meta: { requiresAuth: true, title: 'M商品構成編集' }
    },
    // ---- T系 (トランザクション) ----
    {
        path: '/Tトラン',
        name: 'トラン',
        component: () => import('../components/Tトラン.vue'),
        meta: { requiresAuth: true, title: 'トラン' }
    },
    {
        path: '/Tトラン/T配車/一覧',
        name: 'T配車一覧',
        component: () => import('../components/Tトラン/T配車/T配車一覧.vue'),
        meta: { requiresAuth: true, title: 'T配車一覧' }
    },
    {
        path: '/Tトラン/T配車/編集',
        name: 'T配車編集',
        component: () => import('../components/Tトラン/T配車/T配車編集.vue'),
        meta: { requiresAuth: true, title: 'T配車編集' }
    },
    {
        path: '/Tトラン/T生産/一覧',
        name: 'T生産一覧',
        component: () => import('../components/Tトラン/T生産/T生産一覧.vue'),
        meta: { requiresAuth: true, title: 'T生産一覧' }
    },
    {
        path: '/Tトラン/T生産/編集',
        name: 'T生産編集',
        component: () => import('../components/Tトラン/T生産/T生産編集.vue'),
        meta: { requiresAuth: true, title: 'T生産編集' }
    },
    {
        path: '/Tトラン/T生産払出/一覧',
        name: 'T生産払出一覧',
        component: () => import('../components/Tトラン/T生産/T生産払出一覧.vue'),
        meta: { requiresAuth: true, title: 'T生産払出一覧' }
    },
    {
        path: '/Tトラン/T商品入庫/一覧',
        name: 'T商品入庫一覧',
        component: () => import('../components/Tトラン/T商品入庫/T商品入庫一覧.vue'),
        meta: { requiresAuth: true, title: 'T商品入庫一覧' }
    },
    {
        path: '/Tトラン/T商品入庫/編集',
        name: 'T商品入庫編集',
        component: () => import('../components/Tトラン/T商品入庫/T商品入庫編集.vue'),
        meta: { requiresAuth: true, title: 'T商品入庫編集' }
    },
    {
        path: '/Tトラン/T商品出庫/一覧',
        name: 'T商品出庫一覧',
        component: () => import('../components/Tトラン/T商品出庫/T商品出庫一覧.vue'),
        meta: { requiresAuth: true, title: 'T商品出庫一覧' }
    },
    {
        path: '/Tトラン/T商品出庫/編集',
        name: 'T商品出庫編集',
        component: () => import('../components/Tトラン/T商品出庫/T商品出庫編集.vue'),
        meta: { requiresAuth: true, title: 'T商品出庫編集' }
    },
    {
        path: '/Tトラン/T商品棚卸/一覧',
        name: 'T商品棚卸一覧',
        component: () => import('../components/Tトラン/T商品棚卸/T商品棚卸一覧.vue'),
        meta: { requiresAuth: true, title: 'T商品棚卸一覧' }
    },
    {
        path: '/Tトラン/T商品棚卸/編集',
        name: 'T商品棚卸編集',
        component: () => import('../components/Tトラン/T商品棚卸/T商品棚卸編集.vue'),
        meta: { requiresAuth: true, title: 'T商品棚卸編集' }
    },

    // ---- V系 (ビュー) ----
    {
        path: '/Vビュー',
        name: 'ビュー',
        component: () => import('../components/Vビュー.vue'),
        meta: { requiresAuth: true, title: 'ビュー' }
    },
    {
        path: '/Vビュー/V商品推移表',
        name: 'V商品推移表',
        component: () => import('../components/Vビュー/V商品推移表.vue'),
        meta: { requiresAuth: true, title: '商品推移表' }
    },

    // ---- S系 (スケジューラー) ----
    {
        path: '/Sスケジュール',
        name: 'スケジュール',
        component: () => import('../components/Sスケジュール.vue'),
        meta: { requiresAuth: true, title: 'スケジュール' }
    },
    {
        path: '/Sスケジュール/S配車_週表示',
        name: 'S配車週表示',
        component: () => import('../components/Sスケジューラー/S配車_週表示.vue'),
        meta: { requiresAuth: true, title: 'S配車_週表示' }
    },
    {
        path: '/Sスケジュール/S配車_日表示',
        name: 'S配車日表示',
        component: () => import('../components/Sスケジューラー/S配車_日表示.vue'),
        meta: { requiresAuth: true, title: 'S配車_日表示' }
    },
    {
        path: '/Sスケジュール/S生産_週表示',
        name: 'S生産週表示',
        component: () => import('../components/Sスケジューラー/S生産_週表示.vue'),
        meta: { requiresAuth: true, title: 'S生産_週表示' }
    },
    {
        path: '/Sスケジュール/S生産_日表示',
        name: 'S生産日表示',
        component: () => import('../components/Sスケジューラー/S生産_日表示.vue'),
        meta: { requiresAuth: true, title: 'S生産_日表示' }
    },
]
