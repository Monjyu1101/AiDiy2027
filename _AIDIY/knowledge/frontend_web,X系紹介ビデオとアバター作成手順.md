# X系紹介ビデオとアバター作成手順

> 文書: `frontend_web,X系紹介ビデオとアバター作成手順.md` | 実装: `frontend_web/public/Xビデオ/AiDiy紹介__all_ja/`, `frontend_web/public/Xビデオ/_vrm/`

## このメモを使う場面

- 新しい紹介ビデオ（`AiDiy紹介_<テーマ>_ja`）を作成するとき
- アバター版プレゼンターを新しく作成・改版するとき
- シーンの追加・修正をするとき
- index.html の `sceneFrame.src` 参照方式を確認したとき

---

## シーン構成の基本ルール

すべての紹介ビデオは以下の枠組みで作る。

| シーン | 役割 | 内容 |
|--------|------|------|
| `scene_000` | 冒頭説明 | このビデオで「何を紹介するか」を 10〜15 秒で示す導入。ヒーロー構造（`stage-hero stage-hero-focus`）。 |
| `scene_001` 〜 `scene_NNN` | 本編 | 通常シーン構造（左ビジュアル + 右コンテンツ）。テーマごとに章立て。 |
| `scene_999` | 謝辞とまとめ | 「ご視聴ありがとうございました」+ 全体まとめ + **次につながる言葉**（視聴者の行動・次の挑戦を促す問いかけ）でしめる。ヒーロー構造。 |

「次につながる言葉」の例（`AiDiy紹介__all_ja/scene_999`）:

```text
ご視聴ありがとうございました。
あなたなら AiDiy でなにを創りますか？
```

`AiDiy紹介__all_ja` は全テーマを通す総合版で、**新規ビデオ作成時の手本（reference）として参照する**。
専門テーマ版（`_avatar_ja`、`_hermes_ja` など）を作る場合も、scene_000 と scene_999 の構造とトーンは `__all_ja` に揃える。

---

## ナレーション音声

ナレーションは **`freeai:female` を基準**とする（`scenario.js` の `assets_policy.tts_provider: "freeai:female"`）。AiDiy 関係の全ビデオ（紹介・実装・実例など `Xビデオ/AiDiy*`）は特段の理由がない限り `freeai:female` で統一する。
専門テーマ版（`_avatar_ja`、`_hermes_ja` など）も同じプロバイダ・声で揃える。

- 生成は `aidiy_text_to_speech` MCP を使う。MCP クライアントが不要な場合は以下の HTTP POST でも同等の処理を呼び出せる。
  ```
  POST http://127.0.0.1:8095/aidiy_text_to_speech/synthesize
  Body: { "text": "ナレーション本文", "provider": "freeai", "voice": "female",
          "save_path": "D:/.../audio/scene_NNN.mp3" }
  Response: audio/mpeg バイナリ（save_path 指定時はファイルにも同時保存）
  ```
- 紹介ビデオの再生スピードは `ratio` 指定なし、または `ratio=None` で収録する。現時点の標準速度は 1.2 倍
- `aidiy_text_to_speech` は `ratio=None`（未指定）を既定の 1.2 倍として扱う。`ratio=0` / `ratio=1` は速度調整なしになるため、通常収録では指定しない
- **出力形式は必ず MP3**（WAV は禁止）。各プロバイダは内部で PCM → WAV → MP3 変換（ffmpeg 優先、lameenc フォールバック）する
- **フォールバック**は `backend_tools/tools_proc/text_to_speech.py` 側に実装で持つ（ここには書かない）。
- 発音辞書は `_config/mcp_text_to_speech.json` が単一の正本
- `scenario.js` の `narration` を変更したら、必ず同じテキストで音声を再生成して `audio/scene_NNN.mp3` を更新する（表示テキストと音声の乖離防止）
- 詳細手順は [`共通,mcp利用による自動ビデオ生成手順.md`](./共通,mcp利用による自動ビデオ生成手順.md) を参照

---

## short / long モード（プレイヤー機能）

`index.html` のプレイヤーは **ショート／ロング 2 段階の再生モード**に対応している。

### scenario.js への追加フィールド

各シーンに 4 フィールドを追加する:

### ナレーション文章の作り方

| モード | 目安 | 注意 |
|--------|------|------|
| `short_narration` | 全シーン合計 **1 分以内**（60 秒以下） | まず普通に書いて音声生成・計測した後、長ければ 1 割程度削る。削りすぎず内容は残す |
| `long_narration` | 制限なし（1 シーン 40〜60 秒程度が目安） | 詳しく丁寧に説明する。削る必要はない |

**ショート作成の流れ**: ① 全シーン分を書く → ② 音声生成・実尺計測 → ③ 合計が 60 秒超えなら各シーンを 1 割程度削る（削りすぎない）

| フィールド | 説明 |
|-----------|------|
| `short_narration` | ショートモード用ナレーションテキスト（1〜3 文程度） |
| `long_narration` | ロングモード用ナレーションテキスト（詳しい説明） |
| `short_audio` | ショート音声ファイルパス（例: `"audio/short_scene_001.mp3"`） |
| `long_audio` | ロング音声ファイルパス（例: `"audio/long_scene_001.mp3"`） |
| `short_duration_sec` | ショート音声の実尺（秒） |
| `short_start_sec` | ショートモードでの累積開始時刻（秒） |
| `long_duration_sec` | ロング音声の実尺（秒） |
| `long_start_sec` | ロングモードでの累積開始時刻（秒） |

シナリオルートにも合計値を追加する:

```javascript
window.SCENARIO = {
  // ...
  "short_duration_sec": 19.516,   // ショートモード合計尺
  "long_duration_sec": 261.817,   // ロングモード合計尺
  "duration_sec": 122.736,        // 通常モード合計尺
  "scenes": [ ... ]
};
```

### 音声ファイル命名規則

```
audio/
  short_scene_000.mp3   ← ショートモード用
  long_scene_000.mp3    ← ロングモード用
  scene_000.mp3         ← 通常モード用（既存）
```

### プレイヤー（index.html）の動作

- コントロールバー: `◁ 前頁` | `[ショート/ロング]ボタン` | `▶ 再生` | `次頁 ▷` | `最初から`
- モードボタンクリックで `audioMode`（`"short"` / `"long"`）をトグル
- グローバルタイムライン（プログレスバー）はモードに合わせた合計尺を使う
- `short_start_sec` / `long_start_sec` がシーンの全体タイムライン上の位置を決める
- モード切替時はプレイヤーが現在シーンを再レンダリングして切替後の音声・尺に合わせる

### 音声生成後の尺更新手順

TTS で音声を生成したら Python で duration を再計算し `scenario.js` を更新する:

```python
# 各シーンの実測 duration を埋め込み、short/long の累積 start_sec を計算
short_cumulative = 0.0
for scene in scenarios["scenes"]:
    dur = get_mp3_duration(f"audio/short_{scene['id']}.mp3")
    scene["short_start_sec"] = short_cumulative
    scene["short_duration_sec"] = dur
    short_cumulative += dur
scenario["short_duration_sec"] = short_cumulative
```

---

## ディレクトリ構造

各ビデオは `frontend_web/public/Xビデオ/AiDiy紹介_<テーマ>_ja/` 直下に配置する。
`__all_ja` は総合版（手本）、`_<テーマ>_ja` はテーマ特化版。

各ビデオのシナリオ・HTML・画像・音声は動画フォルダで管理します。VRMは兄弟の `_vrm/` を共有するため、動画フォルダだけで配布が完結するとは限りません。配布時はimportmap、共有CSS / JSを含めて参照先を確認します。

### 総合版（`__all_ja`）

```
Xビデオ/AiDiy紹介__all_ja/
  index.html        プレイヤー（iframe + VRM アバター + 音声制御）
  scenario.js       window.SCENARIO 定義（scenes 配列）
  scene.css         全シーン共通スタイル
  scene_000.html    冒頭説明（ヒーロー）
  scene_001.html 〜 scene_NNN.html  本編
  scene_999.html    謝辞・まとめ・次につながる言葉（ヒーロー）
  ../_vrm/          共有VRMモデル（配布時も必要）
  images/           MCP 画像生成で作成した scene_NNN.png
  audio/            MCP TTS で作成した scene_NNN.mp3
```

### テーマ特化版を新設する場合

現行の紹介テンプレートは `frontend_web/public/Xビデオ/AiDiy紹介__all_ja/` です。旧テーマ別フォルダは現存しないため参照元にせず、新しい題材に合わせてsceneと素材を作ります。共有VRMの参照規則は次節を使います。

### VRM 参照パス（共通フォルダ集約のルール）

- VRM は `frontend_web/public/Xビデオ/_vrm/` の 1 箇所だけに置く（`VRM_AiDiy.vrm` / `VRM_female.vrm` / `VRM_male.vrm`）
- `index.html`、`scenario.js` 内の VRM パスは **`../_vrm/VRM_AiDiy.vrm`**（共通フォルダ相対）にする
- ビデオフォルダ内へ VRM を複製しない。差し替えが 1 箇所で済むことを優先する
- 新しいビデオフォルダを作成するときは、既存ビデオと同じ `../_vrm/` 参照をそのまま引き継ぐ

---

## 重要ルール：シーンはページ単位（個別 HTML）

`index.html` の `sceneFrame.src` は **`scene.id + ".html"`** で読み込む。
クエリパラメータ方式（`scene.html?n=N`）は使用しない。

```javascript
// ✅ 正しい
sceneFrame.src = scene.id + ".html";   // → "scene_001.html"

// ❌ 古い方式（使ってはいけない）
sceneFrame.src = `scene.html?n=${sceneIndex + 1}`;
```

各 `scene_NNN.html` は完全な HTML ファイルとして個別に作成する。
`scene.css` を `<link rel="stylesheet" href="scene.css">` で読み込む。

---

## scenario.js の構造

```javascript
window.SCENARIO = {
  "project_name": "...",
  "version": "take4",          // "avatar" の場合もある
  "assets_policy": {
    "audio_dir": "audio",
    "image_dir": "images",
    "avatar": "../_vrm/VRM_AiDiy.vrm"  // 共通VRMへの相対パス
  },
  "scenes": [
    {
      "id": "scene_000",       // HTML ファイル名と一致させる
      "start_sec": 0.0,
      "duration_sec": 11.616,
      "expression": "neutral", // アバター表情
      "accent": "#29d8ff",     // CSS --accent に適用
      "layout": "hero",        // hero の場合は stage-hero クラス
      "hero_image_focus": true,
      "audio": "audio/scene_000.mp3",  // フルパスか相対パス
      "image": "images/scene_000.png",
      // ... chips / metrics / cards / facts / evidence
    }
  ],
  "duration_sec": 90.912       // 全シーン合計
}
```

---

## シーン HTML の構造

### 通常シーン（左ビジュアル + 右コンテンツ）

```html
<div id="stage" class="stage fade-enter"
     style="--accent:#29d8ff;--accent-soft:rgba(41,216,255,0.18);">
  <section class="visual-panel">
    <div class="visual-meta">
      <div class="kicker">KICKER TEXT</div>
      <div class="scene-id">scene_001 / 2 of 10</div>
    </div>
    <div class="image-shell">
      <img class="scene-image" src="images/scene_001.png" ...>
      <div class="image-placeholder">画像を読み込み中...</div>
      <div class="image-overlay">
        <div class="image-overlay-copy">
          <div class="image-title">タイトル</div>
          <p class="image-subtitle">サブタイトル</p>
        </div>
      </div>
    </div>
  </section>
  <section class="content-panel">
    <div class="content-scroll">
      <!-- header-row / chip-row / metric-row / card-grid / detail-grid -->
    </div>
  </section>
</div>
```

### ヒーローシーン（scene_000 / scene_999）

```html
<div id="stage" class="stage stage-hero stage-hero-focus fade-enter"
     style="--accent:#29d8ff;--accent-soft:rgba(41,216,255,0.18);">
  <div class="hero-image-wrap">
    <img class="hero-image" src="images/scene_000.png" ...>
  </div>
  <div class="hero-overlay">
    <div class="hero-kicker">KICKER</div>
    <h1 class="hero-title">タイトル</h1>
    <div class="hero-headline">
      <span class="headline-line">...</span>
    </div>
    <p class="hero-lead">リード文</p>
    <div class="hero-meta">scene_000 / 1 of 10</div>
  </div>
</div>
```

---

## アバター版固有のルール

### VRM アバター統合

- `index.html` の左パネル（38%）に Three.js + `@pixiv/three-vrm` でレンダリング
- VRM ファイル: `../_vrm/VRM_AiDiy.vrm`（動画フォルダの兄弟にある共有資産）
- リップシンク: `window.audioPlayer`（`<audio>` タグ）の AudioContext + AnalyserNode で `aa` 表情を駆動
- `window.__avatarSetExpression?.(scene.expression || "neutral")` でシーン切替時に表情を設定

### 音声・画像の参照先

アバター版は既存 take の音声・画像を再利用する。パスは相対で指定する:

```javascript
"audio": "../AiDiy紹介ビデオtake4/audio/scene_001.mp3"
"image": "../AiDiy紹介ビデオtake4/images/scene_001.png"
```

### aidiy_sozai の使用範囲

`aidiy_sozai/` フォルダはアバター関連の素材のみ使用する。業務画面スクリーンショット（配車管理、生産計画など）は使わない。

| 使う素材 | 用途 |
|---------|------|
| `aidiy_sozai/アイディ.png` | hero シーン（scene_000、scene_999） |
| `aidiy_sozai/frontend_avatar_webモード.png` | scene_005 AIコアとアバターの Web モード説明 |
| `aidiy_sozai/frontend_avator_desktopモード.png` | scene_005 AIコアとアバターの Desktop モード説明 |

上記以外のシーンでは take の `images/scene_NNN.png` を使う。

---

## 新 take 作成の流れ

1. `AiDiy紹介ビデオtakeN/` フォルダを作成
2. `scenario.js` を定義（scenes 配列、audio/image パス）
3. `scene.css` を既存 take からコピー
4. `index.html` を既存 take からコピーし、`sceneFrame.src = scene.id + ".html"` を確認
5. MCP（TTS / 画像生成）で `audio/` と `images/` を生成
6. 各 `scene_NNN.html` を個別に作成（ヒーローは hero 構造、それ以外は visual+content 構造）
7. `assets.json` / `scenario.json` は自動生成または省略可

## アバター版作成の流れ

1. `AiDiy紹介アバター/` フォルダを作成
2. ベースにする take を決め、`scenario.js` でその音声・画像を参照
3. `scene.css` を take からコピー
4. `index.html` を VRM 統合版として作成（左 38% アバター、右 62% iframe）
5. 各 `scene_NNN.html` を個別に作成（avatar 版でも構造は take と同じ）
6. hero シーンと scene_005（アバター説明）だけ `aidiy_sozai/` の画像を使う

---

## よくある間違い

| 間違い | 正しい対処 |
|--------|-----------|
| `scene.html?n=N` で切り替えようとする | `scene.id + ".html"` で個別ファイルを参照する |
| アバター版で全シーンに aidiy_sozai 画像を使う | アバター関連（アイディ、web/desktop モード）のみ使い、他は take の images を使う |
| 通常シーンに `stage-hero` を付ける | `stage-hero` / `stage-hero-focus` はヒーローシーン（000, 999）のみ |
| アバター版で音声を独自生成しようとする | 既存 take の `audio/` を相対パスで参照する |
| `vrm/VRM_AiDiy.vrm`（フォルダ内相対）で参照する | 共通フォルダの `../_vrm/VRM_AiDiy.vrm` を参照する |
| ビデオフォルダごとに VRM を複製する | `frontend_web/public/Xビデオ/_vrm/` の 1 箇所だけを共有する |
