window.SCENARIO = {
  "project_name": "AiDiy紹介__all_ja",
  "version": "mcp",
  "title": "AiDiy - 日本語ファーストのフルスタック業務管理テンプレート完全紹介",
  "source": {
    "type": "agents_and_knowledge",
    "summary": "AiDiy の実装実態を AGENTS.md と _AIDIY/knowledge から抜粋し、全機能・特徴を網羅した事実ベース紹介として再構成する。"
  },
  "target": {
    "language": "ja-JP",
    "format": "html_css_scene_player_with_media",
    "tone": "事実ベース、簡潔、根拠付き、親しみやすく前向き",
    "goal": "AiDiy の全体像を、構成・命名・サンプル・AI・MCP・ビデオ自動生成まで正確かつ楽しく伝える。"
  },
  "assets_policy": {
    "visual_style": "left_avatar_38_right_content_62",
    "audio_dir": "audio",
    "image_dir": "images",
    "avatar": "../_vrm/VRM_AiDiy.vrm",
    "tts_provider": "freeai:female"
  },
  "scenes": [
    {
      "id": "scene_000",
      "title": "この動画で紹介すること",
      "expression": "neutral",
      "accent": "#29d8ff",
      "accent_soft": "rgba(41, 216, 255, 0.2)",
      "layout": "hero",
      "hero_image_focus": true,
      "background_word": "",
      "kicker": "INTRODUCTION",
      "headline": "AiDiy の全体像と設計思想を\n7つのシーンで紹介します",
      "lead": "日本語ファースト設計・サービス構成・業務サンプル・AI コアとアバター・MCP TOOL HUB・AIタスクと AIチーム・ビデオ自動生成まで、AiDiy の実態を順番に見ていきます。",
      "subtitle": "日本語ファースト設計から AIタスク・AIチームまで、AiDiy の全体像を順番に紹介します。",
      "image": "images/scene_000.png",
      "chips": [],
      "metrics": [],
      "cards": [],
      "facts": [],
      "evidence": [],
      "image_prompt": "Square 1:1 hero poster for AiDiy. Make the word AiDiy itself the coolest central visual, with premium futuristic typography, strong cyan and electric blue glow, elegant Japanese enterprise AI platform mood, dark background, clean composition, high readability, polished technology branding aesthetic, no clutter, no extra fake logos, no dense paragraphs.",
      "short_narration": "AiDiy の全体像を、日本語ファースト設計から AI コア、MCP、AIタスクと AIチームまで順に紹介します。",
      "long_narration": "この動画は、AiDiy のビデオページ生成機能で自動生成されました。シナリオ作成から画像生成、音声合成、HTML 組み立てまで、すべてを MCP と CodeAgents が担当しています。AiDiy という名前には、AI と Do It Yourself、つまり AI の力を借りながら、自分たちの業務システムや自動化ツールを自分たちで作っていく、というコンセプトを込めています。日本語を第一言語として設計されたフルスタック業務管理テンプレートとして、FastAPI、SQLAlchemy、SQLite、Vue 3、Vite、TypeScript を中核に、実務に近い業務サンプルと AI 実験基盤をひとつにまとめています。このビデオでは、日本語ファースト設計、サービス構成、業務サンプル、AI コアとアバター、Code AI、MCP TOOL HUB、そして AIタスクと AIチーム、ビデオ自動生成まで、AiDiy の全体像を 7 つのシーンで順番に紹介します。",
      "short_audio": "audio/short_scene_000.mp3",
      "long_audio": "audio/long_scene_000.mp3",
      "short_start_sec": 0.0,
      "short_duration_sec": 7.704,
      "long_start_sec": 0.0,
      "long_duration_sec": 54.288
    },
    {
      "id": "scene_001",
      "title": "AiDiy とは",
      "expression": "neutral",
      "accent": "#29d8ff",
      "accent_soft": "rgba(41, 216, 255, 0.18)",
      "kicker": "PROJECT OVERVIEW",
      "headline": "日本語ファーストの\nフルスタック業務管理テンプレート",
      "lead": "FastAPI + SQLAlchemy + SQLite と Vue 3 + Vite + TypeScript を中核に、業務サンプルと AI 実験基盤をひとつにまとめています。",
      "subtitle": "日本語識別子と業務サンプルを土台に、AI・音声・MCP まで一体化した基盤。",
      "image": "images/scene_001.png",
      "image_prompt": "Vertical 2:3 key visual for a Japanese enterprise AI development platform, accurate architecture mood, modular blocks suggesting backend_server, backend_tools, frontend_web, frontend_avatar, dark blueprint background, clean cyan and magenta lighting, no brand logos, realistic software diagram poster, high clarity, professional not playful",
      "chips": [
        "日本語識別子",
        "FastAPI + SQLAlchemy + SQLite",
        "Python 3.13",
        "Vue 3 + Vite + TypeScript",
        "業務サンプル同梱"
      ],
      "metrics": [
        {
          "label": "常駐サーバー",
          "value": "7"
        },
        {
          "label": "MCP",
          "value": "19"
        },
        {
          "label": "Code AI",
          "value": "8"
        }
      ],
      "cards": [
        {
          "title": "目的",
          "lines": [
            "日本語ネイティブな開発環境の提供",
            "実用的な業務管理テンプレート",
            "AI・音声・画像・MCP の実験基盤"
          ]
        },
        {
          "title": "中核スタック",
          "lines": [
            "backend_server / backend_tools",
            "frontend_web / frontend_avatar",
            "SQLite 共有 DB"
          ]
        }
      ],
      "facts": [
        "AiDiy は日本語を第一言語とするフルスタック業務管理システム開発フレームワーク / テンプレート。",
        "権限、マスタ、トランザクション、スケジューラ、在庫管理の実装例を含む。",
        "AI、音声、画像、Code CLI、MCP を統合する実験基盤でもある。"
      ],
      "evidence": [
        {
          "source": "AGENTS.md",
          "text": "AiDiy は、日本語を第一言語とするフルスタック業務管理システムの開発フレームワーク / テンプレート。"
        },
        {
          "source": "AGENTS.md",
          "text": "FastAPI + SQLAlchemy + SQLite (Python 3.13)、Vue 3 + Vite + TypeScript を中核とする。"
        }
      ],
      "short_narration": "FastAPI と Vue 3 を中核に、業務サンプルと AI 実験基盤をひとつにまとめたテンプレートです。",
      "long_narration": "AiDiy は、日本語を第一言語として設計されたフルスタック業務管理テンプレートです。Python 3.13 の FastAPI と SQLAlchemy、SQLite をバックエンドの中核に、フロントエンドは Vue 3 と Vite と TypeScript で構成します。権限管理、マスタ管理、トランザクション、スケジューラ、在庫管理などの業務サンプルを実装済みで含み、さらに AI チャット、音声、画像生成、Code AI エージェント、19 個の MCP ツールを統合した実験基盤でもあります。業務システムの開発テンプレートと AI 実験基盤を、ひとつのプロジェクトにまとめたのが AiDiy です。",
      "short_audio": "audio/short_scene_001.mp3",
      "long_audio": "audio/long_scene_001.mp3",
      "short_start_sec": 0.0,
      "short_duration_sec": 6.888,
      "long_start_sec": 0.0,
      "long_duration_sec": 34.848
    },
    {
      "id": "scene_002",
      "title": "日本語ファースト設計",
      "expression": "neutral",
      "accent": "#7dffb3",
      "accent_soft": "rgba(125, 255, 179, 0.18)",
      "kicker": "JAPANESE FIRST",
      "headline": "DB / API / UI / Code を\n日本語で一直線につなぐ",
      "lead": "AiDiy では業務語彙と実装名をできるだけ一致させ、日本語話者がコードと画面を直接対応づけられるようにしています。",
      "subtitle": "業務語彙と実装名を揃え、読めるまま保守できる構成。",
      "image": "images/scene_002.png",
      "image_prompt": "Vertical 2:3 infographic of Japanese-first software design, layered database API UI code connection, enterprise blueprint poster, strong arrows, clean boxes, realistic development system diagram, dark background with green accent, no garbled logo emphasis, professional Japanese software architecture mood",
      "chips": [
        "UTF-8 固定",
        "URL も日本語",
        "JSON キーも日本語",
        "一般名 request/query は英字可"
      ],
      "metrics": [
        {
          "label": "統一レイヤー",
          "value": "4"
        },
        {
          "label": "原則",
          "value": "一致重視"
        }
      ],
      "cards": [
        {
          "title": "Database",
          "lines": [
            "テーブル名: `C権限` / `T配車`",
            "カラム名: `利用者ID` / `配車日付`",
            "監査フィールド標準装備"
          ]
        },
        {
          "title": "API / JSON",
          "lines": [
            "パス: `/core/利用者/一覧`",
            "キー: `{\"利用者名\": \"admin\"}`",
            "POST 中心の統一レスポンス"
          ]
        },
        {
          "title": "Frontend",
          "lines": [
            "ファイル: `C利用者一覧.vue`",
            "Router: `/C管理/C利用者/一覧`",
            "変数: `利用者名` / `配車日付`"
          ]
        },
        {
          "title": "例外",
          "lines": [
            "request / query / items は英字",
            "英字ライブラリ名はそのまま使用",
            "全ファイルは UTF-8 固定"
          ]
        }
      ],
      "facts": [
        "画面、URL、JSON キー、識別子は日本語を原則とする。",
        "DB 項目名、API 項目名、フロントエンド変数名はできるだけ一致させる。",
        "request / query / items などのシステム用語と英字ライブラリ名は英字のまま使用する。"
      ],
      "evidence": [
        {
          "source": "AGENTS.md",
          "text": "全レイヤーで日本語識別子を使います。Database / API / Frontend / Code の例が明示されています。"
        },
        {
          "source": "CLAUDE.md",
          "text": "テーブル名 C権限、API パス /core/利用者/一覧、JSON キー {\"利用者名\": \"admin\"}、ファイル名 C利用者一覧.vue。"
        }
      ],
      "short_narration": "画面から API、データベース、コード変数まで、すべて日本語識別子で統一します。",
      "long_narration": "AiDiy の最大の特徴は日本語ファースト設計です。データベースのテーブル名は C権限や T配車、API パスは /core/利用者/一覧、JSON キーは 利用者名 や 配車日付、Vue コンポーネントのファイル名は C利用者一覧.vue、Python の変数名まで、すべてのレイヤーで日本語識別子を使います。これにより業務語彙とコードの識別子が直接対応し、日本語話者が設計意図を保守の場面でもそのまま読み取れます。request、query、items といったシステム用語や英字ライブラリ名はそのまま英語で使います。全ファイルは UTF-8 固定です。",
      "short_audio": "audio/short_scene_002.mp3",
      "long_audio": "audio/long_scene_002.mp3",
      "short_start_sec": 0.0,
      "short_duration_sec": 5.76,
      "long_start_sec": 0.0,
      "long_duration_sec": 36.696
    },
    {
      "id": "scene_003",
      "title": "サービス構成",
      "expression": "neutral",
      "accent": "#ff6bd6",
      "accent_soft": "rgba(255, 107, 214, 0.18)",
      "kicker": "ARCHITECTURE",
      "headline": "7 本のサービスが\nひとつの DB を中心に動く",
      "lead": "backend_server が 2 本、backend_tools の MCP ハブ、AIタスクと AIチームを動かす backend_taskteam、ローカル推論の backend_local、frontend_web と frontend_avatar の構成です。",
      "subtitle": "backend 5 本 + frontend 2 本。DB は 1 つの SQLite を共有します。",
      "image": "images/scene_003.png",
      "image_prompt": "Vertical 2:3 architecture poster showing AiDiy five service diagram, two backend_server blocks labeled core 8091 and apps 8098, one backend_tools block labeled MCP Hub 8095, frontend_web 8090 and frontend_avatar 8092, connected to central SQLite DB, dark enterprise blueprint style, magenta accent, clean system diagram, no mascots",
      "chips": [
        "core_main port 8091",
        "apps_main port 8098",
        "backend_tools port 8095",
        "backend_taskteam port 8093",
        "backend_local port 8096",
        "frontend_web port 8090",
        "frontend_avatar port 8092"
      ],
      "metrics": [
        {
          "label": "backend",
          "value": "5 本"
        },
        {
          "label": "frontend",
          "value": "2 本"
        },
        {
          "label": "共有 DB",
          "value": "SQLite 1 つ"
        }
      ],
      "cards": [
        {
          "title": "backend_server",
          "lines": [
            "core_main: 8091 (C系・認証・AIコア)",
            "apps_main: 8098 (M系・T系・V系・S系)",
            "SQLite DB を共有"
          ]
        },
        {
          "title": "backend_tools",
          "lines": [
            "tools_main: 8095 (MCP TOOL HUB)",
            "19 個の MCP を同一ポートに集約",
            "SSE / HTTP / stdio 3 トランスポート"
          ]
        },
        {
          "title": "frontend_web",
          "lines": [
            "8090: Vue 3 + Vite + TypeScript",
            "/core → 8091, /apps → 8098 にプロキシ",
            "qTubler + Pinia + Vue Router"
          ]
        },
        {
          "title": "frontend_avatar",
          "lines": [
            "8092: Electron / Web デュアルモード",
            "Three.js + @pixiv/three-vrm",
            "AI アバタークライアント"
          ]
        },
        {
          "title": "backend_taskteam / backend_local",
          "lines": [
            "taskteam: 8093 (AIタスク + AIチーム)",
            "local: 8096 (OpenAI 互換 Gemma 推論)",
            "DB は backend_server と同じ SQLite を共有"
          ]
        }
      ],
      "facts": [
        "backend_server は core_main (8091) と apps_main (8098) の 2 サーバー構成で同じ SQLite DB を共有する。",
        "backend_tools (8095) は 19 個の MCP サーバーを同居させ SSE / Streamable HTTP / stdio を提供する。",
        "frontend_web の Vite プロキシは /core を 8091、/apps を 8098 に振り分ける。"
      ],
      "evidence": [
        {
          "source": "AGENTS.md",
          "text": "core_main.py と apps_main.py は同じ SQLite DB を共有します。フロントエンドは Vite proxy で /core/* を 8091、/apps/* を 8098 へ振り分けます。"
        },
        {
          "source": "CLAUDE.md",
          "text": "backend_server core 8091 / apps 8098, backend_tools 8095, frontend_web 8090, frontend_avatar 8092。"
        }
      ],
      "short_narration": "バックエンド 5 本、フロントエンド 2 本。MCP ハブ、タスク基盤、ローカル推論が独立して動きます。",
      "long_narration": "AiDiy のサービス構成を見ていきます。バックエンドは 5 本です。backend_server は 2 本立てで、ポート 8091 の core_main が認証と AI コア、ポート 8098 の apps_main が業務データを担当します。backend_tools はポート 8095 の MCP TOOL HUB で、19 個の MCP サーバーをひとつのポートに集約しています。backend_taskteam はポート 8093 で、AIタスクと AIチームの実行基盤です。backend_local はポート 8096 で、OpenAI 互換のローカル推論サーバーを提供します。フロントエンドは 2 種類。ポート 8090 の frontend_web が業務画面を、ポート 8092 の frontend_avatar が Electron と Web のデュアルモードで AI アバターを担当します。データベースはひとつの SQLite を全サービスで共有しているので、業務データと AI の実行履歴を同じ場所で扱えます。",
      "short_audio": "audio/short_scene_003.mp3",
      "long_audio": "audio/long_scene_003.mp3",
      "short_start_sec": 0.0,
      "short_duration_sec": 6.504,
      "long_start_sec": 0.0,
      "long_duration_sec": 49.896
    },
    {
      "id": "scene_004",
      "title": "業務サンプルと命名規則",
      "expression": "neutral",
      "accent": "#ffbf47",
      "accent_soft": "rgba(255, 191, 71, 0.18)",
      "kicker": "BUSINESS PATTERNS",
      "headline": "配車・生産・在庫を\n実装パターンごと持っている",
      "lead": "AiDiy は見た目だけのデモではなく、業務サンプルと命名規則をセットで持つテンプレートです。",
      "subtitle": "サンプル名と実装パターンが一致しているので、横展開しやすい。",
      "image": "images/scene_004.png",
      "image_prompt": "Vertical 2:3 collage of Japanese business software modules for dispatch management, production management, inventory management, with clean enterprise dashboards and taxonomy badges C M T V S A X, warm amber accent, realistic ERP style, precise and practical, no cartoon look",
      "chips": [
        "C / M / T / V / S / A / X",
        "明細型パターン",
        "JOIN / 集計 V系",
        "Scheduler 付き"
      ],
      "metrics": [
        {
          "label": "接頭辞種",
          "value": "7"
        },
        {
          "label": "業務例",
          "value": "3"
        },
        {
          "label": "明細型",
          "value": "単一表"
        }
      ],
      "cards": [
        {
          "title": "接頭辞の意味",
          "lines": [
            "C: Core/Common, M: Master",
            "T: Transaction, V: View endpoint",
            "S: Scheduler, A: AI, X: 実験系"
          ]
        },
        {
          "title": "業務サンプル",
          "lines": [
            "配車管理: M配車区分・M車両・T配車・S配車",
            "生産管理: M商品・M商品構成・T生産",
            "在庫管理: T商品入庫・T商品出庫・T商品棚卸"
          ]
        },
        {
          "title": "明細型パターン",
          "lines": [
            "明細SEQ=0 がヘッダー行",
            "明細SEQ>=1 が明細行",
            "M商品構成 と T生産 が代表例"
          ]
        },
        {
          "title": "V系の実態",
          "lines": [
            "DB VIEW オブジェクトではない",
            "Router 内の生 SQL JOIN / 集計",
            "V商品推移表 など"
          ]
        }
      ],
      "facts": [
        "配車管理は `M配車区分`、`M車両`、`T配車`、`V配車`、`S配車_*` で構成される。",
        "生産管理は `M商品構成` と `T生産` を含み、明細型パターンの実例になっている。",
        "V系は DB VIEW オブジェクトではなく、生 SQL による JOIN / 集計エンドポイント。"
      ],
      "evidence": [
        {
          "source": "AGENTS.md",
          "text": "テーブル命名規則として C / M / T / V / S / A / X の接頭辞が定義されています。"
        },
        {
          "source": "AGENTS.md",
          "text": "業務サンプルとして配車管理、生産管理、資材在庫管理が明示されています。V系は DB VIEW ではなく Router 内の生 SQL。"
        }
      ],
      "short_narration": "C・M・T の接頭辞で役割を分け、配車・生産・在庫へ横展開できます。",
      "long_narration": "AiDiy の業務サンプルは、配車管理、生産管理、在庫管理など実務に近い内容で構成されています。テーブルには C、M、T、V、S、A、X の 7 種類の接頭辞があります。C は権限・利用者などの共通機能、M はマスタ、T はトランザクション、V は生 SQL による集計エンドポイント、S はスケジューラ、A は AI 系、X は実験系を表します。M 商品構成と T 生産は、明細 SEQ=0 をヘッダー、1 以上を明細行とする明細型パターンの実例です。V 系はデータベースの VIEW オブジェクトではなく、Router ファイルに直接書く生 SQL による JOIN エンドポイントです。この命名規則に沿えば、新機能を既存パターンへ横展開しやすくなっています。",
      "short_audio": "audio/short_scene_004.mp3",
      "long_audio": "audio/long_scene_004.mp3",
      "short_start_sec": 0.0,
      "short_duration_sec": 6.144,
      "long_start_sec": 0.0,
      "long_duration_sec": 49.872
    },
    {
      "id": "scene_005",
      "title": "AI コアとアバター",
      "expression": "neutral",
      "accent": "#7b8cff",
      "accent_soft": "rgba(123, 140, 255, 0.18)",
      "kicker": "AI CORE + AVATAR",
      "headline": "チャット・音声・画像・コード支援を\nアバター体験までつなぐ",
      "lead": "AiDiy の AI コアは多パネル UI で、frontend_avatar は Electron と Web の両方に対応します。",
      "subtitle": "AIコアの多パネル体験を、VRM アバターまで含めて運用できる。",
      "image": "images/scene_005.png",
      "image_prompt": "Vertical 2:3 interface illustration of AI core with chat panel, voice waveform, image panel, six code panels, and a realistic VRM style avatar beside them, dual mode idea of web and desktop Electron, blue-violet accent, professional Japanese software interface aesthetic",
      "chips": [
        "CHAT_AI_NAME",
        "LIVE_AI_NAME",
        "CODE_AI1〜6",
        "VRM / VRMA",
        "Electron / Web"
      ],
      "metrics": [
        {
          "label": "Code パネル",
          "value": "6"
        },
        {
          "label": "Code AI 候補",
          "value": "8"
        },
        {
          "label": "UI モード",
          "value": "2"
        }
      ],
      "cards": [
        {
          "title": "AIコア",
          "lines": [
            "テキスト・音声・画像・コード支援を統合",
            "CHAT_AI_NAME / LIVE_AI_NAME",
            "CODE_AI1_NAME 〜 CODE_AI6_NAME"
          ]
        },
        {
          "title": "Code AI 8種",
          "lines": [
            "claude_sdk / claude_cli",
            "copilot_cli / codex_cli",
            "antigravity_cli / grok_cli",
            "opencode_cli / aidiy_hermes"
          ]
        },
        {
          "title": "Avatar",
          "lines": [
            "Electron: 複数 BrowserWindow, localStorage",
            "Web: 左アバター + 右タブ, sessionStorage",
            "window.desktopApi で判定"
          ]
        },
        {
          "title": "3D / 同期",
          "lines": [
            "Three.js + @pixiv/three-vrm",
            "public/vrm/ と public/vrma/",
            "BroadcastChannel avatar-desktop-sync"
          ]
        }
      ],
      "facts": [
        "AIコアは WebSocket + マルチベンダー AI + Code CLI パネルを統合する多パネル UI。",
        "Code AI の有効値は claude_sdk / claude_cli / copilot_cli / codex_cli / antigravity_cli / grok_cli / opencode_cli / aidiy_hermes の 8 種。",
        "frontend_avatar は Electron デスクトップアプリと通常 Web ブラウザの両方で動作する。"
      ],
      "evidence": [
        {
          "source": "AGENTS.md",
          "text": "AIコアは、テキスト、音声、画像、ファイル、コード支援を統合する多パネル UI です。Code AI の有効値は claude_sdk〜aidiy_hermes の 8 種類を想定します。"
        },
        {
          "source": "frontend_avatar/AGENTS.md",
          "text": "frontend_avatar は Electron デスクトップアプリと通常 Web ブラウザの両方で動作します。Electron / Web 判定は window.desktopApi で行います。"
        }
      ],
      "short_narration": "AI コアは WebSocket で多パネルを統合し、VRM アバターが Electron と Web で動きます。",
      "long_narration": "AI コアはチャット、ライブ音声、画像処理、コード支援の 4 種類を WebSocket でつないだ多パネル UI です。Code AI パネルは code1 から code6 の 6 スロットに異なる CLI を割り当てられます。有効な Code AI は claude_sdk、claude_cli、copilot_cli、codex_cli、antigravity_cli、grok_cli、opencode_cli、そして aidiy_hermes の 8 種類です。frontend_avatar は Electron デスクトップと通常の Web ブラウザの両方で動作する AI アバタークライアントです。Three.js と @pixiv/three-vrm で VRM モデルを表示し、VRMA モーションで表情と動きを制御します。Electron と Web の状態は BroadcastChannel avatar-desktop-sync で同期します。",
      "short_audio": "audio/short_scene_005.mp3",
      "long_audio": "audio/long_scene_005.mp3",
      "short_start_sec": 0.0,
      "short_duration_sec": 6.816,
      "long_start_sec": 0.0,
      "long_duration_sec": 43.56
    },
    {
      "id": "scene_006",
      "title": "MCP TOOL HUB × 19 とビデオ自動生成",
      "expression": "neutral",
      "accent": "#00e0b8",
      "accent_soft": "rgba(0, 224, 184, 0.18)",
      "kicker": "MCP HUB + AUTO VIDEO",
      "headline": "19 個の MCP をひとつのポートに集約\nブラウザ操作から動画生成まで",
      "lead": "backend_tools は 19 個の MCP をひとつのポートに集約し、AI エージェントがブラウザ操作から動画生成まで担います。",
      "subtitle": "MCP は飾りではなく、AI の観測・生成・検証を支える実働ツール群。このビデオもその産物です。",
      "image": "images/scene_006.png",
      "image_prompt": "Vertical 2:3 MCP hub infographic poster, center AI agent node with fourteen connected utility nodes for browser, desktop, sqlite, postgres, logs, code check, backup, image generation, movie generation, speech-to-text, text-to-speech, OBS studio control, ffmpeg control, code agents, clean green-cyan enterprise network diagram on dark background, modern technical style, no mascots",
      "chips": [
        "port 8095",
        "19 MCP",
        "SSE / HTTP / stdio",
        "ビデオ自動生成",
        "9ステップ全自動"
      ],
      "metrics": [
        {
          "label": "MCP サーバー",
          "value": "19 個"
        },
        {
          "label": "ポート",
          "value": "8095 に集約"
        },
        {
          "label": "トランスポート",
          "value": "SSE / HTTP / stdio"
        }
      ],
      "cards": [
        {
          "title": "観測",
          "lines": [
            "aidiy_chrome_devtools (CDP)",
            "aidiy_desktop_capture",
            "aidiy_sqlite / aidiy_postgres / aidiy_logs"
          ]
        },
        {
          "title": "検証・保全",
          "lines": [
            "aidiy_code_check",
            "aidiy_backup (save / check)"
          ]
        },
        {
          "title": "生成・制御",
          "lines": [
            "aidiy_image_generation / aidiy_movie_generation",
            "aidiy_speech_to_text / aidiy_text_to_speech",
            "aidiy_obs_studio_control / aidiy_ffmpeg_control",
            "aidiy_windows_control / aidiy_notification_sounds"
          ]
        },
        {
          "title": "ビデオ自動生成",
          "lines": [
            "topic → scenario.js 生成",
            "画像生成 → 音声合成 → HTML 組み立て",
            "Step00 から Step99 まで MCP + CodeAgents が全自動化"
          ]
        },
        {
          "title": "AI 連携",
          "lines": [
            "aidiy_code_agents (Code CLI 実行)",
            "aidiy_chat_llms (チャット LLM)",
            "aidiy_task_agents / aidiy_team_agents"
          ]
        }
      ],
      "facts": [
        "backend_tools は 19 個の MCP サーバーを SSE / Streamable HTTP / stdio の 3 トランスポートで同一ポート 8095 に集約する。",
        "ビデオページ生成は 2 スクリプト（ひとりアバター用 / 二人掛け合い用）で topic から HTML まで 9 ステップを全自動化する。",
        "知識の整理は _AIDIY/knowledge/_index.md が全 HowTo の入口。"
      ],
      "evidence": [
        {
          "source": "AGENTS.md",
          "text": "backend_tools は 19 個の MCP サーバーを SSE / Streamable HTTP / stdio の 3 トランスポートで同一ポート 8095 に集約します。"
        },
        {
          "source": "AGENTS.md",
          "text": "ビデオページ生成自動化: topic から scenario.js 生成→画像生成→音声合成→HTML 組み立てまでを 9 ステップで全自動化。"
        }
      ],
      "short_narration": "19 個の MCP がひとつのポートに集まり、この動画も AiDiy 自身が自動生成しています。",
      "long_narration": "backend_tools は 8095 番ポートに 19 個の MCP サーバーを同居させた TOOL HUB です。ブラウザ自動操作、デスクトップキャプチャ、SQLite・PostgreSQL のデータ参照、ログ監視、コードチェック、バックアップ、画像生成、動画生成、音声認識、音声合成、OBS Studio 制御、FFmpeg 制御、コードエージェント実行まで揃っています。SSE・Streamable HTTP・stdio の 3 トランスポートを同一ポートで提供し、HTTP POST でどこからでも呼び出せます。そして今見ているこのビデオ自体が AiDiy のビデオページ生成機能で自動生成されています。シナリオ作成から画像生成、音声合成、HTML 組み立てまで 9 ステップを MCP と CodeAgents が全自動で処理しました。",
      "short_audio": "audio/short_scene_006.mp3",
      "long_audio": "audio/long_scene_006.mp3",
      "short_start_sec": 0.0,
      "short_duration_sec": 5.064,
      "long_start_sec": 0.0,
      "long_duration_sec": 46.8
    },
    {
      "id": "scene_007",
      "title": "AIタスクと AIチーム",
      "expression": "neutral",
      "accent": "#7dffb3",
      "accent_soft": "rgba(125, 255, 179, 0.18)",
      "kicker": "AI TASK + AI TEAM",
      "headline": "日本語で書くだけで手順に分けて自動実行\n3D 空間では AI 要員がチームで動く",
      "lead": "AIタスクは、日本語で書いた要求を AI が実行明細へ分解し、依存関係を判断しながら自動実行します。定時実行に登録すれば人が居なくても動き続けます。AIチームは AI の要員が 3D 空間に集まり、相談しながら仕事を分担し、やった経験を次に活かします。",
      "subtitle": "要求を書く → AI が手順に分ける → 順番と並行を判断して実行 → 決めた時刻に自分から動く。",
      "image": "images/scene_007.png",
      "image_prompt": "Vertical 2:3 concept poster split into two halves: the upper half shows an automated task flow with branching nodes and a clock icon indicating scheduled execution, the lower half shows several gentle glowing AI companions gathered in a park-like 3D space exchanging speech bubbles. Dark background, cyan and green glow, modern technical illustration, no text baked into the image.",
      "chips": [
        "要求を日本語で書く",
        "AI が明細へ分解",
        "先行SEQ による並行実行",
        "定時実行",
        "AI 要員が相談"
      ],
      "metrics": [
        {
          "label": "担当サーバー",
          "value": "backend_taskteam:8093"
        },
        {
          "label": "API",
          "value": "/task/* と /team/*"
        },
        {
          "label": "実行区分",
          "value": "即時 / 時間指定 / 間隔 / 定時"
        }
      ],
      "cards": [
        {
          "title": "AIタスク",
          "lines": [
            "日本語の要求を AI が実行明細へ分解",
            "先行SEQ による DAG で順番と並行を判断",
            "即時・時間指定・間隔・定時実行から選べる"
          ]
        },
        {
          "title": "AIチーム",
          "lines": [
            "歴史上の人物から AI 要員を召喚",
            "3D 空間で相談し、チーム作業を決める",
            "PlanDo / SPDCA の作業ループで進める"
          ]
        },
        {
          "title": "任せられる仕組み",
          "lines": [
            "開始時に差分バックアップを自動取得",
            "操作検証つき明細は 1 回だけ自動リトライ",
            "完了タスクは経験として次の担当選びに活きる"
          ]
        }
      ],
      "facts": [
        "AIタスク・AIチームは backend_taskteam（ポート 8093）が担当し、API は /task/* と /team/*。",
        "明細の依存は先行SEQ（カンマ区切りで複数指定可）による DAG で、依存を満たした明細は並行起動する。",
        "実行区分は即時 / 時間指定 / 間隔実行 / 定時実行の 4 種。実行条件にフォルダ変化も選べる。",
        "Aチーム依頼は有効要員の経験を材料に AI が担当を選び、完了後に経験を生成して次へ再利用する。"
      ],
      "evidence": [
        {
          "source": "AGENTS.md",
          "text": "Backend TaskTeam: AIタスク実行 + 定期タスクと複数AIエージェントのチーム活動を統合したサーバー（ポート 8093）。"
        },
        {
          "source": "backend_taskteam/AGENTS.md",
          "text": "有効要員一覧と要員ごとの Aチーム経験を材料に、AI へ担当要員を選ばせる。経験のある要員へ寄せることで蓄積ナレッジが再利用される。"
        }
      ],
      "short_narration": "AIタスクは日本語の要求を手順に分けて自動実行。AIチームでは AI 要員が相談しながら仕事を分担します。",
      "long_narration": "AiDiy には、AI に仕事そのものを任せる仕組みがふたつあります。ひとつめが AIタスクです。やってほしいことを日本語で書くと、AI がその中身を読んで実行明細へ分解します。明細には先行SEQ で依存関係を持たせられるので、順番に進めるものと同時に進められるものを判断しながら実行します。実行の開始条件は 4 種類。すぐ動かす即時、日時を決める時間指定、分や時の単位でくり返す間隔実行、そして毎日・毎週・毎月の決まった時刻に動く定時実行です。監視フォルダの変化をきっかけにすることもできます。ふたつめが AIチームです。歴史上の人物をもとにした AI 要員を召喚してチームを作り、3D の空間に集まった要員が相談しながら、今やるべきことを決めていきます。依頼を出すと、これまでの経験をもとに AI が担当者を選び、そのまま AIタスクとして実行されます。終わった仕事は経験として蓄積され、次の担当選びに活きていきます。どちらも backend_taskteam が担当し、業務データと同じ SQLite を共有しています。",
      "short_audio": "audio/short_scene_007.mp3",
      "long_audio": "audio/long_scene_007.mp3",
      "short_start_sec": 0.0,
      "short_duration_sec": 8.112,
      "long_start_sec": 0.0,
      "long_duration_sec": 61.128
    },
    {
      "id": "scene_999",
      "title": "ご視聴ありがとうございました",
      "expression": "neutral",
      "accent": "#c49bff",
      "accent_soft": "rgba(196, 155, 255, 0.2)",
      "layout": "hero",
      "hero_image_focus": true,
      "background_word": "",
      "kicker": "THANK YOU",
      "headline": "ご視聴ありがとうございました。\nあなたなら AiDiy でなにを創りますか？",
      "lead": "日本語ファースト設計と AI・MCP 実験基盤が一体になった AiDiy を、ぜひ手元で動かしてみてください。",
      "subtitle": "チャンネル登録で応援してください。あなたの挑戦が AiDiy をさらに進化させます。",
      "image": "images/scene_999.png",
      "chips": [],
      "metrics": [],
      "cards": [],
      "facts": [],
      "evidence": [],
      "image_prompt": "Square 1:1 ending visual for AiDiy. Beautiful typography centered on 'Thank you for Watching', refined luxury tech style, dark blue gradient background, subtle violet glow, clean centered layout, premium and readable, no extra UI elements, no character, no clutter. Polished square closing card suitable for a product introduction ending.",
      "short_narration": "ご視聴ありがとうございました。チャンネル登録もぜひ。AiDiy でなにを創りますか？",
      "long_narration": "ご視聴ありがとうございました。この動画は AiDiy 自身のビデオページ生成機能で自動生成されました。シナリオ作成・画像生成・音声合成・HTML 組み立てを、すべて MCP と CodeAgents が担当しています。AiDiy には日本語ファースト設計、7 つのサービス、豊富な業務サンプル、AI コア、19 個の MCP ツール、そして自動ビデオ生成まで、いますぐ動かせる部品がそろっています。気に入っていただけたら、チャンネル登録でぜひ応援してください。次の動画でまた会いましょう！日本語ファースト設計と AI の組み合わせが気になった方は、ぜひ AiDiy を手元で動かしてみてください。あなたならこのテンプレートで、どんな業務システムや AI 実験を作りますか？",
      "short_audio": "audio/short_scene_999.mp3",
      "long_audio": "audio/long_scene_999.mp3",
      "short_start_sec": 0.0,
      "short_duration_sec": 4.872,
      "long_start_sec": 0.0,
      "long_duration_sec": 41.088
    }
  ],
  "total_short_duration_sec": 57.864,
  "total_long_duration_sec": 418.176
};
