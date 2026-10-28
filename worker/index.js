// One HTML page and one read-only endpoint. No runtime dependencies.
// Retained only as an explicitly stale fallback. Successful values are never reused.
const lastSuccessful = new Map();

export function canonicalUrl(input, platform) {
  let url;
  try { url = new URL(String(input || '').trim().replace(/;+$/, '')); }
  catch { throw new Error('Enter a full fundraising page URL.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) throw new Error('Use a public HTTPS fundraising URL.');
  if (platform === 'movember') {
    if (url.hostname !== 'uk.movember.com' || !/^\/team\/\d+\/?$/.test(url.pathname)) throw new Error('Use a UK Movember team link: https://uk.movember.com/team/1234567');
  } else if (platform === 'justgiving') {
    if (!['justgiving.com','www.justgiving.com'].includes(url.hostname) || !/^\/(team|page|fundraising|campaign)\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)) throw new Error('Use a JustGiving team, page, fundraising or campaign link.');
    url.hostname = 'www.justgiving.com';
  } else throw new Error('Choose Movember or JustGiving.');
  return url.origin + url.pathname.replace(/\/$/, '');
}
function decode(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|pound|euro);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',pound:'£',euro:'€'})[entity.toLowerCase()] ?? match;
  });
}
function text(value) {
  return decode(value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[^]*?-->/g,'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
}
function money(value) {
  const m = value.match(/(£|€|US\$|CA\$|AU\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!m) throw new Error('The page did not expose a readable total. No value has been assumed.');
  const currency = ({'£':'GBP','€':'EUR','US$':'USD','CA$':'CAD','AU$':'AUD'})[m[1]];
  if (!currency) throw new Error('This page’s dollar currency is ambiguous. Use a GBP or EUR page.');
  const amountMinor = Math.round(Number(m[2].replace(/,/g,''))*100);
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Invalid fundraising amount.');
  return {amountMinor,currency};
}
export function parseMovember(html, sourceUrl) {
  const metadata = html.match(/"mov\.section\.currentMospace"\s*:\s*(\{[^]*?\})/);
  let team;
  try { team = metadata && JSON.parse(metadata[1]); } catch { /* Fail explicitly below. */ }
  if (!team || team.type !== 'team' || String(team.id) !== sourceUrl.split('/').pop()) throw new Error('Movember did not return the requested team.');
  const total = html.match(/<h1\b[^>]*class=["'][^"']*mospace-heroarea--donations-target-amount-number[^"']*["'][^>]*>([^]*?)<\/h1>/i);
  if (!total) throw new Error('Movember’s total could not be read. Its page layout may have changed.');
  if (!Number.isSafeInteger(team.numMembers) || team.numMembers < 0) throw new Error('Movember’s team member count could not be read.');
  const lastYear = html.match(/class=["'][^"']*mospace-heroarea--total-donations-past-years[^"']*["'][^>]*>([^]*?)<\/div>/i);
  return {platform:'movember',sourceUrl,name:team.name,...money(text(total[1])),people:team.numMembers,peopleLabel:'Team members',period:'Current campaign',detail:lastYear ? text(lastYear[1]) : 'Public team total',giftAidMinor:null};
}
export function parseJustGiving(html, sourceUrl) {
  const visible = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[^]*?-->/g,'');
  const plain = text(visible);
  // Exact aggregate summary, not rounded hero values or individual member totals.
  const summary = visible.match(/<dt\b[^>]*>\s*Total\s*<\/dt>\s*<dd\b[^>]*>([^]*?)<\/dd>/i);
  if (!summary) throw new Error('JustGiving’s donation summary could not be read. The page may be unavailable or its layout may have changed.');
  const summaryText = text(summary[1]), amount = money(summaryText);
  const giftAid = summaryText.match(/\+\s*((?:£|€|US\$|CA\$|AU\$|\$)\s*[\d,.]+)\s*Gift Aid/i);
  let people = null, peopleLabel = 'People';
  const kind = new URL(sourceUrl).pathname.split('/')[1];
  const headings = [...visible.matchAll(/<h[1-3]\b[^>]*>([^]*?)<\/h[1-3]>/gi)].map(m=>text(m[1]));
  if (kind === 'team') {
    const count = headings.map(x=>x.match(/^Team members\s*\(\s*([\d,]+)\s*\)$/i)).find(Boolean);
    people = count ? Number(count[1].replace(/,/g,'')) : null; peopleLabel = 'Team members';
  } else if (kind === 'campaign') {
    const count = headings.map(x=>x.match(/^([\d,]+)\s+fundraisers?$/i)).find(Boolean);
    people = count ? Number(count[1].replace(/,/g,'')) : null; peopleLabel = 'Fundraisers';
  } else {
    const supporters = plain.match(/\bby\s+([\d,]+)\s+supporters?\b/i);
    const donations = headings.map(x=>x.match(/^([\d,]+)\s+donations?$/i)).find(Boolean);
    people = supporters ? Number(supporters[1].replace(/,/g,'')) : donations ? Number(donations[1].replace(/,/g,'')) : null;
    peopleLabel = supporters ? 'Supporters' : donations ? 'Donations' : 'Supporters';
  }
  if (!headings[0]) throw new Error('JustGiving did not return a fundraising page.');
  return {platform:'justgiving',sourceUrl,name:headings[0],...amount,people,peopleLabel,period:'Page total · excludes Gift Aid',giftAidMinor:giftAid ? money(giftAid[1]).amountMinor : null,detail:people===null ? 'People count is not exposed on this page.' : 'Public page totals'};
}
async function fetchPage(sourceUrl, platform) {
  let url = sourceUrl;
  const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),20_000);
  try {
    for (let attempt=0; attempt<4; attempt++) {
      const response = await fetch(url,{redirect:'manual',signal:controller.signal,cache:'no-store',headers:{Accept:'text/html','Accept-Language':'en-GB,en;q=0.9','User-Agent':'FundraisingReader/1.0','Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache'}});
      if ([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get('location'); await response.body?.cancel();
        if (!location) throw new Error('The fundraising page returned an invalid redirect.');
        url=canonicalUrl(new URL(location,url).href,platform); continue;
      }
      if (!response.ok) {await response.body?.cancel();throw new Error('The fundraising platform returned HTTP '+response.status+'. Please try again later.');}
      if (!response.headers.get('content-type')?.includes('text/html')) {await response.body?.cancel();throw new Error('The platform did not return a public HTML page.');}
      const reader=response.body.getReader(), decoder=new TextDecoder();
      let html='',size=0;
      while (true) {
        const {done,value}=await reader.read(); if(done)break;
        size+=value.byteLength;
        if(size>2_000_000){await reader.cancel();throw new Error('The fundraising page is too large to read.');}
        html+=decoder.decode(value,{stream:true});
      }
      return {html:html+decoder.decode(),sourceUrl:url};
    }
    throw new Error('The fundraising page redirected too many times.');
  } catch(error) {
    if(controller.signal.aborted)throw new Error('The platform took too long to respond. Try refreshing.');
    throw error;
  } finally {clearTimeout(timeout);}
}
async function readTotal(sourceUrl, platform) {
  const existing=lastSuccessful.get(sourceUrl);
  try {
      const page=await fetchPage(sourceUrl,platform);
      const parsed=platform==='movember'?parseMovember(page.html,page.sourceUrl):parseJustGiving(page.html,page.sourceUrl);
      const data={...parsed,checkedAt:new Date().toISOString()};
      if(lastSuccessful.size>=100)lastSuccessful.delete(lastSuccessful.keys().next().value);
      lastSuccessful.set(sourceUrl,data);
      return {...data,status:'fresh',cached:false};
  } catch(error){if(existing)return {...existing,status:'stale',error:error.message,cached:true};throw error;}
}

// Competition ranks: 1, 1, 3. Money is ranked within its own currency.
// Only explicit team-member counts qualify for the team-size ranking.
export function rankRows(rows, metric) {
  const eligible = row => row.status === 'fresh' && row.data && (metric === 'members'
    ? row.data.peopleLabel === 'Team members' && Number.isSafeInteger(row.data.people)
    : Number.isSafeInteger(row.data.amountMinor));
  const value = row => metric === 'members' ? row.data.people : row.data.amountMinor;
  const group = row => metric === 'members' ? '' : row.data.currency;
  const compareGroup = (a,b) => a === b ? 0 : a === 'GBP' ? -1 : b === 'GBP' ? 1 : a.localeCompare(b);
  const ranked = rows.filter(eligible).slice().sort((a,b) => compareGroup(group(a),group(b)) || value(b)-value(a) || a.data.name.localeCompare(b.data.name));
  let previousGroup, previousValue, rank=0, position=0;
  const result = ranked.map(row => {
    const g=group(row), v=value(row);
    if(g !== previousGroup){position=0;previousValue=undefined;}
    position++;
    if(v !== previousValue)rank=position;
    previousGroup=g;previousValue=v;
    return {...row,rank};
  });
  return result.concat(rows.filter(row=>!eligible(row)).map(row=>({...row,rank:null})));
}

const page = String.raw`<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Compare Movember and JustGiving teams by funds raised and team membership, with fresh readings on every load."><title>Fundraising leaderboard</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18232b;background:#f6f7f8;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1080px;margin:48px auto;padding:0 24px}h1{font-size:28px;letter-spacing:-.8px;margin:0 0 8px}header p{margin:0;color:#5d6a75;font-size:14px}.panel{background:white;border:1px solid #dce2e5;border-radius:10px;margin-top:24px;padding:22px}label{display:block;font-size:13px;font-weight:600;margin-bottom:8px}textarea{display:block;width:100%;resize:vertical;min-height:106px;border:1px solid #cbd3d9;border-radius:6px;padding:12px;font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;color:#27363e;background:#fff}textarea:focus,button:focus-visible{outline:2px solid #7a9eb7;outline-offset:3px}.actions{display:flex;align-items:center;gap:12px;margin-top:12px}button{font:inherit;font-size:13px;font-weight:600;border:1px solid #253947;border-radius:6px;background:#253947;color:white;padding:10px 15px;cursor:pointer}button:hover{background:#3b5363}button:disabled{opacity:.6;cursor:wait}.help{font-size:12px;color:#5d6a75;line-height:1.6;margin:8px 0 0}.actions .help{margin:0}.toolbar{display:flex;gap:16px;align-items:center;justify-content:space-between;margin:24px 0 14px}.sorts{display:flex;gap:6px}.sorts button{background:#fff;color:#425463;border-color:#cbd3d9}.sorts button[aria-pressed=true]{background:#253947;border-color:#253947;color:white}.summary{font-size:12px;color:#5d6a75;margin:0;line-height:1.5}.table-wrap{overflow-x:auto;border:1px solid #dce2e5;border-radius:10px;background:#fff}table{width:100%;border-collapse:collapse;font-size:13px;text-align:left;min-width:740px}th{font-size:11px;letter-spacing:.25px;background:#edf1f3;color:#51606c;font-weight:600;padding:14px 16px}td{padding:17px 16px;border-top:1px solid #edf0f2;vertical-align:top}th.numeric,td.numeric{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.rank{width:60px;color:#586775;font-weight:600}.team-name{display:block;font-weight:600;line-height:1.5;color:#253947;text-underline-offset:3px;max-width:360px}.sub{display:block;color:#64717c;font-size:11px;line-height:1.6;margin-top:3px;overflow-wrap:anywhere}.value{font-weight:600;font-size:15px}.time{font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}.status{font-size:11px;color:#236f51;display:block;margin-top:4px}.status.stale,.status.error{color:#885111}.status.loading{color:#5d6a75}.message{font-size:12px;color:#885111;margin:12px 0;line-height:1.7;white-space:pre-line}.message:empty{display:none}.notes{font-size:12px;line-height:1.8;color:#5d6a75;margin:16px 0}.empty{text-align:center;color:#65717b;padding:36px}.remove{font-weight:400;background:transparent;color:#65717b;border:0;padding:2px 0;margin-top:5px;font-size:11px}.remove:hover{background:transparent;color:#253947;text-decoration:underline}.noncurrent{opacity:.8}caption{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:650px){main{margin:28px auto;padding:0 16px}.panel{padding:16px}.toolbar{align-items:flex-start;flex-direction:column;gap:10px}.actions{align-items:flex-start;flex-direction:column}h1{font-size:25px}}
</style></head><body><main>
<header><h1>Fundraising leaderboard</h1><p>Compare teams by money raised or team size.</p></header>
<section class="panel" aria-label="Connect fundraising pages"><form id="links-form"><label for="links">Movember and JustGiving links · one per line</label><textarea id="links" spellcheck="false" autocomplete="off" aria-describedby="links-help" placeholder="https://uk.movember.com/team/2492140&#10;https://www.justgiving.com/team/your-team"></textarea><p id="links-help" class="help">Both connectors are automatic. Add up to 30 pages; duplicate links count once.</p><div class="actions"><button type="submit" id="load">Load &amp; rank</button><p class="help">Fresh fetch on every page load and refresh. No saved totals are loaded.</p></div></form><p id="errors" class="message" role="alert"></p></section>
<div class="toolbar"><div class="sorts" role="group" aria-label="Rank teams by"><button type="button" id="sort-raised" aria-pressed="true">By raised</button><button type="button" id="sort-members" aria-pressed="false">By team members</button></div><p id="summary" class="summary" role="status" aria-live="polite">Ready to load.</p></div>
<div class="table-wrap"><table><caption>Fundraising rankings. Equal values share a rank.</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team / page</th><th scope="col" class="numeric">Raised</th><th scope="col" class="numeric">Team members</th><th scope="col">Last checked · London</th></tr></thead><tbody id="rows"><tr><td colspan="5" class="empty">Add your links to compare teams.</td></tr></tbody></table></div>
<p id="ranking-note" class="help"></p><p class="notes">Movember uses the current campaign total. JustGiving totals exclude Gift Aid. Only explicit team membership counts are ranked by team size; supporters and donations are not team members. Failed or stale readings are left unranked. Equal values share a rank.<br>Automatically refreshes every 60 seconds while this page is visible. The source platform controls when donations appear in its own totals.</p>
</main><script>
(() => {
 ${canonicalUrl.toString()}
 ${rankRows.toString()}
 const defaultLinks=['https://uk.movember.com/team/2492140'];
 const listKey='fundraising-reader-links-v2';
 const input=document.getElementById('links'),tbody=document.getElementById('rows'),summary=document.getElementById('summary'),errors=document.getElementById('errors'),button=document.getElementById('load');
 const time=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/London'});
 let metric='raised',rows=[],busy=false,activeLinks=[];
 const money=d=>new Intl.NumberFormat('en-GB',{style:'currency',currency:d.currency,maximumFractionDigits:d.amountMinor%100?2:0}).format(d.amountMinor/100);
 function platformOf(value){let url;try{url=new URL(value);}catch{throw new Error('Enter a full HTTPS fundraising URL.');}return url.hostname==='uk.movember.com'?'movember':'justgiving';}
 function saveLinks(links){try{localStorage.setItem(listKey,JSON.stringify(links));}catch{}}
 function initialLinks(){
  try{
   const saved=JSON.parse(localStorage.getItem(listKey)||'null');
   if(Array.isArray(saved))return saved.filter(x=>typeof x==='string').slice(0,30);
   // Migrate URLs from the earlier two-connector page, never its saved readings.
   const old=['movember','justgiving'].map(id=>JSON.parse(localStorage.getItem('fundraising-reader-v1-'+id)||'null')?.url).filter(Boolean);
   return old.length?old:defaultLinks;
  }catch{return defaultLinks;}
 }
 function cell(tr,value,className){const td=document.createElement('td');if(className)td.className=className;if(value!==undefined)td.textContent=value;tr.append(td);return td;}
 function sub(parent,value,className='sub'){const el=document.createElement('span');el.className=className;el.textContent=value;parent.append(el);return el;}
 function render(){
  tbody.replaceChildren();
  const ordered=rankRows(rows,metric);
  for(const row of ordered){
   const d=row.data,tr=document.createElement('tr');if(row.status!=='fresh')tr.className='noncurrent';
   cell(tr,busy?'—':row.rank===null?'—':String(row.rank),'rank');
   const team=cell(tr);const link=document.createElement('a');link.className='team-name';link.textContent=d?d.name:new URL(row.url).pathname;link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';team.append(link);
   sub(team,(row.platform==='movember'?'Movember':'JustGiving')+(d?' · '+d.period:''));
   if(row.error)sub(team,row.error,'sub');
   const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='Remove';remove.disabled=busy;remove.setAttribute('aria-label','Remove '+(d?d.name:row.url));
   remove.addEventListener('click',()=>{rows=rows.filter(x=>x.url!==row.url);activeLinks=activeLinks.filter(x=>x!==row.url);input.value=activeLinks.join('\n');saveLinks(activeLinks);render();});team.append(remove);
   const raised=cell(tr,undefined,'numeric');sub(raised,d?money(d):'—','value');
   if(d&&d.giftAidMinor!==null)sub(raised,'+ '+money({...d,amountMinor:d.giftAidMinor})+' Gift Aid');
   const members=cell(tr,undefined,'numeric');
   sub(members,d&&d.peopleLabel==='Team members'&&d.people!==null?new Intl.NumberFormat('en-GB').format(d.people):'—','value');
   if(d&&d.peopleLabel!=='Team members')sub(members,d.people===null?'Not published':new Intl.NumberFormat('en-GB').format(d.people)+' '+d.peopleLabel.toLowerCase());
   if(d&&d.peopleLabel==='Team members'&&d.people===null)sub(members,'Not published');
   const checked=cell(tr);
   sub(checked,d?time.format(new Date(d.checkedAt)):'—','time');
   if(d)sub(checked,new Date(d.checkedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'Europe/London'}));
   sub(checked,row.status==='fresh'?'Fetched this refresh':row.status==='loading'?'Fetching…':row.status==='stale'?'Stale · unranked':'Unavailable · unranked','status '+row.status);
   tbody.append(tr);
  }
  if(!rows.length){const tr=document.createElement('tr'),td=cell(tr,'Add your links to compare teams.','empty');td.colSpan=5;tbody.append(tr);}
  const fresh=rows.filter(x=>x.status==='fresh').length;
  summary.textContent=busy?'Fetching fresh data… '+rows.filter(x=>x.status!=='loading').length+'/'+rows.length:rows.length?fresh+'/'+rows.length+' pages fetched · ranked by '+(metric==='raised'?'raised':'team members'):'Add your links to begin.';
  const currencies=[...new Set(rows.filter(x=>x.status==='fresh').map(x=>x.data.currency))];
  document.getElementById('ranking-note').textContent=metric==='raised'&&currencies.length>1?'Different currencies are ranked separately; no exchange rates are assumed.':metric==='members'?'Only pages publishing a team-member count receive a team-size rank.':'';
 }
 async function loadAll(fromInput){
  if(busy)return;
  let links=[];const invalid=[];
  const candidates=fromInput?input.value.split(/[\s,;]+/).filter(Boolean):activeLinks;
  for(const candidate of candidates){
   try{const platform=platformOf(candidate),url=canonicalUrl(candidate,platform);if(!links.includes(url))links.push(url);}
   catch(error){invalid.push(candidate+': '+error.message);}
  }
  if(links.length>30){errors.textContent='Please use no more than 30 different links.';return;}
  errors.textContent=invalid.join('\n');
  // Do not replace a valid existing list when a submitted list is entirely invalid.
  if(candidates.length&&!links.length)return;
  activeLinks=links;saveLinks(links);if(!invalid.length)input.value=links.join('\n');
  const previous=new Map(rows.map(row=>[row.url,row.data]));
  rows=links.map(url=>({url,platform:platformOf(url),status:'loading',data:previous.get(url)||null,error:null}));
  busy=true;button.disabled=true;button.textContent='Fetching…';render();
  let index=0;
  async function next(){
   while(index<rows.length){
    const row=rows[index++];
    try{
     const response=await fetch('/api/totals?platform='+row.platform+'&url='+encodeURIComponent(row.url)+'&load='+Date.now(),{cache:'no-store'});
     const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not read this page.');
     row.data=data;row.status=data.status;row.error=data.error||null;
    }catch(error){row.status=row.data?'stale':'error';row.error=error.message;}
    render();
   }
  }
  try{await Promise.all(Array.from({length:Math.min(4,rows.length)},next));}
  finally{busy=false;button.disabled=false;button.textContent='Load & rank';render();}
 }
 document.getElementById('links-form').addEventListener('submit',event=>{event.preventDefault();loadAll(true);});
 for(const [id,value] of [['sort-raised','raised'],['sort-members','members']])document.getElementById(id).addEventListener('click',()=>{metric=value;document.getElementById('sort-raised').setAttribute('aria-pressed',String(metric==='raised'));document.getElementById('sort-members').setAttribute('aria-pressed',String(metric==='members'));render();});
 activeLinks=initialLinks();input.value=activeLinks.join('\n');loadAll(true);
 setInterval(()=>{if(!document.hidden&&activeLinks.length)loadAll(false);},60_000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&activeLinks.length)loadAll(false);});
 window.addEventListener('pageshow',event=>{if(event.persisted)loadAll(false);});
})();
</script></body></html>
`;

export default {
 async fetch(request){
  const url=new URL(request.url),headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'GET'}});
  if(url.pathname==='/')return new Response(page,{headers:{...headers,'content-type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"}});
  if(url.pathname==='/api/totals'){
   let sourceUrl,platform=url.searchParams.get('platform');
   try{sourceUrl=canonicalUrl(url.searchParams.get('url'),platform);}catch(error){return Response.json({error:error.message},{status:400,headers});}
   try{return Response.json(await readTotal(sourceUrl,platform),{headers:{...headers,'Cache-Control':'no-store'}});}
   catch(error){return Response.json({error:error.message},{status:502,headers:{...headers,'Cache-Control':'no-store'}});}
  }
  return new Response('Not found',{status:404,headers});
 }
};
