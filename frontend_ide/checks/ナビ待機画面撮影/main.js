import {createApp,h} from 'vue';
import {ナビ待機画面一覧} from '@s/ナビ待機画面一覧.js';
const scene=new URLSearchParams(location.search).get('scene')||'ナビ羽衣ライディング3D';
const sample = '今回の目標は、READMEに記されたTask AとTask Bの進捗評価を背景に、Task Bの保留内容と再開条件を判断できる情報をそろえることです。対象は「Task Bの保留内容と再開条件の確認」（task-b）だけです。対処しようとしている内容は、Task Bが何を行う作業で、なぜ保留され、何が整えば再開できるのかが分からない点です。';
createApp({render:()=>h('div',{class:'stage'},ナビ待機画面一覧[scene]?[h(ナビ待機画面一覧[scene],scene==='ナビ依頼文3D'?{text:sample}:{})]:['未登録の待機画面: '+scene])}).mount('#app');
