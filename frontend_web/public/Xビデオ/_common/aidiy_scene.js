(function () {
  // シーン本体と共通CSSの読み込み間に、ブラウザ既定の余白で
  // iframe のスクロールバーが一瞬出ないよう先に固定する。
  document.head.insertAdjacentHTML('beforeend', '<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;scrollbar-width:none;-ms-overflow-style:none}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;width:0;height:0}</style><link rel="stylesheet" href="./scene.css">');

  document.body.innerHTML = `
  <div id="stage" class="stage fade-enter">
    <section class="visual-panel">
      <div class="visual-meta">
        <div id="kicker" class="kicker"></div>
        <div id="sceneId" class="scene-id"></div>
      </div>
      <div class="image-shell">
        <div id="backgroundWord" class="background-word"></div>
        <img id="sceneImage" class="scene-image" alt="">
        <div id="imagePlaceholder" class="image-placeholder">画像を読み込み中...</div>
        <div class="image-overlay">
          <div class="image-overlay-copy">
            <div id="imageKicker" class="image-kicker"></div>
            <h2 id="imageTitle" class="image-title"></h2>
            <div id="imageHeadline" class="image-headline"></div>
            <p id="imageSubtitle" class="image-subtitle"></p>
            <p id="imageLead" class="image-lead"></p>
          </div>
        </div>
      </div>
    </section>
    <section id="contentPanel" class="content-panel">
      <div class="content-scroll">
        <div class="header-row">
          <div class="header-main">
            <h1 id="sceneTitle" class="scene-title"></h1>
            <div id="headline" class="headline"></div>
            <p id="lead" class="lead"></p>
          </div>
        </div>
        <div id="chips" class="chip-row"></div>
        <div id="metrics" class="metric-row"></div>
        <div id="cards" class="card-grid"></div>
        <div class="detail-grid">
          <section class="detail-panel">
            <h3 class="panel-title">確認ポイント</h3>
            <div id="facts" class="fact-list"></div>
          </section>
          <section class="detail-panel">
            <h3 class="panel-title">AGENTS / knowledge 抜粋</h3>
            <div id="evidence" class="evidence-list"></div>
          </section>
        </div>
      </div>
    </section>
  </div>`;

  var scr = document.createElement('script');
  scr.src = './scene_core.js';
  scr.onload = function () { renderScenePage(window._SCENE_INDEX); };
  document.head.appendChild(scr);
})();
