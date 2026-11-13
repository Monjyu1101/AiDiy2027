<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {起動モーション} from './起動モーション.mjs';
import './起動モーション.css';
import {watch,ref,nextTick,computed} from 'vue';
import './アプリ起動.css';
import {アプリアイコン,起動項目を整列} from './アプリアイコン.mjs';
const props=defineProps({state:Object,cliState:Object,online:Boolean,visible:Boolean});
const folderInput=ref();
watch(()=>!!props.state.一覧.value,async value=>{if(value){await nextTick();folderInput.value?.focus();}});
watch(()=>props.online&&props.visible,value=>{if(value){void props.state.読込();void props.cliState?.読込();}},{immediate:true});
const descriptions={memo:'新しい付箋メモを開きます。プロジェクト未選択時は起動フォルダに保存します。',cpu:'CPU / GPU / RAMの使用率を小型ウィンドウで表示します。',avatar:'AIコアのアバター画面を開きます。',task:'タスク要求・フロー図・明細を開きます。',team:'チーム活動画面を開きます。',ide:'プロジェクトの開発スペースを開きます。',console:'プロジェクトでターミナルを開きます。',code:'プロジェクトのコード支援画面を開きます。',live:'プロジェクトのライブ会話画面を開きます。',discord:'プロジェクトのDiscord接続パネルを開きます。',slack:'プロジェクトのSlack接続パネルを開きます。',chrome:'システム起動の「手動で開く」と同じChromeで http://localhost:8090/ を開きます。',browser:'IDE内のBrowserを単独ウィンドウで開きます（chrome_devtools対応）。'};
const 起動一覧=computed(()=>起動項目を整列([...props.state.項目.value.map(item=>({...item,kind:'app'})),...(props.cliState?.項目?.value||[]).map(item=>({...item,kind:'cli'}))]));
const CLI名=item=>item.名前;
const CLI禁止=item=>item.利用可能!==true||!props.online||!props.state.フォルダ.value||!!props.state.処理中.value&&!props.state.処理中.value.startsWith('cli:')||props.state.選択中.value;
</script>
<template>
<section class="panel app-launch-panel" v-show="visible" aria-label="アプリ起動">
 <div class="panel-heading"><h2>アプリ起動</h2></div>
 <div class="app-project" :class="{required:!state.フォルダ.value}"><label for="app-project-folder">プロジェクトフォルダ</label><div class="app-project-row"><input id="app-project-folder" :value="state.フォルダ.value" readonly placeholder="プロジェクト選択してね"><button class="app-project-select" :disabled="!online||!!state.処理中.value||state.選択中.value" @click="state.選択()">フォルダ選択</button><button v-if="state.フォルダ.value" :disabled="!!state.処理中.value||state.選択中.value" @click="state.解除()">解除</button></div><p>Chrome・Memo はプロジェクト未選択でも開けます。Avatar・Chrome・Memo 以外は、このフォルダを作業パスにして開きます。付箋以外の起動したアプリは Diag を閉じても動作を続けます。</p></div>
 <p v-if="state.通知.value" class="app-launch-message" role="status">{{state.通知.value}}</p>
 <p v-if="cliState?.失敗.value&&cliState.通知.value" class="app-launch-message error" role="status">{{cliState.通知.value}}</p>
 <div class="app-launch-list">
  <template v-for="item in 起動一覧" :key="item.kind+item.id">
  <article v-if="item.kind==='app'" class="app-launch-card" :data-app="item.id">
   <button class="app-launch-button" :aria-label="`${item.名前} を起動${state.不可理由(item.id)?' — '+state.不可理由(item.id):''}`" :title="state.不可理由(item.id)||`${item.名前} — ${descriptions[item.id]}`" :disabled="!online||!state.利用可能(item.id)||!['chrome','memo'].includes(item.id)&&!state.フォルダ.value||!!state.処理中.value||state.選択中.value" @click="state.起動(item.id,{開始時:起動モーション($event)})"><span v-if="item.単一起動" class="app-single">単一起動</span><span class="launch-frame launch-frame-standard" aria-hidden="true"><img class="app-launch-icon" :src="アプリアイコン[item.id]" alt="" width="60" height="60"><span class="launch-trace"></span></span><span class="app-launch-state">{{!state.利用可能(item.id)?item.無効表示||'バックエンド未起動':state.処理中.value===item.id?'起動確認中…':''}}</span></button>
   <p v-if="state.結果.value[item.id]?.種別==='error'&&state.結果.value[item.id].通知" class="app-launch-result" role="status" data-tone="error">{{state.結果.value[item.id].通知}}</p>
  </article>
  <article v-else class="app-launch-card app-cli-card" :class="{unavailable:item.利用可能!==true}" :data-cli="item.id">
   <button class="app-launch-button" :aria-label="item.種類==='editor'?`${CLI名(item)} でフォルダを開く`:`${CLI名(item)} をConsoleで起動`" :title="item.利用可能===true?`${item.名前} / ${item.モード}${item.種類==='editor'?'':' / モデル指定なし'}`:`${item.名前} は未導入です`" :disabled="CLI禁止(item)" @click="cliState.起動(item.id,{確認省略:true,開始時:起動モーション($event)})"><span class="launch-frame launch-frame-standard" aria-hidden="true"><img class="app-launch-icon" :src="'CLI_'+item.id+(['aidiy_hermes','aidiy_pi'].includes(item.id)?'.png':'.svg')" alt="" width="60" height="60"><span class="launch-trace"></span></span><span class="app-launch-state">{{item.利用可能!==true?'未導入':cliState.処理中.value===item.id?'起動確認中…':''}}</span></button>
  </article>
 </template>
 </div>
 <p class="app-launch-note">Avatar・Live・Discord・Slack は、起動ボタンを押した時だけ実行中のタスクを確認します。</p>
 <div v-if="state.一覧.value" class="app-folder-overlay" @keydown.esc="state.取消()">
  <section class="app-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="app-folder-title">
   <h3 id="app-folder-title">プロジェクトフォルダを選択</h3>
   <form @submit.prevent="state.参照(state.パス入力.value)"><input ref="folderInput" aria-label="フォルダのパス" v-model="state.パス入力.value" :disabled="state.参照中.value"><button :disabled="state.参照中.value">移動</button></form>
   <p v-if="state.参照エラー.value" role="alert">{{state.参照エラー.value}}</p>
   <div class="app-folder-list" :aria-busy="state.参照中.value"><button :disabled="state.参照中.value||state.一覧.value.親===state.一覧.value.フォルダ" @click="state.参照(state.一覧.value.親)">↑ 親フォルダ</button><button v-for="folder in state.一覧.value.子フォルダ" :key="folder.パス" :disabled="state.参照中.value" @click="state.参照(folder.パス)">▸ {{folder.名前}}</button><p v-if="!state.一覧.value.子フォルダ.length">子フォルダはありません。</p></div>
   <div class="app-folder-actions"><button @click="state.取消()">キャンセル</button><button :disabled="state.参照中.value" @click="state.決定()">このフォルダを選択</button></div>
  </section>
 </div>
</section>
</template>
