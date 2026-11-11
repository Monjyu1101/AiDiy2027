// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = (a, b) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);

// 描画と独立した三次元の遊泳。食後の待機だけは描画時間でなく実時間で管理する。
export function ナビアクアリウム3D状態を作成(random = Math.random, now = () => performance.now()) {
  let width = 14, time = 0, pointer = null, nextBubble = 0;
  const fish = Array.from({length:24}, (_, i) => ({
    x:(random()-.5)*width*.85, y:-2.5+random()*6, z:-2.6+random()*5.2,
    vx:(i%2?1:-1)*(.45+random()*.4), vy:0, vz:0,
    phase:random()*Math.PI*2, size:.65+random()*.5, species:i%3, foodReadyAt:0,
  }));
  const food = [], bubbles = [];
  return {
    fish, food, bubbles,
    resize(value) {
      if(!Number.isFinite(value)||value<=0)return;
      const next=Math.max(3,value);
      for(const group of [fish,food,bubbles])for(const p of group)p.x*=next/width;
      width=next;pointer=null;
    },
    setPointer(point) {
      const next=point&&Number.isFinite(point.x+point.y)?{x:point.x,y:point.y}:null;
      if(!pointer||!next)nextBubble=0;
      pointer=next;
    },
    feed(x) {
      if(!Number.isFinite(x))return;
      for(let i=0;i<4;i++)food.push({x:clamp(x,-width/2,width/2),y:4.85,z:0,
        age:0,speed:.36+random()*.18,drift:(random()-.5)*.08});
      if(food.length>64)food.splice(0,food.length-64);
    },
    step(dt) {
      if(!Number.isFinite(dt)||dt<=0)return;
      dt=Math.min(dt,.05);time+=dt;
      for(const b of bubbles){b.age+=dt;b.y+=b.speed*dt;b.x+=Math.sin(b.age*2+b.phase)*.08*dt;}
      for(let i=bubbles.length-1;i>=0;i--)if(bubbles[i].y>4.95||bubbles[i].age>=8)bubbles.splice(i,1);
      if(pointer){
        nextBubble-=dt;
        if(nextBubble<=0){
          bubbles.push({x:pointer.x,y:clamp(pointer.y,-4,4.8),z:0,age:0,
            speed:.65+random()*.4,radius:.035+random()*.035,phase:random()*6.28});
          if(bubbles.length>32)bubbles.shift();
          nextBubble=.35+random()*.4;
        }
      }
      for(const p of food){p.age+=dt;p.y-=p.speed*dt;p.x=clamp(p.x+p.drift*dt,-width/2,width/2);}
      for(let i=food.length-1;i>=0;i--)if(food[i].age>18||food[i].y<-3.9)food.splice(i,1);
      const timestamp=now();
      // 同じ標本を使い、配列の先頭の魚だけが群れを押し続けないようにする。
      const positions=fish.map(f=>({x:f.x,y:f.y,z:f.z,vx:f.vx}));
      fish.forEach((f,index)=>{
        let vx=(f.vx<0?-1:1)*(.55+.1*Math.sin(f.phase)),
          vy=Math.sin(time*.47+f.phase)*.18, vz=Math.cos(time*.31+f.phase)*.28;
        // ポインターの視線を各個体の深度へ投影し、見えている位置で回避する。
        const depth=(16-f.z)/16;
        const dx=pointer?f.x-pointer.x*depth:0, dy=pointer?f.y-pointer.y*depth:0;
        const near=pointer?Math.hypot(dx,dy):Infinity;
        let fleeing=false;
        if(near<1.35){
          const length=Math.max(near,.001);
          vx=near<.001?(f.x<0?2.4:-2.4):dx/length*2.4;vy=dy/length*2.4;
          vz=f.z<0?-.5:.5;fleeing=true;
          if((f.y>4.25&&vy>0)||(f.y<-3.2&&vy<0)){vx=f.x<0?2.4:-2.4;vy=0;}
        }else if(food.length&&timestamp>=f.foodReadyAt){
          let nearest=food[0], d=Infinity;
          for(const p of food){const n=distance(f,p);if(n<d){d=n;nearest=p;}}
          if(d<.22*f.size+.12){food.splice(food.indexOf(nearest),1);f.foodReadyAt=timestamp+15000;}
          else {const speed=1.6;vx=(nearest.x-f.x)/d*speed;vy=(nearest.y-f.y)/d*speed;vz=(nearest.z-f.z)/d*speed;}
        }else{
          // 近隣個体とは距離を取り、同種の小さな群れにはゆっくり寄る。
          let sx=0,sy=0,sz=0,count=0;
          positions.forEach((p,j)=>{
            if(j===index)return;
            const d=distance(f,p);
            if(d<.75&&d>.001){vx+=(f.x-p.x)/d*.8;vy+=(f.y-p.y)/d*.6;vz+=(f.z-p.z)/d*.6;}
            if(j%3===f.species&&d>1&&d<3){sx+=p.x;sy+=p.y;sz+=p.z;count++;}
          });
          if(count){vx+=(sx/count-f.x)*.07;vy+=(sy/count-f.y)*.08;vz+=(sz/count-f.z)*.08;}
        }
        const limit=width/2-.35;
        if(f.x>limit-.8)vx-=Math.max(0,f.x-limit+.8)*2.2;
        if(f.x<-limit+.8)vx+=Math.max(0,-limit+.8-f.x)*2.2;
        if(f.y>4.2)vy-=2*(f.y-4.2);
        if(f.y<-3.1)vy+=2*(-3.1-f.y);
        if(Math.abs(f.z)>2.4)vz-=Math.sign(f.z)*(Math.abs(f.z)-2.4)*2;
        const blend=1-Math.exp(-dt*(fleeing?9:2.8));
        f.vx+=(vx-f.vx)*blend;f.vy+=(vy-f.vy)*blend;f.vz+=(vz-f.vz)*blend;
        f.x=clamp(f.x+f.vx*dt,-limit,limit);f.y=clamp(f.y+f.vy*dt,-3.5,4.65);f.z=clamp(f.z+f.vz*dt,-3,3);
      });
    },
    clear(){pointer=null;food.length=bubbles.length=fish.length=0;},
  };
}
