// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {orbitLevelRoll} from '../src/components/開発スペース/軌道案内.js';

test('軌道面の上側が機体の上を向くよう水平を合わせる',()=>{
  for(const yaw of [-7,0,1.5,8])for(const pitch of [-2.4,-.4,.5,2.8])for(const roll of [-1.2,0,2.4]){
    const [x,y,z]=[.4,.8,.2],level=orbitLevelRoll([x,y,z],{yaw,pitch,roll});
    const right=x*Math.cos(yaw)-z*Math.sin(yaw),up=y*Math.cos(pitch)-(x*Math.sin(yaw)+z*Math.cos(yaw))*Math.sin(pitch);
    assert.ok(Math.abs(right*Math.cos(level)+up*Math.sin(level))<1e-10);
    assert.ok(-right*Math.sin(level)+up*Math.cos(level)>0,'軌道を頭上へ裏返さない');
    assert.ok(Math.abs(level-roll)<=Math.PI);
  }
});
