# -*- coding: utf-8 -*-
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------
"""文書用画像を縦横比を保って縮小する。別の台帳やログは作らない。"""

import argparse
import os
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillowが必要です。python -m pip install Pillow で導入してください。")


対応拡張子 = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}


def 画像を列挙(対象一覧: list[Path]) -> list[Path]:
    結果 = set()
    for 対象 in 対象一覧:
        if not 対象.exists():
            raise ValueError(f"対象がありません: {対象}")
        候補 = 対象.rglob("*") if 対象.is_dir() else [対象]
        for ファイル in 候補:
            if ファイル.is_file() and ファイル.suffix.lower() in 対応拡張子:
                結果.add(ファイル.resolve())
    return sorted(結果)


def 画像を縮小(ファイル: Path, 最大幅: int, 最大高さ: int, 確認のみ: bool) -> bool:
    with Image.open(ファイル) as 元画像:
        if 元画像.width <= 最大幅 and 元画像.height <= 最大高さ:
            return False
        if getattr(元画像, "n_frames", 1) != 1:
            raise ValueError("複数フレームの画像は上書きしません")
        if 確認のみ:
            return True
        倍率 = min(最大幅 / 元画像.width, 最大高さ / 元画像.height)
        幅 = max(1, min(最大幅, round(元画像.width * 倍率)))
        高さ = max(1, min(最大高さ, round(元画像.height * 倍率)))
        縮小画像 = 元画像.resize((幅, 高さ), Image.Resampling.LANCZOS)
        形式 = 元画像.format
        保存設定 = {}
        for キー in ("icc_profile", "dpi"):
            if キー in 元画像.info:
                保存設定[キー] = 元画像.info[キー]
        if 形式 == "PNG":
            保存設定.update(optimize=True, compress_level=9)
        elif 形式 == "JPEG":
            保存設定.update(quality=90, subsampling=0, optimize=True)
        elif 形式 == "WEBP":
            保存設定.update(lossless=True, method=6)
        with tempfile.NamedTemporaryFile(
            prefix=".画像サイズ調整-", suffix=ファイル.suffix,
            dir=ファイル.parent, delete=False,
        ) as 一時ファイル:
            一時パス = Path(一時ファイル.name)
        try:
            縮小画像.save(一時パス, format=形式, **保存設定)
            with Image.open(一時パス) as 確認画像:
                if 確認画像.size != (幅, 高さ):
                    raise ValueError("保存後の画像サイズが一致しません")
                確認画像.verify()
        except BaseException:
            一時パス.unlink(missing_ok=True)
            raise
        finally:
            縮小画像.close()
    # Windowsでも元画像を閉じてから、検証済みのファイルで置き換える。
    try:
        os.replace(一時パス, ファイル)
    finally:
        一時パス.unlink(missing_ok=True)
    return True


def main() -> int:
    パーサー = argparse.ArgumentParser(description="文書用画像の縦横を上限以内にそろえます。小さい画像は拡大しません。")
    パーサー.add_argument("paths", nargs="*", type=Path, help="画像またはフォルダ。省略時は同じ資料フォルダのimages全体")
    パーサー.add_argument("--max-width", type=int, default=960, help="横幅の上限。既定値: 960")
    パーサー.add_argument("--max-height", type=int, default=960, help="縦幅の上限。既定値: 960")
    パーサー.add_argument("--check", action="store_true", help="変更せず確認。サイズ超過や読込エラーがあれば終了コード1")
    引数 = パーサー.parse_args()
    if 引数.max_width < 1 or 引数.max_height < 1:
        パーサー.error("--max-width と --max-height は1以上にしてください")
    try:
        対象画像 = 画像を列挙(引数.paths or [Path(__file__).resolve().parent.parent / "images"])
    except (OSError, ValueError) as エラー:
        パーサー.error(str(エラー))
    変更数 = 0
    エラー数 = 0
    for 番号, ファイル in enumerate(対象画像, 1):
        try:
            変更数 += 画像を縮小(ファイル, 引数.max_width, 引数.max_height, 引数.check)
        except Exception as エラー:
            エラー数 += 1
            print(f"処理できません: {ファイル}: {エラー}", file=sys.stderr, flush=True)
        if 番号 % 50 == 0:
            print(f"確認中: {番号}/{len(対象画像)}枚", flush=True)
    処理名 = "サイズ超過" if 引数.check else "縮小"
    print(f"全{len(対象画像)}枚、{処理名}{変更数}枚、変更不要{len(対象画像) - 変更数 - エラー数}枚、エラー{エラー数}件", flush=True)
    return 1 if エラー数 or (引数.check and 変更数) else 0


if __name__ == "__main__":
    raise SystemExit(main())
