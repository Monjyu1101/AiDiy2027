import {createApp, h} from 'vue';
import NaviHagoromoRiding from '@s/ナビ羽衣ライディング.vue';
import NaviFireworks from '@s/ナビ花火.vue';
import NaviNightFlight from '@s/ナビ夜間飛行.vue';
import NaviClock from '@s/ナビ時計.vue';
import NaviMaze from '@s/ナビ迷路.vue';
import NaviRequest from '@s/ナビ依頼文.vue';
import NaviScenery from '@s/ナビ風景.vue';
const scene = new URLSearchParams(location.search).get('scene') || 'ride';
const sample = '今回の目標は、READMEに記されたTask AとTask Bの進捗評価を背景に、Task Bの保留内容と再開条件を判断できる情報をそろえることです。対象は「Task Bの保留内容と再開条件の確認」（task-b）だけです。対処しようとしている内容は、Task Bが何を行う作業で、なぜ保留され、何が整えば再開できるのかが分からない点です。';
const pick = () => {
  const o = {};
  switch (scene) {
    case 'ride': return h(NaviHagoromoRiding, o);
    case 'fireworks': return h(NaviFireworks, o);
    case 'nightflight': return h(NaviNightFlight, o);
    case 'clock': return h(NaviClock, o);
    case 'maze': return h(NaviMaze, o);
    case 'request': return h(NaviRequest, {...o, text: sample});
    default: return h(NaviScenery, {...o, kind: scene});
  }
};
createApp({render: () => h('div', {class: 'stage'}, [pick()])}).mount('#app');
