# X系静的画面追加

> 文書: `frontend_web,X系静的画面追加.md` | 実装: `frontend_web/src/router/index.ts`, `frontend_web/src/components/Xその他.vue`

## このメモを使う場面
- `frontend_web` の `Xその他` 配下にゲーム、デモ、マスコットなどの実験画面を追加する
- Vue ルートから `public/<画面名>/index.html` を iframe 表示する
- 既存の X系画面で静的 JS / Canvas / Three.js の不具合を直す

## 関連ファイル
- `frontend_web/src/router/index.ts` — X系ルートを `baseRoutes` に追加
- `frontend_web/src/components/Xその他.vue` — メニューカード
- `frontend_web/src/components/Xその他/<画面名>.vue` — iframe ラッパー
- `frontend_web/src/components/Xテスト/<画面名>.vue` — Vue 直実装の場合
- `frontend_web/public/<画面名>/index.html`
- `frontend_web/public/<画面名>/index.js`
- `frontend_web/public/<画面名>/style.css`
- `frontend_web/public/<画面名>/NOTICE.md` — 外部アセットや外部APIを使う場合

## 実装方式の判断

| 方式 | 使う場面 | 配置 |
|------|----------|------|
| 静的HTML + iframe | Canvasゲーム、Three.js単体デモ、外部CDNを使う実験 | `public/<画面名>/` + `components/Xその他/<画面名>.vue` |
| Vue 直実装 | 認証済みレイアウト内で完結し、Vue状態管理や既存部品を使う画面 | `components/Xテスト/<画面名>.vue` など |
| 別タブ直接表示 | 全画面体験を優先し、認証済みメニューから実験ページを開くだけの画面 | `public/<画面名>/index.html` |

業務データを表示・更新する画面は X系静的HTMLにせず、通常の Vue 画面として実装する。

## 追加手順
1. 静的HTML型か Vue 直実装型かを決める。
2. 静的HTML型では `frontend_web/public/<画面名>/index.html` / `index.js` / `style.css` を作る。
3. iframe 型では `src/components/Xその他/<画面名>.vue` を作る。
4. `src/router/index.ts` の `baseRoutes` に `/Xその他/<画面名>/ゲーム` または `/Xその他/<画面名>/表示` を追加し、`meta.requiresAuth: true` と `title` を設定する。
5. `src/components/Xその他.vue` にメニューカードを追加する。通常は `router-link` で `?URLメニュー=/Xその他` を渡す。
6. 外部ライブラリ、画像、音源、地図、フォント、外部APIを使う場合は `NOTICE.md` に出典、ライセンス、ネットワーク制限時の挙動を残す。

## iframe ラッパーの基準
- `frameSrc` は `const baseUrl = import.meta.env.BASE_URL || '/'` を使って `${baseUrl}<画面名>/index.html` とする。
- `URLメニュー` は `route.query.URLメニュー`、必要に応じて `URL戻り先` は `route.query.URL戻り先` から読み、全角 `？＆＝` を半角へ正規化してから `router.push()` する。
- ラッパーは `height: 100%`, `display: flex`、iframe は `flex: 1` または `height: 100%` を持たせる。
- iframe 内から親アプリの認証ストアや router へ直接触らない。戻る操作は Vue ラッパー側で担当し、`URL戻り先` があれば優先して戻る。
- 静的HTML本体は `/core` `/apps` API に依存させない。API が必要なら通常 Vue 画面に寄せる。

## 静的 JS の実装基準
- `requestAnimationFrame`、`setTimeout`、`setInterval` は開始 / 停止関数に集約し、リセット、ゲームオーバー、ページ離脱相当の処理で解除する。
- 固定フレーム前提にせず、`timestamp` 差分や `dt` で時間補正する。
- 画像や音声の読み込み失敗時も真っ白にならないよう、エラーメッセージやフォールバック描画を用意する。
- キーボード操作は必要なキーだけ `preventDefault()` し、入力欄やボタン操作と衝突させない。
- UI から変更する設定値は `const` にせず、`let` か状態オブジェクトで管理する。
- 停止復旧の watchdog は毎 tick で再生要求を連打しない。再開要求は一度だけ出し、タイムアウトで次状態へ進める。
- 無操作デモと通常プレイは同じ開始関数から呼べるようにし、自動確認用の読み取り API は `window.<画面固有名>` へ 1 箇所へまとめる。
- ギミックは装飾だけで終わらせず、描画・物理・得点・効果音を一つの状態へ接続する。
- 外部ライブラリを同梱する場合は `NOTICE.md` に固定版と同梱ファイルの SHA-256 を記録する。CDN 参照はオフラインで壊れるため使わない。

## 既存 X画面別の注意点

### Xドッグファイト

- 本体は `public/Xドッグファイト/`（`index.html` / `style.css` / `game.js` / `vendor/`）、ラッパーは `components/Xその他/Xドッグファイト.vue`。ルートは `/Xその他/Xドッグファイト/ゲーム`。
- Three.js は固定版（0.178.0）を `vendor/` へ同梱する。CDN を使わない。出典と SHA-256 は `NOTICE.md` に残す。
- 描画は 2 枚重ね。`#game` が 3D 空域、`#hud-canvas` が計器一式と機内の縁。**計器は DOM ではなく 2D canvas へ毎フレーム描く**。ピッチラダーのように姿勢へ追従して回る要素は DOM では破綻する。
- **機内表示の縁は 3D 部材で作らない。** キャノピー枠を 3D の箱で組むと左右と上が黒く潰れて操縦しにくい。`描画_機内の縁()` が下部だけを楕円の下半分で丸く落とし、左右と上は開けたままにする。縁は視点が `cockpit` のときだけ描き、HUD 表示切替（H キー）とは独立させる（機体そのものなので）。
- **飛行計器はコンバイナ（HUD ガラス）に集約する。** 画面四隅へ計器を散らすと HUD に見えない。`結合器` の矩形を画面中心（ボアサイト）に合わせて定義し、ピッチラダー・方位／速度／高度テープ・照準・目標枠・警告をその内側へ `ctx.clip()` で収める。枠は四隅のブラケットだけにする（全周を囲うと窓のようで視界が狭く見える）。
- コンバイナ内は**塗り潰さない**。輪郭と発光する線・数字だけにするとガラスへの投影に見える。半透明パネル（`パネル()`）を敷くのはダッシュボード上の MFD（ARMAMENT / ENGINE / G / AIRFRAME）だけ。物理的な画面なので塗りがあって自然。
- ピッチラダーの切り抜きは上辺に帯を空ける。空けないと方位テープと ±20° 線が重なる。
- **姿勢キーを全て離して一定時間が経ったら、徐々に水平へ戻す。** `自動水平復帰()` は `無操作姿勢時間` が `設定.自動水平待ち`（3秒）に達してから効き始め、`設定.自動水平立上り`（1.2秒）かけて強さを 0→1 へ上げる。待ち時間を置くことで「機首を上げたまま少し飛ぶ」「バンクを保つ」といった操作を妨げない。ロールは翼を水平に、ピッチは機首を水平に、傾きに比例した速さで戻す（急に立て直すと操作を奪われた感じになるため、ピッチは弱め・ロールは強め）。
- **機体は平面形（上から見た輪郭）を `THREE.Shape` で起こして薄く押し出す。** 箱と円柱の寄せ集めでは前縁の後退角と翼端が出ない。ジオメトリは全機で共有し、色だけマテリアルで変える（1 機ずつ作ると編隊のたびに増え、撃墜で scene から外しても解放されず積み上がる）。
- **`rotation.x` を 90° 使う部材に `rotation.z` を足さない。** Euler の既定 XYZ（Rx·Ry·Rz）では z が向き直す前の軸に効き、胴だけがヨーして斜めに刺さる（実際に「家のような塊」に見える不具合が出た）。断面の回し込みは `rotation.y`、外傾のような後掛けの回転は親 `Group` に持たせる。
- 視点切替は `視点遷移`（0→1）で補間する。コックピット側を `copy` で即代入すると客観→機内が一瞬で飛ぶ。遷移中は自機を消さず、機内の縁も同じ進捗でフェードさせる。落ち着いたら `copy` に切り替え、HUD のボアサイトを画面中心へ厳密に合わせる。
- 弾の当たり判定は点ではなく **線分と点の距離**で見る。弾速 900m/s では 1 フレームの移動量が当たり半径を超え、点判定だとすり抜ける。
- ミサイルはロック済みの一撃で撃墜（威力 = 敵体力）。機銃は削り役に分ける。
- **デモは自動操縦＋実況解説つきの自動戦闘。** `デモ操作()` はロック対象がいなくても常に最も近い敵へ機首を向ける（放置すると探索で流れて敵を見失い、旋回するだけになる）。地表回避は海抜ではなく **対地高度**で判定し、バンクしたままでは上昇できないため翼も水平へ戻す。
- 解説は `解説()` に優先度（ヒント / 状況 / 戦闘 / 重要）を渡し、低優先が撃墜・被弾を塗り潰さないようにする。手が空いた間は HUD の読み方を順に流す。デモ中だけ表示し、利用者が操作を取ったら `解説を初期化()` で消す。
- 自動確認は `window.XDogfight`。`getState()` のほか、`step(秒)` で描画なしに進め、`probeLock()` / `probeGun()` で目標を正面へ置いて判定だけを確かめられる。

### X立体リバーシ
- 本体は `public/X立体リバーシ/`、iframe ラッパーは `components/Xその他/X立体リバーシ.vue`。
- ルートは `/Xその他/X立体リバーシ/ゲーム`。
- 盤は 6面 x 4x4。6面ネットではなく Three.js の 3D キューブをクリックしてプレイする。
- 特殊ルールを入れる場合は、合法手ハイライト、CPU対戦、終局 / 特殊モード遷移ログを同時に用意する。
- 見えていない面の反転や着手では、`FACE_NORMALS` と `isFaceVisible()` で判定して自動カメラワークを発火する。
- チャレンジモード突入時は `challengeTransitioning` で操作を止め、アニメーション完了後に合法手を再判定する。
- Three.js を依存追加しない静的ページでは CDN import を使えるが、オフライン環境では 3D 表示だけ失敗する。

### X世界の絶景
- 本体は `public/X世界の絶景/`、Vue 側は `components/Xその他/X世界の絶景.vue`。
- 地点リストは `list.js` に分離し、`index.html` では `list.js` を `index.js` より先に読む。
- Leaflet / OpenStreetMap / Wikipedia / Wikimedia Commons を使う場合は `NOTICE.md` に利用元とオフライン時の制約を残す。
- 巡回は `Math.random()` 連発ではなくシャッフル済みキューを使う。
- 写真表示時は地図レイヤーを薄くし、次地点への転換開始時に `photo-active` を必ず外す。
- 地図移動、tile load、写真フェードの順序を分け、黒い転換画面や未読込タイルを見せない。

### Xインベーダー
- `startLoop()` / `stopLoop()` で `requestAnimationFrame` の多重起動を防ぐ。
- 敵全滅後は `waveTransitioning` を立て、次ウェーブ生成が毎フレーム走らないようにする。
- 移動、弾、タイマーは `dt / 16.67` で補正する。
- 被弾時は短い無敵時間を入れ、同一フレームや連続弾でライフが一気に減らないようにする。
- `setTimeout` は `clearTimers()` に集約し、新規開始、メニュー、ゲームオーバーで消す。

### Xテトリス
- ピース固定後から次ピース出現までは `pieceLocked` で入力、落下、二重固定を止める。
- ライン消去や次ピース出現の timer は `setManagedTimeout()` に集約し、リセット時に `clearPendingTimers()` で消す。
- 複数ライン消去は削除対象行を `Set` にし、残行を再構成して空行を上に追加する。
- I ミノは横一列だけでなく縦向き回転も定義する。
- ライン消去アニメーションは固定ピースを消して `renderBoard()` した後に付ける。

### Xネコ / xneko
- npm パッケージを追加する場合は、存在確認とライセンス確認を先に行う。
- `oneko.gif` のような外部アセットは `NOTICE.md` に出典とライセンスを残す。
- `frontend_avatar/public/xneko_*.gif` は `256x128`、32px タイル 8 x 4 の透過スプライトシートとして扱う。
- 色違いを作る場合は、輪郭と透明部分を維持して色だけ置換する方が `background-position` とズレにくい。
- 白背景画像から透過GIFを作る場合は四隅フラッドフィルで背景を除去する。

## 注意点
- `public` 配下の日本語ディレクトリは Vite で配信できるが、URL エンコードされたパスでも取得できることを確認する。
- Vue 側の新規コンポーネントタグは日本語タグで直接書かず、ルート lazy import や `<component :is="...">` を使う。
- Vue 直実装で確実に表示したい画像は `src/assets` へ置いて import する。`public` の日本語パスや base URL の影響を受けにくい。
- 静的HTMLを別タブで直接開く導線は認証ガードを通らない。認証済みメニューからの実験導線として扱う。
- `npm run build` は指示なしに実行しない。通常確認は type-check、静的JS構文確認、Vite 経由の描画確認に留める。

## 確認方法

```powershell
cd frontend_web
npm run type-check
node --check .\public\<画面名>\index.js
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8090/<URLエンコード済み画面名>/index.html'
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8090/Xその他/<画面名>/ゲーム'
```

- Vue 直実装の場合は `node --check` 対象がないため、`npm run type-check` を優先する。
- DevTools が使える場合は Console エラー、Network 404、描画サイズ、操作系イベントを確認する。
