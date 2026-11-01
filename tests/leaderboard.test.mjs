import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import worker,{rankRows,totalRaised,canonicalUrl,parseMovember,parseJustGiving} from '../worker/index.js';
import {localD1} from '../scripts/local-d1.mjs';

const row=(name,amountMinor,people,extra={})=>({url:'https://example.test/'+name,status:'fresh',data:{name,amountMinor,people,currency:'GBP',peopleLabel:'Team members',...extra}});

test('money decides ranks, ties share competition ranks',()=>{
 const rows=[row('A',10000,2),row('B',20000,1),row('C',10000,8)];
 assert.deepEqual(rankRows(rows,'raised').map(x=>[x.data.name,x.rank]),[['B',1],['A',2],['C',2]]);
 assert.deepEqual(rankRows(rows).map(x=>x.data.name),['B','A','C']);
 assert.deepEqual(rankRows([row('A',100,2),row('B',100,2),row('C',50,1)],'raised').map(x=>x.rank),[1,1,3]);
});
test('member counts do not affect money ranks and stale readings cannot win',()=>{
 const rows=[row('Team',100,3),row('Donors',1000,500,{peopleLabel:'Supporters'}),row('Missing',20,null),{...row('Stale',9999,5000),status:'stale'}];
 assert.deepEqual(rankRows(rows).map(x=>[x.data.name,x.rank]),[['Donors',1],['Team',2],['Missing',3],['Stale',null]]);
 assert.equal(rankRows(rows,'raised').find(x=>x.data.name==='Stale').rank,null);
});
test('different currencies rank separately, zero is a valid reading',()=>{
 const ranked=rankRows([row('Euro',999999,1,{currency:'EUR'}),row('Zero',0,0),row('Pounds',10,1)],'raised');
 assert.deepEqual(ranked.map(x=>[x.data.name,x.rank]),[['Pounds',1],['Zero',2],['Euro',1]]);
 assert.equal(rankRows([row('Zero',0,0)])[0].rank,1);
});
test('relegation follows money raised, includes bottom ties and excludes unranked teams',()=>{
 const rows=[row('A',300,1),row('B',100,5),row('C',100,2),{...row('Stale',0,0),status:'stale'},row('Missing',200,null)];
 assert.deepEqual(rankRows(rows).filter(x=>x.isBottom).map(x=>x.data.name),['B','C']);
 assert.equal(rankRows(rows,'raised').find(x=>x.data.name==='Stale').isBottom,false);
 assert.deepEqual(rankRows([], 'raised'),[]);
});
test('relegation never compares ranks across currencies and handles a tied field',()=>{
 const rows=[row('Pound leader',300,3),row('Pound bottom',100,1),row('Euro leader',500,3,{currency:'EUR'}),row('Euro bottom',200,1,{currency:'EUR'})];
 assert.deepEqual(rankRows(rows,'raised').filter(x=>x.isBottom).map(x=>x.data.name),['Pound bottom','Euro bottom']);
 assert.ok(rankRows([row('A',0,0),row('B',0,0)],'raised').every(x=>x.isBottom));
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
 assert.doesNotMatch(html,/sort-members|sort-raised|Team members|team-size rank|members-column/);
 assert.match(html,/<th scope="col"/);
 assert.match(html,/colspan="3"/);
 assert.doesNotMatch(script,/JSON\.stringify\(.*data/);
});

test('each page load fetches once; totals render and tab returns do not refetch',async()=>{
 const html=await (await worker.fetch(new Request('https://app.test/'))).text();
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const calls=[];
 class Element extends EventTarget{
  constructor(){super();this.children=[];this.attributes={};this.textContent='';}
  append(child){this.children.push(child);}
  replaceChildren(...children){this.children=children;}
  setAttribute(name,value){this.attributes[name]=value;}
 }
 const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
 async function openPage(){
  const elements=new Map(),document=new EventTarget(),window=new EventTarget(),intervals=[];
  document.hidden=false;
  document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  document.createElement=()=>new Element();
  runInNewContext(script,{document,window,Intl,URL,setInterval:callback=>intervals.push(callback),fetch:async(url,init)=>{
   assert.equal(init.cache,'no-store');calls.push(url);
   return Response.json(url==='/api/teams'
    ?{teams:[{url:sourceUrl,name:'UCL Swim Team'}],canEdit:false}
    :{name:'UCL Swim Team',status:'fresh',amountMinor:1000,currency:'GBP',people:4,peopleLabel:'Team members',giftAidMinor:null});
  }});
  await settle();
  assert.equal(elements.get('rows').attributes['aria-busy'],'false');
  return {elements,document,window,intervals};
 }
 const page=await openPage();
 assert.equal(calls.length,2);
 assert.equal(page.elements.get('total-raised').children[0].children[0].textContent,'£10');
 assert.equal(page.elements.get('total-raised').attributes['aria-busy'],'false');
 assert.equal(page.elements.get('summary').textContent,'Across 1 society.');
 assert.equal(page.elements.has('sort-members'),false);
 page.document.dispatchEvent(new Event('visibilitychange'));
 const restored=new Event('pageshow');Object.defineProperty(restored,'persisted',{value:true});
 page.window.dispatchEvent(restored);
 for(const tick of page.intervals)tick();
 await settle();assert.equal(calls.length,2);
 await openPage();assert.equal(calls.length,4);
});

test('combined totals add exact minor units, keep currencies separate and exclude unavailable readings', () => {
 const rows=[row('A',68425,12),row('B',41270,19),row('C',17200,7),row('Euro',1001,1,{currency:'EUR'}),{...row('Stale',50000,14),status:'stale'}, {...row('Error',50000,10),status:'error'},row('Invalid',NaN,0),row('Negative',-1,0)];
 assert.deepEqual(totalRaised(rows),{available:4,totals:[{currency:'GBP',amountMinor:126895},{currency:'EUR',amountMinor:1001}]});
 assert.deepEqual(totalRaised([row('Zero',0,0)]),{available:1,totals:[{currency:'GBP',amountMinor:0}]});
 assert.deepEqual(totalRaised([]),{available:0,totals:[]});
 assert.deepEqual(totalRaised([{...row('Loading',10,0),status:'loading'}]),{available:0,totals:[]});
 assert.deepEqual(totalRaised([row('Big',Number.MAX_SAFE_INTEGER,0),row('More',1,0),row('Still more',10,0)]).totals,[{currency:'GBP',amountMinor:null}]);
});

test('summary distinguishes empty, failed, partial and mixed-currency totals', async () => {
 const html=await (await worker.fetch(new Request('https://app.test/'))).text();
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 class Element {
  children=[]; attributes={}; textContent='';
  append(child){this.children.push(child);}
  replaceChildren(...children){this.children=children;}
  setAttribute(name,value){this.attributes[name]=value;}
 }
 const text=element=>element.textContent+element.children.map(text).join(' ');
 async function load(readings,{failList=false}={}){
  const elements=new Map();
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element()};
  const waiting=[];
  runInNewContext(script,{document,Intl,URL,fetch:async url=>{
   if(url==='/api/teams')return failList?Response.json({error:'List unavailable'},{status:503}):Response.json({teams:readings.map((x,i)=>({name:'Society '+i,url:'https://uk.movember.com/team/'+(100+i)})),canEdit:false});
   const i=Number(new URL(new URL(url,'https://app.test').searchParams.get('url')).pathname.split('/').pop())-100;
   await new Promise(resolve=>waiting.push(resolve));
   return Response.json(readings[i]);
  }});
  for(let i=0;i<3;i++)await new Promise(setImmediate);
  if(readings.length&&!failList){assert.match(text(elements.get('total-raised')),/Loading/);assert.doesNotMatch(text(elements.get('total-raised')),/£0/);}
  waiting.forEach(resolve=>resolve());
  for(let i=0;i<5;i++)await new Promise(setImmediate);
  return {total:text(elements.get('total-raised')),note:elements.get('summary').textContent};
 }
 assert.deepEqual(await load([]),{total:'£0',note:'No societies listed yet.'});
 assert.deepEqual(await load([],{failList:true}),{total:'Unavailable',note:'Could not load societies.'});
 assert.match((await load([{status:'stale',amountMinor:9999,currency:'GBP'}])).total,/Unavailable/);
 const partial=await load([{status:'fresh',amountMinor:12345,currency:'GBP'},{status:'stale',amountMinor:9999,currency:'GBP'}]);
 assert.match(partial.total,/£123.45/);assert.equal(partial.note,'From 1 of 2 societies. 1 total unavailable.');
 const mixed=await load([{status:'fresh',amountMinor:100,currency:'GBP'},{status:'fresh',amountMinor:200,currency:'EUR'}]);
 assert.match(mixed.total,/£1 GBP/);assert.match(mixed.total,/€2 EUR/);assert.doesNotMatch(mixed.total,/£3/);
});
