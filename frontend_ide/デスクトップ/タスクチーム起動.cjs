// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {join}=require('node:path');
const {projectIdentity}=require('./project-profile.cjs');
function taskTeamProfile(appData,kind,project,fixed=false){
 if(!['task','team'].includes(kind))throw Error('Task / Team を指定してください。');
 return join(appData,`aidiy_${kind}_vue`,'projects',projectIdentity(project).key,fixed?'fixed':'standalone');
}
module.exports={taskTeamProfile};
