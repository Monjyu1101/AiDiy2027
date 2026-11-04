window.SCENARIO = {
  "project_name": "ニュース_20260906_gpt6astra_ja",
  "version": "duo-v2",
  "language": "ja",
  "title": "GPT-6 Astra 発表――ベンチマークを塗りつぶした最上位モデル",
  "assets_policy": {
    "male_avatar": "../_vrm/VRM_male.vrm",
    "female_avatar": "../_vrm/VRM_female.vrm",
    "tts_male": "edge:male",
    "tts_female": "edge:female",
    "audio_output_dir": "frontend_web/public/Xビデオ/ニュース_20260906_gpt6astra_ja/audio"
  },
  "source_documents": [
    {
      "label": "OpenAI公式発表",
      "url": "https://openai.com/index/gpt-6-astra/"
    },
    {
      "label": "OpenAI公式モデル仕様",
      "url": "https://developers.openai.com/api/docs/models/gpt-6-astra"
    },
    {
      "label": "OpenAI公式モデル一覧",
      "url": "https://developers.openai.com/api/docs/models"
    },
    {
      "label": "OpenAI公式安全性概要",
      "url": "https://openai.com/index/safety-overview-gpt-6-astra/"
    },
    {
      "label": "DataCamp報道",
      "url": "https://www.datacamp.com/blog/gpt-6-astra"
    },
    {
      "label": "LLM Stats集計",
      "url": "https://llm-stats.com/models/gpt-6-astra"
    }
  ],
  "scenes": [
    {
      "id": "scene_000",
      "title": "イントロ――GPT-6 Astra 発表",
      "accent": "#0ea5e9",
      "accent_soft": "rgba(14, 165, 233, 0.18)",
      "layout": "hero",
      "kicker": "OPENAI NEWS · 2026.09.03",
      "headline": "GPT-6 Astra 発表\nベンチマークを塗りつぶした最上位モデル",
      "lead": "難問の評価、バイナリ解析、パソコン操作、仕様と料金、提供と安全性を、確認済み情報と留保に分けて解説します。",
      "image": "images/scene_000.png",
      "source_summary": "OpenAIが2026年9月3日に公開したGPT-6 Astraを、公式発表、モデル仕様、安全性概要と発表時点の報道・集計に基づいて紹介する。",
      "factual_bullets": [
        "公開日は2026年9月3日、モデルIDはgpt-6-astra",
        "評価テスト、パソコン操作、仕様と料金、提供と安全性を解説",
        "ベンチマーク値は発表時の測定条件に基づき、実務性能を保証しない",
        "この動画はAiDiyのニュース版ビデオ生成機能で作られている"
      ],
      "forbidden_elements": [
        "誰でも今すぐ使えるという断定",
        "ベンチマークの高得点を実務での完璧さと同一視する表現",
        "AIが人間の確認なしに全作業を完了するという表現"
      ],
      "image_prompt": "Japanese AI news opener dated September 3, 2026, a luminous Astra star above benchmark panels showing 97.6%, 99.9%, 100%, and 88.0%, two presenter positions left and right, elegant cyan and deep navy palette, clear headline space, 16:9, no copied company logo, no claim of perfect real-world performance.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AiDiyニュース版で自動生成。GPT-6 Astraの発表を公式資料から読み解きます",
          "naration_text": "こんにちは。このニュース解説動画は AiDiy のニュース版ビデオ生成機能で自動生成されています。今回のテーマは、OpenAIが2026年9月3日に公開したGPT-6 Astraです。見出しは『GPT-6 Astra 発表――ベンチマークを塗りつぶした最上位モデル』。公式発表、モデル仕様、安全性概要を一次情報とし、発表時点の報道と集計も照らし合わせながら、初心者の方にも分かる言葉で見ていきます。数字の背景まで順にたどりましょう。",
          "audio": "audio/dlg_000_01_female.mp3",
          "duration_sec": 34.104
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "難問の試験が相次いで飽和水準へ。手順と時間を伴う仕事の伸びも分かりやすく解きほぐします",
          "naration_text": "よろしくお願いします。今回の強烈な見出しにある「ベンチマークを塗りつぶした」とは、複数の難しい評価テストで満点に近い数字が並んだことを表す、解説上の意味づけです。さらに注目したいのは、数学や抽象的な推論だけではありません。ソースコードなしのバイナリ解析やパソコン操作のように、状況を読み、手順を選び、限られた情報で作業する試験でも大きな伸びが報告されました。点数の意味を身近な例に置き換え、実務との違いも確かめていきましょう。",
          "audio": "audio/dlg_000_02_male.mp3",
          "duration_sec": 30.072
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "評価結果、PC操作、仕様と料金、提供と安全性まで七つの場面で整理します。違いも確認しましょう",
          "naration_text": "この動画では、まずGPT-6 Astraの位置づけを確認し、次にFrontierMath、ARC-AGI-3、ExploitBench、SRE-Benchの結果を解説します。その後、OSWorld 2.0で測られたパソコン操作の力、Responses APIで使える主な道具、105万トークンのコンテキスト、料金の仕組みへ進みます。最後は段階的な提供と、サイバー能力がCriticalのしきい値に達したという安全性上の説明まで、七つの場面で整理します。",
          "audio": "audio/dlg_000_03_female.mp3",
          "duration_sec": 31.968
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "高得点は実務の完璧さを保証しません。確認済みの事実と留保を分けて見ましょう。慎重に進めます",
          "naration_text": "最初に大切な注意です。ベンチマークの数値は、発表時に示された測定条件での結果です。実際の仕事での品質、処理時間、費用対効果は、入力、指示、権限、環境、接続先によって変わります。提供も段階的で、利用できる組織やプラン、地域、時期はアカウントと展開状況に依存します。「必ず正しい」「必ず安く速い」とは受け取らず、確認済みの事実と利用時の留保を分けて見ていきましょう。数字だけで断定しない姿勢がとても重要です。",
          "audio": "audio/dlg_000_04_male.mp3",
          "duration_sec": 32.28
        }
      ],
      "duration_sec": 128.424
    },
    {
      "id": "scene_001",
      "title": "発表の概要――Astraの位置づけ",
      "accent": "#6366f1",
      "accent_soft": "rgba(99, 102, 241, 0.18)",
      "kicker": "MODEL POSITIONING",
      "headline": "モデルIDは gpt-6-astra\n前世代は GPT-5.6 Sol",
      "lead": "OpenAIが掲げる「世界で最も知的で最もアラインされたモデル」という位置づけを、公式の表現として理解します。",
      "image": "images/scene_001.png",
      "source_summary": "OpenAIはGPT-6 Astraを2026年9月3日に公開し、モデルIDをgpt-6-astra、前世代をGPT-5.6 Solとした。OpenAIは、世界で最も知的で最もアラインされたモデルと位置づけている。",
      "factual_bullets": [
        "モデルIDはgpt-6-astra",
        "前世代はGPT-5.6 Sol",
        "OpenAIは世界で最も知的で最もアラインされたモデルと位置づける",
        "製品上の位置づけと個別成果の保証は分けて考える"
      ],
      "forbidden_elements": [
        "世界中の全モデルとの絶対的な優劣を証明したという表現",
        "アラインメントにより誤りや危険がなくなったという表現",
        "人間を置き換えられるという断定"
      ],
      "image_prompt": "A clean Japanese model lineage infographic, GPT-5.6 Sol flowing into GPT-6 Astra, model ID gpt-6-astra shown clearly, a luminous star aligned with a human-guided compass, indigo and cyan palette, two presenter spaces, 16:9, no absolute superiority trophy, no copied logo.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "2026年9月3日公開、モデルIDはgpt-6-astra。まず基本情報を確認します",
          "naration_text": "まず基本情報です。OpenAIは2026年9月3日にGPT-6 Astraを公開しました。APIなどでモデルを指定するときのIDは「gpt-6-astra」で、前世代として示されているのはGPT-5.6 Solです。名前にあるAstraは星を連想させますが、ここで大切なのは印象ではなく、どのモデルを指すのか、どの世代と比較されたのかを正確に押さえることです。後ほど紹介する速度や料金の比較も、この前世代との関係を前提に読み解きます。",
          "audio": "audio/dlg_001_01_female.mp3",
          "duration_sec": 34.128
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "OpenAIは世界で最も知的で最もアラインされたモデルと位置づけています",
          "naration_text": "OpenAIはGPT-6 Astraを、世界で最も知的で、最もアラインされたモデルと位置づけています。「知的」は、難しい問題を理解し、考え、道具を使って答えへ近づく能力を示す言葉です。「アラインされた」は、利用者の意図や安全上の方針に沿って振る舞うことを目指す考え方です。これはOpenAIによる公式な位置づけであり、あらゆる場面で必ず最良の結果になることを証明する言葉ではない点も、併せて理解しておきましょう。",
          "audio": "audio/dlg_001_02_male.mp3",
          "duration_sec": 28.056
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "高性能と安全への整合は期待の軸。ただし個々の答えや操作には確認が欠かせません。人が見守ります",
          "naration_text": "初心者向けに言い換えると、難しい宿題を解く力だけでなく、頼まれた目的や守るべきルールを理解して進める力も重視したモデル、ということですね。ただし、賢さと安全への整合を目指していても、入力の勘違い、根拠の不足、道具の誤操作が起きないとは限りません。高い能力は任せられる作業を広げますが、完成条件を伝え、途中経過を見て、最終結果を確かめる利用者の役割までなくすものではありません。最後は人が責任を持ちます。",
          "audio": "audio/dlg_001_03_female.mp3",
          "duration_sec": 31.968
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "前世代との比較は進歩を測る手掛かりです。実務では自分の課題で小さく試しましょう。丁寧に比べます",
          "naration_text": "その通りです。前世代のGPT-5.6 Solと比べた数字は、技術の進歩を測る手掛かりになります。一方で、評価テストと実務では、使うデータ、許可する権限、接続するソフト、求める正確さが異なります。公式の位置づけを出発点にしながら、自分の仕事に近い例題で試し、結果と費用を記録して比べるのが現実的です。華やかなモデル名や見出しだけではなく、目的に合うかどうかで判断する姿勢が大切です。小さな検証から始めましょう。",
          "audio": "audio/dlg_001_04_male.mp3",
          "duration_sec": 31.008
        }
      ],
      "duration_sec": 125.16
    },
    {
      "id": "scene_002",
      "title": "評価テスト――四つの数字を読み解く",
      "accent": "#f97316",
      "accent_soft": "rgba(249, 115, 22, 0.18)",
      "kicker": "BENCHMARKS",
      "headline": "97.6%・99.9%・100%\nバイナリ解析は一発解決88.0%",
      "lead": "数学、未知の規則、脆弱性検証、ソースコードなしのバイナリ解析。何を測る試験なのかを身近な言葉に置き換えます。",
      "image": "images/scene_002.png",
      "source_summary": "発表時の評価でFrontierMath Tier 4は97.6%、ARC-AGI-3は99.9%、ExploitBenchは100%。ソースコードなしでソフトウェアのバイナリを解析するSRE-Benchの一発解決率は88.0%で、GPT-5.6 Solの55.9%を上回った。",
      "factual_bullets": [
        "FrontierMath Tier 4は97.6%",
        "ARC-AGI-3は99.9%",
        "ExploitBenchは100%",
        "SRE-Benchはソースコードなしのバイナリ解析を測り、一発解決率は88.0%、GPT-5.6 Solは55.9%"
      ],
      "forbidden_elements": [
        "ベンチマークでの満点を実務での無誤差と同一視する表現",
        "評価条件を超えた一般化",
        "サイバー攻撃を推奨または具体化する描写"
      ],
      "image_prompt": "A beginner-friendly Japanese benchmark dashboard with four large cards: FrontierMath Tier 4 97.6%, ARC-AGI-3 99.9%, ExploitBench 100%, SRE-Bench 88.0% versus GPT-5.6 Sol 55.9%. Use visual metaphors of advanced mathematics, abstract pattern puzzles, shielded vulnerability testing, and reverse engineering a compiled software binary without source code. Orange and navy, 16:9. Include a small Japanese note that benchmarks do not guarantee real-world perfection. Do not depict SRE-Bench as server outage response or site reliability operations.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "FrontierMathは97.6%、ARC-AGI-3は99.9%。難問が飽和水準へ達しました",
          "naration_text": "まず、考える力を測る二つの試験です。FrontierMath Tier 4は、研究者級の高度な数学問題にどこまで対応できるかを見る難関で、GPT-6 Astraは97.6%でした。ARC-AGI-3は、初めて見る図形や規則から仕組みを推測し、新しい問題へ当てはめる力を見る試験で、99.9%です。学校の暗記テストというより、見慣れない難問のルールをその場でつかむ試験だと考えると分かりやすく、どちらも発表値では飽和水準に達しています。",
          "audio": "audio/dlg_002_01_female.mp3",
          "duration_sec": 34.08
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "ExploitBenchは100%。SRE-Benchでは一発解決率88.0%を記録しました",
          "naration_text": "次は、技術的な作業に近い二つの試験です。ExploitBenchは、既知のソフトウェア脆弱性から実際に動く攻撃手法を作れるかを管理された環境で測り、結果は100%でした。SRE-Benchは、元のソースコードを見ずに、実行形式のソフトウェアを解析して中心的な仕組みを理解できるかを見る試験です。完成した機械を分解して設計を推測するような評価で、GPT-6 Astraの一発解決率は88.0%と報告されています。",
          "audio": "audio/dlg_002_02_male.mp3",
          "duration_sec": 28.896
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "バイナリ解析は前世代55.9%から88.0%へ。初回で解けた割合が伸びました",
          "naration_text": "SRE-Benchで比較対象となったGPT-5.6 Solの一発解決率は55.9%でした。GPT-6 Astraの88.0%との差は32.1ポイントです。ここでの「一発解決」は、何度も試して最後に正解へ着くのではなく、最初の試行で課題を解けた割合を示します。ソースコードがないソフトウェアから内部の仕組みを読み解くのは難しい作業です。正解率だけでなく、少ない試行で中心的なロジックへたどり着く力が伸びた点に意味があります。",
          "audio": "audio/dlg_002_03_female.mp3",
          "duration_sec": 34.512
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "満点に近い結果は試験内の到達点。現実の複雑さや未知の条件まで消す数字ではありません",
          "naration_text": "ただし、満点や満点に近い数字を「現実でも完璧」と読み替えてはいけません。評価テストには問題の範囲、採点方法、使える道具、時間などの条件があります。実務には古いシステム、欠けたログ、独自ルール、関係者との調整、取り消せない変更もあります。ベンチマークが飽和したという事実は、従来の試験だけでは能力差を測りにくくなった可能性も示します。高得点は重要な進歩ですが、人の確認が不要になった証明ではありません。",
          "audio": "audio/dlg_002_04_male.mp3",
          "duration_sec": 30.36
        }
      ],
      "duration_sec": 127.848
    },
    {
      "id": "scene_003",
      "title": "パソコン操作――速さと道具の広がり",
      "accent": "#14b8a6",
      "accent_soft": "rgba(20, 184, 166, 0.18)",
      "kicker": "COMPUTER USE",
      "headline": "OSWorld 2.0で72.6%\n一タスクの時間は約47%短縮",
      "lead": "画面を見て操作する力と、Responses APIで連携できる検索・コード・シェル・MCPなどの道具を確認します。",
      "image": "images/scene_003.png",
      "source_summary": "OSWorld 2.0は72.6%で、1タスクあたりの所要時間はGPT-5.6 Solより約47%短い。Responses APIではComputer Use、ホステッドシェルを含む主なツールをサポートする。",
      "factual_bullets": [
        "OSWorld 2.0は72.6%",
        "1タスクあたりの所要時間はGPT-5.6 Solより約47%短い",
        "Computer Use、ホステッドシェル、Apply Patch、Skills、MCPに対応",
        "Web検索、ファイル検索、画像生成、Code Interpreter、Tool Searchにも対応"
      ],
      "forbidden_elements": [
        "すべてのパソコン操作を無人で安全に完了できるという表現",
        "約47%の短縮が全タスクへ当てはまるという表現",
        "対応ツールが権限や環境に関係なく利用できるという表現"
      ],
      "image_prompt": "A Japanese computer-use evaluation scene, an AI cursor completing desktop tasks with a score card OSWorld 2.0 72.6% and a stopwatch showing approximately 47% shorter than GPT-5.6 Sol, surrounding icons for browser, hosted shell, code patch, files, MCP, and human approval gates, teal and navy, 16:9, no claim of universal automation.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "OSWorld 2.0は72.6%。画面を理解してアプリを操作する総合力を測ります",
          "naration_text": "パソコン操作の力を測るOSWorld 2.0では、GPT-6 Astraは72.6%でした。この試験は、画面に表示された情報を読み、マウスやキーボードに相当する操作を選び、複数のアプリで目的を達成できるかを見るものです。人にたとえるなら、初めて触るパソコンで説明を読みながら、設定変更やファイル整理、入力作業を進める実技試験です。文章で方法を説明するだけでなく、実際の画面上で手順をつなぐ力が評価されます。",
          "audio": "audio/dlg_003_01_female.mp3",
          "duration_sec": 32.856
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "一タスクの所要時間は前世代より約47%短縮。正確さと速さの両面が注目点です。条件も見ましょう",
          "naration_text": "もう一つの注目点は速さです。OSWorld 2.0の評価で、1タスクあたりの所要時間はGPT-5.6 Solより約47%短かったとされています。同じ種類の作業を進めるなら、待ち時間がほぼ半分に近づいた計算です。ただし、これは発表時の評価条件で測られた比較です。実際の所要時間は、画面の複雑さ、通信速度、認証、確認の回数、接続先の反応によって変わるため、あらゆる仕事が必ず47%速くなるという意味ではありません。",
          "audio": "audio/dlg_003_02_male.mp3",
          "duration_sec": 32.232
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Computer Useやホステッドシェルなど、画面と開発環境をまたぐ道具に対応します",
          "naration_text": "Responses APIでは、画面を扱うComputer Useや、管理された環境でコマンドを動かすホステッドシェルをサポートします。コードの差分を適用するApply Patch、手順や専門知識を再利用するSkills、外部ツールとつなぐMCP、必要な道具を探すTool Searchにも対応します。これらを組み合わせると、情報を調べ、ファイルを読み、コードを修正し、画面で結果を確かめる、といった一連の作業を設計できます。",
          "audio": "audio/dlg_003_03_female.mp3",
          "duration_sec": 29.112
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Web検索や画像生成も連携可能。重要操作には承認と記録、結果確認を組み込みましょう",
          "naration_text": "ほかにもWeb検索、ファイル検索、画像生成、Code Interpreterが主な対応ツールとして挙げられています。道具が増えるほど仕事の幅は広がりますが、誤った操作の影響も大きくなります。送信、購入、公開、削除、権限変更などは実行前に人が承認し、何を行ったか記録を残す設計が重要です。Computer Useに対応することを、どんなアプリでも人の確認なしに安全に操作できるという意味へ広げず、許可する範囲を明確にしましょう。",
          "audio": "audio/dlg_003_04_male.mp3",
          "duration_sec": 29.904
        }
      ],
      "duration_sec": 124.104
    },
    {
      "id": "scene_004",
      "title": "仕様と料金――大容量をどう使うか",
      "accent": "#eab308",
      "accent_soft": "rgba(234, 179, 8, 0.18)",
      "kicker": "SPECS & PRICING",
      "headline": "105万トークンの文脈\n入力10ドル・出力50ドル",
      "lead": "最大出力、5段階の推論設定、通常入力とキャッシュ済み入力の料金差を、用途に結びつけて解説します。",
      "image": "images/scene_004.png",
      "source_summary": "コンテキストウィンドウは1,050,000トークン、最大出力は128,000トークン。reasoning.effortは5段階。料金は100万トークンあたり入力10ドル、出力50ドル、キャッシュ済み入力1ドル。",
      "factual_bullets": [
        "コンテキストウィンドウは1,050,000トークン",
        "最大出力は128,000トークン",
        "reasoning.effortはlow、medium、high、xhigh、max",
        "100万トークンあたり入力10ドル、出力50ドル、キャッシュ済み入力1ドル",
        "通常料金はGPT-5.6 Solの約2.5倍"
      ],
      "forbidden_elements": [
        "トークン数を固定の文字数やページ数へ換算する表現",
        "大容量入力で品質が保証されるという表現",
        "キャッシュがすべての入力へ自動適用されるという表現"
      ],
      "image_prompt": "A clear Japanese specs and pricing board: context 1,050,000 tokens, max output 128,000 tokens, reasoning effort low medium high xhigh max, pricing per million tokens input $10 output $50 cached input $1, note about approximately 2.5 times GPT-5.6 Sol, gold and navy, 16:9, no guaranteed savings claim.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "コンテキストは105万トークン、最大出力は12万8000トークンの大容量です。使い方も確認します",
          "naration_text": "仕様を見ていきましょう。コンテキストウィンドウは1,050,000トークン、最大出力は128,000トークンです。コンテキストは、モデルが一度の仕事で参照できる入力と会話の範囲に相当します。長い文書、多数のファイル、過去のやり取りをまとめて扱う余地が広がります。最大出力は、モデルが一度に返せる量の上限です。ただし、トークンは文字数やページ数と一対一ではなく、長い資料を入れれば自動的に正確になるわけでもありません。",
          "audio": "audio/dlg_004_01_female.mp3",
          "duration_sec": 32.16
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "reasoning.effortはlowからmaxまで五段階。課題に応じて考える量を調整します",
          "naration_text": "考える量を調整するreasoning.effortは、low、medium、high、xhigh、maxの5段階に対応します。軽い整形や分類では低め、複雑な設計や検証では高め、というように課題へ合わせて選べます。高い設定ほど常に良いとは限りません。待ち時間や出力コストとのバランスがあり、簡単な作業に最大設定を使うと過剰になる場合があります。同じ代表課題を複数の設定で試し、必要な品質を満たす最も軽い設定を探るのが実用的です。",
          "audio": "audio/dlg_004_02_male.mp3",
          "duration_sec": 30.36
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "料金は100万トークンあたり入力10ドル、出力50ドル。前世代の約2.5倍です。費用も比べます",
          "naration_text": "料金は、入力100万トークンあたり10ドル、出力100万トークンあたり50ドルです。発表時点ではGPT-5.6 Solの約2.5倍にあたり、最上位モデルらしく単価は高めです。とくに長い回答や大量の成果物を生成すると、出力側の単価が費用へ効きます。性能の高さだけで選ばず、どの工程にAstraを使う価値があるかを考え、軽い作業は別のモデルに分ける方法もあります。実際の請求や利用上限は、利用前に最新の公式料金を確認してください。",
          "audio": "audio/dlg_004_03_female.mp3",
          "duration_sec": 35.232
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "キャッシュ済み入力は100万トークン1ドル。繰り返す共通部分が費用を左右します。記録で確かめます",
          "naration_text": "一方、キャッシュ済み入力は100万トークンあたり1ドルまで下がります。毎回同じ長い手順書や共通資料を読み込ませる仕事では、再利用できる入力が多いほど通常入力との差が大きくなります。初心者向けに言えば、毎回すべてを新しく読ませる料金と、前に読んだ共通部分を効率よく参照する料金の違いです。ただし、どの入力がキャッシュ対象になるかは使い方に依存します。必ず安くなると決めつけず、利用記録で実際の単価を確認しましょう。",
          "audio": "audio/dlg_004_04_male.mp3",
          "duration_sec": 29.688
        }
      ],
      "duration_sec": 127.44
    },
    {
      "id": "scene_005",
      "title": "提供と安全性――段階展開と人の確認",
      "accent": "#ef4444",
      "accent_soft": "rgba(239, 68, 68, 0.18)",
      "kicker": "ROLLOUT & SAFETY",
      "headline": "Trusted Accessから段階展開\nサイバー能力はCriticalしきい値",
      "lead": "提供順序と利用条件の留保を確認し、強い能力を安全に使うための承認・検証・監査を整理します。",
      "image": "images/scene_005.png",
      "source_summary": "提供はTrusted Access Programの企業から始まり、ChatGPTのPlus、Pro、Business、EnterpriseとAPI、Microsoft Azure、AWS Bedrockへ順次拡大。サイバー分野ではDaybreakを通じて防御目的のアクセス拡大も計画されている。OpenAIはPreparedness Frameworkのもとで、サイバー能力がCriticalしきい値に達したと初めて指定した。",
      "factual_bullets": [
        "提供はTrusted Access Programの企業から開始し、各プランとAPIへ段階展開",
        "サイバー分野ではDaybreakを通じて防御目的のアクセス拡大を計画",
        "その後Plus、Pro、Business、Enterprise、API、Microsoft Azure、AWS Bedrockへ順次拡大",
        "利用可否は組織、プラン、地域、時期、アカウントの展開状況に依存",
        "OpenAIがサイバー能力をCriticalしきい値に指定した初めてのモデル",
        "重要操作、権限、コード、外部変更、生成結果は人が確認"
      ],
      "forbidden_elements": [
        "全利用者への即時提供という断定",
        "未確認の地域別提供日や利用条件",
        "安全対策により誤操作や悪用が起きないという表現"
      ],
      "image_prompt": "A Japanese rollout and safety infographic: enterprises in the Trusted Access Program first, then ChatGPT Plus, Pro, Business, Enterprise, and API access in the coming days, beside a Critical cyber capability gauge and human approval checkpoints for code and external changes, red, amber and navy, 16:9, no exact regional dates, no alarmist hacking scene.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Trusted Accessの企業から開始。各プランとAPIへ段階的に広がります",
          "naration_text": "提供は一斉ではなく段階的です。まずTrusted Access Programの企業への提供から始まり、ChatGPTのPlus、Pro、Business、EnterpriseとAPI、さらにMicrosoft AzureとAWS Bedrockへ、数日かけて広がると案内されました。サイバーセキュリティ分野では、Daybreakを通じて防御目的の利用範囲を今後広げる計画も示されています。すべての組織や地域で同じ日に有効になるという意味ではありません。自分のアカウントに表示される案内を確認しましょう。",
          "audio": "audio/dlg_005_01_female.mp3",
          "duration_sec": 34.176
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "利用可否は組織、プラン、地域、時期に依存。料金と上限も公式の最新表示を確認します",
          "naration_text": "段階展開中は、「誰でも今すぐ使える」と言い切らないことが大切です。利用できる組織、契約プラン、地域、時期は、アカウントや展開状況に依存します。管理者の設定や機能ごとの権限によって、モデルは見えてもComputer Useなど一部の道具が使えない場合も考えられます。料金と利用上限も将来変更される可能性があります。この動画の情報は2026年9月3日の発表時点として扱い、導入前には公式ページと利用画面の最新表示を確認してください。",
          "audio": "audio/dlg_005_02_male.mp3",
          "duration_sec": 31.56
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "OpenAIがサイバー能力をCriticalと指定した初のモデル。慎重に扱います",
          "naration_text": "ここは今回いちばん重い話です。GPT-6 Astraは、OpenAIがPreparedness Frameworkのもとでサイバー能力をCriticalのしきい値に達したと指定した、初めてのモデルとされています。OpenAIの説明では、しっかり守られたシステムに対しても、人が手順を逐一指示しなくてもまだ知られていない弱点を見つけ、突けてしまう可能性がある、という水準です。だからこそ、便利さだけを見るのではなく、悪用防止、アクセス制御、監視、利用者確認を能力に見合う水準へ引き上げる必要があります。アラインされたモデルだから確認は不要、ではなく、影響が大きいからこそ慎重な運用が必要だと理解しましょう。",
          "audio": "audio/dlg_005_03_female.mp3",
          "duration_sec": 43.728
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "重要操作、権限、コード、外部変更、生成結果は人が確認。停止と復旧も準備しましょう",
          "naration_text": "実務では、重要操作の直前に人が目的、対象、影響範囲を確認します。権限は必要最小限にし、コードは差分を読んでテスト環境で検証してから反映します。送信、公開、削除、購入、外部システムの変更には承認を置き、生成された調査結果や文書は出典と日付を照合します。操作記録を残し、異常時に停止できる仕組みと、変更を戻せる復旧手段も用意しましょう。強い能力と人の責任を組み合わせることが、安全な活用の基本です。そうした地道な備えが、新しい能力を安心して使う土台になります。",
          "audio": "audio/dlg_005_04_male.mp3",
          "duration_sec": 37.392
        }
      ],
      "duration_sec": 146.856
    },
    {
      "id": "scene_999",
      "title": "まとめ――高得点を実務へつなぐ",
      "accent": "#0ea5e9",
      "accent_soft": "rgba(14, 165, 233, 0.18)",
      "layout": "hero",
      "kicker": "SUMMARY",
      "headline": "GPT-6 Astraの進歩を\n確認しながら仕事へ活かそう",
      "lead": "発表時点の数字と仕様を押さえ、段階展開、費用、安全性の留保を忘れず、小さな検証から始めます。",
      "image": "images/scene_999.png",
      "source_summary": "GPT-6 Astraの発表時点の評価、パソコン操作、仕様、料金、段階展開、安全性を総括し、AiDiyのニュース版ビデオ生成機能を紹介する。",
      "factual_bullets": [
        "難問系評価は97.6%、99.9%、100%の飽和水準",
        "SRE-Benchは88.0%、OSWorld 2.0は72.6%",
        "105万トークン、最大出力12万8000トークン、5段階の推論設定",
        "入力10ドル、出力50ドル、キャッシュ済み入力1ドル",
        "段階展開とCriticalしきい値を踏まえ、人による確認が必要"
      ],
      "forbidden_elements": [
        "完全自動化、正確性、速度、安さの保証",
        "未確認の利用条件や提供日",
        "高得点を人間の置き換えと結びつける表現"
      ],
      "image_prompt": "An uplifting Japanese AI news summary, GPT-6 Astra at center with benchmark cards 97.6%, 99.9%, 100%, 88.0%, OSWorld 72.6%, specs and pricing icons, rollout steps and a human verification checkmark, a small AiDiy video workflow, bright cyan and gold on navy, 16:9, no perfect automation claim.",
      "dialogue": [
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "確認済みの中心は、難問の飽和水準とバイナリ解析、パソコン操作での大きな伸びです",
          "naration_text": "まとめます。GPT-6 Astraは2026年9月3日に公開され、モデルIDはgpt-6-astra、前世代はGPT-5.6 Solです。発表値ではFrontierMath Tier 4が97.6%、ARC-AGI-3が99.9%、ExploitBenchが100%に達しました。ソースコードなしのバイナリ解析を測るSRE-Benchの一発解決率は88.0%、OSWorld 2.0は72.6%で、難問を解く力だけでなく、専門的な解析やパソコン操作のような手順を伴う仕事でも進歩が示されました。",
          "audio": "audio/dlg_999_01_male.mp3",
          "duration_sec": 35.304
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "105万トークンと豊富な道具が長い仕事を支えますが、料金との設計が重要です。用途を選びましょう",
          "naration_text": "仕様では105万トークンのコンテキスト、12万8000トークンの最大出力、lowからmaxまで5段階のreasoning.effortを備えます。Responses APIの検索、コード、シェル、Computer Use、MCPなどを組み合わせれば、長い仕事を一つの流れとして設計できます。一方、料金は100万トークンあたり入力10ドル、出力50ドルです。キャッシュ済み入力は1ドルなので、共通資料を繰り返す仕事では、使い方の設計が費用を大きく左右します。",
          "audio": "audio/dlg_999_02_female.mp3",
          "duration_sec": 33.312
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "ベンチマークと実務は別物。段階展開とCriticalを踏まえ、人の確認を置きましょう",
          "naration_text": "そして忘れてはいけないのが留保です。高いベンチマーク値は、発表時の条件で得られた評価であり、実務の品質、速度、費用対効果を保証しません。提供はTrusted Access Programの企業からChatGPT各プランとAPIへ段階的に広がり、実際の利用可否はアカウントによります。サイバー能力がCriticalのしきい値に達したという説明も踏まえ、重要操作、権限、コード、外部変更、生成結果には、必ず人の確認と検証を置きましょう。",
          "audio": "audio/dlg_999_03_male.mp3",
          "duration_sec": 30.048
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AiDiyで根拠を確かめ、最新AIニュースの解説ビデオ作りを楽しく始めましょう。次へ進みましょう",
          "naration_text": "この動画は AiDiy のニュース版ビデオ生成機能で自動生成されました。シナリオ、字幕、画像、ナレーションを一つの流れで組み立て、二人の掛け合いによるニュース解説にできます。確認済みの情報と留保を分け、生成結果を人が確かめることも大切です。これからも最新AIニュースを分かりやすく追いたい方は、ぜひチャンネル登録をお願いします。そして、自分でも AiDiy で最新AIニュースの解説ビデオを作ってみてください。確かめる力と作る楽しさを携えて、次のニュースへ明るく進みましょう！",
          "audio": "audio/dlg_999_04_female.mp3",
          "duration_sec": 35.544
        }
      ],
      "duration_sec": 134.208
    }
  ],
  "total_duration_sec": 914.04
};
