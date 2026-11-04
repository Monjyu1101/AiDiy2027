window.SCENARIO = {
  "project_name": "ニュース_20260906_gemini38flash_ja",
  "version": "duo-v2",
  "language": "ja",
  "title": "Gemini 3.8 Flash 発表――安さと「よく考える」のトレードオフ",
  "assets_policy": {
    "male_avatar": "../_vrm/VRM_male.vrm",
    "female_avatar": "../_vrm/VRM_female.vrm",
    "tts_male": "edge:male",
    "tts_female": "edge:female",
    "audio_output_dir": "frontend_web/public/Xビデオ/ニュース_20260906_gemini38flash_ja/audio"
  },
  "source_documents": [
    {
      "label": "Google公式 Gemini API モデル一覧",
      "url": "https://ai.google.dev/gemini-api/docs/models"
    },
    {
      "label": "Google Cloud公式 Gemini 3.8 Flash 開発者ガイド",
      "url": "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash"
    },
    {
      "label": "Google DeepMind公式 Gemini Flash モデルページ",
      "url": "https://deepmind.google/models/gemini/flash/"
    },
    {
      "label": "Google公式発表",
      "url": "https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/"
    },
    {
      "label": "eesel AI 解説",
      "url": "https://www.eesel.ai/blog/gemini-3-8-flash"
    },
    {
      "label": "LLM Stats 集計",
      "url": "https://llm-stats.com/models/gemini-3.8-flash"
    },
    {
      "label": "DataCamp 解説",
      "url": "https://www.datacamp.com/blog/gemini-3-8-flash-cyber"
    }
  ],
  "scenes": [
    {
      "id": "scene_000",
      "title": "イントロ――Gemini 3.8 Flash、速さだけではない新しいFlash",
      "accent": "#4285f4",
      "accent_soft": "rgba(66, 133, 244, 0.18)",
      "layout": "hero",
      "kicker": "AI NEWS / 2026.09.02",
      "headline": "Gemini 3.8 Flash 発表\n安さと「よく考える」のトレードオフ",
      "lead": "安価なFlash系が上位モデル級の成績へ。ただし、よく考えるほど時間とトークンを使う点が読み解きの鍵です。",
      "image": "images/scene_000.png",
      "source_documents": [
        "https://ai.google.dev/gemini-api/docs/models",
        "https://www.eesel.ai/blog/gemini-3-8-flash",
        "https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/"
      ],
      "source_summary": "Googleが2026年9月2日に公開したGemini 3.8 Flashを、性能、推論量、料金、待ち時間のトレードオフから初心者向けに解説する。",
      "factual_bullets": [
        "公開日は2026年9月2日",
        "Gemini 3.7 Flashを基にしたFlash系モデル",
        "単価だけでなく使用トークン量と待ち時間も評価軸",
        "ベンチマークは公表条件での結果であり実務性能を保証しない"
      ],
      "forbidden_elements": [
        "誰でも今すぐ使えるという断言",
        "必ず安い、必ず速い、必ず正しいという表現",
        "実在企業のロゴやベンチマーク数値を画像内に捏造すること"
      ],
      "image_prompt": "日本語のAIニュース番組風。中央に高速処理と深い思考を表す二つの光路、青と緑のテクノロジー配色、左右に女性と男性の解説者用余白。文字や企業ロゴは描かず、16対9の端正な報道ビジュアル。",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashの最新ニュースをAiDiy生成動画で分かりやすく解説します",
          "naration_text": "こんにちは。このニュース解説動画は AiDiy のニュース版ビデオ生成機能で作られています。今回取り上げるのは、Googleが2026年9月2日に公開したGemini 3.8 Flashです。見出しは「Gemini 3.8 Flash 発表――安さと『よく考える』のトレードオフ」。Flashという名前から単純な速さだけを想像しがちですが、今回は複雑な仕事で立ち止まり、推論を重ねる設計が大きな特徴です。何が進化し、どんな注意が必要なのか、確認済みの情報を軸に見ていきましょう。",
          "audio": "audio/dlg_000_01_female.mp3",
          "duration_sec": 35.04
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは安い単価だけでなく考える量と待ち時間が重要です",
          "naration_text": "Flashなら、安くて何でも即答してくれるモデルだと思ってしまいます。けれどGemini 3.8 Flashを見るときは、料金表の単価だけでは足りません。難しい依頼では追加の推論ステップを使い、必要に応じてツールを何度も呼ぶため、返答を始めるまで待つ場面や、出力トークンが増える場面があります。つまり見るべき軸は三つです。一つ目が入力と出力の単価、二つ目が実際に使うトークン量、三つ目が最初の応答までの時間。この三つを分ければ、安さと体感の関係がつかめます。",
          "audio": "audio/dlg_000_02_male.mp3",
          "duration_sec": 31.872
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashの公表値は実務で同じ結果になる保証ではありません",
          "naration_text": "ここで大切な前提も押さえましょう。これから紹介するベンチマークは、公表された測定条件での結果です。皆さんの業務で同じ品質、同じ処理時間、同じ費用になることを保証する数字ではありません。入力の長さや指示の書き方、与えた権限、接続するツールやシステムによって結果は変わります。利用可否や地域別条件、提供時期について、資料で確認できない部分を推測で補うこともしません。事実と、そこから読み取れる解説を区別しながら進めます。",
          "audio": "audio/dlg_000_03_female.mp3",
          "duration_sec": 33.936
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashを性能・設計・料金・提供条件の順に詳しく確認します",
          "naration_text": "了解です。まず発表の位置づけと提供先を確認し、次にコーディング、学術、金融、法務のベンチマークを、何を測る試験なのか身近な言葉に置き換えます。そのあと、毎秒302.1トークンという出力速度と、最初の一文字まで13.30秒という独立計測を読み解きます。さらに年末までの料金と2027年からの改定、100万トークンの文脈長、対応入力、Cyber版の限定条件、安全性指標まで整理します。最後には、用途に合うか判断するチェックポイントもまとめます。",
          "audio": "audio/dlg_000_04_male.mp3",
          "duration_sec": 34.392
        }
      ],
      "duration_sec": 135.24
    },
    {
      "id": "scene_001",
      "title": "発表の概要――6週間で3度目のFlash系リリース",
      "accent": "#34a853",
      "accent_soft": "rgba(52, 168, 83, 0.18)",
      "kicker": "RELEASE OVERVIEW",
      "headline": "Gemini 3.8 Flashとは\nどこで、誰が使えるのか",
      "lead": "Gemini 3.7 Flashを基礎にした新モデル。幅広い提供先と、防御側限定のCyber版は分けて理解します。",
      "image": "images/scene_001.png",
      "source_documents": [
        "https://ai.google.dev/gemini-api/docs/models",
        "https://www.eesel.ai/blog/gemini-3-8-flash",
        "https://www.datacamp.com/blog/gemini-3-8-flash-cyber"
      ],
      "source_summary": "Gemini 3.8 Flashは6週間で3度目のFlash系リリースで、モデルカードでは3.7 Flashを基にしたモデルとされる。Cyber版はFairwind Programの審査済み防御側限定。",
      "factual_bullets": [
        "6週間で3度目のFlash系リリース",
        "モデルカードはGemini 3.7 Flashを基にしたモデルと記載",
        "AI Studio、Gemini API、各種Google製品で提供",
        "Cyber版はFairwind Programの審査済み防御側のみ"
      ],
      "forbidden_elements": [
        "Cyber版が一般商用提供されているという表現",
        "資料にない地域別条件や提供時期の断定",
        "すべての提供先を無条件で無料利用できるという表現"
      ],
      "image_prompt": "日本語AIニュースの説明図。中央に新しいAIモデルを示す抽象的な半導体、周囲にAPI、開発環境、スマートフォン、検索、表計算を示す一般的なアイコン。右下に盾で守られた限定領域。文字、企業ロゴ、実在UIは描かない。",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは六週間で三度目となるFlash系の新モデルです",
          "naration_text": "Gemini 3.8 Flashは2026年9月2日に公開されました。報道では、わずか6週間で3度目となるFlash系のリリースだと整理されています。短期間に番号が進んでいるため、まったく別の系統へ一新したようにも見えますが、モデルカードにはGemini 3.7 Flashを基にしたモデルであることが繰り返し記載されています。つまり、前世代で培った高速・低価格の路線を土台に、複雑な仕事へより丁寧に取り組む能力を強めた更新として理解するのが自然です。",
          "audio": "audio/dlg_001_01_female.mp3",
          "duration_sec": 31.824
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは開発環境から検索や表計算まで幅広く提供されます",
          "naration_text": "提供先はかなり幅広いですね。開発者はGoogle AI StudioとGemini API、Android Studio、Google Antigravityから扱えます。組織向けにはGemini Enterprise、一般利用の接点としてGeminiアプリと検索のAI Modeも挙げられています。さらにGoogleスプレッドシートではAI ProまたはUltraが必要という条件つきで提供されます。ただし、アカウント、契約、地域、製品側の展開状況によって見え方が変わる可能性があるため、実際に使う前には各公式画面と最新文書で確認しましょう。",
          "audio": "audio/dlg_001_02_male.mp3",
          "duration_sec": 33.0
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flash Cyberは審査済みの防御側だけに限定提供されます",
          "naration_text": "同時に案内されたGemini 3.8 Flash Cyberは、通常版と同じ感覚で誰でも選べるモデルではありません。Fairwind Programを通じて、政府機関、重要インフラの運営者、ソフトウェア保守者など、審査を通過した防御側の組織や担当者に限って提供されます。目的もサイバー防御です。一般の商用提供はされていないため、通常版の幅広い提供先と混同しないことが重要です。「Cyberという名前だから一般ユーザーも使える」と広げず、限定提供という境界をそのまま伝えます。",
          "audio": "audio/dlg_001_03_female.mp3",
          "duration_sec": 35.232
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashの利用可否は製品・契約・最新公式情報で確認しましょう",
          "naration_text": "要するに、Gemini 3.8 Flash本体はAPIから日常のGoogle製品まで接点が広がり、Cyber版は厳格な対象限定という二層構造です。ニュースの一覧だけを見ると「どこでも同じ条件で使える」と受け取りがちですが、提供先が多いことと、全利用者が同時に同条件で利用できることは別です。モデル名が画面に表示されるか、必要なプランは何か、対象地域か、組織の管理者設定が許すかを利用時点で確かめる必要があります。この留保を置いたうえで、次は注目を集めた性能値へ進みます。",
          "audio": "audio/dlg_001_04_male.mp3",
          "duration_sec": 33.096
        }
      ],
      "duration_sec": 133.152
    },
    {
      "id": "scene_002",
      "title": "ベンチマーク――上位モデルに並ぶ項目と試験の意味",
      "accent": "#f9ab00",
      "accent_soft": "rgba(249, 171, 0, 0.18)",
      "kicker": "BENCHMARKS",
      "headline": "Gemini 3.8 Flashの公表成績\n数字を仕事の場面へ置き換える",
      "lead": "端末操作、ソフトウェア開発、難問、金融、法務。数字の大小だけでなく、試験が測る能力を理解します。",
      "image": "images/scene_002.png",
      "source_documents": [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash",
        "https://deepmind.google/models/gemini/flash/",
        "https://www.eesel.ai/blog/gemini-3-8-flash"
      ],
      "source_summary": "Google公式には評価条件の異なる複数の結果がある。標準開発者評価表のTerminal-bench 2.1は90.8%（3.7 Flashは81.6%）だが、Humanity's Last Examは45.4%（同45.7%）とわずかに下回る。別の公式比較ではTerminal-bench 2.1が89.4%（Claude Opus 5は89.1%）で、DeepSWE v1.1、HLE-Verified、金融、法務でも上位級の結果が示された。",
      "factual_bullets": [
        "Terminal-bench 2.1は開発者ガイドで90.8%（3.7 Flashは81.6%）",
        "別の公式比較表ではTerminal-bench 2.1が89.4%、Claude Opus 5は89.1%",
        "DeepSWE v1.1は73.7%、3.7 Flashは65.3%、Claude Opus 5は74.0%",
        "HLE-Verifiedは54.9%（3.7 Flash 53.6%、Opus 5 54.4%）",
        "Vals Finance Agent v2は61.4%、Harvey法務評価は10.0%"
      ],
      "forbidden_elements": [
        "ベンチマーク首位を万能性の証明として扱うこと",
        "公表条件を実務の保証へ読み替えること",
        "評価条件の異なる表の数字を同じ測定結果として混ぜること"
      ],
      "image_prompt": "AI性能を五つの実務試験で比較する日本語ニュース風インフォグラフィック。端末、コード、難問、金融、法務を抽象アイコンで表し、複数モデルの棒グラフを想起させる構図。具体的な数値やロゴは描かず、字幕を重ねる余白を確保。",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "端末操作は公式の評価条件により90.8パーセントと89.4パーセントです",
          "naration_text": "最も目を引くのがTerminal-bench 2.1です。AIがターミナル、つまり文字で操作するパソコン画面を使い、設定や修正を最後まで進められるかを見る試験です。Googleの標準開発者評価表ではGemini 3.8 Flashが90.8%、3.7 Flashが81.6%でした。一方、別の公式比較では3.8 Flashが89.4%、Claude Opus 5が89.1%です。同じ試験名でも公式資料ごとに数字が異なるため、評価設定の異なる結果として分けて扱い、表をまたいで単純な優劣を断定しないことが大切です。",
          "audio": "audio/dlg_002_01_female.mp3",
          "duration_sec": 40.992
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "長期開発課題は73.7パーセント。Claude Opus 5の74.0パーセントに肉薄です",
          "naration_text": "長いソフトウェア開発の力を見るDeepSWE v1.1では73.7%でした。Gemini 3.7 Flashの65.3%から8.4ポイント伸び、Claude Opus 5の74.0%とはわずか0.3ポイント差です。これはコードの一問一答ではなく、リポジトリを読み、原因を探し、複数の変更を組み合わせて課題を終えられるかを見る試験です。たとえるなら、工具の名前を答えるのではなく、作業場を見渡して修理を完了できるかを見る試験ですね。安価なFlash系が上位モデルとほぼ横並びに来た点は大きな前進ですが、実際の開発では言語、テスト、権限、レビュー体制にも左右されます。",
          "audio": "audio/dlg_002_02_male.mp3",
          "duration_sec": 39.216
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "難問評価は条件で明暗。45.4パーセントと54.9パーセントを分けて見ます",
          "naration_text": "難問評価には名前の似た二つの結果があります。標準開発者評価表のHumanity's Last Examは45.4%で、3.7 Flashの45.7%をわずかに下回りました。一方、別のHLE-Verifiedは54.9%で、3.7 Flashの53.6%、Claude Opus 5の54.4%を上回っています。どちらも幅広い専門知識と推論を試しますが、評価条件が異なるため45.4と54.9を直接比べてはいけません。この下がった項目も含めると、3.8 Flashが公表された全項目で前世代を上回った、とは言えないことが分かります。",
          "audio": "audio/dlg_002_03_female.mp3",
          "duration_sec": 42.576
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "金融は61.4パーセント、法務は10.0パーセント。人の確認は必要です",
          "naration_text": "金融業務を段取りよく進める力を見るVals Finance Agent v2は61.4%で、3.7 Flashの59.0%、Claude Opus 5の58.6%を上回りました。Harveyの法務エージェント評価は10.0%で、同じ評価の3.7 Flashは8.8%、Claude Opus 5は6.7%です。金融評価は資料や手順を使う実地試験、法務評価は複雑な法務作業をどこまで完了できるかを見る難しい試験、と考えると分かりやすいでしょう。ただし法律や金融は誤りの影響が大きい分野です。相対的に高い成績でも、専門家の確認が不要という意味ではありません。",
          "audio": "audio/dlg_002_04_male.mp3",
          "duration_sec": 38.76
        }
      ],
      "duration_sec": 161.544
    },
    {
      "id": "scene_003",
      "title": "よく考える設計――速い出力と遅い初動が同居",
      "accent": "#a142f4",
      "accent_soft": "rgba(161, 66, 244, 0.18)",
      "kicker": "THINKING TRADE-OFF",
      "headline": "Gemini 3.8 Flashはなぜ\n速いのに待つことがあるのか",
      "lead": "出力開始後は高速でも、考え始めてから最初の応答までは長め。多い推論とツール利用が背景にあります。",
      "image": "images/scene_003.png",
      "source_documents": [
        "https://ai.google.dev/gemini-api/docs/models",
        "https://llm-stats.com/models/gemini-3.8-flash",
        "https://www.eesel.ai/blog/gemini-3-8-flash"
      ],
      "source_summary": "Googleは複雑な作業で追加推論と反復ツール呼び出しを行うと説明。Artificial Analysisでは出力302.1トークン毎秒、初回応答13.30秒、出力量は中央値より約70%多い。",
      "factual_bullets": [
        "意図的に思考トークンを多く使う",
        "ツールを繰り返し呼び出す設計",
        "出力速度は毎秒302.1トークン",
        "初回応答は13.30秒、全体中央値は2.99秒",
        "同じ課題群で中央値より約70%多い出力トークン"
      ],
      "forbidden_elements": [
        "常に13.30秒かかるという断言",
        "毎秒302.1トークンを全環境の保証値として扱うこと",
        "3.7 Flashが廃止されたという表現"
      ],
      "image_prompt": "思考開始までの砂時計と、開始後に高速で流れる光のトークン列を対比したAIニュース図。中央に複数回のツール呼び出しを表す循環矢印。紫と青の配色、文字やロゴなし、16対9。",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは複雑な仕事ほど推論とツール利用を重ねる設計です",
          "naration_text": "成績の裏側にあるのが「よく考える」設計です。Googleは、Gemini 3.8 Flashが複雑な作業へより丁寧に取り組み、追加の推論ステップを実行し、必要ならツールを繰り返し呼び出すと説明しています。人にたとえると、質問を見てすぐ答えるのではなく、下書きを作り、資料を調べ、計算し、もう一度確かめてから返す動きです。この過程では意図的に思考トークンを多く使います。正答へ近づく可能性がある一方、処理量と請求対象が増えうることが、今回のトレードオフを生みます。",
          "audio": "audio/dlg_003_01_female.mp3",
          "duration_sec": 35.64
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは出力開始後に毎秒302.1トークンと高速に動きます",
          "naration_text": "独立計測のArtificial Analysisでは、出力速度が毎秒302.1トークンと報告されています。ここでいう出力速度は、モデルが答えを書き始めた後に、どれくらい勢いよく文章を返すかという指標です。長いコードや文書を画面へ流し出す場面では、非常に速い部類だと受け取れます。ただし、通信環境やサービス側の混雑、選ぶ処理モード、入力の内容によって、利用者が体感する速度は変わります。この数字は計測条件での観測値であり、すべての呼び出しに保証される速度ではありません。",
          "audio": "audio/dlg_003_02_male.mp3",
          "duration_sec": 32.568
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは最初の応答まで13.30秒と長めの計測結果です",
          "naration_text": "一方、同じ独立計測で最初のトークンが返るまで13.30秒かかりました。比較対象となる全体の中央値は2.99秒なので、答えを書き始めるまでの待ち時間は長めです。料理でいえば、盛り付けを始めれば速いのに、材料を確認して下ごしらえを終えるまで時間を使うイメージです。対話型の画面では、この最初の沈黙が体感差として現れる可能性があります。ただし毎回一定ではありません。難易度、入力長、ツール呼び出し、接続環境によって待ち時間は上下します。",
          "audio": "audio/dlg_003_03_female.mp3",
          "duration_sec": 35.904
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは約70パーセント多く出力し効率重視なら前世代も候補です",
          "naration_text": "さらに、同じ課題群を解くために、中央値より約70%多い出力トークンを使ったとされています。単価が低くても、使う量が多ければ総額の差は縮みます。ここで興味深いのは、Google自身が効率を優先する用途ではGemini 3.7 Flashを引き続き使うよう案内している点です。難しい課題を深く考えさせるなら3.8、短い分類や定型処理を軽く回すなら3.7も比較する、という選び方ができます。新しい番号が常に最適とは限らず、品質、総トークン、初動時間で測るのが実践的です。",
          "audio": "audio/dlg_003_04_male.mp3",
          "duration_sec": 34.416
        }
      ],
      "duration_sec": 138.528
    },
    {
      "id": "scene_004",
      "title": "料金――年末までの単価と2027年からの倍額改定",
      "accent": "#00acc1",
      "accent_soft": "rgba(0, 172, 193, 0.18)",
      "kicker": "PRICING",
      "headline": "Gemini 3.8 Flashの料金\n単価と使用量を掛けて考える",
      "lead": "2026年末までの導入単価と2027年からの単価を分け、Batch、Flex、Priorityの倍率も確認します。",
      "image": "images/scene_004.png",
      "source_documents": [
        "https://ai.google.dev/gemini-api/docs/models",
        "https://www.eesel.ai/blog/gemini-3-8-flash",
        "https://llm-stats.com/models/gemini-3.8-flash"
      ],
      "source_summary": "2026年末までは入力0.75ドル、出力3.75ドル、キャッシュ0.075ドル。2027年から各単価は倍。Batch/Flexは標準の50%、Priorityは180%。",
      "factual_bullets": [
        "2026年12月31日まで入力100万トークン0.75ドル",
        "同期間の出力3.75ドル、キャッシュ読み込み0.075ドル",
        "2027年1月1日から入力1.50ドル、出力7.50ドル、キャッシュ0.15ドル",
        "BatchとFlexは標準の50%、Priorityは180%"
      ],
      "forbidden_elements": [
        "将来の料金が変更されないという保証",
        "総費用が必ず他モデルより安いという断言",
        "税、為替、契約条件を含む最終請求額の断定"
      ],
      "image_prompt": "AI利用料金を、入力、出力、キャッシュの三つのメーターと、2026年末から2027年初めへ切り替わるカレンダーで示すニュース図。単価と利用量の掛け算を天秤で表現。文字、数字、ロゴなし。",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは2026年末まで入力100万トークン0.75ドルです",
          "naration_text": "料金は日付を分けて見る必要があります。2026年12月31日までは、入力100万トークンあたり0.75ドル、出力100万トークンあたり3.75ドル、キャッシュ読み込み100万トークンあたり0.075ドルです。入力は質問や資料としてモデルへ渡す文字量、出力は回答やコードとして返る量、キャッシュ読み込みは再利用できる内容を読み出す量だと考えてください。数字の桁が小さく見えても、実際の請求はそれぞれの単価に使用量を掛け、呼び出し全体で合計して決まります。",
          "audio": "audio/dlg_004_01_female.mp3",
          "duration_sec": 35.088
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは2027年元日から入力・出力・キャッシュが倍額です",
          "naration_text": "2027年1月1日からは予告された単価が倍になります。入力100万トークンあたり1.50ドル、出力は7.50ドル、キャッシュ読み込みは0.15ドルです。期間限定の導入単価だけで長期予算を作ると、年をまたいだ瞬間に想定との差が出ます。試験導入が2026年でも、本稼働が2027年なら後半の単価を基準に見積もるほうが安全です。料金と適用日は今後更新される可能性があるため、契約や公開前には公式料金表を再確認し、税や為替など自社条件も別に加えてください。",
          "audio": "audio/dlg_004_02_male.mp3",
          "duration_sec": 34.008
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 FlashのBatchとFlexは半額、Priorityは1.8倍です",
          "naration_text": "処理の出し方による倍率もあります。BatchとFlexは標準料金の50%、Priorityは標準の180%です。Batchは急がない仕事をまとめて処理する考え方、Priorityは費用を上乗せして優先度を求める考え方として捉えると分かりやすいでしょう。たとえば夜間に大量の文書を分類する仕事と、利用者を待たせたくない対話処理では、同じモデルでも選ぶ枠が変わります。ただし具体的な待ち時間や利用条件はサービスの最新仕様に従います。倍率だけでなく、締め切りと必要な応答性を一緒に決めましょう。",
          "audio": "audio/dlg_004_03_female.mp3",
          "duration_sec": 37.176
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashの総費用は単価・トークン量・再試行回数で判断します",
          "naration_text": "結論として「単価が安いから総額も必ず安い」とは言えません。Gemini 3.8 Flashは、よく考えるために出力トークンを多く使う傾向が報告されています。単価に、入力、思考を含む出力、キャッシュ、再試行の量を掛けて初めて費用が見えます。小さな実データで、同じ品質基準を満たすまで何回呼ぶかも測りましょう。さらに最初の応答までの待ち時間が業務に与える影響も費用の一部です。単価、使用量、待ち時間の三軸で3.7 Flashや他モデルと比較するのが堅実です。",
          "audio": "audio/dlg_004_04_male.mp3",
          "duration_sec": 32.88
        }
      ],
      "duration_sec": 139.152
    },
    {
      "id": "scene_005",
      "title": "仕様・提供・安全性――長い文脈と強いツール利用を人が監督",
      "accent": "#ea4335",
      "accent_soft": "rgba(234, 67, 53, 0.18)",
      "kicker": "SPECS & SAFETY",
      "headline": "Gemini 3.8 Flashの仕様\nできることと任せきれないこと",
      "lead": "100万トークンの文脈、マルチモーダル入力、ツール操作。広い能力ほど、人による確認と権限制御が重要です。",
      "image": "images/scene_005.png",
      "source_documents": [
        "https://ai.google.dev/gemini-api/docs/models",
        "https://www.datacamp.com/blog/gemini-3-8-flash-cyber",
        "https://www.eesel.ai/blog/gemini-3-8-flash"
      ],
      "source_summary": "100万トークンのコンテキスト、最大64,000トークン出力、五種類の入力と各種ツール機能に対応。モデルカードでは多言語安全性と不当な拒否の指標が望ましくない方向へ動いた。",
      "factual_bullets": [
        "コンテキストウィンドウは100万トークン",
        "最大出力は64,000トークン",
        "テキスト、画像、音声、動画、PDFを入力可能",
        "関数呼び出し、検索ツール、コンピューター操作に対応",
        "多言語安全性5.4ポイント、不当な拒否1.1ポイント悪化"
      ],
      "forbidden_elements": [
        "長い入力を常に完全理解するという断言",
        "ツール操作を無監督で安全に実行できるという表現",
        "安全性の後退を隠す、または過度に一般化すること"
      ],
      "image_prompt": "巨大な文脈窓へ文書、画像、音声、動画、PDFが流れ込み、検索、関数、コンピューター操作へ分岐するAIニュース図。外側に人間の確認を示すチェックと安全柵。赤と青の配色、文字やロゴなし。",
      "dialogue": [
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは100万トークンを読み最大6万4千を出力できます",
          "naration_text": "基本仕様を見ていきます。コンテキストウィンドウは100万トークン、最大出力は64,000トークンです。コンテキストは、一度の仕事で参照できる会話や資料の広さ、最大出力は一度に返せる回答の上限と考えてください。大量の文書や長いコードを扱える余地がありますが、上限まで入れれば内容を漏れなく理解し、必ず正しく答えるという意味ではありません。長い入力ほど重要箇所の指定、分割、検索、検証が必要です。また、実際に利用できる上限や課金対象は呼び出す製品と最新仕様で確認してください。",
          "audio": "audio/dlg_005_01_female.mp3",
          "duration_sec": 38.304
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは五種の入力と検索・関数・パソコン操作に対応します",
          "naration_text": "入力はテキストだけではありません。画像、音声、動画、PDFにも対応するため、写真の内容確認、会議音声の整理、映像の要約、資料の読み取りを一つのモデルへつなげられます。機能面では関数呼び出し、ツールとしての検索、コンピューター操作に対応します。AIが説明するだけでなく、外部機能を選び、情報を探し、画面操作へ進める設計です。便利な反面、渡す権限が広いほど影響も大きくなります。読み取りと変更を分け、許可する操作を絞り、実行前後に記録を残すことが重要です。",
          "audio": "audio/dlg_005_02_male.mp3",
          "duration_sec": 36.216
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashの安全性指標には二項目で望ましくない変化があります",
          "naration_text": "モデルカードでは、性能向上だけでなく安全性の後退も報告されています。多言語安全性の指標が5.4ポイント、不当な拒否が1.1ポイント、いずれも望ましくない方向へ動きました。前者は多言語で安全な応答を保つ力に懸念が増えたこと、後者は本来答えてよい依頼まで断る傾向が増えたことを示す材料です。この数字だけで、あらゆる日本語利用が危険だと一般化するべきではありません。一方で、都合の悪い指標を省くのも適切ではありません。用途別の日本語テストを自分たちで行いましょう。",
          "audio": "audio/dlg_005_03_female.mp3",
          "duration_sec": 37.104
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashの生成結果と重要な外部操作は必ず人が確認しましょう",
          "naration_text": "運用では、生成結果、コード、外部システムへの変更、権限を伴う操作を人が確認してください。特に法務、金融、セキュリティ、顧客データを扱う処理は、根拠の表示、テスト環境での実行、承認者によるレビュー、取り消し手順を組み合わせます。Cyber版が審査済みの防御側限定であることも、能力が高いほど対象と権限を慎重に管理する例です。Gemini 3.8 Flashは多くの形式を読み、ツールで行動できる強力なモデルですが、「できる」と「任せきれる」は別です。人が最終責任を持つ設計にしましょう。",
          "audio": "audio/dlg_005_04_male.mp3",
          "duration_sec": 35.976
        }
      ],
      "duration_sec": 147.6
    },
    {
      "id": "scene_999",
      "title": "まとめ――安さ、思考量、待ち時間を用途ごとに測る",
      "accent": "#4285f4",
      "accent_soft": "rgba(66, 133, 244, 0.18)",
      "layout": "hero",
      "kicker": "SUMMARY",
      "headline": "Gemini 3.8 Flashを\n三つの軸で選ぼう",
      "lead": "上位級の公表成績と低い単価は魅力。ただし、使用トークン、初動、安全性、提供条件を実データで確かめます。",
      "image": "images/scene_999.png",
      "source_documents": [
        "https://ai.google.dev/gemini-api/docs/models",
        "https://www.eesel.ai/blog/gemini-3-8-flash",
        "https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/",
        "https://llm-stats.com/models/gemini-3.8-flash",
        "https://www.datacamp.com/blog/gemini-3-8-flash-cyber"
      ],
      "source_summary": "確認済みの性能、推論特性、料金、仕様、提供条件、安全性を整理し、単価、使用量、待ち時間の三軸で用途適合性を判断する。AiDiyによる動画自動生成も案内する。",
      "factual_bullets": [
        "上位モデル級の公表ベンチマーク結果",
        "追加推論と反復ツール利用によるトレードオフ",
        "料金は2027年1月1日に倍額へ変更予定",
        "利用条件と価格は利用時点の公式情報を確認",
        "生成結果と重要操作は人が確認"
      ],
      "forbidden_elements": [
        "必ず安い、速い、正しいという断言",
        "提供条件や将来価格を固定情報として扱うこと",
        "人の確認が不要という表現"
      ],
      "image_prompt": "AIモデル選定のまとめを示す明るいニュースビジュアル。単価、トークン量、待ち時間の三つの天秤と、人間による確認チェックを中央に配置。青、緑、金の前向きな配色、左右に対話者用余白、文字やロゴなし。",
      "dialogue": [
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは小型・低価格帯ながら上位級の公表成績を示しました",
          "naration_text": "まとめましょう。Gemini 3.8 Flashは2026年9月2日に公開され、3.7 Flashを基にしながら、公表ベンチマークの複数項目で前世代を上回りました。端末操作や長期の開発課題、金融、法務では上位級の結果が示されています。一方、標準開発者評価のHumanity's Last Examは45.4%で、3.7 Flashの45.7%をわずかに下回りました。公式資料どうしでも評価設定により数字が異なるため、全項目で必ず向上したとはまとめません。小型で安価なFlash系が上位級へ近づいたことは意義がありますが、公表条件での結果であり、実務の品質、時間、費用を保証するものではありません。",
          "audio": "audio/dlg_999_01_male.mp3",
          "duration_sec": 42.528
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashは単価・使用量・待ち時間という三軸で評価しましょう",
          "naration_text": "選ぶときの合言葉は、単価、使うトークン量、待ち時間の三軸です。Gemini 3.8 Flashは出力開始後こそ高速ですが、独立計測では初回応答が長めで、同じ課題群に中央値より約70%多い出力トークンを使いました。よく考えることが品質へつながる一方、総費用と対話の体感へ影響します。定型処理や効率を優先するなら、Googleが案内する3.7 Flashも比較対象です。平均値だけで決めず、自分たちの入力と合格基準を用意し、小さく試してから処理方法を選びましょう。",
          "audio": "audio/dlg_999_02_female.mp3",
          "duration_sec": 38.232
        },
        {
          "speaker": "male",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 Flashの料金・提供条件・安全性は利用前に再確認が必要です",
          "naration_text": "確認事項も忘れずに。料金は2026年12月31日までの単価と、2027年1月1日から倍になる予告単価を分けます。提供先は広いものの、製品、契約、地域、展開状況で利用条件が変わりえます。Cyber版はFairwind Programの審査済み防御側だけです。モデルカードでは多言語安全性と不当な拒否の指標に望ましくない変化も報告されました。料金や条件は更新される可能性があるため、利用直前に公式情報を確認し、生成物、コード、権限を伴う操作は必ず人が検証してください。",
          "audio": "audio/dlg_999_03_male.mp3",
          "duration_sec": 36.528
        },
        {
          "speaker": "female",
          "expression": "neutral",
          "telop_text": "Gemini 3.8 FlashのニュースをAiDiyで楽しく確かめ次の一歩へ進もう",
          "naration_text": "最後までご覧いただき、ありがとうございました。この動画は AiDiy のニュース版ビデオ生成機能で自動生成されました。確認済みの情報と留保を分け、生成結果を人が確かめることを大切にしています。これからもAIの新情報を分かりやすくお届けしますので、ぜひチャンネル登録をお願いします。そして、自分でも AiDiy で最新AIニュースの解説ビデオを作ってみてください。調べた事実を楽しい掛け合いへ変え、学びをみんなと共有できます。確かめながら作るAI活用を、明るく一緒に楽しんでいきましょう！",
          "audio": "audio/dlg_999_04_female.mp3",
          "duration_sec": 36.216
        }
      ],
      "duration_sec": 153.504
    }
  ],
  "total_duration_sec": 1008.72
};
