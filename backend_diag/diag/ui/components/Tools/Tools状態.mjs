// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import {ref,computed} from 'vue';
const copy=value=>JSON.parse(JSON.stringify(value));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function Tools状態を作成({api,利用可能=()=>true,代表テスト={}}={}){
 const 認証済み=ref(false),処理中=ref(''),通知=ref(''),項目=ref([]),選択ID=ref(''),規定値=ref({}),編集値=ref({}),schema=ref({}),有効変更=ref({}),未保存規定値=ref({}),結果=ref({}),テスト条件=ref({});
 const 選択=computed(()=>項目.value.find(row=>row.id===選択ID.value));
 let token='',revision=0,controller=new AbortController(),disposed=false;
 function clear(){revision++;controller.abort();controller=new AbortController();token='';認証済み.value=false;処理中.value='';項目.value=[];選択ID.value='';規定値.value={};編集値.value={};schema.value={};有効変更.value={};未保存規定値.value={};結果.value={};テスト条件.value={};}
 function ログアウト(){clear();通知.value='';}
 function 切断(){clear();通知.value='Core / Toolsとの接続が切れたため、認証と操作中の内容を破棄しました。';}
 function 終了(){clear();disposed=true;}
 function snapshot(data,reset=false){
  if(!object(data)||!Array.isArray(data.tools)||!object(data.defaults)||!object(data.schema))throw Error('Toolsの応答形式を確認できませんでした。');
  項目.value=data.tools.filter(row=>typeof row.id==='string').map(row=>({...row,enabled:row.enabled===true,available:row.available===true}));
  規定値.value=copy(data.defaults);schema.value=copy(data.schema);
  if(reset)編集値.value=copy(data.defaults);
  if(!項目.value.some(row=>row.id===選択ID.value))選択ID.value=項目.value[0]?.id||'';
 }
 async function call(action,data,run=revision){
  if(disposed||run!==revision||!利用可能())throw Error('Diag・Core・Toolsへ接続してください。');
  const value=await api(`api/${action}`,'POST',controller.signal,'json',{token,data});
  if(disposed||run!==revision)throw Error('操作を中止しました。');
  if(value?.authExpired){clear();通知.value='Core認証の有効期限が切れました。再ログインしてください。';throw Error(通知.value);}
  if(value?.status!=='OK')throw Error(value?.message||'Toolsの操作に失敗しました。');
  return value.data;
 }
 async function operation(kind,fn){
  if(disposed||処理中.value||!認証済み.value||!利用可能())return false;
  const run=revision;処理中.value=kind;通知.value='';
  try{await fn(run);return run===revision;}
  catch(error){if(run===revision)通知.value=error.message||'処理に失敗しました。';return false;}
  finally{if(run===revision)処理中.value='';}
 }
 async function ログイン(id,password){
  if(disposed||処理中.value||!利用可能())return false;
  clear();const run=revision;処理中.value='login';通知.value='';
  try{
   const data=await call('AI設定/ログイン',{利用者ID:id,パスワード:password},run);
   if(typeof data?.access_token!=='string'||!data.access_token)throw Error('ログイン応答を確認できませんでした。');
   token=data.access_token;snapshot(await call('Tools/enabled',{},run),true);認証済み.value=true;return true;
  }catch(error){if(run===revision){clear();通知.value=error.message||'Coreへログインできませんでした。';}return false;}
  finally{if(run===revision)処理中.value='';}
 }
 async function 再読込(){return operation('read',async run=>{snapshot(await call('Tools/defaults',{},run),true);有効変更.value=Object.fromEntries(項目.value.filter(row=>Object.hasOwn(有効変更.value,row.id)).map(row=>[row.id,row.enabled]));通知.value='現在の実行時設定を読み込みました（ファイルへの書込なし）。';});}
 async function 切替(id){
  const row=項目.value.find(row=>row.id===id);if(!row?.available)return false;
  return operation('toggle',async run=>{const enabled=!row.enabled;snapshot(await call('Tools/enabled',{enabled:{[id]:enabled},write:false},run));有効変更.value={...有効変更.value,[id]:enabled};通知.value='オン・オフを適用しました。永続化する場合は「オン・オフを保存」を押してください。';});
 }
 async function 有効保存(){if(!Object.keys(有効変更.value).length)return false;return operation('save-enabled',async run=>{const data=await call('Tools/enabled',{enabled:{...有効変更.value},write:true},run);snapshot(data);if(data.saved!==true)throw Error('ファイルへの保存を確認できませんでした。再読込して確認してください。');有効変更.value={};通知.value='オン・オフ設定を保存しました。';});}
 async function 規定値設定(write=false){
  const row=選択.value,key=row?.defaultsKey;if(!row?.available||!key||!object(編集値.value[key]))return false;
  return operation(write?'save-defaults':'apply-defaults',async run=>{const defaults={[key]:copy(編集値.value[key])};const data=await call('Tools/defaults',{defaults,write},run);snapshot(data);if(write&&data.saved!==true){未保存規定値.value={...未保存規定値.value,[key]:true};throw Error('ファイルへの保存を確認できませんでした。再読込して確認してください。');}編集値.value={...編集値.value,[key]:copy(規定値.value[key]||{})};未保存規定値.value={...未保存規定値.value,[key]:!write};通知.value=write?'選択Toolの既定値を保存しました。':'既定値を実行時へ適用しました。ファイルには保存していません。';});
 }
 function テスト定義(id){return 代表テスト[id]||null;}
 const 一括対象数=computed(()=>項目.value.filter(row=>row.available&&row.enabled&&テスト定義(row.id)).length);
 async function 試験実行(id,test,input,run,終了=false){
  選択ID.value=id;結果.value={...結果.value,[id]:{status:'実行中',message:test.label}};
  try{
   const value=await (終了?test.close:test.run)({api,token,input,signal:controller.signal,call:(action,data)=>call(action,data,run)});
   if(run!==revision||disposed)return;
   結果.value={...結果.value,[id]:value};return value;
  }catch(error){if(run===revision)結果.value={...結果.value,[id]:{status:'ERR',message:error.message||'テストに失敗しました。'}};throw error;}
 }
 async function テスト(id,終了=false){
  const row=項目.value.find(row=>row.id===id),test=テスト定義(id);
  if(!row?.available||!row.enabled||!test||終了&&!test.close)return false;
  return operation('test',async run=>{
   const value=await 試験実行(id,test,copy(テスト条件.value[id]??test.defaults??{}),run,終了);
   if(value)通知.value=value.message;
  });
 }
 async function 一括テスト(){
  if(!一括対象数.value)return false;
  return operation('test-all',async run=>{
   const targets=項目.value.filter(row=>row.available&&row.enabled&&テスト定義(row.id)).map(row=>({id:row.id,test:テスト定義(row.id),input:copy(テスト条件.value[row.id]??テスト定義(row.id).defaults??{})}));
   const ids=new Set(targets.map(row=>row.id));
   結果.value=Object.fromEntries(項目.value.map(row=>[row.id,ids.has(row.id)?{status:'待機中',message:'一括テストの順番待ちです。'}:{status:'対象外',message:'OFF・利用不可・試験未対応のため実行しません。'}]));
   let ok=0,failed=0;
   for(const [index,{id,test,input}] of targets.entries()){
    if(run!==revision||disposed||!利用可能())return;
    通知.value=`一括テスト ${index+1}/${targets.length}: ${test.label}`;
    try{const value=await 試験実行(id,test,input,run);if(value?.status==='OK')ok++;else failed++;}
    catch{failed++;}
    if(run!==revision||disposed)return;
   }
   通知.value=`一括テスト完了: 成功 ${ok}件、失敗 ${failed}件、対象外 ${項目.value.length-targets.length}件。`;
  });
 }
 function テスト中止(){if(!['test','test-all'].includes(処理中.value))return;revision++;controller.abort();controller=new AbortController();処理中.value='';for(const [id,value]of Object.entries(結果.value))if(['実行中','待機中'].includes(value.status))結果.value={...結果.value,[id]:{status:'中止',message:'試験・応答の待機を中止しました。開始済みの操作は取り消せない場合があります。'}};通知.value='テストの待機を中止しました。';}
 return {認証済み,処理中,通知,項目,選択ID,選択,規定値,編集値,schema,有効変更,未保存規定値,結果,テスト条件,一括対象数,一括テスト,ログイン,ログアウト,切断,終了,再読込,切替,有効保存,規定値設定,テスト定義,テスト,テスト中止};
}
