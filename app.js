'use strict';
// What Matters (WMQ) — Tier 0 local. Concept & design by Jeff SHNaZLab. All data in localStorage only.
const KEY='wmq.v1';
const PILLARS=[['comm','Open Communication'],['rel','Reliability / Follow-through'],['repair','Conflict Repair'],['bound','Boundaries'],['support','Mutual Support']];
const PURPOSES=[['insights','Rule-based insights about my circle'],['impact','Impact Tracker metrics & trends'],['reminders','Check-in reminders (on-device)']];
const CONSENT_LBL={never:'Never analyze',demand:'On demand only',continuous:'Continuous'};
const DAY=864e5;
const blank=()=>({people:[],entries:[],consent:{purposes:{},profilingFree:false},decisions:[],suppressed:[],notHelping:false,audit:[],updated:null});
let S;try{S=Object.assign(blank(),JSON.parse(localStorage.getItem(KEY)||'null')||{})}catch(e){S=blank()}
const save=()=>{S.updated=Date.now();localStorage.setItem(KEY,JSON.stringify(S))};
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const fmt=t=>t?new Date(t).toLocaleString():'—';
const $=s=>document.querySelector(s);

// ---- Audit log: append-only, SHA-256 hash chain ----
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
let auditQ=Promise.resolve();
function audit(type,data){auditQ=auditQ.then(async()=>{const prev=S.audit.length?S.audit[S.audit.length-1].hash:'GENESIS';const e={seq:S.audit.length,ts:new Date().toISOString(),type,data};e.prev=prev;e.hash=await sha(prev+JSON.stringify({seq:e.seq,ts:e.ts,type,data}));S.audit.push(e);save()});return auditQ}
async function verifyChain(){let prev='GENESIS';for(const e of S.audit){const h=await sha(prev+JSON.stringify({seq:e.seq,ts:e.ts,type:e.type,data:e.data}));if(e.prev!==prev||h!==e.hash)return{ok:false,at:e.seq};prev=e.hash}return{ok:true,n:S.audit.length}}

// ---- Consent resolver (hard gate) ----
function expireConsents(){const p=S.consent.purposes;for(const k in p){if(p[k]&&p[k].until&&p[k].until<Date.now()){delete p[k];audit('consent.expired',{purpose:k})}}save()}
const purposeOn=k=>{const p=S.consent.purposes[k];return !!p&&(!p.until||p.until>Date.now())};
const canAnalyze=(person,onDemand)=>purposeOn('insights')&&!S.consent.profilingFree&&!S.notHelping&&(person.consent==='continuous'||(person.consent==='demand'&&onDemand));
const activeConsents=()=>Object.keys(S.consent.purposes).filter(purposeOn).length+S.people.filter(p=>p.consent!=='never').length;

// ---- Rules ----
const entriesOf=pid=>S.entries.filter(e=>e.pid===pid).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:a.ts-b.ts);
const RULES={
 repair_lag:{name:'Repair lag',rule:'Conflict Repair score ≤ 4 on every entry for at least 14 consecutive days.',inputs:['Conflict Repair'],change:'Log an entry with Conflict Repair ≥ 5.',
  test(es){let start=null;for(const e of es){if(e.s.repair<=4){if(!start)start=e.date}else start=null}if(start&&(Date.parse(today())-Date.parse(start))>=14*DAY)return{key:start,detail:`Repair ≤ 4 since ${start}.`}}},
 boundary_dip:{name:'Boundary strain',rule:'Most recent Boundaries score ≤ 3.',inputs:['Boundaries'],change:'Log an entry with Boundaries ≥ 4.',
  test(es){const l=es[es.length-1];if(l&&l.s.bound<=3)return{key:l.id,detail:`Latest Boundaries = ${l.s.bound} (${l.date}).`}}},
 reliability_drop:{name:'Follow-through drop',rule:'Reliability fell by 3+ points between the last two entries.',inputs:['Reliability / Follow-through'],change:'A next entry where Reliability recovers.',
  test(es){const n=es.length;if(n>1&&es[n-2].s.rel-es[n-1].s.rel>=3)return{key:es[n-1].id,detail:`Reliability ${es[n-2].s.rel} → ${es[n-1].s.rel}.`}}},
 strong_support:{name:'Strong mutual support',rule:'Average Mutual Support ≥ 8 across the last 3 entries.',inputs:['Mutual Support'],change:'Support average dropping below 8.',
  test(es){if(es.length>=3){const a=es.slice(-3).reduce((t,e)=>t+e.s.support,0)/3;if(a>=8)return{key:es[es.length-1].id,detail:`Support avg ${a.toFixed(1)} over last 3.`}}}}
};
const ALLPILLARS=PILLARS.map(p=>p[1]);
function runRules(onDemandPid){
 if(!purposeOn('insights')||S.consent.profilingFree||S.notHelping)return;
 for(const p of S.people){if(!canAnalyze(p,p.id===onDemandPid))continue;const es=entriesOf(p.id);
  for(const [rid,r] of Object.entries(RULES)){if(S.suppressed.includes(rid))continue;const hit=r.test(es);if(!hit)continue;const k=rid+':'+p.id+':'+hit.key;if(S.decisions.some(d=>d.key===k))continue;
   const d={id:uid(),key:k,ts:Date.now(),rule:rid,personId:p.id,person:p.name,decision:r.name,detail:hit.detail,rationale:r.rule,inputsUsed:r.inputs.concat(['entry dates']),inputsNotUsed:ALLPILLARS.filter(x=>!r.inputs.includes(x)).concat(['your location','contacts','messages','any data from other apps or people']),whatChanges:r.change,consentBasis:{purpose:'insights',person:p.consent,trigger:p.id===onDemandPid?'on-demand':'continuous'},status:'active'};
   S.decisions.push(d);audit('insight.created',{id:d.id,rule:rid,person:p.id})}}
 save()}

// ---- Impact metrics ----
function weekBuckets(){const now=Date.parse(today())+DAY;return[3,2,1,0].map(i=>({from:now-(i+1)*7*DAY,to:now-i*7*DAY,label:i?`${i}w ago`:'This wk'}))}
function metrics(){
 const B=weekBuckets();const prevRepair={};const sorted=[...S.entries].sort((a,b)=>a.date<b.date?-1:1);const deltas=[];
 for(const e of sorted){if(e.pid in prevRepair)deltas.push({t:Date.parse(e.date),d:e.s.repair-prevRepair[e.pid]});prevRepair[e.pid]=e.s.repair}
 return B.map(b=>{const es=S.entries.filter(e=>{const t=Date.parse(e.date);return t>=b.from&&t<b.to});const ds=deltas.filter(x=>x.t>=b.from&&x.t<b.to);const avg=(a)=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  return{label:b.label,n:es.length,repairVel:avg(ds.map(x=>x.d)),auth:avg(es.map(e=>e.s.comm)),bound:avg(es.map(e=>e.s.bound)),tribe:avg(es.map(e=>PILLARS.reduce((t,[k])=>t+e.s[k],0)/5))}})}
const f1=v=>v==null?'—':(Math.round(v*10)/10).toString();

// ---- Views ----
const V={};
V.snapshot=()=>{const today0=new Date().setHours(0,0,0,0);const dt=S.decisions.filter(d=>d.ts>=today0).length;const m=metrics();const tw=m[3].tribe,lw=m[2].tribe;
 const imp=tw==null?'No entries yet':lw==null?`${f1(tw)}/10 (no prior week)`:`${tw-lw>=0?'+':''}${f1(tw-lw)} vs last wk`;
 return `<div class="card"><h2>Snapshot</h2><div class="grid">
 <div class="stat"><b>${activeConsents()}</b>Active consents</div><div class="stat"><b style="font-size:1rem">${S.updated?fmt(S.updated):'Never'}</b>Last updated</div>
 <div class="stat"><b>${dt}</b>AI decisions today</div><div class="stat"><b style="font-size:1rem">${esc(imp)}</b>Impact this week</div></div>
 <p class="mut">People: ${S.people.length} · Entries: ${S.entries.length} · Audit records: ${S.audit.length}${S.consent.profilingFree?' · <b>Profiling-free mode ON</b>':''}</p></div>
 ${S.people.length?'':'<div class="card empty">Start by adding someone in your circle on the Scorecard tab.</div>'}`};
V.scorecard=()=>`<div class="card"><h2>Add a person</h2><input type="text" id="pname" placeholder="First name or nickname" maxlength="40"><select id="pcons">${Object.entries(CONSENT_LBL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><button class="b" data-a="addp">Add</button><p class="mut">Consent defaults to "Never analyze". Ratings are always yours to log; analysis only runs if allowed.</p></div>
 ${S.people.length?S.people.map(p=>{const es=entriesOf(p.id);const l=es[es.length-1];return `<div class="card"><h3>${esc(p.name)}</h3>
 <div class="row"><span>Consent</span><select data-a="pc" data-id="${p.id}">${Object.entries(CONSENT_LBL).map(([k,v])=>`<option value="${k}"${p.consent===k?' selected':''}>${v}</option>`).join('')}</select></div>
 <details><summary>Log ratings</summary><label class="mut">Date <input type="date" id="d-${p.id}" value="${today()}" max="${today()}"></label>
 ${PILLARS.map(([k,n])=>`<label>${n}: <b id="o-${p.id}-${k}">5</b><input type="range" min="1" max="10" value="5" id="r-${p.id}-${k}" oninput="document.getElementById('o-${p.id}-${k}').textContent=this.value"></label>`).join('')}
 <button class="b" data-a="addent" data-id="${p.id}">Save entry</button></details>
 ${l?`<table><tr><th>Date</th>${PILLARS.map(([k,n])=>`<th title="${n}">${n.split(' ')[0].slice(0,6)}</th>`).join('')}</tr>${es.slice(-5).reverse().map(e=>`<tr><td>${e.date}</td>${PILLARS.map(([k])=>`<td>${e.s[k]}</td>`).join('')}</tr>`).join('')}</table>`:'<p class="empty">No entries yet.</p>'}
 ${p.consent==='demand'?`<button class="b s" data-a="analyze" data-id="${p.id}">Analyze now (on demand)</button>`:''}
 <button class="b s" data-a="delp" data-id="${p.id}">Remove person</button></div>`}).join(''):'<div class="card empty">No one in your circle yet.</div>'}`;
V.insights=()=>{let gate='';if(S.consent.profilingFree)gate='Profiling-free mode is ON — all insights are disabled.';else if(S.notHelping)gate='You marked "This isn\'t helping me" — insights are paused.';else if(!purposeOn('insights'))gate='Insights purpose is not enabled in Consent.';
 const act=S.decisions.filter(d=>d.status==='active');
 return `<div class="card"><h2>Insights</h2><p class="mut">Simple, transparent rules. Each one shows exactly why.</p>${gate?`<p><b>${gate}</b></p>`:''}</div>
 ${act.length?act.slice().reverse().map(d=>`<div class="card flag"><h3>${esc(d.decision)} · ${esc(d.person)}</h3><p>${esc(d.detail)}</p>
 <details><summary>Why this?</summary><p><b>Decision:</b> ${esc(d.decision)}</p><p><b>Inputs used:</b> ${d.inputsUsed.map(esc).join(', ')}</p><p><b>Inputs NOT used:</b> ${d.inputsNotUsed.map(esc).join(', ')}</p><p><b>Rule:</b> ${esc(d.rationale)}</p><p><b>What changes it:</b> ${esc(d.whatChanges)}</p><p class="mut">Consent basis: ${esc(d.consentBasis.trigger)} · created ${fmt(d.ts)} · record ${d.id}</p></details>
 <button class="b s" data-a="dismiss" data-id="${d.id}">Dismiss</button><button class="b s" data-a="stoptype" data-id="${d.rule}">Stop this type</button></div>`).join(''):'<div class="card empty">No active insights.</div>'}
 ${S.suppressed.length?`<div class="card"><h3>Stopped rule types</h3>${S.suppressed.map(r=>`<div class="row"><span>${RULES[r].name}</span><button class="b s" data-a="unstop" data-id="${r}">Resume</button></div>`).join('')}</div>`:''}
 <div class="card"><h3>All rules</h3>${Object.values(RULES).map(r=>`<p><b>${r.name}:</b> ${r.rule}</p>`).join('')}</div>`};
V.consent=()=>`<div class="card"><h2>Consent controls</h2><p class="mut">Nothing is pre-ticked. Turn a purpose on until you revoke it, or for 24 hours / 7 days.</p>
 ${PURPOSES.map(([k,n])=>{const p=S.consent.purposes[k];const v=!purposeOn(k)?'off':p.until?(p.dur||'tb'):'on';return `<div class="row"><span>${n}${p&&p.until&&purposeOn(k)?`<br><small class="mut">until ${fmt(p.until)}</small>`:''}</span><select data-a="purp" data-id="${k}">${[['off','Off'],['24h','On for 24h'],['7d','On for 7 days'],['on','On (until revoked)']].map(([a,b])=>`<option value="${a}"${v===a?' selected':''}>${b}</option>`).join('')}</select></div>`}).join('')}
 <div class="row"><span><b>Profiling-free mode</b><br><small class="mut">Disables all insights entirely.</small></span><input type="checkbox" data-a="pf" ${S.consent.profilingFree?'checked':''}></div></div>
 <div class="card"><h3>Per-person × purpose</h3>${S.people.length?`<table><tr><th>Person</th><th>Consent</th>${PURPOSES.map(([k])=>`<th>${k}</th>`).join('')}</tr>${S.people.map(p=>`<tr><td>${esc(p.name)}</td><td>${CONSENT_LBL[p.consent]}</td>${PURPOSES.map(([k])=>`<td>${p.consent!=='never'&&purposeOn(k)&&!(k==='insights'&&S.consent.profilingFree)?'✅':'—'}</td>`).join('')}</tr>`).join('')}</table>`:'<p class="empty">Add people on the Scorecard to see the matrix.</p>'}</div>`;
V.impact=()=>{const on=purposeOn('impact');const m=metrics();const any=m.some(w=>w.n);
 const row=(lbl,k,max,desc)=>`<div class="card"><h3>${lbl}</h3><p class="mut">${desc}</p>${m.map(w=>`<div class="row"><span style="width:70px">${w.label}</span><div class="bar" style="flex:1"><i style="width:${w[k]==null?0:Math.max(0,Math.min(100,(k==='repairVel'?(w[k]+9)/18:w[k]/max)*100))}%"></i></div><span style="width:44px;text-align:right">${f1(w[k])}</span></div>`).join('')}</div>`;
 return `<div class="card"><h2>Impact tracker</h2><div class="row"><span>This isn't helping me<br><small class="mut">Pauses insights; your feedback is logged.</small></span><input type="checkbox" data-a="nh" ${S.notHelping?'checked':''}></div></div>
 ${!on?'<div class="card empty">Enable "Impact Tracker" in Consent to compute metrics.</div>':!any?'<div class="card empty">No entries in the last 4 weeks yet.</div>':
 row('Repair velocity','repairVel',10,'Average change in Conflict Repair between consecutive entries for the same person (points).')+row('Authenticity index','auth',10,'Average Open Communication score (1–10).')+row('Boundary integrity','bound',10,'Average Boundaries score (1–10).')+row('Tribe quality','tribe',10,'Average of all five pillars across your circle (1–10).')}`};
V.rights=()=>`<div class="card"><h2>Your data rights</h2><p class="mut">Everything lives only in this browser on this device.</p>
 <button class="b" data-a="export">Export all (JSON)</button><button class="b s" data-a="delins">Delete insights only</button><button class="b d" data-a="delall">Delete everything</button></div>`;
V.audit=()=>`<div class="card"><h2>Audit log</h2><p class="mut">Append-only, SHA-256 hash-chained.</p><button class="b" data-a="verify">Verify chain</button><button class="b s" data-a="expaudit">Export log</button><p id="vres"></p></div>
 ${S.audit.length?S.audit.slice().reverse().slice(0,200).map(e=>`<div class="card"><b>#${e.seq} ${esc(e.type)}</b> <span class="mut">${fmt(e.ts)}</span><div class="mono">${esc(JSON.stringify(e.data))}</div><div class="mono mut">hash ${e.hash.slice(0,24)}… prev ${e.prev.slice(0,12)}…</div></div>`).join(''):'<div class="card empty">No audit records yet.</div>'}`;

let cur='snapshot';
function render(){expireConsents();if(cur==='insights'||cur==='snapshot')runRules();$('#view').innerHTML=V[cur]();document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===cur))}
function dl(name,obj){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.download=name;a.click()}
document.getElementById('tabs').onclick=e=>{if(e.target.dataset.v){cur=e.target.dataset.v;render();scrollTo(0,0)}};
const A={
 addp(){const n=$('#pname').value.trim();if(!n)return;const p={id:uid(),name:n,consent:$('#pcons').value};S.people.push(p);audit('person.added',{id:p.id,consent:p.consent});if(p.consent!=='never')audit('consent.person',{id:p.id,to:p.consent})},
 delp(id){if(!confirm('Remove this person and their entries?'))return;S.people=S.people.filter(p=>p.id!==id);S.entries=S.entries.filter(e=>e.pid!==id);S.decisions=S.decisions.filter(d=>d.personId!==id);audit('person.removed',{id})},
 addent(id){const s={};PILLARS.forEach(([k])=>s[k]=+$(`#r-${id}-${k}`).value);const date=$(`#d-${id}`).value||today();S.entries.push({id:uid(),pid:id,date,ts:Date.now(),s});audit('entry.added',{person:id,date})},
 analyze(id){runRules(id);audit('analysis.on_demand',{person:id});cur='insights'},
 dismiss(id){const d=S.decisions.find(x=>x.id===id);if(d){d.status='dismissed';audit('override.dismiss',{id,rule:d.rule})}},
 stoptype(r){if(!S.suppressed.includes(r))S.suppressed.push(r);S.decisions.forEach(d=>{if(d.rule===r&&d.status==='active')d.status='stopped'});audit('override.stop_type',{rule:r})},
 unstop(r){S.suppressed=S.suppressed.filter(x=>x!==r);audit('override.resume_type',{rule:r})},
 export(){audit('data.export',{scope:'all'}).then(()=>dl('what-matters-export-'+today()+'.json',S))},
 delins(){if(!confirm('Delete all insights / decision records?'))return;const n=S.decisions.length;S.decisions=[];audit('data.delete_insights',{count:n})},
 delall(){if(!confirm('Delete EVERYTHING on this device, including the audit log?'))return;localStorage.removeItem(KEY);S=blank();audit('data.erase_all',{});cur='snapshot'},
 async verify(){const r=await verifyChain();$('#vres').textContent=r.ok?`✅ Chain intact (${r.n} records).`:`❌ Chain broken at #${r.at}.`},
 expaudit(){audit('audit.export',{}).then(()=>dl('what-matters-audit-'+today()+'.json',S.audit))}
};
const C={
 pc(el){const p=S.people.find(x=>x.id===el.dataset.id);audit('consent.person',{id:p.id,from:p.consent,to:el.value});p.consent=el.value;if(el.value==='never')S.decisions.forEach(d=>{if(d.personId===p.id&&d.status==='active')d.status='revoked'})},
 purp(el){const k=el.dataset.id,v=el.value;if(v==='off'){delete S.consent.purposes[k];if(k==='insights')S.decisions.forEach(d=>{if(d.status==='active')d.status='revoked'})}else S.consent.purposes[k]={since:Date.now(),dur:v,until:v==='24h'?Date.now()+DAY:v==='7d'?Date.now()+7*DAY:null};audit('consent.purpose',{purpose:k,to:v})},
 pf(el){S.consent.profilingFree=el.checked;audit('consent.profiling_free',{on:el.checked})},
 nh(el){S.notHelping=el.checked;audit('feedback.not_helping',{on:el.checked})}
};
$('#view').addEventListener('click',async e=>{const a=e.target.dataset&&e.target.dataset.a;if(a&&A[a]&&e.target.tagName==='BUTTON'){await A[a](e.target.dataset.id);save();if(a!=='verify')render()}});
$('#view').addEventListener('change',e=>{const a=e.target.dataset.a;if(a&&C[a]){C[a](e.target);save();render()}});
render();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
