// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// ■ フロントエンド ベストプラクティス

// 1. Composition API + script setup
// 正解
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const items = ref<any[]>([])
const loading = ref(false)

onMounted(() => {
 fetchItems()
})
</script>

// 誤り（Options API）
export default {
 data() { return { items: [] } },
 mounted() { this.fetchItems() }
}

// 2. qAlert/qConfirm の使用
import { qAlert, qConfirm } from '@/utils/qAlert'

// 正解
await qAlert('保存しました')
const confirmed = await qConfirm('削除しますか？')

// 誤り（ネイティブダイアログ）
alert('保存しました')
confirm('削除しますか？')

// 3. エラーハンドリング
// 正解
try {
 const response = await apiClient.post('/core/C利用者/一覧')
 if (response.data.status === 'OK') {
 items.value = response.data.data.items
 } else {
 await qAlert(`エラー: ${response.data.message}`)
 }
} catch (error) {
 console.error(error)
 await qAlert('通信エラーが発生しました')
}

// 誤り（エラー処理なし）
const response = await apiClient.post('/core/C利用者/一覧')
items.value = response.data.data.items
