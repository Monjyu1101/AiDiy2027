// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 形や変化幅は保ち、部品内の描画時計だけをゆっくり進める。
export const ナビ万華鏡2D再生速度 = 1 / 3;
const TAU = Math.PI * 2;
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { n = clamp(n); return n * n * (3 - 2 * n); };
// 形・鏡面数・色の組を変える。色名だけを変えた同じ模様にはしない。
const 表情 = Object.freeze([
  {name:'極光の花冠', mirrors:8, mode:0, hues:[174,205,268,325]},
  {name:'琥珀の大聖堂', mirrors:6, mode:1, hues:[38,18,340,215]},
  {name:'孔雀の羽根', mirrors:10, mode:2, hues:[154,180,220,48]},
  {name:'紅蓮の星雲', mirrors:7, mode:3, hues:[335,12,48,278]},
  {name:'氷晶の宮殿', mirrors:12, mode:4, hues:[188,218,258,170]},
  {name:'虹の織物', mirrors:9, mode:5, hues:[290,340,35,170]},
]);
const color = (h,l=55,a=1) => `hsla(${h} 88% ${l}% / ${a})`;

// 2Dの光学万華鏡。1枚の動くガラス模様を扇形に切り出し、隣り合う鏡面を反転する。
// テクスチャは最大2枚、解像度は固定。画面サイズ・経過時間によって資源を増やさない。
export function ナビ万華鏡2D描画を作成() {
  let pointer=null, lens={x:0,y:0}, current=0, previous=0, started=0, last=null, mix=1, disposed=false;
  const surfaces=[],textureTimes=[],textureThemes=[];
  function texture(ctx,index,t) {
    let surface=surfaces[index%2];
    if(!surface){surface=ctx.canvas.ownerDocument.createElement('canvas');surface.width=surface.height=896;surfaces[index%2]=surface;}
    // ガラス素材は15fps、鏡の回転とポインターの移動は表示側の30fpsで補間する。
    const slot=index%2;
    if(textureThemes[slot]===index&&t>=textureTimes[slot]&&t-textureTimes[slot]<ナビ万華鏡2D再生速度/15)return surface;
    textureTimes[slot]=t;textureThemes[slot]=index;
    const c=surface.getContext('2d');
    if(!c)throw Error('万華鏡の描画面を作成できません');
    const theme=表情[index],hues=theme.hues,mode=theme.mode;
    c.setTransform(1.4,0,0,1.4,0,0);c.globalCompositeOperation='source-over';c.globalAlpha=1;
    c.fillStyle='#02040c';c.fillRect(0,0,640,640);
    const glow=c.createRadialGradient(330,295,15,320,320,450);
    glow.addColorStop(0,color(hues[0],6));glow.addColorStop(.55,color(hues[1],3));glow.addColorStop(1,'#010208');
    c.fillStyle=glow;c.fillRect(0,0,640,640);
    c.save();c.translate(320,320);c.rotate(t*(mode%2?-.07:.055));
    // 透けるガラス片。異なる速度の公転と呼吸で、鏡の切り口を絶えず通り抜ける。
    for(let i=0;i<110;i++){
      const phase=i*2.39996,orbit=12+Math.sqrt(i/110)*310;
      const angle=phase+t*(.09+(i%3)*.027)*(i%2?1:-1);
      const x=Math.cos(angle)*orbit+Math.sin(t*.46+i)*36;
      const y=Math.sin(angle)*orbit+Math.cos(t*.38+i)*36;
      const size=(13+(i%6)*5)*(1+.27*Math.sin(t*.65+i));
      const hue=hues[i%4]+Math.sin(t*.19)*14;
      c.save();c.translate(x,y);c.rotate(-angle+t*.17*Math.sin(i+1));
      const glass=c.createLinearGradient(-size,-size,size,size);
      glass.addColorStop(0,color(hue,80,.95));glass.addColorStop(.32,color(hue+18,52,.68));
      glass.addColorStop(.56,color(hue,13,.95));glass.addColorStop(1,color(hue+45,65,.85));
      c.fillStyle=glass;c.strokeStyle=color(hue+20,82,.7);c.lineWidth=.8;
      c.beginPath();
      if(mode===0||mode===2){
        const width=size*(mode===2?.36:.7);
        c.moveTo(0,-size*1.6);c.bezierCurveTo(width*1.8,-size*.4,width*1.2,size*.8,0,size*1.35);
        c.bezierCurveTo(-width*1.2,size*.8,-width*1.8,-size*.4,0,-size*1.6);
      }else if(mode===1||mode===4){
        const sides=mode===1?4:6;
        for(let k=0;k<sides;k++){const a=k*TAU/sides;c[k?'lineTo':'moveTo'](Math.cos(a)*size,Math.sin(a)*size*1.5);}
      }else if(mode===3){
        for(let k=0;k<10;k++){const a=k*Math.PI/5,r=size*(k%2?.36:1.4);c[k?'lineTo':'moveTo'](Math.cos(a)*r,Math.sin(a)*r);}
      }else{
        c.moveTo(-size,-size*.4);c.bezierCurveTo(0,-size*2,size*2,size,size,size*.4);
        c.bezierCurveTo(0,size*2,-size*2,-size,-size,-size*.4);
      }
      c.closePath();c.fill();c.stroke();
      // 内側の細い彫刻線を残し、面だけの単調な塗りを避ける。
      c.scale(.68,.68);c.strokeStyle=color(hue+35,82,.45);c.stroke();
      c.beginPath();c.moveTo(0,-size);c.lineTo(0,size);c.strokeStyle=color(hue,87,.3);c.stroke();
      c.restore();
    }
    // 小粒の着色ビーズとガラスの欠片。大きいガラスの隙間にも細かい鏡像を生む。
    for(let i=0;i<90;i++){
      const a=i*2.39996-t*.08,r=24+Math.sqrt(i/90)*300;
      const x=Math.cos(a)*r+Math.sin(t*.5+i)*29,y=Math.sin(a)*r+Math.cos(t*.43+i)*29;
      const size=3+i%5,hue=hues[(i+1)%4];
      const bead=c.createRadialGradient(x-size*.3,y-size*.4,.2,x,y,size);
      bead.addColorStop(0,color(hue,94,.9));bead.addColorStop(.3,color(hue,57,.85));bead.addColorStop(1,color(hue,12,.3));
      c.fillStyle=bead;c.beginPath();c.arc(x,y,size,0,TAU);c.fill();
    }
    // 流線／同心円／波織りは表情ごとに別の構造。鏡面で増殖して大きな花冠になる。
    c.globalCompositeOperation='screen';
    for(let j=0;j<8;j++){
      const hue=hues[j%4],r=28+j*42+Math.sin(t*.8+j*.7)*17;
      c.beginPath();
      for(let k=0;k<=96;k++){
        const a=k*TAU/96;
        const scallop=mode===1?Math.abs(Math.cos(a*3+t*.15)):Math.sin(a*(mode===4?6:3)+t*.4+j*.4);
        const rr=r+scallop*(mode===5?34:14)+Math.sin(a*2-t*.3)*20;
        const x=Math.cos(a)*rr,y=Math.sin(a)*rr*(mode===2?.65:1);
        c[k?'lineTo':'moveTo'](x,y);
      }
      c.closePath();c.strokeStyle=color(hue,55,.08);c.lineWidth=4;c.stroke();
      c.strokeStyle=color(hue+12,72,.38);c.lineWidth=.55;c.stroke();
    }
    // 小さな光点。大面積を白く点滅させず、ガラスの縁だけをきらめかせる。
    for(let i=0;i<58;i++){
      const a=i*2.39996+t*.035,r=40+Math.sqrt(i/58)*370;
      const x=Math.cos(a)*r,y=Math.sin(a)*r,s=.6+1.1*Math.pow(.5+.5*Math.sin(t*1.7+i),6);
      c.fillStyle=color(hues[i%4],87,.75);c.beginPath();c.arc(x,y,s,0,TAU);c.fill();
    }
    c.restore();return surface;
  }
  function layer(ctx,w,h,t,index,alpha) {
    if(alpha<=.001)return;
    const theme=表情[index],surface=texture(ctx,index,t);
    const radius=Math.hypot(w,h)*.56,segments=theme.mirrors*2,step=TAU/segments;
    const rotation=t*(index%2?-.045:.035);
    // ポインターはガラスの切り出し位置だけを動かす。拡大率は変えない。
    ctx.save();ctx.translate(w*.5,h*.5);ctx.rotate(rotation);ctx.globalAlpha=alpha;
    ctx.globalCompositeOperation='source-over';
    for(let s=0;s<segments;s++){
      ctx.save();ctx.rotate(s*step);if(s%2) {ctx.rotate(step);ctx.scale(1,-1);}
      ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,radius,-.002,step+.002);ctx.closePath();ctx.clip();
      const span=radius*2.4;
      ctx.drawImage(surface,-span*(.5+.1*Math.sin(t*.23)+lens.x*.07),-span*(.5+.1*Math.cos(t*.19)+lens.y*.07),span,span);
      ctx.restore();
    }
    ctx.restore();
  }
  function next(time) {
    if(disposed||!Number.isFinite(time)||mix<1)return false;
    previous=current;current=(current+1)%表情.length;started=time;mix=0;return true;
  }
  return {
    setPointer(point) {
      pointer=point&&Number.isFinite(point.x)&&Number.isFinite(point.y)?{x:clamp(point.x),y:clamp(point.y)}:null;
    },
    next,
    get state(){return {name:表情[current].name,index:current,mirrors:表情[current].mirrors,transition:mix,pointer:pointer?{...pointer}:null};},
    draw(ctx,w,h,time) {
      if(disposed||!(w>0)||!(h>0)||![w,h,time].every(Number.isFinite))return;
      const dt=last===null?0:Math.max(0,Math.min(.1,time-last));last=time;
      const ease=1-Math.exp(-dt*4);
      lens.x+=((pointer?(pointer.x-.5)*2:0)-lens.x)*ease;
      lens.y+=((pointer?(pointer.y-.5)*2:0)-lens.y)*ease;
      if(time-started>=9&&mix===1)next(time);
      mix=previous===current?1:smooth((time-started)/2.2);
      ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#010208';ctx.fillRect(0,0,w,h);
      layer(ctx,w,h,time,previous,mix<1?1:0);layer(ctx,w,h,time,current,mix);
      // 鏡筒の周縁を柔らかく落とす。中央は透明で、模様を黒穴にしない。
      const radius=Math.hypot(w,h)*.5;
      const edge=ctx.createRadialGradient(w*.5,h*.5,Math.min(w,h)*.13,w*.5,h*.5,radius);
      edge.addColorStop(0,'#0000');edge.addColorStop(.6,'#0000');edge.addColorStop(1,'#0009');
      ctx.fillStyle=edge;ctx.fillRect(0,0,w,h);ctx.restore();
    },
    dispose(){disposed=true;pointer=null;for(const surface of surfaces)if(surface)surface.width=surface.height=0;surfaces.length=0;},
  };
}
