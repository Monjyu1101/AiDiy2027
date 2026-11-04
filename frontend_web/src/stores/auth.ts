// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import { defineStore } from 'pinia'
import type { AuthState, LoginResult } from '../types'
import apiClient from '../api/client'
import router from '../router'

// 認証確認の多重発行防止（起動途中の応答待ちが重ならないようにする）
let 認証確認Promise: Promise<void> | null = null

export const useAuthStore = defineStore('auth', {
    state: (): AuthState => ({
        token: localStorage.getItem('token') || '',
        user: JSON.parse(localStorage.getItem('user') || 'null'),
        authChecked: false as boolean,
    }),
    getters: {
        isAuthenticated: (state): boolean => !!state.token,
        // CRITICAL: 権限IDは文字列型なので '1' と比較する（数値の 1 ではない）
        isAdmin: (state): boolean => state.user?.権限ID === '1', // ID '1' を管理者とする
    },
    actions: {
        async ensureAuth(): Promise<void> {
            if (!this.token) {
                this.user = null
                this.authChecked = true
                return
            }
            if (this.authChecked) return
            if (!認証確認Promise) {
                認証確認Promise = this.fetchUser().finally(() => {
                    認証確認Promise = null
                })
            }
            await 認証確認Promise
        },
        async login(username: string, password: string): Promise<LoginResult> {
            try {
                const response = await apiClient.post('/core/auth/ログイン', {
                    利用者ID: username,
                    パスワード: password
                })
                if (response.data.status === 'OK') {
                    this.token = response.data.data.access_token
                    localStorage.setItem('token', this.token)
                    this.authChecked = false
                    await this.fetchUser()
                    const 初期ページ = response.data.data.初期ページ
                    router.push(初期ページ ? `/${初期ページ}` : '/Xその他')
                    return { success: true }
                }
                return { success: false, message: response.data.message }
            } catch (e) {
                console.error(e)
                return { success: false, message: 'ログインエラーが発生しました' }
            }
        },
        async fetchUser(): Promise<void> {
            if (!this.token) {
                this.user = null
                this.authChecked = true
                return
            }
            try {
                const response = await apiClient.post('/core/auth/現在利用者')
                if (response.data.status === 'OK') {
                    this.user = response.data.data
                    localStorage.setItem('user', JSON.stringify(this.user))
                    this.authChecked = true
                }
            } catch (error: any) {
                // 認証エラー（401 はインターセプターがログアウト済み）だけログアウトし、
                // 応答なし（backend 起動途中など）は判定保留にして次の遷移で再確認する
                if (error?.response) {
                    this.logout()
                }
            }
        },
        logout(): void {
            this.token = ''
            this.user = null
            this.authChecked = false
            localStorage.removeItem('token')
            window.dispatchEvent(new Event('auth-cleared'))
            localStorage.removeItem('user')
            router.push('/ログイン')
        },
        async refreshToken(): Promise<void> {
            const requestToken = this.token
            if (!requestToken) return
            try {
                const response = await apiClient.post('/core/auth/トークン更新')
                if (response.data.status === 'OK' && this.token === requestToken) {
                    this.token = response.data.data.access_token
                    localStorage.setItem('token', this.token)
                }
            } catch {
                // リフレッシュ失敗時はログアウトに任せる（インターセプターが401時にログアウトする）
            }
        },
    },
})

