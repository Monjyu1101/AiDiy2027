// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

export function createKaleidoscope() {
  let pointer = null;
  return {
    setPointer(point) {
      pointer = point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? {x:Math.max(0,Math.min(1,point.x)), y:Math.max(0,Math.min(1,point.y))} : null;
    },
    draw(ctx,w,h,time) {
      if (!(w>0) || !(h>0) || ![w,h,time].every(Number.isFinite)) return;
      const radius=Math.min(w,h)*.46, reach=radius*.36;
      const rotation=time*.035;
      ctx.save();ctx.translate(w/2,h/2);ctx.rotate(rotation);
      for(let sector=0;sector<12;sector++){
        const direction=rotation+sector*Math.PI/6;
        ctx.save();ctx.rotate(sector*Math.PI/6);ctx.scale(1,sector%2?-1:1);
        for(let j=0;j<7;j++){
          const r=radius*(.18+j*.11), center=r*.75;
          // 回転後の画面座標で距離を測り、反対側の鏡像まで同時に変化させない。
          const x=w/2+Math.cos(direction)*center, y=h/2+Math.sin(direction)*center;
          const near=pointer?Math.max(0,1-Math.hypot(pointer.x*w-x,pointer.y*h-y)/reach):0;
          const influence=near*near*(3-2*near);
          const angle=.12+Math.sin(time*.18+j)*.09;
          const pulse=Math.sin(time*2.4+j);
          const length=r*.25*(1+influence*.2*pulse);
          const width=Math.sin(angle)*r*(1+influence*(1.5+.55*pulse));
          const hue=(j*43+time*8+influence*(45+25*Math.sin(time*1.4+j)))%360;
          ctx.save();ctx.translate(center,0);ctx.rotate(influence*.18*Math.sin(time*1.7+j));
          ctx.fillStyle=`hsla(${hue} 78% 61% / ${.65+influence*.2})`;
          ctx.strokeStyle=`hsla(${(hue+40)%360} 90% 78% / ${.8+influence*.2})`;
          ctx.lineWidth=1+influence*1.4;
          ctx.beginPath();ctx.moveTo(length,0);ctx.lineTo(0,width);ctx.lineTo(-length,0);ctx.lineTo(0,-width);
          ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
        }
        ctx.restore();
      }
      ctx.restore();
    },
  };
}
