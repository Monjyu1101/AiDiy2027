window.SCENARIO = {
  "project_name": "AiDiy解説__all_ja",
  "version": "duo-v2",
  "title": "AiDiy 全体解説 — 日本語ファーストのフルスタック業務管理テンプレートと AI 自動化基盤",
  "assets_policy": {
    "male_avatar": "../_vrm/VRM_male.vrm",
    "female_avatar": "../_vrm/VRM_female.vrm",
    "tts_male": "edge:male",
    "tts_female": "edge:female",
    "audio_output_dir": "frontend_web/public/Xビデオ/AiDiy解説__all_ja/audio"
  },
  "scenes": [
    {
      "id": "scene_000",
      "title": "イントロ — AiDiy の全体像",
      "accent": "#1a6ea0",
      "accent_soft": "rgba(26, 110, 160, 0.18)",
      "layout": "hero",
      "kicker": "AIDIY ALL-IN-ONE",
      "headline": "日本語ファーストの\nフルスタック業務管理テンプレート AiDiy",
      "lead": "FastAPI + Vue 3 + AI コア + TOOL HUB を組み合わせた、日本語圏の開発者向けフルスタック開発環境です。",
      "image": "images/scene_000.png",
      "source_summary": "AiDiy は日本語ファーストのフルスタック業務管理テンプレート。7 サービス構成（backend_server 2 本/backend_tools/backend_taskteam/backend_local/frontend_web/frontend_avatar）で業務管理・AI コア・TOOL HUB・3D アバターを統合。この動画は ビデオページ生成機能で自動生成。",
      "factual_bullets": [
        "FastAPI + SQLAlchemy + SQLite (Python 3.13) + Vue 3 + Vite + TypeScript の構成",
        "7 サービス: backend_server (8091/8098), backend_tools (8095), backend_taskteam (8093), backend_local (8096), frontend_web (8090), frontend_avatar (8092)",
        "日本語ファースト設計: テーブル名・API パス・変数名すべて日本語",
        "業務サンプル（C/M/T/V/S系）・AI コア・19 MCP・Electron アバター を統合",
        "この動画は AiDiy のビデオページ生成機能で自動生成"
      ],
      "forbidden_elements": [
        "AiDiy が商用製品として公式リリースされているかのような断言",
        "具体的な料金や SLA の断定"
      ],
      "image_prompt": "A futuristic control center dashboard showing AiDiy's full-stack architecture: five service blocks (backend_server, backend_tools, frontend_web, frontend_avatar, and hermes CLI) connected by glowing lines, Japanese labels on all components, clean blue tech aesthetic on dark background with subtle circuit patterns.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AiDiy は AI + Do It Yourself をコンセプトにした日本語ファーストの開発テンプレートです。",
          "naration_text": "こんにちは。今回の動画では、日本語ファーストのフルスタック業務管理テンプレート「AiDiy」の全体像をお届けします。AiDiy という名前には、AI と Do It Yourself、つまり AI の力を借りながら、自分たちの業務システムや自動化ツールを自分たちで作っていく、というコンセプトを込めています。FastAPI と Vue 3 を中心に、AI 機能やマルチモーダルな自動化ツールを組み込んだ、日本語ネイティブな開発環境です。テーブル名からコード変数まですべてを日本語で統一するユニークな設計が、業務ドメインとコードの対応を直感的にしてくれます。なお、この動画は AiDiy のビデオページ生成機能によって自動生成されました。シナリオ作成・画像生成・音声合成のすべてを AiDiy 自身が担当しています。",
          "audio": "audio/dlg_000_01_female.mp3",
          "duration_sec": 49.368
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "AiDiy は 7 つのサービスで構成されるフルスタック開発環境です。",
          "naration_text": "AiDiy は backend_server が 2 本、MCP ハブの backend_tools、AIタスクと AIチームを動かす backend_taskteam、ローカル推論の backend_local、そして frontend_web と frontend_avatar という 7 つのサービスが連携して動くフルスタックなシステムです。バックエンドは FastAPI と SQLAlchemy と SQLite を組み合わせ、Python 3.13 の最新環境で動かします。フロントエンドは Vue 3 と Vite と TypeScript で構成された Web UI と、Electron 対応の 3D アバター UI が揃っています。開発テンプレートとしても、AI 実験の基盤としても幅広く使えます。",
          "audio": "audio/dlg_000_02_male.mp3",
          "duration_sec": 35.304
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "配車管理・生産管理・在庫管理などの業務サンプルが初めから組み込まれています。",
          "naration_text": "AiDiy には業務システムのサンプルが最初から揃っています。配車管理や生産管理、資材在庫管理など、実際の業務に近い形のサンプルデータと画面が用意されているので、テンプレートを元にすぐ開発を始められます。マスタ管理からトランザクション管理、集計表示、スケジューラまで、業務アプリに必要な要素がひととおり揃っているのが AiDiy の強みです。",
          "audio": "audio/dlg_000_03_female.mp3",
          "duration_sec": 24.264
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "AI コアや TOOL HUB など、AI と自動化の最前線も組み込まれています。",
          "naration_text": "業務サンプルだけでなく、AI 機能も充実しています。テキスト対話、音声認識、画像生成、コードエージェントをひとつの画面で使える AI コアパネルと、ブラウザ操作から OBS 録画制御まで 19 の機能を HTTP API で提供する AiDiy TOOL HUB が組み込まれています。業務管理と AI 自動化を組み合わせた、日本語圏の開発者向けの実用的な出発点を目指しています。",
          "audio": "audio/dlg_000_04_male.mp3",
          "duration_sec": 24.096
        }
      ],
      "duration_sec": 133.032
    },
    {
      "id": "scene_001",
      "title": "フルスタック構成 — 7 サービスとポート配置",
      "accent": "#2e86ab",
      "accent_soft": "rgba(46, 134, 171, 0.18)",
      "kicker": "ARCHITECTURE",
      "headline": "7 サービスが連携する\nフルスタック構成",
      "lead": "backend_server 2 本、MCP ハブ、AIタスクと AIチームの実行基盤、ローカル推論、frontend 2 種。7 つのサービスが 1 つの SQLite を共有します。",
      "image": "images/scene_001.png",
      "source_summary": "AiDiy の 7 サービス構成: backend_server (core_main 8091 / apps_main 8098)、backend_tools (8095)、frontend_web (8090)、frontend_avatar (8092)。FastAPI + SQLAlchemy + SQLite + Vue 3 + Vite + TypeScript の技術スタック。",
      "factual_bullets": [
        "core_main.py (8091): 認証・C系・A系・AI コア WebSocket",
        "apps_main.py (8098): M系マスタ・T系トランザクション・V系・S系スケジューラ",
        "tools_main.py (8095): 19 MCP サーバーを 3 トランスポートで提供",
        "frontend_web (8090): Vue 3 + Vite、Vite proxy で /core → 8091, /apps → 8098",
        "frontend_avatar (8092): Electron/Web デュアルモード、Three.js + VRM",
        "taskteam_main.py (8093): AIタスクの明細実行と AIチームの依頼・経験を担当",
        "backend_local (8096): OpenAI 互換の Gemma ローカル推論サーバー"
      ],
      "forbidden_elements": [
        "ポート番号が変更不可であるかのような断言",
        "SQLite の性能限界についての誇張"
      ],
      "image_prompt": "A clean architectural diagram of AiDiy's five services: four rectangular service blocks (backend_server with two sub-blocks at ports 8091/8098, backend_tools at 8095, frontend_web at 8090, frontend_avatar at 8092) connected by arrows showing API proxy and WebSocket flows. Blue tech color scheme, port numbers prominently labeled, dark background.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "backend_server は FastAPI + SQLAlchemy + SQLite で動くバックエンドです。",
          "naration_text": "AiDiy のバックエンドは backend_server として FastAPI と SQLAlchemy と SQLite を組み合わせて構築されています。2 本の uvicorn プロセスに分かれており、認証・利用者・AI コアを担う core_main.py がポート 8091 で動き、マスタ・トランザクション・スケジューラを担う apps_main.py がポート 8098 で動きます。両サーバーは同じ SQLite データベースファイルを共有しているため、データの一貫性を保ちながら役割ごとに分離できています。",
          "audio": "audio/dlg_001_01_female.mp3",
          "duration_sec": 32.688
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "frontend_web は Vue 3 + Vite + TypeScript で作られた Web UI です。",
          "naration_text": "フロントエンドは frontend_web として Vue 3 と Vite と TypeScript で構成されています。ポート 8090 で動き、Vite の開発用プロキシが /core/* のリクエストをポート 8091 に、/apps/* のリクエストをポート 8098 に転送します。Vue Router と Pinia によるルーティングと状態管理、qTubler という独自テーブルコンポーネントを使ったリッチな業務 UI が特徴です。WebSocket 通信も内蔵しており、AI コアとのリアルタイム対話ができます。",
          "audio": "audio/dlg_001_02_male.mp3",
          "duration_sec": 27.696
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AIタスクとチームを動かす backend_taskteam が 8093、ローカル推論の backend_local が 8096 です。",
          "naration_text": "バックエンドは backend_server の 2 本だけではありません。ポート 8093 の backend_taskteam は、AIタスクの明細実行と、AIチームの依頼・経験の管理をまとめて担当します。ポート 8096 の backend_local は、OpenAI 互換のインターフェースを持つ Gemma のローカル推論サーバーです。さらにポート 8095 の backend_tools が MCP ハブとして動きます。フロントエンドは 8090 の frontend_web と 8092 の frontend_avatar。合わせて 7 つのサービスが、_data/AiDiy/database.db という 1 つの SQLite を共有しています。業務データと AI の実行履歴が同じ場所にあるので、AIタスクの進捗を業務画面から追うこともできます。",
          "audio": "audio/dlg_001_03_female.mp3",
          "duration_sec": 47.544
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "backend_tools は 19 の MCP サーバーをポート 8095 に集約した TOOL HUB です。",
          "naration_text": "backend_tools はポート 8095 で動く AiDiy TOOL HUB です。ブラウザ操作、スクリーンショット、SQLite や PostgreSQL への接続、ログ確認、コードチェック、バックアップ、画像・動画・音声の AI 生成、OBS 録画制御、FFmpeg 動画処理、コードエージェント実行という 19 の MCP サーバーが集約されています。SSE、Streamable HTTP、stdio の 3 つのトランスポートに加えて、HTTP POST で直接呼び出せるため、Python スクリプトや AI エージェントからシンプルに利用できます。",
          "audio": "audio/dlg_001_04_male.mp3",
          "duration_sec": 31.416
        }
      ],
      "duration_sec": 139.344
    },
    {
      "id": "scene_002",
      "title": "日本語ファースト設計 — コードのすべてを日本語で統一",
      "accent": "#e84855",
      "accent_soft": "rgba(232, 72, 85, 0.18)",
      "kicker": "JAPANESE FIRST",
      "headline": "テーブル名・API パス・変数名\nすべてを日本語で統一",
      "lead": "AiDiy の最大の特徴。業務ドメインとコードが直接対応するため、仕様とコードのズレが起きにくくなります。",
      "image": "images/scene_002.png",
      "source_summary": "AiDiy の日本語ファースト設計: DB テーブル名・カラム名・FastAPI パス・JSON キー・Vueファイル名・Router パス・Python変数名をすべて日本語で統一。request/query/items などシステム語と英字ライブラリ名のみ英字可。",
      "factual_bullets": [
        "テーブル名: C権限, T配車, M商品",
        "API パス: /core/利用者/一覧, /apps/配車/検索",
        "JSON キー: {利用者名: admin, 配車日付: ...}",
        "Vue ファイル名: C利用者一覧.vue, T配車登録.vue",
        "Python 変数名: 利用者名, 配車日付, 商品名"
      ],
      "forbidden_elements": [
        "日本語識別子がパフォーマンス上問題になるという誇張",
        "すべての言語・フレームワークで日本語識別子を推奨するかのような断言"
      ],
      "image_prompt": "A split code editor view showing Japanese identifiers: left side shows FastAPI route definitions with Japanese paths like /apps/配車/検索, right side shows SQLAlchemy model with Japanese column names like 利用者ID and 配車日付. Red accent highlighting Japanese text, clean dark code editor theme.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "テーブル名・カラム名・API パス・JSON キー、すべてを日本語で統一するのが AiDiy の特徴です。",
          "naration_text": "AiDiy の最大の特徴のひとつが、コードのあらゆる場所で日本語識別子を使う「日本語ファースト設計」です。データベースのテーブル名やカラム名、FastAPI の API パス、レスポンスの JSON キー、Vue のファイル名、Router のパス、Python の変数名まで、すべて日本語で統一しています。英語への翻訳を介さずに、業務ドメインとコードが直接対応するため、仕様書とコードのズレが起きにくくなります。",
          "audio": "audio/dlg_002_01_female.mp3",
          "duration_sec": 28.056
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "テーブル名は C権限・T配車、API パスは /apps/配車/検索 といった形です。",
          "naration_text": "具体的には、テーブル名は C権限、C利用者、M商品、T配車といった形で、接頭辞と日本語の組み合わせで命名します。API パスも /core/利用者/一覧 や /apps/配車/検索 のように日本語を直接使います。JSON レスポンスのキーも { 利用者名: admin } のように日本語で返します。ファイル名は C利用者一覧.vue、Vue Router のパスは /C管理/C利用者/一覧 という形です。Python 変数名も 利用者名 や 配車日付 のように日本語です。",
          "audio": "audio/dlg_002_02_male.mp3",
          "duration_sec": 32.376
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "request・query・items などのシステム語と英字ライブラリ名のみ英字を使います。",
          "naration_text": "ただし、すべてを日本語にするわけではありません。request、query、items、total、limit といったシステム汎用語は英字のままにして、FastAPI や SQLAlchemy など英字ライブラリの命名規則とぶつからないようにしています。また英字ライブラリのクラス名や関数名もそのまま使います。日本語と英字の混在ルールを最初に決めておくことで、コード全体の一貫性が保たれています。",
          "audio": "audio/dlg_002_03_female.mp3",
          "duration_sec": 27.792
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "UTF-8 固定で Python も JavaScript も日本語識別子が使えます。",
          "naration_text": "AiDiy では文字コードを UTF-8 で固定しており、Python の変数名やクラス名に日本語を使うこともできます。FastAPI のルーターやモデル、SQLAlchemy のカラム定義、Vue のコンポーネント名まで、一貫して日本語識別子を使えます。現代のプログラミング言語とエディタは Unicode に対応しているので、日本語変数名を使っても開発上の支障はほとんどありません。日本語圏の開発者がコードを読んだとき、その意味が瞬時にわかる読みやすさが生まれます。",
          "audio": "audio/dlg_002_04_male.mp3",
          "duration_sec": 28.032
        }
      ],
      "duration_sec": 116.256
    },
    {
      "id": "scene_003",
      "title": "業務サンプル — C/M/T/V/S 系の実践的な業務管理",
      "accent": "#34a853",
      "accent_soft": "rgba(52, 168, 83, 0.18)",
      "kicker": "BUSINESS SAMPLES",
      "headline": "配車管理・生産管理・在庫管理\nC/M/T/V/S 系の業務サンプル",
      "lead": "実際の業務に近い構成でマスタ・トランザクション・集計・スケジューラが揃っています。",
      "image": "images/scene_003.png",
      "source_summary": "AiDiy 業務サンプル構成: C系(C権限/C利用者/C採番)、M系(M車両/M商品/M取引先/M商品構成等)、T系(T配車/T生産/T商品入庫/出庫/棚卸)、V系(V商品推移表 生SQL)、S系(S配車/S生産 週表示/日表示)。明細型パターン(明細SEQ=0がヘッダー)。",
      "factual_bullets": [
        "C系: C権限・C利用者(JWT認証)・C採番(カスタムID生成)",
        "M系: M車両・M配車区分・M商品・M取引先・M商品構成・M生産区分・M生産工程",
        "T系: T配車・T生産・T商品入庫・T商品出庫・T商品棚卸",
        "V系: V商品推移表 (生SQL JOIN/集計、DB VIEW は使わない)",
        "S系: S配車_週表示/日表示・S生産_週表示/日表示"
      ],
      "forbidden_elements": [
        "AiDiy が特定業種の本番システムとして使えると断言すること",
        "業務サンプルの数や規模を誇張すること"
      ],
      "image_prompt": "A business dashboard with five colored sections: C-system (gray, users and permissions), M-system (green, master data cards with 商品/取引先/車両), T-system (blue, transaction records with dates), V-system (teal, aggregate chart showing inventory trend), S-system (orange, weekly/daily calendar scheduler grid). Clean flat business UI style on light background.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "業務サンプルは C・M・T・V・S の 5 つの系統に分類されています。",
          "naration_text": "AiDiy には実用的な業務管理のサンプルが組み込まれています。テーブルと機能は C系、M系、T系、V系、S系という 5 つの接頭辞で分類されます。C系はシステムのコア機能、M系はマスタデータ、T系はトランザクション、V系は集計・ビュー用エンドポイント、S系はスケジューラ表示という役割を担っています。この分類により、どのコードがどの役割を持つかが一目でわかる構造になっています。",
          "audio": "audio/dlg_003_01_female.mp3",
          "duration_sec": 29.256
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "C系は権限・利用者・採番の 3 テーブルでシステムの基盤を担います。",
          "naration_text": "C系にはシステムの基盤となる 3 つのテーブルがあります。C権限は権限マスタ、C利用者は JWT 認証付きの利用者マスタ、C採番はカスタム ID 生成を管理します。C利用者はログイン認証とトークン発行を担い、すべての API リクエストはここで認証を受けます。C採番は AUTOINCREMENT に依存せず、業務に合わせたプレフィックス付き ID を採番できるので、入庫伝票番号や配車 ID など業務的な意味を持つ ID を発行できます。",
          "audio": "audio/dlg_003_02_male.mp3",
          "duration_sec": 28.704
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "M系は商品・取引先・車両などのマスタ、T系は配車・生産・在庫のトランザクションです。",
          "naration_text": "M系マスタには、車両、配車区分、商品、取引先、商品構成、生産区分、生産工程があります。特に M商品構成は、明細SEQ が 0 の行をヘッダー、SEQ が 1 以降の行を材料明細として 1 テーブルで管理する明細型パターンを使っています。T系トランザクションには配車、入庫、出庫、棚卸、生産、生産払出があり、実際の業務フローに近いデータ構造を持っています。",
          "audio": "audio/dlg_003_03_female.mp3",
          "duration_sec": 29.904
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "V系は生 SQL で集計、S系はスケジューラの週表示・日表示を提供します。",
          "naration_text": "V系は DB VIEW を作らず、Router 内に生の SQL を書いて JOIN や集計を行うエンドポイントです。例えば V商品推移表は、期間を指定して入庫・出庫・棚卸の推移を集計して返します。S系はスケジューラの表示を担い、配車の週表示・日表示、生産の週表示・日表示という、カレンダー型のビジュアル表示に特化したエンドポイントを提供します。この設計によって、複雑な集計表示も柔軟に対応できます。",
          "audio": "audio/dlg_003_04_male.mp3",
          "duration_sec": 27.624
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "業務サンプルは配車管理・生産管理・資材在庫管理の 3 つを軸に構成されています。",
          "naration_text": "AiDiy のメイン業務サンプルは 3 つあります。配車管理は M配車区分・M車両・T配車・V配車・S配車の週表示/日表示で構成されます。生産管理は M生産区分・M生産工程・M商品・M商品構成・T生産・V生産・S生産の週表示/日表示で構成されます。資材在庫管理は M商品を中心に T商品入庫・T商品出庫・T商品棚卸と V商品推移表で、在庫の動きと残高を可視化します。どれも実際の業務に近いデータ構造を持つ実践的なサンプルです。",
          "audio": "audio/dlg_003_05_female.mp3",
          "duration_sec": 38.448
        }
      ],
      "duration_sec": 153.936
    },
    {
      "id": "scene_004",
      "title": "AI コア — マルチ AI 対話と Code AI 6 パネル",
      "accent": "#8a4fff",
      "accent_soft": "rgba(138, 79, 255, 0.18)",
      "kicker": "AI CORE",
      "headline": "テキスト・音声・画像・コード\nマルチ AI 対話を 1 画面で",
      "lead": "WebSocket ストリーミングでリアルタイムに複数の AI を使い分けられる多パネル UI です。",
      "image": "images/scene_004.png",
      "source_summary": "AiDiy AI コア: CHAT_AI_NAME(テキスト対話)・LIVE_AI_NAME(音声リアルタイム)・CODE_AI1〜6(コードエージェント 6パネル)。WebSocket ストリーミング。Code AI 8 種: claude_sdk/claude_cli/copilot_cli/codex_cli/antigravity_cli/grok_cli/opencode_cli/aidiy_hermes。A会話履歴に保存。",
      "factual_bullets": [
        "CHAT_AI_NAME: Claude/GPT/Gemini などのテキストチャット、WebSocket ストリーミング",
        "LIVE_AI_NAME: 音声リアルタイム対話、マイク入力→AI→音声出力",
        "CODE_AI1〜6: 6 パネルに claude_sdk/claude_cli/copilot_cli/codex_cli/antigravity_cli/grok_cli/opencode_cli/aidiy_hermes の 8 種から設定可能",
        "aidiy_hermes: 独自 Python エンジン、TUI、プロバイダ切り替え、subprocess 統合",
        "会話履歴は A会話履歴テーブルに保存"
      ],
      "forbidden_elements": [
        "特定 AI モデルの性能を断言すること",
        "Code AI が常に正確なコードを生成すると断言すること"
      ],
      "image_prompt": "A multi-panel AI interface showing: left panel with text chat bubbles between human and AI, center panel with a microphone and audio waveform for voice interaction, right side showing 6 numbered code agent panels (code1-code6) each with different AI logos (Claude, Copilot, Codex). Purple accent color scheme, dark background, modern tech UI.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AI コアはマルチ AI 対話・音声・画像・コードエージェントを 1 つの画面で提供します。",
          "naration_text": "AI コアは、複数の AI 機能を多パネル UI で統合した AiDiy の AI ハブです。テキストチャット、音声によるリアルタイム対話、画像生成、コードエージェントの 4 種類の AI 機能を、WebSocket によるストリーミング通信でリアルタイムに利用できます。Claude、GPT、Gemini などのマルチベンダー AI に対応しており、設定ファイルで使う AI を切り替えられます。ブラウザだけで AI の可能性をまとめて試せる入口です。",
          "audio": "audio/dlg_004_01_female.mp3",
          "duration_sec": 29.256
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "テキストチャットと音声リアルタイム対話は WebSocket ストリーミングで動きます。",
          "naration_text": "AI コアのテキストチャットは CHAT_AI_NAME で指定した AI と対話します。LIVE_AI_NAME で指定した AI は音声のリアルタイム対話に使われます。どちらも WebSocket でバックエンドと常時接続し、応答をストリーミングで受け取るため、タイムラグを感じにくいスムーズな対話ができます。会話履歴は A会話履歴テーブルに保存されるので、セッションをまたいで会話の流れを振り返ることもできます。",
          "audio": "audio/dlg_004_02_male.mp3",
          "duration_sec": 23.976
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Code AI パネルは 6 つあり、複数の AI コード CLI を同時に走らせることができます。",
          "naration_text": "AI コアには code1 から code6 まで 6 枚のコードエージェントパネルがあります。各パネルに claude_sdk、claude_cli、copilot_cli、codex_cli、antigravity_cli、grok_cli、opencode_cli、aidiy_hermes の 8 種類から AI コード CLI を割り当てて、同時並行で動かすことができます。aidiy_hermes は AiDiy 独自の Python エンジンで、TUI インターフェース、プロバイダ切り替え、subprocess 統合を提供します。複数の AI を並べてコーディングの品質を比較したり、大きなタスクを分割して担当させたりできます。",
          "audio": "audio/dlg_004_03_female.mp3",
          "duration_sec": 36.504
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "画像生成パネルでは OpenAI・Gemini などのマルチベンダー AI で画像を生成できます。",
          "naration_text": "AI コアには画像生成パネルも組み込まれています。OpenAI の gpt-image-2.5 や DALL-E 3、Google Gemini など、複数の画像生成 AI をプロバイダとして選択して利用できます。テキストプロンプトを入力するだけで対応する AI が画像を生成して表示してくれます。また AiDiy TOOL HUB の aidiy_image_generation MCP とも連携できるため、自動化パイプラインへの組み込みも可能です。",
          "audio": "audio/dlg_004_04_male.mp3",
          "duration_sec": 23.976
        }
      ],
      "duration_sec": 113.712
    },
    {
      "id": "scene_005",
      "title": "frontend_avatar — Electron と VRM アバター",
      "accent": "#f7931e",
      "accent_soft": "rgba(247, 147, 30, 0.18)",
      "kicker": "AVATAR UI",
      "headline": "Electron/Web デュアルモード\nThree.js + VRM の 3D アバター",
      "lead": "デスクトップアプリと Web ブラウザを同じコードで実現。AI 音声に連動して VRM アバターが口パクします。",
      "image": "images/scene_005.png",
      "source_summary": "frontend_avatar の Electron/Web デュアルモード実装。window.desktopApi で判定。Three.js + @pixiv/three-vrm で VRM 描画、@pixiv/three-vrm-animation で VRMA モーション。AnalyserNode で口パク。BroadcastChannel avatar-desktop-sync で複数ウィンドウ同期。",
      "factual_bullets": [
        "window.desktopApi あり→Electron モード、なし→Web モード",
        "Three.js + @pixiv/three-vrm で VRM モデルを描画",
        "@pixiv/three-vrm-animation で VRMA 形式のモーションを再生",
        "AnalyserNode で音量解析→aa 表情で口パクを実現",
        "BroadcastChannel (avatar-desktop-sync) で複数ウィンドウ間の状態を同期"
      ],
      "forbidden_elements": [
        "すべての VRM モデルが完全対応すると断言すること",
        "Electron と Web で完全に同一の動作になると断言すること"
      ],
      "image_prompt": "A 3D avatar interface showing two VRM character models: a female avatar on the right side and a male avatar on the left side, both facing slightly inward. Background is dark with subtle transparency effect. Three.js rendering with soft lighting, modern Electron/Web app frame around them. Orange accent, anime-style VRM models.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "frontend_avatar は Electron デスクトップアプリと Web ブラウザ両対応の AI アバター UI です。",
          "naration_text": "frontend_avatar は、Electron デスクトップアプリと通常のブラウザの両方で動く AI アバター UI です。ポート 8092 にアクセスし、window.desktopApi が存在する場合は Electron モード、存在しない場合は Web ブラウザモードとして動作します。Electron モードでは複数のウィンドウを使ったリッチなデスクトップ体験が、Web モードでは左アバターと右タブ UI を組み合わせた画面が使えます。",
          "audio": "audio/dlg_005_01_female.mp3",
          "duration_sec": 26.832
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Three.js と @pixiv/three-vrm で VRM アバターを表示し、AI 音声に合わせて口パクします。",
          "naration_text": "3D アバターは Three.js と @pixiv/three-vrm を使って描画されています。VRM 形式のキャラクターモデルを読み込み、@pixiv/three-vrm-animation で VRMA 形式のモーションを再生することもできます。AI が音声を話しているとき、AnalyserNode でマイクレベルを解析して aa 表情を適用することで口パクを実現しています。背景が透過できるため、Electron の透明フレームレスウィンドウと重ねてデスクトップ上に常駐させることもできます。",
          "audio": "audio/dlg_005_02_male.mp3",
          "duration_sec": 29.184
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AI との音声対話がアバターの動きと連動し、デスクトップに常駐して対話できます。",
          "naration_text": "frontend_avatar は AI との音声対話を視覚的に体験させてくれます。AI が音声応答を再生しているとき、アバターが口パクをしたり AI の発話レベルに合わせた演出が加わります。BroadcastChannel の avatar-desktop-sync チャンネルで複数のウィンドウ間の状態を同期しているため、Electron の複数ウィンドウ構成でも一貫したアバター体験が得られます。デスクトップに常駐して AI と対話する、新しい体験を提供しています。",
          "audio": "audio/dlg_005_03_female.mp3",
          "duration_sec": 30.216
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "認証は Electron が localStorage、Web が sessionStorage と自動で切り替わります。",
          "naration_text": "Electron モードと Web モードでは認証のストレージも異なります。Electron では localStorage を使い、Web では sessionStorage を使うため、モードに応じた安全な認証管理が自動で行われます。tsconfig は strict mode が有効になっており、型安全な実装が保証されています。Vite proxy の設定は frontend_web と共通で、/core/* を 8091、/apps/* を 8098 に転送する構成です。デスクトップアプリと Web で同じコードベースが動く、デュアルモード設計が技術的な面白さです。",
          "audio": "audio/dlg_005_04_male.mp3",
          "duration_sec": 31.416
        }
      ],
      "duration_sec": 117.648
    },
    {
      "id": "scene_006",
      "title": "AiDiy TOOL HUB × 19 とビデオ自動生成",
      "accent": "#b8860b",
      "accent_soft": "rgba(184, 134, 11, 0.18)",
      "kicker": "TOOL HUB & AUTOMATION",
      "headline": "19 MCP サーバーと\nビデオページ Step00 から Step99 までの手順全自動化",
      "lead": "ブラウザ操作・AI 生成・OBS 録画・コードエージェントを 1 つのポートで統一し、ビデオ制作まで自動化します。",
      "image": "images/scene_006.png",
      "source_summary": "backend_tools = AiDiy TOOL HUB。19 MCP を SSE/Streamable HTTP/stdio の 3 トランスポートでポート 8095 に集約。ビデオページ生成_解説.py と ビデオページ生成_紹介.py が Step00 から Step99 までの手順でシナリオ→画像→音声→HTML を全自動化。この動画も AiDiy の自動生成。",
      "factual_bullets": [
        "19 MCP サーバーをポート 8095 に集約: ブラウザ・データ・AI生成・自動化の 4 カテゴリ",
        "SSE / Streamable HTTP / stdio の 3 トランスポートを同一ポートで提供",
        "HTTP POST で直接呼び出し可能 (MCP クライアント不要)",
        "ビデオページ生成_解説.py / 紹介.py が Step00 から Step99 までの手順でシナリオ→画像→音声→HTML を全自動化",
        "この動画も AiDiy TOOL HUB + CodeAgents が自動生成した"
      ],
      "forbidden_elements": [
        "AiDiy TOOL HUB が競合製品より優れると断言すること",
        "ビデオ自動生成が常に完全な品質で出力されると断言すること"
      ],
      "image_prompt": "A workflow automation diagram: top shows 19 MCP server icons arranged in a circle around port 8095 hub. Bottom shows an 9-step automation pipeline: scenario.js → image generation → audio synthesis → HTML assembly. Gold/amber color accent, dark background, arrows connecting each step, AiDiy logo at center.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "backend_tools は 19 の MCP を SSE・HTTP・stdio の 3 トランスポートで提供します。",
          "naration_text": "AiDiy TOOL HUB は backend_tools として実装された 19 の MCP サーバーの集合体です。ポート 8095 の tools_main.py を起動するだけで、SSE、Streamable HTTP、stdio の 3 つのトランスポートが同時に有効になります。Claude Desktop など MCP 対応 AI から stdio 経由で呼び出すこともでき、Python から requests.post を使って直接 HTTP でツールを呼び出すこともできます。用途に合わせて接続方式を選べる柔軟な設計です。",
          "audio": "audio/dlg_006_01_female.mp3",
          "duration_sec": 33.336
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "19 の MCP はブラウザ・データ・AI 生成・自動化の 4 カテゴリに整理されています。",
          "naration_text": "19 の MCP サーバーは 4 つのカテゴリに分かれています。ブラウザ・画面操作系の aidiy_chrome_devtools と aidiy_desktop_capture。データ管理・開発補助系の aidiy_sqlite、aidiy_postgres、aidiy_logs、aidiy_code_check、aidiy_backup。AI 生成系の aidiy_image_generation、aidiy_movie_generation、aidiy_speech_to_text、aidiy_text_to_speech。運用自動化系の aidiy_obs_studio_control、aidiy_ffmpeg_control、aidiy_code_agents です。",
          "audio": "audio/dlg_006_02_male.mp3",
          "duration_sec": 29.664
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "ツール一覧は GET、ツール実行は POST でシンプルに呼び出せます。",
          "naration_text": "AiDiy TOOL HUB の使い方はとてもシンプルです。ツールの一覧を見たい場合は GET リクエストを http://localhost:8095/{mcp_name}/list に送るだけです。ツールを実行する場合は POST リクエストに JSON のパラメータを付けて送ります。MCP クライアントがなくても、curl や Python の requests でそのまま呼び出せます。AI エージェントから使う場合も、Python スクリプトに組み込む場合も、同じエンドポイントが使えます。",
          "audio": "audio/dlg_006_03_female.mp3",
          "duration_sec": 33.6
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "ビデオページ生成スクリプトが Step00 から Step99 までの手順でビデオ制作を全自動化します。",
          "naration_text": "AiDiy TOOL HUB の活用例として、ビデオページ自動生成があります。ビデオページ生成_解説.py と ビデオページ生成_紹介.py の 2 つのスクリプトが、シナリオ作成から画像生成、音声合成、HTML 組み立てまでを Step00 から Step99 までの手順で自動化します。トピックを設定するだけで AI がシナリオを考え、MCP が画像と音声を生成し、完成した HTML ページが出来上がります。まさに AiDiy 自身がビデオを作るという自己言及的な機能です。",
          "audio": "audio/dlg_006_04_male.mp3",
          "duration_sec": 30.456
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "この動画も AiDiy TOOL HUB と CodeAgents によって自動生成されました。",
          "naration_text": "実はこの動画も、AiDiy の TOOL HUB と CodeAgents を使って自動生成されています。aidiy_code_agents がシナリオの台本を作り、aidiy_image_generation が各シーンの背景画像を生成し、aidiy_text_to_speech がナレーション音声を合成しました。HTML や再生プレイヤーも自動で組み立てられています。AiDiy の自動化機能が、AiDiy 自身の解説動画を作るという循環が実現しています。",
          "audio": "audio/dlg_006_05_female.mp3",
          "duration_sec": 27.48
        }
      ],
      "duration_sec": 154.536
    },
    {
      "id": "scene_007",
      "title": "AIタスクと AIチーム — 要求を書くだけで AI が動く",
      "accent": "#7dffb3",
      "accent_soft": "rgba(125, 255, 179, 0.18)",
      "kicker": "AI TASK & AI TEAM",
      "headline": "日本語の要求を明細へ分解して自動実行\n3D 空間では AI 要員がチームで動く",
      "lead": "backend_taskteam が担う 2 つの機能です。AIタスクは要求を実行明細へ分解し、依存を判断しながら実行します。AIチームは AI 要員が相談し、経験を貯めて次に活かします。",
      "image": "images/scene_007.png",
      "source_summary": "backend_taskteam/AGENTS.md の Task 機能・Team 機能、frontend_web/src/components/AIタスク・AIチーム の現行実装に基づく。",
      "factual_bullets": [
        "backend_taskteam (8093): AIタスクの /task/* と AIチームの /team/* を提供",
        "要求を準備開始で登録すると sub_init.py が AI に明細へ分解させ、開始行・処理行・終了行を本登録する",
        "先行SEQ による DAG で依存を判断し、条件を満たした明細は並行起動する",
        "実行区分は即時 / 時間指定 / 間隔実行 / 定時実行の 4 種。実行条件にフォルダ変化も選べる",
        "Aチーム依頼は要員ごとの経験を材料に AI が担当を選び、完了後に経験を生成して次へ再利用する",
        "開始明細は差分バックアップ、操作検証つき明細は 1 回だけ自動リトライ"
      ],
      "forbidden_elements": [
        "実装にない機能の追加",
        "誇張表現"
      ],
      "image_prompt": "Wide concept illustration split into two halves: the upper half shows an automated task flow with branching nodes and a clock icon for scheduled execution, the lower half shows several gentle glowing AI companions gathered in a park-like 3D space exchanging speech bubbles. Dark background, cyan and green glow, modern technical illustration.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AiDiy には、AI に仕事そのものを任せる AIタスクという機能があります。",
          "naration_text": "ここからは AIタスクと AIチームを見ていきます。どちらもポート 8093 の backend_taskteam が担当しています。まず AIタスクです。やってほしいことを日本語で書いて登録すると、AI がその中身を読んで、実行する手順、つまり明細へ自動的に分解します。分解を担当するのは task_sub の sub_init.py で、開始行、処理行、終了行という形で明細が本登録されます。人が手順書を書く必要はありません。",
          "audio": "audio/dlg_007_01_female.mp3",
          "duration_sec": 32.016
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "明細は先行SEQ で依存関係を持つので、順番と並行を自動で判断します。",
          "naration_text": "分解された明細には先行SEQ という項目があって、どの明細が終わったら始めるかを指定します。カンマ区切りで複数指定できるので、依存関係は一直線ではなく DAG になります。先行する明細がすべて完了した明細は実行可能と判定され、依存を満たしたものは並行して起動します。画面中央のフロー図には、この依存グラフと、最長経路であるクリティカルパスが表示されます。",
          "audio": "audio/dlg_007_02_male.mp3",
          "duration_sec": 24.96
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "実行の開始条件は即時、時間指定、間隔実行、定時実行の 4 種類です。",
          "naration_text": "AIタスクで特徴的なのが実行開始条件です。実行区分は 4 種類あります。すぐ動かす即時、指定した日時に 1 回だけ動く時間指定、分や時の単位で繰り返す間隔実行、そして毎日、毎週、毎月の決まった時刻に動く定時実行です。これに加えて実行条件としてフォルダ変化を選ぶと、監視フォルダの中身が変わったときだけ動かせます。一度登録すれば、人が居なくてもタスクが回り続けます。",
          "audio": "audio/dlg_007_03_female.mp3",
          "duration_sec": 29.664
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "AIチームでは、召喚した AI 要員が 3D 空間で相談しながら仕事を分担します。",
          "naration_text": "もうひとつが AIチームです。こちらは persona ディレクトリから AI 要員を召喚してチームを作ります。画面は 3D の空間になっていて、要員がその場に立ち、吹き出しで意見を交わします。チーム目標を登録して自動作業設定をオンにすると、要員が順番に今やるべきことを発言し、有効要員の半数以上の意見が集まったところで、admin 人格がチーム作業として取りまとめます。作業の進め方は PlanDo と SPDCA の 2 パターンから選べます。",
          "audio": "audio/dlg_007_04_male.mp3",
          "duration_sec": 28.608
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "依頼は経験のある要員へ自動で割り振られ、完了後は経験として蓄積されます。",
          "naration_text": "AIチームに依頼を出すと、AI が担当要員を選びます。このとき材料になるのが、要員ごとに蓄積された Aチーム経験です。経験値、分類、直近の学びを見て、いちばん合いそうな要員へ寄せます。選ばれた依頼はそのまま AIタスクとして投入され、明細に分解されて実行されます。完了すると sub_exp.py が経験を生成し、次の担当選びに再利用されます。使うほどチームが育っていく仕組みです。任せる不安に対しては、開始時の差分バックアップと、操作検証つき明細の 1 回だけの自動リトライが用意されています。",
          "audio": "audio/dlg_007_05_female.mp3",
          "duration_sec": 39.936
        }
      ],
      "duration_sec": 155.184
    },
    {
      "id": "scene_999",
      "title": "まとめ — AiDiy で開発と AI 自動化を楽しもう",
      "accent": "#1a6ea0",
      "accent_soft": "rgba(26, 110, 160, 0.18)",
      "layout": "hero",
      "kicker": "AIDIY ALL-IN-ONE",
      "headline": "日本語ファーストの開発と\nAI 自動化の循環を体験しよう",
      "lead": "業務管理テンプレート・AI コア・3D アバター・19 MCP TOOL HUB・AIタスクと AIチーム——すべてが AiDiy の中に揃っています。",
      "image": "images/scene_999.png",
      "source_summary": "AiDiy 全体のまとめ: 日本語ファーストのフルスタック業務管理テンプレート・7サービス構成・業務サンプル・AI コア・frontend_avatar・AiDiy TOOL HUB・AIタスク・AIチーム・ビデオ自動生成まで。この動画も AiDiy が自動生成。チャンネル登録誘導。",
      "factual_bullets": [
        "日本語ファーストの 7 サービス構成フルスタック業務管理テンプレート",
        "C/M/T/V/S 系の実践的な業務サンプル",
        "マルチ AI・WebSocket・Code AI 6 パネルの AI コア",
        "Electron/Web デュアルモード + VRM アバター",
        "AIタスクと AIチーム: 要求を明細へ分解して自動実行、AI 要員が経験を貯めて協働",
        "19 MCP TOOL HUB + ビデオ Step00 から Step99 までの手順全自動生成"
      ],
      "forbidden_elements": [
        "AiDiy が商用製品として公式リリースされているかのような断言",
        "チャンネル登録数や視聴数への言及"
      ],
      "image_prompt": "A triumphant summary visualization of AiDiy: center shows the AiDiy logo with circular orbit of feature icons (Japanese code, business dashboard, AI chat, VRM avatar, 19 MCP tools, video generation). Two avatar silhouettes (female right, male left) standing proudly. Blue color scheme with gold accents, inspiring futuristic aesthetic.",
      "dialogue": [
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "AiDiy は日本語ファーストのフルスタック業務管理テンプレートと AI 自動化基盤です。",
          "naration_text": "今回の動画で紹介した AiDiy は、FastAPI と Vue 3 を軸にした日本語ファーストのフルスタック業務管理テンプレートです。7 つのサービスが連携し、業務管理サンプル、AI コア、3D アバター、19 の MCP サーバー、そして AIタスクと AIチームという多彩な機能が組み込まれています。テーブル名からコード変数まで日本語で統一した設計は、日本語圏の開発者が業務ドメインとコードを直感的に対応させる上で大きな助けになります。",
          "audio": "audio/dlg_999_01_male.mp3",
          "duration_sec": 27.696
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "業務サンプル・AI コア・アバター・19 MCP・AIタスクと AIチームなど、盛りだくさんの構成です。",
          "naration_text": "特に印象的なのは、日本語ファースト設計のユニークさ、業務管理のリアルなサンプル、AI コアの多機能ぶり、Electron と Web の両対応アバター UI、19 の MCP を集約した TOOL HUB、そして日本語で書くだけで AI が手順へ分けて動かす AIタスクと AIチームという豊富な構成です。開発テンプレートとしても使えますし、AI 自動化の実験基盤としても活用できます。日本語を母国語とする開発者に向けて丁寧に作られていることが、細部からも伝わってきます。",
          "audio": "audio/dlg_999_02_female.mp3",
          "duration_sec": 32.352
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "aidiy_hermes や Code AI 6 パネルなど、コード支援 AI の実験にも向いています。",
          "naration_text": "コード支援 AI の実験基盤としても面白い仕組みがあります。code1 から code6 の 6 パネルに、Claude や Copilot、Codex、OpenCode など複数の AI を割り当てて同時に動かせます。aidiy_hermes は独自 Python エンジンで、TUI から複数 AI プロバイダを切り替えながら使えます。複数の AI を比較評価したり、長いコーディングタスクを分割して担当させたりする実験に最適な環境です。",
          "audio": "audio/dlg_999_03_male.mp3",
          "duration_sec": 25.2
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AiDiy を使って、あなただけの AI 自動化開発環境を作ってみましょう！",
          "naration_text": "この動画は AiDiy のビデオページ生成機能で自動生成されました。シナリオ作成も、シーン画像の生成も、ナレーション音声の合成も、すべて AiDiy 自身が担当しています。AiDiy に興味を持っていただけた方は、ぜひチャンネル登録をお願いします。更新情報をいち早くお届けします。日本語でコードを書く快感、AI との新しい開発体験、業務管理とアバター UI の融合——AiDiy はあなたがカスタマイズして楽しむ、DIY の開発プラットフォームです。ぜひ動かしてみてください！きっと「自分でも何か作ってみたい」という気持ちが湧いてきますよ！",
          "audio": "audio/dlg_999_04_female.mp3",
          "duration_sec": 39.048
        }
      ],
      "duration_sec": 124.296
    }
  ],
  "total_duration_sec": 1207.944
};
