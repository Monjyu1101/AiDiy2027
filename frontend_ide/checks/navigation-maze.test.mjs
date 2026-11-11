// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {MAZE_ALGORITHMS,MAZE_SOLVERS,ナビ迷路3Dを生成,solveMaze,verifyRoute,mazeSize,blockOf,initialGrid,applyGenerationOps} from '../src/components/開発スペース/ナビ迷路3D.js';

const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const neighbors=(grid,M,i)=>[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>[(i%M)+dx,Math.floor(i/M)+dy]).filter(([x,y])=>x>=0&&y>=0&&x<M&&y<M&&grid[y*M+x]).map(([x,y])=>y*M+x);

test('迷路生成: どのアルゴリズムも外周が壁の「完全な迷路」（全セルが連結で、通路の辺がN²-1本の木）になり、操作の再生結果と最終の格子が一致する',()=>{
 assert.deepEqual(MAZE_ALGORITHMS.map(a=>a.id),['dfs','prim','kruskal','wilson','huntkill','division','walladder']);
 for(const algorithm of MAZE_ALGORITHMS)for(const cells of [1,2,5,9,12])for(const seed of [1,7,42]){
  const maze=ナビ迷路3Dを生成(cells,algorithm.id,seeded(seed)),M=mazeSize(cells),{grid}=maze,label=`${algorithm.id} N=${cells} seed=${seed}`;
  assert.equal(grid.length,M*M);
  for(let k=0;k<M;k++)for(const i of [k,(M-1)*M+k,k*M,k*M+M-1])assert.equal(grid[i],0,label+' 外周は壁');
  // 全セルが連結
  const start=blockOf(cells,0,0),seen=new Set([start]),stack=[start];
  while(stack.length)for(const n of neighbors(grid,M,stack.pop()))if(!seen.has(n)){seen.add(n);stack.push(n);}
  for(let cy=0;cy<cells;cy++)for(let cx=0;cx<cells;cx++)assert.ok(seen.has(blockOf(cells,cx,cy)),label+' 全セルが連結');
  // 通路の辺（セル間）が N²-1 本＝閉路のない木
  let edges=0;for(let y=1;y<M-1;y++)for(let x=1;x<M-1;x++)if((x+y)%2===1&&grid[y*M+x])edges++;
  assert.equal(edges,cells*cells-1,label+' 辺の数');
  // 偶数座標どうしの交点（柱）は常に壁
  for(let y=0;y<M;y+=2)for(let x=0;x<M;x+=2)assert.equal(grid[y*M+x],0,label+' 柱は壁');
  // 操作の再生＝最終の格子
  assert.deepEqual(applyGenerationOps(initialGrid(cells,maze.init),maze.ops),grid,label+' 再生一致');
  if(cells>1)assert.ok(maze.ops.length>=cells,label+' 操作がある');
 }
});

test('迷路の解法: どの解法でも経路が壁を通らず最短で、探索の操作と答え合わせが成り立つ',()=>{
 assert.deepEqual(MAZE_SOLVERS.map(s=>s.id),['bfs','dfs','astar','right','fill']);
 for(const algorithm of MAZE_ALGORITHMS)for(const cells of [3,8,13]){
  const maze=ナビ迷路3Dを生成(cells,algorithm.id,seeded(cells*31)),start=blockOf(cells,0,0),goal=blockOf(cells,cells-1,cells-1);
  for(const solver of MAZE_SOLVERS){
   const {ops,route}=solveMaze(maze.grid,cells,solver.id,start,goal),label=`${algorithm.id}/${solver.id} N=${cells}`;
   assert.ok(ops.length>0,label+' 探索の操作');
   const check=verifyRoute(maze.grid,cells,route,start,goal);
   assert.equal(check.valid,true,label+' '+(check.reason||''));assert.equal(check.extra,0,label+' 最短');
   for(const op of ops)assert.ok(['v','b','x'].includes(op[0])&&Number.isInteger(op[1]),label+' 操作の形式');
  }
 }
});

test('答え合わせ: 壁を通る・つながらない・端点が違う・重複する経路を不合格にし、最短より長い経路は差を出す',()=>{
 const cells=4,maze=ナビ迷路3Dを生成(cells,'dfs',seeded(3)),M=mazeSize(cells),start=blockOf(cells,0,0),goal=blockOf(cells,cells-1,cells-1);
 const route=solveMaze(maze.grid,cells,'bfs',start,goal).route;
 assert.equal(verifyRoute(maze.grid,cells,route,start,goal).valid,true);
 assert.equal(verifyRoute(maze.grid,cells,[],start,goal).valid,false);
 assert.equal(verifyRoute(maze.grid,cells,route.slice(0,-1),start,goal).valid,false,'ゴールに届かない');
 assert.equal(verifyRoute(maze.grid,cells,[route[0],route[2],...route.slice(3)],start,goal).valid,false,'つながらない');
 assert.equal(verifyRoute(maze.grid,cells,[...route.slice(0,3),route[1],...route.slice(2)],start,goal).valid,false,'重複');
 const wall=maze.grid.findIndex((value,i)=>!value&&i%M>0&&i%M<M-1);assert.equal(verifyRoute(maze.grid,cells,[start,wall,goal],start,goal).valid,false,'壁');
 // ループのある（外周以外すべて通路の）格子では、最短より遠回りした経路が「合格だが最短ではない」と出る
 const open=initialGrid(3,'open'),m=mazeSize(3),at=(x,y)=>y*m+x;
 const detour=[[1,1],[2,1],[3,1],[3,2],[2,2],[2,3],[3,3],[4,3],[4,4],[4,5],[5,5]].map(([x,y])=>at(x,y));
 const result=verifyRoute(open,3,detour,at(1,1),at(5,5));
 assert.equal(result.valid,true);assert.equal(result.shortest,9);assert.equal(result.extra,2);
});

test('迷路の見せ方: 作り方のロジックに合う方（通路を掘る／壁を作る）を使う。壁を作る方式は何もない広場から壁だけを足し、通路を掘る方式は壁の塊から通路だけを開ける',()=>{
 assert.deepEqual(MAZE_ALGORITHMS.map(a=>[a.id,a.how]),[['dfs','通路を掘る'],['prim','通路を掘る'],['kruskal','通路を掘る'],['wilson','通路を掘る'],['huntkill','通路を掘る'],['division','壁を作る'],['walladder','壁を作る']]);
 for(const algorithm of MAZE_ALGORITHMS)for(const cells of [4,9]){
  const maze=ナビ迷路3Dを生成(cells,algorithm.id,seeded(5)),codes=new Set(maze.ops.map(op=>op[0]));
  if(algorithm.how==='壁を作る'){assert.equal(maze.init,'open',algorithm.id);assert.ok(codes.has('W')&&!codes.has('c'),algorithm.id+' 壁だけを足す');}
  else{assert.notEqual(maze.init,'open',algorithm.id);assert.ok(codes.has('c')&&!codes.has('W'),algorithm.id+' 通路だけを開ける');}
 }
 // 壁を作る方式は、壁が外周から離れた島を作らない（壁がすべて外周につながる）
 const cells=9,maze=ナビ迷路3Dを生成(cells,'walladder',seeded(11)),M=mazeSize(cells),grid=maze.grid,seen=new Set([0]),stack=[0];
 while(stack.length){const i=stack.pop();for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]){const x=(i%M)+dx,y=Math.floor(i/M)+dy,n=y*M+x;if(x>=0&&y>=0&&x<M&&y<M&&!grid[n]&&!seen.has(n)){seen.add(n);stack.push(n);}}}
 for(let i=0;i<M*M;i++)if(!grid[i])assert.ok(seen.has(i),'壁が外周につながっている');
});


test('Wilson法: 実表示の8〜14セルで仮経路を消し終え、画面の再生結果が完成した迷路と一致する',()=>{
 for(let cells=8;cells<=14;cells++)for(const seed of [1,7,42,99]){
  const maze=ナビ迷路3Dを生成(cells,'wilson',seeded(seed)),display=initialGrid(cells,maze.init);
  let temporary=0,erased=0;
  for(const [code,index] of maze.ops){
   assert.ok(index>=0&&index<display.length);
   if(code==='c')display[index]=1;
   else if(code==='t'){display[index]=2;temporary++;}
   else if(code==='u'){display[index]=0;erased++;}
  }
  assert.ok(temporary>0&&erased>0);assert.deepEqual(display,maze.grid,`Wilson ${cells} seed=${seed}`);
  const start=blockOf(cells,0,0),goal=blockOf(cells,cells-1,cells-1),route=solveMaze(maze.grid,cells,'bfs',start,goal).route;
  assert.equal(verifyRoute(maze.grid,cells,route,start,goal).valid,true);
 }
});
