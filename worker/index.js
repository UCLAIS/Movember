// One HTML page and one read-only endpoint. No runtime dependencies.
const TTL = 60_000, cache = new Map(), inflight = new Map();

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
      const response = await fetch(url,{redirect:'manual',signal:controller.signal,headers:{Accept:'text/html','Accept-Language':'en-GB,en;q=0.9','User-Agent':'FundraisingReader/1.0'}});
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
  const existing=cache.get(sourceUrl);
  if(existing && Date.now()-existing.fetchedAt<TTL)return {...existing.data,status:'fresh',cached:true};
  if(inflight.has(sourceUrl))return inflight.get(sourceUrl);
  const operation=(async()=>{
    try {
      const page=await fetchPage(sourceUrl,platform);
      const parsed=platform==='movember'?parseMovember(page.html,page.sourceUrl):parseJustGiving(page.html,page.sourceUrl);
      const data={...parsed,checkedAt:new Date().toISOString()};
      if(cache.size>=100)cache.delete(cache.keys().next().value);
      cache.set(sourceUrl,{data,fetchedAt:Date.now()});
      return {...data,status:'fresh',cached:false};
    } catch(error){if(existing)return {...existing.data,status:'stale',error:error.message};throw error;}
    finally {inflight.delete(sourceUrl);}
  })();
  inflight.set(sourceUrl,operation);return operation;
}

const page = String.raw`<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Read live fundraising totals and team counts from Movember and JustGiving."><title>Fundraising reader</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18232b;background:#f6f7f8;font-synthesis:none;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1040px;margin:64px auto;padding:0 24px}header{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:28px}h1{font-size:29px;letter-spacing:-1px;margin:0 0 8px}header p{margin:0;color:#65717b;font-size:14px}.interval{font-size:12px;color:#65717b;border:1px solid #dce2e5;border-radius:20px;padding:7px 12px;white-space:nowrap}.cards{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:white;border:1px solid #dce2e5;border-radius:12px;padding:24px;min-width:0}h2{font-size:18px;margin:0}.card-head{display:flex;align-items:center;gap:9px;margin-bottom:24px}.dot{width:8px;height:8px;border-radius:50%;background:#95a0a7}.dot[data-state=fresh]{background:#26805c}.dot[data-state=stale],.dot[data-state=error]{background:#a9631b}.dot[data-state=loading]{background:#4779ac}label{font-size:12px;color:#51606c;display:block;margin-bottom:7px}form{display:flex;gap:8px}input{font:inherit;font-size:13px;min-width:0;width:100%;border:1px solid #cbd3d9;border-radius:6px;padding:11px 10px;color:#27363e;background:#fff}input:focus{outline:2px solid #8ca9bc;outline-offset:2px}button{font:inherit;font-size:13px;font-weight:600;border:1px solid #253947;border-radius:6px;background:#253947;color:white;padding:10px 14px;cursor:pointer;white-space:nowrap}button:hover{background:#3b5363}button:disabled{opacity:.6;cursor:wait}.team{font-size:14px;font-weight:600;min-height:40px;margin:24px 0 16px;line-height:1.4}.metrics{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;margin:0 0 18px}.metric dt{font-size:12px;color:#65717b;margin-bottom:7px}.metric dd{font-size:32px;font-weight:650;letter-spacing:-1px;margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.period{font-size:11px;color:#65717b;margin:5px 0 0;line-height:1.5}.detail{font-size:12px;color:#65717b;min-height:32px;line-height:1.5}.card-foot{border-top:1px solid #edf0f2;margin-top:20px;padding-top:16px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.status{font-size:12px;line-height:1.5;margin:0;color:#65717b;max-width:80%}.status[data-state=error],.status[data-state=stale]{color:#885111}a{font-size:12px;color:#345a73;text-underline-offset:3px;white-space:nowrap}a[hidden]{display:none}.note{font-size:12px;color:#65717b;line-height:1.7;margin-top:20px}.error{font-size:12px;color:#993f31;margin:9px 0 0;line-height:1.5}.error:empty{display:none}@media(max-width:740px){main{margin:32px auto;padding:0 16px}.cards{grid-template-columns:1fr}header{align-items:flex-start}.interval{display:none}article{padding:20px}}@media(prefers-reduced-motion:no-preference){button{transition:background .12s}}
</style></head><body><main><header><div><h1>Fundraising reader</h1><p>Live totals and people counts, straight from the page.</p></div><span class="interval">Refreshes every 60 seconds</span></header>
<section class="cards" aria-label="Fundraising connectors">
<article id="movember"><div class="card-head"><span class="dot" aria-hidden="true"></span><h2>Movember</h2></div><label for="movember-url">UK team page URL</label><form><input id="movember-url" type="url" required spellcheck="false" autocomplete="off" aria-describedby="movember-error" value="https://uk.movember.com/team/2492140"><button type="submit">Connect</button></form><p id="movember-error" class="error" role="alert"></p><p class="team">Connect a team page</p><dl class="metrics"><div class="metric"><dt>Raised</dt><dd class="raised">—</dd><p class="period">Current campaign</p></div><div class="metric"><dt class="people-label">Team members</dt><dd class="people">—</dd></div></dl><div class="detail">Last year’s fundraising is kept separate.</div><div class="card-foot"><p class="status" role="status" aria-live="polite">Waiting to connect.</p><a class="source" target="_blank" rel="noopener noreferrer" hidden>View page ↗</a></div></article>
<article id="justgiving"><div class="card-head"><span class="dot" aria-hidden="true"></span><h2>JustGiving</h2></div><label for="justgiving-url">Team, fundraiser or campaign URL</label><form><input id="justgiving-url" type="url" required spellcheck="false" autocomplete="off" aria-describedby="justgiving-error" placeholder="https://www.justgiving.com/team/…"><button type="submit">Connect</button></form><p id="justgiving-error" class="error" role="alert"></p><p class="team">Add a JustGiving page</p><dl class="metrics"><div class="metric"><dt>Raised</dt><dd class="raised">—</dd><p class="period">Excludes Gift Aid</p></div><div class="metric"><dt class="people-label">People</dt><dd class="people">—</dd></div></dl><div class="detail">Team members, fundraisers or supporters, as published.</div><div class="card-foot"><p class="status" role="status" aria-live="polite">Paste a page URL to connect.</p><a class="source" target="_blank" rel="noopener noreferrer" hidden>View page ↗</a></div></article>
</section><p class="note">Movember shows current campaign funds and team membership. JustGiving labels the count available on each page; donations are not necessarily unique people. Last successful readings stay visible if a refresh fails.</p></main>
<script>
(() => {
 const states={};
 const clock=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/London'});
 const money=d=>new Intl.NumberFormat('en-GB',{style:'currency',currency:d.currency,maximumFractionDigits:d.amountMinor%100?2:0}).format(d.amountMinor/100);
 const key=id=>'fundraising-reader-v1-'+id;
 function load(id){try{return JSON.parse(localStorage.getItem(key(id))||'null');}catch{return null;}}
 function save(id,value){try{localStorage.setItem(key(id),JSON.stringify(value));}catch{}}
 function display(id,d){
  const e=states[id].element;
  e.querySelector('.team').textContent=d.name;e.querySelector('.raised').textContent=money(d);
  e.querySelector('.people').textContent=d.people===null?'—':new Intl.NumberFormat('en-GB').format(d.people);
  e.querySelector('.people-label').textContent=d.peopleLabel;e.querySelector('.period').textContent=d.period;
  e.querySelector('.detail').textContent=d.giftAidMinor!==null?'+ '+money({...d,amountMinor:d.giftAidMinor})+' estimated Gift Aid, shown separately.':d.detail;
  const link=e.querySelector('.source');link.href=d.sourceUrl;link.hidden=false;
 }
 function status(s,message,kind){const e=s.element.querySelector('.status');e.textContent=message;e.dataset.state=kind;s.element.querySelector('.dot').dataset.state=kind;}
 function stamp(d){const date=new Date(d.checkedAt);return date.toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'Europe/London'})+' at '+clock.format(date)+' London time';}
 async function refresh(id,candidate){
  const s=states[id];if(s.busy)return;
  const url=(candidate||s.url||'').trim().replace(/;+$/,'');if(!url)return;
  s.busy=true;s.button.disabled=true;s.element.querySelector('.error').textContent='';
  status(s,s.last?'Checking for updates… Last read '+stamp(s.last):'Reading the public page…','loading');
  try{
   const response=await fetch('/api/totals?platform='+id+'&url='+encodeURIComponent(url),{cache:'no-store'});
   const d=await response.json();if(!response.ok)throw new Error(d.error||'The page could not be read.');
   s.url=d.sourceUrl;s.last=d;s.input.value=d.sourceUrl;display(id,d);save(id,{url:s.url,data:d});
   status(s,(d.status==='stale'?'Stale · last success ':'Checked ')+stamp(d),d.status);
   if(d.error)s.element.querySelector('.error').textContent=d.error;s.button.textContent='Refresh';
  }catch(error){
   status(s,s.last?'Stale · last success '+stamp(s.last):'Could not connect.','error');
   s.element.querySelector('.error').textContent=error.message+(s.last&&s.url!==url?' Still showing the previously connected page.':'');
  }finally{s.busy=false;s.button.disabled=false;}
 }
 for(const id of ['movember','justgiving']){
  const element=document.getElementById(id),input=element.querySelector('input'),button=element.querySelector('button');
  const s=states[id]={element,input,button,url:null,last:null,busy:false};
  element.querySelector('form').addEventListener('submit',event=>{event.preventDefault();refresh(id,input.value);});
  const remembered=load(id);
  if(remembered&&remembered.url&&remembered.data&&remembered.data.platform===id){s.url=remembered.url;s.last=remembered.data;input.value=s.url;display(id,s.last);status(s,'Saved reading · checking for updates…','stale');}
  if(id==='movember'||s.url)refresh(id,input.value);
 }
 setInterval(()=>{if(!document.hidden)for(const id of Object.keys(states))if(states[id].url)refresh(id);},60_000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)for(const id of Object.keys(states))if(states[id].url)refresh(id);});
})();
</script></body></html>`;

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
