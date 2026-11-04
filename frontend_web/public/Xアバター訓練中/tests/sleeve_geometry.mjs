// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
/** Model-specific opaque sleeve/Body geometry oracle. Node built-ins only. */
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';

export function decodePngAlpha(bytes) {
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','embedded alpha texture is PNG');
  let width,height,depth,type,interlace; const chunks=[]; let transparency=null;
  for(let p=8;p<bytes.length;){const n=bytes.readUInt32BE(p),name=bytes.toString('ascii',p+4,p+8),data=bytes.subarray(p+8,p+8+n);p+=n+12;
    if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];type=data[9];interlace=data[12];assert.equal(data[10],0);assert.equal(data[11],0);}
    if(name==='IDAT')chunks.push(data);if(name==='tRNS')transparency=data;if(name==='IEND')break;
  }
  assert.equal(depth,8,'PNG decoder deliberately requires 8-bit samples');assert.equal(interlace,0,'PNG decoder deliberately requires no interlace');
  const channels={0:1,2:3,3:1,4:2,6:4}[type];assert(channels,'supported PNG color type');
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,decoded=new Uint8Array(stride*height),alpha=new Uint8Array(width*height);
  assert.equal(raw.length,(stride+1)*height,'PNG inflated length');
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];assert(filter<=4,'known PNG filter');
    for(let x=0;x<stride;x++){const a=x>=channels?decoded[y*stride+x-channels]:0,b=y?decoded[(y-1)*stride+x]:0,c=y&&x>=channels?decoded[(y-1)*stride+x-channels]:0;
      decoded[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
    }
    for(let x=0;x<width;x++){const p=y*stride+x*channels;let value=255;
      if(type===6||type===4)value=decoded[p+channels-1];
      else if(type===3)value=transparency?.[decoded[p]]??255;
      else if(type===0&&transparency&&decoded[p]===transparency.readUInt16BE(0))value=0;
      else if(type===2&&transparency&&[0,1,2].every(i=>decoded[p+i]===transparency.readUInt16BE(i*2)))value=0;
      alpha[y*width+x]=value;
    }
  }
  return {width,height,alpha};
}

export function parseGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  let json,bin;for(let p=12;p<bytes.length;){const n=bytes.readUInt32LE(p),type=bytes.readUInt32LE(p+4),data=bytes.subarray(p+8,p+8+n);p+=8+n;if(type===0x4e4f534a)json=JSON.parse(data.toString('utf8'));if(type===0x004e4942)bin=data;}
  assert(json&&bin,'embedded GLB JSON and BIN');const cache=new Map();
  const component={5120:[1,'readInt8',127],5121:[1,'readUInt8',255],5122:[2,'readInt16LE',32767],5123:[2,'readUInt16LE',65535],5125:[4,'readUInt32LE',4294967295],5126:[4,'readFloatLE',1]};
  const sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
  const view=i=>{const v=json.bufferViews[i];assert.equal(v.buffer??0,0);return bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);};
  const accessor=index=>{if(cache.has(index))return cache.get(index);const a=json.accessors[index],[size,read,max]=component[a.componentType],n=sizes[a.type];assert(n,'supported accessor type');const out=new Float64Array(a.count*n);
    if(a.bufferView!==undefined){const v=json.bufferViews[a.bufferView],data=view(a.bufferView),stride=v.byteStride??n*size;for(let i=0;i<a.count;i++)for(let k=0;k<n;k++)out[i*n+k]=data[read]((a.byteOffset??0)+i*stride+k*size);}
    if(a.sparse){const s=a.sparse,[is,ir]=component[s.indices.componentType],ind=view(s.indices.bufferView),val=view(s.values.bufferView);for(let i=0;i<s.count;i++){const dest=ind[ir]((s.indices.byteOffset??0)+i*is);for(let k=0;k<n;k++)out[dest*n+k]=val[read]((s.values.byteOffset??0)+(i*n+k)*size);}}
    if(a.normalized&&a.componentType!==5126)for(let i=0;i<out.length;i++)out[i]=Math.max(-1,out[i]/max);cache.set(index,out);return out;
  };return {json,bin,view,accessor};
}
const uniqueEdges=tris=>{const edges=new Map();for(const t of tris)for(const [a,b] of [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]){const e=a<b?[a,b]:[b,a];edges.set(e.join(','),e);}return [...edges.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);};
const overlaps=(a,b)=>a[0]<=b[3]+1e-9&&a[3]+1e-9>=b[0]&&a[1]<=b[4]+1e-9&&a[4]+1e-9>=b[1]&&a[2]<=b[5]+1e-9&&a[5]+1e-9>=b[2];
function bounds(vertices,ids){const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];for(const i of ids)for(let k=0;k<3;k++){const n=vertices[i*3+k];b[k]=Math.min(b[k],n);b[k+3]=Math.max(b[k+3],n);}return b;}
function makeTree(tris,vertices,ids=tris.map((_,i)=>i)){
  if(!ids.length)return null;if(ids.length<=12)return {ids,b:[0,0,0,0,0,0]};
  const total=bounds(vertices,ids.flatMap(i=>tris[i])),extent=[0,1,2].map(k=>total[k+3]-total[k]),axis=extent.indexOf(Math.max(...extent));
  ids.sort((a,b)=>tris[a].reduce((n,i)=>n+vertices[3*i+axis],0)-tris[b].reduce((n,i)=>n+vertices[3*i+axis],0));const mid=ids.length>>1;
  return {left:makeTree(tris,vertices,ids.slice(0,mid)),right:makeTree(tris,vertices,ids.slice(mid)),b:[0,0,0,0,0,0]};
}
function refit(tree,triBounds){if(!tree)return;if(tree.ids){for(let k=0;k<3;k++){tree.b[k]=Math.min(...tree.ids.map(i=>triBounds[i][k]));tree.b[k+3]=Math.max(...tree.ids.map(i=>triBounds[i][k+3]));}}else{refit(tree.left,triBounds);refit(tree.right,triBounds);for(let k=0;k<3;k++){tree.b[k]=Math.min(tree.left.b[k],tree.right.b[k]);tree.b[k+3]=Math.max(tree.left.b[k+3],tree.right.b[k+3]);}}}
function query(tree,b,fn){if(!tree||!overlaps(tree.b,b))return;if(tree.ids){for(const i of tree.ids)fn(i);}else{query(tree.left,b,fn);query(tree.right,b,fn);}}
export function segmentTriangle(v,edge,tri){
  const a=edge[0]*3,z=edge[1]*3,i=tri[0]*3,j=tri[1]*3,k=tri[2]*3;
  const dx=v[z]-v[a],dy=v[z+1]-v[a+1],dz=v[z+2]-v[a+2],ex=v[j]-v[i],ey=v[j+1]-v[i+1],ez=v[j+2]-v[i+2],fx=v[k]-v[i],fy=v[k+1]-v[i+1],fz=v[k+2]-v[i+2];
  const hx=dy*fz-dz*fy,hy=dz*fx-dx*fz,hz=dx*fy-dy*fx,det=ex*hx+ey*hy+ez*hz;if(Math.abs(det)<=1e-12)return null;
  const sx=v[a]-v[i],sy=v[a+1]-v[i+1],sz=v[a+2]-v[i+2],u=(sx*hx+sy*hy+sz*hz)/det;if(u<0||u>1)return null;
  const qx=sy*ez-sz*ey,qy=sz*ex-sx*ez,qz=sx*ey-sy*ex,w=(dx*qx+dy*qy+dz*qz)/det;if(w<0||u+w>1)return null;
  const t=(fx*qx+fy*qy+fz*qz)/det;if(t<=1e-6||t>=1-1e-6)return null;
  return {u,w,t,point:[v[a]+dx*t,v[a+1]+dy*t,v[a+2]+dz*t]};
}

export function createSleeveGeometry(bytes,THREE) {
  const {json:g,view,accessor}=parseGlb(bytes),body=g.nodes.find(n=>n.name==='Body');assert(body?.skin!==undefined,'model Body skin');
  const ps=g.meshes[body.mesh].primitives,attrs=ps[0].attributes,skin=g.skins[body.skin],rest=accessor(attrs.POSITION),uv=accessor(attrs.TEXCOORD_0),joints=accessor(attrs.JOINTS_0),weights=accessor(attrs.WEIGHTS_0),ib=accessor(skin.inverseBindMatrices);
  assert(ps.length>3);for(const p of ps){for(const a of ['POSITION','JOINTS_0','WEIGHTS_0','TEXCOORD_0'])assert.equal(p.attributes[a],attrs[a],'Body primitives share indexed geometry');assert(!p.targets?.length,'Body morph targets need explicit oracle support');assert.equal(p.mode??4,4);}
  assert.equal(g.nodes[skin.joints[1]].name,'J_Bip_C_Hips');assert.equal(g.nodes[skin.joints[66]].name,'J_Bip_L_LowerArm');assert.equal(g.nodes[skin.joints[85]].name,'J_Bip_R_LowerArm');
  const arm=id=>id>=65&&id<=82||id>=84&&id<=101,cuff=id=>id>=66&&id<=82||id>=85&&id<=101;
  const influence=predicate=>Array.from({length:rest.length/3},(_,i)=>[0,1,2,3].reduce((n,k)=>n+(predicate(joints[i*4+k])?weights[i*4+k]:0),0));
  const aw=influence(arm),sw=influence(cuff),triangles=ps.map(p=>{const a=accessor(p.indices);return Array.from({length:a.length/3},(_,i)=>Array.from(a.slice(i*3,i*3+3)));});
  const sleeve=triangles[3].filter(t=>t.every(i=>sw[i]>.75)),sleeveEdges=uniqueEdges(sleeve);
  const targets=triangles.map((ts,pi)=>({pi,triangles:ts.filter(t=>t.every(i=>aw[i]<.1))}));for(const target of targets)target.edges=uniqueEdges(target.triangles);
  assert(sleeve.length>0&&targets[0].triangles.length>0,'nonempty skin and cuff regions');
  const textureCache=new Map();
  const textures=ps.map(p=>{const m=g.materials[p.material],spec=m.pbrMetallicRoughness?.baseColorTexture,factor=m.pbrMetallicRoughness?.baseColorFactor?.[3]??1;if(!spec)return {factor};assert.equal(spec.texCoord??0,0);const tx=g.textures[spec.index],im=g.images[tx.source];assert(im.bufferView!==undefined&&im.mimeType==='image/png','embedded PNG texture');if(!textureCache.has(tx.source))textureCache.set(tx.source,decodePngAlpha(view(im.bufferView)));const sampler=g.samplers?.[tx.sampler]??{};return {...textureCache.get(tx.source),factor,transform:spec.extensions?.KHR_texture_transform??{},wrapS:sampler.wrapS??10497,wrapT:sampler.wrapT??10497};});
  const wrap=(n,mode)=>mode===33071?Math.max(0,Math.min(1,n)):mode===33648?(Math.floor(n)%2===0?n-Math.floor(n):1-(n-Math.floor(n))):((n%1)+1)%1;
  const alpha=(pi,u,v)=>{const tx=textures[pi];if(!tx.alpha)return tx.factor;const tr=tx.transform,s=tr.scale??[1,1],o=tr.offset??[0,0],r=tr.rotation??0,x=u*s[0],y=v*s[1];u=Math.cos(r)*x-Math.sin(r)*y+o[0];v=Math.sin(r)*x+Math.cos(r)*y+o[1];const px=Math.max(0,Math.min(tx.width-1,wrap(u,tx.wrapS)*tx.width-.5)),py=Math.max(0,Math.min(tx.height-1,wrap(v,tx.wrapT)*tx.height-.5)),ix=Math.floor(px),iy=Math.floor(py),jx=Math.min(tx.width-1,ix+1),jy=Math.min(tx.height-1,iy+1),fx=px-ix,fy=py-iy;
    return tx.factor*((1-fy)*((1-fx)*tx.alpha[iy*tx.width+ix]+fx*tx.alpha[iy*tx.width+jx])+fy*((1-fx)*tx.alpha[jy*tx.width+ix]+fx*tx.alpha[jy*tx.width+jx]))/255;
  };
  const matrices=skin.joints.map(()=>new THREE.Matrix4()),inverse=skin.joints.map((_,i)=>new THREE.Matrix4().fromArray(ib,i*16));
  const deform=nodeMatrices=>{for(let j=0;j<skin.joints.length;j++){const m=nodeMatrices.get(skin.joints[j]);assert(m,`missing raw joint matrix ${skin.joints[j]}`);matrices[j].multiplyMatrices(m,inverse[j]);}
    const v=new Float64Array(rest.length);for(let i=0;i<rest.length/3;i++){const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2];for(let k=0;k<4;k++){const w=weights[i*4+k];if(!w)continue;const m=matrices[joints[i*4+k]].elements;v[i*3]+=w*(m[0]*x+m[4]*y+m[8]*z+m[12]);v[i*3+1]+=w*(m[1]*x+m[5]*y+m[9]*z+m[13]);v[i*3+2]+=w*(m[2]*x+m[6]*y+m[10]*z+m[14]);}}return v;
  };
  let sleeveTree=null;const audit=vertices=>{
    const hits=[],materials={};sleeveTree??=makeTree(sleeve,vertices);const sleeveBounds=sleeve.map(t=>bounds(vertices,t));refit(sleeveTree,sleeveBounds);
    for(const target of targets){if(!target.triangles.length)continue;target.tree??=makeTree(target.triangles,vertices);const bodyBounds=target.triangles.map(t=>bounds(vertices,t));refit(target.tree,bodyBounds);let all=0,opaque=0;
      const run=(edges,tris,tree,boxes,direction)=>{for(const edge of edges){const eb=bounds(vertices,edge);query(tree,eb,j=>{if(!overlaps(eb,boxes[j]))return;const tri=tris[j],hit=segmentTriangle(vertices,edge,tri);if(!hit)return;all++;const {u,w,t}=hit,eu=uv[edge[0]*2]*(1-t)+uv[edge[1]*2]*t,ev=uv[edge[0]*2+1]*(1-t)+uv[edge[1]*2+1]*t,tu=uv[tri[0]*2]*(1-u-w)+uv[tri[1]*2]*u+uv[tri[2]*2]*w,tv=uv[tri[0]*2+1]*(1-u-w)+uv[tri[1]*2+1]*u+uv[tri[2]*2+1]*w;
        const bodyAlpha=alpha(target.pi,direction==='sleeve-edge/body-face'?tu:eu,direction==='sleeve-edge/body-face'?tv:ev),sleeveAlpha=alpha(3,direction==='sleeve-edge/body-face'?eu:tu,direction==='sleeve-edge/body-face'?ev:tv);if(bodyAlpha<.5||sleeveAlpha<.5)return;opaque++;const key=`${target.pi}/${direction}/${edge.join(',')}/${tri.join(',')}`;hits.push({key,primitive:target.pi,direction,edge,triangle:tri,point:hit.point,bodyAlpha,sleeveAlpha});
      });}};
      run(sleeveEdges,target.triangles,target.tree,bodyBounds,'sleeve-edge/body-face');run(target.edges,sleeve,sleeveTree,sleeveBounds,'body-edge/sleeve-face');materials[target.pi]={name:g.materials[ps[target.pi].material].name,triangles:target.triangles.length,intersections:all,opaqueIntersections:opaque};
    }return {opaqueIntersections:hits.length,materials,hits};
  };
  const cuffVertices=[...new Set(sleeve.flat())].filter(i=>alpha(3,uv[i*2],uv[i*2+1])>=.5);
  const skinTarget=targets[0],nearestTriangle=new THREE.Triangle(),pointVector=new THREE.Vector3(),closestVector=new THREE.Vector3();
  const boxDistanceSq=(b,p)=>{let total=0;for(let k=0;k<3;k++){const d=Math.max(b[k]-p[k],0,p[k]-b[k+3]);total+=d*d;}return total;};
  function interiorDepth(vertices){
    // Full non-arm skin includes pelvis and thighs. No convex-hull prefilter.
    skinTarget.tree??=makeTree(skinTarget.triangles,vertices);const boxes=skinTarget.triangles.map(t=>bounds(vertices,t));refit(skinTarget.tree,boxes);
    const extended=new Float64Array(vertices.length+6);extended.set(vertices);const origin=vertices.length/3,far=origin+1,edge=[origin,far];
    const box=skinTarget.tree.b,rayLength=Math.max(box[3]-box[0],box[4]-box[1],box[5]-box[2])*4+1,inside=[];
    for(const vertex of cuffVertices){const p=Array.from(vertices.slice(vertex*3,vertex*3+3));if(boxDistanceSq(box,p)>1e-20)continue;let oddRays=0;
      for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){extended.set(p,vertices.length);extended.set(p,vertices.length+3);extended[vertices.length+3+axis]+=sign*rayLength;const eb=bounds(extended,edge),distances=[];
        query(skinTarget.tree,eb,j=>{if(!overlaps(eb,boxes[j]))return;const hit=segmentTriangle(extended,edge,skinTarget.triangles[j]);if(hit&&hit.t*rayLength>1e-7)distances.push(Math.round(hit.t*rayLength*1e7));});
        if(new Set(distances).size%2)oddRays++;
      }
      if(oddRays<4)continue;
      let nearestSq=Infinity,triangle=null;pointVector.fromArray(p);
      const visit=tree=>{if(!tree||boxDistanceSq(tree.b,p)>nearestSq)return;if(tree.ids){for(const i of tree.ids){if(boxDistanceSq(boxes[i],p)>nearestSq)continue;const t=skinTarget.triangles[i];nearestTriangle.a.fromArray(vertices,t[0]*3);nearestTriangle.b.fromArray(vertices,t[1]*3);nearestTriangle.c.fromArray(vertices,t[2]*3);nearestTriangle.closestPointToPoint(pointVector,closestVector);const d=closestVector.distanceToSquared(pointVector);if(d<nearestSq){nearestSq=d;triangle=t;}}}else{const left=boxDistanceSq(tree.left.b,p),right=boxDistanceSq(tree.right.b,p);if(left<=right){visit(tree.left);visit(tree.right);}else{visit(tree.right);visit(tree.left);}}};visit(skinTarget.tree);
      inside.push({vertex,depthMm:Math.sqrt(nearestSq)*1000,oddRays,point:p,nearestSkinTriangle:triangle});
    }
    inside.sort((a,b)=>b.depthMm-a.depthMm);return {maxDepthMm:inside[0]?.depthMm??0,interiorVertexCount:inside.length,worst:inside[0]??null,vertices:inside};
  }
  return {rest,uv,deform,audit,alpha,interiorDepth,catalog:{sleeveTriangles:sleeve.length,sleeveEdges:sleeveEdges.length,targetTriangles:Object.fromEntries(targets.map(t=>[t.pi,t.triangles.length])),bodyVertexCount:rest.length/3,opaqueCuffVertices:cuffVertices.length,depthMethod:'Opaque cuff vertices inside full non-arm skin by >=4 of 6 axial odd-parity rays; exact nearest non-arm skin triangle distance. Open skin subset is a diagnostic, not watertight containment proof.',method:'Two-way exact segment/triangle intersections. Cuff primitive 3: lower-arm/hand weight >0.75 at every vertex. All Body materials: arm weight <0.1 at every vertex; includes skin, garment, pelvis and thighs. Both materials bilinear alpha >=0.5. No torso hull.'}};
}
