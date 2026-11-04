// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {routesFor} from '../vue-preview.mjs';

test('Vueルート探索は.aidiy_backupの保存版を読まず、通常のbackupをソースとして扱う',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aidiy-vue-storage-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const files={
    'components/Widget.vue':'<template>current</template>',
    'router/backup/current.ts':"export default [{path:'/current',component:()=>import('@/components/Widget.vue')}];",
    'router/.aidiy_backup/20261010/120000/previous.ts':"export default [{path:'/old',component:()=>import('@/components/Widget.vue')}];",
    'components/.aidiy_backup/20261010/120000/OldPage.vue':"<script setup>import Widget from '@/components/Widget.vue';</script>",
    'router/old-page.ts':"export default [{path:'/indirect-old',component:()=>import('@/components/.aidiy_backup/20261010/120000/OldPage.vue')}];",
  };
  for(const [name,body] of Object.entries(files)){
    const path=join(root,'frontend_web/src',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,body);
  }
  assert.deepEqual(await routesFor(root,'frontend_web/src/components/Widget.vue'),['/current']);
  await rm(join(root,'frontend_web/src/router/backup/current.ts'));
  assert.deepEqual(await routesFor(root,'frontend_web/src/components/Widget.vue'),[],'保存版の間接importも経路に使わない');
});
