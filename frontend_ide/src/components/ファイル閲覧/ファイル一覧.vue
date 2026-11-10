<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { createExplorerDrag } from './エクスプローラードラッグ.js';
import RefreshButton from '../共通表示/再読込ボタン.vue';
import { ref, shallowRef, computed, inject, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { createRouteExpansion } from '../ファイル閲覧/軌跡パネル展開.js';
import { createPanelWindow, fadePanel } from '../ファイル閲覧/パネル別窓.js';
import AISearchPanel from '../ファイル検索/AI検索パネル.vue';
import FileTypeIcon from '../ファイル閲覧/ファイル種別アイコン.vue';
import ExplorerActionView from '../ファイル閲覧/エクスプローラー操作表示.vue';
import DraftHandoffDialog from '../../dialog/下書き連携ダイアログ.vue';
import { createExplorerActions, containsPath, renamedPath } from './エクスプローラー操作.js';
import { latestFiles, createLatestUpdates, fileCountChanged } from '../ファイル閲覧/最新ファイル.js';
import { localDateTimeInput, parseLocalDateTime, timeRangeError, inTimeRange, timeSearchPresets, timeSearchRange } from './ファイル日時.js';
import { scanWarning } from '../ファイル閲覧/走査警告.js';
import { searchRouteRecords } from '../開発スペース/経路記録.js';
import { routeTreeRows, viewTreeRecords, routeNavigationSteps } from '../開発スペース/軌跡ツリー.js';
const props = defineProps({ tree: Object, scan: Object, root: String, selected: String, current: String, navigating: Boolean, startedAt: Number, open: Boolean, allDisplays: Boolean, viewHistory: { type: Array, default: () => [] }, viewVoyages: { type: Object, default: () => ({}) }, filter: { type: Boolean, default: true }, applyFileChange: Function, reload: Function, color: { type: Function, default: () => '#bac7da' } });
const emit = defineEmits(['update:open', 'select', 'clear', 'marks', 'latest', 'freshness', 'route', 'clear-view-history', 'detached', 'activity', 'pause-refresh']);
const checkedPaths=ref(new Set());
const multipleChecked=computed(()=>checkedPaths.value.size>1);
let checkAnchor='';
const checkParent=path=>path.split('/').slice(0,-1).join('/');
watch(()=>props.selected,path=>{if(path)checkedPaths.value=multipleChecked.value?new Set([...checkedPaths.value,path]):new Set([path]);},{immediate:true});
watch(multipleChecked,paused=>{
  if(paused){latestRun++;latestController?.abort();latestController=null;}
  emit('pause-refresh',paused);
  if(!paused)void pollLatest();
},{flush:'sync'});
function toggleCheck(row){
  if(fileActionState.busy||fileActionState.rename||fileActionState.dialog)return;
  const next=new Set(checkedPaths.value);next.has(row.path)?next.delete(row.path):next.add(row.path);checkedPaths.value=next;
  checkAnchor=row.path;
}
function clickRow(event,row){
  if(fileActionState.busy||fileActionState.rename||fileActionState.dialog)return;
  if(event.shiftKey||event.ctrlKey||event.metaKey){
    const next=new Set(event.ctrlKey||event.metaKey?checkedPaths.value:[]);
    const from=rows.value.findIndex(item=>item.path===(checkAnchor||props.selected)),to=rows.value.findIndex(item=>item.path===row.path);
    const sameAnchor=from>=0&&to>=0&&checkParent(rows.value[from].path)===checkParent(row.path);
    if(event.shiftKey&&sameAnchor)
      for(const item of rows.value.slice(Math.min(from,to),Math.max(from,to)+1))if(checkParent(item.path)===checkParent(row.path))next.add(item.path);
    next.add(row.path);checkedPaths.value=next;
    if(!event.shiftKey||!sameAnchor)checkAnchor=row.path;
  }else {checkedPaths.value=new Set([row.path]);checkAnchor=row.path;}
  treeElement.value?.focus({preventScroll:true});select(row);
}
const treeDrag=createExplorerDrag({activity:()=>emit('activity')});
const panel=ref(),detached=ref(false),pinError=ref('');
const draftActions=inject('fileDraftActions',null),draftRequest=ref(null);
const nativePanels=!!window.aidiyWindow?.panelAction;
let panelWindow,routeWindow;
// 軌跡バーはエクスプローラーと同じく、最初は閉じて縦三本の正方形ボタンだけを出す。
const routeDetached=ref(false),routeClosed=ref(true),preparingAll=ref(false);
function pinRoutes(){
  routeClosed.value=false;
  routeWindow??=createPanelWindow({element:()=>routeElement.value,title:'軌跡',kind:'panel-routes',className:'routes-window',
    rectangle:()=>({getBoundingClientRect:()=>{const rect=routeElement.value.getBoundingClientRect();return{left:rect.left,top:rect.top,width:360,height:routeMeasure().bar};}}),
    changed:value=>{routeDetached.value=value;},closed:()=>{routeClosed.value=true;routeListOpen.value=false;},
    moved:()=>syncRouteDocument(),report:message=>{pinError.value=message;}});
  return routeWindow.pin();
}
function openRoutes(){if(!routeWindow?.focus())routeClosed.value=false;}
function closeRoutes(){if(routeDetached.value)routeWindow.dismiss();else{routeClosed.value=true;routeListOpen.value=false;}}
function pinExplorer(){
  fileActions.closeMenu();draftRequest.value=null;
  panelWindow??=createPanelWindow({element:()=>panel.value,changed:value=>{detached.value=value;emit('detached',value);},closed:()=>emit('update:open',false),moved:()=>{draftRequest.value=null;},report:message=>{pinError.value=message;}});
  return panelWindow.pin();
}
function closeExplorer(){draftRequest.value=null;fileActions.closeMenu();if(!fileActionState.busy)fileActions.cancel();if(detached.value)panelWindow.dismiss();else emit('update:open',false);}
watch(()=>props.allDisplays,(active,previous)=>{
  if(previous&&!active){
    // DOM・履歴を本体へ回収してから別窓を閉じ、通常画面では閉じた状態へ戻す。
    closeExplorer();closeRoutes();
  }
});
async function pinForAll(){
  // 非表示の矩形を測らない。元の窓サイズのまま開いてから、別窓の表示完了を待つ。
  // Explorerを切り離した後も、軌跡の位置はExplorerの右側に保つ。
  preparingAll.value=true;
  try{
    emit('update:open',true);await nextTick();
    if(!await pinExplorer())throw Error(pinError.value||'エクスプローラーを別ウィンドウで開けませんでした。');
    routeClosed.value=false;await nextTick();
    if(!await pinRoutes())throw Error(pinError.value||'軌跡バーを別ウィンドウで開けませんでした。');
  }finally{preparingAll.value=false;}
}
watch([()=>props.open,detached],async([open,away])=>{if(open&&!away){await nextTick();fadePanel(panel.value);}});
// 一覧は宇宙と同じ（props.tree）。フィルター（星空画面の左下）が ON なら、宇宙もこの一覧もバックアップ対象だけになる。
const tree = computed(() => props.tree);
// 前回の最新日時以降を更新順で表示する。更新なしなら前回の一覧を保持する。
const recentUpdates = shallowRef([]);
let latestRun = 0, latestController, latestDisposed = false, updates = createLatestUpdates(), switchingFilter = false, initialSent = false;
const latestScan = shallowRef(null);
const treeWarning = computed(() => scanWarning(props.scan, '一覧'));
const latestWarning = computed(() => scanWarning(latestScan.value, '最終更新'));
function acceptUpdates(files) {
  const baseline = updates.since === null, changed = updates.accept(files);
  if (!changed.length) return changed;
  recentUpdates.value = changed;
  if (props.filter && (!initialSent || !baseline)) {
    const initial = !initialSent; initialSent = true;
    emit('latest', { ...changed.at(-1), files: changed, initial });
  }
  return changed;
}
async function pollLatest() {
  if (latestDisposed || multipleChecked.value || (panel.value?.ownerDocument||document).hidden || latestController) return;   // 複数選択・非表示・取得中は問い合わせない
  const run = ++latestRun, forFilter = props.filter, forRoot = props.root, forSession = props.startedAt, request = new AbortController();
  latestController = request;
  try {
    const params = { ...(forFilter ? { filter: 'backup' } : {}), ...(updates.since === null ? {} : { since: String(updates.since) }) };
    const response = await fetch('/api/latest?' + new URLSearchParams(params), { cache: 'no-store', signal: request.signal });
    if (!response.ok) return;
    const result = await response.json();
    if (!latestDisposed && run === latestRun && forFilter === props.filter && forRoot === props.root && forSession === props.startedAt) {
      latestScan.value = result.scan || result;
      // 前回の応答ではなく表示中の一覧と比較し、再読込が失敗しても次の周期で再試行する。
      const countChanged = !switchingFilter && fileCountChanged(props.scan, latestScan.value);
      const changed = acceptUpdates(result.files || []); switchingFilter = false;
      // 最新の一覧を取り込むことと、自動で移動することは独立させる。
      if (changed.length || countChanged) emit('freshness', { files: changed });
    }
  } catch { /* 次の周期で再試行 */ }
  finally { if (latestController === request) latestController = null; }
}
const latestTimer = setInterval(pollLatest, 60_000);
function resetLatest() { latestRun++; latestController?.abort(); latestController = null; updates = createLatestUpdates(); latestScan.value = null; recentUpdates.value = []; switchingFilter = true; }
watch(() => props.filter, () => { resetLatest(); void pollLatest(); });
// 初回の候補だけツリーから用意する。以後の再描画・再走査は選択移動の通知にしない。
// 新しい最終更新による追跡は /api/latest の検知に限定する。
let initialTreeAccepted = false;
watch(tree, value => {
  if (!value || initialTreeAccepted) return;
  initialTreeAccepted = true;
  if (!switchingFilter) acceptUpdates(latestFiles(value));
}, { immediate: true });
const latestTime = value => new Date(value.mtime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const expanded = ref(new Set()), cursor = ref(''), mode = ref('since'), since = ref(props.startedAt), preset = ref('start');
const until = ref(null), dateInput = ref(localDateTimeInput(since.value)), endDateInput = ref('');
const dateError = computed(() => timeRangeError(since.value, until.value));
const aiResult=shallowRef(null),routeMode=ref('view');
// 検索方法の切替や失敗で、前回確定した別分類の経路を消さない。
const searchRoute=shallowRef([]),searchKind=ref(''),searchTitle=ref('');
const aiFiles=computed(()=>new Map((aiResult.value?.files||[]).map(file=>[file.path,file.reason])));
const aiRoute=computed(()=>aiResult.value?.route||[]);
const routeListOpen=ref(false),routeElement=ref(),viewRoute=ref([]);
const routeMotionState=shallowRef({height:0,visible:false,phase:'closed'});
let routeDocumentCleanup=()=>{},routeDisposed=false;
function routeMeasure(){
  const node=routeElement.value,view=node?.ownerDocument?.defaultView||window;
  const bar=Math.ceil(node?.querySelector?.('.route-controls')?.getBoundingClientRect?.().height||64)+2;
  const away=!!node&&node.ownerDocument!==document;
  const top=node?.getBoundingClientRect?.().top||0,available=Math.max(0,(view.innerHeight||768)-top-bar-(away?0:8));
  return{bar,target:away?300:Math.min(300,available),available};
}
const routeMotion=createRouteExpansion({measure:routeMeasure,
  schedule:(fn,delay)=>{const view=routeElement.value?.ownerDocument?.defaultView||window;return{view,id:view.setTimeout?view.setTimeout(fn,delay):setTimeout(fn,delay)};},
  cancel:timer=>{if(timer)try{timer.view.clearTimeout?timer.view.clearTimeout(timer.id):clearTimeout(timer.id);}catch{}},
  reserve:async height=>{const node=routeElement.value;if(routeDetached.value&&node?.ownerDocument!==document)return routeWindow.reserveRouteHeight(height);return{height:routeMeasure().bar+routeMeasure().available};},
  changed:value=>{routeMotionState.value=value;},report:message=>{pinError.value=message;}});
function syncRouteDocument(){
  routeDocumentCleanup();if(routeDisposed)return;
  const view=routeElement.value?.ownerDocument?.defaultView||window;
  const resize=()=>routeMotion.refresh();
  view.addEventListener('resize',resize);
  routeDocumentCleanup=()=>{view.removeEventListener('resize',resize);};
  void routeMotion.set(routeListOpen.value&&!routeClosed.value,{restart:true});
}
watch([routeListOpen,routeClosed],async()=>{await nextTick();if(!routeDisposed)void routeMotion.set(routeListOpen.value&&!routeClosed.value);});
onMounted(syncRouteDocument);

watch([routeClosed,routeDetached],async([closed,away])=>{if(!closed&&!away){await nextTick();fadePanel(routeElement.value);}});
const viewedFiles=computed(()=>props.viewHistory.filter(entry=>entry?.type==='file'&&typeof entry.path==='string'));
function syncViewRoute(){viewRoute.value=[...new Set(viewedFiles.value.map(entry=>entry.path))];}
watch(viewedFiles,entries=>{
  const paths=[...new Set(entries.map(entry=>entry.path))];
  // 一覧から再訪しても表示順を入れ替えず、前・次で同じ2件を往復するのを防ぐ。
  viewRoute.value=routeListOpen.value&&routeMode.value==='view'
    ? [...paths.filter(path=>!viewRoute.value.includes(path)),...viewRoute.value.filter(path=>paths.includes(path))] : paths;
},{immediate:true});
const routePaths=computed(()=>routeMode.value==='ai'?aiRoute.value:routeMode.value==='search'?searchRoute.value:viewRoute.value);
const searchRouteLabel=computed(()=>searchKind.value==='grep'?'検索軌跡':'時刻軌跡');
const routeLabel=computed(()=>routeMode.value==='ai'?'AI検索軌跡':routeMode.value==='search'?searchRouteLabel.value:'閲覧軌跡');
const routeRows=computed(()=>routeTreeRows(routeMode.value==='view'?viewTreeRecords(props.viewVoyages,viewRoute.value,props.viewHistory.filter(entry=>entry?.type==='dir').map(entry=>entry.path))
  :routeMode.value==='search'?searchRoute.value.map(path=>({from:null,to:'f:'+path}))
  :aiResult.value?.routeRecords||searchRouteRecords(aiRoute.value)));
function beginSearch(kind){routeMode.value=kind==='ai'?'ai':'search';}
function acceptSearch(paths,kind,title){searchRoute.value=[...new Set(paths)];searchKind.value=kind;searchTitle.value=title;}
const viewedAt=path=>{const at=viewedFiles.value.find(entry=>entry.path===path)?.at;return Number.isFinite(at)?new Date(at).toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';};
function closeRouteList(event){if(!routeDetached.value&&!routeElement.value?.contains(event.target))routeListOpen.value=false;}
onMounted(()=>document.addEventListener('pointerdown',closeRouteList));
const hiddenAI=computed(()=>{
  const paths=new Set();
  function walk(node,prefix=''){if(!node)return;for(const [name] of node.f)paths.add(prefix+name);for(const dir of node.d)walk(dir,prefix+dir.n+'/');}
  walk(tree.value);return aiRoute.value.filter(path=>!paths.has(path)).length;
});
const routeSteps=computed(()=>routeNavigationSteps(routeRows.value));
const routeIndex=computed(()=>routeSteps.value.findIndex(row=>row.path===(cursor.value||props.selected||props.current)));
function chooseRoute(value){
  const opening=routeMode.value!==value||!routeListOpen.value;
  routeMode.value=value;routeListOpen.value=opening;
  if(value==='ai')mode.value='ai';else if(value==='view'&&opening)syncViewRoute();
}
function selectRoutePath(path){const match=routeMode.value==='search'&&searchKind.value==='grep'?grepResults.value.find(item=>item.path===path):null;if(match)selectMatch(match);else select({type:'file',path,source:routeMode.value});}
function selectRoutePoint(row){if(row.type==='dir')select({type:'dir',path:row.path});else selectRoutePath(row.path);}
function stepRoute(offset){const index=routeIndex.value<0?(offset>0?0:routeSteps.value.length-1):routeIndex.value+offset;const row=routeSteps.value[index];if(row)selectRoutePoint(row);}
function acceptAI(result,activate=true){
  aiResult.value=result;if(activate){mode.value='ai';routeMode.value='ai';}
  if(!result)return;
  if(pendingSince&&!activate)return;
  cancelSinceExpansion();
  // 結果の到着では移動しない。一覧に関連ファイルの親だけを展開する。
  const next=new Set(expanded.value);
  for(const path of result.route){const parts=path.split('/');for(let i=1;i<parts.length;i++)next.add(parts.slice(0,i).join('/'));}
  expanded.value=next;rootExpanded.value=true;save();
}
const grepResults = shallowRef([]), resultQuery = ref(''), resultCase = ref(false);
const query = ref(''), caseSensitive = ref(false), matches = ref(new Set()), status = ref(''), treeElement = ref();
const rootExpanded = ref(true), searching = ref(false);
// 検索結果の開閉は手動だけ。結果の到着・検索方法の切替では開かない。
const searchResultsOpen = ref(false);
const searchResults = computed(() => {
  if (mode.value === 'grep') return grepResults.value.map(match => ({ ...match, source: 'grep' }));
  if (mode.value === 'ai') return aiRoute.value.map(path => ({ path, reason: aiFiles.value.get(path), source: 'ai' }));
  const result = [];
  function walk(node, prefix = '') {
    if (!node) return;
    for (const [name, size, mtime] of node.f) if (inTimeRange(mtime, since.value, until.value)) result.push({ path: prefix + name, size, mtime, source: 'since' });
    for (const dir of node.d) walk(dir, prefix + dir.n + '/');
  }
  walk(tree.value);
  return result.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path, 'ja', { numeric: true }));
});
const searchResultsLabel = computed(() => mode.value === 'ai' ? 'AI検索' : mode.value === 'grep' ? 'grep検索' : '時刻検索');
function selectSearchResult(result) {
  if (result.source === 'grep') selectMatch(result);
  else select({ type: 'file', ...result });
}
watch(() => props.root, () => { searchResultsOpen.value = false; });

const leavingRows=new Set();
let pendingSince=null,sinceExpandTimer;
function cancelSinceExpansion(){clearTimeout(sinceExpandTimer);pendingSince=null;}
function finishSinceCollapse(){
  clearTimeout(sinceExpandTimer);
  if(!pendingSince||leavingRows.size)return;
  // 全行の折りたたみが終わってから、ルートだけの状態を挟んで展開する。
  sinceExpandTimer=setTimeout(()=>{
    if(!pendingSince||leavingRows.size)return;
    expanded.value=pendingSince;pendingSince=null;rootExpanded.value=true;save();nextTick(scrollToTop);
  },60);
}
function beforeTreeLeave(element){leavingRows.add(element);}
function afterTreeLeave(element){leavingRows.delete(element);finishSinceCollapse();}
let controller, generation = 0;
const marked = file => mode.value === 'ai' ? aiFiles.value.has(file.path) : mode.value === 'grep' ? matches.value.has(file.path) : inTimeRange(file.mtime, since.value, until.value);
const counts = computed(() => {
  const result = new Map();
  function walk(node, prefix) {
    let count = node.f.reduce((n, [name, size, mtime]) => n + (marked({ path: prefix ? `${prefix}/${name}` : name, mtime }) ? 1 : 0), 0);
    for (const dir of node.d) count += walk(dir, prefix ? `${prefix}/${dir.n}` : dir.n);
    result.set(prefix, count); return count;
  }
  if (tree.value) walk(tree.value, ''); return result;
});
const rows = computed(() => {
  const result = [];
  const compare = (a,b) => a.localeCompare(b,'ja',{numeric:true});
  function walk(node, prefix, depth) {
    for (const dir of [...node.d].sort((a,b)=>compare(a.n,b.n))) {
      const path = prefix ? `${prefix}/${dir.n}` : dir.n;
      result.push({ type:'dir',name:dir.n,path,depth,open:expanded.value.has(path),fresh:counts.value.get(path)||0 });
      if (expanded.value.has(path)) walk(dir,path,depth+1);
    }
    for (const [name,size,mtime] of [...node.f].sort((a,b)=>compare(a[0],b[0]))) {
      const path = prefix ? `${prefix}/${name}` : name;
      result.push({ type:'file',name,path,depth,size,mtime,fresh:marked({path,mtime}) });
    }
  }
  if (tree.value && rootExpanded.value) walk(tree.value,'',0); return result;
});
function save() { if (props.root) try { localStorage.setItem(`aidiy_ide:explorer:${props.root}`,JSON.stringify({expanded:[...expanded.value]})); } catch {} }
function toggle(row) { if(fileActionState.rename||fileActionState.busy)return;cancelSinceExpansion();const next=new Set(expanded.value); next.has(row.path)?next.delete(row.path):next.add(row.path); expanded.value=next; save(); }
function reveal(path = props.selected || props.current) {
  if (!path || searching.value || pendingSince) return;
  rootExpanded.value=true;
  const next=new Set(expanded.value), parts=path.split('/');
  for(let i=1;i<parts.length;i++)next.add(parts.slice(0,i).join('/'));
  expanded.value=next;cursor.value=path;save();
  nextTick(()=>treeElement.value?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({block:'nearest'}));
}
function select(row, toggleSelection=false) {
  fileNavigationVersion++;cancelSinceExpansion();
  if(toggleSelection&&!props.navigating&&row.type==='file'&&props.selected===row.path){cursor.value='';emit('clear');return;}
  cursor.value=row.path;
  if(row.type==='dir'){if(row.path==='')rootExpanded.value=true;else expanded.value=new Set([...expanded.value,row.path]);save();}
  emit('select',{type:row.type,path:row.path,...(row.mtime != null ? {mtime:row.mtime} : {}),...(row.size != null ? {size:row.size} : {}),...(row.source ? {source:row.source} : {}),...(row.line ? {line:row.line,column:row.column,query:row.query,caseSensitive:row.caseSensitive,matchMtime:row.matchMtime,matchLength:row.matchLength} : {})});
}
function emitMarks() { emit('marks',{mode:mode.value,since:since.value,until:until.value,paths:mode.value==='ai'?[...aiFiles.value.keys()]:[...matches.value]}); }
function selectMatch(match) { select({type:'file',...match,source:'grep',query:resultQuery.value,caseSensitive:resultCase.value,matchMtime:match.mtime,matchLength:match.length}); }
function clearSearch() { cancelSinceExpansion();generation++; controller?.abort();matches.value=new Set();grepResults.value=[];resultQuery.value='';status.value='';searching.value=false;rootExpanded.value=true; }
function scrollToTop() { if(treeElement.value)treeElement.value.scrollTop=0; }
function expandSinceMatches() {
  // 以前の手動展開を引き継がず、一致ファイルにつながるフォルダだけを開く。
  cancelSinceExpansion();
  pendingSince=new Set([...counts.value].filter(([path,count])=>path&&count>0).map(([path])=>path));
  expanded.value=new Set();rootExpanded.value=false;cursor.value='';
  nextTick(()=>{scrollToTop();finishSinceCollapse();});
}
function choose(value) {
  preset.value=value;
  const range=timeSearchRange(value,props.startedAt);
  since.value=range.since;until.value=range.until;
  dateInput.value=localDateTimeInput(since.value);
  // 手入力の終了は秒単位で含むため、排他的上限の直前の秒を表示する。
  endDateInput.value=until.value==null?'':localDateTimeInput(until.value-1000);
  updateSinceRoute();expandSinceMatches();
}
function updateSinceRoute(activate=true){
  if(activate)beginSearch('since');const paths=[];
  function walk(node,prefix=''){if(!node)return;for(const [name,,mtime] of node.f)if(inTimeRange(mtime,since.value,until.value))paths.push(prefix+name);for(const dir of node.d)walk(dir,prefix+dir.n+'/');}
  walk(tree.value);acceptSearch(paths,'since','時刻検索');
}
function chooseDate(input, end=false) {
  const value=typeof input==='string'?input:input.value;
  const at=parseLocalDateTime(value,{end,invalid:!!input?.validity?.badInput});
  if(end){endDateInput.value=value;until.value=at;preset.value='custom';}
  else{dateInput.value=value;since.value=at;preset.value='custom';}
  updateSinceRoute();expandSinceMatches();
}
// 再読込・フィルター切替でも、時刻軌跡を現在の一覧と同じ期間に保つ。
watch(tree,()=>{if(searchKind.value==='since')updateSinceRoute(false);});
async function grep() {
  clearSearch();expanded.value=new Set();cursor.value='';save();scrollToTop();
  if(!query.value.trim())return;
  beginSearch('grep');
  const run=generation, text=query.value, sensitive=caseSensitive.value;controller=new AbortController();status.value='検索中…';searching.value=true;rootExpanded.value=false;
  try {
    const response=await fetch('/api/grep?'+new URLSearchParams({q:text,case:sensitive?'1':'0'}),{signal:controller.signal});
    if(!response.ok)throw Error(await response.text());const result=await response.json();
    if(run!==generation)return;
    matches.value=new Set(result.paths);
    acceptSearch(result.paths,'grep',text);
    grepResults.value=Array.isArray(result.matches)?result.matches:[];resultQuery.value=text;resultCase.value=sensitive;
    const next=new Set();
    for(const path of result.paths){const parts=path.split('/');for(let i=1;i<parts.length;i++)next.add(parts.slice(0,i).join('/'));}
    expanded.value=next;save();
    status.value=`${result.paths.length}ファイル一致（検索 ${result.checked}・対象外 ${result.skipped}）${result.truncated?' ※一部の結果':''}`;
    if (result.truncated) status.value += ` ${scanWarning(result, '検索')}`;
  }catch(e){if(run===generation)status.value=`検索できません: ${e.message}`;}
  finally{if(run===generation){searching.value=false;rootExpanded.value=true;nextTick(scrollToTop);}}
}
let fileNavigationVersion=0;
// 右クリックは閲覧位置を動かさず、操作対象だけをカーソルへ合わせる。
const fileActions=createExplorerActions({root:()=>props.root||'',document:()=>panel.value?.ownerDocument,
  checked:()=>{const all=[];function walk(node,prefix=''){if(!node)return;for(const dir of node.d){const path=prefix+dir.n;all.push({type:'dir',path,name:dir.n});walk(dir,path+'/');}for(const [name,size,mtime]of node.f)all.push({type:'file',path:prefix+name,name,size,mtime});}walk(tree.value);return all.filter(row=>checkedPaths.value.has(row.path));},
  // 別窓へDOMを移しても、元のIDEの限定IPCとセッション検証を通す。
  openFile:typeof window.aidiyWindow?.openFile==='function'?path=>window.aidiyWindow.openFile(path):null,
  openFolder:typeof window.aidiyWindow?.openFolder==='function'?path=>window.aidiyWindow.openFolder(path):null,
  openDraft:draftActions?request=>{draftRequest.value=request;}:null,
  focus:()=>treeElement.value?.focus({preventScroll:true}),edit:row=>{cursor.value=row.path;reveal(row.path);},
  refresh:async()=>{if(multipleChecked.value)throw Error('複数チェックを解除すると一覧取得を再開します。');if(props.reload)await props.reload();},
  changed:async(result,isCurrent)=>{
    const navigation=fileNavigationVersion;
    const changes=result.results||[result];
    for(const result of changes){
    const previous=result.previousPath||result.path;
    if(result.action==='rename'){
      expanded.value=new Set([...expanded.value].map(path=>renamedPath(path,previous,result.path)));
      cursor.value=renamedPath(cursor.value,previous,result.path);
    }else if(result.action==='trash'){
      expanded.value=new Set([...expanded.value].filter(path=>!containsPath(previous,path)));
      if(containsPath(previous,cursor.value))cursor.value='';
    }
    if(result.action==='rename')checkedPaths.value=new Set([...checkedPaths.value].map(path=>renamedPath(path,previous,result.path)));
    else if(result.action==='trash')checkedPaths.value=new Set([...checkedPaths.value].filter(path=>!containsPath(previous,path)));
    clearSearch();recentUpdates.value=recentUpdates.value.filter(file=>!containsPath(previous,file.path));save();
    }
    if(props.applyFileChange)await props.applyFileChange(result);
    if(isCurrent()&&navigation===fileNavigationVersion&&result.action!=='trash'&&!result.results){cursor.value=result.path;reveal(result.path);}
  }});
const fileActionState=fileActions.state;
function contextMenu(event,row){if(fileActionState.busy)return;fileNavigationVersion++;if(row)cursor.value=row.path;void fileActions.showMenu(event,row,panel.value);}
function renameKey(event){
  if(event.isComposing||event.keyCode===229)return;
  if(event.key==='Escape'){event.preventDefault();fileActions.cancel();}
  else if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void fileActions.submitName();}
}
watch(()=>[props.root,props.startedAt],()=>{checkedPaths.value=new Set();checkAnchor='';fileActions.reset();draftRequest.value=null;});
// 閉じる・別窓へ移す途中に古い連携ダイアログを残さない。
watch([()=>props.open,detached],()=>{draftRequest.value=null;});
watch(()=>props.open,value=>{if(!value)fileActions.closeMenu();});
watch(mode,()=>{fileActions.closeMenu();if(!fileActionState.busy)fileActions.cancel();});
function rowKey(event,row){const command=fileActions.keyboard(event,row);if(command==='menu'){contextMenu(event,row);return true;}return command;}
function key(event) {
  if(event.target?.closest?.('input:not([type="checkbox"]),textarea,[contenteditable="true"]'))return;
  if(event.key===' '&&event.target?.closest?.('input[type="checkbox"]'))return;
  const index=rows.value.findIndex(row=>row.path===cursor.value), row=rows.value[index];let next=index;
  const command=rowKey(event,row);
  if(command||fileActionState.rename||fileActionState.dialog||fileActionState.busy)return;
  if(event.key==='Escape'&&multipleChecked.value){event.preventDefault();event.stopPropagation();checkedPaths.value=new Set(props.selected?[props.selected]:[]);return;}
  if(event.key===' '&&row){event.preventDefault();event.stopPropagation();toggleCheck(row);return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){
    event.preventDefault();event.stopPropagation();const parent=row?checkParent(row.path):props.current||'';
    checkedPaths.value=new Set(rows.value.filter(item=>checkParent(item.path)===parent).map(item=>item.path));return;
  }
  if(event.key==='ArrowDown')next=Math.min(rows.value.length-1,index+1);
  else if(event.key==='ArrowUp')next=Math.max(0,index-1);
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=rows.value.length-1;
  else if(event.key==='ArrowRight'&&row?.type==='dir'&&!row.open)toggle(row);
  else if(event.key==='ArrowLeft'&&row?.type==='dir'&&row.open)toggle(row);
  else if(event.key==='Enter'&&row)select(row);
  else return;
  event.preventDefault();event.stopPropagation();if(rows.value[next]){cursor.value=rows.value[next].path;if(event.shiftKey)clickRow(event,rows.value[next]);reveal(cursor.value);}
}
watch(()=>props.root,()=>{try{expanded.value=new Set(JSON.parse(localStorage.getItem(`aidiy_ide:explorer:${props.root}`)||'{}').expanded||[]);}catch{expanded.value=new Set();}},{immediate:true});
watch(()=>props.root,(value,previous)=>{
  if(previous !== undefined){clearSearch();resetLatest();initialSent=false;void pollLatest();}
  aiResult.value=null;searchRoute.value=[];searchKind.value='';searchTitle.value='';routeMode.value='view';
  routeListOpen.value=false;
},{immediate:true});
watch([routeMode,aiRoute,searchRoute],()=>emit('route',{mode:routeMode.value,paths:routeMode.value==='search'?searchRoute.value:aiRoute.value,records:routeMode.value==='ai'?aiResult.value?.routeRecords:undefined}),{immediate:true});
watch(()=>[props.selected,props.current,props.open],()=>{if(props.open&&!props.navigating)reveal();});
watch(()=>props.startedAt,()=>{mode.value='since';clearSearch();resetLatest();initialSent=false;since.value=props.startedAt;until.value=null;dateInput.value=localDateTimeInput(since.value);endDateInput.value='';preset.value='start';if(searchKind.value==='since')updateSinceRoute(false);void pollLatest();});
watch(()=>props.filter,clearSearch);
watch(mode,clearSearch);
watch([mode,since,until,matches,aiResult],emitMarks,{immediate:true});
onBeforeUnmount(()=>{treeDrag.dispose();fileActions.dispose();routeDisposed=true;routeMotion.dispose();routeDocumentCleanup();routeWindow?.close();panelWindow?.close();cancelSinceExpansion();generation++;controller?.abort();clearInterval(latestTimer);latestDisposed=true;latestRun++;latestController?.abort();document.removeEventListener('pointerdown',closeRouteList);});
function captureLayout(){return{explorerName:detached.value?panel.value?.ownerDocument.defaultView?.name:'',routesName:routeDetached.value?routeElement.value?.ownerDocument.defaultView?.name:''};}
async function restoreLayout(saved){
  const panels=[];
  if(saved.explorerName){emit('update:open',true);await nextTick();if(!await pinExplorer())throw Error(pinError.value||'エクスプローラーを復元できません。');panels.push({previousName:saved.explorerName,name:captureLayout().explorerName});}
  if(saved.routesName){routeClosed.value=false;await nextTick();if(!await pinRoutes())throw Error(pinError.value||'軌跡バーを復元できません。');panels.push({previousName:saved.routesName,name:captureLayout().routesName});}
  return panels;
}
defineExpose({captureLayout,restoreLayout,reveal,focusDetached:()=>panelWindow?.focus()||false,pinForAll});
</script>
<template>
  <div class="explorer-component" data-component="FileExplorer">
    <button v-if="!open&&!detached" class="explorer-toggle burger-button" aria-label="エクスプローラーを開く" title="エクスプローラー" :aria-expanded="false" @click="emit('update:open',true)"><span class="burger burger-h" aria-hidden="true"><i></i><i></i></span></button>
    <!-- 軌跡バーはエクスプローラーと同じ扱い。閉じている時は縦三本の正方形ボタン、開くと同じ場所から横に開き、先頭の縦三本で閉じる。 -->
    <button v-if="routeClosed&&!routeDetached" class="route-restore-toggle burger-button" :class="{'explorer-open':open&&!detached,'explorer-detached':detached&&!preparingAll}" aria-label="軌跡バーを開く" title="軌跡バー" :aria-expanded="false" @click="openRoutes"><span class="burger burger-v" aria-hidden="true"><i></i><i></i></span></button>
    <div ref="routeElement" v-show="!routeClosed" class="explorer-routes" :class="{'explorer-collapsed':!open||(detached&&!preparingAll),'explorer-detached':detached&&!preparingAll}" role="group" aria-label="軌跡表示" @keydown.esc.stop.prevent="routeListOpen=false">
      <div class="route-controls" :data-aidiy-window-move-handle="routeDetached&&nativePanels?'':undefined"><button v-if="!allDisplays||routeDetached" class="burger-button route-burger" :aria-label="routeDetached&&nativePanels?'軌跡ウィンドウを移動':'軌跡バーを閉じる'" :title="routeDetached&&nativePanels?'ドラッグして移動':'軌跡バーを閉じる'" @click="routeDetached&&nativePanels?undefined:closeRoutes()"><span class="burger burger-v" aria-hidden="true"><i></i><i></i></span></button>
      <button v-for="[value,label] in [['view','閲覧軌跡'],['search',searchRouteLabel],['ai','AI検索軌跡']]" :key="value" class="route-choice" :title="label" :aria-pressed="routeMode===value" :aria-expanded="routeMode===value&&routeListOpen" aria-controls="route-file-list" @click="chooseRoute(value)">{{ label }}</button>
      <button title="プロジェクトルートへ" @click="select({type:'dir',path:''})">ルート</button><button :aria-label="routeMode==='ai'?'前の関連ファイル':routeMode==='search'?'前の検索ファイル':'前の閲覧ファイル'" :disabled="!routeSteps.length||routeIndex===0" @click="stepRoute(-1)">&lt;</button><button :aria-label="routeMode==='ai'?'次の関連ファイル':routeMode==='search'?'次の検索ファイル':'次の閲覧ファイル'" :disabled="!routeSteps.length||routeIndex===routeSteps.length-1" @click="stepRoute(1)">&gt;</button>
      <button v-if="(!routeDetached||!nativePanels)&&(!allDisplays||!routeDetached)" class="route-detach panel-detach-pin" :class="{'pin-active':routeDetached}" :aria-pressed="routeDetached" :aria-label="routeDetached?'軌跡バーを本体へ戻す':'軌跡バーを別ウィンドウで開く'" :title="routeDetached?'本体へ戻す':'小さな別ウィンドウで開く'" @click="routeDetached?routeWindow.restore():pinRoutes()"><span aria-hidden="true">📌</span></button>
      </div>
      <div class="route-reveal" :data-phase="routeMotionState.phase" :style="{height:routeMotionState.height+'px'}">
      <section v-if="routeListOpen" :inert="!routeMotionState.visible" :aria-hidden="!routeMotionState.visible" :style="{visibility:routeMotionState.visible?'visible':'hidden'}" id="route-file-list" class="route-file-list" :aria-label="routeLabel+'のファイル一覧'">
        <p v-if="routeMode==='ai'&&aiResult" class="ai-route-title" :title="aiResult.query">{{ aiResult.title || aiResult.query }}</p>
        <p v-if="routeMode==='search'&&searchTitle" :title="searchTitle">{{ searchTitle }}</p>
        <p class="route-list-heading"><span>{{ routeLabel }} · {{ routePaths.length }}件</span><button v-if="routeMode==='view'" type="button" class="route-list-clear" aria-label="閲覧軌跡をクリア" :disabled="!viewedFiles.length" @click="emit('clear-view-history')">クリア</button></p>
        <p v-if="routeRows.length" class="route-tree-origin">{{ routeMode==='search'?'検索結果（並列の候補）':'記録された出発点と分岐' }}</p>
        <ul v-if="routeRows.length" class="route-tree" :aria-label="routeLabel+'のツリー'"><li v-for="row in routeRows" :key="row.key" :data-route-point="row.point" :data-route-parent="row.parent" :data-route-depth="row.depth" :class="{'route-reference':row.reference}" :style="{'--route-depth':row.depth}"><button :data-route-path="row.path" :aria-current="row.path===selected?'true':undefined" :title="routeMode==='ai'?aiFiles.get(row.path):row.path" @click="selectRoutePoint(row)"><span>{{ row.path || '/' }}{{ row.origin?'（出発元）':row.type==='dir'?'（到着）':'' }}{{ row.reference?' ↩（参照）':'' }}</span><small v-if="routeMode==='ai'">{{ aiFiles.get(row.path) }}</small><small v-else-if="routeMode==='view'">{{ viewedAt(row.path) }}</small></button></li></ul>
        <p v-else>{{ routeMode==='ai'?'AI検索の結果を選ぶと、ここに表示します。':routeMode==='search'?searchRouteLabel+'はありません。検索結果があると、ここに表示します。':'ファイルを開くと、ここに表示します。' }}</p>
      </section>
      </div>
    </div>
    <aside ref="panel" v-show="open" class="explorer-panel" aria-label="ファイルエクスプローラー" @contextmenu.self.prevent="contextMenu($event)" @pointerdown.capture="emit('activity')">
      <header>
        <button v-if="!allDisplays" class="burger-button explorer-burger" aria-label="エクスプローラーを閉じる" title="エクスプローラーを閉じる" :aria-expanded="true" @click="closeExplorer"><span class="burger burger-h" aria-hidden="true"><i></i><i></i></span></button><span>エクスプローラー</span>
        <button type="button" class="explorer-collapse" title="全てを閉じる" aria-label="全てを閉じる" :disabled="fileActionState.busy||!!fileActionState.rename" @click="cancelSinceExpansion();rootExpanded=true;expanded=new Set();save()"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 7V4a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v10"/><path d="M3 7h5l2 2h7a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><path d="M7 15h6"/></svg></button>
        <RefreshButton class="explorer-refresh" :class="{refreshing:fileActionState.refreshing}" :busy="fileActionState.refreshing" :title="fileActionState.refreshing?'一覧を更新中…':'一覧を更新'" aria-label="一覧を更新" :disabled="multipleChecked||!reload||fileActionState.busy||!!fileActionState.rename||!!fileActionState.dialog||searching||!!draftRequest" @click="fileActions.action('refresh')" />
        <button v-if="(!detached||!nativePanels)&&(!allDisplays||!detached)" class="explorer-detach panel-detach-pin" :class="{'pin-active':detached}" :aria-pressed="detached" :aria-label="detached?'本体へ戻す':'エクスプローラーを別ウィンドウで開く'" :title="detached?'本体へ戻す':'別ウィンドウで開く'" @click="detached?panelWindow.restore():pinExplorer()"><span aria-hidden="true">📌</span></button>
      </header>
      <p v-if="treeWarning" class="scan-warning" role="status">{{ treeWarning }}</p>
      <section class="explorer-search"><small>表示中: {{ current || tree?.n }}</small>
        <fieldset><legend class="sr-only">検索方法</legend><label><input v-model="mode" type="radio" value="since">時刻検索</label><label><input v-model="mode" type="radio" value="grep">grep検索</label><label><input v-model="mode" type="radio" value="ai">AI検索</label></fieldset>
        <div v-if="mode==='since'" class="time-search"><label>開始 <input type="datetime-local" step="1" :value="dateInput" :aria-invalid="!!dateError" :aria-describedby="dateError?'time-search-error':undefined" @change="chooseDate($event.target)"></label><label>終了 <input type="datetime-local" step="1" :value="endDateInput" :aria-invalid="!!dateError" aria-describedby="time-search-hint time-search-error" @change="chooseDate($event.target,true)"></label><small id="time-search-hint">終了は省略できます（開始以降）。</small><p id="time-search-error" v-show="dateError" role="alert">{{ dateError }}</p><div class="since-presets"><button v-for="[value,label] in timeSearchPresets" :key="value" :aria-pressed="preset===value" @click="choose(value)">{{ label }}</button></div></div>
        <form v-else-if="mode==='grep'" @submit.prevent>
          <label class="grep-query">ファイル内容<input v-model="query" type="search" maxlength="256" placeholder="検索する文字列"></label>
          <label><input v-model="caseSensitive" type="checkbox">大文字・小文字を区別</label>
          <div><button type="button" @click="grep">検索</button><button type="button" @click="query='';clearSearch()">解除</button></div>
          <p role="status">{{ status }}</p>
        </form>
        <AISearchPanel :key="root" :root="root" v-show="mode==='ai'" @search="beginSearch('ai')" @result="acceptAI" />
        <p v-if="mode==='ai'&&hiddenAI" role="status">{{ hiddenAI }}件は現在の一覧にありません。フィルターをOFFにするか一覧を更新してください。</p>
      </section>
      <section v-if="searchResults.length" class="explorer-search-results" aria-label="検索一覧">
        <button type="button" class="search-results-toggle" :aria-expanded="searchResultsOpen" aria-controls="explorer-search-result-list" @click="searchResultsOpen=!searchResultsOpen"><span aria-hidden="true">{{ searchResultsOpen?'▼':'▶' }}</span> 検索一覧 · {{ searchResultsLabel }} · {{ searchResults.length }}件</button>
        <div v-if="searchResultsOpen" id="explorer-search-result-list" class="search-results-content">
          <p v-if="mode==='ai'&&aiResult" :title="aiResult.query">{{ aiResult.title || aiResult.query }}</p>
          <ol :aria-label="searchResultsLabel+'の検索結果'"><li v-for="(result,index) in searchResults" :key="`${result.path}:${result.line||0}:${result.column||0}:${index}`"><button type="button" :title="result.line?`${result.path}:${result.line}:${result.column}`:result.path" :aria-current="selected===result.path?'true':undefined" @click="selectSearchResult(result)"><span>{{ result.path }}<template v-if="result.line">:{{ result.line }}:{{ result.column }}</template></span><small v-if="result.source==='grep'" class="search-result-snippet">{{ result.snippet }}</small><small v-else-if="result.source==='ai'">{{ result.reason }}</small><small v-else>{{ new Date(result.mtime).toLocaleString('ja-JP') }}</small></button></li></ol>
        </div>
      </section>
      <div class="explorer-root" :title="root" @contextmenu.prevent.stop="contextMenu($event,{type:'dir',path:'',name:tree?.n})" @keydown="rowKey($event,{type:'dir',path:'',name:tree?.n})">
        <button class="chevron" :aria-label="rootExpanded?'ルートフォルダを折りたたむ':'ルートフォルダを展開する'" :aria-expanded="rootExpanded" :disabled="searching||fileActionState.busy||!!fileActionState.rename" @click="cancelSinceExpansion();rootExpanded=!rootExpanded"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" :class="{expanded:rootExpanded}"><path d="M3 1 14 8 3 15Z" /></svg></button>
        <button class="explorer-root-name" :disabled="searching" @click="select({type:'dir',path:''})"><FileTypeIcon :name="tree?.n" directory :open="rootExpanded" /><span class="file-name">{{ tree?.n }}</span></button>
      </div>
      <p v-if="checkedPaths.size" class="explorer-checked-status" role="status">☑ {{ checkedPaths.size }}件<template v-if="multipleChecked"> · 最終更新・一覧取得を停止中</template><button type="button" :disabled="fileActionState.busy" @click="checkedPaths=new Set()">チェック解除</button></p>
      <ul ref="treeElement" aria-multiselectable="true" @pointerdown="treeDrag.down" @click.capture="treeDrag.click" @dblclick.capture="treeDrag.click" @dragstart="treeDrag.dragstart" role="tree" tabindex="0" :data-aidiy-window-move-list="detached&&nativePanels?'':undefined" @keydown="key" @contextmenu.prevent.stop="contextMenu($event)"><TransitionGroup name="explorer-branch" @before-leave="beforeTreeLeave" @after-leave="afterTreeLeave" @leave-cancelled="afterTreeLeave"><li v-for="row in rows" :key="row.path" role="treeitem" :aria-expanded="row.type==='dir'?row.open:undefined" :aria-selected="checkedPaths.has(row.path)" :data-path="row.path" :data-entry-type="row.type" :title="mode==='ai'?aiFiles.get(row.path):undefined" :style="{'--depth':row.depth}" :class="{fresh:row.fresh,'plain-folder':row.type==='dir'&&mode!=='ai',selected:selected===row.path,cursor:cursor===row.path}" @click="clickRow($event,row)" @mousedown="($event.shiftKey||$event.ctrlKey||$event.metaKey)&&$event.preventDefault()" @contextmenu.prevent.stop="contextMenu($event,row)">
        <button v-if="row.type==='dir'" class="chevron" :aria-expanded="row.open" :aria-label="row.open?'折りたたむ':'展開する'" @click.stop="toggle(row)"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" :class="{expanded:row.open}"><path d="M3 1 14 8 3 15Z" /></svg></button><span v-else class="chevron"></span><input class="explorer-row-check" type="checkbox" :aria-label="row.name+'をチェック'" :checked="checkedPaths.has(row.path)" :disabled="fileActionState.busy||!!fileActionState.rename||!!fileActionState.dialog" @click.stop @dblclick.stop @change="toggleCheck(row)"><FileTypeIcon :name="row.name" :directory="row.type==='dir'" :open="row.open" /><input v-if="fileActionState.rename?.path===row.path" v-model="fileActionState.rename.value" class="explorer-rename" aria-label="新しい名前" :disabled="fileActionState.busy" maxlength="255" autocomplete="off" spellcheck="false" @click.stop @contextmenu.stop @keydown.stop="renameKey" @blur="!fileActionState.busy&&fileActions.cancel()"><span v-else class="file-name">{{ row.name }}</span><span v-if="fileActionState.rename?.path!==row.path" class="file-meta">{{ row.type==='dir'?(row.fresh?`${mode==='ai'?'関連':'更新'} ${row.fresh}`:''):new Date(row.mtime).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}) }}</span><span v-if="row.fresh" class="file-mark">●</span>
      </li></TransitionGroup></ul>
      <!-- 最下部: 前回取得以降の更新。次の更新が来るまで維持する。 -->
      <footer class="explorer-footer">
        <p v-if="latestWarning" class="scan-warning" role="status">{{ latestWarning }}</p>
        <small v-if="recentUpdates.length">最終更新 · {{ recentUpdates.length }}件</small>
        <div v-if="recentUpdates.length" class="explorer-latest-list" aria-label="最終更新ファイル一覧">
          <button v-for="file in recentUpdates" :key="file.path" class="explorer-latest" :data-latest-path="file.path" :title="`${file.path} · ${new Date(file.mtime).toLocaleString('ja-JP')}`" @click="select({type:'file',path:file.path,mtime:file.mtime,source:'latest'})" @contextmenu.prevent.stop="contextMenu($event,{...file,type:'file'})" @keydown="rowKey($event,{...file,type:'file'})"><FileTypeIcon :name="file.name" /><span class="file-name">{{ file.name }}</span><span class="file-meta">{{ latestTime(file) }}</span></button>
        </div>
      </footer>
      <ExplorerActionView :actions="fileActions" />
      <!-- 同じダイアログをExplorer内に置き、ピン留め先のDocumentで操作できるようにする。 -->
      <DraftHandoffDialog v-if="draftRequest&&draftActions" data-aidiy-no-window-move :request="draftRequest" :load-targets="draftActions.loadTargets" :insert-draft="draftActions.insertDraft" :launch-target="draftActions.launchTarget" @close="draftRequest=null" />
    </aside>
    <p v-if="pinError" class="app-error" role="alert">{{ pinError }}</p>
  </div>
</template>

<style scoped>
.explorer-panel>ul[role="tree"]{user-select:none}.explorer-panel>ul.explorer-dragging,.explorer-panel>ul.explorer-dragging *{cursor:grabbing}.explorer-panel .explorer-rename{user-select:text}
.explorer-panel .explorer-collapse{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;min-width:24px;padding:0}.explorer-collapse svg{display:block;pointer-events:none}
/* 字体と本文サイズに左右されない開閉印。ファイルの空枠にも同じ幅を使う。 */
.explorer-panel .chevron{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;min-width:20px;height:24px;padding:0;box-sizing:border-box}
.explorer-panel .chevron svg{width:11.2px;height:11.2px;display:block;fill:currentColor;pointer-events:none}.explorer-panel .chevron svg.expanded{transform:rotate(90deg);fill:none;stroke:currentColor;stroke-width:1.5}
/* 秒とカレンダー操作を残したまま中央揃え。狭幅ではラベルを折返し、さらに狭ければ横スクロールする。 */
.time-search{overflow-x:auto}
.time-search>label{display:flex;align-items:center;flex-wrap:wrap;justify-content:safe center;gap:6px;margin-bottom:5px}
.explorer-panel .time-search input[type=datetime-local]{flex:1 0 auto;min-width:max-content;max-width:none;box-sizing:border-box;text-align:center}
.explorer-panel .time-search input[type=datetime-local]::-webkit-datetime-edit{display:flex;justify-content:safe center}
.time-search>small{display:block}.time-search>p{margin:5px 0;color:#ffaaa5;white-space:normal}
.explorer-rename{flex:1;min-width:0;width:0;height:23px;box-sizing:border-box;background:#0c1424;color:#fff;border:1px solid #8de6eb;padding:1px 4px;font:inherit}.explorer-rename:focus{outline:1px solid #8de6eb}

.scan-warning{margin:0;padding:6px 8px;color:#ffe28a;font-size:var(--file-font-size,10px);overflow-wrap:anywhere;flex-shrink:0}
.explorer-search-results{flex:none;min-height:0;max-height:min(180px,25%);display:flex;flex-direction:column;border-bottom:1px solid #29334c}
.explorer-panel .search-results-toggle{flex:none;width:100%;text-align:left;padding:6px 8px}
.search-results-content{min-height:0;overflow:auto;padding:0 8px 6px;font-size:11px}
.search-results-content p{overflow-wrap:anywhere;color:#a7f6ff}
.search-results-content ol{list-style:none;margin:0;padding:0}
.explorer-panel .search-results-content li{display:block;height:auto;padding:0;margin:4px 0}
.search-results-content button{display:block;width:100%;text-align:left;overflow-wrap:anywhere}
.search-results-content button[aria-current=true]{background:#18293c}
.search-results-content small{display:block;white-space:pre-wrap;color:#92a5bf;line-height:1.5;margin-top:3px}
.search-result-snippet{font-family:var(--mono)}
</style>
