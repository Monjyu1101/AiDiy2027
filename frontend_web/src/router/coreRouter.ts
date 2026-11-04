// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// コア系ルーター (C系: C管理, C権限, C利用者, C採番 / A系: AIコア)

import type { RouteRecordRaw } from 'vue-router'
import AIコア画面 from '../components/AiDiy/AiDiy.vue'

export const coreRoutes: RouteRecordRaw[] = [
    {
        path: '/',
        name: 'dashboard',
        component: () => import('../components/C管理.vue'),
        meta: { requiresAuth: true, title: '管理' }
    },
    {
        path: '/C管理',
        name: '管理',
        component: () => import('../components/C管理.vue'),
        meta: { requiresAuth: true, title: '管理' }
    },
    {
        path: '/C管理/C権限/一覧',
        name: 'C権限一覧',
        component: () => import('../components/C管理/C権限/C権限一覧.vue'),
        meta: { requiresAuth: true, title: 'C権限一覧' }
    },
    {
        path: '/C管理/C権限/編集',
        name: 'C権限編集',
        component: () => import('../components/C管理/C権限/C権限編集.vue'),
        meta: { requiresAuth: true, title: 'C権限編集' }
    },
    {
        path: '/C管理/C利用者/一覧',
        name: 'C利用者一覧',
        component: () => import('../components/C管理/C利用者/C利用者一覧.vue'),
        meta: { requiresAuth: true, title: 'C利用者一覧' }
    },
    {
        path: '/C管理/C利用者/編集',
        name: 'C利用者編集',
        component: () => import('../components/C管理/C利用者/C利用者編集.vue'),
        meta: { requiresAuth: true, title: 'C利用者編集' }
    },
    {
        path: '/C管理/C採番/一覧',
        name: 'C採番一覧',
        component: () => import('../components/C管理/C採番/C採番一覧.vue'),
        meta: { requiresAuth: true, title: 'C採番一覧' }
    },
    {
        path: '/C管理/C採番/編集',
        name: 'C採番編集',
        component: () => import('../components/C管理/C採番/C採番編集.vue'),
        meta: { requiresAuth: true, title: 'C採番編集' }
    },

    // ---- A系 (AiDiy) ----
    {
        path: '/AiDiy',
        name: 'AiDiy',
        component: AIコア画面,
        meta: { requiresAuth: true, title: 'AiDiy' }
    },
]
