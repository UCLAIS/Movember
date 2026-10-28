import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import worker from '../worker/index.js';
import {localD1} from '../scripts/local-d1.mjs';

const origin='https://app.test';
const owner={'oai-authenticated-user-id':'owner-test-id','oai-authenticated-user-email':'owner@example.test'};
const viewer={'oai-authenticated-user-id':'viewer-test-id','oai-authenticated-user-email':'viewer@example.test'};
const defaultTeam='https://uk.movember.com/team/2492140';
const otherTeam='https://www.justgiving.com/team/ntfcmovember';
const request=(path,headers={})=>new Request(origin+path,{headers});
const write=(body,identity=owner,extra={})=>new Request(origin+'/api/teams',{method:'PUT',headers:{...identity,Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});

test('only the configured signed-in owner can read admin or change teams',async()=>{
 const DB=localD1(),env={DB,LEADERBOARD_OWNER_EMAIL:'owner@example.test'};
 try{
  for(const identity of [{},viewer,{'oai-authenticated-user-email':'owner@example.test'}]){
   assert.equal((await worker.fetch(request('/admin',identity),env)).status,404);
   assert.equal((await worker.fetch(write({teams:[otherTeam],revision:0},identity),env)).status,403);
  }
  const anonymous=await (await worker.fetch(request('/api/teams'),env)).json();
  assert.equal(anonymous.canEdit,false);assert.deepEqual(anonymous.teams,[defaultTeam]);
  assert.equal((await worker.fetch(request('/admin',owner),env)).status,200);
  assert.equal((await (await worker.fetch(request('/api/teams',owner),env)).json()).canEdit,true);
  assert.equal((await worker.fetch(request('/admin',owner),{DB})).status,404);
  const signIn=await worker.fetch(request('/admin/login'),env);assert.equal(signIn.status,302);assert.equal(signIn.headers.get('Location'),origin+'/signin-with-chatgpt?return_to=%2Fadmin');
  assert.deepEqual((await (await worker.fetch(request('/api/teams'),env)).json()).teams,[defaultTeam]);
 }finally{DB.close();}
});
test('cross-site writes and unsupported URLs fail without changing the list',async()=>{
 const DB=localD1(),env={DB,LEADERBOARD_OWNER_EMAIL:'owner@example.test'};
 try{
  for(const headers of [{Origin:'https://evil.test'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await worker.fetch(write({teams:[otherTeam],revision:0},owner,headers),env)).status,403);
  assert.equal((await worker.fetch(write({teams:[otherTeam],revision:0},owner,{'Content-Type':'text/plain'}),env)).status,415);
  assert.equal((await worker.fetch(write({teams:['https://127.0.0.1/private'],revision:0}),env)).status,400);
  assert.deepEqual((await (await worker.fetch(request('/api/teams'),env)).json()).teams,[defaultTeam]);
 }finally{DB.close();}
});
test('saved lists persist across instances, with conflicts rejected atomically',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fundraising-admin-')),filename=join(dir,'test.sqlite');
 let DB=localD1(filename);const env=()=>({DB,LEADERBOARD_OWNER_EMAIL:'owner@example.test'});
 try{
  let r=await worker.fetch(write({teams:[otherTeam,otherTeam+'?tracking=1'],revision:0}),env());
  assert.equal(r.status,200);assert.deepEqual((await r.json()).teams,[otherTeam]);
  DB.close();DB=localD1(filename);
  const saved=await (await worker.fetch(request('/api/teams'),env())).json();assert.deepEqual(saved.teams,[otherTeam]);assert.equal(saved.revision,1);
  assert.equal((await worker.fetch(write({teams:[defaultTeam],revision:0}),env())).status,409);
  assert.equal((await worker.fetch(write({teams:[defaultTeam],revision:1}),env())).status,200);
  assert.equal((await worker.fetch(write({teams:[otherTeam],revision:1}),env())).status,409);
  assert.deepEqual((await (await worker.fetch(request('/api/teams'),env())).json()).teams,[defaultTeam]);
 }finally{DB.close();rmSync(dir,{recursive:true,force:true});}
});
test('only saved sources may be fetched and no browser writes are exposed on the leaderboard',async()=>{
 const DB=localD1(),env={DB,LEADERBOARD_OWNER_EMAIL:'owner@example.test'};
 try{
  assert.equal((await worker.fetch(request('/api/totals?platform=justgiving&url='+encodeURIComponent(otherTeam)),env)).status,403);
  const response=await worker.fetch(request('/'),env),html=await response.text();
  assert.doesNotMatch(html,/<textarea|<form|method:'PUT'|localStorage|remove\.addEventListener/);
  assert.match(html,/Refresh totals/);
  for(const [path,identity] of [['/',{}],['/admin',owner]]){
   const r=await worker.fetch(request(path,identity),env),h=await r.text(),csp=r.headers.get('Content-Security-Policy');
   assert.doesNotMatch(csp,/unsafe-inline/);assert.match(csp,/frame-ancestors 'none'/);
   const script=h.match(/<script>([\s\S]*?)<\/script>/)[1];new Function(script);
   const hash=createHash('sha256').update(script).digest('base64');assert.ok(csp.includes("'sha256-"+hash+"'"));
   assert.equal(r.headers.get('Cache-Control'),'no-store');
  }
 }finally{DB.close();}
});
