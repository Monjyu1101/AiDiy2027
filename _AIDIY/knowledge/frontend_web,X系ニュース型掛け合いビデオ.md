# X系ニュース型掛け合いビデオ

> 文書: `frontend_web,X系ニュース型掛け合いビデオ.md` | 実装: `frontend_web/public/Xビデオ/ニュース_20260906_fable51_ja/index.html`, `frontend_web/public/Xビデオ/ニュース_20260906_fable51_ja/scenario.js`, `frontend_web/public/Xビデオ/ニュース_20260906_fable51_ja/_gen_dialogue_audio.py`

## このメモを使う場面

- ニュース解説型ビデオを新規作成・改版するとき
- 掛け合い（female/male 2アバター）プレイヤーの仕様を確認するとき
- 音声ファイルを追加・再生成するとき
- 紹介ビデオとニュース型ビデオの違いを確認するとき

---

## 紹介ビデオ vs ニュース型ビデオ：種別の違い

| 項目 | 紹介ビデオ（AiDiy紹介_\*） | ニュース型（ニュース_\*） |
|------|---------------------------|--------------------------|
| 音声 | **edge:female のみ** | **edge:female + edge:male の掛け合い** |
| アバター | 1体（VRM_AiDiy.vrm） | 2体（VRM_male.vrm 左, VRM_female.vrm 右） |
| 1シーン当たりの音声 | **1音声**（short_audio / long_audio） | **複数ターン**（dialogue 配列） |
| short/long モード | あり | **なし** |
| 字幕 | なし（ナレーションは iframe 内） | あり（telop_text → subtitle → text の順） |
| ページ構成 | scene_NNN.html（iframe 読み込み） | 単一 index.html（シーン内容をスクリプトで描画） |

→ 紹介ビデオの詳細は [`frontend_web,X系紹介ビデオとアバター作成手順.md`](./frontend_web,X系紹介ビデオとアバター作成手順.md) を参照。

---

## scenario.js の構造（ニュース型）

```javascript
window.SCENARIO = {
  "version": "duo-v2",
  "assets_policy": {
    "male_avatar": "../_vrm/VRM_male.vrm",
    "female_avatar": "../_vrm/VRM_female.vrm",
    "tts_male": "edge:male",
    "tts_female": "edge:female"
  },
  "scenes": [
    {
      "id": "scene_001",
      "kicker": "JANUARY 2026",           // 月表示バッジ
      "headline": "見出し\n2行目",
      "accent": "#ff6b35",                // テーマカラー
      "image": "images/scene_001.png",
      "dialogue": [
        {
          "speaker": "female",            // "female" or "male"
          "telop_text": "字幕に出る短文",   // 画面表示用（短い要約）
          "naration_text": "実際に読み上げる全文。音声ファイルの内容と一致させる。",
          "audio": "audio/dlg_001_01_female.mp3",
          "duration_sec": 8.5
        },
        {
          "speaker": "male",
          "telop_text": "相手の短い要約",
          "naration_text": "男性側の発話テキスト。",
          "audio": "audio/dlg_001_02_male.mp3",
          "duration_sec": 9.0
        }
        // ... 1シーン 8〜10 ターン程度
      ],
      "duration_sec": 84.0               // シーン内 dialogue の合計
    }
  ],
  "total_duration_sec": 693.0
};
```

### フィールドの使い分け

| フィールド | 用途 |
|-----------|------|
| `telop_text` | 字幕用の短文。旧 `subtitle` / `text` は再生側の互換フォールバック |
| `naration_text` | 音声原稿。綴りを含め現行JSON契約を維持する。生成スクリプトはscenarioから読み取る |
| `audio` | 音声ファイルパス（相対）。命名規則: `dlg_{scene}_{turn:02d}_{speaker}.mp3` |
| `duration_sec` | TTS 生成後の実尺（秒）。プレーヤーの保険タイマーに使う |

---

## 冒頭ナレーション

- ニュース版では、記事・ニュース内容を案内した直後に「このニュース解説動画は AiDiy のニュース版ビデオ生成機能で作られています」と明言する。
- この文は `scene_000` の最初の発話へ入れ、字幕用の `telop_text` にも短く反映する。
- 既存動画の文面を変更した場合は、該当 `audio/dlg_000_01_female.mp3` を再生成し、`duration_sec`、シーン合計、`total_duration_sec` を実尺へ更新する。

---

## 音声ファイル命名規則

```
audio/dlg_{scene}_{turn:02d}_{speaker}.mp3

例:
  dlg_000_01_female.mp3   ← scene_000 / ターン01 / female
  dlg_001_06_male.mp3     ← scene_001 / ターン06 / male
  dlg_999_09_female.mp3   ← scene_999 / ターン09 / female
```

- ターン番号は 2 桁ゼロパディング（`01`〜`10` など）
- female → `ja-JP-NanamiNeural`（Edge TTS）
- male → `ja-JP-KeitaNeural`（Edge TTS）

---

## 音声生成スクリプト（`_gen_dialogue_audio.py`）

各動画フォルダの `_gen_dialogue_audio.py` は標準ライブラリでHTTP APIを呼び、`scenario.js` の `dialogue[].naration_text` からタスクを作ります。旧スクリプトの手書き `DIALOGUES` や固定絶対パス、`TextToSpeech` の直接importを追加しません。

- 実行前にToolsを起動し、APIの接続先と出力先を確認する。ローカルPythonに `edge_tts` があることは、このHTTPクライアントの要件ではない。
- 500 bytes超の既存音声はスキップする。原稿を書き換えただけでは録り直されないため、対象を明示して再生成し、音声と原稿の一致を検証する。
- リクエストは `speech_text`、`language: "ja"`、`provider: "edge"`、`voice: "female"` または `"male"`、`save_path`。結果はJSONとして読み、エラーと保存ファイルを確認する。バイナリ直接応答を前提にしない。
- `ratio` 未指定 / `None` / `0` / `"auto"` はproviderの既定速度（Edgeは1.2倍）。`1` だけが無調整。同期元は `backend_tools/tools_proc/text_to_speech.py` の `_resolve_ratio_for_provider`。
- HTTP保存先の制約は [save_pathの挙動](./backend_tools,HTTP_API_save_path挙動.md) を参照する。

---

## プレイヤー（index.html）の主要仕様

### 2アバター配置

```
左端固定: VRM_male.vrm   → bodyYaw = Math.PI + Math.PI/6 (30°内側向き)
右端固定: VRM_female.vrm → bodyYaw = Math.PI - Math.PI/6 (30°内側向き)
```

- 固定表示（ページスクロールに追従しない `position: fixed`）
- 既定幅は `min(36vh, 30vw)`、高さは `75vh`（最大 `calc(100vh - 108px)`）。狭幅・縦画面のmedia queryでは縮小または非表示となる。

### 話者切替と暗転

```javascript
// 話者アバターを明るく、非話者アバターを暗転
.avatar-wrap.silent { filter: brightness(0.58) saturate(0.45); }
// opacity は変えない（透過禁止）
```

### ステレオパン

```javascript
// Web Audio API StereoPannerNode
pannerNode.pan.value = speaker === "male" ? -1.0 : 1.0;
// male → 左チャンネル (-1.0)
// female → 右チャンネル (+1.0)
```

### リップシンク

- `AnalyserNode` で再生音声のレベルを取得し、話者の VRM に `aa` 表情を適用
- 非話者は `lipsyncActive = false` → `mouthSmooth = 0`（即時クローズ）
- 両アバターが共有 `window._analyserNode` を読むが、自分の `lipsyncActive` フラグで適用可否を制御

### 字幕表示

```javascript
// 現行フィールドを優先し、旧データにも対応
subtitleText.textContent = turn.telop_text || turn.subtitle || turn.text || "";
```

### アバター表情

- `expression` フィールドに何が入っていても常に `"neutral"` で固定
- `window.__maleSetExpression?.("neutral")` / `window.__femaleSetExpression?.("neutral")`

---

## VRM ファイル

ニュース型ビデオは `Xビデオ/_vrm/` の共有 VRM を相対パスで参照する（自己完結不要）。

```javascript
// scenario.js の assets_policy
"male_avatar":   "../_vrm/VRM_male.vrm",
"female_avatar": "../_vrm/VRM_female.vrm"
```

紹介ビデオと同じ共有VRMを使い、各動画フォルダへ複製しません。

---

## 新しいニュース型ビデオを作る手順

1. `Xビデオ/ニュース_<テーマ>/` フォルダを作成
2. 既存の `ニュース_20260906_fable51_ja/` を手本として以下をコピー・修正:
   - `index.html` — プレイヤー本体（ほぼそのまま使える）
   - `scenario.js` — シーン・ダイアログ定義を書き直す
   - `_gen_dialogue_audio.py` — scenario読込とAPI接続・保存先を確認する
3. 導線を通す（ここまで済ませてから表示確認に進む）:
   - `src/components/Xビデオ.vue` に URL const とメニューカードを追加
   - `src/router/index.ts` に `createStaticAliasRoute('/Xビデオ/<フォルダ名>', 'Xビデオ/<フォルダ名>/index.html', 'Xビデオ')` を追加
   - 片方だけではメニューからも URL からもページを開けない
4. `images/` フォルダを作成し、各シーンの背景画像を配置
5. `audio/` フォルダを作成
6. Toolsを起動して `_gen_dialogue_audio.py` を実行し、HTTP応答と音声生成結果を確認
7. ブラウザで動作確認（字幕・口パク・暗転切替・ステレオパン）

自動化スクリプト（`ビデオページ生成_*.py`）では、この手順 3 が Step 02「ルーティング追加」に
あたる。Step 01「フォルダ作成」の直後はまだメニューもルートも無く開けないため、
ブラウザ表示は Step 02 が成功してから始まる。

---

## よくある間違い

| 間違い | 正しい対処 |
|--------|-----------|
| Tools停止中に生成を開始する | HTTPクライアントなので先にTools APIの起動・接続先を確認する |
| 字幕と音声原稿を混同する | `telop_text` は短い要約、`naration_text` は音声用の全文として分ける |
| 非話者アバターを `opacity` で透かす | `filter: brightness(0.58) saturate(0.45)` のみ使う（opacity は変えない） |
| VRM の向きが外側を向く | left アバターは `Math.PI + Math.PI/6`、right は `Math.PI - Math.PI/6` が内向き |
| `expression` に "happy" などを入れる | ニュース型は常に `"neutral"` 固定。フィールド値は無視される |
| メニューカードだけ追加してルートを足さない | `Xビデオ.vue` と `src/router/index.ts` の両方に追加する（自動化では Step 02 が両方を登録） |
| 既存音声を再生成してしまう | スクリプトのスキップ条件（500 bytes 超）で保護されるが、明示的に確認すること |
