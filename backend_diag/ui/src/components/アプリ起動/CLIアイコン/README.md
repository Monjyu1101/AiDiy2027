# CLI ランチャーの画像素材

外部 CLI は CLI ID と同じ名前の SVG / PNG をここに保存します。AiDiy Hermes は `command_hermes/assets/AiDiy_hermes.svg` / `.png` が正本で、ここには `aidiy_hermes.png` の配布コピーだけを置きます。ライセンス・引用元・権利上の注意は [LICENSE_ICONS.md](./LICENSE_ICONS.md) を参照してください。

## 表示用の画像

CLI 素材は 120×120px の自己完結した SVG と PNG 派生物です。外部 CLI は SVG、Hermes はローカル PNG を表示します。ミニ表示では 40×40px の画像として使います。画像内に白い名前帯があるため、HTML 側で同じキャプションを重ねて表示しません。

| CLI ID / ファイル名 | 画像内の名前 | ロゴ・人物の保存原本 |
|---|---|---|
| `claude.svg` / `claude.png` | Claude | `upstream/claude-code-color-lobe.svg` |
| `codex.svg` / `codex.png` | Codex | `upstream/codex-devicons.svg` |
| `copilot.svg` / `copilot.png` | Copilot | `upstream/copilot-24.svg` |
| `agy.svg` / `agy.png` | Antigravity | `upstream/antigravity-logo-mark.svg` |
| `grok.svg` / `grok.png` | Grok | `upstream/Grok_Logomark_Light.svg` |
| `opencode.svg` / `opencode.png` | OpenCode | `upstream/opencode-logo-dark-square.svg` |
| `vscode.svg` / `vscode.png` | VS Code（青帯・白文字） | `upstream/vscode-stable.svg` / `upstream/vscode-stable.png` |
| `aidiy_hermes.png`（配布コピー） | HERMES | `command_hermes/assets/AiDiy_hermes.svg` / `.png`（人物素材: `_icons/AiDiy.png`） |

- 共通の外枠は `viewBox="0 0 120 120"`。外部CLI6件は上部の x=18、y=3、84×84px に原本を縦横比を維持して配置します。元のパス、グラデーション、色、viewBox は保持し、トレース・描き直し・切り抜きは行いません。Copilot は従来の暗色 UI 用 `#f0f6fc` を維持します。
- 名前帯は x=0、y=90、120×30px、白 `#ffffff`。外部CLIの名前は中央揃え・黒 `#000000`・22px 太字です。フォント指定は Arial / Liberation Sans / sans-serif で、フォントファイルの埋め込み・配布はありません。
- 外部CLIの40px 表示時はロゴの最大表示枠が28px、名前帯が10px、文字指定が約7.3pxです。長い OpenCode も省略せず表示します。より大きい表示では同じ SVG を等比拡大してください。
- ロゴ領域の背景は透明です。Copilot / Grok / OpenCode は明るい図形を含むため、暗色 UI 上で表示します。外部CLIの白い名前帯は1つだけで、元の図形と重なりません。
- Claude Code / Codex は LobeHub が配布する製品専用の第三者素材です。合成画像をベンダーの公式配布ファイルとは称しません。Antigravity は Antigravity 公式サイトのヘッダーにある虹色の山形マークです。
- Hermes の人物部分は既存の AiDiy PNG を無改変バイトの data URI として埋め込みます。人物は512×512pxのラスターで、ベクター化していません。AiDiyアプリと同じ全面配置（x=0、y=0、120×120px）にし、下部25%へHERMES帯を1つ重ねます。文字は中央x=60、基準線y=113、Arial Black / Arial / sans-serif、23px・weight900で左右の余白を確保します。表示用 PNG は120×120pxの合成結果なので、原本とバイト同一ではありません。

SVG / PNG の外部ネットワーク参照はありません。保存原本は加工しません。共通人物原画は `_icons/AiDiy.png`（既存の Web / Avatar の原画コピーと byte 同一）です。

## Visual Studio Code の公式アイコン

`vscode.svg` は 120×120px の表示用合成画像です。公式青色 stable SVG を x=18、y=3、84×84px に等比配置し、x=0、y=90、120×30px の青帯 `#1e3a5f` と白 `#ffffff` の VS Code を追加しています。文字は中央 x=60、基準線 y=111、Arial / Liberation Sans / sans-serif、22px、weight700。外部 CLI の白帯・黒文字とは配色で区別します。`vscode.png` はこの SVG に対応する120×120pxの透過RGBA画像です。名称変更時はロゴ領域の画素を保持し、帯だけを再描画します。原画の形状・色は維持しますが、表示用全体は公式配布原画とは異なる加工物です。

原本と配布元 README は `upstream/vscode-stable.svg`、`upstream/vscode-stable.png`、`upstream/README-VSCode.txt` に保存します。VS Code アイコンへ他素材の MIT ライセンスを適用しません。更新時も公式配布物を使用し、[LICENSE_ICONS.md](./LICENSE_ICONS.md) のハッシュと条件を更新してください。

## 再生成

生成スクリプトは常設しません。作り直すときは、一度きりのスクリプトを `temp/` に作り、上記の仕様どおりに SVG を作ってから PNG を書き出します。アプリ起動時に変換処理は不要です。

- 原本: 外部 CLI は `upstream/`、Hermes は `command_hermes/assets/` と `_icons/AiDiy.png` を保守時に使います。保存原本の SHA-256 が [LICENSE_ICONS.md](./LICENSE_ICONS.md) の記録と一致することを確かめてから使います。Windows の checkout で SVG が CRLF になっている場合は LF に戻して照合します。AiDiy PNG は常にバイト単位で照合します。
- SVG: 原本 SVG を入れ子 SVG（`x=18 y=3 width=84 height=84`、`preserveAspectRatio="xMidYMid meet"`）として共通枠に入れ、白帯と黒字の名前を追加します。Hermes は原本 PNG を data URI の `<image>` としてx=0、y=0、120×120pxに埋め込み、上記の帯と文字を重ねます。
- PNG: 合成した SVG から 120×120px の透過 PNG（RGBA）を書き出します。ヘッドレス Edge の `--headless=new --default-background-color=00000000 --window-size=120,120 --screenshot` で出力できます。
- 原本・ライセンスファイルは書き換えません。更新後は `backend_diag/ui` で `npm run build` を実行し、`static/` へ反映します。

配布 UI のビルド・静的ファイル同期は別の手順です。配布時は `LICENSE_ICONS.md`、`LICENSE-Octicons.txt`、`LICENSE-LobeHub.txt`、`LICENSE-OpenCode.txt` を同名のまま `static/` へ同梱し、相互の参照先を維持します。旧名 `CLI_LICENSES.txt` は使いません。

AiDiy 系全体の所有者は `_AIDIY/knowledge/共通,アイコン原本と配布.md` を参照。正本からの PNG コピーは明示的な保守作業です。通常 build / verify / test は Diag 内の PNG / CSS だけを使い、他 module の asset を読みません。
