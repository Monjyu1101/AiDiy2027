<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,onMounted,onBeforeUnmount,watch} from 'vue';
import {NAVIGATION_SCENES,NAVIGATION_RANDOM_SCENES,NAVIGATION_SCENE_LABELS} from './ナビ風景.js';
import {bindNavigationMenu} from './ナビ画面メニュー.js';
const props=defineProps({request:Object,action:String});
const emit=defineEmits(['select','close']);
const menu=ref();let binding;
function open(){binding?.dispose();binding=bindNavigationMenu(menu.value,props.request,()=>emit('close'));}
function select(scene){binding?.dispose(true);emit('select',scene);}
onMounted(open);watch(()=>props.request,open,{flush:'post'});
onBeforeUnmount(()=>binding?.dispose());
</script>
<template>
 <div ref="menu" class="navigation-scene-picker selection-popup" role="menu" :aria-label="(action==='evaluate'?'再評価':'ナビ')+'の待機画面'" data-aidiy-no-window-move @contextmenu.prevent.stop @click.stop>
  <p>{{action==='evaluate'?'再評価':'ナビ'}}の待機画面</p>
  <template v-for="scene in NAVIGATION_SCENES" :key="scene">
   <!-- 夜間飛行（ランダム選択に含めない画面）は、メニューの一番下にヘアラインで区切る。 -->
   <div v-if="!NAVIGATION_RANDOM_SCENES.includes(scene)" class="navigation-scene-separator" role="separator" aria-hidden="true"></div>
   <button type="button" role="menuitem" tabindex="-1" :data-scene="scene" @click="select(scene)">{{NAVIGATION_SCENE_LABELS[scene]}}</button>
  </template>
 </div>
</template>
<style>
.navigation-panel.has-code>.navigation-scene-picker{grid-area:auto}
.navigation-scene-picker{position:absolute;z-index:110;box-sizing:border-box;width:min(164px,calc(100% - 8px));max-height:calc(100% - 8px);overflow:auto;padding:4px;background:#000;color:#e5eaf4;border:1px solid #65748e;box-shadow:0 8px 24px #000b}
.navigation-scene-picker>p{margin:0 4px 4px;padding:4px 0;font-size:11px;color:#aebdd1;border-bottom:1px solid #344258}
.navigation-scene-separator{height:1px;margin:4px 4px;background:#344258}
.navigation-scene-picker>button{display:block;width:100%;min-height:28px;padding:5px 8px;text-align:left;border:0;background:transparent;color:inherit;font:inherit;font-size:12px}
.navigation-scene-picker>button:hover,.navigation-scene-picker>button:focus-visible{background:#28405b;outline:1px solid #8de6eb}
</style>
