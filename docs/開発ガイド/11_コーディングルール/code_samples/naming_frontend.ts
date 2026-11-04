// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// ■ フロントエンド（TypeScript）の命名例

// 正解：ビジネスドメインは日本語
const 利用者名 = ref('')
const 権限ID = ref('')

const 利用者一覧取得 = async () => {
 const response = await apiClient.post('/core/C利用者/一覧')
 return response.data.data.items
}

// 正解：システム/フレームワーク用語は英語
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import apiClient from '@/api/client'

const router = useRouter()
const items = ref<any[]>([])
const loading = ref(false)

// ■ Vue componentタグの制約
// 誤り（日本語タグ名は無効）
// <C利用者一覧 />

// 正解（動的コンポーネント）
// <component :is="C利用者一覧" />
