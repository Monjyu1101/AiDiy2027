# 02の途中切替・袖の実形状回帰

リポジトリルートから次を実行します。

```sh
node frontend_web/public/Xアバター訓練中/tests/test_motion02_interruptions.mjs
```

同じフォルダーの`sleeve_geometry.mjs`を使います。Nodeと既存のfrontend_avatar依存関係以外に、Python・追加npmパッケージ・ブラウザー・ネットワークは不要です。
環境変数`MOTION_QA_MODULES`で依存関係の場所、`MOTION_QA_REPORT`でJSON保存先を指定できます。`MOTION_QA_SOURCE`は別版のindex.html/motions.js、`MOTION_QA_MOTION_ROOT`は別版のVRMAとgenerate.pyを指します。既定では実ページを相対解決し、出力ファイルを作りません。

## 検証内容

実ページのスクリプトを VM で実行し、ES import 文だけをローカルの同一バージョンへ置き換えます。アニメーション処理は複製しません。DOM、Renderer、Clock、RAF、ファイル通信だけが代替で、GLTFLoader、VRM/VRMA、AnimationMixer、normalized→raw 変換、VRM 更新は本物です。

27 ケースで 02→999、02→05、05→02 の 7 時点、同一モーションの連続要求、往復、終了から再開、同一フレーム内の要求、02 を含まない直近ラベル同士に対する継承を検査します。同一フレームケースは、0 秒の要求の間で `step(0)` も呼ばず、最後の要求の後に初めて更新します。

主な名前付き検査:

- 変更要求直後の表示 raw 骨と Body 全頂点の連続性
- 02 の袖クリアランス状態が中断・同一フレームの要求をまたいで継承されること。完全な中立 999 から初めて 02 に入る時だけは不要な外向き pulse を要求しない
- 未補正ソースが実クリップの interpolant と一致し、未追跡の回転・移動が正しくリセットされること
- 両足の位置と回転が実ページの補間アンカーに一致すること
- raw 元 glTF の独立スキニングが Three の最適化済み skinned mesh と一致すること
- 最終 999 が action / transition を解放し、raw 骨が中立状態へ戻ること
- 新たな不透明袖頂点の物理的な皮膚侵入が、同じ頂点の開始・終了・中立基準より 0.5 mm を超えて増えないこと

位置の source / foot / request / raw skin 一致は 0.001 mm、要求時 raw 回転は 0.001 度。終了時の Body 全頂点は secondary spring の小さな残留を考慮して 0.01 mm、raw 骨は 0.001 mm のままです。隣接フレームの移動量は記録しますが、見た目の自然さの合否基準にはしません。

## 正確な幾何判定と基準接触の扱い

Body の実 glTF を読み、実行中の raw world matrix × inverse bind matrix で全 13,537 頂点を変形します。最適化済み Three ジオメトリーとの比較は各 primitive の複数頂点を使います。

袖は Body primitive 3 の全頂点が lowerArm・hand 系 joint の合計 weight > 0.75 となる 932 面、1,540 辺です。ターゲットは Body 全 12 material から、各頂点の upperArm・lowerArm・hand 系 weight < 0.1 の面を選びます。腕の縫い合わせを除き、骨盤・太腿・皮膚・衣服を含みます。胴体の狭い凸包によるフィルターは使いません。

袖辺→Body 面と Body 辺→袖面の両方向で Möller–Trumbore を実行します。保守的 AABB / refit BVH は候補削減だけに使います。交点の UV を辺・面の重みで求め、埋め込み PNG のアルファを bilinear 補間し、双方 >= 0.5 の交点を記録します。PNG decoder は Node zlib を用い、対象モデルの 8 bit・非 interlace を明示的に要求します。

物理深さは、非腕の皮膚面を使った 6 軸 ray parity のうち 4 方向以上が内部の不透明袖頂点に対し、最寄り皮膚三角形への正確な距離を求めます。頂点 ID、深さ、world 座標、最寄り三角形、時刻、基準値を出力します。

中立 999 は既存の全衣服交点 244 と物理深さ約 3.90643 mm、05 のピーク開始姿勢は全衣服交点 198 と約 0.668 mm の既存侵入があります。これを新しい 02 遷移の欠陥と混同しません。開始・終了・中立の接触を別に保存し、交点数と新しい edge/triangle 組の数は診断だけにします。合否は交点数ではなく、同じ袖頂点の基準に対して増えた物理侵入深さで判定します。

## 限界

- sampled frame の幾何 QA です。フレーム間の連続衝突や見た目、手の意味、shader、画面、配信、CORS、CDN を保証しません
- ray parity は腕を除いた開いた skin subset への診断です。閉じた solid の数学的な内外証明ではありません。交点検査を併記する理由です
- 線分の端点、ほぼ平行・coplanar の面、完全な内包、頂点間だけの最深侵入は完全には検出しません
- 袖と skin の joint・material 選択は `VRM_AiDiy.vrm` 固有です。モデル変更では領域契約と基準の再確認が必要です
- PNG alpha は base-color を使い、MToon、mipmap、実ピクセルの可視性を再現しません
- 終点基準は実際に観測した終点です。別途クリップそのものと終了後の姿勢を検査する既存テストと併用します
