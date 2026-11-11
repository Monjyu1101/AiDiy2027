// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// ナビ迷路の純粋ロジック（描画なし）。生成アルゴリズムと解法を「操作の列（ops）」として先に計算し、表示側が一定の速さで再生する。
// 迷路は (2N+1)×(2N+1) のブロック格子。奇数座標がセル、偶数座標が壁（セルの間）。0=壁、1=通路。外周は常に壁。
// 生成の操作: ['c', idx] 通路にする / ['W', idx] 壁にする / ['t', idx] 仮の跡（Wilson の歩き）/ ['u', idx] 仮の跡を消す / ['h', idx] 注目点だけ動かす。各操作の3番目は注目点（省略可）。
// 解法の操作: ['v', idx] 探索した / ['b', idx] 引き返した / ['x', idx] 行き止まりを埋めた。
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export const mazeSize = cells => cells * 2 + 1;
export const blockOf = (cells, cx, cy) => (cy * 2 + 1) * mazeSize(cells) + (cx * 2 + 1);
const between = (cells, ax, ay, bx, by) => (ay + by + 1) * mazeSize(cells) + (ax + bx + 1);

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
const pickOne = (list, random) => list[Math.floor(random() * list.length)];
const cellNeighbors = (cells, cx, cy) => DIRS.map(([dx, dy]) => [cx + dx, cy + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < cells && y < cells);

/** 生成前の格子。walls=全部壁、cells=セルだけ通路（Kruskal）、open=外周以外すべて通路（再帰分割）。 */
export function initialGrid(cells, mode) {
  const M = mazeSize(cells), grid = new Uint8Array(M * M);
  if (mode === 'cells') for (let y = 1; y < M; y += 2) for (let x = 1; x < M; x += 2) grid[y * M + x] = 1;
  if (mode === 'open') for (let y = 1; y < M - 1; y++) for (let x = 1; x < M - 1; x++) grid[y * M + x] = 1;
  return grid;
}
/** 生成の操作を格子へ反映した結果（仮の跡は格子に影響しない）。 */
export function applyGenerationOps(grid, ops) {
  for (const op of ops) { if (op[0] === 'c') grid[op[1]] = 1; else if (op[0] === 'W') grid[op[1]] = 0; }
  return grid;
}

// ---- 生成アルゴリズム（セル単位）----
function depthFirst(cells, random) {
  const ops = [], visited = new Uint8Array(cells * cells), start = [Math.floor(random() * cells), Math.floor(random() * cells)], stack = [start];
  visited[start[1] * cells + start[0]] = 1; ops.push(['c', blockOf(cells, ...start), blockOf(cells, ...start)]);
  while (stack.length) {
    const [cx, cy] = stack.at(-1), options = cellNeighbors(cells, cx, cy).filter(([x, y]) => !visited[y * cells + x]);
    if (!options.length) { stack.pop(); if (stack.length) ops.push(['h', blockOf(cells, ...stack.at(-1))]); continue; }
    const [nx, ny] = pickOne(options, random);
    visited[ny * cells + nx] = 1; ops.push(['c', between(cells, cx, cy, nx, ny)], ['c', blockOf(cells, nx, ny), blockOf(cells, nx, ny)]); stack.push([nx, ny]);
  }
  return {init: 'walls', ops};
}
function prim(cells, random) {
  const ops = [], visited = new Uint8Array(cells * cells), queued = new Uint8Array(cells * cells), frontier = [];
  const add = (x, y) => { for (const [nx, ny] of cellNeighbors(cells, x, y)) if (!visited[ny * cells + nx] && !queued[ny * cells + nx]) { queued[ny * cells + nx] = 1; frontier.push([nx, ny]); } };
  const sx = Math.floor(random() * cells), sy = Math.floor(random() * cells);
  visited[sy * cells + sx] = 1; ops.push(['c', blockOf(cells, sx, sy), blockOf(cells, sx, sy)]); add(sx, sy);
  while (frontier.length) {
    const index = Math.floor(random() * frontier.length), [x, y] = frontier[index]; frontier[index] = frontier.at(-1); frontier.pop();
    const [px, py] = pickOne(cellNeighbors(cells, x, y).filter(([nx, ny]) => visited[ny * cells + nx]), random);
    visited[y * cells + x] = 1; ops.push(['c', between(cells, px, py, x, y)], ['c', blockOf(cells, x, y), blockOf(cells, x, y)]); add(x, y);
  }
  return {init: 'walls', ops};
}
function kruskal(cells, random) {
  const ops = [], parent = Array.from({length: cells * cells}, (_, i) => i), find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const edges = [];
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) { if (x + 1 < cells) edges.push([x, y, x + 1, y]); if (y + 1 < cells) edges.push([x, y, x, y + 1]); }
  for (const [ax, ay, bx, by] of shuffle(edges, random)) {
    const a = find(ay * cells + ax), b = find(by * cells + bx);
    if (a === b) continue;
    parent[a] = b; const wall = between(cells, ax, ay, bx, by); ops.push(['c', wall, wall]);
  }
  return {init: 'cells', ops};
}
function wilson(cells, random) {
  const ops = [], inMaze = new Uint8Array(cells * cells), order = shuffle(Array.from({length: cells * cells}, (_, i) => i), random);
  const first = order[0]; inMaze[first] = 1; ops.push(['c', blockOf(cells, first % cells, Math.floor(first / cells))]);
  const walkIndex = new Int32Array(cells * cells);
  for (const start of order) {
    if (inMaze[start]) continue;
    walkIndex.fill(-1); const walk = [[start % cells, Math.floor(start / cells)]]; walkIndex[start] = 0;
    ops.push(['t', blockOf(cells, ...walk[0]), blockOf(cells, ...walk[0])]);
    let reached = null;
    for (let guard = 0; guard < cells * cells * 200 && !reached; guard++) {
      const [cx, cy] = walk.at(-1), [nx, ny] = pickOne(cellNeighbors(cells, cx, cy), random), id = ny * cells + nx;
      if (inMaze[id]) { reached = [nx, ny]; ops.push(['t', between(cells, cx, cy, nx, ny), between(cells, cx, cy, nx, ny)]); break; }
      if (walkIndex[id] >= 0) {
        while (walk.length - 1 > walkIndex[id]) {
          const [x, y] = walk.pop(); walkIndex[y * cells + x] = -1; const [px, py] = walk.at(-1);
          ops.push(['u', blockOf(cells, x, y)], ['u', between(cells, px, py, x, y), blockOf(cells, px, py)]);
        }
      } else { walk.push([nx, ny]); walkIndex[id] = walk.length - 1; ops.push(['t', between(cells, cx, cy, nx, ny)], ['t', blockOf(cells, nx, ny), blockOf(cells, nx, ny)]); }
    }
    walk.forEach(([x, y], i) => {
      if (i) { const [px, py] = walk[i - 1]; ops.push(['c', between(cells, px, py, x, y)]); }
      ops.push(['c', blockOf(cells, x, y), blockOf(cells, x, y)]); inMaze[y * cells + x] = 1;
    });
    if (reached) { const [x, y] = walk.at(-1); ops.push(['c', between(cells, x, y, ...reached)]); }
  }
  return {init: 'walls', ops};
}
function huntAndKill(cells, random) {
  const ops = [], visited = new Uint8Array(cells * cells);
  let [cx, cy] = [Math.floor(random() * cells), Math.floor(random() * cells)];
  visited[cy * cells + cx] = 1; ops.push(['c', blockOf(cells, cx, cy), blockOf(cells, cx, cy)]);
  for (;;) {
    const options = cellNeighbors(cells, cx, cy).filter(([x, y]) => !visited[y * cells + x]);
    if (options.length) {
      const [nx, ny] = pickOne(options, random); visited[ny * cells + nx] = 1;
      ops.push(['c', between(cells, cx, cy, nx, ny)], ['c', blockOf(cells, nx, ny), blockOf(cells, nx, ny)]); [cx, cy] = [nx, ny]; continue;
    }
    let found = false;   // 狩り：上の行から、通路に隣り合う未訪問のセルを探す
    for (let y = 0; y < cells && !found; y++) {
      ops.push(['h', blockOf(cells, 0, y)]);
      for (let x = 0; x < cells; x++) {
        if (visited[y * cells + x]) continue;
        const linked = cellNeighbors(cells, x, y).filter(([nx, ny]) => visited[ny * cells + nx]);
        if (!linked.length) continue;
        const [px, py] = pickOne(linked, random); visited[y * cells + x] = 1;
        ops.push(['c', between(cells, px, py, x, y)], ['c', blockOf(cells, x, y), blockOf(cells, x, y)]); [cx, cy] = [x, y]; found = true; break;
      }
    }
    if (!found) break;
  }
  return {init: 'walls', ops};
}
function recursiveDivision(cells, random) {
  const ops = [], M = mazeSize(cells), queue = [[0, 0, cells, cells]];
  while (queue.length) {
    const [x0, y0, w, h] = queue.shift();
    if (w < 2 && h < 2) continue;
    const horizontal = w < 2 ? true : h < 2 ? false : w < h ? true : w > h ? false : random() < .5;
    if (horizontal) {
      const row = 1 + Math.floor(random() * (h - 1)), wallY = 2 * (y0 + row), gap = 2 * (x0 + Math.floor(random() * w)) + 1;
      for (let x = 2 * x0 + 1; x <= 2 * (x0 + w - 1) + 1; x++) if (x !== gap) ops.push(['W', wallY * M + x, wallY * M + x]);
      queue.push([x0, y0, w, row], [x0, y0 + row, w, h - row]);
    } else {
      const col = 1 + Math.floor(random() * (w - 1)), wallX = 2 * (x0 + col), gap = 2 * (y0 + Math.floor(random() * h)) + 1;
      for (let y = 2 * y0 + 1; y <= 2 * (y0 + h - 1) + 1; y++) if (y !== gap) ops.push(['W', y * M + wallX, y * M + wallX]);
      queue.push([x0, y0, col, h], [x0 + col, y0, w - col, h]);
    }
  }
  return {init: 'open', ops};
}

// 壁伸ばし法：外周の壁から、壁をつなぎ足していく（壁が外周とつながったまま輪を作らないので、通路は完全な迷路になる）。
function wallAdder(cells, random) {
  const ops = [], M = mazeSize(cells), P = cells + 1, connected = new Uint8Array(P * P), frontier = [];
  const addEdges = (x, y) => { for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < P && ny < P && !connected[ny * P + nx]) frontier.push([x, y, nx, ny]); } };
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) if (x === 0 || y === 0 || x === cells || y === cells) connected[y * P + x] = 1;
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) if (connected[y * P + x]) addEdges(x, y);
  while (frontier.length) {
    const index = Math.floor(random() * frontier.length), [x, y, nx, ny] = frontier[index]; frontier[index] = frontier.at(-1); frontier.pop();
    if (connected[ny * P + nx]) continue;
    connected[ny * P + nx] = 1;
    const mid = (y + ny) * M + (x + nx), pillar = 2 * ny * M + 2 * nx;
    ops.push(['W', mid, mid], ['W', pillar, pillar]); addEdges(nx, ny);
  }
  return {init: 'open', ops};
}

// how：見せ方。「通路を掘る」は壁の塊から通路を掘り、「壁を作る」は何もない広場へ壁を足していく。作り方のロジックに合う方を使う。
export const MAZE_ALGORITHMS = Object.freeze([
  {id: 'dfs', label: '深さ優先', how: '通路を掘る', build: depthFirst},
  {id: 'prim', label: 'Prim法', how: '通路を掘る', build: prim},
  {id: 'kruskal', label: 'Kruskal法', how: '通路を掘る', build: kruskal},
  {id: 'wilson', label: 'Wilson法', how: '通路を掘る', build: wilson},
  {id: 'huntkill', label: 'ハントアンドキル', how: '通路を掘る', build: huntAndKill},
  {id: 'division', label: '再帰分割', how: '壁を作る', build: recursiveDivision},
  {id: 'walladder', label: '壁伸ばし法', how: '壁を作る', build: wallAdder},
]);

/** 迷路を作る：{init, ops, grid, cells}。grid は操作を全部反映した最終の格子。 */
export function ナビ迷路3Dを生成(cells, algorithmId, random = Math.random) {
  const algorithm = MAZE_ALGORITHMS.find(item => item.id === algorithmId);
  if (!algorithm) throw Error('未対応の迷路生成アルゴリズムです: ' + algorithmId);
  const {init, ops} = algorithm.build(cells, random);
  return {init, ops, cells, grid: applyGenerationOps(initialGrid(cells, init), ops)};
}

// ---- 解法 ----
function openNeighbors(grid, M, i) {
  const x = i % M, y = Math.floor(i / M), result = [];
  for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < M && ny < M && grid[ny * M + nx]) result.push(ny * M + nx); }
  return result;
}
function routeFrom(prev, start, goal) {
  if (goal !== start && prev[goal] < 0) return [];
  const route = [goal]; for (let at = goal; at !== start; at = prev[at]) route.push(prev[at]);
  return route.reverse();
}
const loopErased = trail => { const route = [], position = new Map(); for (const i of trail) { if (position.has(i)) { const keep = position.get(i); while (route.length - 1 > keep) position.delete(route.pop()); } else { position.set(i, route.length); route.push(i); } } return route; };

function breadthFirst(grid, M, start, goal) {
  const ops = [], prev = new Int32Array(M * M).fill(-1), seen = new Uint8Array(M * M), queue = [start]; seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]; ops.push(['v', i, i]);
    if (i === goal) break;
    for (const n of openNeighbors(grid, M, i)) if (!seen[n]) { seen[n] = 1; prev[n] = i; queue.push(n); }
  }
  return {ops, route: routeFrom(prev, start, goal)};
}
function depthFirstSolve(grid, M, start, goal) {
  const ops = [], seen = new Uint8Array(M * M), stack = [start]; seen[start] = 1; ops.push(['v', start, start]);
  while (stack.length && stack.at(-1) !== goal) {
    const i = stack.at(-1), next = openNeighbors(grid, M, i).find(n => !seen[n]);
    if (next === undefined) { stack.pop(); ops.push(['b', i, stack.at(-1)]); continue; }
    seen[next] = 1; stack.push(next); ops.push(['v', next, next]);
  }
  return {ops, route: stack.slice()};
}
function aStar(grid, M, start, goal) {
  const ops = [], g = new Float64Array(M * M).fill(Infinity), prev = new Int32Array(M * M).fill(-1), closed = new Uint8Array(M * M), open = [start];
  const heuristic = i => Math.abs((i % M) - (goal % M)) + Math.abs(Math.floor(i / M) - Math.floor(goal / M));
  g[start] = 0;
  while (open.length) {
    let best = 0; for (let k = 1; k < open.length; k++) if (g[open[k]] + heuristic(open[k]) < g[open[best]] + heuristic(open[best])) best = k;
    const i = open[best]; open[best] = open.at(-1); open.pop();
    if (closed[i]) continue; closed[i] = 1; ops.push(['v', i, i]);
    if (i === goal) break;
    for (const n of openNeighbors(grid, M, i)) if (!closed[n] && g[i] + 1 < g[n]) { g[n] = g[i] + 1; prev[n] = i; open.push(n); }
  }
  return {ops, route: routeFrom(prev, start, goal)};
}
function wallFollower(grid, M, start, goal) {
  // 右手法：右の壁に手をつけて進む。完全な迷路なら必ずゴールに着く。
  const ops = [], trail = [start], at = d => (d + 4) % 4;
  let i = start, direction = 1;
  const isOpen = (index, d) => { const x = (index % M) + DIRS[d][0], y = Math.floor(index / M) + DIRS[d][1]; return x >= 0 && y >= 0 && x < M && y < M && grid[y * M + x] ? y * M + x : -1; };
  ops.push(['v', start, start]);
  for (let guard = 0; guard < M * M * 6 && i !== goal; guard++) {
    for (const turn of [1, 0, -1, 2]) {
      const d = at(direction + turn), n = isOpen(i, d);
      if (n >= 0) { direction = d; i = n; trail.push(i); ops.push(['v', i, i]); break; }
    }
  }
  return {ops, route: i === goal ? loopErased(trail) : []};
}
function deadEndFill(grid, M, start, goal) {
  const work = Uint8Array.from(grid), ops = [], degree = i => openNeighbors(work, M, i).length;
  for (;;) {
    const dead = []; for (let i = 0; i < M * M; i++) if (work[i] && i !== start && i !== goal && degree(i) <= 1) dead.push(i);
    if (!dead.length) break;
    for (const i of dead) { work[i] = 0; ops.push(['x', i, i]); }
  }
  const {route} = breadthFirst(work, M, start, goal);
  return {ops, route};
}

export const MAZE_SOLVERS = Object.freeze([
  {id: 'bfs', label: '幅優先', solve: breadthFirst},
  {id: 'dfs', label: '深さ優先', solve: depthFirstSolve},
  {id: 'astar', label: 'A*', solve: aStar},
  {id: 'right', label: '右手法', solve: wallFollower},
  {id: 'fill', label: '行き止まり埋め', solve: deadEndFill},
]);

/** 迷路を解く：{ops, route}。route は start→goal のブロック番号の列。 */
export function solveMaze(grid, cells, solverId, start, goal) {
  const solver = MAZE_SOLVERS.find(item => item.id === solverId);
  if (!solver) throw Error('未対応の解法です: ' + solverId);
  return solver.solve(grid, mazeSize(cells), start, goal);
}
/** 答え合わせ：端点・連結（壁を通らない）・重複なし・最短との比較。 */
export function verifyRoute(grid, cells, route, start, goal) {
  const M = mazeSize(cells);
  if (!route.length || route[0] !== start || route.at(-1) !== goal) return {valid: false, reason: '端点が合いません', length: route.length};
  const seen = new Set();
  for (let k = 0; k < route.length; k++) {
    const i = route[k];
    if (!grid[i]) return {valid: false, reason: '壁を通っています', length: route.length};
    if (seen.has(i)) return {valid: false, reason: '同じ場所を通っています', length: route.length};
    seen.add(i);
    if (k && Math.abs((i % M) - (route[k - 1] % M)) + Math.abs(Math.floor(i / M) - Math.floor(route[k - 1] / M)) !== 1) return {valid: false, reason: 'つながっていません', length: route.length};
  }
  const shortest = breadthFirst(grid, M, start, goal).route.length;
  return {valid: true, length: route.length, shortest, extra: route.length - shortest};
}
