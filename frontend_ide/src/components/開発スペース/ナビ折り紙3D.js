// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 伝承の折り鶴。図形は独自作成。紙の厚みと重なりを見分けるための立体模式図。
// 手順照合: https://www.origami-fun.com/origami-crane.html
// 単純折りは折線を軸に回転する。四角基本形・花弁折りは中間の開いた層を別段階で示す。
export const 折り鶴手順 = Object.freeze([
  ['準備', '正方形を、色の面を上に', '15cm角くらいの折り紙を1枚。角が上下左右を向くように置きます。はさみ・のりは使いません。', '4つの角が見える菱形です。', 'paper'],
  ['折り筋', '上の角を下の角へ', '上と下の角を重ね、左右を結ぶ線で半分に折ります。指で折り筋をつけたら開きます。', '折って、開くところまで行います。', 'diagonal'],
  ['折り筋', '右の角を左の角へ', '右と左の角を重ねます。中央を通る2本目の折り筋をつけて、もう一度開きます。', '対角線2本の折り筋が交差します。', 'diagonal2'],
  ['折り筋', '紙を裏返す', '色の面を下、白い面を上にします。次は角同士ではなく、辺同士を合わせます。', '白い面がこちらを向きます。', 'turnPaper'],
  ['折り筋', '上下の辺を合わせて、開く', '紙を45度回し、辺が上下左右を向くように置きます。上下の辺をぴったり合わせ、半分に折ります。折り筋をつけて開きます。', '今つけた折り筋は、前の2本と向きが逆です。', 'half'],
  ['折り筋', '左右の辺を合わせて、開く', '左右の辺も合わせて折り、開きます。これで対角線2本と、辺の中央を結ぶ2本ができました。', 'ここまでの折り筋が、次のたたみ込みを助けます。', 'half2'],
  ['四角基本形', '左右を内側へ寄せる', '白い面を上にしたまま、もう一度角が上下左右を向くように置き、下の角を手前に。左右の角を下の角へ寄せると、中央がテントのように立ちます。無理に押しつぶさず折り筋に沿わせます。', '左・右・上の3つの角を、下の角に集めます。', 'collapse'],
  ['四角基本形', '小さい四角にたたむ', '上の角も下の角に重ね、平らにします。左右に同じ枚数の紙を分けてください。', 'ひらひら開く「口」が下。閉じた角が上です。', 'base'],
  ['花弁折り・表', '表1枚の左下辺を中央へ', '下の開く角を動かさず、表側1枚だけの左下の辺を中央線に合わせます。後ろの紙は折りません。', '左の斜めの辺が、中央の縦線に重なります。', 'left'],
  ['花弁折り・表', '表1枚の右下辺も中央へ', '同じ表の紙の右下の辺も中央へ。左右が同じ形になるよう、下の先端を丁寧に合わせます。', '凧のような形です。', 'right'],
  ['花弁折り・表', '上の三角を手前へ折る', '左右の折りの上端を結ぶ線で、上の三角を手前へ折ります。この横の折り筋が次の目印です。', '上の三角の付け根に、横の折り筋がつきます。', 'top'],
  ['花弁折り・表', '3つの予備折りを開く', '上の三角、右、左の順に開き、小さい四角に戻します。折り筋は消さずに残します。', '口は下のまま。ここでは裏返しません。', 'unfold'],
  ['花弁折り・表', '表1枚の下の角を持ち上げる', '下の口から表側1枚だけを取り、上へ持ち上げます。横の折り筋のところを押さえ、袋を開いてください。', '奥の紙は机に置いたまま。袋の中が見えます。', 'petalOpen'],
  ['花弁折り・表', '左右を折り筋に沿って内側へ', '袋の左右の辺を中央へ寄せます。左右上側の折り筋が逆向きになるように整え、先端を上へ伸ばして平らにします。', '細長い菱形になります。破れそうなら開き直して折り筋を確かめます。', 'petalClose'],
  ['花弁折り・裏', '全体を裏返す', 'できた細長い菱形を下にして裏返します。反対側には、まだ小さい四角が残っています。', 'もう一方の面を同じように折ります。', 'turnBase'],
  ['花弁折り・裏', '左下辺を中央へ', 'こちら側も表に見えている1枚だけ。左下の辺を中央線に合わせて折ります。', '口が下にあることを確認します。', 'backLeft'],
  ['花弁折り・裏', '右下辺を中央へ', '右下の辺も中央へ折ります。左右の先端と辺をそろえます。', '裏側も凧の形になります。', 'backRight'],
  ['花弁折り・裏', '上の三角を手前へ折る', 'こちら側も、左右の折りの上端を結ぶ線で上の三角を手前へ折ります。', '袋を開く位置の目印になります。', 'backTop'],
  ['花弁折り・裏', '3つの予備折りを開く', '上の三角、右、左を開いて、小さい四角に戻してください。', '次に開くのは、今折り筋をつけた側の1枚だけです。', 'backUnfold'],
  ['花弁折り・裏', '袋を開き、下の角を上へ', '表1枚の下の角を持ち上げ、袋を開きます。反対側で折った細長い菱形は動かしません。', '左右を折り筋に沿って内側へ入れます。', 'backOpen'],
  ['花弁折り・裏', '左右を内側にたたみ、平らにする', '左右の折り筋を内側へ反転させながら中央へ寄せ、持ち上げた先を上へ伸ばします。', '表と裏に、同じ細長い菱形ができます。', 'backClose'],
  ['鳥の基本形', '細長い菱形を重ねる', '左右を内側に整えて平らにします。表と裏が同じ細長い菱形になりました。', '下が2本に分かれ、上が1つにつながっています。上下を間違えないで。', 'bird'],
  ['首と尾', '表の左右下辺を中央へ', '下の2本の脚を細くします。表側の左右下辺を、それぞれ中央の縦線へ折ります。中央に少しすき間を残すと後で動かしやすくなります。', '上の大きな三角は翼。下の細い2本が首と尾です。', 'narrow'],
  ['首と尾', '全体を裏返す', '細く折った面を下にして、反対側をこちらへ向けます。下に2本の脚がある向きは変えません。', 'まだ広い左右の辺が見える面を折ります。', 'turnNarrow'],
  ['首と尾', '裏の左右下辺も中央へ', '今こちらを向いている側の下辺も、同じように中央へ折ります。4か所とも細くなれば準備完了です。', '脚同士はつながっていません。別々に動かせます。', 'backNarrow'],
  ['中割り折り', '左の脚を斜め上へ折り、戻す', '左の細い脚を左上へ折り上げ、付け根に折り筋をつけます。いったん元へ戻します。', 'この折り筋を、次に紙の内側へ折り込みます。', 'neckCrease'],
  ['中割り折り', '左の脚を内側から折り上げる', '左の脚の2枚を少し開き、つけた折り筋を内側へ押し込みます。先を左上へ引き出し、両側からはさんで閉じます。', '外側に折り重ねるのではなく、2枚の間で向きを反転します。', 'neck'],
  ['中割り折り', '右も折り筋をつけて戻す', '右の細い脚を右上へ折り、付け根に筋をつけて戻します。こちらが尾になります。', '左と同じ高さを目安にします。', 'tailCrease'],
  ['中割り折り', '右の脚を内側から折り上げる', '右の脚も2枚を少し開き、折り筋を内側へ入れます。先を右上へ引き出し、はさんで閉じます。', '首と尾が両側へ立ち上がりました。', 'tail'],
  ['頭', '首の先を中割り折りする', '左側の先を下へ折って筋をつけ、戻します。先の2枚を開き、その筋を内側へ押し込んでくちばしを下へ向けます。', '先端だけ折ります。首の付け根は動かしません。', 'head'],
  ['翼', '表と裏の翼をゆっくり開く', '真ん中の大きな三角を、表と裏へ1枚ずつ下ろします。翼の付け根を押さえ、胴をつぶさないように開きます。', '首・尾ではなく、大きい2枚が翼です。', 'wings'],
  ['完成', '折り鶴のできあがり', '左右の翼、首、尾の角度を整えます。「最初から」で繰り返し、「前へ」で難しいところを見直せます。', '停止して、ドラッグでどの方向からも確かめられます。', 'done'],
].map(([章, 題, 説明, 確認, 型]) => Object.freeze({章, 題, 説明, 確認, 型})));

const v = (x,y,z=0) => [x,y,z];
const 折肩=Math.SQRT2-1, 肩幅=2-Math.SQRT2, 上先端=2*Math.SQRT2-1;
const mix = (a,b,t) => a.map((n,i)=>n+(b[i]-n)*t);
const smooth = t => {t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
// 指定した折線のまわりだけで回す（単純折りで紙の辺を伸縮させない）。
export function 折線回転(point, a, b, angle) {
 const d=b.map((n,i)=>n-a[i]), len=Math.hypot(...d), u=d.map(n=>n/len), p=point.map((n,i)=>n-a[i]);
 const c=Math.cos(angle),s=Math.sin(angle),dot=p.reduce((n,x,i)=>n+x*u[i],0);
 const cross=[u[1]*p[2]-u[2]*p[1],u[2]*p[0]-u[0]*p[2],u[0]*p[1]-u[1]*p[0]];
 return p.map((x,i)=>a[i]+x*c+cross[i]*s+u[i]*dot*(1-c));
}
// 四角基本形: 中心・四隅・辺の中点で8枚の剛体三角形を作る。
// 角を集める過程と、4つのひだを左右へ寝かせる過程を分け、同じ面を引き継ぐ。
export function 四角基本形(集める, 平らにする=0) {
 const theta=Math.max(0,Math.min(1,集める))*Math.PI/2, flat=Math.max(0,Math.min(1,平らにする));
 const cs=Math.cos(theta),sn=Math.sin(theta),c=sn*sn, points=[];
 const corners=Array.from({length:4},(_,i)=>v(2*cs*Math.cos(i*Math.PI/2),2*cs*Math.sin(i*Math.PI/2),2*sn));
 const transform=p=>{const r=折線回転(p,v(0,0),v(1,0),flat*Math.PI/2);r[1]+=flat;return r;};
 for(let i=0;i<4;i++){
  const a=corners[i],b=corners[(i+1)%4],phi=i*Math.PI/2;
  // 終点でも定義できる正規化cross(Ci,Ci+1)の解析式。
  const raw=[sn*(Math.sin(phi)-Math.cos(phi)),sn*(-Math.sin(phi)-Math.cos(phi)),cs],length=Math.hypot(...raw);
  const normal=raw.map(n=>n/length),sign=i%2?-1:1;
  let mid=a.map((n,j)=>(n+b[j])/(2*(1+c))+sign*normal[j]*2*Math.sqrt(c/(2*(1+c))));
  if(flat>0){const angle=Math.atan2(mid[1],mid[0]),target=mid[0]<0?(angle<0?-Math.PI:Math.PI):0;mid=v(Math.cos(angle+(target-angle)*flat),Math.sin(angle+(target-angle)*flat),1);}
  points.push([v(0,0),a,mid].map(transform),[v(0,0),mid,b].map(transform));
 }
 return points;
}
// polygons: 面。active: 今動かす紙。creases: 折り筋。層の間隔は説明のため拡大している。
export function 折り鶴図形(index, progress=1) {
 const kind=折り鶴手順[Math.max(0,Math.min(index,折り鶴手順.length-1))].型;
 const t=smooth(progress), polygons=[], creases=[];
 const face=(points,active=false)=>polygons.push({points,active});
 const line=(a,b)=>creases.push([a,b]);
 const turn=points=>points.map(p=>折線回転(p,v(0,-2),v(0,2),Math.PI*t));
 const D=[v(0,2),v(-2,0),v(0,-2),v(2,0)];
 if(['paper','diagonal','diagonal2','turnPaper','half','half2'].includes(kind)) {
  if(kind==='paper')face(D);
  else if(kind==='turnPaper')face(turn(D));
  else if(kind.startsWith('diagonal')) {
   const second=kind==='diagonal2', a=second?D[0]:D[1], b=second?D[2]:D[3];
   const moving=second?D[3]:D[0], fixed=second?D[1]:D[2];
   const pulse=Math.sin(Math.PI*t)*Math.PI*.97;
   face([a,fixed,b]);face([a,b,折線回転(moving,a,b,pulse)],true);line(a,b);
   if(second)line(D[1],D[3]);
  } else {
   // 白い面を上に向け、辺同士を折る。図は45度回して正方形を水平に置く。
   const second=kind==='half2',a=second?v(0,-1):v(-1,0),b=second?v(0,1):v(1,0);
   const m=second?[v(1,-1),v(1,1)]:[v(-1,1),v(1,1)];
   const f=second?[v(-1,1),v(-1,-1)]:[v(1,-1),v(-1,-1)];
   const white=points=>second?points.reverse():points;
   face(white([a,b,...f]));face(white([b,a,...m.map(p=>折線回転(p,a,b,Math.sin(Math.PI*t)*Math.PI*.97))]),true);
   line(a,b);line(v(-1,-1,.01),v(1,1,.01));line(v(-1,1,.01),v(1,-1,.01));
  }
  if(['half','half2'].includes(kind)){for(const poly of polygons)poly.points=poly.points.map(p=>p.map(n=>n*Math.SQRT2));for(const crease of creases)for(let i=0;i<2;i++)crease[i]=crease[i].map(n=>n*Math.SQRT2);}
  return {polygons,creases};
 }
 if(kind==='collapse'||kind==='base') {
  const panels=kind==='collapse'?四角基本形(t):四角基本形(1,t);
  for(const panel of panels)face(panel,true);
  return {polygons,creases};
 }
 const T=v(0,1), L=v(-1,0), B=v(0,-1), R=v(1,0), H1=v(-肩幅,折肩), H2=v(肩幅,折肩);
 const diamond=[T,L,B,R], petal=[v(0,上先端),H1,B,H2];
 const back=kind.startsWith('back')||['turnBase','bird'].includes(kind);
 function layer(points,z,active=false){face(points.map(([x,y,d])=>v(x,y,d+z)),active);}
 function base(z=0){layer(diamond,z);line(v(0,-1,z+.012),v(0,1,z+.012));}
 function bird(z=0){layer(petal,z);line(v(0,-1,z+.012),v(0,上先端,z+.012));}
 const early=['base','left','right','top','unfold','petalOpen','petalClose','turnBase','backLeft','backRight','backTop','backUnfold','backOpen','backClose','bird'];
 if(early.includes(kind)) {
  if(kind==='turnBase') {
   for(const [points,z]of [[diamond,-.05],[petal,.05]])face(turn(points.map(([x,y,d])=>v(x,y,d+z))));
   return {polygons,creases};
  }
  if(back)bird(-.07);else base(-.07);
  if(kind==='bird'){bird(.04);return {polygons,creases};}
  if(kind==='base'){base(.04);return {polygons,creases};}
  if(['petalOpen','backOpen','petalClose','backClose'].includes(kind)) {
   const closing=['petalClose','backClose'].includes(kind);
   // 表の1枚を、中央と両側の3剛体面で開く。各面の辺長を変えず、袋の左右だけを折り返す。
   // 開く段階の終端と、閉じる段階の始端は同じ角度。状態間の形の飛びを作らない。
   const lift=-(closing ? .68+.32*t : .68*t)*Math.PI;
   const tuck=(closing ? .35+.65*t : .35*t)*Math.PI;
   const tip=折線回転(B,H1,H2,lift);
   const left=折線回転(折線回転(L,H1,H2,lift),H1,tip,tuck);
   const right=折線回転(折線回転(R,H1,H2,lift),H2,tip,-tuck);
   // 下側の内層は初めから存在し、表の下角を上げると見える。後の鳥基本形でも残る。
   layer([B,H1,H2],-.025);layer([T,H1,H2],.04);
   layer([H1,tip,H2],.055,true);layer([H1,left,tip],.07,true);layer([H2,tip,right],.07,true);
   line(H1,H2);return {polygons,creases};
  }
  const opening=['unfold','backUnfold'].includes(kind);
  const leftFold=['left','backLeft'].includes(kind)?t:opening?1-smooth((t-2/3)*3):1;
  const rightFold=['right','backRight'].includes(kind)?t:['left','backLeft'].includes(kind)?0:opening?1-smooth((t-1/3)*3):1;
  const topFold=['top','backTop'].includes(kind)?t:opening?1-smooth(t*3):0;
  const top=[T,H1,H2].map(p=>折線回転(p,H1,H2,-Math.PI*topFold));
  layer(top,.04,['top','backTop'].includes(kind)||opening&&t<1/3);layer([H1,B,H2],.04);
  layer([B,L,H1].map(p=>折線回転(p,B,H1,-Math.PI*leftFold)),.065,['left','backLeft'].includes(kind)||opening&&t>=2/3);
  layer([H2,R,B].map(p=>折線回転(p,B,H2,Math.PI*rightFold)),.065,['right','backRight'].includes(kind)||opening&&t>=1/3&&t<2/3);
  line(B,H1);line(B,H2);line(H1,H2);return {polygons,creases};
 }
 // 鳥の基本形の側辺を中央に合わせる折り。角度の二等分線で折るため、紙幅の縮尺変更はしない。
 const k=.198912367379658; // tan(11.25°)
 const narrowY=(折肩*上先端-k)/(k+折肩);
 const narrowLeft=v(-k*(narrowY+1),narrowY),narrowRight=v(k*(narrowY+1),narrowY);
 function narrowLayer(amount,z){
  const l=smooth(Math.min(1,amount*2)),r=smooth(Math.max(0,amount*2-1));
  layer([petal[0],narrowLeft,B,narrowRight],z);
  layer([B,H1,narrowLeft].map(p=>折線回転(p,B,narrowLeft,-Math.PI*l)),z+.015,l<1);
  layer([B,narrowRight,H2].map(p=>折線回転(p,B,narrowRight,Math.PI*r)),z+.015,r<1);
  line(B,narrowLeft);line(B,narrowRight);
 }
 if(['narrow','turnNarrow','backNarrow'].includes(kind)){
  if(kind==='narrow'){bird(-.06);narrowLayer(t,.04);}
  else if(kind==='backNarrow'){narrowLayer(1,-.06);narrowLayer(t,.04);}
  else {
   bird(-.06);narrowLayer(1,.04);
   for(const poly of polygons)poly.points=turn(poly.points);
   for(const crease of creases)for(let i=0;i<2;i++)crease[i]=turn([crease[i]])[0];
  }
  return {polygons,creases};
 }
 // 鳥の基本形以降: 大きい翼2枚と、独立した細い脚2本を常に別の面で保持する。
 const width=Math.abs(narrowLeft[0]);
 const wingTop=v(0,上先端), wingL=narrowLeft, wingR=narrowRight, center=v(0,.1);
 const wingAmount=kind==='done'?1:kind==='wings'?t:0;
 for(const side of [-1,1]) {
  const tip=折線回転(wingTop,wingL,wingR,side*wingAmount*1.45);
  layer([center,wingL,wingR],side*.045);
  layer([wingL,tip,wingR],side*.045,kind==='wings');
 }
 const neckUp=['neck','tailCrease','tail','head','wings','done'].includes(kind);
 const tailUp=['tail','head','wings','done'].includes(kind);
 for(const sign of [-1,1]) {
  let a=sign===-1?(neckUp?1:0):(tailUp?1:0);
  if(kind===(sign===-1?'neck':'tail'))a=t;
  if(kind===(sign===-1?'neckCrease':'tailCrease'))a=Math.sin(Math.PI*t);
  const inner=v(sign*.012,narrowY), outer=v(sign*width,narrowY), low=v(sign*.012,-1);
  // 下の細い三角を斜めの折線で分割。動く三角は折線まわりの回転だけで中割りする。
  const hingeIn=v(sign*.012,.4), fraction=1.4/(1+narrowY+.5*(width-.012));
  const hingeOut=mix(low,outer,fraction);
  const tip=折線回転(low,hingeIn,hingeOut,sign*Math.PI*a);
  const pocket=(kind===(sign===-1?'neck':'tail')?Math.sin(Math.PI*t)*.22:0)+.025;
  for(const side of [-1,1]) {
   const offset=points=>points.map(([x,y,z])=>v(x,y,z+side*pocket));
   face(offset([inner,outer,hingeOut,hingeIn]));
   let points=[hingeIn,hingeOut,tip];
   if(sign===-1&&['head','wings','done'].includes(kind)) {
    const h=kind==='head'?t:1, foldY=tip[1]-.24;
    const joint1=mix(hingeIn,tip,(foldY-hingeIn[1])/(tip[1]-hingeIn[1]));
    const joint2=mix(hingeOut,tip,(foldY-hingeOut[1])/(tip[1]-hingeOut[1]));
    face(offset([hingeIn,hingeOut,joint2,joint1]));
    // 頭の先端は横の折線を軸に折る。予備折り→戻す→内側へ折る、を一つの段階で見せる。
    const angle=h<.4?Math.sin(Math.PI*h/.4)*Math.PI:-(h-.4)/.6*Math.PI;
    const beak=折線回転(tip,joint1,joint2,angle);
    line(joint1,joint2);
    points=[joint1,joint2,beak];
   }
   face(offset(points),kind.includes(sign===-1?'neck':'tail')||(kind==='head'&&sign===-1));
  }
 }
 return {polygons,creases};
}

// 兜は「最後の三角を後ろへ折る」方式に統一する（内側へ差し込む別方式と混ぜない）。
// 手順照合: https://web-japan.org/kidsweb/ja/virtual/origami/exploring02e.html
export const 兜手順 = Object.freeze([
 ['準備','白い面を上に置く','正方形の紙を1枚、白い面を上にして置きます。上下左右に角が来る向きです。','色の面は下です。','paper'],
 ['三角形','上の角を下の角へ','上と下の角をぴったり重ね、左右を結ぶ線で半分に折ります。','長い辺が上、三角の先が下。色の面が見えます。','triangle'],
 ['折り筋','横半分に折り、開く','右の端を左の端へ重ね、中央の縦の折り筋をつけます。開いて大きな三角形へ戻します。','次は左右を、この中央線に合わせます。','crease'],
 ['小さい菱形','左の端を下の角へ','左の端を下の角に重ねます。重なった紙をまとめて折り、中央の縦線に辺を合わせます。','右の端はまだ動かしません。','leftDown'],
 ['小さい菱形','右の端も下の角へ','右の端も同じ下の角に重ねます。左右の辺が中央で出会うようにそろえます。','小さい菱形です。折ってきた2つの先が下に集まります。','rightDown'],
 ['角飾り','左の先を上へ折り上げる','今下へ折った左の先だけを、半分に折って一番上の角へ重ねます。後ろの紙は動かしません。','裏返さず、表側の左の先だけです。','leftUp'],
 ['角飾り','右の先も上へ折り上げる','右の先も同じ上の角へ折り上げます。左右同じ高さにそろえます。','上に2つの先が重なりました。','rightUp'],
 ['角飾り','左の先を斜め外へ','上げた左の先を、斜め左外へ折り返します。付け根を押さえて先の向きを変えます。','左の角飾り。角度は少し調整してかまいません。','leftHorn'],
 ['角飾り','右の先も斜め外へ','右の先を斜め右外へ折り返します。左の角飾りと高さ・開き方をそろえます。','2本の角飾りが左右に開きました。','rightHorn'],
 ['前のふち','下の三角の手前1枚を上へ','下に残る三角の手前1枚だけを上へ折ります。中央の横線より少し下で折り、細い帯を残します。','2枚まとめて折らないで。後ろの三角は下向きのままです。','brim'],
 ['前のふち','残した帯を上へ折る','中央の横線より下に残した細い帯だけを、上へ折り返します。白いふちができるよう、横にそろえます。','先ほど上げた三角全体ではなく、下の帯だけです。','band'],
 ['後ろのふち','残りの三角を後ろへ折る','まだ下に残っている後ろ側1枚を、中央の横線で向こう側へ折り上げます。','この折り方では内側へ差し込まず、後ろへ折ります。','back'],
 ['仕上げ','下の口をそっと開く','下から指を入れ、帽子の形になるように口を少し開きます。角飾りと白いふちはつぶさないように。','開く場所は下の口。上や横の折り合わせを引き離しません。','open'],
 ['完成','兜のできあがり','左右の角飾りとふちを整えます。自動再生では少し眺めたあと、次の折り紙へ進みます。','一時停止・前へ・手順の選択で見直せます。','done'],
].map(([章,題,説明,確認,型])=>Object.freeze({章,題,説明,確認,型})));

// 平面上の折線で面を分割。既に折った部分も、現在の座標で再分割する。
// これにより兜のふちは「三角全体を折り戻す」でなく「帯だけ折る」になる。
function 面を分ける(points,a,b,sign){
 const distance=p=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
 const clip=positive=>{
  const result=[];let prev=points.at(-1),dp=distance(prev)*(positive?1:-1);
  for(const current of points){const dc=distance(current)*(positive?1:-1);
   if((dc>1e-9&&dp< -1e-9)||(dc< -1e-9&&dp>1e-9))result.push(mix(prev,current,dp/(dp-dc)));
   if(dc>=-1e-9)result.push(current);prev=current;dp=dc;
  }
  return result.filter((p,i)=>i===0||Math.hypot(...p.map((n,j)=>n-result[i-1][j]))>1e-9);
 };
 return {fixed:clip(false),moving:clip(true)};
}
function 兜を折る(faces,{a,b,sign,angle,select=()=>true,part,side,behind=false},amount,active){
 const orders=faces.map(f=>f.order),top=Math.max(...orders),bottom=Math.min(...orders),out=[];
 for(const f of faces){
  if(!select(f)){out.push({...f,active:false});continue;}
  const {fixed,moving}=面を分ける(f.points,a,b,sign);
  if(fixed.length>=3)out.push({...f,points:fixed,active:false});
  if(moving.length>=3)out.push({...f,part:part||f.part,side:side||f.side,points:moving.map(p=>折線回転(p,a,b,angle*amount)),order:behind?bottom-1-(f.order-bottom):top+1+(top-f.order),active});
 }
 return out;
}
// 前後4三角面の剛体開口。頂部と左右の合わせ目は共有し、下の口だけを開く。
export function 兜の口を開く([x,y],amount,back=false){
 const h=1+.03*Math.max(0,Math.min(1,amount)),side=Math.sqrt(2-h*h),depth=Math.sqrt(Math.max(0,1-1/(h*h)));
 const beta=Math.abs(x),gamma=-y-beta;
 return v(Math.sign(x)*beta*side,-beta*h-gamma/h,(back?-1:1)*gamma*depth);
}
export function 兜図形(index,progress=1){
 const kind=兜手順[Math.max(0,Math.min(index,兜手順.length-1))].型,t=smooth(progress);
 let faces=[{points:[v(0,2),v(2,0),v(0,-2),v(-2,0)],part:'body',side:'back',order:0}];
 const operations=[
  ['triangle',{a:v(-2,0),b:v(2,0),sign:1,angle:Math.PI,side:'front'}],
  ['leftDown',{a:v(0,0),b:v(-1,-1),sign:-1,angle:-Math.PI,part:'left'}],
  ['rightDown',{a:v(0,0),b:v(1,-1),sign:1,angle:Math.PI,part:'right'}],
  ['leftUp',{a:v(-1,-1),b:v(1,-1),sign:-1,angle:-Math.PI,select:f=>f.part==='left',part:'leftTip'}],
  ['rightUp',{a:v(-1,-1),b:v(1,-1),sign:-1,angle:-Math.PI,select:f=>f.part==='right',part:'rightTip'}],
  ['leftHorn',{a:v(0,-1),b:v(-.5,-1+Math.sqrt(3)/2),sign:-1,angle:-Math.PI,select:f=>f.part==='leftTip',part:'leftHorn'}],
  ['rightHorn',{a:v(0,-1),b:v(.5,-1+Math.sqrt(3)/2),sign:1,angle:Math.PI,select:f=>f.part==='rightTip',part:'rightHorn'}],
  ['brim',{a:v(-1,-1.25),b:v(1,-1.25),sign:-1,angle:-Math.PI,select:f=>f.part==='body'&&f.side==='front'}],
  ['band',{a:v(-1,-1),b:v(1,-1),sign:-1,angle:-Math.PI,select:f=>f.part==='body'&&f.side==='front'}],
  ['back',{a:v(-1,-1),b:v(1,-1),sign:-1,angle:Math.PI,select:f=>f.part==='body'&&f.side==='back',behind:true}],
 ];
 let crease=[];
 if(kind!=='paper')for(const [name,op]of operations){
  const current=name===kind;
  faces=兜を折る(faces,op,current?t:1,current);if(current){crease=[[op.a,op.b]];break;}
  if(kind==='crease'&&name==='triangle'){
   const op={a:v(0,-2),b:v(0,0),sign:-1,angle:Math.PI};faces=兜を折る(faces,op,Math.sin(Math.PI*t),true);crease=[[op.a,op.b]];break;
  }
 }
 if(['open','done'].includes(kind)){
  const amount=kind==='done'?1:t,opened=[];
  for(const face of faces){
   const halves=面を分ける(face.points,v(0,-3),v(0,3),1);
   for(const points of [halves.fixed,halves.moving])if(points.length>=3)opened.push({...face,points:points.map(p=>兜の口を開く(p,amount,face.part==='body'&&face.side==='back')),active:false});
  }
  faces=opened;
 }
 const orders=[...new Set(faces.map(f=>f.order))].sort((a,b)=>a-b);
 return {polygons:faces.map(f=>({points:f.points.map(([x,y,z])=>v(x,y,z+(orders.indexOf(f.order)-(orders.length-1)/2)*.003)),active:!!f.active})),creases:crease};
}
export const 折り紙作品 = Object.freeze([
 Object.freeze({id:'crane',名前:'折り鶴',手順:折り鶴手順,図形:折り鶴図形,視点:index=>({distance:index<7?8.2:6.8,width:index<7?4.8:4.1,y:index<7?0:.28})}),
 Object.freeze({id:'kabuto',名前:'兜',手順:兜手順,図形:兜図形,視点:index=>({distance:index<3?8.2:5.6,width:index<3?4.8:3.2,y:index===0?0:-.65})}),
]);
export const 折り紙を選ぶ=(random=Math.random)=>折り紙作品[Math.min(折り紙作品.length-1,Math.max(0,Math.floor(random()*折り紙作品.length)))];

export function 折り紙の次の手順(work,step,random=Math.random){
 return step>=work.手順.length-1?{work:折り紙を選ぶ(random),step:0}:{work,step:step+1};
}
