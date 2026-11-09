// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationPopupSizer} from '../src/components/開発スペース/Navi窓サイズ.js';
function fixture(width=480){
 const calls=[],win={screenX:8,screenY:192,outerWidth:width,outerHeight:600,screen:{availLeft:0,availTop:0,availWidth:1920,availHeight:1080},resizeTo(width,height){calls.push({width,height});this.outerWidth=width;this.outerHeight=height;},moveTo(x,y){this.screenX=x;this.screenY=y;}};
 return{win,calls,resize:createNavigationPopupSizer({settle:async()=>{}})};
}
test('Popup first expansion is at least 960 but preserves larger widths',async()=>{
 for(const width of [480,700,960,1200]){const f=fixture(width);await f.resize(f.win,true);assert.equal(f.win.outerWidth,Math.max(960,width));await f.resize(f.win,false);assert.equal(f.win.outerWidth,width);}
});
test('Popup remembers each manual width/height without affecting position or another popup',async()=>{
 const f=fixture(),other=fixture().win;await f.resize(f.win,true);Object.assign(f.win,{outerWidth:1100,outerHeight:800,screenX:25,screenY:40});
 await f.resize(f.win,false);assert.equal(f.win.outerWidth,480);assert.equal(f.win.outerHeight,600);assert.equal(f.win.screenX,25);assert.equal(f.win.screenY,40);
 Object.assign(f.win,{outerWidth:650,outerHeight:700});await f.resize(f.win,true);assert.equal(f.win.outerWidth,1100);assert.equal(f.win.outerHeight,800);
 await f.resize(f.win,true);assert.equal(f.calls.length,3);await f.resize(other,true);assert.equal(other.outerWidth,960);
 await f.resize(f.win,false);assert.equal(f.win.outerWidth,650);assert.equal(f.win.outerHeight,700);
});
test('Popup fitting respects negative origins and restores desired dimensions after a small screen',async()=>{
 const f=fixture();Object.assign(f.win,{screenX:-200,screenY:200});Object.assign(f.win.screen,{availLeft:-1024,availWidth:1024,availHeight:768});
 await f.resize(f.win,true);assert.equal(f.win.screenX,-968);assert.equal(f.win.screenY,160);assert.equal(f.win.outerWidth,960);
 await f.resize(f.win,false);Object.assign(f.win.screen,{availWidth:640,availHeight:480});await f.resize(f.win,true);assert.equal(f.win.outerWidth,624);assert.equal(f.win.outerHeight,464);
 await f.resize(f.win,false);Object.assign(f.win.screen,{availWidth:1920,availHeight:1080});await f.resize(f.win,true);assert.equal(f.win.outerWidth,960);assert.equal(f.win.outerHeight,600);
});
test('An ignored browser resize is safe and does not accumulate expansion',async()=>{
 const f=fixture();f.win.resizeTo=(width,height)=>f.calls.push({width,height});
 for(let i=0;i<3;i++){await f.resize(f.win,true);await f.resize(f.win,false);}
 assert.deepEqual(f.calls.map(c=>c.width),[960,480,960,480,960,480]);assert.equal(f.win.outerWidth,480);
});
test('Popup commits actual dimensions only after the asynchronous browser resize settles',async()=>{
 const f=fixture();let pending;f.win.resizeTo=(width,height)=>{pending={outerWidth:width,outerHeight:height};};
 const resize=createNavigationPopupSizer({settle:async win=>{Object.assign(win,pending);}});
 await resize(f.win,true);Object.assign(f.win,{outerWidth:1080,outerHeight:800});await resize(f.win,false);await resize(f.win,true);
 assert.equal(f.win.outerWidth,1080);assert.equal(f.win.outerHeight,800);
});

test('Missing browser display origins do not move the popup on every toggle',async()=>{
 const f=fixture();Object.assign(f.win,{screenX:100,screenY:120});delete f.win.screen.availLeft;delete f.win.screen.availTop;
 for(let i=0;i<4;i++){await f.resize(f.win,true);await f.resize(f.win,false);assert.equal(f.win.screenX,100);assert.equal(f.win.screenY,120);}
});


test('An already-wide popup keeps its width instead of shrinking to its smaller remembered Code width',async()=>{
 const f=fixture();await f.resize(f.win,true);f.win.outerWidth=850;await f.resize(f.win,false);
 f.win.outerWidth=1200;await f.resize(f.win,true);assert.equal(f.win.outerWidth,1200);
 await f.resize(f.win,false);f.win.outerWidth=500;await f.resize(f.win,true);assert.equal(f.win.outerWidth,850);
});
