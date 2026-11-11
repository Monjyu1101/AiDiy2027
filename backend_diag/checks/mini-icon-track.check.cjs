// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),requireUI=createRequire(require('node:path').join(__dirname,'../ui/package.json'));
const {parse,compileScript}=requireUI('@vue/compiler-sfc'),{transformSync}=requireUI('esbuild');
const filename=require('node:path').join(__dirname,'../ui/src/components/アプリ起動/ミニアイコン列.vue');
const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
const code=transformSync(compileScript(descriptor,{id:filename,genDefaultAs:'component'}).content+'\nmodule.exports=component;',{format:'cjs'}).code;

function fixture(width,count){
 let mount,unmount,resize,mutation,frame=0;
 const frames=new Map(),observers=[],module={exports:{}};
 const observer=callback=>({observe(){},disconnect(){this.disconnected=true;},callback});
 vm.runInNewContext(code,{module,exports:module.exports,
  require:()=>({ref:value=>({value}),onMounted:fn=>mount=fn,onBeforeUnmount:fn=>unmount=fn}),
  ResizeObserver:function(fn){resize=fn;const value=observer(fn);observers.push(value);return value;},
  MutationObserver:function(fn){mutation=fn;const value=observer(fn);observers.push(value);return value;},
  getComputedStyle:()=>({columnGap:'2px'}),
  requestAnimationFrame:fn=>{frames.set(++frame,fn);return frame;},cancelAnimationFrame:id=>frames.delete(id),
 });
 const state=module.exports.setup({}, {expose(){}}),attributes=new Set();
 const outer={clientWidth:width,getBoundingClientRect(){return {left:0,right:this.clientWidth,width:this.clientWidth};}};
 const row={children:[],style:{width:''},toggleAttribute(name,value){if(value)attributes.add(name);else attributes.delete(name);},
  contains:node=>row.children.includes(node),getBoundingClientRect(){return {left:0,right:parseFloat(this.style.width)||outer.clientWidth};}};
 const buttons=n=>Array.from({length:n},(_,i)=>({offsetWidth:48,style:{transform:''},matches:()=>true,getBoundingClientRect(){
  const left=i*50+(parseFloat(this.style.transform.replace('translateX(',''))||0);return {left,right:left+48};
 }}));
 row.children=buttons(count);state.枠.value=outer;state.列.value=row;mount();
 const positions=()=>row.children.map(button=>button.getBoundingClientRect().left);
 const pointer=distance=>({pointerId:1,button:0,isPrimary:true,clientX:100+distance,target:row});
 return {state,row,outer,frames,observers,positions,overflow:()=>attributes.has('data-overflow'),
  resize(value){outer.clientWidth=value;resize();},count(value){row.children=buttons(value);mutation();},
  start(){state.押す(pointer(0));},drag(distance){state.動かす(pointer(distance));},end(){state.離す(pointer(0));},
  tick(now){const [id,fn]=frames.entries().next().value;frames.delete(id);fn(now);},close:()=>unmount()};
}

test('ミニの両アイコン列は端数幅も右端まで使い、ボタンを複製しない',()=>{
 for(const width of [250,320,340,350,374,390,400,438]){
  const f=fixture(width,9);
  try{
   assert.equal(f.overflow(),true);
   assert.equal(f.row.getBoundingClientRect().right,width,`幅${width}の右端を切り捨てない`);
   assert.equal(f.row.children.length,9);assert.equal(f.positions()[0],0);
   f.start();f.drag(-4);f.end();
   assert.ok(f.row.children.some(button=>{const rect=button.getBoundingClientRect();return rect.left<width&&rect.right>width;}),'流れるアイコンが右端から見え始める');
   f.resize(width+1);assert.equal(f.row.getBoundingClientRect().right,width+1);
  }finally{f.close();}
 }
});

test('右端まで広げても、あふれが1pxの列を両方向に回す際は画面外で折り返す',()=>{
 for(const [width,count] of [[350,9],[390,8],[438,9],[447,9],[347,7]]){
  for(const direction of [-1,1]){
   const f=fixture(width,count);
   try{
    f.start();let previous=f.positions();
    for(let distance=4;distance<1200;distance++){
     f.drag(distance*direction);
     const current=f.positions();
     for(let i=0;i<count;i++){
      if(Math.abs(current[i]-previous[i])>50){
       if(direction<0){assert.ok(previous[i]+48<=0);assert.ok(current[i]>=width-1);}
       else{assert.ok(previous[i]>=width-1);assert.ok(current[i]+48<=0);}
      }
     }
     previous=current;
    }
    assert.equal(f.row.children.length,count);
   }finally{f.close();}
  }
 }
});

test('収まる行と空行は停止し、追加・削除・幅変更とフォーカス後も通常状態に戻る',()=>{
 const f=fixture(390,7);
 try{
  assert.equal(f.overflow(),false);assert.equal(f.frames.size,0);
  f.count(8);assert.equal(f.overflow(),true);assert.equal(f.frames.size,1);
  f.state.フォーカス({target:f.row.children[7]});
  assert.equal(f.frames.size,0);assert.ok(f.row.children[7].getBoundingClientRect().right<=390);
  f.state.フォーカス解除({relatedTarget:null});assert.equal(f.frames.size,1);
  f.resize(448);assert.equal(f.overflow(),false);assert.equal(f.frames.size,0);
  assert.ok(f.row.children.every(button=>button.style.transform===''));
  f.count(0);assert.equal(f.overflow(),false);assert.equal(f.frames.size,0);
  f.resize(0);f.count(9);assert.equal(f.overflow(),false);assert.equal(f.frames.size,0);
  f.resize(390);assert.equal(f.overflow(),true);assert.equal(f.frames.size,1);
 }finally{f.close();}
 assert.equal(f.frames.size,0);assert.ok(f.observers.every(observer=>observer.disconnected));
});

test('自動送り・ホバー停止・ドラッグ後のクリック抑止を維持する',()=>{
 const f=fixture(390,9);
 try{
  f.tick(100);f.tick(150);assert.ok(Math.abs(f.positions()[0]+1.4)<.01);
  f.state.ホバー(true);assert.equal(f.frames.size,0);
  f.state.ホバー(false);assert.equal(f.frames.size,1);
  f.start();assert.equal(f.frames.size,0);f.drag(30);f.end();assert.equal(f.frames.size,1);
  let prevented=0,stopped=0;const event={detail:1,preventDefault(){prevented++;},stopPropagation(){stopped++;}};
  f.state.クリック(event);assert.equal(prevented,1);assert.equal(stopped,1);
  f.state.クリック(event);assert.equal(prevented,1);
  f.start();f.drag(2);f.end();f.state.クリック(event);assert.equal(prevented,1);
 }finally{f.close();}
});
