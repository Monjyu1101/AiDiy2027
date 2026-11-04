# アバター表示とVRMA再生

> 文書: `frontend_avatar,frontend_web,アバター表示とVRMA.md` | 実装: `frontend_avatar/src/components/AIコア.vue`, `frontend_avatar/src/components/AIコア_アバター.vue`

## このメモを使う場面
- アバターの表示サイズ、向き、カメラ距離を調整する
- VRMA が 1 回で止まる、切り替わりで姿勢が跳ねる問題を直す
- `AIコア.vue` の表示選択やアバター内オプション UI を変更する
- xeyes / xneko / 時計 / カレンダーなどの表示選択を調整する

## 関連ファイル
- `frontend_avatar/src/components/AIコア.vue` — 表示選択、`controls-visible` の受け渡し
- `frontend_avatar/src/components/AIコア_アバター.vue` — Three.js / VRM / VRMA / 口パク / アバター内設定 UI
- `frontend_avatar/src/components/AIコア_自立身体制御.ts` — 身体揺れなどの自律制御
- `frontend_avatar/src/components/AIコア_自動カメラワーク.ts` — 自動カメラ制御
- `frontend_avatar/src/components/AIコア_xeyes.vue` — 目線追従、CPU 連動演出
- `frontend_avatar/src/components/AIコア_xneko.vue` — スプライトアニメーション
- `frontend_avatar/electron/main.ts` / `preload.ts` / `src/env.d.ts` — カーソル位置、CPU 使用率などの IPC
- `frontend_web/public/X自己紹介/index.html` — 静的HTML内に VRM を埋め込む場合の参考

## アバター表示サイズ

サイズはモデル自体の scale より、カメラの引き距離で調整する。

```typescript
const distance = Math.max(distanceForHeight, distanceForWidth) * padding * 0.54
```

- 調整箇所は `AIコア_アバター.vue` の `fitCamera`。
- `fitCamera` の距離は自動カメラワークの基準にもなる。極端な倍率変更は回転半径やフレーミングに影響する。
- モデル差で頭や足が切れる場合は、bounding box、padding、カメラ target の高さを合わせて見る。

## 初期向き

VRM が背中を向く場合は、モデルコンテナの初期回転を確認する。

```typescript
const container = new THREE.Group()
container.rotation.y = Math.PI
```

- 現行Avatarは `Math.PI` と負Z側のカメラを組み合わせる。旧メモの回転0へ機械的に戻さず、モデルとカメラの両方を確認する。
- 静的HTML埋め込みでは、無理に container を回すよりカメラ位置を `frontend_avatar` 側に寄せる方が差異が出にくい。

## VRMA 連続再生

現行方針は単一クリップの `THREE.LoopRepeat` ではなく、`finished` イベントで次の VRMA を選択して再生する巡回方式。

- `モーション終了時処理` で終了イベントを受け、`vrma連続再生有効` が true なら次の `VRMA再生開始` を呼ぶ。
- 次クリップへ切り替えるときは `action.crossFadeFrom` を使い、姿勢が瞬時に初期化されるガクつきを避ける。
- 1 本しかない場合も終了後に同じモーションを再開できるようにする。
- VRMA 追加時は `_AIDIY/knowledge/frontend_avatar,VRM_VRMA追加手順.md` も確認する。

## 表示選択 UI

`AIコア.vue` の `表示選択` は左下、アバター固有の実験設定は `AIコア_アバター.vue` の右下に置く。

- 表示選択候補は `アバター` / `xneko(猫)` / `xeyes(目)` / `アナログ時計` / `デジタル時計` / `カレンダー` / `無し` など。
- 新しい表示を追加する場合は、表示選択型、import、select option、表示 computed / `v-if` をセットで更新する。
- `表示選択 !== 'アバター'` の場合は `AIコア_アバター.vue` 自体を表示しない。アバター固有設定も表示しない。
- `controls-visible=false` のときは、設定 UI、字幕、発光などの補助表示を隠し、表示本体だけにする。

## xeyes / xneko の変更

Electron / Web のカーソル・CPU取得、スプライト追加、表示選択の連動修正と破棄時の後始末は [ウィジェット追加手順](./frontend_avatar,xneko_xeyesウィジェット追加手順.md) に集約します。

## 静的HTMLに VRM を埋め込む場合

`frontend_web/public/X自己紹介/index.html` のような静的HTMLは Vue コンポーネントと調整箇所が違う。

- CSS の `#avatar-container` の `width` / `height` と `renderer.setSize(..., false)` を一致させる。
- `getStageSize()` で `clientWidth/clientHeight` を読み、CSS と canvas の見た目をずらさない。
- カメラは `-Z` 側に置き、`camera.lookAt()` で正面を見る構成に寄せる。
- VRMA は `LoopOnce` で 1 本ずつ再生し、`clip.duration - XFADE` を基準に `setTimeout` で次クリップを予約する。

```javascript
const getStageSize = () => ({
  width: Math.max(1, avatarContainer?.clientWidth || 200),
  height: Math.max(1, avatarContainer?.clientHeight || 340),
})

renderer.setSize(getStageSize().width, getStageSize().height, false)
camera.position.set(0, h * 0.78, -h * 1.05)
camera.lookAt(0, h * 0.78, 0)

const action = mixer.clipAction(clip)
action.reset()
action.setLoop(THREE.LoopOnce, 1)
action.clampWhenFinished = false
action.play()
nextClipTimer = window.setTimeout(playNext, Math.max(250, (clip.duration - XFADE) * 1000))
```

## 注意点
- `fitCamera` の倍率変更は自動カメラワークにも影響する。
- `action.crossFadeFrom` を設定しないと、モーション切替時に初期姿勢へ戻って見えることがある。
- VRMA や設定 JSON は UTF-8 BOM なしを優先する。
- Electron の `mousemove` は BrowserWindow 内に入ったときしか取れない。ウィンドウ外カーソル追従には main process IPC が必要。
- CPU 使用率は直前サンプルとの差分で出すため、初回値は 0 になり得る。
- `requestAnimationFrame` や `setTimeout` はコンポーネント破棄時に解除する。

## 確認方法
1. アバター起動時に全身が適切に収まっているか確認する。
2. 初期表示で正面を向いているか確認する。
3. VRMA 終了後に停止せず、次のモーションまたは同じモーションが始まるか確認する。
4. `表示選択` を切り替え、アバター以外の表示中にアバター固有設定が出ないことを確認する。
5. `controls-visible=false` で設定 UI、字幕、補助発光が消えることを確認する。
6. xeyes は Electron でウィンドウ外カーソル、Web で画面内 pointermove に追従することを確認する。
7. 静的HTMLではリロード後に canvas サイズ、向き、VRMA 巡回再生が崩れないことを確認する。
