# 外部ライブラリ・素材

- Three.js 0.185.1（MIT）: jsDelivr 経由で読み込み。https://github.com/mrdoob/three.js
- @pixiv/three-vrm 3.5.5（MIT）: jsDelivr 経由で読み込み。https://github.com/pixiv/three-vrm
- @pixiv/three-vrm-animation 3.5.5（MIT）: jsDelivr 経由で読み込み。https://github.com/pixiv/three-vrm
- VRM モデルは `frontend_avatar/public/vrm/VRM_AiDiy.vrm` と同一のリポジトリ共通素材 `frontend_web/public/Xビデオ/_vrm/VRM_AiDiy.vrm` を参照。
- `VRMA_00_現行.vrma` は `frontend_avatar/public/vrma/標準/VRMA_01.vrma` の複製。01〜20 は `vrma/generate.py` で生成。

CDN に接続できない環境では、アバターの 3D 表示は読み込めません。説明ページと一覧は表示できます。
