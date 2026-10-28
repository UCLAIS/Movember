// Small HTML pages and checked server endpoints. No runtime dependencies.
// Retained only as an explicitly stale fallback. Successful values are never reused.
const lastSuccessful = new Map();
const DEFAULT_TEAMS = ['https://uk.movember.com/team/2492140'];

export function canManage(request, env = {}) {
  const identity = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const owner = env.LEADERBOARD_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(identity && email && owner && email === owner);
}
export function validateTeams(values) {
  if (!Array.isArray(values) || values.length > 100) throw new Error('Provide a list of up to 30 fundraising links.');
  const result = [];
  for (const value of values) {
    const link = typeof value === 'string' ? value : value?.url;
    const name = typeof value === 'string' ? '' : (value?.name ?? '');
    if (typeof link !== 'string' || link.length > 500) throw new Error('Each team needs a fundraising URL.');
    if (typeof name !== 'string' || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Team names must be 80 characters or fewer, with no line breaks.');
    let u;try {u = new URL(link.trim().replace(/;+$/, ''));}catch {throw new Error('Enter a full fundraising page URL.');}
    const platform = u.hostname === 'uk.movember.com' ? 'movember' : 'justgiving';
    const url = canonicalUrl(link, platform);
    const duplicate=result.find(team=>team.url===url);
    if (duplicate && duplicate.name !== name.trim()) throw new Error('The same fundraising page cannot have two different team names. Edit its existing entry.');
    if (!duplicate) result.push({url,name:name.trim()});
  }
  if (result.length > 30) throw new Error('Please use no more than 30 different links.');
  return result;
}
async function savedTeams(env) {
  if (!env.DB) throw new Error('The saved team list is temporarily unavailable.');
  const row = await env.DB.prepare('SELECT teams_json, revision FROM leaderboard_settings WHERE id = 1').first();
  // Upgrade old link-only records on read, without changing the stored list.
  return row ? {teams:validateTeams(JSON.parse(row.teams_json)),revision:row.revision} : {teams:validateTeams(DEFAULT_TEAMS),revision:0};
}

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
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18232b;background:#f6f7f8;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1080px;margin:48px auto;padding:0 24px}h1{font-size:28px;letter-spacing:-.8px;margin:0 0 8px}header p{margin:0;color:#5d6a75;font-size:14px}.panel{background:white;border:1px solid #dce2e5;border-radius:10px;margin-top:24px;padding:22px}label{display:block;font-size:13px;font-weight:600;margin-bottom:8px}textarea{display:block;width:100%;resize:vertical;min-height:106px;border:1px solid #cbd3d9;border-radius:6px;padding:12px;font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;color:#27363e;background:#fff}textarea:focus,button:focus-visible{outline:2px solid #7a9eb7;outline-offset:3px}.actions{display:flex;align-items:center;gap:12px;margin-top:12px}button{font:inherit;font-size:13px;font-weight:600;border:1px solid #253947;border-radius:6px;background:#253947;color:white;padding:10px 15px;cursor:pointer}button:hover{background:#3b5363}button:disabled{opacity:.6;cursor:wait}.help{font-size:12px;color:#5d6a75;line-height:1.6;margin:8px 0 0}.actions .help{margin:0}.toolbar{display:flex;gap:16px;align-items:center;justify-content:space-between;margin:24px 0 14px}.sorts{display:flex;gap:6px}.sorts button{background:#fff;color:#425463;border-color:#cbd3d9}.sorts button[aria-pressed=true]{background:#253947;border-color:#253947;color:white}.summary{font-size:12px;color:#5d6a75;margin:0;line-height:1.5}.table-wrap{overflow-x:auto;border:1px solid #dce2e5;border-radius:10px;background:#fff}table{width:100%;border-collapse:collapse;font-size:13px;text-align:left;min-width:740px}th{font-size:11px;letter-spacing:.25px;background:#edf1f3;color:#51606c;font-weight:600;padding:14px 16px}td{padding:17px 16px;border-top:1px solid #edf0f2;vertical-align:top}th.numeric,td.numeric{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.rank{width:60px;color:#586775;font-weight:600}.team-name{display:block;font-weight:600;line-height:1.5;color:#253947;text-underline-offset:3px;max-width:360px}.sub{display:block;color:#64717c;font-size:11px;line-height:1.6;margin-top:3px;overflow-wrap:anywhere}.value{font-weight:600;font-size:15px}.time{font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}.status{font-size:11px;color:#236f51;display:block;margin-top:4px}.status.stale,.status.error{color:#885111}.status.loading{color:#5d6a75}.message{font-size:12px;color:#885111;margin:12px 0;line-height:1.7;white-space:pre-line}.message:empty{display:none}.notes{font-size:12px;line-height:1.8;color:#5d6a75;margin:16px 0}.empty{text-align:center;color:#65717b;padding:36px}.remove{font-weight:400;background:transparent;color:#65717b;border:0;padding:2px 0;margin-top:5px;font-size:11px}.remove:hover{background:transparent;color:#253947;text-decoration:underline}.noncurrent{opacity:.8}[hidden]{display:none!important}.actions a{font-size:13px;color:#345a73;text-underline-offset:3px}caption{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:650px){main{margin:28px auto;padding:0 16px}.panel{padding:16px}.toolbar{align-items:flex-start;flex-direction:column;gap:10px}.actions{align-items:flex-start;flex-direction:column}h1{font-size:25px}}
</style></head><body><main>
<header><h1>Fundraising leaderboard</h1><p>Compare teams by money raised or team size.</p></header>
<div class="actions"><button type="button" id="refresh">Refresh totals</button><a href="/admin/login" id="admin-link" hidden>Manage teams</a><span class="help">Read-only leaderboard · fresh data on every load</span></div><p id="errors" class="message" role="alert"></p>
<div class="toolbar"><div class="sorts" role="group" aria-label="Rank teams by"><button type="button" id="sort-raised" aria-pressed="true">By raised</button><button type="button" id="sort-members" aria-pressed="false">By team members</button></div><p id="summary" class="summary" role="status" aria-live="polite">Ready to load.</p></div>
<div class="table-wrap"><table><caption>Fundraising rankings. Equal values share a rank.</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team / page</th><th scope="col" class="numeric">Raised</th><th scope="col" class="numeric">Team members</th><th scope="col">Last checked · London</th></tr></thead><tbody id="rows"><tr><td colspan="5" class="empty">No teams have been added yet.</td></tr></tbody></table></div>
<p id="ranking-note" class="help"></p><p class="notes">Movember uses the current campaign total. JustGiving totals exclude Gift Aid. Only explicit team membership counts are ranked by team size; supporters and donations are not team members. Failed or stale readings are left unranked. Equal values share a rank.<br>Automatically refreshes every 60 seconds while this page is visible. The source platform controls when donations appear in its own totals.</p>
</main><script>
(() => {
 ${canonicalUrl.toString()}
 ${rankRows.toString()}
 const tbody=document.getElementById('rows'),summary=document.getElementById('summary'),errors=document.getElementById('errors'),button=document.getElementById('refresh');
 const time=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/London'});
 let metric='raised',rows=[],busy=false,activeLinks=[];
 const money=d=>new Intl.NumberFormat('en-GB',{style:'currency',currency:d.currency,maximumFractionDigits:d.amountMinor%100?2:0}).format(d.amountMinor/100);
 function platformOf(value){let url;try{url=new URL(value);}catch{throw new Error('Enter a full HTTPS fundraising URL.');}return url.hostname==='uk.movember.com'?'movember':'justgiving';}
 function cell(tr,value,className){const td=document.createElement('td');if(className)td.className=className;if(value!==undefined)td.textContent=value;tr.append(td);return td;}
 function sub(parent,value,className='sub'){const el=document.createElement('span');el.className=className;el.textContent=value;parent.append(el);return el;}
 function render(){
  tbody.replaceChildren();
  const ordered=rankRows(rows,metric);
  for(const row of ordered){
   const d=row.data,tr=document.createElement('tr');if(row.status!=='fresh')tr.className='noncurrent';
   cell(tr,busy?'—':row.rank===null?'—':String(row.rank),'rank');
   const team=cell(tr);const link=document.createElement('a');link.className='team-name';link.textContent=row.name||(d?d.name:new URL(row.url).pathname);link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';team.append(link);
   sub(team,(row.platform==='movember'?'Movember':'JustGiving')+(d?' · '+d.period:''));
   if(row.error)sub(team,row.error,'sub');
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
  if(!rows.length){const tr=document.createElement('tr'),td=cell(tr,'No teams have been added yet.','empty');td.colSpan=5;tbody.append(tr);}
  const fresh=rows.filter(x=>x.status==='fresh').length;
  summary.textContent=busy?'Fetching fresh data… '+rows.filter(x=>x.status!=='loading').length+'/'+rows.length:rows.length?fresh+'/'+rows.length+' pages fetched · ranked by '+(metric==='raised'?'raised':'team members'):'No teams have been added yet.';
  const currencies=[...new Set(rows.filter(x=>x.status==='fresh').map(x=>x.data.currency))];
  document.getElementById('ranking-note').textContent=metric==='raised'&&currencies.length>1?'Different currencies are ranked separately; no exchange rates are assumed.':metric==='members'?'Only pages publishing a team-member count receive a team-size rank.':'';
 }
 async function loadAll(){
  if(busy)return;
  busy=true;button.disabled=true;button.textContent='Fetching…';errors.textContent='';
  let links;
  try{
   const response=await fetch('/api/teams',{cache:'no-store'});
   const list=await response.json();if(!response.ok)throw new Error(list.error||'Could not load the approved team list.');
   links=list.teams;activeLinks=links;document.getElementById('admin-link').hidden=!list.canEdit;
  }catch(error){
   rows=rows.map(row=>({...row,status:row.data?'stale':'error',error:error.message}));
   busy=false;button.disabled=false;button.textContent='Refresh totals';errors.textContent=error.message;render();return;
  }
  const previous=new Map(rows.map(row=>[row.url,row.data]));
  rows=links.map(team=>({url:team.url,name:team.name,platform:platformOf(team.url),status:'loading',data:previous.get(team.url)||null,error:null}));
  render();
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
  finally{busy=false;button.disabled=false;button.textContent='Refresh totals';render();}
 }
 button.addEventListener('click',()=>loadAll());
 for(const [id,value] of [['sort-raised','raised'],['sort-members','members']])document.getElementById(id).addEventListener('click',()=>{metric=value;document.getElementById('sort-raised').setAttribute('aria-pressed',String(metric==='raised'));document.getElementById('sort-members').setAttribute('aria-pressed',String(metric==='members'));render();});
 loadAll();
 setInterval(()=>{if(!document.hidden)loadAll();},60_000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadAll();});
 window.addEventListener('pageshow',event=>{if(event.persisted)loadAll();});
})();
</script></body></html>
`;

const adminCheckPage=String.raw`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Administrator verified</title><style>
body{font-family:system-ui,sans-serif;color:#18232b;background:#f6f7f8;margin:0}main{max-width:460px;margin:80px auto;padding:28px;background:white;border:1px solid #dce2e5;border-radius:10px}h1{font-size:25px;letter-spacing:-.5px}p{line-height:1.7;font-size:14px;color:#5d6a75}.badge{color:#236f51;font-size:13px;font-weight:600}a{display:inline-block;font-size:14px;color:#345a73;margin-top:16px}.button{background:#253947;color:white;padding:12px 16px;border-radius:6px;text-decoration:none;margin-right:16px}@media(max-width:550px){main{margin:32px 16px;padding:22px}}
</style></head><body><main><p class="badge">Owner account verified</p><h1>Administrator access confirmed</h1><p>Your existing sign-in belongs to the authorised owner. You can manage the approved teams.</p><p>An existing owner session can be recognised without asking for your password again.</p><a class="button" href="/admin">Open team manager</a><a href="/">Back to leaderboard</a></main></body></html>`;

const adminPage=String.raw`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manage teams · Fundraising leaderboard</title><style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#18232b;background:#f6f7f8;color-scheme:light}*{box-sizing:border-box}main{max-width:850px;margin:48px auto;padding:0 24px}h1{font-size:27px;letter-spacing:-.7px;margin-bottom:8px}h2{font-size:17px;margin:0 0 18px}p{color:#5d6a75;font-size:13px;line-height:1.7}a{color:#345a73;text-underline-offset:3px;font-size:13px}.panel{background:white;border:1px solid #dce2e5;border-radius:10px;padding:22px;margin-top:22px}.badge{color:#236f51;font-size:12px}.fields{display:grid;grid-template-columns:1fr 1.4fr;gap:16px}label{font-size:13px;font-weight:600;display:block;margin-bottom:8px}input{width:100%;min-width:0;border:1px solid #cbd3d9;border-radius:6px;padding:11px;font:14px system-ui;color:#18232b;background:white}.hint{font-size:11px;margin:7px 0 0}fieldset{border:0;padding:0;margin:0}button{background:#253947;color:white;font:600 13px system-ui;border:1px solid #253947;border-radius:6px;padding:10px 15px;cursor:pointer}button:disabled{opacity:.6;cursor:wait}.actions{display:flex;gap:9px;align-items:center;margin-top:18px}.secondary{background:white;color:#253947}.message{white-space:pre-line;font-size:13px;line-height:1.7;min-height:22px}.message[data-error=true]{color:#993f31}input:focus,button:focus-visible{outline:2px solid #7a9eb7;outline-offset:3px}.list{list-style:none;padding:0;margin:0}.team-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:17px 0;border-top:1px solid #edf0f2}.team-row:first-child{border:0;padding-top:0}.team-info{min-width:0}.team-name{display:block;font-weight:600;font-size:14px;overflow-wrap:anywhere}.source{display:inline-block;font-size:12px;margin-top:6px;overflow-wrap:anywhere}.row-actions{display:flex;gap:8px;flex-shrink:0}.row-actions button{font-size:12px;padding:7px 11px}.remove{color:#993f31;border-color:#d9c7c2;background:white}.saved-header{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:18px}.saved-header h2{margin:0}.saved-header button{font-size:12px;padding:7px 11px}[hidden]{display:none!important}@media(max-width:650px){main{margin:28px auto;padding:0 16px}.panel{padding:18px}.fields{grid-template-columns:1fr}.team-row{align-items:flex-start;flex-direction:column;gap:12px}.saved-header{align-items:flex-start}h1{font-size:25px}}
</style></head><body><main><a href="/">← Leaderboard</a><h1>Manage teams</h1><p class="badge">Owner account verified · authorised to make changes</p><p>Choose the name shown on the leaderboard, then paste the fundraising page link. Add, edit or remove one team at a time.</p>
<section class="panel"><h2 id="form-title">Add a team</h2><form id="team-form"><fieldset id="team-fields" disabled><div class="fields"><div><label for="team-name">Team name</label><input id="team-name" maxlength="80" placeholder="e.g. UCL Swimming" autocomplete="off"><p class="hint">Optional. Leave blank to use the fundraising page’s name.</p></div><div><label for="team-url">Fundraising page link</label><input id="team-url" type="url" required placeholder="Paste a Movember or JustGiving link" spellcheck="false" autocomplete="off"><p class="hint">One page per team. Up to 30 teams.</p></div></div><div class="actions"><button id="save" type="submit">Add team</button><button id="cancel" type="button" class="secondary" hidden>Cancel edit</button></div></fieldset></form><p id="message" class="message" role="status" aria-live="polite">Verifying your access and loading teams…</p></section>
<section class="panel"><div class="saved-header"><h2 id="saved-title">Saved teams</h2><button id="reload" type="button" class="secondary">Reload saved teams</button></div><ul id="teams" class="list" aria-label="Approved teams"></ul></section></main><script>
(()=>{
 ${canonicalUrl.toString()}
 const name=document.getElementById('team-name'),url=document.getElementById('team-url'),fieldset=document.getElementById('team-fields'),save=document.getElementById('save'),cancel=document.getElementById('cancel'),reload=document.getElementById('reload'),message=document.getElementById('message'),list=document.getElementById('teams');
 let revision=null,busy=false,teams=[],editing=null;
 function state(text,error=false){message.textContent=text;message.dataset.error=String(error);}
 function lock(value){busy=value;fieldset.disabled=value||revision===null;reload.disabled=value;for(const b of list.querySelectorAll('button'))b.disabled=value||revision===null;}
 function sourceLabel(link){const u=new URL(link);return(u.hostname==='uk.movember.com'?'Movember · Team ':'JustGiving · ')+decodeURIComponent(u.pathname.split('/').pop());}
 function reset(){editing=null;name.value='';url.value='';save.textContent='Add team';cancel.hidden=true;document.getElementById('form-title').textContent='Add a team';}
 function render(){
  list.replaceChildren();document.getElementById('saved-title').textContent='Saved teams ('+teams.length+')';
  for(const [index,team] of teams.entries()){
   const row=document.createElement('li');row.className='team-row';
   const info=document.createElement('div');info.className='team-info';
   const title=document.createElement('span');title.className='team-name';title.textContent=team.name||sourceLabel(team.url);info.append(title);
   const link=document.createElement('a');link.className='source';link.href=team.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=sourceLabel(team.url)+' ↗';info.append(link);row.append(info);
   const actions=document.createElement('div');actions.className='row-actions';
   const edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent='Edit';edit.disabled=busy||revision===null;edit.setAttribute('aria-label','Edit '+(team.name||sourceLabel(team.url)));
   edit.addEventListener('click',()=>{editing=index;name.value=team.name;url.value=team.url;save.textContent='Save team';cancel.hidden=false;document.getElementById('form-title').textContent='Edit team';state('Edit the name or link, then save.');name.focus();});actions.append(edit);
   const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='Remove';remove.disabled=busy||revision===null;remove.setAttribute('aria-label','Remove '+(team.name||sourceLabel(team.url)));
   remove.addEventListener('click',async()=>{if(busy)return;await commit(teams.filter((_,i)=>i!==index),'Team removed.');});actions.append(remove);row.append(actions);list.append(row);
  }
  if(!teams.length){const empty=document.createElement('li');empty.textContent='No teams added yet.';list.append(empty);}
 }
 async function json(path,options={}){
  const response=await fetch(path,{cache:'no-store',...options});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Please reload and sign in again to manage teams.');
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The request could not be completed.');return data;
 }
 async function load(){
  if(busy)return;lock(true);
  try{const d=await json('/api/teams');if(!d.canEdit)throw new Error('This account cannot change the team list.');revision=d.revision;teams=d.teams;reset();render();state('Owner verified. '+teams.length+' '+(teams.length===1?'team':'teams')+' loaded.');}
  catch(error){revision=null;state(error.message,true);}finally{lock(false);}
 }
 async function commit(next,text){
  if(busy||revision===null)return false;lock(true);state('Saving…');
  try{const d=await json('/api/teams',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({teams:next,revision})});revision=d.revision;teams=d.teams;reset();render();state(text+' The leaderboard will update on its next refresh.');return true;}
  catch(error){state(error.message,true);return false;}finally{lock(false);}
 }
 document.getElementById('team-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||revision===null)return;
  try{
   const raw=url.value.trim(),platform=new URL(raw.replace(/;+$/,'')).hostname==='uk.movember.com'?'movember':'justgiving';
   const entry={name:name.value.trim(),url:canonicalUrl(raw,platform)};
   if(teams.some((team,index)=>index!==editing&&team.url===entry.url))throw new Error('That fundraising page is already listed. Use its Edit button.');
   const next=teams.slice();if(editing===null)next.push(entry);else next[editing]=entry;
   await commit(next,editing===null?'Team added.':'Team updated.');
  }catch(error){state(error.message,true);}
 });
 cancel.addEventListener('click',()=>{reset();state('Edit cancelled.');});reload.addEventListener('click',load);load();
})();
</script></body></html>`;


async function htmlResponse(html,headers,status=200){
 const hash=async value=>{
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  return "'sha256-"+btoa(String.fromCharCode(...bytes))+"'";
 };
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 const style=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
 const [scriptHash,styleHash]=await Promise.all([script?hash(script):"'none'",style?hash(style):"'none'"]);
 return new Response(html,{status,headers:{...headers,'content-type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src "+scriptHash+"; style-src "+styleHash+"; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
}

export default {
 async fetch(request,env={}){
  const url=new URL(request.url),headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','X-Frame-Options':'DENY'};
  const json=(data,status=200)=>Response.json(data,{status,headers});
  if(url.pathname==='/api/teams'){
   if(request.method==='GET'){
    try{return json({...await savedTeams(env),canEdit:canManage(request,env)});}
    catch{return json({error:'The saved team list is temporarily unavailable. Please retry.'},503);}
   }
   if(request.method==='PUT'){
    // Platform-injected identity is checked on every write, before touching storage.
    if(!canManage(request,env))return json({error:'Only the site owner can change the team list.'},403);
    if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Changes must come from this site’s admin page.'},403);
    if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return json({error:'Send the team list as JSON.'},415);
    const declared=Number(request.headers.get('content-length')||0);
    if(declared>16000)return json({error:'The team list is too large.'},413);
    let data,teams;
    try{
     const body=await request.text();if(body.length>16000)return json({error:'The team list is too large.'},413);
     data=JSON.parse(body);teams=validateTeams(data.teams);
     if(!Number.isSafeInteger(data.revision)||data.revision<0)throw new Error('Reload the saved list before saving.');
    }catch(error){return json({error:error instanceof SyntaxError?'Invalid JSON team list.':error.message},400);}
    if(!env.DB)return json({error:'The saved team list is temporarily unavailable.'},503);
    try{
     const updatedAt=new Date().toISOString();
     const result=data.revision===0
      ?await env.DB.prepare('INSERT OR IGNORE INTO leaderboard_settings (id, teams_json, revision, updated_at) VALUES (1, ?, 1, ?)').bind(JSON.stringify(teams),updatedAt).run()
      :await env.DB.prepare('UPDATE leaderboard_settings SET teams_json = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?').bind(JSON.stringify(teams),updatedAt,data.revision).run();
     if(result.meta.changes!==1)return json({error:'This list was changed in another tab. Reload the saved list before saving again.'},409);
     return json({teams,revision:data.revision+1,updatedAt});
    }catch{return json({error:'Could not save the team list. Please retry.'},503);}
   }
   return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'GET, PUT'}});
  }
  if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'GET'}});
  if(url.pathname==='/')return htmlResponse(page,headers);
  if(url.pathname==='/admin/login'){
   if(canManage(request,env))return htmlResponse(adminCheckPage,headers);
   if(request.headers.get('oai-authenticated-user-id'))return new Response('Not found',{status:404,headers});
   return Response.redirect(url.origin+'/signin-with-chatgpt?return_to=%2Fadmin%2Flogin',302);
  }
  if(url.pathname==='/admin'){
   if(!canManage(request,env))return new Response('Not found',{status:404,headers});
   return htmlResponse(adminPage,headers);
  }
  if(url.pathname==='/api/totals'){
   let sourceUrl,platform=url.searchParams.get('platform');
   try{sourceUrl=canonicalUrl(url.searchParams.get('url'),platform);}catch(error){return json({error:error.message},400);}
   let approvedTeam;
   try{approvedTeam=(await savedTeams(env)).teams.find(team=>team.url===sourceUrl);if(!approvedTeam)return json({error:'This page has not been added by the site owner.'},403);}
   catch{return json({error:'The approved team list is temporarily unavailable.'},503);}
   try{const data=await readTotal(sourceUrl,platform);return json({...data,pageName:data.name,name:approvedTeam.name||data.name});}
   catch(error){return json({error:error.message},502);}
  }
  return new Response('Not found',{status:404,headers});
 }
};
