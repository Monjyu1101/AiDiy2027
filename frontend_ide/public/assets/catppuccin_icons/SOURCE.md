# Catppuccin Icons — 同梱SVGの出典

- GitHub: https://github.com/catppuccin/vscode-icons
- Git: https://github.com/catppuccin/vscode-icons.git
- Release: v1.26.0
- Commit: b6915da9f6889b683a110aa747de96c2820a537d
- 固定した原文: https://github.com/catppuccin/vscode-icons/tree/b6915da9f6889b683a110aa747de96c2820a537d
- ライセンス: MIT。著作権表示・全文は同梱の LICENSE
- Copyright (c) 2023 Catppuccin / Copyright (c) 2023 thang-nm

icons/mocha/ から22種類を無改変でコピーしています。元のファイル名、SVGの内容を保持し、各ファイルの原文パスとSHA-256は manifest.json に記録しています。npm依存・VS Code拡張・外部CDNは使用しません。

AiDiyの非商用条件はAiDiy独自実装に適用されます。ここに同梱した第三者素材の利用条件を置き換えたり、MITの許諾を制限したりするものではありません。再配布時はこのフォルダのLICENSEと出典情報を保持してください。

## 採用範囲

ファイル、フォルダ開閉、コード、文章、README、ライセンス、JSON、設定、環境設定、DB、画像、音声、動画、圧縮、バイナリ、3D、フォント、表、ロック、Markdown、コマンドの種類を選んでいます。各言語は汎用コード（xml.svg）、PDF・Word・PowerPoint等は汎用文書（text.svg）、表計算は表（csv.svg）で示します。YAML/TOMLも設定カテゴリです。言語・製品ロゴそのものは収録していません。

表示の対応は src/components/ファイル閲覧/ファイルアイコン.js が管理します。上流の src/defaults/fileIcons.ts を参考に、AiDiyの実ファイルと一般的な形式へ絞って独自に対応付けています。ファイル名 → 複合拡張子 → 拡張子 → 汎用ファイルの順で解決します。フォルダは開閉だけを切り替え、同梱配色は既存エクスプローラーの暗色背景用Mochaに固定します。2Dページも同じSVGを24pxで使い、クリーム背景に合わせたCSSフィルターで表示だけを暗くします。元SVGや配色別ファイルは追加・変更しません。

Markdown記号の元デザインはDustin CurtisのMarkdown Mark（CC0/Public Domain）です。追加の出典・原文は MARKDOWN_LICENSE に収録しています。Catppuccin版SVGの同梱条件は上記MITです。

MITは第三者の商標権やブランドロゴの利用許諾まで保証するものではありません。今後ブランド素材を追加する場合は、Catppuccinのライセンスだけでなく各権利者の条件も個別に確認してください。
