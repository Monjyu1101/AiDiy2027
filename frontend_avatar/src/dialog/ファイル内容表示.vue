<!--
  -*- coding: utf-8 -*-

  -------------------------------------------------------------------------
  COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
  Licensed under "AiDiy 公開利用ライセンス v1.1".
  Commercial use requires prior written consent from all copyright holders.
  See LICENSE for full terms. Thank you for keeping the rules.
  https://github.com/monjyu1101/AiDiy2027
  -------------------------------------------------------------------------
-->

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { monaco, モナコ言語推定 } from '@/utils/monaco'

const props = defineProps<{
  show: boolean
  ファイル名: string
  base64_data: string
}>()

const emit = defineEmits<{
  close: []
}>()

const 画像MIME辞書: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

const テキスト拡張子セット = new Set([
  'py', 'vue', 'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt',
  'html', 'css', 'scss', 'sass', 'less', 'yml', 'yaml', 'toml',
  'ini', 'env', 'sql', 'csv', 'log', 'xml', 'sh', 'ps1', 'bat',
])
const ANSI拡張子 = new Set(['bat', 'cmd'])

const monacoコンテナ = ref<HTMLDivElement | null>(null)
let monacoエディタ: monaco.editor.IStandaloneCodeEditor | null = null

const 拡張子 = computed(() => {
  const queryRemoved = (props.ファイル名 || '').split(/[?#]/u, 1)[0] || ''
  const slashIndex = Math.max(queryRemoved.lastIndexOf('/'), queryRemoved.lastIndexOf('\\'))
  const baseName = slashIndex >= 0 ? queryRemoved.slice(slashIndex + 1) : queryRemoved
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex < 0) return ''
  return baseName.slice(dotIndex + 1).toLowerCase()
})

const 画像表示 = computed(() => Boolean(画像MIME辞書[拡張子.value]))
const テキスト表示 = computed(() => テキスト拡張子セット.has(拡張子.value))

const 画像DataUrl = computed(() => {
  if (!画像表示.value || !props.base64_data) return ''
  return `data:${画像MIME辞書[拡張子.value]};base64,${props.base64_data}`
})

const テキスト内容 = computed(() => {
  if (!テキスト表示.value || !props.base64_data) return ''
  try {
    const binary = window.atob(props.base64_data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    const encoding = ANSI拡張子.has(拡張子.value) ? 'shift_jis' : 'utf-8'
    return new TextDecoder(encoding).decode(bytes)
  } catch (error) {
    return `テキストデコードに失敗しました: ${error}`
  }
})

async function monacoエディタ更新() {
  if (!props.show || !テキスト表示.value || !テキスト内容.value) return
  const 言語 = モナコ言語推定(props.ファイル名)
  await nextTick()
  if (!monacoコンテナ.value) return

  if (!monacoエディタ) {
    monacoエディタ = monaco.editor.create(monacoコンテナ.value, {
      value: テキスト内容.value,
      language: 言語,
      theme: 'vs-dark',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineNumbers: 'on',
      folding: true,
      wordWrap: 'on',
      renderLineHighlight: 'none',
      domReadOnly: true,
      contextmenu: false,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    })
    return
  }

  const model = monacoエディタ.getModel()
  if (model) {
    monaco.editor.setModelLanguage(model, 言語)
  }
  monacoエディタ.setValue(テキスト内容.value)
  monacoエディタ.revealLine(1)
}

function monacoエディタ破棄() {
  monacoエディタ?.dispose()
  monacoエディタ = null
}

watch(
  [() => props.show, () => props.ファイル名, () => props.base64_data, テキスト表示],
  () => {
    void monacoエディタ更新()
  },
  { immediate: true },
)

watch(() => props.show, (show) => {
  if (!show) {
    monacoエディタ破棄()
  }
})

onBeforeUnmount(() => {
  monacoエディタ破棄()
})

function 閉じる() {
  emit('close')
}

function ダウンロード() {
  if (!props.base64_data) return
  const fileName = props.ファイル名.replace(/\\/g, '/').split('/').pop() ?? props.ファイル名
  const anchor = document.createElement('a')
  anchor.href = `data:application/octet-stream;base64,${props.base64_data}`
  anchor.download = fileName
  anchor.click()
}
</script>

<template>
  <div v-if="show" class="file-content-overlay" @click.self="閉じる">
    <div class="file-content-dialog">
      <div class="file-name">{{ ファイル名 }}</div>

      <div class="file-content-body">
        <img v-if="画像表示 && 画像DataUrl" class="preview-image" :src="画像DataUrl" alt="image preview" />
        <div v-else-if="テキスト表示" ref="monacoコンテナ" class="monaco-container"></div>
        <div v-else class="unsupported-message">この拡張子はプレビュー対象外です。</div>
      </div>

      <div class="file-content-footer">
        <button type="button" class="btn-download" @click="ダウンロード" :disabled="!base64_data">ダウンロード</button>
        <button type="button" class="btn-close" @click="閉じる">閉じる</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-content-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
}

.file-content-dialog {
  max-width: 90%;
  max-height: 90%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.file-name {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  word-break: break-all;
  color: #ffffff;
  text-align: center;
}

.file-content-body {
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80vw;
  max-height: calc(90vh - 120px);
}

.preview-image {
  display: block;
  max-width: 100%;
  max-height: calc(90vh - 120px);
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(255, 255, 255, 0.3);
}

.monaco-container {
  width: 100%;
  height: calc(90vh - 140px);
  min-height: 200px;
  border-radius: 4px;
  overflow: hidden;
}

.unsupported-message {
  color: #9ca3af;
  font-size: 13px;
}

.file-content-footer {
  display: flex;
  justify-content: center;
  gap: 15px;
}

.btn-download,
.btn-close {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.btn-download {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #ffffff;
}

.btn-close {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.btn-download:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
