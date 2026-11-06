// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 座標は水槽内の比率で保持し、別窓化・リサイズでも魚・餌・気泡の位置を維持する。
export function createAquarium(random = Math.random, now = () => performance.now()) {
  const fish = Array.from({length:18}, () => ({
    x:random(), y:.12+random()*.72, size:7+random()*13,
    speed:.015+random()*.025, dir:random()<.5?-1:1,
    hue:165+random()*150, phase:random()*Math.PI*2, foodReadyAt:0,
  }));
  const food = [], bubbles = [];
  let pointer = null, time = 0, nextBubble = 0;
  return {
    fish, food, bubbles,
    setPointer(point) {
      const next = point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? {x:clamp(point.x,0,1), y:clamp(point.y,0,1)} : null;
      // moveの連打では発生間隔をリセットせず、常に最新の位置を使う。
      if (!pointer || !next) nextBubble=0;
      pointer=next;
    },
    feed(x) {
      if (!Number.isFinite(x)) return;
      // クリックの縦位置は使わず、全て水面から落とす。
      for (let i=0;i<4;i++) food.push({x:clamp(x,0,1), y:0, age:0, speed:14+random()*8, drift:(random()-.5)*10});
      if (food.length>64) food.splice(0,food.length-64);
    },
    step(dt,w,h) {
      if (!(dt>0) || !Number.isFinite(dt) || !(w>0) || !(h>0) || !Number.isFinite(w+h)) return;
      dt=Math.min(dt,.05);time+=dt;
      for (const bubble of bubbles) {
        bubble.age+=dt;bubble.y-=bubble.speed*dt/h;
        bubble.x=clamp(bubble.x+Math.sin(bubble.age*2+bubble.phase)*5*dt/w,0,1);
      }
      for (let i=bubbles.length-1;i>=0;i--) if(bubbles[i].y<-bubbles[i].radius/h||bubbles[i].age>=8) bubbles.splice(i,1);
      if (pointer) {
        nextBubble-=dt;
        if (nextBubble<=0) {
          bubbles.push({x:pointer.x,y:pointer.y,age:0,speed:22+random()*14,radius:2+random()*2,phase:random()*Math.PI*2});
          if(bubbles.length>32)bubbles.splice(0,bubbles.length-32);
          nextBubble=.35+random()*.4;
        }
      }
      for (const pellet of food) {
        pellet.age+=dt;pellet.y+=pellet.speed*dt/h;
        pellet.x=clamp(pellet.x+pellet.drift*dt/w,0,1);
      }
      for (let i=food.length-1;i>=0;i--) if(food[i].y>=.96||food[i].age>18) food.splice(i,1);
      const radius=clamp(Math.min(w,h)*.4,60,130), timestamp=now();
      for (const f of fish) {
        const minY=Math.min(.1,f.size*.45/h);
        let vx=f.dir*f.speed*w, vy=Math.cos(time*.8+f.phase)*7.2;
        const dx=pointer?(f.x-pointer.x)*w:0, dy=pointer?(f.y-pointer.y)*h:0;
        const distance=pointer?Math.hypot(dx,dy):Infinity;
        if (distance<radius) {
          // 餌が近くにあっても回避を最優先。重なった位置でも確実に離れる。
          let escapeX=distance>.001?dx:(f.x<.5?1:-1), escapeY=distance>.001?dy:0;
          // 水面・水底へ押し付けられた魚は横へ逃がし、縦位置の制限で停止させない。
          if((f.y<=minY+.001&&escapeY<0)||(f.y>=.899&&escapeY>0)){
            escapeX=Math.abs(escapeX)>.001?Math.sign(escapeX):(f.x<.5?1:-1);escapeY=0;
          }
          const length=Math.hypot(escapeX,escapeY), speed=Math.max(75,f.speed*w*3);
          vx=escapeX/length*speed;vy=escapeY/length*speed;
        } else if (food.length && timestamp>=f.foodReadyAt) {
          let nearest, nearestDistance=Infinity;
          for (const pellet of food) {
            const d=Math.hypot((pellet.x-f.x)*w,(pellet.y-f.y)*h);
            if(d<nearestDistance){nearest=pellet;nearestDistance=d;}
          }
          if (nearestDistance<f.size+3) {
            food.splice(food.indexOf(nearest),1);
            // 描画の減速・非表示・別窓移動に左右されず、個体ごとに実時間で15秒休む。
            f.foodReadyAt=timestamp+15000;
          }
          else {
            const speed=Math.max(35,f.speed*w*1.8);
            vx=(nearest.x-f.x)*w/nearestDistance*speed;
            vy=(nearest.y-f.y)*h/nearestDistance*speed;
          }
        }
        if(Math.abs(vx)>.1)f.dir=vx<0?-1:1;
        f.x+=vx*dt/w;f.y=clamp(f.y+vy*dt/h,minY,.9);
        // 左右端では従来どおり反対側へ泳ぎ続ける。
        f.x=((f.x%1)+1)%1;
      }
    },
    clear() {pointer=null;nextBubble=0;bubbles.length=0;food.length=0;fish.length=0;},
  };
}
