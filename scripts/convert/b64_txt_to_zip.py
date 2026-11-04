# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

import argparse
import base64
from pathlib import Path


def decode_base64_text_to_file(input_path: Path, output_path: Path) -> None:
    base64_text = input_path.read_text(encoding="utf-8")
    normalized = "".join(base64_text.split())

    try:
        binary_data = base64.b64decode(normalized, validate=True)
    except Exception as exc:
        raise ValueError("入力テキストが正しい BASE64 形式ではありません。") from exc

    output_path.write_bytes(binary_data)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="BASE64（改行付き可）テキストをバイナリファイルに復元します。"
    )
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        default=Path("aidiy_docs.txt"),
        help="入力テキストファイル（既定: aidiy_docs.txt）",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("aidiy_docs_restored.zip"),
        help="出力バイナリファイル（既定: aidiy_docs_restored.zip）",
    )

    args = parser.parse_args()

    if not args.input.exists():
        raise FileNotFoundError(f"入力ファイルが見つかりません: {args.input}")

    decode_base64_text_to_file(args.input, args.output)
    print(f"復元完了: {args.input} -> {args.output}")


if __name__ == "__main__":
    main()
