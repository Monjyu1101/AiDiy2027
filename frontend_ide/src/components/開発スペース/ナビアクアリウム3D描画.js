// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as THREE from 'three';

const TAU=Math.PI*2;
const vertex=`varying vec2 vUv; varying vec3 vPosition;
void main(){vUv=uv;vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const caustic=`float caustic(vec2 p,float t){
  p+=vec2(sin(p.y*1.7+t*.4),cos(p.x*1.4-t*.3))*.32;
  float a=sin(p.x*3.+t*.6)+sin(p.y*3.7-t*.45);
  float b=sin(p.x*2.8-p.y*1.5-t*.3)+cos(p.y*3.4+t*.5);
  return pow(1.-abs(a)*.5,14.)*.6+pow(1.-abs(b)*.5,18.)*.4;
}`;

// 外部モデル・画像を使わず、形状・鱗・光・水草を生成する。
export function ナビアクアリウム3D描画を作成(canvas, model) {
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.debug.onShaderError=()=>{throw new Error('水槽のシェーダーを初期化できませんでした');};
  const scene=new THREE.Scene();scene.name='ナビアクアリウム3D';scene.background=new THREE.Color('#020b11');scene.fog=new THREE.FogExp2('#04202a',.042);
  const camera=new THREE.PerspectiveCamera(38,1,.1,70);camera.position.set(0,0,16);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  const resources=new Set(), time={value:0}, dummy=new THREE.Object3D(), color=new THREE.Color();
  let width=14, lastWidth=0,lastHeight=0,lastDpr=0,disposed=false;
  const keep=value=>(resources.add(value),value);
  const geometry=value=>keep(value);
  const material=value=>keep(value);
  const mesh=(g,m,parent=scene)=>{const o=new THREE.Mesh(g,m);parent.add(o);return o;};
  const standard=options=>material(new THREE.MeshStandardMaterial(options));
  const shader=options=>material(new THREE.ShaderMaterial({vertexShader:vertex,uniforms:{time},...options}));
  function release(){
    if(disposed)return;disposed=true;
    scene.traverse(o=>{if(o.isInstancedMesh)o.dispose();});
    for(const value of resources)value.dispose();
    resources.clear();scene.clear();renderer.dispose();renderer.forceContextLoss();
  }
  try {
    scene.add(new THREE.HemisphereLight('#99e8f3','#233426',2.2));
    const sun=new THREE.DirectionalLight('#dcfff1',3.1);sun.position.set(-3,9,5);scene.add(sun);
    const rim=new THREE.DirectionalLight('#2b95d8',1.8);rim.position.set(5,2,-5);scene.add(rim);
    const warm=new THREE.PointLight('#f7d493',10,18,2);warm.position.set(-5,1,5);scene.add(warm);

    // 水槽の奥は青緑から黒へ沈む。水面近くの細い光で上方向を伝える。
    const backdrop=mesh(geometry(new THREE.PlaneGeometry(1,1)),shader({depthWrite:false,fragmentShader:`
      varying vec2 vUv;uniform float time;
      void main(){float halo=exp(-length((vUv-vec2(.35,.95))*vec2(2.,1.2))*3.);
      vec3 col=mix(vec3(.002,.009,.014),vec3(.012,.12,.15),halo);
      col+=vec3(.015,.045,.045)*pow(max(0.,sin(vUv.x*17.+time*.09)),8.)*pow(vUv.y,4.);
      gl_FragColor=vec4(col,1.);}` }));
    backdrop.position.set(0,0,-7);backdrop.scale.set(36,18,1);

    // 砂紋と揺らぐ集光模様。傾いた面なので奥行きに従って模様が詰まる。
    const ground=mesh(geometry(new THREE.PlaneGeometry(1,1,100,36)),shader({side:THREE.DoubleSide,fragmentShader:`
      varying vec2 vUv;varying vec3 vPosition;uniform float time;${caustic}
      void main(){vec2 p=vUv*vec2(24.,10.);
      float grain=fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
      float ripple=sin(p.y*19.+sin(p.x*.8)*2.)*.025;
      vec3 col=mix(vec3(.09,.13,.12),vec3(.33,.32,.23),vUv.y);
      col+=grain*.035+ripple;col+=caustic(p*.68,time)*vec3(.16,.24,.17);
      float path=exp(-pow((vUv.x-.5-sin(vUv.y*4.)*.035)*5.,2.));
      col*=.55+.5*path;gl_FragColor=vec4(col,1.);}` }));
    ground.rotation.x=-Math.PI/2;ground.position.set(0,-4.35,-1);ground.scale.set(35,15,1);

    const surface=mesh(geometry(new THREE.PlaneGeometry(1,1)),shader({transparent:true,depthWrite:false,side:THREE.DoubleSide,fragmentShader:`
      varying vec2 vUv;uniform float time;${caustic}
      void main(){float c=caustic(vUv*vec2(18.,7.),time);gl_FragColor=vec4(.22,.6,.64,.08+c*.21);}` }));
    surface.rotation.x=Math.PI/2;surface.position.set(0,4.95,-1);surface.scale.set(35,12,1);

    // 岩は同じ形状のインスタンス。頂点色で上面の苔と割れ目を作る。
    const rockGeo=geometry(new THREE.IcosahedronGeometry(1,2)), rockPos=rockGeo.attributes.position, rockColors=[];
    for(let i=0;i<rockPos.count;i++){
      const x=rockPos.getX(i),y=rockPos.getY(i),z=rockPos.getZ(i);
      const n=1+.12*Math.sin(x*12+z*5)*Math.cos(y*11-z*6);
      rockPos.setXYZ(i,x*n,y*n,z*n);
      color.set(y>.25?'#426348':'#344247').multiplyScalar(.7+.2*Math.sin(x*17+y*13));rockColors.push(color.r,color.g,color.b);
    }
    rockGeo.setAttribute('color',new THREE.Float32BufferAttribute(rockColors,3));rockGeo.computeVertexNormals();
    const rocks=new THREE.InstancedMesh(rockGeo,standard({vertexColors:true,roughness:1}),64);scene.add(rocks);
    const rockLayout=Array.from({length:64},(_,i)=>({
      x:(i%2?1:-1)*(.27+Math.random()*.27),z:-4.5+Math.random()*7.5,
      size:i<10?.7+Math.random()*.85:.1+Math.random()*.4,angle:Math.random()*TAU,
    }));

    // 細長い葉を立体的に反らせ、頂点シェーダーで先端だけ水流になびかせる。
    const leafGeo=geometry(new THREE.PlaneGeometry(1,1,4,14));leafGeo.translate(0,.5,0);
    const lp=leafGeo.attributes.position;
    for(let i=0;i<lp.count;i++){
      const y=lp.getY(i),x=lp.getX(i);
      lp.setXYZ(i,x*Math.pow(Math.sin(Math.PI*y),.7),y,.15*Math.sin(y*Math.PI)+Math.abs(x)*.08);
    }
    leafGeo.computeVertexNormals();
    const leafMat=standard({color:'#4c9971',side:THREE.DoubleSide,roughness:.65,metalness:.05});
    leafMat.onBeforeCompile=program=>{
      program.uniforms.aquariumTime=time;
      program.vertexShader='uniform float aquariumTime;\n'+program.vertexShader;
      program.vertexShader=program.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        float phase=instanceMatrix[3].x*1.8+instanceMatrix[3].z;
        transformed.x+=sin(aquariumTime*.7+phase+position.y*2.)*position.y*position.y*.11;
        transformed.z+=cos(aquariumTime*.5+phase)*position.y*position.y*.06;`);
    };
    const plants=new THREE.InstancedMesh(leafGeo,leafMat,240);scene.add(plants);
    const plantLayout=Array.from({length:240},(_,i)=>{
      const side=i%2?1:-1, cluster=Math.floor(i/12);
      return {x:side*(.32+(cluster%5)*.047)+(Math.random()-.5)*.05,
        z:-4+(cluster%4)*1.6+Math.random()*.7, height:(cluster%4===0?3.2:cluster%4===1?2: .55)+Math.random()*1.2,
        angle:Math.random()*TAU,lean:(Math.random()-.5)*.8,shade:.7+Math.random()*.5};
    });
    const wood=new THREE.Group();scene.add(wood);
    const woodMat=standard({color:'#493f2e',roughness:1});
    const branches=[[[0,0,0],[.5,.4,.1],[1.3,.8,0],[1.8,1.9,-.3]],
      [[.5,.4,.1],[.1,1.1,0],[-.5,1.7,-.2],[-.8,2.5,-.3]],
      [[1.3,.8,0],[1.9,.9,-.3],[2.5,1.3,-.6],[2.7,1.8,-.9]],
      [[0,0,0],[-.6,.3,.3],[-1,.3,.7],[-1.6,.1,1]]];
    branches.forEach((points,i)=>{
      const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
      const g=geometry(new THREE.TubeGeometry(curve,18,i===0?.16:.085,7,false));
      mesh(g,woodMat,wood);
    });
    const sphere=geometry(new THREE.SphereGeometry(1,12,8));
    const eyeMat=standard({color:'#030b10',roughness:.12,metalness:.25});
    const irisMat=standard({color:'#c9c79b',roughness:.28,metalness:.35});
    const shineMat=material(new THREE.MeshBasicMaterial({color:'#f3ffff'}));

    function fin(points,mat,parent){
      const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
      return mesh(geometry(new THREE.ShapeGeometry(shape,12)),mat,parent);
    }
    // 色の違う3種。鱗の細かな反射、腹側の淡色、体側の縞を頂点色に焼き込む。
    const fishStyles=[{base:'#36bfc8',back:'#153d57',belly:'#c3dfba',fin:'#41bfc4',height:.3},
      {base:'#f0a943',back:'#9e542b',belly:'#ffe0a1',fin:'#f7bc60',height:.4},
      {base:'#719ee8',back:'#28315b',belly:'#cee8ed',fin:'#827cda',height:.37}];
    const bodies=fishStyles.map((style,index)=>{
      const g=geometry(new THREE.SphereGeometry(1,48,28)),p=g.attributes.position,colors=[];
      const base=new THREE.Color(style.base),back=new THREE.Color(style.back),belly=new THREE.Color(style.belly);
      for(let i=0;i<p.count;i++){
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
        // 鼻は細く、腹は丸く。泳ぐ向きはローカル+X。
        const taper=.83+.17*x;
        p.setXYZ(i,x*.67,y*style.height*taper,z*.19*taper);
        color.copy(base).lerp(y>0?back:belly,Math.abs(y)*.65);
        const stripe=index===0?Math.exp(-Math.pow((y-.05)*10,2)):
          Math.pow(Math.max(0,Math.cos(x*(index===1?15:21)+y*1.4)),12)*.65;
        color.lerp(new THREE.Color(index===0?'#9dffff':'#23354b'),stripe*.7);
        color.multiplyScalar(.92+.08*Math.sin(x*105)*Math.cos(y*85));colors.push(color.r,color.g,color.b);
      }
      g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
    });
    const bodyMat=standard({vertexColors:true,roughness:.36,metalness:.28});
    const finMats=fishStyles.map(s=>standard({color:s.fin,side:THREE.DoubleSide,transparent:true,opacity:.73,depthWrite:false,forceSinglePass:true,roughness:.45}));
    const fishMeshes=model.fish.map(f=>{
      const group=new THREE.Group();scene.add(group);
      mesh(bodies[f.species],bodyMat,group);
      const mat=finMats[f.species],h=fishStyles[f.species].height;
      const tail=new THREE.Group();tail.position.x=-.52;group.add(tail);
      fin([[0,.09],[-.56,.38],[-.46,0],[-.56,-.38],[0,-.09]],mat,tail);
      // 尾の条線は細い線を共有して扇形を見せる。
      const rays=[];
      for(let i=0;i<8;i++)rays.push(0,0,.004,-.5,-.34+i*.097,.004);
      const rayGeo=geometry(new THREE.BufferGeometry());rayGeo.setAttribute('position',new THREE.Float32BufferAttribute(rays,3));
      tail.add(new THREE.LineSegments(rayGeo,material(new THREE.LineBasicMaterial({color:fishStyles[f.species].belly,transparent:true,opacity:.22}))));
      const dorsal=fin([[.23,h*.8],[-.04,h+.29],[-.5,h*.7],[-.3,h*.5]],mat,group);
      fin([[.12,-h*.7],[-.24,-h-.15],[-.42,-h*.6]],mat,group);
      const pectorals=[];
      for(const side of [-1,1]){
        const eye=mesh(sphere,irisMat,group);eye.position.set(.4,.065,side*.135);eye.scale.set(.072,.078,.035);
        const pupil=mesh(sphere,eyeMat,group);pupil.position.set(.413,.07,side*.16);pupil.scale.set(.044,.048,.022);
        const shine=mesh(sphere,shineMat,group);shine.position.set(.425,.09,side*.177);shine.scale.setScalar(.014);
        const pf=fin([[0,0],[-.3,-.24],[-.38,.025]],mat,group);pf.position.set(.1,-.05,side*.17);pf.rotation.y=side*.65;pectorals.push(pf);
      }
      group.scale.setScalar(f.size);
      return {group,tail,dorsal,pectorals};
    });
    const quaternion=new THREE.Quaternion(),orientation=new THREE.Euler(0,0,0,'YXZ');

    const foodMesh=new THREE.InstancedMesh(geometry(new THREE.IcosahedronGeometry(.044,1)),standard({color:'#eec388',emissive:'#65411a',emissiveIntensity:.35,roughness:.8}),64);
    foodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(foodMesh);
    // 泡はフレネル反射だけを残し、中心を透かす。背景用36個＋操作用32個を固定確保。
    const bubbleMat=material(new THREE.ShaderMaterial({transparent:true,depthWrite:false,
      vertexShader:`varying vec3 vNormal;varying vec3 vView;void main(){vec4 p=modelViewMatrix*instanceMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=-p.xyz;gl_Position=projectionMatrix*p;}`,
      fragmentShader:`varying vec3 vNormal;varying vec3 vView;void main(){float f=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),2.7);float shine=pow(max(0.,dot(normalize(vNormal),normalize(vec3(-.4,.7,1.)))),28.);gl_FragColor=vec4(vec3(.35,.74,.85)+shine*.5,f*.38+shine*.6);}`,
    }));
    const bubbleMesh=new THREE.InstancedMesh(sphere,bubbleMat,68);bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(bubbleMesh);
    const ambientBubbles=Array.from({length:36},(_,i)=>({x:(i%2?1:-1)*(.3+Math.random()*.12),offset:Math.random()*10,z:-1.5+Math.random()*4,size:.025+Math.random()*.035}));

    const dustGeo=geometry(new THREE.BufferGeometry()),dustPositions=new Float32Array(540);
    for(let i=0;i<180;i++){dustPositions[i*3]=(Math.random()-.5)*30;dustPositions[i*3+1]=(Math.random()-.5)*10;dustPositions[i*3+2]=-5+Math.random()*9;}
    dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));
    const dust=new THREE.Points(dustGeo,material(new THREE.ShaderMaterial({uniforms:{time},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`uniform float time;void main(){vec3 p=position;p.x+=sin(time*.13+p.y)*.18;p.y=mod(p.y+5.+time*.035,10.)-5.;vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(22./-mv.z,1.,2.5);gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`void main(){float a=1.-smoothstep(.1,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.36,.72,.72,a*.23);}`,
    })));scene.add(dust);

    // 水面から差し込む光芒。透明面の端を消して、板ではなく柔らかい光にする。
    const rayMat=shader({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,fragmentShader:`
      varying vec2 vUv;uniform float time;
      void main(){float center=.5+sin(vUv.y*3.+time*.18)*.035;
      float beam=exp(-pow((vUv.x-center)*5.,2.));
      float edge=smoothstep(0.,.3,vUv.y)*(1.-smoothstep(.93,1.,vUv.y));
      float shimmer=.75+.25*sin(time*.4+vUv.y*9.);
      gl_FragColor=vec4(.23,.6,.63,beam*edge*shimmer*.055);}`});
    const rayPlane=geometry(new THREE.PlaneGeometry(1,11));
    for(let i=0;i<5;i++){const ray=mesh(rayPlane,rayMat);ray.position.set((i-2)*2.8,.6,-3-i*.15);ray.rotation.z=-.18;ray.scale.x=.8+(i%3)*.65;}

    function layout(){
      wood.position.set(-width*.32,-4.15,-.7);
      rockLayout.forEach((r,i)=>{
        dummy.position.set(r.x*width,-4.25+r.size*.32,r.z);dummy.rotation.set(.2,r.angle,.2);
        dummy.scale.set(r.size*1.3,r.size*.8,r.size);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
      });rocks.instanceMatrix.needsUpdate=true;rocks.computeBoundingSphere();
      plantLayout.forEach((p,i)=>{
        dummy.position.set(p.x*width,-4.3,p.z);dummy.rotation.set(.12,p.angle,p.lean);
        dummy.scale.set(.1+p.height*.065,p.height,1);dummy.updateMatrix();plants.setMatrixAt(i,dummy.matrix);
        plants.setColorAt(i,color.setHSL(.34+(i%4)*.018,.38,p.shade*.48));
      });plants.instanceMatrix.needsUpdate=true;plants.instanceColor.needsUpdate=true;plants.computeBoundingSphere();
    }
    function resize(w,h,dpr){
      if(!(w>0&&h>0))return;
      dpr=Math.min(dpr||1,1.5);
      if(w===lastWidth&&h===lastHeight&&dpr===lastDpr)return;
      lastWidth=w;lastHeight=h;lastDpr=dpr;
      renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
      width=2*Math.tan(THREE.MathUtils.degToRad(19))*16*camera.aspect;
      model.resize(width*.95);layout();
    }
    function render(t,dt){
      time.value=t;
      fishMeshes.forEach((item,i)=>{
        const f=model.fish[i];if(!f)return;
        item.group.position.set(f.x,f.y,f.z);
        orientation.set(0,-Math.atan2(f.vz,f.vx),Math.atan2(f.vy,Math.hypot(f.vx,f.vz)));quaternion.setFromEuler(orientation);
        item.group.quaternion.slerp(quaternion,1-Math.exp(-dt*5));
        const wag=Math.sin(t*(6+Math.hypot(f.vx,f.vy,f.vz)*3)+f.phase);
        item.tail.rotation.y=wag*.4;item.dorsal.rotation.x=wag*.09;
        item.pectorals.forEach((fin,i)=>{fin.rotation.y=(i?1:-1)*(.65+Math.sin(t*9+f.phase)*.3);});
      });
      dummy.rotation.set(0,0,0);
      model.food.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.scale.setScalar(1);dummy.updateMatrix();foodMesh.setMatrixAt(i,dummy.matrix);});
      foodMesh.count=model.food.length;foodMesh.instanceMatrix.needsUpdate=true;foodMesh.computeBoundingSphere();
      let n=0;
      for(const b of ambientBubbles){dummy.position.set(b.x*width+Math.sin(t+b.offset)*.08,-4.25+(t*.5+b.offset)%9.2,b.z);dummy.scale.setScalar(b.size);dummy.updateMatrix();bubbleMesh.setMatrixAt(n++,dummy.matrix);}
      for(const b of model.bubbles){dummy.position.set(b.x,b.y,b.z);dummy.scale.setScalar(b.radius*(1+b.age*.04));dummy.updateMatrix();bubbleMesh.setMatrixAt(n++,dummy.matrix);}
      bubbleMesh.count=n;bubbleMesh.instanceMatrix.needsUpdate=true;bubbleMesh.computeBoundingSphere();
      renderer.render(scene,camera);
    }
    return {resize,render,dispose:release,
      point(x,y){return {x:(x-.5)*width,y:(.5-y)*2*Math.tan(THREE.MathUtils.degToRad(19))*16};},
    };
  } catch(error){release();throw error;}
}
