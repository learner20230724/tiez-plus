import test from 'node:test';
import assert from 'node:assert/strict';
import actions from '../apps/mobile/src/plus/actions.ts';
import P from '../protocol/index.cjs';
const { mergeDrafts,readComputer,readEntry,copyText }=actions;
test('ACK clear and unsaved editor at the same revision keep new editing',()=>{
  const base={id:'a',revision:2,updated_at:1};
  assert.equal(mergeDrafts([{...base,content:''}],[{...base,content:'new unsaved edit'}])[0].content,'new unsaved edit');
  assert.equal(mergeDrafts([{...base,content:''}],[{...base,revision:1,content:'acknowledged'}])[0].content,'');
});
test('pull and refresh never write clipboard; explicit copy retrieves full selected record',async()=>{
  let clipboard='keep original', writes=0;
  const text='  中文代码🙂\r\n'.repeat(10000);
  const remote={request:async(type,fields)=>{
    if(type==='get_current')return {ok:true,content:'current'};
    if(type==='get_history')return {ok:true,entries:[{id:'r',preview:'truncated'}]};
    assert.equal(type,'get_content'); assert.equal(fields.entryId,'r'); return {ok:true,content:text};
  }};
  await readComputer(remote);await readComputer(remote);
  assert.equal(clipboard,'keep original');assert.equal(writes,0);
  const full=await readEntry(remote,'r');
  await copyText(full,async value=>{writes++;clipboard=value;return true;});
  assert.equal(clipboard,text);assert.equal(writes,1);
});
test('failed full-text fetch preserves clipboard; failed write never reports success',async()=>{
  let clipboard='keep original';
  const write=async value=>{clipboard=value;return true;};
  await assert.rejects(async()=>copyText(await readEntry({request:async()=>({ok:false,error:'private'})},'r'),write),/private/);
  assert.equal(clipboard,'keep original');
  await assert.rejects(copyText('full text',async()=>false),/写入失败/);
});
test('UTF-8 limit counts bytes including surrogate pairs and does not rewrite text',()=>{
  for(const text of ['a','中','🙂','a\ud800b','\u0000\n\r\t','  a  ']) assert.equal(P.textBytes(text),Buffer.byteLength(text));
  const message={v:1,id:'m',requestId:'r',from:'p',to:'d',type:'send_text',content:'🙂'.repeat(P.MAX_TEXT_BYTES/4)};
  assert.equal(P.validateRequest(message).content,message.content);
  assert.throws(()=>P.validateRequest({...message,content:message.content+'a'}),/TEXT_TOO_LARGE/);
});

import discovery from '../apps/mobile/src/plus/discovery.ts';
test('discovery chooses sole new instance, remembers identity across IP changes, and never switches silently',()=>{
  const endpoint=(id,host='192.168.1.2',seen=10000)=>({product:'tiez-plus',v:1,instanceId:id,desktopId:id+'pc',name:id,host,httpPort:18083,wsPath:'/mqtt',seen});
  assert.equal(discovery.chooseEndpoint([endpoint('a')],null,10000).instanceId,'a');
  assert.equal(discovery.chooseEndpoint([endpoint('a'),endpoint('b')],null,10000),null);
  assert.equal(discovery.chooseEndpoint([endpoint('b')],'a',10000),null);
  assert.equal(discovery.chooseEndpoint([endpoint('a','192.168.2.9'),endpoint('b')],'a',10000).host,'192.168.2.9');
  assert.equal(discovery.chooseEndpoint([endpoint('a')],'a',60000),null);
});
