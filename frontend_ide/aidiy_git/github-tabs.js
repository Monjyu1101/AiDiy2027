// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// PR・Issue タブは github.com のリモートだけ。一覧は読み取り専用、編集は公式サイトで行う。
const host='https://github.com';
const kinds=Object.freeze({
 pr:{label:'Pull Request',list:'pulls',entry:'pull',newPath:'compare',states:[['open','オープン'],['merged','マージ済'],['closed','クローズ済']]},
 issue:{label:'Issue',list:'issues',entry:'issues',newPath:'issues/new/choose',states:[['open','オープン'],['closed','クローズ済']]},
});
function githubTarget(remote) {
 const source=remote?.github;
 const owner=source?.owner,repo=source?.repo;
 if(typeof owner!=='string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)
  || typeof repo!=='string' || !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo==='.' || repo==='..')return null;
 const url=`${host}/${owner}/${repo}`;
 // 参照先は表示用のURLを信用せず、許可したオーナーとリポジトリ名から作る。
 return {owner,repo,url,name:typeof remote.name==='string'?remote.name:''};
}
const keyOf=target=>target&&JSON.stringify([target.url,target.name]);
const stateOf=value=>typeof value?.state==='string'?value.state.toLowerCase():'';
function element(tag,content,className){
 const node=document.createElement(tag);
 if(content!==undefined)node.textContent=content;
 if(className)node.className=className;
 return node;
}
function anchor(url,caption){
 const node=element('a',caption);
 node.href=url;node.target='_blank';node.rel='noopener noreferrer';
 return node;
}
function titleOf(item) {
 return typeof item.title==='string'&&item.title.trim()?item.title.trim().slice(0,300):'（タイトルなし）';
}
const dateLabel=new Intl.DateTimeFormat('ja-JP',{dateStyle:'medium'});
function displayMeta(item,labels){
 const output=[labels.get(stateOf(item))||''];
 const author=item?.author?.login;
 if(typeof author==='string'&&/^[A-Za-z0-9._\[\]-]{1,64}$/.test(author))output.push('@'+author);
 if(typeof item.updatedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(item.updatedAt)){
  const date=new Date(item.updatedAt);
  if(Number.isFinite(date.getTime()))output.push(dateLabel.format(date));
 }
 return output.filter(Boolean).join(' · ');
}

export function installGitHubTabs({load,onGitTab}){
 const git=document.getElementById('git-content'),view=document.getElementById('github-content');
 const guide=document.getElementById('guide-content');
 const tabs=Object.fromEntries(['guide','git','pr','issue'].map(id=>[id,document.getElementById('tab-'+id)]));
 const object={pr:null,issue:null};
 const filters={pr:'open',issue:'open'};
 let target=null,tab='git',generation=0;
 function sync(){
  for(const [id,button] of Object.entries(tabs)){
   button.hidden=Object.hasOwn(kinds,id)&&!target;
   button.setAttribute('aria-pressed',String(id===tab));
  }
  git.hidden=tab!=='git';guide.hidden=tab!=='guide';view.hidden=!Object.hasOwn(kinds,tab);
 }
 function render(){
  const conf=kinds[tab];
  if(!conf||!target){view.replaceChildren();return;}
  const {url,owner,repo}=target,state=object[tab],labels=new Map(conf.states),filter=filters[tab];
  const header=element('header',undefined,'github-header');
  header.append(element('h2',conf.label),element('p',`${owner}/${repo}`));
  const controls=element('div',undefined,'github-controls');
  const list=anchor(`${url}/${conf.list}`,`GitHub で ${conf.label} を管理 ↗`);
  const create=anchor(`${url}/${conf.newPath}`,tab==='pr'?'新規 PR ↗':'新規 Issue ↗');
  const refresh=element('button',state?.pending?'読込中…':'再読込');
  refresh.type='button';refresh.disabled=!!state?.pending;
  refresh.addEventListener('click',()=>void request(tab));
  const filterInput=element('select');filterInput.setAttribute('aria-label','状態で絞り込む');
  for(const [value,caption] of [['all','すべて'],...conf.states]){
   const option=element('option',caption);option.value=value;filterInput.append(option);
  }
  filterInput.value=filter;
  filterInput.addEventListener('change',()=>{
   const next=filterInput.value;
   if(next!=='all'&&!labels.has(next))return;
   filters[tab]=next;render();
   // 再描画後も連続してキーボード操作できるようにする。
   view.querySelector('select')?.focus();
  });
  controls.append(list,create,refresh,filterInput);
  if(state?.pending&&!state.entries){
   const note=element('p',conf.label+' 一覧を読み込んでいます。','github-notice');
   note.setAttribute('role','status');view.replaceChildren(header,controls,note);return;
  }
  const loaded=state?.entries||[],rows=filter==='all'?loaded:loaded.filter(item=>stateOf(item)===filter);
  const note=element('p',state?.failed
   ? '一覧を取得できませんでした。GitHub CLI（gh）の導入・ログイン・リポジトリへのアクセス権を確認するか、上のリンクから開いてください。'
   : rows.length?`${rows.length} 件表示（最近の取得分）`:'取得した一覧に該当項目はありません。','github-notice');
  note.setAttribute('role','status');
  const entries=element('ul',undefined,'github-list');
  for(const item of rows){
   const li=element('li',undefined,'github-entry');
   const link=anchor(`${url}/${conf.entry}/${item.number}`,`#${item.number} ${titleOf(item)}`);
   const meta=displayMeta(item,labels);
   li.append(link);
   if(meta)li.append(element('span',meta,'github-meta'));
   entries.append(li);
  }
  view.replaceChildren(header,controls,note,entries);
 }
 async function request(id){
  if(!target||!Object.hasOwn(kinds,id)||object[id]?.pending)return;
  const version=generation,name=target.name;
  const data=object[id]={entries:object[id]?.entries,pending:true,failed:false};
  if(tab===id)render();
  try {
   const response=await load('github-'+id,name);
   if(!Array.isArray(response?.entries))throw Error('invalid GitHub list');
   if(version!==generation)return;
   const seen=new Set();
   data.entries=response.entries.filter(item=>{
    const number=item?.number;
    if(!Number.isSafeInteger(number)||number<1||seen.has(number))return false;
    seen.add(number);return true;
   }).slice(0,100);
  }catch{
   if(version!==generation)return;
   data.failed=true;
  }finally{
   if(version===generation){data.pending=false;if(tab===id)render();}
  }
 }
 function select(id){
  if(id!=='git'&&id!=='guide'&&(!target||!Object.hasOwn(kinds,id)))return;
  const previous=tab;tab=id;sync();render();
  if(id==='git'){if(previous!=='git')onGitTab?.();return;}
  if(Object.hasOwn(kinds,id)&&!object[id])void request(id);
 }
 for(const [id,button] of Object.entries(tabs))button.addEventListener('click',()=>select(id));
 sync();
 return {
  update(remote){
   const next=githubTarget(remote);
   if(keyOf(next)===keyOf(target))return;
   target=next;generation++;object.pr=null;object.issue=null;
   if(!target&&Object.hasOwn(kinds,tab)){select('git');return;}
   sync();render();
   if(Object.hasOwn(kinds,tab))void request(tab);
  },
  reset(){
   target=null;generation++;object.pr=null;object.issue=null;
   filters.pr='open';filters.issue='open';select(tab==='guide'?'guide':'git');
  },
 };
}
