// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import assert from 'node:assert/strict';

export async function checkOrbitRoutes({evaluate,advance,capture}) {
  // 実描画でも、ランダムと通過指定を交互に使う。
  const routeTargets=[];
  for(let cycle=0;cycle<4;cycle++){
    await evaluate(`(()=>{for(let i=0;i<12000&&aidiyIDE.orbitPhase!=='planning';i++)orbitTestAdvance(250);})()`);
    assert.equal(await evaluate('aidiyIDE.orbitPhase'),'planning');
    const held=await evaluate('eyeOf(aidiyIDE.cam)');await advance(250);
    const targetPath=await evaluate('aidiyIDE.orbitTarget');routeTargets.push(targetPath);
    const turned=await evaluate('eyeOf(aidiyIDE.cam)');
    assert.ok(Math.hypot(...['x','y','z'].map(key=>held[key]-turned[key]))<1e-7,'実画面の再計算で位置を変えない');
    if(targetPath){
      await advance(2700);await capture('nn-orbit-folder-align.png');
      const passage=await evaluate(`(()=>{
        const folder=aidiyIDE.world.galaxies.find(g=>g.path===aidiyIDE.orbitTarget);let nearest=Infinity;
        for(let i=0;i<60000;i++){
          orbitTestAdvance(50);const eye=eyeOf(aidiyIDE.cam),distance=Math.hypot(eye.x-folder.x,eye.y-folder.y,eye.z-folder.z);
          nearest=Math.min(nearest,distance);
          if(distance<folder.R&&aidiyIDE.orbitPhase==='flying')return {nearest,radius:folder.R};
          if(aidiyIDE.orbitPhase==='planning')break;
        }
        return {nearest,radius:folder.R};
      })()`);
      assert.ok(passage.nearest<passage.radius,'実船体がフォルダ内を通過: '+JSON.stringify(passage));
      await capture('nn-orbit-folder-passage.png');
    }
  }
  assert.equal(routeTargets.filter(Boolean).length,2);
  assert.ok(routeTargets.every((target,index)=>!index||Boolean(target)!==Boolean(routeTargets[index-1])));
  return routeTargets;
}
