import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{rankRows,canonicalUrl,parseMovember,parseJustGiving} from '../worker/index.js';
import {localD1} from '../scripts/local-d1.mjs';

const row=(name,amountMinor,people,extra={})=>({url:'https://example.test/'+name,status:'fresh',data:{name,amountMinor,people,currency:'GBP',peopleLabel:'Team members',...extra}});

test('raised and member ranks diverge, ties share competition ranks',()=>{
 const rows=[row('A',10000,2),row('B',20000,1),row('C',10000,8)];
 assert.deepEqual(rankRows(rows,'raised').map(x=>[x.data.name,x.rank]),[['B',1],['A',2],['C',2]]);
 assert.deepEqual(rankRows(rows,'members').map(x=>[x.data.name,x.rank]),[['C',1],['A',2],['B',3]]);
 assert.deepEqual(rankRows([row('A',100,2),row('B',100,2),row('C',50,1)],'raised').map(x=>x.rank),[1,1,3]);
});
test('donors, missing counts and stale readings cannot win team rankings',()=>{
 const rows=[row('Team',100,3),row('Donors',1000,500,{peopleLabel:'Supporters'}),row('Missing',20,null),{...row('Stale',9999,5000),status:'stale'}];
 assert.deepEqual(rankRows(rows,'members').map(x=>[x.data.name,x.rank]),[['Team',1],['Donors',null],['Missing',null],['Stale',null]]);
 assert.equal(rankRows(rows,'raised').find(x=>x.data.name==='Stale').rank,null);
});
test('different currencies rank separately, zero is a valid reading',()=>{
 const ranked=rankRows([row('Euro',999999,1,{currency:'EUR'}),row('Zero',0,0),row('Pounds',10,1)],'raised');
 assert.deepEqual(ranked.map(x=>[x.data.name,x.rank]),[['Pounds',1],['Zero',2],['Euro',1]]);
 assert.equal(rankRows([row('Zero',0,0)],'members')[0].rank,1);
});

const sourceUrl='https://uk.movember.com/team/2492140';
function movember(amount){return '<script>var data={"mov.section.currentMospace":{"type":"team","id":"2492140","name":"Test team","numMembers":4}}</script><h1 class="mospace-heroarea--donations-target-amount-number">£'+amount+'</h1><div class="mospace-heroarea--total-donations-past-years">Amount raised last year: £435</div>';}
test('every request fetches upstream, with no-store, even inside one minute',async()=>{
 const DB=localD1(),env={DB};
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,init)=>{
  calls++;assert.equal(url,sourceUrl);assert.equal(init.cache,'no-store');assert.match(init.headers['Cache-Control'],/no-cache/);
  return new Response(movember(calls*10),{headers:{'content-type':'text/html'}});
 };
 const request=()=>new Request('https://app.test/api/totals?platform=movember&url='+encodeURIComponent(sourceUrl));
 try{
  const a=await (await worker.fetch(request(),env)).json(),b=await (await worker.fetch(request(),env)).json();
  assert.equal(calls,2);assert.equal(a.amountMinor,1000);assert.equal(b.amountMinor,2000);assert.equal(b.cached,false);
  globalThis.fetch=async()=>{throw new Error('Upstream unavailable');};
  const stale=await (await worker.fetch(request(),env)).json();assert.equal(stale.status,'stale');assert.equal(stale.amountMinor,2000);assert.equal(stale.checkedAt,b.checkedAt);
  assert.equal(rankRows([{status:stale.status,data:stale}],'raised')[0].rank,null);
 }finally{globalThis.fetch=original;DB.close();}
});
test('source validation, current campaign parsing and missing totals fail explicitly',()=>{
 assert.equal(canonicalUrl(sourceUrl+';','movember'),sourceUrl);
 assert.throws(()=>canonicalUrl('https://uk.movember.com.evil.test/team/1','movember'));
 const d=parseMovember(movember('0'),sourceUrl);assert.equal(d.amountMinor,0);assert.equal(d.people,4);assert.match(d.detail,/435/);
 assert.throws(()=>parseMovember('<h1>£400</h1>',sourceUrl));
 assert.throws(()=>parseJustGiving('<h1>A page</h1>£400 raised','https://www.justgiving.com/team/test'));
});
test('served client uses fresh requests and has valid JavaScript',async()=>{
 const r=await worker.fetch(new Request('https://app.test/'));
 assert.equal(r.headers.get('Cache-Control'),'no-store');
 const html=await r.text(),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 new Function(script);
 assert.match(script,/cache:'no-store'/);
 assert.doesNotMatch(script,/JSON\.stringify\(.*data/);
});
