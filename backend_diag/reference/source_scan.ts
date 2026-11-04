#!/usr/bin/env node
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Read-only external-command reference scan. Never imports target code or executes commands.
// Usage: node source_scan.ts REPOSITORY OUTPUT_JSON [PINNED_COMMIT] [SOURCE_MANIFEST_JSON]
// Node.js 22.18+ / 23.6+ の型除去で直接実行する。依存パッケージなし。
// Review candidates before using them: a string can be a subcommand, test fixture, or example.
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';

type Candidate={path:string;line:number;kind:string};
const [rootArg,outputArg,commitArg,selectedArg]=process.argv.slice(2);
if(!rootArg||!outputArg){console.error('Usage: node source_scan.ts REPOSITORY OUTPUT_JSON [PINNED_COMMIT] [SOURCE_MANIFEST_JSON]');process.exit(2);}
const ROOT=path.resolve(rootArg),OUTPUT=path.resolve(outputArg),COMMIT=commitArg??null;
const SELECTED=selectedArg?new Set((JSON.parse(readFileSync(selectedArg,'utf8')) as {path:string}[]).map(e=>e.path)):null;
const EXT=new Set(['.py','.js','.mjs','.cjs','.ts','.cts','.mts','.vue','.sh','.bat','.cmd','.ps1','.toml','.json','.yaml','.yml','.ini','.conf','.cnf','.c','.h','.html','.css','.tmpl','.service','.fixture','.lock','.example','.sql']);
const SPECIAL=new Set(['Dockerfile','Makefile','AGENTS.md','README.md','hermes-gateway']);
const SKIP=new Set(['.git','.git_local','.aidiy_backup', '.backup_local', '.aidiy_cache','.venv','node_modules','__pycache__']);
// Python の Unicode 単語境界 \b を再現する（JS の \b は ASCII のみ）。
const W='[\\p{L}\\p{N}\\p{M}_]';
const REFERENCE=new RegExp(`(?:(?<!${W})(?:subprocess|Popen|create_subprocess|spawnSync|spawn|execSync|execFileSync|execFile|exec|os\\.system|os\\.popen|find_executable|find_node_executable|shutil\\.which|command|executable|INSTALL_RECIPES)|(?<=${W})\\.exe)(?!${W})`,'iu');
// str.splitlines() と同じ改行文字。
const splitlines=(text:string)=>{const lines=text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);if(lines.length>1&&lines.at(-1)==='')lines.pop();return lines;};
const files:{path:string;sha256:string;bytes:number}[]=[],refs:{path:string;line:number;text:string}[]=[],errors:{path:string;error:string}[]=[];
const candidates=new Map<string,Candidate[]>();
function add(value:unknown,file:string,line:number,kind:string){
 if(typeof value!=='string'||!value||[...value].length>160||value.includes('\n'))return;
 if(!candidates.has(value))candidates.set(value,[]);
 candidates.get(value)!.push({path:file,line,kind});
}

// --- Python ソースの字句解析と、AST と同じ単位（呼出し・for・代入・dict）での文字列抽出。対象コードは実行しない ---
type Token={type:'name'|'string'|'number'|'op';text:string;line:number;start:number;end:number;depth:number;value?:string|null;prefix?:string|null;f?:boolean;expression?:boolean};
const OPS=['**=','//=','>>=','<<=','...','->',':=','==','!=','<=','>=','+=','-=','*=','/=','%=','&=','|=','^=','@=','**','//','<<','>>'];
const NAME=/[\p{L}\p{Nl}_][\p{L}\p{N}\p{Mn}\p{Mc}\p{Pc}]*/uy;
const NUMBER=/(?:\d[\w]*(?:\.[\w]*)?|\.\d[\w]*)/y;
function decode(body:string):string{
 return body.replace(/\\(\r\n|\n|\r|[\\'"abfnrtv]|[0-7]{1,3}|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})/g,(_,e:string)=>{
  if(e[0]==='\n'||e[0]==='\r')return '';
  const simple:Record<string,string>={'\\':'\\',"'":"'",'"':'"',a:'\x07',b:'\b',f:'\f',n:'\n',r:'\r',t:'\t',v:'\v'};
  if(Object.hasOwn(simple,e))return simple[e];
  if(/^[0-7]/.test(e))return String.fromCodePoint(parseInt(e,8));
  return String.fromCodePoint(parseInt(e.slice(1),16));
 });
}
class Python {
 tokens:Token[]=[];match=new Map<number,number>();opener=new Map<number,number>();
 readonly src:string;
 constructor(src:string){this.src=src;this.tokenize();}
 // 文字列リテラルを読み、終端位置・本文・f-string の最初の式より前の本文位置を返す。
 private string(i:number,raw:boolean,f:boolean):{end:number;body:string;expression:number;lines:number}{
  const src=this.src,quote=src[i],triple=src.startsWith(quote.repeat(3),i),open=triple?3:1;
  let j=i+open,braces=0,expression=-1,lines=0;
  while(j<src.length){
   const c=src[j];
   if(c==='\n')lines++;
   if(c==='\\'){if(src[j+1]==='\n')lines++;j+=2;continue;}
   if(f&&braces===0&&(src.startsWith('{{',j)||src.startsWith('}}',j))){j+=2;continue;}
   if(f&&c==='{'){if(braces===0&&expression<0)expression=j-i-open;braces++;j++;continue;}
   if(f&&c==='}'&&braces>0){braces--;j++;continue;}
   if(braces>0&&(c==='"'||c==="'")){const nested=this.string(j,false,false);lines+=nested.lines;j=nested.end;continue;}
   if(braces===0&&(triple?src.startsWith(quote.repeat(3),j):c===quote))return {end:j+open,body:src.slice(i+open,j),expression,lines};
   if(!triple&&(c==='\n'||c==='\r'))return {end:j,body:src.slice(i+open,j),expression,lines:lines-(c==='\n'?1:0)};
   j++;
  }
  return {end:j,body:src.slice(i+open),expression,lines};
 }
 private tokenize(){
  const src=this.src,stack:number[]=[];let i=0,line=1;
  const push=(token:Omit<Token,'depth'>)=>{this.tokens.push({...token,depth:stack.length});};
  while(i<src.length){
   const c=src[i];
   if(c==='\r'||c==='\n'){
    i+=src.startsWith('\r\n',i)?2:1;
    if(stack.length===0&&this.tokens.length&&this.tokens.at(-1)!.text!=='\n')this.tokens.push({type:'op',text:'\n',line,start:i,end:i,depth:0});
    line++;continue;
   }
   if(c==='\\'&&/^\\(\r\n|\r|\n)/.test(src.slice(i,i+3))){i+=src.startsWith('\\\r\n',i)?3:2;line++;continue;}
   if(c===' '||c==='\t'||c==='\f'){i++;continue;}
   if(c==='#'){while(i<src.length&&src[i]!=='\n'&&src[i]!=='\r')i++;continue;}
   NAME.lastIndex=i;const name=NAME.exec(src);
   if(name&&(src[i+name[0].length]==='"'||src[i+name[0].length]==="'")&&/^(?:r|u|f|b|br|rb|fr|rf)$/i.test(name[0])){
    const prefix=name[0],raw=/r/i.test(prefix),f=/f/i.test(prefix),start=i,result=this.string(i+prefix.length,raw,f);
    const body=result.body,literal=(text:string)=>raw?text:decode(text);
    const token:Omit<Token,'depth'>={type:'string',text:src.slice(start,result.end),line,start,end:result.end,f};
    if(/b/i.test(prefix))token.value=null;
    else if(f){const head=result.expression<0?body:body.slice(0,result.expression);token.prefix=literal(head.replaceAll('{{','{').replaceAll('}}','}'));token.expression=result.expression>=0;token.value=null;}
    else token.value=literal(body);
    push(token);line+=result.lines;i=result.end;continue;
   }
   if(c==='"'||c==="'"){const result=this.string(i,false,false);push({type:'string',text:src.slice(i,result.end),line,start:i,end:result.end,value:decode(result.body)});line+=result.lines;i=result.end;continue;}
   if(name){push({type:'name',text:name[0],line,start:i,end:i+name[0].length});i+=name[0].length;continue;}
   NUMBER.lastIndex=i;const number=NUMBER.exec(src);
   if(number){push({type:'number',text:number[0],line,start:i,end:i+number[0].length});i+=number[0].length;continue;}
   const op=OPS.find(o=>src.startsWith(o,i))??c;
   if(')]}'.includes(op)&&stack.length){const open=stack.pop()!;this.match.set(open,this.tokens.length);this.opener.set(this.tokens.length,open);}
   push({type:'op',text:op,line,start:i,end:i+op.length});
   if('([{'.includes(op))stack.push(this.tokens.length-1);
   i+=op.length;
  }
 }
 text(from:number,to:number){return from<to?this.src.slice(this.tokens[from].start,this.tokens[to-1].end):'';}
 // [from,to) を最上位のカンマで分割する。末尾カンマの空要素は除く。
 split(from:number,to:number):[number,number][]{
  const parts:[number,number][]=[];let start=from;
  for(let k=from;k<to;k++){
   const t=this.tokens[k];
   if(t.type==='op'&&'([{'.includes(t.text)&&this.match.has(k)){k=this.match.get(k)!;continue;}
   if(t.type==='op'&&t.text===','){parts.push([start,k]);start=k+1;}
  }
  if(start<to)parts.push([start,to]);
  return parts;
 }
 hasComma(from:number,to:number){return this.split(from,to).length>1||(to>from&&this.tokens[to-1].text===',');}
 find(from:number,to:number,text:string,type='op'){
  for(let k=from;k<to;k++){const t=this.tokens[k];if(t.type==='op'&&'([{'.includes(t.text)&&this.match.has(k)){k=this.match.get(k)!;continue;}if(t.type===type&&t.text===text)return k;}
  return -1;
 }
 classify(from:number,to:number):{kind:'str';value:string}|{kind:'joined';prefix:string}|{kind:'const'}|{kind:'seq';elements:[number,number][]}|{kind:'other'}{
  const tokens=this.tokens.slice(from,to);if(!tokens.length)return {kind:'other'};
  if(tokens.every(t=>t.type==='string')){
   if(tokens.some(t=>t.value===null&&!t.f))return {kind:'const'};
   if(tokens.some(t=>t.f)){let prefix='';for(const t of tokens){if(t.f){prefix+=t.prefix??'';if(t.expression)break;}else prefix+=t.value!;}return {kind:'joined',prefix};}
   return {kind:'str',value:tokens.map(t=>t.value).join('')};
  }
  if(tokens.length===1&&(tokens[0].type==='number'||['None','True','False','...'].includes(tokens[0].text)))return {kind:'const'};
  const first=tokens[0];
  if(first.type==='op'&&(first.text==='['||first.text==='(')&&this.match.get(from)===to-1){
   const elements=this.split(from+1,to-1);
   if(first.text==='('&&elements.length===1&&!this.hasComma(from+1,to-1))return this.classify(elements[0][0],elements[0][1]);
   return {kind:'seq',elements};
  }
  return {kind:'other'};
 }
 strings(from:number,to:number):string[]{
  const c=this.classify(from,to);
  if(c.kind==='str')return [c.value];
  if(c.kind==='seq')return c.elements.map(([s,e])=>this.classify(s,e)).filter(x=>x.kind==='str').map(x=>(x as {value:string}).value);
  return [];
 }
 sequenceValues(from:number,to:number,requireConstantFirst:boolean):string[]|null{
  const c=this.hasComma(from,to)?{kind:'seq' as const,elements:this.split(from,to)}:this.classify(from,to);
  if(c.kind!=='seq')return null;
  if(requireConstantFirst&&(!c.elements.length||!['str','const'].includes(this.classify(...c.elements[0]).kind)))return null;
  return c.elements.map(([s,e])=>this.classify(s,e)).filter(x=>x.kind==='str').map(x=>(x as {value:string}).value);
 }
}
const KEYWORDS=new Set(['if','elif','while','for','in','and','or','not','return','yield','await','lambda','else','assert','del','import','from','as','with','is','raise','except','global','nonlocal','pass','class','def','async','try','finally','break','continue','None','True','False']);
const COMPOUND=new Set(['if','elif','else','while','with','try','except','finally','def','class']);
const RESOLVER=new Set(['which','_which','find_executable','find_node_executable','_has_command']);
const EXEC=/(run|Popen|call|check_output|check_call|create_subprocess_exec|create_subprocess_shell|execv|spawn|bounded_probe_run|os.system|os.popen|_exec)$/;
function scanPython(source:string,file:string){
 const py=new Python(source),tokens=py.tokens;
 // 呼出し（ast.Call）と dict リテラル（ast.Dict）
 tokens.forEach((token,k)=>{
  if(token.type!=='op'||!py.match.has(k))return;
  const close=py.match.get(k)!;
  if(token.text==='('){
   let s=k-1;if(s<0||tokens[s].type!=='name'||KEYWORDS.has(tokens[s].text))return;
   if(s>0&&tokens[s-1].type==='name'&&(tokens[s-1].text==='def'||tokens[s-1].text==='class'))return;
   // ast.unparse(func) と同じく、a(...).b[...].c のような連鎖全体を関数式とする。
   while(s>=2&&tokens[s-1].text==='.'){
    const before=tokens[s-2];
    if(before.type==='name'){s-=2;continue;}
    if(before.type==='op'&&(before.text===')'||before.text===']')&&py.opener.has(s-2)){s=py.opener.get(s-2)!;if(s>0&&tokens[s-1].type==='name'&&!KEYWORDS.has(tokens[s-1].text))s--;continue;}
    break;
   }
   const name=(s>=1&&tokens[s-1].text==='.'?'?.':'')+py.text(s,k),line=tokens[s].line;
   const args=py.split(k+1,close).filter(([a,b])=>!(b-a>=2&&tokens[a].type==='name'&&tokens[a+1].text==='=')&&tokens[a].text!=='**');
   if(name.endsWith('.which')||name.endsWith('.find_executable')||RESOLVER.has(name)||name.endsWith('._has_command'))
    for(const [a,b] of args)for(const value of py.strings(a,b))add(value,file,line,'resolver');
   if(EXEC.test(name)&&args.length){
    const [a,b]=args[0],c=py.classify(a,b);
    if(c.kind==='str')add(c.value,file,line,'exec_string');
    if(c.kind==='joined'&&c.prefix)add(c.prefix.trim().split(' ')[0],file,line,'dynamic_shell_prefix');
    const values=py.sequenceValues(a,b,true);if(c.kind==='seq'&&values?.length)add(values[0],file,line,'exec_argv');
   }
   if(name.endsWith('.append')&&/(player|cmd|command|argv)/i.test(name.slice(0,-'.append'.length))&&args.length){
    const [a,b]=args[0];if(py.classify(a,b).kind==='seq'){const values=py.strings(a,b);if(values.length)add(values[0],file,line,'argv_append');}
   }
  }
  if(token.text==='{'){
   if(py.find(k+1,close,'for','name')>=0)return;
   for(const [a,b] of py.split(k+1,close)){
    const colon=py.find(a,b,':');if(colon<0||tokens[a].text==='**')continue;
    const key=py.classify(a,colon);
    if(key.kind==='str'&&['command','cmd','binary','bin','executable'].includes(key.value)){const values=py.strings(colon+1,b);if(values.length)add(values[0],file,token.line,'registry');}
   }
  }
 });
 // 文単位（ast.For / ast.Assign / ast.AnnAssign）
 const statement=(from:number,to:number)=>{
  while(from<to&&tokens[from].text==='async')from++;
  if(from>=to)return;
  const head=tokens[from];
  if(head.type==='name'&&head.text==='for'){
   const inIndex=py.find(from+1,to,'in','name'),colon=inIndex<0?-1:py.find(inIndex+1,to,':');
   if(inIndex<0||colon<0)return;
   if(/(cmd|command|binary|exe|candidate)/i.test(py.text(from+1,inIndex))){
    const values=py.hasComma(inIndex+1,colon)?py.sequenceValues(inIndex+1,colon,false)??[]:py.strings(inIndex+1,colon);
    for(const value of values)add(value,file,head.line,'resolver_candidates');
   }
   return statement(colon+1,to);
  }
  if(head.type==='name'&&COMPOUND.has(head.text)){const colon=py.find(from+1,to,':');if(colon>=0)statement(colon+1,to);return;}
  if(head.type==='name'&&KEYWORDS.has(head.text))return;
  const equals:number[]=[];for(let k=from;k<to;k++){const t=tokens[k];if(t.type==='op'&&'([{'.includes(t.text)&&py.match.has(k)){k=py.match.get(k)!;continue;}if(t.type==='op'&&t.text==='=')equals.push(k);}
  if(!equals.length)return;
  const valueFrom=equals.at(-1)!+1,targets:string[]=[];let start=from;
  for(const e of equals){const colon=py.find(start,e,':');targets.push(py.text(start,colon>=0?colon:e));start=e+1;}
  if(/(cmd|command|argv|binaries|candidates)/i.test(targets.join(' '))){
   const c=py.hasComma(valueFrom,to)?{kind:'seq' as const,elements:py.split(valueFrom,to)}:py.classify(valueFrom,to);
   if(c.kind==='seq'&&c.elements.length){const first=py.classify(...c.elements[0]);if(first.kind==='str')add(first.value,file,head.line,'argv_assignment');}
  }
 };
 let start=0;
 tokens.forEach((t,k)=>{if(t.depth===0&&t.type==='op'&&(t.text==='\n'||t.text===';')){statement(start,k);start=k+1;}});
 statement(start,tokens.length);
}

function walk(directory:string):string[]{
 const result:string[]=[];
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  if(SKIP.has(entry.name))continue;
  const filename=path.join(directory,entry.name);
  if(entry.isSymbolicLink())continue;
  if(entry.isDirectory())result.push(...walk(filename));else if(entry.isFile())result.push(filename);
 }
 return result;
}
const ordered=walk(ROOT).map(filename=>path.relative(ROOT,filename).split(path.sep).join('/')).sort((a,b)=>a<b?-1:a>b?1:0);
for(const file of ordered){
 const filename=path.join(ROOT,...file.split('/')),name=path.basename(file),extension=path.extname(name);
 if(SELECTED!==null&&!SELECTED.has(file))continue;
 if(SELECTED===null&&!EXT.has(extension)&&!SPECIAL.has(name)&&!(lstatSync(filename).mode&0o111)&&!(name.includes('requirements')&&extension==='.txt'))continue;
 let bytes:Buffer,source:string;
 try{bytes=readFileSync(filename);source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch(error){errors.push({path:file,error:String((error as Error).message??error)});continue;}
 files.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
 const lines=splitlines(source);
 lines.forEach((text,index)=>{if(REFERENCE.test(text))refs.push({path:file,line:index+1,text:[...text].slice(0,1500).join('')});});
 if(extension==='.py')scanPython(source,file);
 else lines.forEach((text,index)=>{for(const match of text.matchAll(/(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|which)\(\s*['"]([^'"]+)['"]/g))add(match[1],file,index+1,'js_exec');});
}
const scanned=new Set(files.map(f=>f.path));
const result={repository:'monjyu1101/AiDiy2027',commit:COMMIT,method:'All selected source text read; Python tokenized and matched at call/loop/assignment/dict level, plus cross-language reference matching; no target code imported or executed. Candidates require review.',files_scanned:files.length,missing_files:SELECTED!==null?[...SELECTED].filter(p=>!scanned.has(p)).sort():[],files,errors,command_candidates:Object.fromEntries(candidates),execution_references:refs};
mkdirSync(path.dirname(OUTPUT),{recursive:true});writeFileSync(OUTPUT,JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify({files_scanned:files.length,candidates:candidates.size,execution_references:refs.length,errors:errors.length}));
