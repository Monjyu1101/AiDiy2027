// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// 明示実行専用。設定済み専用チャンネルへ1件投稿する。利用者の送信許可が必要。
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {設定読込} from '../../frontend_channels/src/接続/接続設定';
import {Discord通信} from '../../frontend_channels/src/接続/ネットワーク接続';
import {Code接続} from '../../frontend_channels/src/コード/コード会話';

if(!process.argv.includes('--send'))throw Error('許可済みの試験投稿に限り --send を付けてください。');
const require=createRequire(resolve('frontend_channels/package.json'));
const {REST,Routes}=require('discord.js');
const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'temp/discord-live-result.json');
const config={...設定読込(),folder:resolve('temp/総合テストプロジェクト'),timeoutMs:180000};
const network=new Discord通信(),code=new Code接続(config);
const rest=new REST({version:'10',agent:network.rest,timeout:30000,retries:1}).setToken(config.token);
try{
  const channel=await rest.get(Routes.channel(config.textChannelId));
  assert.equal(channel.guild_id,config.guildId,'設定されたサーバー内の専用チャンネルだけに送る');
  const prompt='おはよう。一言で挨拶してください。ツール利用やファイル参照は不要です。';
  const answer=await code.実行('comprehensive-self-test',prompt);
  assert.ok(answer.trim()&&!answer.trim().startsWith('!')&&!answer.includes('正常終了しませんでした'),'製品のHermes接続から正常な回答を得る');
  const content=`【AiDiy総合テスト】\n入力：おはよう\nAI応答：${answer}`;
  assert.ok(content.length<=2000);
  const message=await rest.post(Routes.channelMessages(config.textChannelId),{body:{content,allowed_mentions:{parse:[]}}});
  const stored=await rest.get(Routes.channelMessage(config.textChannelId,message.id));
  assert.equal(stored.content,content,'投稿した本文をDiscordから再取得できる');
  const result={status:'✅ OK',time:new Date().toISOString(),channel:channel.name,prompt,answer,posted:true,readBackMatches:true,
    messageUrl:`https://discord.com/channels/${config.guildId}/${config.textChannelId}/${message.id}`,
    method:'製品のCode接続で実AI回答を生成し、設定済み専用チャンネルへBotで投稿・再取得。人の投稿をGatewayが受けて返信する経路の試験とは区別する。'};
  await mkdir(resolve(out,'..'),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify({status:result.status,posted:result.posted,readBackMatches:result.readBackMatches,answer}));
}catch(error){
  console.error('Discord実接続試験 NG: '+String(error instanceof Error?error.message:'失敗').replaceAll(config.token,'[非表示]'));
  process.exitCode=1;
}finally{await code.終了();await network.終了();}
