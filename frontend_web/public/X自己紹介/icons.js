// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// icons.js - AiDiy 登場企業・プロダクト アイコンギャラリー
// ランダム並び替え・クリックで公式ページへ遷移

// --------------------------------------------------------------------
// アイコンデータ
// --------------------------------------------------------------------
const ICON_DATA = [
  // ===== AI プロバイダ（企業＋製品） =====
  // 原則: https://cdn.simpleicons.org/<slug> を最優先
  {
    name: 'Anthropic',
    iconUrl: 'https://cdn.simpleicons.org/anthropic',
    linkUrl: 'https://anthropic.com',
    category: 'AI Provider',
  },
  {
    name: 'Claude',
    iconUrl: 'https://cdn.simpleicons.org/claude',
    linkUrl: 'https://claude.ai',
    category: 'AI Provider',
  },
  {
    name: 'Claude Code',
    iconUrl: 'https://cdn.simpleicons.org/claudecode',
    linkUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    category: 'AI Provider',
  },
  {
    name: 'OpenAI',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/openai.svg',
    linkUrl: 'https://openai.com',
    category: 'AI Provider',
  },
  {
    name: 'ChatGPT',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/openai.svg',
    linkUrl: 'https://chatgpt.com',
    category: 'AI Provider',
  },
  {
    name: 'Codex CLI',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/openai.svg',
    linkUrl: 'https://openai.com/index/codex-cli',
    category: 'AI Provider',
  },
  {
    name: 'Google',
    iconUrl: 'https://cdn.simpleicons.org/google',
    linkUrl: 'https://www.google.com',
    category: 'AI Provider',
  },
  {
    name: 'Gemini',
    iconUrl: 'https://cdn.simpleicons.org/googlegemini',
    linkUrl: 'https://gemini.google.com',
    category: 'AI Provider',
  },
  {
    name: 'Ollama',
    iconUrl: 'https://cdn.simpleicons.org/ollama',
    linkUrl: 'https://ollama.com',
    category: 'AI Provider',
  },
  {
    name: 'OpenRouter',
    iconUrl: 'https://cdn.simpleicons.org/openrouter',
    linkUrl: 'https://openrouter.ai',
    category: 'AI Provider',
  },
  {
    name: 'Microsoft',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/microsoft.svg',
    linkUrl: 'https://www.microsoft.com',
    category: 'AI Provider',
  },
  {
    name: 'GitHub',
    iconUrl: 'https://cdn.simpleicons.org/github',
    linkUrl: 'https://github.com',
    category: 'AI Provider',
  },
  {
    name: 'GitHub Copilot',
    iconUrl: 'https://cdn.simpleicons.org/githubcopilot',
    linkUrl: 'https://github.com/features/copilot',
    category: 'AI Provider',
  },
  {
    name: 'opencode',
    iconUrl: 'https://opencode.ai/favicon.ico',
    linkUrl: 'https://opencode.ai',
    category: 'AI Provider',
  },
  {
    name: 'xAI',
    iconUrl: 'https://cdn.simpleicons.org/x',
    linkUrl: 'https://x.ai',
    category: 'AI Provider',
  },
  {
    name: 'Grok CLI',
    iconUrl: 'https://cdn.simpleicons.org/x',
    linkUrl: 'https://x.ai/grok',
    category: 'AI Provider',
  },
  {
    name: 'Google Antigravity',
    iconUrl: 'https://cdn.simpleicons.org/googlegemini',
    linkUrl: 'https://antigravity.google',
    category: 'AI Provider',
  },
  {
    name: 'Hugging Face',
    iconUrl: 'https://cdn.simpleicons.org/huggingface',
    linkUrl: 'https://huggingface.co',
    category: 'AI Provider',
  },
  {
    name: 'Gemma',
    iconUrl: 'https://cdn.simpleicons.org/googlegemini',
    linkUrl: 'https://ai.google.dev/gemma',
    category: 'AI Provider',
  },

  // ===== プロトコル・規格 =====
  {
    name: 'MCP',
    iconUrl: 'https://cdn.simpleicons.org/modelcontextprotocol',
    linkUrl: 'https://modelcontextprotocol.io',
    category: 'Protocol',
  },
  {
    name: 'WebSocket',
    iconUrl: 'https://cdn-icons-png.flaticon.com/32/13811/13811893.png',
    linkUrl: 'https://developer.mozilla.org/docs/Web/API/WebSocket',
    category: 'Protocol',
  },
  {
    name: 'REST API',
    iconUrl: 'https://cdn-icons-png.flaticon.com/32/2957/2957999.png',
    linkUrl: 'https://developer.mozilla.org/docs/Glossary/REST',
    category: 'Protocol',
  },
  {
    name: 'JWT',
    iconUrl: 'https://cdn.simpleicons.org/jsonwebtokens',
    linkUrl: 'https://jwt.io',
    category: 'Protocol',
  },
  {
    name: 'CDP',
    iconUrl: 'https://cdn.simpleicons.org/googlechrome',
    linkUrl: 'https://chromedevtools.github.io/devtools-protocol',
    category: 'Protocol',
  },
  {
    name: 'VRM',
    iconUrl: 'https://vrm.dev/favicon.ico',
    linkUrl: 'https://vrm.dev',
    category: 'Protocol',
  },

  // ===== フレームワーク・ライブラリ =====
  {
    name: 'Vue.js',
    iconUrl: 'https://cdn.simpleicons.org/vuedotjs',
    linkUrl: 'https://vuejs.org',
    category: 'Framework',
  },
  {
    name: 'Vite',
    iconUrl: 'https://cdn.simpleicons.org/vite',
    linkUrl: 'https://vitejs.dev',
    category: 'Framework',
  },
  {
    name: 'TypeScript',
    iconUrl: 'https://cdn.simpleicons.org/typescript',
    linkUrl: 'https://www.typescriptlang.org',
    category: 'Framework',
  },
  {
    name: 'Electron',
    iconUrl: 'https://cdn.simpleicons.org/electron',
    linkUrl: 'https://www.electronjs.org',
    category: 'Framework',
  },
  {
    name: 'Three.js',
    iconUrl: 'https://cdn.simpleicons.org/threedotjs',
    linkUrl: 'https://threejs.org',
    category: 'Framework',
  },
  {
    name: 'FastAPI',
    iconUrl: 'https://cdn.simpleicons.org/fastapi',
    linkUrl: 'https://fastapi.tiangolo.com',
    category: 'Framework',
  },
  {
    name: 'Python',
    iconUrl: 'https://cdn.simpleicons.org/python',
    linkUrl: 'https://www.python.org',
    category: 'Framework',
  },
  {
    name: 'Node.js',
    iconUrl: 'https://cdn.simpleicons.org/nodedotjs',
    linkUrl: 'https://nodejs.org',
    category: 'Framework',
  },
  {
    name: 'SQLAlchemy',
    iconUrl: 'https://cdn.simpleicons.org/sqlalchemy',
    linkUrl: 'https://www.sqlalchemy.org',
    category: 'Framework',
  },
  {
    name: 'Pinia',
    iconUrl: 'https://cdn.simpleicons.org/pinia',
    linkUrl: 'https://pinia.vuejs.org',
    category: 'Framework',
  },
  {
    name: 'Vue Router',
    iconUrl: 'https://router.vuejs.org/logo.svg',
    linkUrl: 'https://router.vuejs.org',
    category: 'Framework',
  },
  {
    name: 'Axios',
    iconUrl: 'https://cdn.simpleicons.org/axios',
    linkUrl: 'https://axios-http.com',
    category: 'Framework',
  },
  {
    name: 'Monaco Editor',
    iconUrl: 'https://code.visualstudio.com/favicon.ico',
    linkUrl: 'https://microsoft.github.io/monaco-editor',
    category: 'Framework',
  },
  {
    name: 'Playwright',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/playwright.svg',
    linkUrl: 'https://playwright.dev',
    category: 'Framework',
  },
  {
    name: 'Leaflet',
    iconUrl: 'https://cdn.simpleicons.org/leaflet',
    linkUrl: 'https://leafletjs.com',
    category: 'Framework',
  },
  {
    name: 'ruff',
    iconUrl: 'https://cdn.simpleicons.org/ruff',
    linkUrl: 'https://docs.astral.sh/ruff',
    category: 'Framework',
  },
  {
    name: 'FFmpeg',
    iconUrl: 'https://cdn.simpleicons.org/ffmpeg',
    linkUrl: 'https://ffmpeg.org',
    category: 'Framework',
  },
  {
    name: 'OBS Studio',
    iconUrl: 'https://cdn.simpleicons.org/obsstudio',
    linkUrl: 'https://obsproject.com',
    category: 'Framework',
  },

  // ===== 開発ツール =====
  {
    name: 'VS Code',
    iconUrl: 'icons/vscode.svg',
    linkUrl: 'https://code.visualstudio.com',
    category: 'Development Tool',
  },

  // ===== コミュニケーション =====
  {
    name: 'Discord',
    iconUrl: 'icons/discord.svg',
    linkUrl: 'https://discord.com',
    category: 'Communication',
  },
  {
    name: 'Slack',
    iconUrl: 'icons/slack.svg',
    linkUrl: 'https://slack.com',
    category: 'Communication',
  },

  // ===== データベース =====
  {
    name: 'SQLite',
    iconUrl: 'https://cdn.simpleicons.org/sqlite',
    linkUrl: 'https://sqlite.org',
    category: 'Database',
  },
  {
    name: 'PostgreSQL',
    iconUrl: 'https://cdn.simpleicons.org/postgresql',
    linkUrl: 'https://www.postgresql.org',
    category: 'Database',
  },
]

// --------------------------------------------------------------------
// ユーティリティ
// --------------------------------------------------------------------

/** Fisher-Yates シャッフル（破壊的） */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr
}

/** アイコン配列をランダム順に並び替えて返す */
function getShuffledIcons() {
  return shuffleArray([...ICON_DATA])
}

// --------------------------------------------------------------------
// 描画
// --------------------------------------------------------------------

/**
 * 指定したコンテナ要素にアイコンギャラリーを描画する
 * @param {HTMLElement|string} container - コンテナ要素またはセレクタ
 * @param {object} [options]
 * @param {boolean} [options.showLabels=true] - ラベルを表示するか
 * @param {number} [options.iconSize=36] - アイコンサイズ（px）
 */
function renderIconGallery(container, options = {}) {
  const { showLabels = true, iconSize = 36 } = options

  const el = typeof container === 'string'
    ? document.querySelector(container)
    : container
  if (!el) return

  const shuffled = getShuffledIcons()

  el.innerHTML = ''
  el.className = 'icon-gallery'

  for (const item of shuffled) {
    const card = document.createElement('a')
    card.href = item.linkUrl
    card.target = '_blank'
    card.rel = 'noopener noreferrer'
    card.title = `${item.name} (${item.category})`
    card.className = 'icon-card'

    // アイコン画像
    const img = document.createElement('img')
    img.src = item.iconUrl
    img.alt = item.name
    img.loading = 'lazy'

    img.addEventListener('error', () => {
      // 画像が読めなかったらイニシャル表示にフォールバック
      img.style.display = 'none'
      const fallback = document.createElement('span')
      fallback.textContent = item.name.charAt(0)
      fallback.className = 'icon-fallback'
      card.insertBefore(fallback, card.firstChild)
    })

    card.appendChild(img)

    // ラベル
    if (showLabels) {
      const label = document.createElement('span')
      label.textContent = item.name
      label.className = 'icon-label'
      card.appendChild(label)
    }

    el.appendChild(card)
  }
}
