# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""
PNG画像を透過に変換するツール
黒以外の色を透明にします（デフォルト）
"""
from PIL import Image
import sys
import os

# Windowsコンソールでの文字化け対策
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


def make_transparent(input_path, output_path=None, keep_color=(0, 0, 0), threshold=30):
    """
    PNG画像の指定色以外を透明に変換
    
    Args:
        input_path: 入力画像パス
        output_path: 出力画像パス（Noneの場合は元のファイル名に_transparentを追加）
        keep_color: 残す色 (R, G, B) デフォルトは黒(0, 0, 0)
        threshold: 色の許容範囲（0-255）デフォルトは30
    """
    try:
        # 画像を開く
        img = Image.open(input_path).convert("RGBA")
        
        # ピクセルデータを取得
        pixels = list(img.getdata())

        new_data = []
        for item in pixels:
            # RGBの差分を計算
            r_diff = abs(item[0] - keep_color[0])
            g_diff = abs(item[1] - keep_color[1])
            b_diff = abs(item[2] - keep_color[2])

            # しきい値以内なら残す、それ以外は透明にする
            if r_diff < threshold and g_diff < threshold and b_diff < threshold:
                new_data.append(item)  # そのまま残す
            else:
                new_data.append((255, 255, 255, 0))  # 完全に透明

        # 新しいデータを適用
        img.putdata(new_data)
        
        # 出力パスが指定されていない場合は自動生成
        if output_path is None:
            base, ext = os.path.splitext(input_path)
            output_path = f"{base}_transparent{ext}"
        
        # 保存
        img.save(output_path, "PNG")
        print(f"✓ 変換完了: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"✗ エラー: {e}", file=sys.stderr)
        return None


def main():
    """コマンドライン実行"""
    if len(sys.argv) < 2:
        print("使い方: python png_to_transparent.py <入力画像> [出力画像] [R] [G] [B] [threshold]")
        print("")
        print("例:")
        print("  python png_to_transparent.py input.png")
        print("  python png_to_transparent.py input.png output.png")
        print("  python png_to_transparent.py input.png output.png 0 0 0 30")
        print("")
        print("オプション:")
        print("  R G B       : 残す色 (0-255) デフォルト: 0 0 0 (黒)")
        print("  threshold   : 色の許容範囲 (0-255) デフォルト: 30")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    # 色指定
    if len(sys.argv) >= 6:
        keep_color = (int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]))
    else:
        keep_color = (0, 0, 0)  # デフォルト: 黒
    
    # しきい値
    threshold = int(sys.argv[6]) if len(sys.argv) > 6 else 30
    
    print(f"入力: {input_path}")
    print(f"残す色: RGB{keep_color}")
    print(f"許容範囲: {threshold}")
    print("")
    
    make_transparent(input_path, output_path, keep_color, threshold)


if __name__ == "__main__":
    main()
