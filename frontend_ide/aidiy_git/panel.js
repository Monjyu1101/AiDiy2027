// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {installGitChrome} from './panel-chrome.js';
import {installGitHubTabs} from './github-tabs.js';
const $=id=>document.getElementById(id);
const token=document.querySelector('meta[name=aidiy-git]').content,session=document.querySelector('meta[name=aidiy-session]').content;
let state, busy=false, selected=null, view='diff', reviewGeneration=0;
const make=(tag,value,cls)=>{const node=document.createElement(tag);if(value!=null)node.textContent=value;if(cls)node.className=cls;return node;};
const note=(text='',error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
const remote=()=>$('remote').value;
const remoteInfo=()=>state?.remotes?.find(item=>item.name===remote());
const upstreamMatches=()=>!!state?.head && !!state?.branch && state.upstream?.remote===remote();
async function request(action,body,signal){
 const response=await fetch('/api/git/'+action,{method:body===undefined?'GET':'POST',signal,cache:'no-store',headers:{'X-AiDiy-Git':token,'X-AiDiy-Git-Session':session,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await response.json();
 if(!response.ok)throw Error(value.error||'Git の処理に失敗しました。');
 return value;
}
const chrome=installGitChrome({request});
const github=installGitHubTabs({load:action=>request(action,{remote:remote()}),onGitTab:()=>{}});
function controls(){
 const target=remoteInfo();
 $('counts').textContent=state?.ahead==null||!upstreamMatches()?'':`↑${state.ahead} ↓${state.behind}（前回取得時点）`;
 $('commit').disabled=busy||!state?.rows.some(row=>!row.untracked&&row.index!==' ')||state.rows.some(row=>row.conflict)||!$('commit-text').value.trim();
 $('refresh').disabled=busy;
 $('remote').disabled=busy||!state?.remotes.length;
 $('fetch').disabled=busy||!target;
 $('pull').disabled=busy||!upstreamMatches()||state.rows.some(row=>!row.untracked);
 $('push').disabled=busy||!state?.branch||!state?.head||(!!state.upstream&&!upstreamMatches())||target?.push?.length!==1;
 $('force-push').hidden=!target?.github;
 $('force-push').disabled=$('push').disabled||!state?.upstream?.oid;
 for(const button of document.querySelectorAll('[data-stage]'))button.disabled=busy;
 const ref=state?.upstream?.remote===target?.name?state?.upstream?.ref?.replace(/^refs\/heads\//,''):'';
 $('target').textContent=target?`${target.name}${ref?' / '+ref:''} · ${target.fetch.join(', ')}${target.push.join('|')===target.fetch.join('|')?'':' ／ 送信: '+target.push.join(', ')}`:'リモート未設定。ローカルで変更確認とコミットができます。';
 github.update(target);
}
const sideRows=(side)=>state?.rows?.filter(row=>side==='work'?(row.untracked||row.work!==' '):!row.untracked&&row.index!==' ')||[];
function draw(){
 $('project').textContent='プロジェクト: '+(state?.project||'Git');
 $('branch').textContent=state?.branch||(state?.detached?'detached HEAD':'');
 const before=remote();
 const options=(state?.remotes||[]).map(({name})=>{const option=make('option',name);option.value=name;return option;});
 $('remote').replaceChildren(...options);
 $('remote').value=state?.remotes.some(item=>item.name===before)?before:state?.upstream?.remote||options[0]?.value||'';
 for(const side of ['work','index']){
  const list=$(side),rows=sideRows(side);
  $(side+'-count').textContent=rows.length;
  list.replaceChildren();
  if(!rows.length){list.append(make('li','変更なし','empty'));continue;}
  for(const row of rows){
   const line=make('li',null,row.conflict?'conflict':'');
   const label=row.untracked?'?':side==='work'?row.work:row.index;
   const file=make('button',`${label}  ${row.old?row.old+' → ':''}${row.path}`);
   file.title=row.path;file.setAttribute('aria-pressed',String(selected?.path===row.path&&selected?.side===side));
   file.onclick=()=>{selected={path:row.path,side};view='diff';draw();void renderReview();};
   const stage=make('button',side==='work'?'+':'−');
   stage.title=side==='work'?'ステージに追加':'ステージを解除';
   stage.setAttribute('aria-label',stage.title+': '+row.path);stage.dataset.stage='';
   stage.onclick=()=>perform(side==='work'?'stage':'unstage',{path:row.path});
   line.append(file,stage);list.append(line);
  }
 }
 controls();
}
async function renderReview(){
 const generation=++reviewGeneration;
 $('show-diff').setAttribute('aria-pressed',String(view==='diff'));
 $('show-history').setAttribute('aria-pressed',String(view==='history'));
 $('diff').hidden=view!=='diff';$('history').hidden=view!=='history';
 $('selection').textContent=view==='diff'&&selected?selected.path:'';
 try{
  if(view==='history'){
   $('history').replaceChildren(make('li','履歴を取得中…'));
   const value=await request('history');if(generation!==reviewGeneration)return;
   $('history').replaceChildren(...(value.entries.length?value.entries.map(entry=>{
    const line=make('li');line.append(make('strong',entry.id+'  '),make('span',entry.date+'  '+entry.subject));return line;
   }):[make('li','コミットはまだありません。')]));
  }else{
   if(selected&&!sideRows(selected.side).some(row=>row.path===selected.path))selected=null;
   if(!selected){$('diff').textContent='変更一覧からファイルを選んでください。';$('selection').textContent='';return;}
   $('diff').textContent='差分を取得中…';
   const value=await request('diff',selected);if(generation!==reviewGeneration)return;
   if(!value.diff){$('diff').textContent='表示できる差分はありません。';return;}
   const lines=value.diff.split('\n'),max=6000;
   $('diff').replaceChildren(...lines.slice(0,max).map(line=>make('span',line,'line '+(line.startsWith('@@')?'chunk':line.startsWith('+')&&!line.startsWith('+++')?'added':line.startsWith('-')&&!line.startsWith('---')?'removed':''))));
   if(lines.length>max)$('diff').append(make('span','表示は先頭6,000行までです。','line'));
  }
 }catch(error){if(generation!==reviewGeneration)return;if(view==='diff')$('diff').textContent=error.message;else $('history').replaceChildren(make('li',error.message));}
}
async function refresh(){
 if(busy)return;busy=true;controls();note('読み込み中…');
 try{state=await request('status');draw();note(state.rows.some(row=>row.conflict)?'競合があります。エディター等で解消してください。':'');void renderReview();}
 catch(error){note(error.message,true);}
 finally{busy=false;controls();}
}
const names={stage:'ステージ',unstage:'ステージ解除',commit:'コミット',fetch:'取得',pull:'取り込み',push:'送信','force-push':'強制送信'};
async function perform(action,fields={}){
 if(busy||!state)return;busy=true;chrome.operationStarted();controls();note(names[action]+'中…');
 let ok=false;
 try{
  state=await request(action,{revision:state.revision,...fields});
  if(action==='commit')$('commit-text').value='';
  draw();note(names[action]+'しました。');ok=true;void renderReview();
 }catch(error){note(error.message,true);}
 finally{chrome.operationFinished(ok);busy=false;controls();}
}
$('commit-text').oninput=controls;
$('remote').onchange=controls;
$('refresh').onclick=refresh;
$('commit').onclick=()=>perform('commit',{message:$('commit-text').value});
$('fetch').onclick=()=>perform('fetch',{remote:remote()});
$('pull').onclick=()=>{const s=state;if(s?.upstream&&confirm(`${s.branch} に ${remote()}/${s.upstream.ref.replace(/^refs\/heads\//,'')} を取り込みます。履歴が分岐している場合は停止します。よろしいですか？`))void perform('pull',{remote:remote()});};
$('push').onclick=()=>{const r=remoteInfo(),s=state;if(r&&s?.branch&&confirm(`${s.branch} のコミットを\n${r.push[0]}\n${s.upstream?.ref||'refs/heads/'+s.branch} に送信しますか？${s.upstream?'':'（この送信先を追跡先に設定）'}`))void perform('push',{remote:r.name});};
let forceSelection=null;
$('force-push').onclick=()=>{
 const r=remoteInfo(),s=state;
 if(!r?.github||!s?.upstream?.oid)return;
 forceSelection={branch:s.branch,remote:r.name,revision:s.revision};
 $('force-target').textContent=`${r.github.url} の ${s.upstream.ref} を上書きします。入力するブランチ名: ${s.branch}`;
 $('force-confirm').value='';
 $('force-submit').disabled=true;
 $('force-dialog').returnValue='';
 $('force-dialog').showModal();
};
$('force-cancel').onclick=()=>$('force-dialog').close('cancel');
$('force-submit').onclick=()=>$('force-dialog').close('confirm');
$('force-confirm').oninput=()=>{$('force-submit').disabled=$('force-confirm').value!==forceSelection?.branch;};
$('force-dialog').onclose=()=>{
 const selection=forceSelection;forceSelection=null;
 if(selection&&$('force-dialog').returnValue==='confirm'&&selection.revision===state?.revision&&$('force-confirm').value===selection.branch)
  void perform('force-push',{remote:selection.remote,confirm:selection.branch});
};
$('show-diff').onclick=()=>{view='diff';void renderReview();};
$('show-history').onclick=()=>{view='history';void renderReview();};
controls();
void refresh();
