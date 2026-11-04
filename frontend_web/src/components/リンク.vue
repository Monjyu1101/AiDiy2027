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

<template>
  <div class="link-view">
    <h2 class="page-title">【 リンク 】</h2>

    <div class="link-container">
      <div class="grid-container">
        <!-- Google -->
        <div class="grid-item">
          <h3 class="section-title">Google</h3>
          <ul class="link-list">
            <li><a href="https://google.com/" target="_blank">Google検索</a></li>
            <li><a href="https://gemini.google.com/" target="_blank">Geminiチャット</a></li>
            <li><a href="https://notebooklm.google.com/" target="_blank">NotebookLM</a></li>
            <li><a href="https://aistudio.google.com/" target="_blank">AI Studio</a></li>
            <li><a href="https://ai.google.dev/gemini-api/docs/models/gemini" target="_blank">モデル情報</a></li>
            <li><a href="https://aistudio.google.com/app/usage" target="_blank">利用状況</a></li>
          </ul>
        </div>

        <!-- OpenAI -->
        <div class="grid-item">
          <h3 class="section-title">OpenAI</h3>
          <ul class="link-list">
            <li><a href="https://openai.com/" target="_blank">OpenAI</a></li>
            <li><a href="https://chatgpt.com/" target="_blank">ChatGPT</a></li>
            <li><a href="https://platform.openai.com/playground/" target="_blank">API, playground</a></li>
            <li><a href="https://platform.openai.com/docs/models" target="_blank">モデル情報</a></li>
            <li><a href="https://platform.openai.com/usage" target="_blank">利用状況</a></li>
          </ul>
        </div>

        <!-- Azure -->
        <div class="grid-item">
          <h3 class="section-title">Azure</h3>
          <ul class="link-list">
            <li><a href="https://portal.azure.com/" target="_blank">Azure</a></li>
            <li><a href="https://oai.azure.com/" target="_blank">OpenAI Studio</a></li>
          </ul>
        </div>

        <!-- Anthropic -->
        <div class="grid-item">
          <h3 class="section-title">Anthropic</h3>
          <ul class="link-list">
            <li><a href="https://claude.ai/" target="_blank">Claude</a></li>
            <li><a href="https://console.anthropic.com/dashboard" target="_blank">Console, dashboard</a></li>
            <li><a href="https://docs.anthropic.com/en/docs/about-claude/models" target="_blank">モデル情報</a></li>
            <li><a href="https://console.anthropic.com/settings/cost" target="_blank">Console, 利用状況</a></li>
          </ul>
        </div>

        <!-- Grok -->
        <div class="grid-item">
          <h3 class="section-title">Grok</h3>
          <ul class="link-list">
            <li><a href="https://grok.com" target="_blank">grok.com</a></li>
            <li><a href="https://x.com/i/grok" target="_blank">x.com/i/grok</a></li>
            <li><a href="https://console.x.ai/" target="_blank">Console</a></li>
          </ul>
        </div>

        <!-- Groq -->
        <div class="grid-item">
          <h3 class="section-title">Groq</h3>
          <ul class="link-list">
            <li><a href="https://groq.com/" target="_blank">Groq</a></li>
            <li><a href="https://console.groq.com/playground" target="_blank">Playground</a></li>
            <li><a href="https://console.groq.com/docs/models" target="_blank">モデル情報</a></li>
            <li><a href="https://console.groq.com/settings/usage" target="_blank">Settings, 利用状況</a></li>
          </ul>
        </div>

        <!-- OpenRouter -->
        <div class="grid-item">
          <h3 class="section-title">OpenRouter</h3>
          <ul class="link-list">
            <li><a href="https://openrouter.ai/" target="_blank">OpenRouter</a></li>
            <li><a href="https://openrouter.ai/models" target="_blank">モデル情報</a></li>
            <li><a href="https://openrouter.ai/credits" target="_blank">利用状況</a></li>
          </ul>
        </div>

        <!-- Perplexity -->
        <div class="grid-item">
          <h3 class="section-title">Perplexity</h3>
          <ul class="link-list">
            <li><a href="https://www.perplexity.ai/" target="_blank">知識の始まり</a></li>
            <li><a href="https://labs.perplexity.ai/" target="_blank">labs, playground</a></li>
            <li><a href="https://docs.perplexity.ai/models/" target="_blank">モデル情報</a></li>
            <li><a href="https://www.perplexity.ai/settings/api" target="_blank">API, 利用状況</a></li>
          </ul>
        </div>

        <!-- Genspark -->
        <div class="grid-item">
          <h3 class="section-title">Genspark</h3>
          <ul class="link-list">
            <li><a href="https://www.genspark.ai/" target="_blank">Genspark</a></li>
            <li><a href="https://www.genspark.ai/autopilotagent" target="_blank">Autopilot Agent</a></li>
          </ul>
        </div>

        <!-- GitHub -->
        <div class="grid-item">
          <h3 class="section-title">GitHub</h3>
          <ul class="link-list">
            <li><a href="https://github.com/" target="_blank">GitHub</a></li>
            <li><a href="https://github.com/marketplace/models/" target="_blank">Models</a></li>
            <li><a href="https://github.com/clipngpt/" target="_blank">Clip&GPT</a></li>
            <li><a href="https://github.com/monjyu1101/AiDiy2027/" target="_blank">monjyu1101</a></li>
            <li><a href="https://github.com/browser-use/browser-use" target="_blank">browser-use</a></li>
            <li><a href="https://github.com/browser-use/web-ui" target="_blank">web-ui</a></li>
          </ul>
        </div>

        <!-- Ollama -->
        <div class="grid-item">
          <h3 class="section-title">Ollama</h3>
          <ul class="link-list">
            <li><a href="https://ollama.com/" target="_blank">Ollama</a></li>
            <li><a href="https://ollama.com/search" target="_blank">モデル情報</a></li>
          </ul>
        </div>

        <!-- MCP -->
        <div class="grid-item">
          <h3 class="section-title">MCP</h3>
          <ul class="link-list">
            <li><a href="https://github.com/modelcontextprotocol/servers" target="_blank">Servers</a></li>
            <li><a href="https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem" target="_blank">・filesystem</a></li>
            <li><a href="https://github.com/modelcontextprotocol/servers/tree/main/src/memory" target="_blank">・memory</a></li>
            <li><a href="https://github.com/appcypher/awesome-mcp-servers" target="_blank">MCP Servers</a></li>
            <li><a href="https://github.com/wonderwhy-er/DesktopCommanderMCP" target="_blank">・DesktopCommanderMCP</a></li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 全体のスタイル */
.link-view {
  background: linear-gradient(135deg, #faf7f2 0%, #f5f1e8 50%, #f0ebe0 100%);
  min-height: 100vh;
}

/* タイトル部分 */
.page-title {
  background: linear-gradient(135deg, #e6d5b7 0%, #dcc8a6 50%, #d2bb95 100%);
  margin: 0 0 5px 0;
  font-size: medium;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 20px 10px 40px;
  height: 35px;
  line-height: 20px;
  color: #5a4a3a;
  font-weight: bold;
  box-shadow: 0 2px 4px rgba(210, 187, 149, 0.3);
}

/* 表示エリアのスタイル */
.link-container {
  background: linear-gradient(135deg, #faf7f2 0%, #f5f1e8 50%, #f0ebe0 100%);
  width: calc(100% - 15px);
  min-height: 100vh;
  padding: 20px;
  box-sizing: border-box;
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.grid-item {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  border: 1px solid #e0e0e0;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.grid-item:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}

.section-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 15px;
  color: #5a4a3a;
  border-bottom: 2px solid #d2bb95;
  padding-bottom: 8px;
}

.link-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.link-list li {
  margin-bottom: 8px;
}

.link-list a {
  display: block;
  padding: 8px 12px;
  text-decoration: none;
  color: #5a4a3a;
  background: linear-gradient(135deg, #ece5d6 0%, #e2d9c8 100%);
  border-radius: 5px;
  border: 1px solid #d4c4a8;
  transition: all 0.2s ease;
  font-size: 14px;
}

.link-list a:hover {
  background: linear-gradient(135deg, #e6d5b7 0%, #dcc8a6 100%);
  color: #5a4a3a;
  border-color: #d2bb95;
  transform: translateX(3px);
  font-weight: bold;
}

.link-list a:active {
  transform: translateX(1px);
}

/* レスポンシブ対応 */
@media (max-width: 768px) {
  .link-container {
    padding: 10px;
  }

  .grid-container {
    grid-template-columns: 1fr;
    gap: 15px;
  }

  .grid-item {
    padding: 15px;
  }

  .section-title {
    font-size: 16px;
  }

  .link-list a {
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .page-title {
    font-size: small;
    padding: 8px 15px;
    height: 30px;
  }

  .link-container {
    padding: 10px 5px;
  }

  .grid-item {
    padding: 12px;
  }

  .section-title {
    font-size: 14px;
  }

  .link-list a {
    padding: 6px 10px;
    font-size: 12px;
  }
}

/* 大画面用調整 */
@media (min-width: 1200px) {
  .grid-container {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>

