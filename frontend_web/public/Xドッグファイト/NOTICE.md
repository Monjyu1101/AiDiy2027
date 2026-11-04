# Xドッグファイト 外部ライブラリ

`game.js` は Three.js を 3D 描画エンジンとして利用します。ネットワークへアクセスせずに動作するよう、公開用モジュールをゲームと同じ配布物に同梱しています。

| 項目 | 内容 |
| --- | --- |
| ライブラリ | [Three.js](https://threejs.org/) |
| 固定版 | `0.178.0`（`REVISION = '178'`） |
| 配布元 | npm パッケージ [`three@0.178.0`](https://www.npmjs.com/package/three/v/0.178.0) の `build/three.module.js` / `build/three.core.js` |
| 配置先 | `vendor/three.module.js` / `vendor/three.core.js` |
| ライセンス | MIT License |
| 同梱ファイル SHA-256 | `three.module.js`: `703D5885165DCBDFF159EE3C5F338FB1331391BFC08A63434A554D5FF9E1C5DD`、`three.core.js`: `90A2CDDDB8EAC530F3B3950044D909653137EAA7FA668B1F55395C595C5D2129` |

`game.js` で使用する `WebGLRenderer`、`Scene`、`PerspectiveCamera`、`Fog`、`HemisphereLight`、`DirectionalLight`、各種 Geometry / Material、`Quaternion`、`Vector3`、`SRGBColorSpace`、`ACESFilmicToneMapping` は Three.js `0.178.0` で提供される API です。

## 外部アセット

画像・音声・フォントの外部アセットは使用していません。機体、地形、雲はすべて `game.js` 内でジオメトリから生成しています。

## ネットワーク制限時の挙動

Three.js の読込に外部 CDN は使用しません。`index.html`、`game.js`、`style.css`、`vendor/three.module.js`、`vendor/three.core.js` が同じ配布物に存在すれば、ネットワークを遮断した環境でも空中戦を初期化できます。WebGL が無効、または同梱ファイルが破損・欠落した場合だけ、画面上に初期化エラーを表示します。

## MIT License

Copyright © 2010-2025 Three.js Authors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
