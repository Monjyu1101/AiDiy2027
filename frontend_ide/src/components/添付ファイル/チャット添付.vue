<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { computed, ref, watch } from 'vue';
import ModalDialog from '../../dialog/共通ダイアログ.vue';
import { safeThumbnail } from '../../../host/src/file-attachments';
const props=defineProps({attachment:{type:Object,required:true}});
const enlarged=ref(false),failed=ref(false);
const image=computed(()=>failed.value?'':safeThumbnail(props.attachment.thumbnail));
watch(()=>props.attachment.key,()=>{enlarged.value=false;failed.value=false;});
</script>
<template>
 <div class="chat-file" @click.stop>
  <div class="chat-file-name"><span aria-hidden="true">📎</span> {{attachment.kind==='input_file'?'ファイル入力':'ファイル出力'}}: {{attachment.name}}</div>
  <div class="chat-file-path">{{attachment.path}}</div>
  <button v-if="image" type="button" class="chat-file-preview" :aria-label="attachment.name+'の画像を拡大'" @click.stop="enlarged=true"><img :src="image" :alt="attachment.name" loading="lazy" @error="failed=true"></button>
  <span v-else class="chat-file-note">{{failed?'画像の表示に失敗しました。':'ファイルを受信しました。'}}</span>
  <ModalDialog v-if="enlarged&&image" :label="attachment.name+'の画像'" @close="enlarged=false"><div class="chat-file-enlarged"><h3>{{attachment.name}}</h3><img :src="image" :alt="attachment.name" @error="failed=true"><p>Coreから返されたプレビュー画像です。</p><button type="button" @click="enlarged=false">閉じる</button></div></ModalDialog>
 </div>
</template>
<style scoped>
.chat-file{display:grid;gap:6px;min-width:0;padding:8px 0}.chat-file-name{overflow-wrap:anywhere;color:inherit;font-weight:600}.chat-file-path{font-size:11px;color:#aab4c6;overflow-wrap:anywhere}.chat-file-preview{display:block;width:fit-content;max-width:100%;padding:3px;border:1px solid #667eea66;border-radius:6px;background:#0002;cursor:zoom-in}.chat-file-preview img{display:block;max-width:min(320px,100%);max-height:260px;object-fit:contain}.chat-file-note{font-size:12px;color:#aab4c6}.chat-file-enlarged{display:grid;gap:10px;max-width:85vw;max-height:85vh;padding:18px;overflow:auto}.chat-file-enlarged h3{margin:0;overflow-wrap:anywhere}.chat-file-enlarged img{display:block;max-width:100%;max-height:65vh;object-fit:contain}.chat-file-enlarged p{font-size:12px;margin:0}.chat-file-enlarged button{justify-self:end}
</style>
