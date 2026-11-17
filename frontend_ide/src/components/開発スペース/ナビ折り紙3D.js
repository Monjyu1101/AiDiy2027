// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 一枚の正方形を分割し、折線を軸に剛体回転する。完成形への頂点モーフはしない。
// 兜の工程参照: https://web-japan.org/kidsweb/ja/virtual/origami/exploring02e.html
const EPS = 1e-9;
export const なめらか = t => { t = Math.max(0, Math.min(1, t)); return t*t*t*(t*(t*6-15)+10); };
export const 紙の初期状態 = () => [{id:'paper', tags:[], layer:0, points:[[0,1,0],[-1,0,0],[0,-1,0],[1,0,0]]}];
export function 折線回転(p, a, b, angle) {
  const d=b.map((v,i)=>v-a[i]),len=Math.hypot(...d),u=d.map(v=>v/len),v=p.map((n,i)=>n-a[i]);
  const c=Math.cos(angle),s=Math.sin(angle),dot=u.reduce((n,x,i)=>n+x*v[i],0);
  const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  return v.map((x,i)=>a[i]+x*c+cross[i]*s+u[i]*dot*(1-c));
}
export function 紙面積(points) {
  let total=0;
  for(let i=1;i<points.length-1;i++){
    const a=points[i].map((v,k)=>v-points[0][k]),b=points[i+1].map((v,k)=>v-points[0][k]);
    total+=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;
  }
  return total;
}
function clip(points, distance, positive) {
  const result=[],sign=positive?1:-1;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distance(a)*sign,db=distance(b)*sign;
    if(da>=-EPS)result.push([...a]);
    if(da>EPS&&db<-EPS||da<-EPS&&db>EPS){const t=da/(da-db);result.push(a.map((v,k)=>v+(b[k]-v)*t));}
  }
  return result.filter((p,i)=>Math.hypot(...p.map((v,k)=>v-result[(i+result.length-1)%result.length][k]))>EPS);
}
export function 折り操作(faces, {a,b,side=1,angle=Math.PI,select=()=>true,tag='',tip}) {
  const distance=p=>side*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
  const parts=[];
  for(const face of faces){
    if(!select(face)){parts.push({...face,moving:false});continue;}
    for(const moving of [false,true]){
      const points=clip(face.points,distance,moving);
      if(points.length<3||紙面積(points)<EPS)continue;
      parts.push({...face,id:face.id+(moving?'m':'s'),points,moving,tags:moving&&tag?[...face.tags,tag]:face.tags});
    }
  }
  const levels=faces.map(f=>f.layer),min=Math.min(...levels),max=Math.max(...levels);
  // 折り先が手前か奥かは実際の回転の途中で判定。層順も折ると逆転する。
  const sample=parts.find(f=>f.moving)?.points.find(p=>Math.abs(distance(p))>EPS);
  if(!sample)throw Error('動く紙がない折り操作です。');
  const front=折線回転(sample,a,b,angle/2)[2]>0;
  for(const part of parts)part.endLayer=part.moving?(front?max+1+max-part.layer:min-1-(part.layer-min)):part.layer;
  const unique=[...new Set(parts.map(f=>f.endLayer))].sort((a,b)=>a-b);
  for(const part of parts)part.endLayer=unique.indexOf(part.endLayer);
  const end=parts.map(f=>({...f,moving:false,layer:f.endLayer,points:f.moving?f.points.map(p=>折線回転(p,a,b,angle).map(v=>Math.abs(v)<EPS?0:v)):f.points.map(p=>[...p])}));
  const hinge=parts.filter(f=>f.moving).flatMap(f=>f.points.filter(p=>Math.abs(distance(p))<EPS));
  hinge.sort((p,q)=>(p[0]-q[0])*(b[0]-a[0])+(p[1]-q[1])*(b[1]-a[1]));
  return {parts,end,a,b,angle,tip:tip||sample,hinge:[hinge[0]||a,hinge.at(-1)||b]};
}
export function 折り途中(op, t, thickness=0) {
  if(op.sample)return op.sample(t).map((face,i)=>({...face,points:face.points.map(p=>[p[0],p[1],p[2]+thickness*(op.parts[i].layer+(op.parts[i].endLayer-op.parts[i].layer)*t)])}));
  return op.parts.map(face=>({...face,points:face.points.map(p=>{
    const point=face.moving?折線回転(p,op.a,op.b,op.angle*t):[...p];
    point[2]+=thickness*(face.layer+(face.endLayer-face.layer)*t);
    return point;
  })}));
}
const wing=side=>face=>face.tags.includes(side);
const center=face=>!face.tags.includes('left')&&!face.tags.includes('right');
export function 兜の手順を作る() {
  let state=紙の初期状態();
  const steps=[{title:'一枚の正方形から',note:'白い面を手前に。角を上下に向けて始めます。',faces:state,view:.28,elevation:.24}];
  const add=(title,note,spec,{view=.22,elevation=.24,rehearse=false}={})=>{
    const op=折り操作(state,spec);
    steps.push({title,note,op,view,elevation});
    if(rehearse){
      steps.push({title:'いったん開き戻す',note:'できた折り筋と、動かす一枚の位置を確かめます。',op,reverse:true,view:view+.12,elevation});
      steps.push({title,note:'今つけた折り筋に沿って、もう一度ゆっくり折ります。',op,view,elevation});
    }
    state=op.end;
  };
  add('上の角を、下の角へ','角をぴったり重ね、三角形にします。',{a:[-1,0,0],b:[1,0,0],side:1,tag:'front',tip:[0,1,0]});
  const centerFold=折り操作(state,{a:[0,-1,0],b:[0,0,0],side:1,tip:[-1,0,0]});
  steps.push({title:'真ん中の折り筋をつける',note:'左と右の角を重ねて、中心を決めます。',op:centerFold,view:-.32,elevation:.28});
  steps.push({title:'三角形に開き戻す',note:'この縦の折り筋が、次の左右の折り方の目印です。',op:centerFold,reverse:true,view:.12,elevation:.2});
  state=centerFold.parts.map(({id,tags,layer,points})=>({id,tags,layer,points}));
  // 予備折りは元の面を復元する。後続の折線は同じ紙の座標上に定義する。
  add('左の角を、下の角へ','中心の折り筋に、左の辺を合わせます。',{a:[0,0,0],b:[-.5,-.5,0],side:-1,angle:-Math.PI,tag:'left',tip:[-1,0,0]},{view:-.28});
  add('右の角も、下の角へ','左右がそろうと、小さなひし形になります。',{a:[0,0,0],b:[.5,-.5,0],side:1,tag:'right',tip:[1,0,0]},{view:.28});
  add('左の一枚を、上へ折り返す','手前の左側だけ。下の先端を上の角へ重ねます。',{a:[-.6,-.5,0],b:[.6,-.5,0],side:-1,angle:-Math.PI,select:wing('left'),tip:[0,-1,0]},{view:-.3});
  add('右の一枚も、上へ折り返す','左右の先端が、上の角でそろいます。',{a:[-.6,-.5,0],b:[.6,-.5,0],side:-1,angle:-Math.PI,select:wing('right'),tip:[0,-1,0]},{view:.3});
  const hornA=[-.1275/.55,-.5,0],hornB=[-.1525/.6,-.1525/.6,0];
  add('左の角飾りを、外へ','金色の折り筋を軸に、先端を左へ開きます。',{a:hornA,b:hornB,side:-1,angle:-Math.PI,select:wing('left'),tip:[0,0,0]},{view:-.28,rehearse:true});
  add('右の角飾りも、外へ','左と同じ高さにそろえて折ります。',{a:hornA.map((v,i)=>i===0?-v:v),b:hornB.map((v,i)=>i===0?-v:v),side:1,select:wing('right'),tip:[0,0,0]},{view:.28});
  add('手前の下の一枚を、上へ','下に少し幅を残します。奥の一枚は動かしません。',{a:[-.6,-.58,0],b:[.6,-.58,0],side:-1,angle:-Math.PI,select:f=>center(f)&&f.tags.includes('front'),tip:[0,-1,0]},{view:.48,elevation:.3});
  add('残した細い幅を、折り上げる','帯をかぶせて、兜のふちを作ります。',{a:[-.6,-.5,0],b:[.6,-.5,0],side:-1,angle:-Math.PI,select:f=>center(f)&&f.tags.includes('front'),tip:[0,-.58,0]},{view:.16,elevation:.35});
  add('奥の三角を、後ろへ','裏側が見えるまで回り、残った一枚を折ります。',{a:[-.6,-.5,0],b:[.6,-.5,0],side:-1,select:f=>center(f)&&!f.tags.includes('front'),tip:[0,-1,0]},{view:Math.PI+.25,elevation:.24});
  steps.push({title:'兜のできあがり',note:'一枚の紙から、左右の角飾りとふちができました。',faces:state,view:.2,elevation:.22,finished:true});
  return steps;
}
// 折り鶴: 正方形の8面を同じ頂点IDでつなぎ、袋・花弁の連動を幾何的に解く。
// 工程参照: https://origami.me/crane/ （伝承の折り鶴）。画像・図版は使用しない。
const 鶴の角={T:[0,1,0],L:[-1,0,0],B:[0,-1,0],R:[1,0,0]};
const 鶴の辺=['TL','LB','BR','RT'];
function 鶴の紙(){
  const names=['T','L','B','R'],faces=[];
  for(let i=0;i<4;i++){
    const a=names[i],b=names[(i+1)%4],edge=鶴の辺[i],mid=鶴の角[a].map((v,k)=>(v+鶴の角[b][k])/2);
    for(const [corner,keys,points]of [[a,['O',a,edge],[[0,0,0],鶴の角[a],mid]],[b,['O',edge,b],[[0,0,0],mid,鶴の角[b]]]])faces.push({id:edge+corner,corner,keys,tags:[corner],layer:0,points:points.map(p=>[...p])});
  }
  return faces;
}
function 連動折り(faces,{position,movingKeys,a,b,tipKey,layer}){
  const parts=faces.map(f=>({...f,moving:f.keys.some(k=>movingKeys.includes(k)),endLayer:layer?layer(f):f.layer}));
  const sample=t=>parts.map(f=>({...f,points:f.points.map((p,i)=>position(f.keys[i],t,p))}));
  const end=sample(1).map(f=>({...f,moving:false,layer:f.endLayer,points:f.points.map(p=>p.map(v=>Math.abs(v)<1e-10?0:v))}));
  const tip=parts.flatMap(f=>f.keys.map((k,i)=>k===tipKey?f.points[i]:null)).find(Boolean);
  return {parts,end,sample,a,b,angle:Math.PI,hinge:[a,b],tip,tipAt:t=>position(tipKey,t,tip)};
}
function 袋を開く(faces,right){
  const corner=right?'R':'L',edges=right?['RT','BR']:['TL','LB'];
  return 連動折り(faces,{a:[0,0,0],b:[0,-1,0],tipKey:corner,movingKeys:[corner,...edges],layer:f=>({B:0,L:1,R:2,T:3})[f.corner],position:(key,t,p)=>{
    if(![corner,...edges].includes(key))return [...p];
    const alpha=t*Math.PI/2,phi=right?alpha:Math.PI+alpha;
    if(key===corner)return [Math.cos(alpha)*Math.cos(phi),-Math.sin(alpha),Math.cos(alpha)*Math.sin(phi)];
    const spread=Math.acos(Math.sqrt(Math.max(0,(1-Math.sin(alpha))/(1+Math.sin(alpha)))));
    const theta=phi+(key===edges[0]?spread:-spread);
    return [.5*Math.cos(theta),-.5,.5*Math.sin(theta)];
  }});
}
const 鶴の折線=1-1/Math.sqrt(2);
function 花弁の面を分ける(faces){
  const k=鶴の折線;
  return faces.flatMap(face=>{
    const corner=face.corner,edge=face.keys.find(x=>鶴の辺.includes(x)),E=face.points[face.keys.indexOf(edge)],P=[Math.sign(E[0])*k,-k,0],Q=[0,-k,0];
    const coords=Object.fromEntries(face.keys.map((key,i)=>[key,face.points[i]]));coords['P'+edge]=P;coords['Q'+corner]=Q;
    const p='P'+edge,q='Q'+corner;
    const triangles=face.keys[1]===corner?[['O',q,p],[q,corner,p],[p,corner,edge]]:[['O',p,q],[q,p,corner],[p,edge,corner]];
    // 花弁を閉じると第2・第3面が重なる。別の層を割り当て、表裏のちらつきを防ぐ。
    return triangles.map((keys,i)=>({...face,id:face.id+'p'+i,layer:face.layer*3+i,keys,points:keys.map(k=>[...coords[k]])}));
  });
}
function 花弁を開く(faces,front){
  const k=鶴の折線,corner=front?'T':'B',edges=front?['RT','TL']:['BR','LB'],sign=front?1:-1;
  const positions=Object.fromEntries(faces.flatMap(f=>f.keys.map((key,i)=>[key,f.points[i]])));
  return 連動折り(faces,{a:[-k,-k,0],b:[k,-k,0],tipKey:corner,movingKeys:[corner,...edges],position:(key,t,p)=>{
    const alpha=t*Math.PI;
    if(key===corner)return 折線回転(p,[-k,-k,0],[k,-k,0],-sign*alpha);
    if(!edges.includes(key))return [...p];
    // 閉じる側の角度を解く。三角面の辺長を変えず、共有する辺も離さない。
    const theta=2*Math.atan2(Math.sin(Math.PI/8)*Math.sin(alpha/2),Math.cos(alpha/2));
    const P=positions['P'+key];
    return 折線回転(p,[0,-1,0],P,sign*(p[0]<0?1:-1)*theta);
  }});
}
export function 折り鶴の手順を作る(){
  let state=鶴の紙();
  const steps=[{title:'一枚の正方形から',note:'これから折り鶴を折ります。まず、中心の折り筋をつけます。',faces:state,view:.28,elevation:.24,center:0}];
  const add=(title,note,op,{view=.22,elevation=.24,returnOnly=false,rehearse=false,center=-.3}={})=>{
    steps.push({title,note,op,view,elevation,center});
    if(returnOnly||rehearse)steps.push({title:'折り筋を残して、開き戻す',note:'次に折る線と、動かす紙の位置を確かめます。',op,reverse:true,view:view+.12,elevation,center});
    if(rehearse)steps.push({title,note:'いま確かめた折り筋で、ゆっくり折ります。',op,view,elevation,center});
    if(!returnOnly)state=op.end;
  };
  const fold=(title,note,spec,options)=>add(title,note,折り操作(state,spec),options);
  fold('横の折り筋をつける','上と下の角を合わせ、一度開きます。',{a:[-1,0,0],b:[1,0,0],side:1},{returnOnly:true,center:0});
  fold('縦の折り筋もつける','左右の角を合わせ、中心を確かめます。',{a:[0,-1,0],b:[0,1,0],side:1},{returnOnly:true,view:-.3,center:0});
  fold('三角形に折る','上の角を、下の角へ合わせます。',{a:[-1,0,0],b:[1,0,0],side:1});
  add('右の袋を開いて、つぶす','中を開き、角を下へ。左右の面も連動して閉じます。',袋を開く(state,true),{view:.5,elevation:.3});
  add('裏側の袋も、開いてつぶす','裏に回って同じように折り、四角い基本形にします。',袋を開く(state,false),{view:Math.PI-.5,elevation:.3});
  state=花弁の面を分ける(state);
  const crease=(edge,front)=>{
    const face=state.find(f=>f.keys?.includes(edge)),point=face.points[face.keys.indexOf(edge)],k=鶴の折線,left=point[0]<0;
    fold(left?'左の辺で折り筋をつける':'右の辺も中心へ合わせる','この斜めの折り筋で、次に袋を細長く開きます。',{a:[0,-1,0],b:[left?-k:k,-k,0],side:left?1:-1,angle:(left?1:-1)*(front?1:-1)*Math.PI,select:f=>f.keys?.includes(edge),tip:point},{returnOnly:true,view:front?(left?-.35:.35):Math.PI+(left?-.35:.35)});
  };
  crease('RT',true);crease('TL',true);
  fold('上の小さな三角も折る','ここまでが、袋を開くための準備です。',{a:[-.6,-鶴の折線,0],b:[.6,-鶴の折線,0],side:1},{returnOnly:true});
  add('手前の一枚を、上へ開く','下の角を持ち上げ、左右の折り筋を内側へたたみます。',花弁を開く(state,true),{view:.5,elevation:.32,rehearse:true});
  crease('BR',false);crease('LB',false);
  add('裏側も、細長く開く','左右をたたみ、つるの基本形を作ります。',花弁を開く(state,false),{view:Math.PI+.45,elevation:.3});
  const k=鶴の折線,x=(1-k)*Math.tan(Math.PI/16);
  fold('左の辺を、さらに細く','中心へ折って、首と尾になる部分を細くします。',{a:[0,-1,0],b:[-x,-k,0],side:1,angle:Math.PI,tip:[-k,-k,0]},{view:-.35});
  fold('右の辺も、細くそろえる','左右の細い先端を残して折ります。',{a:[0,-1,0],b:[x,-k,0],side:-1,angle:-Math.PI,tip:[k,-k,0]},{view:.35});
  const line=angle=>[[-.4,-k-.4*Math.tan(angle),0],[.4,-k+.4*Math.tan(angle),0]];
  let [a,b]=line(20*Math.PI/180);
  fold('首の先を、斜め上へ','細い先端を持ち上げ、首になる向きへ折ります。',{a,b,side:-1,angle:-Math.PI,select:f=>f.tags.includes('R'),tip:[0,-1,0]},{view:-.45,rehearse:true});
  [a,b]=line(-24*Math.PI/180);
  fold('反対側は、尾にする','もう一つの先端を、反対側へ持ち上げます。',{a,b,side:-1,angle:Math.PI,select:f=>f.tags.includes('L'),tip:[0,-1,0]},{view:Math.PI+.4});
  fold('先端を折って、くちばしに','首の先を少し下へ折り、頭の形を整えます。',{a:[-.55,.21,0],b:[-.25,.125,0],side:1,angle:Math.PI,select:f=>f.tags.includes('R'),tip:[-(1-k)*Math.sin(40*Math.PI/180),-k+(1-k)*Math.cos(40*Math.PI/180),0]},{view:-.4,rehearse:true});
  fold('手前の翼を、ゆっくり広げる','大きな一枚を手前へ開きます。',{a:[-.5,0,0],b:[.5,0,0],side:1,angle:Math.PI*.43,select:f=>f.tags.includes('T'),tip:[0,1-2*k,0]},{view:.7,elevation:.38,center:-.05});
  fold('奥の翼も、広げる','二枚の翼を開いて、折り鶴のできあがりです。',{a:[-.5,0,0],b:[.5,0,0],side:1,angle:-Math.PI*.43,select:f=>f.tags.includes('B'),tip:[0,1-2*k,0]},{view:-.75,elevation:.38,center:-.05});
  steps.push({title:'折り鶴のできあがり',note:'一枚の紙から、首・尾・二枚の翼ができました。',faces:state,view:.75,elevation:.38,center:-.05,finished:true});
  return steps;
}
export function 折り紙を選ぶ(random=Math.random){
  return random()<.5?{id:'kabuto',name:'兜',steps:兜の手順を作る()}:{id:'crane',name:'折り鶴',steps:折り鶴の手順を作る()};
}
export const 角度差 = (from,to) => Math.atan2(Math.sin(to-from),Math.cos(to-from));
// 経過秒だけで折り始めない。見える向きに到着し、静止してから次の動作へ。
export function 再生状態を作る(steps,index=0) {
  return {index,phase:'align',elapsed:0,stable:0,amount:steps[index].reverse?1:0,yaw:steps[index].view+.65,elevation:steps[index].elevation+.12};
}
export function 再生を進める(s,steps,delta) {
  const dt=Math.max(0,Math.min(.05,delta)),step=steps[s.index];
  if(s.phase==='align'){
    const dy=角度差(s.yaw,step.view),de=step.elevation-s.elevation;
    s.yaw+=dy*(1-Math.exp(-dt*2.4));s.elevation+=de*(1-Math.exp(-dt*2.4));
    s.stable=Math.abs(dy)<.012&&Math.abs(de)<.012?s.stable+dt:0;
    if(s.stable>=.65){s.yaw=step.view;s.elevation=step.elevation;s.phase='guide';s.elapsed=0;}
  }else if(s.phase==='guide'){
    s.elapsed+=dt;if(s.elapsed>=1.6){s.phase=step.op?'fold':'hold';s.elapsed=0;}
  }else if(s.phase==='fold'){
    s.elapsed+=dt;const t=なめらか(s.elapsed/3.8);s.amount=step.reverse?1-t:t;
    if(s.elapsed>=3.8){s.phase='hold';s.elapsed=0;}
  }else if(s.phase==='hold'){
    s.elapsed+=dt;
    if(step.finished){s.yaw+=dt*(Math.PI*2/25);s.elevation=step.elevation+Math.sin(s.elapsed*.3)*.07;}
    if(s.elapsed>=(step.finished?25:step.op?2.2:4)){s.phase='turn';s.elapsed=0;}
  }else if(s.phase==='turn'){
    s.elapsed+=dt;s.yaw+=dt*.32;
    if(s.elapsed>=1.8){s.index=(s.index+1)%steps.length;s.phase='align';s.elapsed=0;s.stable=0;s.amount=steps[s.index].reverse?1:0;}
  }
  return s;
}
