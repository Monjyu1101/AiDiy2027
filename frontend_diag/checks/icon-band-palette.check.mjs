// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const light=hex=>rgb(hex).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(light(a),light(b))+.05)/(Math.min(light(a),light(b))+.05);
function png(bytes){
 assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes[24],8);assert.equal(bytes[25],6);
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),chunks=[];
 for(let i=8;i<bytes.length;){const n=bytes.readUInt32BE(i),type=bytes.subarray(i+4,i+8).toString();if(type==='IDAT')chunks.push(bytes.subarray(i+8,i+8+n));i+=n+12;}
 const raw=inflateSync(Buffer.concat(chunks)),data=Buffer.alloc(width*height*4),stride=width*4;
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=4?data[i-4]:0,b=y?data[i-stride]:0,c=y&&x>=4?data[i-stride-4]:0;data[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return {width,height,data,pixel:(x,y)=>Array.from(data.subarray((y*width+x)*4,(y*width+x)*4+3))};
}
const entries=[['cpu','#166534','#FFFFFF'],['task','#0F5C3A','#7DD3FC'],['team','#7DD3FC','#0F5C3A'],['console','#C15308','#FFFFFF'],['avatar','#7C3AED','#FFFFFF'],['browser','#F5A9C8','#000000'],['aidiy_hermes','#000000','#D4AF37'],['vscode','#1E3A5F','#FFFFFF']];
for(const [id,bg,fg] of entries)test(`${id}: local PNG palette, readable contrast and identical distribution copy`,async()=>{
 const cli=['aidiy_hermes','vscode'].includes(id),file=(cli?'CLI_':'AiDiy_')+id+'.png';
 const source=new URL(`../diag/ui/components/アプリ起動/${cli?'CLIアイコン/'+id:'アイコン/AiDiy_'+id}.png`,import.meta.url);
 const bytes=await readFile(source),image=png(bytes);assert.deepEqual(await readFile(new URL('../static/'+file,import.meta.url)),bytes);
 assert.equal(image.width,image.height);assert.ok([120,512].includes(image.width));assert.ok(contrast(bg,fg)>=4.5);
 assert.deepEqual(image.pixel(5,image.height*3/4+3),rgb(bg));
 let ink=0;for(let y=image.height*3/4;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.pixel(x,y).every((v,i)=>v===rgb(fg)[i]))ink++;
 assert.ok(ink>100,id+' foreground remains visible');
 if(id==='aidiy_hermes'||id==='vscode')assert.deepEqual(image.pixel(0,image.height*3/4+5),rgb(id==='vscode'?'#2F9BFF':'#D4AF37'));
});
test('VSCode has only an inset band frame and its upstream logo stays local and unchanged',async()=>{
 const svg=await readFile(new URL('../diag/ui/components/アプリ起動/CLIアイコン/vscode.svg',import.meta.url),'utf8');
 assert.match(svg,/<rect id="caption-border" x="1" y="91" width="118" height="28" fill="none" stroke="#2F9BFF" stroke-width="2"/);
 const upstream=await readFile(new URL('../diag/ui/components/アプリ起動/CLIアイコン/upstream/vscode-stable.svg',import.meta.url),'utf8');
 const paths=s=>Array.from(s.matchAll(/<path\b[^>]*\bd="([^"]+)"/g),m=>m[1]);assert.deepEqual(paths(svg),paths(upstream));
});
