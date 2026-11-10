// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { reactive, nextTick } from 'vue';
import { fullFilePath, copyBrowserText } from './ファイル操作.js';
import { fileDraftReference } from './ファイル参照.js';

// 表示だけを短縮し、操作対象のパス・名前は変更しない。
const menuNameSegments = new Intl.Segmenter('ja', { granularity: 'grapheme' });
export function compactExplorerName(name) {
  const parts = Array.from(menuNameSegments.segment(name), item => item.segment);
  return parts.length <= 16 ? name : parts.slice(0, 8).join('') + '…' + parts.slice(-7).join('');
}

export const parentPath = path => path.split('/').slice(0, -1).join('/');
export const containsPath = (base, path) => path === base || path.startsWith(base + '/');
export const renamedPath = (path, before, after) => containsPath(before, path) ? after + path.slice(before.length) : path;
export function explorerNameError(name) {
  if (typeof name !== 'string' || !name.trim()) return '名前を入力してください。';
  if (new TextEncoder().encode(name).length > 255 || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..' || /[.\s]$/u.test(name)) return '区切り文字・記号・末尾の空白やピリオドは使えません。';
  if (/^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name)) return 'この名前はOSで予約されています。';
  return '';
}

// OSのファイルクリップボードとは分離する。同じExplorerのピン留め・復帰ではこの実体を保持する。
export function createExplorerActions({ root, document: ownerDocument, checked = () => [], openFile = null, openFolder = null, openDraft = null, changed = async () => {}, refresh = async () => {}, edit = () => {}, focus = () => {}, request = globalThis.fetch }) {
  const state = reactive({ menu: null, clipboard: null, rename: null, dialog: null, busy: false, refreshing: false, error: '', notice: '' });
  const canOpenFile = typeof openFile === 'function';
  const canOpenFolder = typeof openFolder === 'function';
  const canOpenDraft = () => typeof openDraft === 'function' && !!root();
  let cleanup = () => {}, disposed = false, epoch = 0;
  const doc = () => ownerDocument() || globalThis.document;
  const activeRow = row => row || { type: 'dir', path: '', name: root().split(/[\\/]/).filter(Boolean).at(-1) || 'ルート' };
  const directory = row => row.type === 'dir' ? row.path : parentPath(row.path);
  function closeMenu(restore = false) { cleanup(); cleanup = () => {}; state.menu = null; if (restore) focus(); }
  function clearMessage() { state.error = ''; state.notice = ''; }
  function cancel() { if (state.busy) return; state.rename = null; state.dialog = null; closeMenu(); focus(); }
  async function showMenu(event, row, panel) {
    event?.preventDefault(); event?.stopPropagation();
    if (state.busy || state.dialog || state.rename) return;
    closeMenu(); clearMessage();
    const run = epoch, target = { ...activeRow(row) }, rectangle = panel.getBoundingClientRect();
    const x = (event?.clientX ?? rectangle.left + 18) - rectangle.left;
    // ポインターから12px離して右へ。収まらなければメニュー全体を左へ回す。
    // 両側とも狭い場合だけパネル内へ収める（CSS側もパネル幅に合わせて縮む）。
    const menuLeft = width => Math.max(6, Math.min(
      x + 12 + width <= rectangle.width - 6 ? x + 12 : x - 12 - width,
      rectangle.width - width - 6,
    ));
    const y = (event?.clientY || rectangle.top + 50) - rectangle.top;
    state.menu = { target, checked:checked().map(row=>({...row})), directory: directory(target), x: menuLeft(Math.min(220, Math.max(0, rectangle.width - 12))), y: Math.max(6, y) };
    const openedMenu = state.menu;
    const document = panel.ownerDocument, view = document.defaultView;
    const outside = event => { if (!event.target.closest?.('.explorer-context-menu')) closeMenu(); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(true); } };
    const resize = () => closeMenu();
    const scroll = event => { if (!event.target.closest?.('.explorer-context-menu')) closeMenu(); };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true); document.addEventListener('scroll', scroll, true);
    view?.addEventListener('blur', resize); view?.addEventListener('resize', resize);
    cleanup = () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); document.removeEventListener('scroll', scroll, true); view?.removeEventListener('blur', resize); view?.removeEventListener('resize', resize); };
    await nextTick();
    const menu = panel.querySelector('.explorer-context-menu');
    if (disposed || run !== epoch || !menu || state.menu !== openedMenu) return;
    openedMenu.x = menuLeft(menu.offsetWidth);
    openedMenu.y = Math.max(6, Math.min(y, rectangle.height - menu.offsetHeight - 6));
    // 補正前の画面外メニューへfocusすると、親パネルまで自動スクロールしてしまう。
    // Vueの位置反映を待ち、フォーカスだけを移す。連続右クリック・取消も再確認する。
    await nextTick();
    if (!disposed && run === epoch && state.menu === openedMenu) menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }
  async function beginRename(row) {
    if (!row?.path || state.busy) return;
    closeMenu(); clearMessage(); const run = epoch; state.rename = { ...row, value: row.name || row.path.split('/').at(-1) };
    const target = state.rename; edit(row); await nextTick();
    if (disposed || run !== epoch || state.rename !== target) return;
    const input = doc()?.querySelector('.explorer-rename'); input?.focus();
    const end = row.type === 'file' && state.rename.value.lastIndexOf('.') > 0 ? state.rename.value.lastIndexOf('.') : state.rename.value.length;
    input?.setSelectionRange(0, end);
  }
  async function showDialog(value) { const run = epoch; state.dialog = value; const target = state.dialog; await nextTick(); if (disposed || run !== epoch || state.dialog !== target) return; const element = doc()?.querySelector('.explorer-action-dialog'); (element?.querySelector('[data-initial-focus]') || element?.querySelector('input,button'))?.focus(); }
  async function perform(payload) {
    if (state.busy || disposed) return;
    state.busy = true; clearMessage(); const run = epoch;
    try {
      const response = await request('/api/explorer/actions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AiDiy-Explorer': '1' }, body: JSON.stringify(payload) });
      const text = await response.text(); let result;
      try { result = JSON.parse(text); } catch { throw Error(text || 'ファイル操作の応答を読み取れません。'); }
      if (!response.ok) {
        if(Array.isArray(result.completed)&&!disposed&&run===epoch){
          state.dialog=null;
          for(const item of result.completed)updateClipboard(item);
          if(result.completed.length)await changed({action:payload.action,results:result.completed},()=>!disposed&&run===epoch);
        }
        if(result.partialPath&&!disposed&&run===epoch)try{await refresh();}catch{}
        throw Error(result.message || result.error || 'ファイルを操作できません。');
      }
      if (disposed || run !== epoch) return;
      if(Array.isArray(result.results)){
        state.rename=null;state.dialog=null;
        state.notice=`☑ ${result.results.length}件${result.action==='trash'?'をゴミ箱へ移動しました。復元はOSのゴミ箱から行えます。':result.action==='copy'?'をコピーしました。':'のPDFを作成しました。'}`;
        for(const item of result.results)updateClipboard(item);
        try{await changed(result,()=>!disposed&&run===epoch);}catch(error){if(!disposed&&run===epoch)state.error=`操作は完了しましたが、一覧を更新できません。${error.message||''}`;}
        return result;
      }
      updateClipboard(result);
      state.rename = null; state.dialog = null;
      state.notice = result.action === 'trash' ? `「${result.name}」をゴミ箱へ移動しました。復元はOSのゴミ箱から行えます。` : `「${result.name}」${result.action === 'rename' ? 'に名前を変更しました。' : result.action === 'copy' ? 'をコピーしました。' : 'を作成しました。'}`;
      try { await changed(result, () => !disposed && run === epoch); } catch (error) { if (!disposed && run === epoch) state.error = `操作は完了しましたが、一覧を更新できません。再読み込みしてください。${error.message || ''}`; }
      return result;
    } catch (error) { if (!disposed && run === epoch) state.error = error.message || 'ファイルを操作できません。'; }
    finally { if (!disposed && run === epoch) { state.busy = false; if(!state.rename&&!state.dialog)focus(); } }
  }
  function updateClipboard(result){
    if(!state.clipboard)return;
    const items=state.clipboard.items||[state.clipboard];
    if(result.action==='rename'){
      for(const item of items)item.path=renamedPath(item.path,result.previousPath,result.path);
      state.clipboard.path=renamedPath(state.clipboard.path,result.previousPath,result.path);
    }
    if(result.action==='trash'){
      const remaining=items.filter(item=>!containsPath(result.path,item.path));
      state.clipboard=remaining.length?{...remaining[0],root:state.clipboard.root,...(state.clipboard.items?{items:remaining}:{})}:null;
    }
  }
  function batchTargets(action, rows=state.menu?.checked||checked()){
    if(rows.length<2)return [];
    if(['copy-path','copy-relative','copy','duplicate','trash'].includes(action))return rows;
    if(action==='pdf'&&rows.every(row=>row.type==='file'&&/\.md$/i.test(row.path)))return rows;
    if(action==='handoff'&&rows.every(row=>row.type==='file'))return rows;
    return [];
  }
  async function submitName() {
    const target = state.rename || state.dialog;
    if (!target || state.busy) return;
    const error = explorerNameError(target.value); if (error) { state.error = error; return; }
    if (state.rename) {
      if (target.value === target.name) { cancel(); return; }
      return perform({ action: 'rename', path: target.path, name: target.value });
    }
    return perform({ action: target.action, directory: target.directory, name: target.value });
  }
  async function action(action, row = state.menu?.target) {
    if (state.busy || disposed) return;
    const run = epoch, current = () => !disposed && run === epoch;
    const batch=batchTargets(action).map(row=>({...row}));
    row = { ...activeRow(row) }; closeMenu(); clearMessage();
    const path = row.path, destination = directory(row);
    if(batch.length){
      if(action==='trash')return showDialog({action:'trash',paths:batch.map(row=>row.path),targets:batch});
      if(action==='duplicate'||action==='pdf')return perform({action:action==='duplicate'?'copy':'pdf',paths:batch.map(row=>row.path),...(action==='duplicate'?{duplicate:true}:{})});
      if(action==='copy'){
        state.clipboard={...batch[0],root:root(),items:batch};state.notice=`☑ ${batch.length}件をコピーしました。IDE内の貼り付け先を右クリックしてください。`;focus();return;
      }
      if(action==='copy-path'||action==='copy-relative'){
        const text=batch.map(row=>action==='copy-path'?fullFilePath(root(),row.path):row.path).join('\n');
        try{const document=doc();await copyBrowserText(text,{document,clipboard:document?.defaultView?.navigator?.clipboard,isCurrent:current});if(current())state.notice=`☑ ${batch.length}件のパスをコピーしました。`;}
        catch{if(current())await showDialog({action:'manual-copy',value:text});}return;
      }
      if(action==='handoff'){
        if(!canOpenDraft()){state.error='Code / Liveへの下書き連携を利用できません。';return;}
        openDraft({projectPath:root(),path:`チェックした${batch.length}件`,text:batch.map(row=>fileDraftReference(row)).join('\n\n'),selection:false});return;
      }
    }
    if(action==='pdf'){
      if(row.type!=='file'||! /\.md$/i.test(path)){state.error='Markdown（.md）ファイルを選択してください。';return;}
      return perform({action:'pdf',path});
    }
    if (action === 'handoff') {
      try {
        if (row.type !== 'file' || !path) throw Error('Code / Liveへ渡すファイルを選択してください。');
        if (!canOpenDraft()) throw Error('Code / Liveへの下書き連携を利用できません。');
        // 閲覧中のファイルや選択本文ではなく、右クリックしたファイルの参照だけを渡す。
        openDraft({ projectPath: root(), path, name: row.name, text: fileDraftReference(row), selection: false });
      } catch (error) { if (current()) { state.error = error?.message || '下書き連携を開けませんでした。'; focus(); } }
      return; // ダイアログの初期フォーカスを一覧へ戻さない。
    } else if (action === 'open-app') {
      if (row.type !== 'file' || !path) { state.error = 'アプリで開くファイルを選択してください。'; return; }
      if (!canOpenFile) { state.error = '「アプリで開く」はデスクトップ版で利用できます。'; return; }
      state.busy = true;
      try {
        const result = await openFile(path);
        if (!current()) return;
        if (result?.cancelled) return;
        if (!result?.ok) throw Error(result?.error || '関連付けられたアプリで開けませんでした。');
        state.notice = `「${row.name || path}」を既定のアプリで開きました。`;
      } catch (error) { if (current()) state.error = error.message || '関連付けられたアプリで開けませんでした。'; }
      finally { if (current()) { state.busy = false; focus(); } }
      return;
    } else if (action === 'open-folder') {
      if (!['file','dir'].includes(row.type) || typeof path !== 'string' || (row.type === 'file' && !path)) { state.error = 'ファイルまたはフォルダを選択してください。'; return; }
      if (!canOpenFolder) { state.error = '「フォルダを開く」はデスクトップ版で利用できます。'; return; }
      state.busy = true;
      try {
        // ファイル/フォルダの判別と親の解決はmainで行い、rendererから絶対パスを渡さない。
        const result = await openFolder(path);
        if (!current()) return;
        if (!result?.ok) throw Error(result?.error || 'フォルダを開けませんでした。');
        state.notice = row.type === 'file' ? `「${row.name || path}」の保存フォルダを開きました。` : `「${row.name || path || 'ルート'}」を開きました。`;
      } catch (error) { if (current()) state.error = error.message || 'フォルダを開けませんでした。'; }
      finally { if (current()) { state.busy = false; focus(); } }
      return;
    } else if (action === 'copy-path' || action === 'copy-relative') {
      const text = action === 'copy-path' ? (path ? fullFilePath(root(), path) : root()) : path || '.';
      try { const document = doc(); await copyBrowserText(text, { document, clipboard: document?.defaultView?.navigator?.clipboard, isCurrent: current }); if(current()) state.notice = 'パスをコピーしました。'; }
      catch { if(current()) await showDialog({ action: 'manual-copy', value: text }); }
    } else if (action === 'copy' && path) { state.clipboard = { path, type: row.type, root: root() }; state.notice = `「${row.name || path}」をコピーしました。IDE内の貼り付け先を右クリックしてください。`; }
    else if (action === 'paste' && state.clipboard?.root === root()) {
      if(state.clipboard.items){await perform({action:'copy',paths:state.clipboard.items.map(row=>row.path),directory:destination});return;}
      if (state.clipboard.type === 'dir' && containsPath(state.clipboard.path, destination)) { state.error = 'フォルダ自身やその配下には貼り付けできません。'; return; }
      await perform({ action: 'copy', path: state.clipboard.path, directory: destination });
    } else if (action === 'duplicate' && path) await perform({ action: 'copy', path, directory: parentPath(path) });
    else if (action === 'rename') await beginRename(row);
    else if (action === 'trash' && path) await showDialog({ action: 'trash', ...row });
    else if (action === 'create-file' || action === 'create-folder') await showDialog({ action, directory: destination, value: '' });
    else if (action === 'refresh') {
      state.busy = state.refreshing = true;
      try { await refresh(); if(current()) state.notice = '一覧を再読み込みしました。'; }
      catch (error) { if(current()) state.error = error?.message || '一覧を再読み込みできません。'; }
      finally { if(current()) state.busy = state.refreshing = false; }
    }
    if(current()&&!state.dialog&&!state.rename&&!state.busy)focus();
  }
  function keyboard(event, row) {
    if (event.target?.closest?.('input:not([type="checkbox"]),textarea,[contenteditable="true"]')) return false;
    if (state.busy || state.dialog || state.rename || state.menu) return false;
    let command;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) return 'menu';
    if (event.key === 'F2' && row?.path) command = 'rename';
    else if (event.key === 'Delete' && !event.shiftKey && row?.path) command = 'trash';
    else if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key.toLowerCase() === 'c') command = event.shiftKey ? 'copy-path' : 'copy';
      if (event.key.toLowerCase() === 'v' && !event.shiftKey) command = 'paste';
    }
    if (!command) return false;
    event.preventDefault(); event.stopPropagation(); void action(command, row); return true;
  }
  function reset() { epoch++; closeMenu(); state.rename = null; state.dialog = null; state.clipboard = null; state.busy = state.refreshing = false; clearMessage(); }
  function dispose() { disposed = true; reset(); }
  return { state, batchTargets, canOpenFile, canOpenFolder, canOpenDraft, showMenu, closeMenu, action, perform, submitName, beginRename, keyboard, cancel, reset, dispose };
}
