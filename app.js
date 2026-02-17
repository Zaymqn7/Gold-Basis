// ============================================
// GOLD BASIS TERMINAL
// ============================================

const PYTH_XAU_USD_ID = "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";
const PYTH_LATEST_URL = "https://hermes.pyth.network/v2/updates/price/latest";
const BINANCE_BOOK_TICKER = "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=XAUUSDT";
const BINANCE_PREMIUM_INDEX = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XAUUSDT";
const BINANCE_SPOT_BOOK_TICKER = "https://api.binance.com/api/v3/ticker/bookTicker?symbol=USDCUSDT";
const HL_INFO = "https://api.hyperliquid.xyz/info";
const METEORA_POOL_ADDRESS = "3Vj8miZuTSdonf4W1xLdYFatrXLm38CShrCi7NbZS5Ah";
const METEORA_POOL_URL = `https://dlmm.datapi.meteora.ag/pools/${METEORA_POOL_ADDRESS}`;
const STALE_MS = 30_000;

// Safe DOM access
function $(id) { return document.getElementById(id); }
function setText(id, t) { const e = $(id); if (e) e.textContent = t; }

// Formatting
const fmtUsd = (x, dp=2) => !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("en-US", {minimumFractionDigits:dp, maximumFractionDigits:dp});
const fmtNum = (x, dp=2) => !Number.isFinite(x) ? "—" : x.toLocaleString("en-US", {minimumFractionDigits:dp, maximumFractionDigits:dp});
const fmtBps = (x) => !Number.isFinite(x) ? "—" : (x>0?"+":"") + fmtNum(x,2);
const fmtPct = (x, dp=2) => !Number.isFinite(x) ? "—" : (x>0?"+":"") + fmtNum(x,dp) + "%";
const ageText = (ms) => !ms ? "—" : Math.max(0, Math.floor((Date.now()-ms)/1000)) + "s";
const timeLabel = (ms) => new Date(ms).toLocaleTimeString("en-US", {hour12:false});
const utcTime = () => { const d=new Date(); return d.toUTCString().slice(-12,-4); };

// Calculations
const basisUsd = (px, ref) => (!Number.isFinite(px)||!Number.isFinite(ref)||ref===0) ? null : px-ref;
const basisBps = (px, ref) => (!Number.isFinite(px)||!Number.isFinite(ref)||ref===0) ? null : ((px/ref)-1)*10000;
const fundingApy = (r) => !Number.isFinite(r) ? null : (Math.pow(1+r, 3*365)-1)*100;
const statusFromAge = (ms) => !ms ? "ERR" : (Date.now()-ms)>STALE_MS ? "STALE" : "OK";

// Meteora helpers
const inGoldRange = (x) => Number.isFinite(x) && x>100 && x<10000;
const isGold = (s) => String(s||"").toUpperCase().includes("GOLD") || String(s||"").toUpperCase().includes("XAU");
const isUsdc = (s) => String(s||"").toUpperCase().includes("USDC");

// Timed fetch
async function timed(fn) {
  const t0 = performance.now();
  try {
    const v = await fn();
    return { ok:true, v, ms:Math.round(performance.now()-t0), err:"" };
  } catch(e) {
    return { ok:false, v:null, ms:Math.round(performance.now()-t0), err:String(e?.message||e) };
  }
}

// Fetchers
async function fetchPyth() {
  const res = await fetch(`${PYTH_LATEST_URL}?ids[]=${encodeURIComponent(PYTH_XAU_USD_ID)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const p = data?.parsed?.[0];
  if (!p?.price) throw new Error("Bad response");
  const price = Number(p.price.price) * Math.pow(10, Number(p.price.expo));
  if (!Number.isFinite(price)) throw new Error("Not finite");
  return { price, publishTimeMs: Number(p.price.publish_time)*1000 };
}

async function fetchBinanceFut() {
  const [bRes, pRes] = await Promise.all([fetch(BINANCE_BOOK_TICKER), fetch(BINANCE_PREMIUM_INDEX)]);
  if (!bRes.ok || !pRes.ok) throw new Error("HTTP error");
  const [book, prem] = await Promise.all([bRes.json(), pRes.json()]);
  const mid = (Number(book.bidPrice)+Number(book.askPrice))/2;
  if (!Number.isFinite(mid)) throw new Error("Mid not finite");
  return { mid, lastFundingRate: Number(prem.lastFundingRate), nextFundingTimeMs: Number(prem.nextFundingTime) };
}

async function fetchBinanceSpot() {
  const res = await fetch(BINANCE_SPOT_BOOK_TICKER);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const mid = (Number(j.bidPrice)+Number(j.askPrice))/2;
  if (!Number.isFinite(mid)||mid<=0) throw new Error("Mid not finite");
  return { mid };
}

async function fetchHL() {
  const dRes = await fetch(HL_INFO, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({type:"perpDexs"})});
  if (!dRes.ok) throw new Error("perpDexs error");
  const dexs = await dRes.json();
  const dexName = (Array.isArray(dexs)?dexs:[]).find(d=>String(d?.name).toLowerCase()==="flx")?.name || "flx";
  const mRes = await fetch(HL_INFO, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({type:"allMids",dex:dexName})});
  if (!mRes.ok) throw new Error("allMids error");
  const mids = await mRes.json();
  let px = mids?.["GOLD"] ?? mids?.["flx:GOLD"] ?? mids?.["GOLD-USDC"];
  if (px==null && mids) { const k=Object.keys(mids).find(k=>k.toUpperCase().includes("GOLD")); if(k) px=mids[k]; }
  const mid = Number(px);
  if (!Number.isFinite(mid)) throw new Error("Mid not finite");
  return { mid };
}

async function fetchMeteora() {
  const res = await fetch(METEORA_POOL_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const p = Number(j?.current_price);
  if (!Number.isFinite(p)||p<=0) throw new Error("current_price missing");
  const inv = 1/p;
  let mid = p;
  if (inGoldRange(p) && !inGoldRange(inv)) mid = p;
  else if (!inGoldRange(p) && inGoldRange(inv)) mid = inv;
  else if (isGold(j?.token_x?.symbol) && isUsdc(j?.token_y?.symbol)) mid = p;
  else if (isUsdc(j?.token_x?.symbol) && isGold(j?.token_y?.symbol)) mid = inv;
  if (!Number.isFinite(mid)) throw new Error("Mid not finite");
  return { mid };
}

// State
const state = {
  paused: false, refreshMs: 5000, windowMs: 3600000, unit: "usd", lastTickMs: 0,
  pyth: {price:NaN, publishTimeMs:0, lastOkMs:0, lastLatMs:0, err:""},
  binF: {mid:NaN, lastFundingRate:NaN, nextFundingTimeMs:0, lastOkMs:0, lastLatMs:0, err:""},
  binS: {mid:NaN, lastOkMs:0, lastLatMs:0, err:""},
  hl: {mid:NaN, lastOkMs:0, lastLatMs:0, err:""},
  met: {mid:NaN, lastOkMs:0, lastLatMs:0, err:""},
  points: [], chartBasis:null, chartPyth:null, chartFunding:null, pollTimer:null, uiTimer:null
};

// UI Painting
function paintHeader() {
  setText("topTime", utcTime());
  setText("footerTime", utcTime() + " UTC");
  const px = state.pyth.price;
  setText("headerPrice", Number.isFinite(px) ? fmtUsd(px,2) : "-----.--");
  
  let chg=NaN, pct=NaN;
  if (state.points.length>=2) {
    const p1=state.points[state.points.length-1]?.pyth, p0=state.points[0]?.pyth;
    if (Number.isFinite(p1)&&Number.isFinite(p0)) { chg=p1-p0; pct=p0?chg/p0*100:NaN; }
  }
  const chgEl=$("headerChange"), pctEl=$("headerChangePct");
  if (chgEl) {
    chgEl.textContent = Number.isFinite(chg) ? (chg>0?"+":"")+fmtNum(chg,2) : "--.--";
    chgEl.className = "change " + (chg>0?"up":chg<0?"down":"");
  }
  if (pctEl) pctEl.textContent = Number.isFinite(pct) ? "("+fmtPct(pct,2)+")" : "(--.--%)";
}

function paintStatus() {
  const now = Date.now();
  const pOk = state.pyth.lastOkMs && (now-state.pyth.lastOkMs)<=STALE_MS;
  const dot=$("statusDot"), txt=$("statusText");
  if (dot) { dot.className = "status-dot " + (state.paused?"warn":pOk?"ok":"err"); }
  if (txt) { txt.textContent = state.paused?"PAUSED":pOk?"LIVE":"ERROR"; }
  setText("globalUpdated", state.lastTickMs ? ageText(state.lastTickMs)+" ago" : "--");
}

function paintError() {
  const errs = [state.pyth.err, state.binF.err, state.binS.err, state.hl.err, state.met.err].filter(Boolean);
  setText("globalError", errs.join(" • "));
}

function setValClass(id, val) {
  const el = $(id);
  if (!el) return;
  el.classList.remove("v-pos","v-neg");
  if (Number.isFinite(val)) el.classList.add(val>0?"v-pos":"v-neg");
}

function paintSnapshot() {
  const ref = state.pyth.price;
  setText("refPyth", fmtUsd(ref,2));
  setText("refPythTime", state.pyth.publishTimeMs ? new Date(state.pyth.publishTimeMs).toLocaleString() : "—");

  // Binance
  const bU=basisUsd(state.binF.mid,ref), bB=basisBps(state.binF.mid,ref);
  setText("tblBinanceMid", fmtUsd(state.binF.mid,2));
  setText("tblBinanceBasisUsd", bU!=null?fmtUsd(bU,2):"—"); setValClass("tblBinanceBasisUsd",bU);
  setText("tblBinanceBasisBps", bB!=null?fmtBps(bB):"—"); setValClass("tblBinanceBasisBps",bB);
  setText("tblBinanceFunding", Number.isFinite(state.binF.lastFundingRate)?fmtPct(state.binF.lastFundingRate*100,4):"—");
  setText("tblBinanceNextFunding", state.binF.nextFundingTimeMs?new Date(state.binF.nextFundingTimeMs).toLocaleTimeString():"—");

  // HL
  const hU=basisUsd(state.hl.mid,ref), hB=basisBps(state.hl.mid,ref);
  setText("tblHLMid", fmtUsd(state.hl.mid,2));
  setText("tblHLBasisUsd", hU!=null?fmtUsd(hU,2):"—"); setValClass("tblHLBasisUsd",hU);
  setText("tblHLBasisBps", hB!=null?fmtBps(hB):"—"); setValClass("tblHLBasisBps",hB);

  // Meteora
  const mU=basisUsd(state.met.mid,ref), mB=basisBps(state.met.mid,ref);
  setText("tblMeteoraMid", fmtUsd(state.met.mid,2));
  setText("tblMeteoraBasisUsd", mU!=null?fmtUsd(mU,2):"—"); setValClass("tblMeteoraBasisUsd",mU);
  setText("tblMeteoraBasisBps", mB!=null?fmtBps(mB):"—"); setValClass("tblMeteoraBasisBps",mB);

  // Dislocations
  const dBu=(Number.isFinite(state.met.mid)&&Number.isFinite(state.binF.mid))?(state.met.mid-state.binF.mid):null;
  const dBb=(dBu!=null&&state.binF.mid)?((state.met.mid/state.binF.mid)-1)*10000:null;
  setText("disMetBinUsd", dBu!=null?fmtUsd(dBu,2):"—"); setValClass("disMetBinUsd",dBu);
  setText("disMetBinBps", dBb!=null?fmtBps(dBb):"—"); setValClass("disMetBinBps",dBb);

  const dHu=(Number.isFinite(state.met.mid)&&Number.isFinite(state.hl.mid))?(state.met.mid-state.hl.mid):null;
  const dHb=(dHu!=null&&state.hl.mid)?((state.met.mid/state.hl.mid)-1)*10000:null;
  setText("disMetHlUsd", dHu!=null?fmtUsd(dHu,2):"—"); setValClass("disMetHlUsd",dHu);
  setText("disMetHlBps", dHb!=null?fmtBps(dHb):"—"); setValClass("disMetHlBps",dHb);

  // Conversion
  setText("convXauUsdt", fmtUsd(state.binF.mid,2));
  setText("convUsdcUsdt", fmtNum(state.binS.mid,6));
  const implied = (Number.isFinite(state.binF.mid)&&Number.isFinite(state.binS.mid)&&state.binS.mid>0) ? state.binF.mid/state.binS.mid : NaN;
  setText("convXauUsdc", fmtUsd(implied,2));
}

function paintDiagRow(pre, feed) {
  const st = feed.err ? "ERR" : statusFromAge(feed.lastOkMs);
  const el = $(pre+"Status");
  if (el) {
    el.textContent = st;
    el.className = st==="OK"?"st-ok":st==="STALE"?"st-warn":"st-err";
  }
  setText(pre+"Age", feed.lastOkMs ? ageText(feed.lastOkMs) : "—");
  setText(pre+"Lat", feed.lastLatMs ? feed.lastLatMs+"ms" : "—");
  setText(pre+"Err", feed.err ? feed.err.slice(0,80) : "—");
}

function paintDiag() {
  paintDiagRow("diagPyth", state.pyth);
  paintDiagRow("diagBinF", state.binF);
  paintDiagRow("diagBinS", state.binS);
  paintDiagRow("diagHl", state.hl);
  paintDiagRow("diagMet", state.met);
}

// Charts
function buildCharts() {
  if (typeof Chart === "undefined") return;

  const gridColor = "rgba(30,30,30,1)";
  const tickColor = "#555";
  const defaults = {
    responsive:true, maintainAspectRatio:false, animation:false,
    plugins:{legend:{display:false}},
    scales:{
      x:{ticks:{color:tickColor,maxRotation:0,autoSkip:true,maxTicksLimit:8,font:{size:9}},grid:{color:gridColor}},
      y:{ticks:{color:tickColor,font:{size:9}},grid:{color:gridColor}}
    }
  };

  const basisCtx = $("basisChart")?.getContext("2d");
  if (basisCtx) {
    state.chartBasis = new Chart(basisCtx, {
      type:"line",
      data:{labels:[],datasets:[
        {label:"BINANCE",data:[],borderWidth:1.5,pointRadius:0,tension:0.2,borderColor:"#ff8c00"},
        {label:"HYPERLIQUID",data:[],borderWidth:1.5,pointRadius:0,tension:0.2,borderColor:"#00aa00"},
        {label:"METEORA",data:[],borderWidth:1.5,pointRadius:0,tension:0.2,borderColor:"#aa00aa"}
      ]},
      options:{...defaults}
    });
  }

  const pythCtx = $("pythChart")?.getContext("2d");
  if (pythCtx) {
    state.chartPyth = new Chart(pythCtx, {
      type:"line",
      data:{labels:[],datasets:[
        {label:"PYTH",data:[],borderWidth:1.5,pointRadius:0,tension:0.2,borderColor:"#ff8c00"}
      ]},
      options:{...defaults}
    });
  }

  const fundCtx = $("fundingChart")?.getContext("2d");
  if (fundCtx) {
    state.chartFunding = new Chart(fundCtx, {
      type:"line",
      data:{labels:[],datasets:[
        {label:"APY",data:[],borderWidth:1.5,pointRadius:0,tension:0.2,borderColor:"#00aaaa"}
      ]},
      options:{...defaults,scales:{...defaults.scales,y:{...defaults.scales.y,ticks:{...defaults.scales.y.ticks,callback:v=>v+"%"}}}}
    });
  }
}

function prunePoints() {
  const cutoff = Date.now() - state.windowMs;
  state.points = state.points.filter(p => p.t >= cutoff);
}

function syncCharts() {
  prunePoints();
  const labels = state.points.map(p => timeLabel(p.t));

  if (state.chartBasis) {
    state.chartBasis.data.labels = labels;
    state.chartBasis.data.datasets[0].data = state.points.map(p => state.unit==="usd"?p.binUsd:p.binBps);
    state.chartBasis.data.datasets[1].data = state.points.map(p => state.unit==="usd"?p.hlUsd:p.hlBps);
    state.chartBasis.data.datasets[2].data = state.points.map(p => state.unit==="usd"?p.metUsd:p.metBps);
    state.chartBasis.update("none");
  }

  if (state.chartPyth) {
    state.chartPyth.data.labels = labels;
    state.chartPyth.data.datasets[0].data = state.points.map(p => p.pyth);
    state.chartPyth.update("none");
  }

  if (state.chartFunding) {
    state.chartFunding.data.labels = labels;
    state.chartFunding.data.datasets[0].data = state.points.map(p => p.apyPct);
    state.chartFunding.update("none");
  }
}

// Main tick
async function tick() {
  if (state.paused) return;
  const started = Date.now();
  state.lastTickMs = started;

  const [p,bf,bs,hl,met] = await Promise.all([timed(fetchPyth),timed(fetchBinanceFut),timed(fetchBinanceSpot),timed(fetchHL),timed(fetchMeteora)]);

  if (p.ok) { state.pyth.price=p.v.price; state.pyth.publishTimeMs=p.v.publishTimeMs; state.pyth.lastOkMs=started; state.pyth.err=""; }
  else state.pyth.err="PYTH: "+p.err;
  state.pyth.lastLatMs=p.ms;

  if (bf.ok) { state.binF.mid=bf.v.mid; state.binF.lastFundingRate=bf.v.lastFundingRate; state.binF.nextFundingTimeMs=bf.v.nextFundingTimeMs; state.binF.lastOkMs=started; state.binF.err=""; }
  else state.binF.err="BINANCE FUT: "+bf.err;
  state.binF.lastLatMs=bf.ms;

  if (bs.ok) { state.binS.mid=bs.v.mid; state.binS.lastOkMs=started; state.binS.err=""; }
  else state.binS.err="BINANCE SPOT: "+bs.err;
  state.binS.lastLatMs=bs.ms;

  if (hl.ok) { state.hl.mid=hl.v.mid; state.hl.lastOkMs=started; state.hl.err=""; }
  else state.hl.err="HL: "+hl.err;
  state.hl.lastLatMs=hl.ms;

  if (met.ok) { state.met.mid=met.v.mid; state.met.lastOkMs=started; state.met.err=""; }
  else state.met.err="METEORA: "+met.err;
  state.met.lastLatMs=met.ms;

  const ref = state.pyth.price;
  state.points.push({
    t:started, pyth:Number.isFinite(ref)?ref:null,
    binUsd:basisUsd(state.binF.mid,ref), binBps:basisBps(state.binF.mid,ref),
    hlUsd:basisUsd(state.hl.mid,ref), hlBps:basisBps(state.hl.mid,ref),
    metUsd:basisUsd(state.met.mid,ref), metBps:basisBps(state.met.mid,ref),
    apyPct:fundingApy(state.binF.lastFundingRate)
  });

  paintError(); paintStatus(); paintHeader(); paintSnapshot(); paintDiag(); syncCharts();
}

function startPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(tick, state.refreshMs);
}

function startUi() {
  if (state.uiTimer) clearInterval(state.uiTimer);
  state.uiTimer = setInterval(() => { paintHeader(); paintStatus(); paintDiag(); }, 1000);
}

function wire() {
  $("refreshSelect")?.addEventListener("change", e => { state.refreshMs=Number(e.target.value); startPoll(); });
  $("windowSelect")?.addEventListener("change", e => { state.windowMs=Number(e.target.value); prunePoints(); syncCharts(); });
  
  $("unitUsdBtn")?.addEventListener("click", () => {
    state.unit="usd";
    $("unitUsdBtn")?.classList.add("active");
    $("unitBpsBtn")?.classList.remove("active");
    syncCharts();
  });
  
  $("unitBpsBtn")?.addEventListener("click", () => {
    state.unit="bps";
    $("unitBpsBtn")?.classList.add("active");
    $("unitUsdBtn")?.classList.remove("active");
    syncCharts();
  });
  
  $("pauseBtn")?.addEventListener("click", () => {
    state.paused=true;
    $("pauseBtn").disabled=true;
    $("resumeBtn").disabled=false;
    paintStatus();
  });
  
  $("resumeBtn")?.addEventListener("click", () => {
    state.paused=false;
    $("pauseBtn").disabled=false;
    $("resumeBtn").disabled=true;
    tick();
    paintStatus();
  });
}

// Boot
(function init() {
  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

function boot() {
  wire();
  buildCharts();
  paintHeader();
  paintStatus();
  tick();
  startPoll();
  startUi();
}
