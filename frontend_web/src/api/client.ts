// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import axios from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../stores/auth'

const apiClient = axios.create({
    baseURL: '/',
    headers: {
        'Content-Type': 'application/json',
    },
})

let 操作系認証更新Promise: Promise<void> | null = null

function APIパス取得(url: string | undefined): string {
    if (!url) return ''
    try {
        return new URL(url, window.location.origin).pathname
    } catch {
        return url.split('?')[0] || ''
    }
}

function CMT操作系認証延長対象(config: InternalAxiosRequestConfig): boolean {
    if ((config.method || 'get').toLowerCase() !== 'post') return false

    const path = APIパス取得(config.url)
    return (
        path.startsWith('/core/C')
        || path.startsWith('/core/V')
        || path.startsWith('/apps/M')
        || path.startsWith('/apps/T')
        || path.startsWith('/apps/V')
    )
}

async function 操作系認証トークン更新(authStore: ReturnType<typeof useAuthStore>): Promise<void> {
    if (!authStore.token) return
    if (!操作系認証更新Promise) {
        操作系認証更新Promise = authStore.refreshToken()
            .finally(() => {
                操作系認証更新Promise = null
            })
    }
    await 操作系認証更新Promise
}

// リクエストインターセプター: トークン付与
apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const authStore = useAuthStore()
    if (CMT操作系認証延長対象(config)) {
        await 操作系認証トークン更新(authStore)
    }
    if (authStore.token) {
        config.headers.Authorization = `Bearer ${authStore.token}`
    }
    return config
})

// レスポンスインターセプター: エラーハンドリング
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            const authStore = useAuthStore()
            authStore.logout()
        }
        return Promise.reject(error)
    }
)

export default apiClient

