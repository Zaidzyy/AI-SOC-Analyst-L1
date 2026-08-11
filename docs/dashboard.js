/* AI SOC Analyst L1 — dashboard. Zero dependencies; charts are hand-rolled SVG. */
(function () {
"use strict";
const CFG = window.SOC_CONFIG || {};
const API = CFG.SUPABASE_URL + "/rest/v1/incidents";
const HDR = { apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY };
const SEV = { CRITICAL:"#e5484d", HIGH:"#f76b15", MEDIUM:"#f5d90a", LOW:"#46a758", UNKNOWN:"#46566a" };
const $ = s => document.querySelector(s);

let ALL = [], filters = { q:"", status:"", level:"" }, lastSeen = null;

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const clr = lv => SEV[lv] || SEV.UNKNOWN;
function ago(iso){
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s/60) + "m ago";
  if (s < 86400) return Math.floor(s/3600) + "h ago";
  return Math.floor(s/86400) + "d ago";
}
function dur(ms){
  if (!isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms/1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s/60);
  return m < 60 ? m + "m " + (s%60) + "s" : Math.floor(m/60) + "h " + (m%60) + "m";
}
function mitre(v){
  if (!v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : [p]; }
  catch { return String(v).split(",").map(x=>x.trim()).filter(Boolean); }
}

/* ---------- KPIs ---------- */
function kpis(rows){
  const day = Date.now() - 864e5;
  const d24 = rows.filter(r => new Date(r.created_at) > day).length;
  const open = rows.filter(r => r.status !== "closed").length;
  const blocked = rows.filter(r => (r.actions_taken||[]).some(a => a.action === "ufw_block")).length;
  const avg = rows.length ? rows.reduce((s,r)=>s+(+r.combined_threat_score||0),0)/rows.length : 0;
  const triaged = rows.filter(r => r.analyst_verdict);
  const fp = triaged.filter(r => r.analyst_verdict === "false_positive").length;
  const fpRate = triaged.length ? (fp/triaged.length*100) : null;
  const times = rows.filter(r => r.triaged_at).map(r => new Date(r.triaged_at) - new Date(r.created_at)).filter(x=>x>0);
  const mttr = times.length ? times.reduce((a,b)=>a+b,0)/times.length : NaN;

  const K = [
    ["Incidents", rows.length, d24 + " in last 24h", "#e6edf3"],
    ["Open", open, (rows.length-open) + " closed", open ? "#f76b15" : "#46a758"],
    ["Auto-blocked", blocked, "firewall rules written", "#e5484d"],
    ["Avg score", avg.toFixed(1), "combined 0–100", avg>=70?"#e5484d":avg>=40?"#f76b15":"#46a758"],
    ["False positive", fpRate==null?"—":fpRate.toFixed(0)+"%", triaged.length + " triaged by analyst", "#b9c3cc"],
    ["Mean to triage", dur(mttr), times.length + " measured", "#b9c3cc"]
  ];
  $("#kpis").innerHTML = K.map(([l,v,s,c]) =>
    `<div class="kpi"><div class="kl">${l}</div><div class="kv" style="color:${c}">${v}</div><div class="ks">${s}</div></div>`).join("");
}

/* ---------- charts (hand-rolled SVG, no library) ---------- */
function volume(rows){
  const now = Date.now();
  const b = Array.from({length:24}, (_,i) => {
    const h = 23-i, s0 = now-(h+1)*36e5, s1 = now-h*36e5;
    return { h:new Date(s1).getHours(),
      n:rows.filter(r=>{const t=+new Date(r.created_at);return t>=s0&&t<s1;}).length };
  });
  const max = Math.max(1, ...b.map(x=>x.n)), W=560, H=140, P=4;
  const x = i => P + i*(W-2*P)/23, y = v => H-14-(v/max)*(H-26);
  const pts = b.map((d,i)=>`${x(i)},${y(d.n)}`).join(" ");
  $("#vtot").textContent = b.reduce((s,d)=>s+d.n,0) + " incidents";
  $("#vol").innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
    <defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b9c3cc" stop-opacity=".32"/><stop offset="100%" stop-color="#b9c3cc" stop-opacity="0"/>
    </linearGradient></defs>
    ${[0,.5,1].map(f=>`<line x1="${P}" y1="${y(max*f)}" x2="${W-P}" y2="${y(max*f)}" stroke="#161c22"/>`).join("")}
    <polygon points="${P},${H-14} ${pts} ${W-P},${H-14}" fill="url(#vg)"/>
    <polyline points="${pts}" fill="none" stroke="#cfd8e3" stroke-width="1.6" stroke-linejoin="round"/>
    ${b.map((d,i)=>d.n?`<circle cx="${x(i)}" cy="${y(d.n)}" r="2" fill="#e6edf3"/>`:"").join("")}
    ${b.filter((_,i)=>i%6===0).map((d,i)=>`<text x="${x(i*6)}" y="${H-2}" fill="#46566a" font-size="8" text-anchor="middle">${String(d.h).padStart(2,"0")}:00</text>`).join("")}
  </svg>`;
}

function donut(rows){
  const order=["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
  const data=order.map(k=>({k,n:rows.filter(r=>(r.threat_level||"UNKNOWN")===k).length})).filter(d=>d.n);
  const tot=data.reduce((s,d)=>s+d.n,0)||1;
  let a=-Math.PI/2, R=46, r=30, C=60;
  const arcs=data.map(d=>{
    const sw=d.n/tot*Math.PI*2, e=a+sw, big=sw>Math.PI?1:0;
    const p=`M${C+R*Math.cos(a)},${C+R*Math.sin(a)} A${R},${R} 0 ${big} 1 ${C+R*Math.cos(e)},${C+R*Math.sin(e)}
             L${C+r*Math.cos(e)},${C+r*Math.sin(e)} A${r},${r} 0 ${big} 0 ${C+r*Math.cos(a)},${C+r*Math.sin(a)} Z`;
    a=e; return `<path d="${p}" fill="${clr(d.k)}"/>`;
  }).join("");
  $("#donut").innerHTML=`<div style="display:flex;align-items:center;gap:12px">
    <svg viewBox="0 0 120 120" style="width:112px;flex-shrink:0">${arcs}
      <text x="60" y="58" fill="#e6edf3" font-size="21" font-weight="800" text-anchor="middle">${tot}</text>
      <text x="60" y="72" fill="#46566a" font-size="8" text-anchor="middle" letter-spacing="1">TOTAL</text></svg>
    <div class="lg" style="flex:1">${data.map(d=>
      `<div class="lgi"><i style="background:${clr(d.k)}"></i><span>${d.k}</span><b>${d.n}</b></div>`).join("")}</div></div>`;
}

function topIps(rows){
  const m=new Map();
  rows.forEach(r=>{ if(r.source_ip) m.set(r.source_ip,(m.get(r.source_ip)||0)+1); });
  const d=[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max=d[0]?.[1]||1;
  $("#tops").innerHTML = d.length ? d.map(([ip,n])=>
    `<div><div class="lgi"><span class="mono" style="font-size:10.5px;color:#b9c3cc">${esc(ip)}</span>
     <span></span><b>${n}</b></div><div class="bar"><i style="width:${n/max*100}%"></i></div></div>`).join("")
    : `<div style="font-size:11px;color:#5b6b7a">No data</div>`;
}

/* ---------- table ---------- */
function visible(){
  const q=filters.q.toLowerCase();
  return ALL.filter(r=>{
    if(filters.status && r.status!==filters.status) return false;
    if(filters.level && (r.threat_level||"UNKNOWN")!==filters.level) return false;
    if(!q) return true;
    return [r.source_ip,r.agent_name,r.rule_id,r.rule_description,r.ai_mitre]
      .some(v=>String(v??"").toLowerCase().includes(q));
  });
}
const VC={true_positive:["#e5484d","true positive"],false_positive:["#46a758","false positive"],
          needs_review:["#f5d90a","needs review"]};
function row(r,isNew){
  const lv=r.threat_level||"UNKNOWN", c=clr(lv);
  const v=VC[r.ai_verdict]||["#5b6b7a","—"];
  const stc={new:"#f76b15",investigating:"#f5d90a",closed:"#46a758"}[r.status]||"#5b6b7a";
  return `<tr data-id="${r.id}" class="${isNew?"new":""}">
    <td class="mono" style="color:#5b6b7a;white-space:nowrap">${ago(r.created_at)}</td>
    <td class="mono">${esc(r.source_ip||"—")}</td>
    <td style="color:#b9c3cc">${esc(r.agent_name||"—")}</td>
    <td class="trunc" title="${esc(r.rule_description||"")}">${esc(r.rule_description||"—")}</td>
    <td><span class="chip" style="background:${c}22;color:${c}">${lv}</span></td>
    <td class="mono" style="color:${c};font-weight:800">${Math.round(r.combined_threat_score||0)}</td>
    <td><span class="chip" style="background:${v[0]}1a;color:${v[0]}">${v[1]}</span></td>
    <td><span class="chip" style="background:${stc}1a;color:${stc}">${r.status}</span></td></tr>`;
}
function draw(newIds){
  const rows=visible();
  $("#count").textContent=`${rows.length} of ${ALL.length}`;
  $("#tbody").innerHTML = rows.length
    ? rows.map(r=>row(r,newIds&&newIds.has(r.id))).join("")
    : `<tr><td colspan="8" class="empty">No incidents match these filters.</td></tr>`;
  $("#tbody").querySelectorAll("tr[data-id]").forEach(tr=>
    tr.addEventListener("click",()=>openDrawer(tr.dataset.id)));
}
function refresh(newIds){ kpis(ALL); volume(ALL); donut(ALL); topIps(ALL); draw(newIds); }

/* ---------- drawer ---------- */
const TS={ok:["#46a758","completed"],fail:["#e5484d","failed"],skip:["#8b98a5","skipped"],
          warn:["#f5d90a","attention"],idle:["#232b34","not run"]};
function stages(r){
  const A=r.actions_taken||[], f=p=>A.find(a=>(a.action||"").startsWith(p));
  const dd=f("deduplicated"), it=f("threat_intel_enriched"), lg=f("logs_retrieved"),
        bk=A.find(a=>(a.action||"").startsWith("ufw_block")||(a.action||"").startsWith("block_skipped")),
        rp=f("ai_report_generated");
  // Detail text must never contradict the state: if an action exists but carries
  // no `detail`, describe what its result actually means rather than falling
  // through to the "didn't happen" copy.
  const det = (a, ok, fail, missing) =>
    a ? (a.detail || (a.result === "success" ? ok : fail)) : missing;

  return [
    ["Alert ingested","ok",`Wazuh rule ${r.rule_id||"—"} · level ${r.rule_level??"—"}`],
    ["Validated & sanitized",r.source_ip?"ok":"warn",r.source_ip?`Source IP ${r.source_ip} passed validation`:"No source IP in alert"],
    ["Deduplication",dd?"warn":"ok",dd?(dd.detail||"Repeat occurrence — suppressed"):"First occurrence in window"],
    ["Threat intelligence",it?"ok":"idle",
      det(it, `VT ${r.vt_malicious||0} malicious · AbuseIPDB ${r.abuseipdb_score||0}%`,
              "Enrichment failed — score may be incomplete",
              `VT ${r.vt_malicious||0} malicious · AbuseIPDB ${r.abuseipdb_score||0}%`)],
    ["Endpoint log collection",lg?(lg.result==="success"?"ok":"fail"):"idle",
      det(lg, r.retrieved_logs ? `${r.retrieved_logs.length} chars retrieved` : "Logs retrieved",
              "No usable log output returned",
              "Not attempted")],
    ["AI analysis",rp?"ok":"idle",
      det(rp, r.ai_report_full ? `Report generated · ${r.ai_report_full.length} chars` : "Report generated",
              "Report generation failed",
              "No report generated")],
    ["Triage verdict",r.ai_verdict==="needs_review"?"warn":r.ai_verdict?"ok":"idle",
      r.ai_verdict?`${r.ai_verdict.replace("_"," ")} · ${r.ai_confidence??0}% confidence`:"No verdict"],
    ["Automated response",!bk?"idle":bk.action==="ufw_block"?(bk.result==="success"?"ok":"fail"):"skip",
      bk ? (bk.detail || (bk.action==="ufw_block"
              ? (bk.result==="success" ? `Firewall rule written for ${r.source_ip||"source"}`
                                       : "Block attempted but failed")
              : "Block skipped by a safeguard"))
         : "No response action recorded"],
    ["Analyst review",r.analyst_verdict?"ok":"idle",
      r.analyst_verdict?`${r.analyst_verdict.replace("_"," ")} confirmed by analyst`:"Awaiting human confirmation"]
  ];
}
function openDrawer(id){
  const r=ALL.find(x=>x.id===id); if(!r) return;
  const lv=r.threat_level||"UNKNOWN", c=clr(lv), sc=Math.round(r.combined_threat_score||0);
  const circ=2*Math.PI*24, off=circ*(1-Math.min(sc,100)/100);
  const tac=mitre(r.mitre_tactic), tec=mitre(r.mitre_technique);

  $("#drawer").innerHTML=`
  <div class="dh">
    <div style="display:flex;gap:14px;align-items:center;min-width:0">
      <svg class="ring" viewBox="0 0 58 58"><circle cx="29" cy="29" r="24" fill="none" stroke="#161c22" stroke-width="5"/>
        <circle cx="29" cy="29" r="24" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"
          stroke-dasharray="${circ}" stroke-dashoffset="${off}" transform="rotate(-90 29 29)"/>
        <text x="29" y="34" fill="${c}" font-size="16" font-weight="800" text-anchor="middle">${sc}</text></svg>
      <div style="min-width:0">
        <div class="mono" style="font-size:16px;font-weight:800">${esc(r.source_ip||"no source IP")}</div>
        <div style="font-size:11px;color:#5b6b7a;margin-top:3px">
          ${esc(r.country||"Unknown")} · ${ago(r.created_at)} ·
          <span class="chip" style="background:${c}22;color:${c}">${lv}</span></div>
      </div>
    </div>
    <button class="x" id="close">×</button>
  </div>
  <div class="dc">
    ${r.ai_verdict==="needs_review"?`<div class="banner">The model returned <b>needs review</b> — it could not decide from the evidence available. A human verdict is required.</div>`:""}
    <div class="tiles">
      <div class="tile"><div class="tv">${r.vt_malicious||0}</div><div class="tl">VT malicious</div></div>
      <div class="tile"><div class="tv">${r.abuseipdb_score||0}%</div><div class="tl">AbuseIPDB</div></div>
      <div class="tile"><div class="tv">${r.abuseipdb_reports||0}</div><div class="tl">reports</div></div>
      <div class="tile"><div class="tv" style="color:${c}">${sc}</div><div class="tl">combined</div></div>
    </div>
    <h5>Alert</h5>
    <table class="facts">
      <tr><td>Rule</td><td>${esc(r.rule_description||"—")}</td></tr>
      <tr><td>Rule ID / level</td><td class="mono">${esc(r.rule_id||"—")} · ${r.rule_level??"—"}</td></tr>
      <tr><td>Agent</td><td class="mono">${esc(r.agent_name||"—")} (${esc(r.agent_ip||"—")}, ${esc(r.agent_os||"—")})</td></tr>
      <tr><td>Detected</td><td>${new Date(r.created_at).toLocaleString()}</td></tr>
    </table>
    ${(tac.length||tec.length||r.ai_mitre)?`<h5>MITRE ATT&CK</h5><div style="margin-bottom:16px">
      ${tac.map(t=>`<span class="mchip">${esc(t)}</span>`).join("")}
      ${tec.map(t=>`<span class="mchip">${esc(t)}</span>`).join("")}
      ${r.ai_mitre&&r.ai_mitre!=="none"?`<span class="mchip" style="border-color:#46566a;color:#e6edf3">${esc(r.ai_mitre)}</span>`:""}
    </div>`:""}
    <h5>AI incident report</h5>
    <div class="report">${esc(r.ai_report_full||r.ai_report_summary||"No report generated.")}</div>
    <h5>Pipeline trace</h5>
    <ol class="trace">${stages(r).map((s,i,a)=>{const[col,lb]=TS[s[1]];
      return `<li>${i<a.length-1?'<span class="tline"></span>':""}
        <span class="tdot"><i style="background:${col}"></i></span>
        <div class="trow"><span class="tnm">${s[0]}</span><span class="tst" style="color:${col}">${lb}</span></div>
        <div class="tdt">${esc(s[2])}</div></li>`;}).join("")}</ol>
    ${r.retrieved_logs?`<h5>Endpoint logs</h5><div class="logs">${esc(r.retrieved_logs)}</div>`:""}
    <div class="ctrl">
      <h4>Analyst verdict</h4>
      <div class="vrow">
        <button class="vb tp ${r.analyst_verdict==="true_positive"?"on":""}" data-v="true_positive">Confirm true positive</button>
        <button class="vb fp ${r.analyst_verdict==="false_positive"?"on":""}" data-v="false_positive">Mark false positive</button>
      </div>
      <select class="sel" id="st">
        ${["new","investigating","closed"].map(s=>`<option value="${s}" ${r.status===s?"selected":""}>${s}</option>`).join("")}
      </select>
      <textarea id="notes" placeholder="Analyst notes…">${esc(r.analyst_notes||"")}</textarea>
      <div class="saved" id="saved">saved</div>
    </div>
  </div>`;

  $("#scrim").classList.add("on"); $("#drawer").classList.add("on");
  $("#drawer").setAttribute("aria-hidden","false");
  $("#close").onclick = closeDrawer;
  $("#drawer").querySelectorAll(".vb").forEach(b => b.onclick = () => {
    const v = b.dataset.v === r.analyst_verdict ? null : b.dataset.v;
    save(r, { analyst_verdict: v });
    $("#drawer").querySelectorAll(".vb").forEach(x => x.classList.toggle("on", x.dataset.v === v));
  });
  $("#st").onchange = e => save(r, { status: e.target.value });
  $("#notes").onblur = e => save(r, { analyst_notes: e.target.value });
}
function closeDrawer(){
  $("#scrim").classList.remove("on"); $("#drawer").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden","true");
}
$("#scrim").onclick = closeDrawer;
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

async function save(r, patch){
  Object.assign(r, patch);
  if (patch.analyst_verdict && !r.triaged_at) r.triaged_at = new Date().toISOString();
  refresh();
  try{
    const res = await fetch(`${API}?id=eq.${r.id}`, {
      method:"PATCH",
      headers:{ ...HDR, "Content-Type":"application/json", Prefer:"return=minimal" },
      body: JSON.stringify(patch)
    });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const s = $("#saved"); if(s){ s.classList.add("on"); setTimeout(()=>s.classList.remove("on"), 1400); }
  }catch(err){
    console.error("[soc] save failed:", err.message);
    const s = $("#saved");
    if(s){ s.textContent = "save failed — " + err.message; s.style.color = "#e5484d"; s.classList.add("on"); }
  }
}

/* ---------- data ---------- */
const SELECT = "id,created_at,alert_timestamp,agent_name,agent_ip,agent_os,source_ip,rule_id,rule_level," +
  "rule_description,mitre_tactic,mitre_technique,country,vt_malicious,vt_suspicious,abuseipdb_score," +
  "abuseipdb_reports,combined_threat_score,threat_level,ai_report_summary,ai_report_full,retrieved_logs," +
  "ai_verdict,ai_confidence,ai_severity,ai_mitre,ai_recommended_action,actions_taken,status," +
  "analyst_verdict,analyst_notes,triaged_at";

async function load(){
  try{
    const r = await fetch(`${API}?select=${SELECT}&order=created_at.desc&limit=400`, { headers: HDR });
    if(!r.ok) throw new Error("HTTP " + r.status + " — check the publishable key and RLS select policy");
    ALL = await r.json();
    lastSeen = ALL[0]?.created_at || null;
    $("#livet").textContent = "live";
    refresh();
    poll();
  }catch(err){
    $("#dot").style.background = "#e5484d";
    $("#livet").textContent = "offline";
    $("#banner").innerHTML = `<div class="banner" style="background:rgba(229,72,77,.08);border-color:rgba(229,72,77,.3);color:#e08a8d">
      <b>Could not reach Supabase.</b> ${esc(err.message)}</div>`;
    $("#tbody").innerHTML = `<tr><td colspan="8" class="empty">No data.</td></tr>`;
    console.error("[soc]", err);
  }
}
function poll(){
  setInterval(async () => {
    if(!lastSeen) return;
    try{
      const r = await fetch(`${API}?select=${SELECT}&order=created_at.desc&limit=20&created_at=gt.${encodeURIComponent(lastSeen)}`, { headers: HDR });
      if(!r.ok) return;
      const fresh = await r.json();
      if(!fresh.length) return;
      lastSeen = fresh[0].created_at;
      const ids = new Set(fresh.map(x => x.id));
      ALL = [...fresh, ...ALL];
      refresh(ids);
    }catch(e){ /* transient */ }
  }, 10000);
}

/* ---------- filters ---------- */
$("#q").addEventListener("input", e => { filters.q = e.target.value; draw(); });
["#fstatus","#flevel"].forEach((sel,i) => {
  $(sel).querySelectorAll("button").forEach(b => b.onclick = () => {
    $(sel).querySelectorAll("button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    filters[i ? "level" : "status"] = b.dataset.v;
    draw();
  });
});

load();
})();
