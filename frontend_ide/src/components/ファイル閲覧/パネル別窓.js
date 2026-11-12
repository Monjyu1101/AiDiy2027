// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {installWindowMove} from '../共通表示/長押し窓移動.js';

// ブラウザーのscreen座標はCSS px。devicePixelRatio（OS拡大率を含む）は重ねて掛けない。
// 外枠/表示領域の差からツールバーを見積もる。配置要求の最終判断はブラウザーが行う。
export function popupFeatures(rect, win = window, compact = false) {
  const screen = win.screen, margin = 8;
  const left = Number.isFinite(screen.availLeft) ? screen.availLeft : win.screenX;
  const top = Number.isFinite(screen.availTop) ? screen.availTop : win.screenY;
  const width = Math.min(Math.max(300, Math.round(rect.width)), Math.max(100, screen.availWidth - margin * 2));
  const height = Math.min(Math.max(compact ? 40 : 320, Math.round(rect.height)), Math.max(100, screen.availHeight - 80));
  const border = Math.max(0, (win.outerWidth - win.innerWidth) / 2);
  const chrome = Math.max(0, win.outerHeight - win.innerHeight - border);
  const x = Math.round(Math.max(left + margin, Math.min(win.screenX + border + rect.left, left + screen.availWidth - width - margin)));
  const y = Math.round(Math.max(top + margin, Math.min(win.screenY + chrome + rect.top, top + screen.availHeight - height - 60)));
  return `popup,left=${x},top=${y},width=${width},height=${height}`;
}

export const panelRect = element => {
  const rect = element?.getBoundingClientRect();
  return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { left: 24, top: 78, width: 380, height: 680 };
};

// 内容の再描画では呼ばず、非表示から開いた時・別窓から戻した時だけ使う。
const fades = new WeakMap();
export function fadePanel(element) {
  if (!element?.animate) return;
  fades.get(element)?.cancel();
  const animation=element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
  fades.set(element,animation);
  animation.finished.then(()=>{if(fades.get(element)===animation)fades.delete(element);},()=>{});
}

// Vueのインスタンス・DOM・イベントをそのまま移動する。検索ジョブを再発行せず、
// AI入力、検索結果、展開、選択、スクロールも同じ実体を保持する。
export function createPanelWindow({ element, changed, report, closed = () => {}, recovered = () => {}, moved = () => {}, title = 'Explorer', kind = 'explorer', className = 'explorer-window', rectangle = element, win = window, titleTools, displayTitle }) {
  let child, parent, anchor, timer, pinRequest, opening = false, pendingOpen = false, generation = 0, disposed = false, detached = false, documentSeen;
  let cleanupDocument = () => {};
  let preview;
  const clearPreview = () => { preview?.remove(); preview = undefined; };
  const restoreScroll = () => {
    const positions = [element(), ...element().querySelectorAll('*')].map(node => [node, node.scrollTop, node.scrollLeft]);
    return () => positions.forEach(([node, top, left]) => { node.scrollTop = top; node.scrollLeft = left; });
  };
  function restore() {
    generation++; pendingOpen = false;
    clearInterval(timer); timer = undefined; cleanupDocument(); documentSeen = undefined;
    const node = element();
    if (node && parent) {
      const scroll = restoreScroll(); parent.insertBefore(node, anchor?.parentNode === parent ? anchor : null); scroll(); moved();
    }
    anchor?.remove(); anchor = parent = undefined;
    const closing = child; child = undefined;
    if (closing && !closing.closed) closing.close();
    if (detached) { detached = false; changed(false); }
    clearPreview();
  }
  async function attach() {
    const target = child, doc = target.document;
    if (doc === documentSeen || opening) return;
    opening = true;
    try {
      cleanupDocument(); doc.title = 'AiDiy IDE / ' + title;
      const base = doc.createElement('base'); base.href = win.document.baseURI; doc.head.append(base);
      const loads = [...win.document.querySelectorAll('style, link[rel="stylesheet"]')].map(style => {
        const copy = style.cloneNode(true);
        const loaded = copy.tagName === 'LINK' ? new Promise((resolve, reject) => {
          copy.onload = resolve; copy.onerror = () => reject(Error('別窓の表示を準備できません。'));
        }) : Promise.resolve();
        doc.head.append(copy); return loaded;
      });
      let timeout;
      try { await Promise.race([Promise.all(loads), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('別窓の準備がタイムアウトしました。')), 8000); })]); }
      finally { clearTimeout(timeout); }
      if (disposed || child !== target || target.closed || target.document !== doc) return;
      const host = doc.createElement('main'); host.className = 'development-app ' + className;
      doc.body.replaceChildren(host);
      let removeTitle = () => {};
      if (win.aidiyWindow?.panelAction) {
        const { mountPanelTitle } = await import('./別窓タイトル.js');
        if (disposed || child !== target || target.closed || target.document !== doc) return;
        if (kind !== 'panel-routes') host.classList.add('native-panel-window');
        // 軌跡バーは既存の一行に操作を置き、窓の高さ・展開位置を変えない。
        removeTitle = mountPanelTitle(kind === 'panel-routes' ? element().querySelector('.route-controls') : host, target, win, title, kind, { ...(['explorer','panel-routes'].includes(kind) ? { restore } : {}), titleTools, displayTitle });
      }
      if(kind==='panel-routes'){doc.documentElement.classList.add('route-window-document');if(win.aidiyWindow?.resizeRoutes)doc.documentElement.classList.add('native-route-window');}
      // 元Documentのタイムラインを別窓へ持ち込まない（裏のIDEでは停止し得る）。
      fades.get(element())?.cancel(); fades.delete(element());
      const scroll = restoreScroll(); host.append(element()); scroll();
      documentSeen = doc;
      const ownerApi=win.aidiyWindow;
      const stopMove=installWindowMove({kind,win:target,api:ownerApi?.beginWindowMove?{
        nativeWindowMove:ownerApi.nativeWindowMove,
        beginWindowMove:()=>ownerApi.beginWindowMove(target.name),
        moveWindow:token=>ownerApi.moveWindow(token,target.name),
        endWindowMove:token=>ownerApi.endWindowMove(token,target.name),
      }:null});
      if (!detached) { detached = true; changed(true); }
      // リロードで旧Documentが消える前にDOMを親へ退避する。次のDocumentに同じ実体を戻す。
      const leaving = () => { if (!parent || !element()) return; const keepScroll = restoreScroll(); parent.insertBefore(element(), anchor); element().style.visibility = 'hidden'; keepScroll(); };
      target.addEventListener('beforeunload', leaving);
      cleanupDocument = () => { fades.get(host)?.cancel();stopMove(); removeTitle(); target.removeEventListener('beforeunload', leaving); if (element()) element().style.visibility = ''; };
      element().style.visibility = '';
      moved();
      if (win.aidiyWindow?.showExplorer) {
        const result = await win.aidiyWindow.showExplorer(target.name);
        // 表示演出の途中で閉じた窓を「表示失敗」として本体へ復元しない。
        if (child !== target || disposed) return;
        if (target.closed) { dismiss(); return; }
        if (!result?.ok) throw Error(result?.error || '別窓を表示できません。');
        clearPreview();
      } else fadePanel(host);
      target.focus();
    } finally { opening = false; }
  }
  function pin() {
    // 手動ピン留めの途中でALL移行が始まっても、別窓の表示完了まで同じ要求を待つ。
    return pinRequest ??= openPanel().finally(() => { pinRequest = undefined; });
  }
  async function openPanel() {
    if (disposed) return;
    if (child && !child.closed) { child.focus(); return true; }
    if (opening) return;
    // 終了監視の次周期を待たず再表示されても、古いDOMの戻り先を失わない。
    if (child) restore();
    report(''); opening = pendingOpen = true;
    const own = generation;
    try {
      const node = element(), rect = panelRect(rectangle());
      let name = 'aidiy-explorer-' + win.crypto.randomUUID();
      if (win.aidiyWindow?.prepareExplorer) {
        const result = await win.aidiyWindow.prepareExplorer(rect, kind, kind === 'panel-routes' ? panelRect(node) : rect);
        if (!result?.ok) throw Error(result?.error || '別窓を準備できません。');
        if (disposed || own !== generation) return;
        name = result.name;
        if (result.preview) {
          // DOMやiframeを複製せず、元の描画だけを別窓の表示完了まで保持する。
          const image = win.document.createElement('img'), bounds = result.preview.rect;
          image.className = 'panel-pin-preview'; image.alt = ''; image.setAttribute('aria-hidden', 'true');
          image.src = result.preview.src;
          Object.assign(image.style, { left: bounds.left + 'px', top: bounds.top + 'px', width: bounds.width + 'px', height: bounds.height + 'px' });
          await image.decode();
          if (disposed || own !== generation) return;
          preview = image; win.document.body.append(image);
        }
      }
      if (disposed || own !== generation) return;
      child = win.open('about:blank', name, popupFeatures(rect, win, kind === 'panel-routes'));
      if (!child) throw Error('ポップアップがブロックされました。');
      parent = node.parentNode; anchor = win.document.createComment('Explorerを戻す位置'); parent.insertBefore(anchor, node);
      opening = false;
      await attach();
      if (!child || child.closed || disposed) { restore(); return; }
      timer = setInterval(() => {
        if (!child || child.closed) { dismiss(); return; }
        void attach().catch(error => { restore(); recovered(); report(error.message); });
      }, 250);
      return true;
    } catch (error) { if (own !== generation || disposed) return; restore(); recovered(); report(error.message); return false; }
    finally { opening = pendingOpen = false; }
  }
  const end = () => { disposed = true; restore(); win.removeEventListener('pagehide', end); };
  function dismiss() { restore(); closed(); }
  win.addEventListener('pagehide', end);
  async function reserveRouteHeight(height){
    const target=child;if(kind!=='panel-routes'||!target||target.closed)return null;
    if(win.aidiyWindow?.resizeRoutes){const result=await win.aidiyWindow.resizeRoutes(target.name,height);if(!result?.ok)throw Error(result?.error||'軌跡パネルを広げられません。');return result;}
    // ブラウザーには透明なOS窓や確実なresizeのAPIがない。拒否時は現在の範囲内で表示する。
    const screen=target.screen,bottom=(screen.availTop||0)+screen.availHeight;
    const chrome=Math.max(0,target.outerHeight-target.innerHeight),available=Math.max(1,bottom-target.screenY-chrome-8);
    try{target.resizeTo(target.outerWidth,Math.ceil(Math.min(height,available)+chrome));}catch{}
    await new Promise(resolve=>setTimeout(resolve,40));
    return target===child&&!target.closed?{height:target.innerHeight}:null;
  }
  return { pin, restore, dismiss, reserveRouteHeight, close: end, get isOpen() { return !disposed && !!(child && !child.closed || pendingOpen); }, focus: () => { if (child && !child.closed) { child.focus(); return true; } return false; } };
}
