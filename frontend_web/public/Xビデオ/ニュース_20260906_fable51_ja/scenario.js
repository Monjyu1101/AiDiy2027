window.SCENARIO = {
  "project_name": "ニュース_20260906_fable51_ja",
  "language": "ja",
  "version": "duo-v2",
  "title": "Claude Fable 5.1 発表――AIが科学の現場で成果を出しはじめた",
  "assets_policy": {
    "male_avatar": "../_vrm/VRM_male.vrm",
    "female_avatar": "../_vrm/VRM_female.vrm",
    "tts_male": "edge:male",
    "tts_female": "edge:female",
    "audio_output_dir": "frontend_web/public/Xビデオ/ニュース_20260906_fable51_ja/audio"
  },
  "source_documents": [
    {
      "label": "Anthropic公式発表",
      "url": "https://www.anthropic.com/claude-fable-and-mythos-5-1"
    },
    {
      "label": "Anthropic公式システムカード",
      "url": "https://www-cdn.anthropic.com/0339e6a7c5c7b87f5c07798616dc32c215d14235/Claude%20Fable%205.1%20&%20Claude%20Mythos%205.1%20System%20Card.pdf"
    },
    {
      "label": "Anthropic公式 Claude Fable 製品ページ",
      "url": "https://www.anthropic.com/claude/fable"
    },
    {
      "label": "Anthropic公式 Enterprise Frontier Safeguards",
      "url": "https://www.anthropic.com/news/enterprise-frontier-safeguards"
    }
  ],
  "scenes": [
    {
      "id": "scene_000",
      "title": "イントロ — Claude Fable 5.1 発表",
      "accent": "#d97706",
      "accent_soft": "rgba(217, 119, 6, 0.18)",
      "layout": "hero",
      "kicker": "AI NEWS / 2026.09.01",
      "headline": "Claude Fable 5.1 発表\nAIが科学の現場で成果を出しはじめた",
      "lead": "科学研究、コーディング、知識労働、料金、安全策まで、公式資料をもとに初心者向けに整理します。",
      "image": "images/scene_000.png",
      "source_summary": "Anthropicは2026年9月1日にClaude Fable 5.1とClaude Mythos 5.1を公開した。本編ではAnthropic公式発表、システムカード、製品ページ、安全策の発表を一次情報として扱う。",
      "factual_bullets": [
        "公開日は2026年9月1日",
        "科学研究、コーディング、知識労働、料金、安全策、提供条件を解説",
        "ベンチマークは公式の測定条件に基づく数値であり、実務性能を保証しない",
        "このニュース解説動画はAiDiyのニュース版ビデオ生成機能で作られている"
      ],
      "forbidden_elements": [
        "誰でも今すぐ使えるという表現",
        "AIが人間の確認なしに研究を完了するという表現",
        "必ず正しい、必ず安く速いという断定"
      ],
      "image_prompt": "Editorial AI news opener, a luminous scientific laboratory connected to coding terminals and planetary maps, two presenter positions left and right, elegant amber and navy palette, headline space, no company logo imitation, no tiny unreadable text, 16:9.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AiDiyニュース版で生成。Claude Fable 5.1と科学の進歩を公式資料で読み解きます。",
          "naration_text": "こんにちは。このニュース解説動画は AiDiy のニュース版ビデオ生成機能で作られています。今回は、Anthropicが2026年9月1日に公開したClaude Fable 5.1とClaude Mythos 5.1を取り上げます。見出しは『Claude Fable 5.1 発表――AIが科学の現場で成果を出しはじめた』。科学研究の実例から、コーディング、知識労働、料金、安全策、提供条件まで、初めて聞く方にも分かる言葉で順番に見ていきましょう。",
          "audio": "audio/dlg_000_01_female.mp3",
          "duration_sec": 32.4
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "今回の注目点は、試験の点数だけでなく科学研究の具体例まで公表されたことにもあります。",
          "naration_text": "新しいAIのニュースというと、まず試験の点数を比べる話になりがちですよね。今回の大きな注目点は、それに加えて、タンパク質設計、計算生物学、金星の地形解析という科学の現場で、具体的な成果が示されたことです。ただし、研究上の成果がそのまま製品や治療になるわけではありません。何が確認済みの事実で、どこからが解説上の意味づけなのかを分けながら紹介します。公式資料を軸に、数字を誇張せず読み解きましょう。まずは全体像から始めます。",
          "audio": "audio/dlg_000_02_male.mp3",
          "duration_sec": 32.16
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "性能向上と値下げ、安全策の精度向上を、ひと続きの変化として一緒に詳しく確認します。",
          "naration_text": "見るべき流れは三つあります。第一に、科学研究エージェントのスコアが旧世代から二倍以上へ伸びたこと。第二に、長い作業で効きやすいキャッシュ読み込み料金が大きく下がったこと。第三に、安全策を弱めるのではなく、無害な依頼まで止めてしまう過剰反応を減らしたことです。高性能、使いやすい費用、安全策の精度という三点を、ばらばらではなく一つの進化として捉えます。後半では提供対象の違いも確認します。では、順に見ていきましょう。",
          "audio": "audio/dlg_000_03_female.mp3",
          "duration_sec": 33.912
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "数字は公式条件での測定結果。実際の品質や費用は使う環境によって変わるため、慎重に読みましょう。",
          "naration_text": "最初に大切な注意です。この動画で紹介する数値は、Anthropic公式資料に記載された測定条件での結果です。実際の仕事での品質、処理時間、費用対効果は、入力内容、指示、与えた権限、実行環境、接続するツールによって変わります。料金、利用上限、地域、提供時期も更新される可能性があります。利用前には必ず最新の公式情報を確認し、生成物や重要な操作は人が確かめてください。これは高性能なAIほど大切な前提です。",
          "audio": "audio/dlg_000_04_male.mp3",
          "duration_sec": 33.72
        }
      ],
      "duration_sec": 132.192
    },
    {
      "id": "scene_001",
      "title": "発表の概要 — FableとMythosの違い",
      "accent": "#2563eb",
      "accent_soft": "rgba(37, 99, 235, 0.18)",
      "kicker": "ONE MODEL, TWO ROUTES",
      "headline": "Claude Fable 5.1とMythos 5.1\n同じ基盤、異なる安全策と提供経路",
      "lead": "一般提供のFableと、検証済み組織向けのMythos。名前だけでなく利用条件を区別します。",
      "image": "images/scene_001.png",
      "source_summary": "Fable 5.1とMythos 5.1は同一の基盤モデルだが、安全策の水準と提供経路が異なる。Fableは一般提供、Mythosは検証プログラム経由の審査済み組織向け。",
      "factual_bullets": [
        "Fable 5.1とMythos 5.1は同一の基盤モデル",
        "Fable 5.1のClaude APIモデルIDはclaude-fable-5-1",
        "Fable 5.1はAWS、Google Cloud、Microsoft Azureを含む全プラットフォームで一般提供",
        "Mythos 5.1は検証プログラムを通じた審査済み組織向け"
      ],
      "forbidden_elements": [
        "FableとMythosを別の基盤モデルとして描くこと",
        "Mythosを一般利用できると示すこと",
        "地域や将来の提供条件を推測すること"
      ],
      "image_prompt": "A clear split-path infographic from one central AI foundation: left path labeled Fable 5.1 for general platforms, right path labeled Mythos 5.1 for verified organizations with stronger safeguards, cloud icons without copied logos, blue and violet palette, 16:9.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Claude Fable 5.1とMythos 5.1は、同じ基盤モデルから生まれた二つの提供形態です。",
          "naration_text": "まず名前を整理しましょう。Claude Fable 5.1とClaude Mythos 5.1は、能力の土台がまったく別の二機種という関係ではありません。Anthropicによると、両者は同一の基盤モデルを使いながら、安全策の水準と提供される経路が異なります。身近にたとえるなら、同じエンジンを載せつつ、利用できる道路と安全装備の設定を用途に合わせて分けた二つの仕様です。この違いを押さえると、後の性能比較も理解しやすくなります。",
          "audio": "audio/dlg_001_01_female.mp3",
          "duration_sec": 30.792
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Fable 5.1は一般提供され、主要クラウドを含む全プラットフォームで利用できます。",
          "naration_text": "広く利用できる側がFable 5.1です。Anthropic公式発表では一般提供とされ、Amazon Web Services、Google Cloud、Microsoft Azureを含む全プラットフォームから利用できます。Claude APIで指定するモデルIDは、claude-fable-5-1です。開発者がAPIの設定を行うときは、表示名ではなくこのIDを使う点が実務上のポイントです。ただし、個々のアカウントの上限や地域条件は利用時の公式案内を確認してください。",
          "audio": "audio/dlg_001_02_male.mp3",
          "duration_sec": 28.944
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Mythos 5.1は、高度な能力を扱う審査済み組織へ限定して提供される違いがあります。",
          "naration_text": "一方のMythos 5.1は、Cyber Verification ProgramとLife Sciences Verification Programを通じて、審査を受けた組織へ提供されます。現時点で対象は米国の組織に限られます。これは、サイバーや生命科学で高度な能力を必要とする利用者に、通常とは異なる安全策と確認手続きを組み合わせて提供する考え方です。Fableと同じ基盤だからといって、Mythosも誰でも選べるわけではありません。提供条件を混同しないようにしましょう。",
          "audio": "audio/dlg_001_03_female.mp3",
          "duration_sec": 31.992
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "利用可否はモデル名だけで判断せず、提供経路、審査、地域条件まで丁寧に確認しましょう。",
          "naration_text": "初心者が混乱しやすいのは、ベンチマーク表に二つの名前が並ぶと、どちらも同じように契約できると思ってしまう点です。実際には、一般提供のFable 5.1と、検証プログラム経由のMythos 5.1で入口が違います。対象範囲や地域は今後変わる可能性もあるため、この動画では2026年9月1日の公式発表時点を基準にしています。導入を検討するときは、モデル名、提供経路、審査、地域の四点を確認しましょう。最新情報の再確認も欠かせません。",
          "audio": "audio/dlg_001_04_male.mp3",
          "duration_sec": 32.064
        }
      ],
      "duration_sec": 123.792
    },
    {
      "id": "scene_002",
      "title": "科学研究 — 数字と三つの実例",
      "accent": "#059669",
      "accent_soft": "rgba(5, 150, 105, 0.18)",
      "kicker": "SCIENCE IN ACTION",
      "headline": "科学研究エージェントは52.6%へ\nタンパク質・生物計算・金星で具体例",
      "lead": "試験スコアの伸びを、研究現場で報告された三つの成果と一緒に読み解きます。",
      "image": "images/scene_002.png",
      "source_summary": "Terminal-Bench-Science 0.1でFable 5.1は52.6%、Fable 5は24.7%。Mythos 5.1ではタンパク質設計、計算生物学、金星地形解析の成果が示された。",
      "factual_bullets": [
        "Terminal-Bench-Science 0.1はFable 5の24.7%からFable 5.1の52.6%へ向上",
        "タンパク質設計は最良提出より結合親和性10倍、ヒット率ほぼ50%",
        "計算生物学のモデル最適化は最大2.5倍高速化、推定GPUコスト30〜60%削減",
        "金星標高地図は従来10〜20kmに対し2〜3kmの詳細を実現"
      ],
      "forbidden_elements": [
        "研究成果を製品化や治療成功として描くこと",
        "AI単独で研究を完了したとすること",
        "ベンチマーク値を実務の成功率と言い換えること"
      ],
      "image_prompt": "Scientific triptych: protein binder molecular structures, computational biology optimization dashboard with faster GPU processing, and a detailed topographic map of Venus, connected by an AI research agent terminal, emerald and gold palette, credible editorial illustration, 16:9.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "科学研究ベンチマークは24.7%から52.6%へ伸び、二倍を超える結果になりました。",
          "naration_text": "科学研究での進歩を示す入口が、Terminal-Bench-Science 0.1という評価です。これは、AIが端末や道具を使いながら、研究に近い複数段階の作業を進める力を見る試験です。Fable 5は24.7%だったのに対し、Fable 5.1は52.6%でした。単純に暗記問題の正答率が上がったというより、調べ、計算し、道具を動かし、結果をまとめる一連の仕事で、完遂できる範囲が広がったと捉えると分かりやすいでしょう。実務の成功率そのものではありません。",
          "audio": "audio/dlg_002_01_female.mp3",
          "duration_sec": 36.024
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "タンパク質設計では結合親和性10倍、ヒット率ほぼ50%という結果が示されました。",
          "naration_text": "具体例の一つ目はタンパク質設計です。Mythos 5.1はAdaptyv Bioのコンペで、提出された最良の設計より結合親和性が10倍高いバインダーを設計し、ヒット率はほぼ50%でした。対象はEGFR、Nipah G、15-PGDHです。結合親和性は、狙った相手にどれだけ強く結び付くかの目安。ヒット率は、作った候補のうち実験で反応した割合と考えるとよいでしょう。ただし、これは研究上の結果で、治療効果を意味しません。",
          "audio": "audio/dlg_002_02_male.mp3",
          "duration_sec": 30.744
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "計算生物学では最大2.5倍高速化し、推定GPUコストを30〜60%削減しました。",
          "naration_text": "二つ目は計算生物学のモデル最適化です。Mythos 5.1を使った作業では、処理を最大2.5倍に高速化し、推定されるGPUコストを30%から60%削減したと報告されています。研究用の計算は、わずかな非効率でも大量の実行時間と費用につながります。AIがコードや計算手順を点検し、同じ目的へより短い道筋を見つけられれば、研究者は待ち時間と計算資源を節約できます。ただし効果は対象のモデルや環境によって変わります。",
          "audio": "audio/dlg_002_03_female.mp3",
          "duration_sec": 35.376
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "金星地図は従来の10〜20キロから2〜3キロへ、見える細かさが向上した成果です。",
          "naration_text": "三つ目は惑星科学です。金星の高解像度標高地図では、従来の10キロメートルから20キロメートル程度の解像度に対し、2キロメートルから3キロメートルの細かさを実現しました。粗い方眼紙で見ていた地形を、より細かな方眼紙で読み直せるようになったイメージです。この三例が示すのは、AIが文章を答えるだけでなく、専門道具を使う研究工程へ入り始めたこと。ただし結果の解釈と検証には専門家が欠かせません。研究の完成を意味するものでもありません。",
          "audio": "audio/dlg_002_04_male.mp3",
          "duration_sec": 30.744
        }
      ],
      "duration_sec": 132.888
    },
    {
      "id": "scene_003",
      "title": "コーディングと知識労働 — 長い仕事を支える性能",
      "accent": "#7c3aed",
      "accent_soft": "rgba(124, 58, 237, 0.18)",
      "kicker": "CODE & KNOWLEDGE WORK",
      "headline": "コード実務と多分野推論も向上\n100万トークンを一度に扱う",
      "lead": "複数の評価値と長い入出力枠が、どんな仕事に関係するのかを平易に説明します。",
      "image": "images/scene_003.png",
      "source_summary": "Terminal-Bench 4.0、CursorBench 3.2.0、ツール利用ありHumanity's Last Examで高い結果を示し、100万トークンのコンテキストと最大12万8千トークン出力に対応する。",
      "factual_bullets": [
        "Terminal-Bench 4.0はFable 5.1が55.8%、Mythos 5.1が60.9%",
        "CursorBench 3.2.0は73.4%",
        "ツール利用ありHumanity's Last Examは65.0%",
        "コンテキストウィンドウ100万トークン、最大出力12万8千トークン"
      ],
      "forbidden_elements": [
        "ベンチマークを実務品質の保証として扱うこと",
        "人間のレビューが不要だと示すこと",
        "長い入力なら必ず高品質になると断定すること"
      ],
      "image_prompt": "An AI coding agent working across a terminal, code editor, document archive, charts and research tools, with benchmark gauges and a very long context ribbon, violet and cyan palette, professional editorial technology illustration, 16:9.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "端末で課題を進める評価は、Fable 55.8%、Mythos 60.9%でした。",
          "naration_text": "次はコーディングです。Terminal-Bench 4.0は、AIが端末を操作し、複数の手順を重ねて技術課題を解く力を見る評価です。Fable 5.1は55.8%、Mythos 5.1は60.9%でした。コードの断片を一問だけ答える試験ではなく、状況を確認し、コマンドを実行し、失敗を直しながらゴールへ進むエージェント型の作業に近い点が重要です。Mythosの数値が高くても、利用には先ほど説明した検証プログラムの条件があります。",
          "audio": "audio/dlg_003_01_female.mp3",
          "duration_sec": 34.248
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "実際の編集に近いCursorBenchは73.4%。コードを直す力も評価されています。",
          "naration_text": "CursorBench 3.2.0では73.4%でした。この評価は、実際のコードベースを読み、必要な箇所を見つけて編集するような作業に近い能力を見ます。つまり、ゼロから短い関数を書く力だけでなく、すでにある大きなプロジェクトの文脈をつかみ、変更を周囲へなじませる力が問われます。現場では、テスト、セキュリティ、設計方針、既存利用者への影響も確認が必要です。点数が高いことと、そのまま無審査で採用できることは別だと覚えておきましょう。",
          "audio": "audio/dlg_003_02_male.mp3",
          "duration_sec": 31.368
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "多分野推論の難関評価は、ツールを利用する条件で65.0%に達し、知識労働の力を示します。",
          "naration_text": "知識労働の広さを見る材料が、Humanity's Last Examです。専門分野をまたぐ難しい問題を集めた評価で、Fable 5.1はツール利用ありの条件で65.0%でした。ここでのツールとは、AIが必要に応じて計算や検索などの手段を使える設定を指します。人間も難しい仕事では、記憶だけに頼らず資料や計算機を使いますよね。AIも同じように、適切な道具を選び、途中結果をつないで答える力が知識労働で重要になっています。",
          "audio": "audio/dlg_003_03_female.mp3",
          "duration_sec": 33.936
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "100万トークンの文脈と最大12万8千トークン出力が、大量資料を使う長い仕事を支えます。",
          "naration_text": "扱える情報量も大きな特徴です。コンテキストウィンドウは100万トークン、最大出力は12万8千トークンです。トークンは文章をAIが処理する細かな単位で、100万という枠なら、多数の資料や大きなコード群を一度の仕事の文脈へ入れやすくなります。長い報告書やまとまったコードを出力できる余地もあります。ただし、入れられる量と正しく理解できる量は同じではありません。重要資料の選別、明確な指示、出力の検証は引き続き必要です。",
          "audio": "audio/dlg_003_04_male.mp3",
          "duration_sec": 30.12
        }
      ],
      "duration_sec": 129.672
    },
    {
      "id": "scene_004",
      "title": "料金と使いやすさ — キャッシュが75%値下げ",
      "accent": "#0891b2",
      "accent_soft": "rgba(8, 145, 178, 0.18)",
      "kicker": "PRICE & EFFICIENCY",
      "headline": "入力10ドル・出力50ドルは据え置き\nキャッシュ読み込みは0.25ドルへ",
      "lead": "長い資料を繰り返し参照するエージェント作業ほど、キャッシュ値下げが効いてきます。",
      "image": "images/scene_004.png",
      "source_summary": "入力と出力の単価は据え置きだが、キャッシュ読み込みは75%値下げ。公式試算では典型用途で約25%、エージェント色の強い用途で最大約45%安い。",
      "factual_bullets": [
        "入力100万トークンあたり10ドル",
        "出力100万トークンあたり50ドル",
        "キャッシュ読み込み100万トークンあたり0.25ドルへ75%値下げ",
        "Fable 5比で典型用途は約25%、エージェント用途は最大約45%安いとされる"
      ],
      "forbidden_elements": [
        "すべての利用者が必ず25%または45%安くなるという表現",
        "為替や税を含む最終請求額の断定",
        "実務の費用対効果を推測すること"
      ],
      "image_prompt": "A clear cost infographic showing stable input and output price pillars and a cache-read price dropping by 75 percent, alongside a long-running AI agent reusing documents, cyan and green financial technology palette, no currency promises, 16:9.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "基本料金は入力100万トークン10ドル、出力100万トークン50ドルで据え置きです。",
          "naration_text": "料金を確認しましょう。Fable 5.1の基本単価は、入力100万トークンあたり10ドル、出力100万トークンあたり50ドルで据え置きです。新モデルだから入力と出力が一律に安くなった、という発表ではありません。大量の文書を読ませると入力が増え、長い成果物を作らせると出力が増えます。まずは自分の用途で、入力と出力のどちらが多いかを把握することが、費用を見積もる第一歩になります。為替や税なども別に確認しましょう。",
          "audio": "audio/dlg_004_01_female.mp3",
          "duration_sec": 33.048
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "大きく下がったのはキャッシュ読み込みで、100万トークン0.25ドルになりました。",
          "naration_text": "今回大きく値下げされたのは、キャッシュ読み込みです。100万トークンあたり0.25ドルとなり、従来から75%下がりました。キャッシュは、一度読み込ませた長い説明や資料を、後のやり取りでも再利用しやすくする仕組みです。同じ規約、設計書、コード群を何度も参照する仕事では、毎回すべてを通常料金で読み直す部分を減らせます。長時間動くAIエージェントほど、繰り返し参照の割合が増えやすいため、この変更が効きます。",
          "audio": "audio/dlg_004_02_male.mp3",
          "duration_sec": 29.16
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "公式試算では典型用途で約25%、エージェント用途で最大約45%安くなるとされます。",
          "naration_text": "AnthropicはFable 5と比べ、典型的な用途では約25%、エージェント色の強い用途では最大およそ45%安くなると説明しています。ここで『最大』という言葉が重要です。何度も同じ情報を参照するほどキャッシュの恩恵は大きくなりますが、毎回まったく違う短い質問をするなら、同じ割合にはなりません。公式の試算は費用構造の方向を示す目安として受け取り、自分の入力、出力、キャッシュ利用量で計算する必要があります。",
          "audio": "audio/dlg_004_03_female.mp3",
          "duration_sec": 32.712
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "長い作業を任せやすくなっても、品質確認と利用量の監視を続け、コストを管理しましょう。",
          "naration_text": "価格面の意味は、AIへ長い仕事を任せるハードルが下がりやすくなったことです。ただし、安くなったから処理を無制限に増やしてよいわけではありません。エージェントが同じ操作を繰り返したり、不要な資料まで読み続けたりすれば費用は積み上がります。利用量の上限、処理の停止条件、ログの確認、人による成果物レビューを用意しましょう。最新の単価、割引、上限、地域条件は、実際に使うアカウントの公式画面で確認するのが安全です。",
          "audio": "audio/dlg_004_04_male.mp3",
          "duration_sec": 29.616
        }
      ],
      "duration_sec": 124.536
    },
    {
      "id": "scene_005",
      "title": "安全性と提供条件 — 止め過ぎを減らし、境界を明確に",
      "accent": "#dc2626",
      "accent_soft": "rgba(220, 38, 38, 0.18)",
      "kicker": "SAFETY & ACCESS",
      "headline": "誤検知と過剰反応を削減\n高度な能力は検証済み組織へ",
      "lead": "安全策の改善率、Mythosの限定提供、企業向け保護、蒸留対策を整理します。",
      "image": "images/scene_005.png",
      "source_summary": "サイバーと生物分野で安全策の過剰反応を減らした。Mythosは米国の審査済み組織向け。企業向け追加策と新規APIアカウント向け蒸留対策も示された。",
      "factual_bullets": [
        "サイバー分野の誤検知は従来より60%減少",
        "生物分野の安全策が無害な依頼に反応する頻度は85%減少",
        "Enterprise Frontier Safeguardsは顧客管理のデータ基盤で動き、今秋提供予定",
        "新規APIアカウントへ推論内容の抽出を防ぐ蒸留対策を導入"
      ],
      "forbidden_elements": [
        "安全策が不要または完全になったという表現",
        "Enterprise Frontier Safeguardsが提供済みという表現",
        "Mythosが米国外や一般利用者にも提供されるという推測"
      ],
      "image_prompt": "Layered AI safety controls: accurate filters allowing harmless research requests while blocking risky paths, verified organization gateway, enterprise-owned data boundary, and anti-distillation shield, red and blue security palette, clear editorial infographic, 16:9.",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "サイバー分野の誤検知は60%減り、安全策が必要以上に止める場面を抑え、正当な作業を通しやすくしました。",
          "naration_text": "安全策では、危険な依頼を止めるだけでなく、無害な依頼を誤って止めない精度も改善されています。サイバー分野では誤検知が従来より60%減りました。防御目的の点検や学習まで危険と判断されると、正当な利用者の仕事が進みません。今回の数字は、安全策を外したという意味ではなく、危険性を見分ける精度を上げ、必要な研究や防御作業を通しやすくする方向の改善として理解するのが大切です。止める精度と通す精度の両方が重要です。",
          "audio": "audio/dlg_005_01_female.mp3",
          "duration_sec": 34.224
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "生物分野では、無害な依頼に安全策が反応する頻度を85%減らし、安全と実用性の両立を図ります。",
          "naration_text": "生物分野でも、安全策が無害な依頼に反応する頻度は85%減少しました。生命科学では専門用語だけを見ると危険そうでも、実際には基礎研究や安全確認のための質問が多くあります。正当な研究を止めにくくしながら、高度な能力には別の利用条件を設けるのが今回の考え方です。ただし、誤反応が減ったことは安全が完全になったことを意味しません。内容、目的、権限を確認し、専門家の監督下で使う必要があります。数値と運用を分けて見ましょう。",
          "audio": "audio/dlg_005_02_male.mp3",
          "duration_sec": 33.096
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Mythosは米国の審査済み組織向け。企業用の追加安全策は今秋提供予定で、条件確認が必要です。",
          "naration_text": "高度なMythos 5.1は、Cyber Verification ProgramまたはLife Sciences Verification Programを通じた審査済み組織向けで、発表時点では米国の組織に限られます。さらに、顧客が管理するデータ基盤で動くEnterprise Frontier Safeguardsが今秋に提供される予定です。機密データを自社の管理境界に置きつつ、最先端モデルへ追加の保護を組み合わせる構想ですが、動画公開時点では予定であり、利用前の条件確認が必要です。",
          "audio": "audio/dlg_005_03_female.mp3",
          "duration_sec": 31.248
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "新規APIには蒸留対策も導入。生成物と権限を伴う操作は必ず人が確認し、安全に活用しましょう。",
          "naration_text": "新規のAPIアカウントには、Claudeの推論内容を大量に抽出し、別モデルへ模倣させる蒸留を防ぐ対策も導入されています。安全は、モデル内部の制御だけで完成するものではありません。利用者側でも、与える権限を必要最小限にし、外部システムへの変更前に承認を挟み、生成されたコードや研究結果を検証することが重要です。性能が上がるほど実行できる範囲も広がるため、安全策と人の確認をセットで強くする必要があります。",
          "audio": "audio/dlg_005_04_male.mp3",
          "duration_sec": 29.28
        }
      ],
      "duration_sec": 127.848
    },
    {
      "id": "scene_999",
      "title": "まとめ — 科学で働くAI、その可能性と確認責任",
      "accent": "#d97706",
      "accent_soft": "rgba(217, 119, 6, 0.18)",
      "layout": "hero",
      "kicker": "SUMMARY",
      "headline": "Claude Fable 5.1が示した前進\n成果を活かす鍵は人の確認",
      "lead": "科学、コード、料金、安全策の進歩を、提供条件と限界も含めて振り返ります。",
      "image": "images/scene_999.png",
      "source_summary": "Fable 5.1は科学研究、コーディング、知識労働で前進し、キャッシュ値下げと安全策の精度向上も示した。一方、公式条件と実務の差、限定提供、人の確認が重要。",
      "factual_bullets": [
        "科学研究エージェントの公式評価は24.7%から52.6%へ向上",
        "科学分野で具体的な研究成果が報告された",
        "キャッシュ読み込み値下げと安全策の過剰反応削減を同時に実施",
        "生成結果、コード、外部変更、権限操作は利用者による確認が必要",
        "この動画はAiDiyのニュース版ビデオ生成機能で自動生成"
      ],
      "forbidden_elements": [
        "科学研究が自動化だけで完了するという表現",
        "性能、安全性、費用を保証する表現",
        "確認されていない提供条件の補完"
      ],
      "image_prompt": "Optimistic summary of responsible AI-assisted science: protein research, coding, knowledge documents and Venus mapping orbiting a human review checkpoint, two friendly presenters, warm amber sunrise with blue technology accents, room for Japanese headline, 16:9.",
      "dialogue": [
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Claude Fable 5.1は、科学研究エージェントの評価を二倍以上へ伸ばしました。",
          "naration_text": "まとめましょう。Claude Fable 5.1は、科学研究エージェントのTerminal-Bench-Science 0.1で、Fable 5の24.7%から52.6%へ伸びました。さらにMythos 5.1を用いたタンパク質設計、計算生物学の高速化、金星地図の高解像度化という具体例が示されました。今回の見出しにある『AIが科学の現場で成果を出しはじめた』とは、試験の点数だけでなく、研究工程で測れる成果が見え始めた、という解説です。",
          "audio": "audio/dlg_999_01_male.mp3",
          "duration_sec": 29.064
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "コードと知識労働の性能、長い文脈、キャッシュ値下げが実用性を押し上げ、長い仕事を助けます。",
          "naration_text": "コーディングではTerminal-Bench 4.0、CursorBench 3.2.0で前進し、ツール利用ありのHumanity's Last Examでも65.0%を記録しました。100万トークンのコンテキストと最大12万8千トークンの出力は、長い資料や大きなコードを扱う仕事を支えます。さらにキャッシュ読み込みが75%値下げされ、繰り返し資料を参照するエージェント型の仕事を試しやすくなりました。ただし実際の効果は仕事の形によって変わります。",
          "audio": "audio/dlg_999_02_female.mp3",
          "duration_sec": 30.84
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "安全策は止め過ぎを減らしましたが、提供条件と人による最終確認を守り、安全な運用を続けましょう。",
          "naration_text": "安全面では、サイバー分野の誤検知を60%、生物分野で無害な依頼に反応する頻度を85%減らしました。一方、Mythos 5.1は検証プログラムを通じた米国の審査済み組織向けです。数値は公式条件での結果で、実務の品質や費用を保証しません。科学の成果も、そのまま製品や治療になるわけではありません。料金、地域、上限、提供時期の最新情報を確かめ、生成結果と重要な操作は必ず人が確認しましょう。能力と責任を一緒に考えることが大切です。",
          "audio": "audio/dlg_999_03_male.mp3",
          "duration_sec": 34.152
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "AiDiyで確かな情報を楽しく伝え、次のAIニュース解説を一緒に作り、明るい学びを広げましょう。",
          "naration_text": "この動画は AiDiy のニュース版ビデオ生成機能で自動生成されました。AiDiyなら、確認した資料をもとにシナリオ、画像、字幕、ナレーションを組み合わせ、難しいニュースを分かりやすい解説へ育てられます。もちろん、自動生成された情報と表現を人が確認することが大切です。これからもAIと科学の変化を楽しく追いかけたい方は、ぜひチャンネル登録をお願いします。自分でも AiDiy で最新AIニュースの解説ビデオを作ってみて、学びを明るく届けていきましょう！",
          "audio": "audio/dlg_999_04_female.mp3",
          "duration_sec": 33.024
        }
      ],
      "duration_sec": 127.08
    }
  ],
  "total_duration_sec": 898.008
};
