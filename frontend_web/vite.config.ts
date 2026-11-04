// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const PORT_WEB = 8090
const PORT_CORE = 8091
const PORT_TOOLS = 8095
const PORT_APPS = 8098

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    // public配下の独立HTMLは各ページのimportmapを使う。アプリの依存探索へ混ぜない。
    entries: ['index.html'],
    include: ['monaco-editor'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '127.0.0.1',
    port: PORT_WEB,
    proxy: {
      '/core': {
        target: `http://127.0.0.1:${PORT_CORE}`,
        changeOrigin: true,
        ws: true,  // WebSocketサポートを有効化
      },
      '/apps': {
        target: `http://127.0.0.1:${PORT_APPS}`,
        changeOrigin: true,
        ws: true,  // WebSocketサポートを有効化
      },
      '/mcp': {
        target: `http://127.0.0.1:${PORT_TOOLS}`,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/mcp/, ''),
      },
    }
  }
})
