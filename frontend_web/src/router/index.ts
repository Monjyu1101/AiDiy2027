// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import ログイン from '../components/ログイン.vue'
import { coreRoutes } from './coreRouter'
import { appsRoutes } from './appsRouter'

const buildStaticRedirectUrl = (targetPath: string): string => {
    const baseUrl = import.meta.env.BASE_URL || '/'
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    return new URL(targetPath.replace(/^\/+/, ''), new URL(normalizedBaseUrl, window.location.origin)).toString()
}

const createStaticAliasRoute = (
    aliasPath: string,
    targetPath: string,
    title: string,
): RouteRecordRaw => ({
    path: aliasPath,
    component: { render: () => null },
    beforeEnter: () => {
        window.location.replace(buildStaticRedirectUrl(targetPath))
        return false
    },
    meta: { title },
})

// ベースルート (認証, リンク, X系)
const baseRoutes: RouteRecordRaw[] = [
    {
        path: '/ログイン',
        name: 'login',
        component: ログイン,
        meta: { title: 'ログイン' }
    },
    {
        path: '/ログアウト',
        name: 'logout',
        component: () => import('../components/ログアウト.vue'),
        meta: { requiresAuth: true, title: 'ログアウト' }
    },
    {
        path: '/リンク',
        name: 'リンク',
        component: () => import('../components/リンク.vue'),
        meta: { requiresAuth: true, title: 'リンク' }
    },
    {
        path: '/メニュー',
        name: 'メニュー',
        component: () => import('../components/メニュー.vue'),
        meta: { requiresAuth: true, title: 'メニュー' }
    },
    {
        path: '/Xその他',
        name: 'その他',
        component: () => import('../components/Xその他.vue'),
        meta: { requiresAuth: true, title: 'その他' }
    },
    {
        path: '/Xビデオ',
        name: 'Xビデオ',
        component: () => import('../components/Xビデオ.vue'),
        meta: { requiresAuth: true, title: 'Xビデオ' }
    },
    {
        path: '/Xその他/Xテトリス/ゲーム',
        name: 'Xテトリス',
        component: () => import('../components/Xその他/Xテトリス.vue'),
        meta: { requiresAuth: true, title: 'Xテトリス' }
    },
    {
        path: '/Xその他/Xインベーダー/ゲーム',
        name: 'Xインベーダー',
        component: () => import('../components/Xその他/Xインベーダー.vue'),
        meta: { requiresAuth: true, title: 'Xインベーダー' }
    },
    {
        path: '/Xその他/Xリバーシ/ゲーム',
        name: 'Xリバーシ',
        component: () => import('../components/Xその他/Xリバーシ.vue'),
        meta: { requiresAuth: true, title: 'Xリバーシ' }
    },
    {
        path: '/Xその他/X立体リバーシ/ゲーム',
        name: 'X立体リバーシ',
        component: () => import('../components/Xその他/X立体リバーシ.vue'),
        meta: { requiresAuth: true, title: 'X立体リバーシ' }
    },
    {
        path: '/Xその他/Xドッグファイト/ゲーム',
        name: 'Xドッグファイト',
        component: () => import('../components/Xその他/Xドッグファイト.vue'),
        meta: { requiresAuth: true, title: 'Xドッグファイト' }
    },
    {
        path: '/Xその他/X世界の絶景/表示',
        name: 'X世界の絶景',
        component: () => import('../components/Xその他/X世界の絶景.vue'),
        meta: { requiresAuth: true, title: 'X世界の絶景' }
    },
    {
        path: '/Xその他/X太陽系/表示',
        name: 'X太陽系',
        component: () => import('../components/Xその他/X太陽系.vue'),
        meta: { requiresAuth: true, title: 'X太陽系' }
    },
    {
        path: '/Xその他/X動画再生BGM/再生',
        name: 'X動画再生BGM',
        component: () => import('../components/Xその他/X動画再生BGM.vue'),
        meta: { requiresAuth: true, title: 'X動画再生BGM' }
    },
    {
        path: '/Xその他/X自己紹介/表示',
        name: 'X自己紹介',
        component: () => import('../components/Xその他/X自己紹介.vue'),
        meta: { requiresAuth: true, title: 'X自己紹介' }
    },
    createStaticAliasRoute(
        '/Xその他/Xアバター訓練中/表示',
        'Xアバター訓練中/index.html',
        'Xアバター訓練中'
    ),
    createStaticAliasRoute(
        '/X自己紹介/aidiy紹介ビデオtake4/index.html',
        'X自己紹介/AiDiy紹介ビデオtake4/index.html',
        'X自己紹介'
    ),
    createStaticAliasRoute(
        '/X自己紹介/AiDiy自己紹介ビデオtake4/index.html',
        'X自己紹介/AiDiy紹介ビデオtake4/index.html',
        'X自己紹介'
    ),
    createStaticAliasRoute(
        '/X自己紹介/aidiy紹介アバター/index.html',
        'X自己紹介/AiDiy紹介アバター/index.html',
        'X自己紹介'
    ),
    createStaticAliasRoute(
        '/X自己紹介/aidiy紹介hermes/index.html',
        'X自己紹介/AiDiy紹介hermes/index.html',
        'X自己紹介'
    ),
    // Xビデオ: 現在公開しているコンテンツ
    createStaticAliasRoute(
        '/Xビデオ/AiDiy紹介__all_ja',
        'Xビデオ/AiDiy紹介__all_ja/index.html',
        'Xビデオ'
    ),
    createStaticAliasRoute(
        '/Xビデオ/AiDiy解説__all_ja',
        'Xビデオ/AiDiy解説__all_ja/index.html',
        'Xビデオ'
    ),
    createStaticAliasRoute(
        '/Xビデオ/ニュース_20260906_fable51_ja',
        'Xビデオ/ニュース_20260906_fable51_ja/index.html',
        'Xビデオ'
    ),
    createStaticAliasRoute(
        '/Xビデオ/ニュース_20260906_gemini38flash_ja',
        'Xビデオ/ニュース_20260906_gemini38flash_ja/index.html',
        'Xビデオ'
    ),
    createStaticAliasRoute(
        '/Xビデオ/ニュース_20260906_gpt6astra_ja',
        'Xビデオ/ニュース_20260906_gpt6astra_ja/index.html',
        'Xビデオ'
    ),
    createStaticAliasRoute(
        '/Xビデオ/小説解説_本好きの下剋上_ja',
        'Xビデオ/小説解説_本好きの下剋上_ja/index.html',
        'Xビデオ'
    ),
    createStaticAliasRoute(
        '/Xビデオ/小説解説_AiDiy誕生_ja',
        'Xビデオ/小説解説_AiDiy誕生_ja/index.html',
        'Xビデオ'
    ),
    createStaticAliasRoute(
        '/Xビデオ/四コマ漫画_伝説のプログラマ_ja',
        'Xビデオ/四コマ漫画_伝説のプログラマ_ja/index.html',
        'Xビデオ'
    ),
]

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        ...baseRoutes,
        ...coreRoutes,
        ...appsRoutes,
    ]
})

router.beforeEach(async (to, _from, next) => {
    // 日本語URLのリロード対応: エンコードされたパスが来た場合、デコードしてリダイレクト
    try {
        const decodedPath = decodeURIComponent(to.path)
        if (decodedPath !== to.path) {
            next({ path: decodedPath, query: to.query, hash: to.hash })
            return
        }
    } catch (e) {
        console.error('URL Decode Error:', e)
    }

    const authStore = useAuthStore()
    if (to.meta.requiresAuth) {
        if (!authStore.token) {
            next('/ログイン')
            return
        }
        if (authStore.user) {
            // キャッシュ済み利用者がいれば遷移をブロックせず、認証確認は裏で行う
            // （backend 起動途中の応答待ちで画面遷移が止まるのを防ぐ。無効トークンは 401 でログアウトされる）
            void authStore.ensureAuth()
        } else {
            await authStore.ensureAuth()
            if (!authStore.user) {
                next('/ログイン')
                return
            }
        }
    }
    next()
})

const BASE_TITLE = 'AiDiy'
router.afterEach((to) => {
    const pageTitle = to.meta?.title || (typeof to.name === 'string' ? to.name : '')
    document.title = pageTitle ? `${BASE_TITLE} - ${pageTitle}` : BASE_TITLE
})

export default router
