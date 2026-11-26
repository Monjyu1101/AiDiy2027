// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {installGitHubTabs} from './github-tabs.js';

class Node {
 constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.events={};this.hidden=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 addEventListener(name,callback){this.events[name]=callback;}
 setAttribute(name,value){this.attrs[name]=value;}
 querySelector(tag){return [...this.nodes(tag)][0];}
 focus(){this.focused=true;}
 *nodes(tag){if(this.tagName===tag)yield this;for(const node of this.children)yield* node.nodes(tag);}
}
const next=()=>new Promise(resolve=>setImmediate(resolve));
const repo=(owner,repo,name='origin')=>({name,github:{owner,repo,url:'https://imposter.test/something'}});

test('GitHub tabs work only for selected GitHub repositories and ignore unsafe links',async()=>{
 const ids=Object.fromEntries(['tab-guide','tab-git','tab-pr','tab-issue','git-content','guide-content','github-content'].map(id=>[id,new Node(id)]));
 const view=ids['github-content'],old=globalThis.document;
 globalThis.document={getElementById:id=>ids[id],createElement:tag=>new Node(tag)};
 let calls=[],returned=0,release;
 const tabs=installGitHubTabs({onGitTab:()=>{returned++;},load:(action,name)=>{
  calls.push([action,name]);
  if(action==='github-issue')return new Promise(resolve=>{release=resolve;});
  return Promise.resolve({entries:[
   {number:1,title:'<img src=x onerror=alert(1)>',state:'OPEN',url:'https://imposter.test/2',author:{login:'app[bot]'}},
   {number:4,title:'Merged',state:'MERGED'},{number:1,state:'OPEN'},{number:-1,state:'OPEN'},{number:'1',state:'OPEN'}
  ]});
 }});
 try {
  assert.equal(ids['tab-pr'].hidden,true);
  assert.equal(view.hidden,true);
  tabs.update(repo('owner','..'));
  assert.equal(ids['tab-pr'].hidden,true);
  tabs.update(repo('owner','repo'));
  assert.equal(ids['tab-pr'].hidden,false);
  ids['tab-pr'].events.click();await next();
  assert.equal(view.hidden,false);
  assert.equal(ids['git-content'].hidden,true);
  assert.deepEqual(calls,[['github-pr','origin']]);
  let links=[...view.nodes('a')];
  assert.deepEqual(links.map(link=>link.href),['https://github.com/owner/repo/pulls','https://github.com/owner/repo/compare','https://github.com/owner/repo/pull/1']);
  assert.equal(links[2].textContent,'#1 <img src=x onerror=alert(1)>');
  assert.equal(links[2].rel,'noopener noreferrer');
  assert.equal([...view.nodes('span')][0].textContent,'オープン · @app[bot]');
  let filter=view.querySelector('select');filter.value='merged';filter.events.change();
  assert.equal(view.querySelector('select').focused,true);
  assert.match([...view.nodes('a')].at(-1).href,/pull\/4$/);
  ids['tab-issue'].events.click();
  assert.equal(calls.at(-1)[0],'github-issue');
  tabs.update({name:'origin'});
  assert.equal(ids['tab-issue'].hidden,true);
  release({entries:[{number:8,title:'stale',state:'OPEN'}]});await next();
  assert.equal(view.hidden,true);
  assert.equal(view.children.length,0);
  assert.equal(returned,1);
 }finally {globalThis.document=old;}
});

test('CLI failure keeps the official issue and creation links available',async()=>{
 const ids=Object.fromEntries(['tab-guide','tab-git','tab-pr','tab-issue','git-content','guide-content','github-content'].map(id=>[id,new Node(id)]));
 const view=ids['github-content'],old=globalThis.document;
 globalThis.document={getElementById:id=>ids[id],createElement:tag=>new Node(tag)};
 try{
  const tabs=installGitHubTabs({load:async()=>{throw Error('token: must not leak');}});
  tabs.update(repo('owner','repo','upstream'));
  ids['tab-issue'].events.click();await next();
  assert.deepEqual([...view.nodes('a')].map(link=>link.href),['https://github.com/owner/repo/issues','https://github.com/owner/repo/issues/new/choose']);
  assert.match([...view.nodes('p')].at(-1).textContent,/GitHub CLI/);
  assert.doesNotMatch(JSON.stringify(view),/must not leak/);
  tabs.reset();assert.equal(ids['tab-issue'].hidden,true);
 }finally {globalThis.document=old;}
});

test('初心者向け解説は常に開け、リモート・保存先変更で勝手に閉じない',()=>{
 const ids=Object.fromEntries(['tab-guide','tab-git','tab-pr','tab-issue','git-content','guide-content','github-content'].map(id=>[id,new Node(id)]));
 const old=globalThis.document;
 globalThis.document={getElementById:id=>ids[id],createElement:tag=>new Node(tag)};
 try{
  const tabs=installGitHubTabs({load:()=>assert.fail('解説は外部に接続しない')});
  assert.equal(ids['tab-guide'].hidden,false);assert.equal(ids['guide-content'].hidden,true);
  assert.equal(ids['tab-git'].attrs['aria-pressed'],'true');
  ids['tab-guide'].events.click();
  assert.equal(ids['guide-content'].hidden,false);
  assert.equal(ids['git-content'].hidden,true);
  assert.equal(ids['github-content'].hidden,true);
  tabs.update(repo('owner','repo'));tabs.reset();
  assert.equal(ids['guide-content'].hidden,false);
  assert.equal(ids['tab-pr'].hidden,true);
  ids['tab-git'].events.click();
  assert.equal(ids['guide-content'].hidden,true);
  assert.equal(ids['git-content'].hidden,false);
 }finally{globalThis.document=old;}
});
