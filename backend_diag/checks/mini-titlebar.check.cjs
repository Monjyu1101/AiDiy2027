// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// ミニ表示でもタイトル周りの寸法を通常表示から変更しない。
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module'),req=createRequire(path.join(__dirname,'../ui/package.json'));
const {parse}=req('postcss'),{source}=require('./ui-components.cjs');
const normal=parse(source('style.css')),mini=parse(source('components/起動/起動ミニ.css')),launcher=parse(source('components/アプリ起動/マイクロランチャー.css'));
const palette=parse(require('node:fs').readFileSync(path.join(__dirname,'../ui/src/components/共通表示/タイトルバー配色.css'),'utf8'));
const titleColor=value=>value.replace(/var\((--[\w-]+)\)/g,(_match,name)=>declarations(palette,':root')[name]);
function declarations(css,selector){
 const values={};css.walkRules(rule=>{if(rule.selector===selector)rule.walkDecls(({prop,value})=>values[prop]=value);});return values;
}
const px=value=>{assert.match(value,/^\d+(?:\.\d+)?px$/);return Number.parseFloat(value);};
const verticalPadding=value=>{const sides=value.split(/\s+/).map(px);return sides.length<3?sides[0]*2:sides[0]+sides[2];};
const border=value=>px(value.split(/\s+/)[0]);
function contrast(a,b){
 const luminance=hex=>(hex.length===4?hex.slice(1).split('').map(value=>value+value).join(''):hex.slice(1)).match(/../g).map(value=>Number.parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
 const values=[luminance(titleColor(a)),luminance(titleColor(b))].sort((a,b)=>b-a);return(values[0]+.05)/(values[1]+.05);
}

test('通常・ミニのタイトル31px、接続線3px、タイトル文字13pxと操作寸法を共有する',()=>{
 const title=declarations(normal,'.panel-brand'),bar=declarations(normal,'.connection-bar');
 assert.equal(title.height,'31px');assert.equal(declarations(normal,'.panel-brand strong')['font-size'],'13px');
 assert.equal(bar.height,'3px');assert.equal(bar['border-top'],'1px solid #242424');assert.equal(bar.top,title.height);
 assert.equal(declarations(normal,'.connection-label')['font-size'],'10px');
 const controls=declarations(normal,'.window-actions button');
 assert.equal(controls.width,'28px');assert.equal(controls.height,'28px');assert.equal(controls['font-size'],'21px');
 assert.equal(declarations(normal,'#app>*').flex,'none','内容が増えてもタイトル・接続線を縮めない');
 mini.walkRules(rule=>{
  if(!/\.(?:panel-brand|connection-bar|connection-label|window-actions|mini-restore)\b/.test(rule.selector))return;
  assert.ok(rule.selector.endsWith(':hover'),'ミニCSSはタイトル周りの通常寸法を上書きしない');
  rule.walkDecls(({prop})=>assert.ok(['color','background','background-color'].includes(prop),`ミニのタイトル装飾で寸法を変更しない: ${prop}`));
 });
 assert.equal(declarations(normal,'.panel-brand.desktop')['-webkit-app-region'],'drag');
 assert.equal(declarations(normal,'.panel-brand button,.window-actions')['-webkit-app-region'],'no-drag');
});

test('実際の左上タイトル操作は通常・無効とも白文字で、無効は暗い面と破線で区別する',()=>{
 const button=declarations(launcher,'.launcher-selector button'),disabled=declarations(launcher,'.launcher-selector button:disabled'),hover=declarations(launcher,'.launcher-selector button:hover:not(:disabled)'),focus=declarations(launcher,'.launcher-selector button:focus-visible');
 assert.equal(titleColor(button.color),'#fff');assert.equal(button['font-size'],'10px');assert.equal(button.padding,'2px 7px');
 assert.equal(disabled.opacity,'1');assert.equal(disabled.cursor,'not-allowed');assert.equal(disabled['border-style'],'dashed');assert.equal(disabled.background,'#20242a');
 for(const background of [declarations(normal,'.panel-brand').background,disabled.background,hover.background])assert.ok(contrast(button.color,background)>=7);
 assert.match(focus.outline,/^2px solid var\(--aidiy-titlebar-foreground\)$/);assert.equal(focus['outline-offset'],'1px');
 assert.deepEqual(declarations(normal,'.window-actions .title-mini-switch'),{},'実DOMに当たらない旧配置の装飾を残さない');
 const link=declarations(mini,'.mini-project-link');assert.equal(link['-webkit-app-region'],'no-drag');assert.equal(link.padding,'0');assert.equal(link.border,'0');
 assert.equal(declarations(mini,'.mini-app-message.required::after')['pointer-events'],'none');assert.ok(declarations(mini,'.start-mini .mini-project-link:focus-visible').outline);
});

test('ミニの内容を自然な高さで計測し、2段アイコン・案内を上限360px内に収め、CLI通知行を持たない',()=>{
 const d=selector=>declarations(mini,selector);
 const chrome=px(declarations(normal,'.panel-brand').height)+px(declarations(normal,'.connection-bar').height);
 const app=d('.mini-app-launch'),appMessage=d('.mini-app-message.required');
 const appHeight=verticalPadding(app.padding)+border(app['border-bottom'])+px(d('.mini-app-buttons .mini-app-button').height)+px(appMessage['margin-top'])+px(appMessage.height);
 const cli=d('.mini-cli-launch');
 const cliHeight=verticalPadding(cli.padding)+border(cli['border-bottom'])+px(d('.mini-cli-buttons .mini-cli-button').height);
 assert.deepEqual(d('.mini-cli-message'),{});
 const statuses=verticalPadding(d('.mini-services').padding)+px(d('.mini-services .mini-service').height);
 assert.equal(chrome,34);assert.ok(chrome+appHeight+cliHeight+statuses<=360);
 assert.equal(d('#app>.panel.start-mini')['max-width'],'330px');assert.equal(d('#app>.panel.start-mini')['overflow-y'],'auto');assert.equal(d('#app>.panel.start-mini')['overflow-x'],'hidden');
 assert.equal(d('.mini-app-buttons')['grid-template-columns'],'repeat(6,minmax(0,1fr))');
 assert.equal(d('.mini-cli-buttons').display,'flex');assert.equal(d('.mini-cli-buttons')['justify-content'],'center');
 assert.equal(d('.mini-cli-buttons')['flex-wrap'],'wrap','6個を超える外部アイコンは次の段へ送り、両端を隠さない');
 assert.equal(d('.mini-cli-buttons .mini-cli-button').flex,'0 0 calc((100% - 10px)/6)','Copilotを含むCLIの外枠をAiDiyと同じ6列の幅に揃える');
 assert.equal(d('#app>.panel.start-mini').flex,'0 1 auto');assert.equal(d('.mini-content>*').flex,'none');
 assert.equal(d('.mini-services')['grid-template-columns'],'repeat(6,minmax(0,1fr))');
});


test('標準・ミニのタイトル文字と左側余白はdrag、操作ボタンと子要素だけをno-dragにする',()=>{
 const chrome=source('components/ウィンドウ/ステータスバー.vue');
 assert.match(chrome,/<header class="panel-brand" :class="\{desktop,compact\}"[^>]*>/);
 const header=declarations(normal,'.panel-brand.desktop');
 for(const property of ['-webkit-app-region','app-region']){
  assert.equal(header[property],'drag');
  assert.equal(declarations(normal,'.panel-brand.desktop>strong,.panel-brand.desktop>.launcher-selector')[property],'drag');
  assert.equal(declarations(normal,'.panel-brand button,.window-actions')[property],'no-drag');
  assert.equal(declarations(normal,'.panel-brand button *,.window-actions *')[property],'no-drag');
 }
 assert.equal(header['user-select'],'none');
 const micro=parse(source('components/アプリ起動/マイクロランチャー.css'));
 assert.equal(declarations(micro,'.launcher-selector')['-webkit-app-region'],undefined,'伸びたgrid列全体をno-dragにしない');
 assert.equal(declarations(micro,'.micro-launcher button')['-webkit-app-region'],'no-drag','microの操作方式は変えない');
 for(const css of [normal,mini,micro])css.walkRules(rule=>{
  if(!rule.selector.includes('compact'))return;
  rule.walkDecls(({prop,value})=>{if(prop.endsWith('app-region'))assert.notEqual(value,'no-drag','compact全域を除外しない');});
 });
});


test('通常・ミニ・Web のタイトル行は共通の暗灰色と白寄り文字を使い、本文の黒と状態色を分離する',()=>{
 const title=declarations(normal,'.panel-brand');
 assert.equal(title.background,'var(--aidiy-titlebar-background)');assert.equal(title.color,'var(--aidiy-titlebar-foreground)');
 for(const selector of ['.connection-label','.window-actions button'])assert.equal(declarations(normal,selector).color,'var(--aidiy-titlebar-secondary)');
 assert.equal(declarations(normal,'.panel-brand.desktop').background,undefined,'Web表示にも同じ地色を使う');
 assert.ok(contrast(title.color,title.background)>=7);assert.ok(contrast(declarations(normal,'.window-actions button').color,title.background)>=7);
 assert.equal(titleColor(title.background),'#30343a');
 for(const selector of [':root','body','aside'])assert.equal(declarations(normal,selector).background,'#000');assert.equal(declarations(normal,'.connection-bar').background,'#000');
 assert.equal(declarations(normal,'.connection-bar.online').background,'cyan');
 assert.equal(declarations(normal,'.window-actions .window-pin').color,'#778394');assert.equal(declarations(normal,'.window-actions .window-pin.pinned').color,'#c3f7ff');
 assert.match(declarations(normal,'.window-maximized .window-maximize')['box-shadow'],/var\(--aidiy-titlebar-background\)/);
 const imports=[];normal.walkAtRules('import',rule=>imports.push(rule.params));assert.ok(imports.includes('"./components/共通表示/タイトルバー配色.css"'));
});


test('起動・ミニの主面は黒を基準にし、操作階層・選択色・透明アイコン窓は維持する',()=>{
 const startup=parse(source('components/起動/起動.css')),micro=parse(source('components/アプリ起動/マイクロランチャー.css'));
 for(const selector of ['.start-panel','.start-panel .start-console'])assert.equal(declarations(startup,selector).background,'#000');
 for(const selector of ['#app:has(>.start-mini)','#app>.panel.start-mini'])assert.equal(declarations(mini,selector).background,'#000');
 assert.equal(declarations(normal,'button,input,select').background,'#1a2c3a');
 assert.equal(declarations(normal,'.panel-heading').background,'#000');
 assert.equal(declarations(startup,'.start-targets button.active').background,'#1b2d3d');
 assert.equal(declarations(mini,'.mini-service[data-tone=running]').background,'#0d2523');
 assert.equal(declarations(micro,'html.micro-mode,html.micro-mode body,html.micro-mode #app').background,'transparent');
});

test('Windows標準タイトルだけ独自操作へ切り替え、ミニnative dragと背景長押しを競合させない',()=>{
 const title=source('components/ウィンドウ/ステータスバー.vue');
 assert.match(title,/customNormalTitle.value=window.aidiyWindow\?\.customNormalTitle===true/);
 assert.ok(title.includes(':data-aidiy-standard-title="desktop&&customNormalTitle&&!compact?'));
 assert.ok(title.includes(':data-aidiy-no-window-move="desktop&&customNormalTitle&&!compact?'));
 assert.equal(declarations(normal,'.panel-brand.desktop')['-webkit-app-region'],'drag');
 const css=source('style.css');assert.match(css,/\.panel-brand\.desktop\[data-aidiy-standard-title\][^{}]*\{[^}]*-webkit-app-region:no-drag/);
});
