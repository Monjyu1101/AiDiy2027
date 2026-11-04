# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

import argparse
import base64
from pathlib import Path


def encode_file_to_base64_text(input_path: Path, output_path: Path, line_width: int = 76) -> None:
    binary_data = input_path.read_bytes()
    base64_text = base64.b64encode(binary_data).decode("ascii")

    if line_width > 0:
        wrapped = "\n".join(
            base64_text[index:index + line_width]
            for index in range(0, len(base64_text), line_width)
        )
    else:
        wrapped = base64_text

    output_path.write_text(wrapped + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="バイナリファイルを BASE64（改行付き）テキストに変換します。"
    )
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        default=Path("aidiy_docs.zip"),
        help="入力バイナリファイル（既定: aidiy_docs.zip）",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("aidiy_docs.txt"),
        help="出力テキストファイル（既定: aidiy_docs.txt）",
    )
    parser.add_argument(
        "--line-width",
        type=int,
        default=76,
        help="1行あたりの文字数（既定: 76、0以下で改行なし）",
    )

    args = parser.parse_args()

    if not args.input.exists():
        raise FileNotFoundError(f"入力ファイルが見つかりません: {args.input}")

    encode_file_to_base64_text(args.input, args.output, args.line_width)
    print(f"変換完了: {args.input} -> {args.output}")


if __name__ == "__main__":
    main()
