// GOLD BASIS TERMINAL — Bloomberg-inspired layout
// Feeds: Pyth XAU/USD, Binance XAUUSDT perp (mid + funding), Binance spot USDCUSDT (mid),
//        Hyperliquid GOLD-USDC (flx dex), Meteora DLMM pool.
// Adds: venue-vs-venue dislocations (Meteora vs Binance/HL), Pyth spot chart, Funding APY chart, network diagnostics.

const PYTH_XAU_USD_ID =
  "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";
const PYTH_LATEST_URL = "https://hermes.pyth.network/v2/updates/price/latest";

const BINANCE_BOOK_TICKER =
  "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=XAUUSDT";
const BINANCE_PREMIUM_INDEX =
  "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XAUUSDT";

const BINANCE_SPOT_BOOK_TICKER =
  "https://api.binance.com/api/v3/ticker/bookTicker?symbol=USDCUSDT";

const HL_INFO = "https://api.hyperliquid.xyz/info";

const METEORA_POOL_ADDRESS = "3Vj8miZuTSdonf4W1xLdYFatrXLm38CShrCi7NbZS5Ah";
const METEORA_POOL_URL = `https://dlmm.datapi.meteora.ag/pools/${METEORA_POOL_ADDRESS}`;

const STALE_MS = 30_000;

function $(id){ return document.getElementById(id); }
function nowMs(){ return Date.now(); }

function fmtUsd(x, dp=2){
  if (!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat(undefined, {
    style:"currency", currency:"USD",
    maximumFractionDigits:dp, minimumFractionDigits:dp
  }).format(x);
}
function fmtNum(x, dp=2){
  if (!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits:dp, minimumFractionDigits:dp
  }).format(x);
}
function fmtBps(x){
  if (!Number.isFinite(x)) return "—";
  const s = x > 0 ? "+" : "";
  return `${s}${fmtNum(x, 2)}`;
}
function fmtPct(x, dp=2){
  if (!Number.isFinite(x)) return "—";
  const s = x > 0 ? "+" : "";
  return `${s}${fmtNum(x, dp)}%`;
}
function ageText(ms){
  if (!ms) return "—";
  const s = Math.max(0, Math.floor((nowMs() - ms)/1000));
  return `${s}s`;
}
function utcTimeText(){
  const d = new Date();
  const hh = String(d.getUTCHours()).padStart(2,"0");
  const mm = String(d.getUTCMinutes()).padStart(2,"0");
  const ss = String(d.getUTCSeconds()).padStart(2,"0");
  return `${hh}:${mm}:${ss}`;
}
function timeLabel(ms){
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  const ss = String(d.getSeconds()).padStart(2,"0");
  return `${hh}:${mm}:${ss}`;
}
function setBasisGlow(el, val){
  if (!el) return;
  el.classList.remove("pos","neg");
  if (!Number.isFinite(val)) return;
  if (val > 0) el.classList.add("pos");
  else if (val < 0) el.classList.add("neg");
}
function statusFromAge(lastOkMs){
  if (!lastOkMs) return "WARN";
  return (nowMs() - lastOkMs) > STALE_MS ? "STALE" : "OK";
}
function statusClass(st){
  if (st === "OK") return "ok";
  if (st === "STALE") return "warn";
  return "bad";
}

function basisUsd(px, ref){
  if (!Number.isFinite(px) || !Number.isFinite(ref) || ref === 0) return null;
  return px - ref;
}
function basisBps(px, ref){
  if (!Number.isFinite(px) || !Number.isFinite(ref) || ref === 0) return null;
  return ((px / ref) - 1) * 10000.0;
}

// Binance funding APY annualized (compounded 3x/day for 8h funding)
function fundingApyPct(lastFundingRate){
  if (!Number.isFinite(lastFundingRate)) return null;
  const n = 3 * 365; // 3 fundings/day
  // APY = (1+r)^(n) - 1
  const apy = (Math.pow(1 + lastFundingRate, n) - 1) * 100;
  return apy;
}

// Meteora helpers
function isGoldLike(sym){
  const s = String(sym || "").toUpperCase();
  return s.includes("GOLD") || s.includes("XAU");
}
function isUsdcLike(sym){
  const s = String(sym || "").toUpperCase();
  return s.includes("USDC");
}
function inGoldUsdRange(x){
  return Number.isFinite(x) && x > 100 && x < 10000;
}

// Timed fetch wrapper
async function timed(fn){
  const t0 = performance.now();
  try{
    const v = await fn();
    const ms = Math.round(performance.now() - t0);
    return { ok:true, v, ms, err:"" };
  }catch(e){
    const ms = Math.round(performance.now() - t0);
    return { ok:false, v:null, ms, err:String(e?.message || e) };
  }
}

// ---- Fetchers ----
async function fetchPyth(){
  const url = `${PYTH_LATEST_URL}?ids[]=${encodeURIComponent(PYTH_XAU_USD_ID)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const parsed = data?.parsed?.[0];
  if (!parsed?.price) throw new Error("Bad response");
  const p = Number(parsed.price.price);
  const expo = Number(parsed.price.expo);
  const price = p * Math.pow(10, expo);
  const publishTimeMs = Number(parsed.price.publish_time) * 1000;
  if (!Number.isFinite(price)) throw new Error("Not finite");
  return { price, publishTimeMs };
}

async function fetchBinanceFut(){
  const [bookRes, premRes] = await Promise.all([
    fetch(BINANCE_BOOK_TICKER),
    fetch(BINANCE_PREMIUM_INDEX),
  ]);
  if (!bookRes.ok) throw new Error(`bookTicker HTTP ${bookRes.status}`);
  if (!premRes.ok) throw new Error(`premiumIndex HTTP ${premRes.status}`);

  const book = await bookRes.json();
  const prem = await premRes.json();

  const bid = Number(book.bidPrice);
  const ask = Number(book.askPrice);
  const mid = (bid + ask) / 2;

  const lastFundingRate = Number(prem.lastFundingRate);
  const nextFundingTimeMs = Number(prem.nextFundingTime);

  if (!Number.isFinite(mid)) throw new Error("Mid not finite");
  return { mid, lastFundingRate, nextFundingTimeMs };
}

async function fetchBinanceSpotUsdcUsdt(){
  const res = await fetch(BINANCE_SPOT_BOOK_TICKER);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const bid = Number(j.bidPrice);
  const ask = Number(j.askPrice);
  const mid = (bid + ask) / 2;
  if (!Number.isFinite(mid) || mid <= 0) throw new Error("Mid not finite");
  return { mid };
}

async function fetchHyperliquid(){
  // find flx dex then allMids(dex: flx)
  const dexsRes = await fetch(HL_INFO, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ type:"perpDexs" })
  });
  if (!dexsRes.ok) throw new Error(`perpDexs HTTP ${dexsRes.status}`);
  const dexs = await dexsRes.json();
  const dexObjs = (Array.isArray(dexs) ? dexs : []).filter(x => x && typeof x === "object" && x.name);
  const dexName = dexObjs.find(d => String(d.name).toLowerCase() === "flx")?.name || "flx";

  const midsRes = await fetch(HL_INFO, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ type:"allMids", dex: dexName })
  });
  if (!midsRes.ok) throw new Error(`allMids HTTP ${midsRes.status}`);
  const mids = await midsRes.json();

  let px = null;
  for (const k of ["GOLD","flx:GOLD","GOLD-USDC"]) {
    if (mids && mids[k] != null) { px = mids[k]; break; }
  }
  if (px == null && mids && typeof mids === "object") {
    const hit = Object.keys(mids).find(k => k.toUpperCase().includes("GOLD"));
    if (hit) px = mids[hit];
  }
  const mid = Number(px);
  if (!Number.isFinite(mid)) throw new Error("Mid not finite");
  return { mid };
}

async function fetchMeteora(){
  const res = await fetch(METEORA_POOL_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const p = Number(j?.current_price);
  if (!Number.isFinite(p) || p <= 0) throw new Error("current_price missing");

  const sx = j?.token_x?.symbol;
  const sy = j?.token_y?.symbol;

  const direct = p;
  const inv = 1 / p;

  let mid = direct;
  if (inGoldUsdRange(direct) && !inGoldUsdRange(inv)) mid = direct;
  else if (!inGoldUsdRange(direct) && inGoldUsdRange(inv)) mid = inv;
  else {
    const goldX = isGoldLike(sx), goldY = isGoldLike(sy);
    const usdcX = isUsdcLike(sx), usdcY = isUsdcLike(sy);
    if (goldX && usdcY) mid = direct;
    else if (usdcX && goldY) mid = inv;
    else mid = direct;
  }

  if (!Number.isFinite(mid)) throw new Error("Mid not finite");
  return { mid };
}

// ---- State ----
const state = {
  paused:false,
  refreshMs:5000,
  windowMs:3600000,
  unit:"usd",
  lastTickMs:0,

  pyth:{ price:NaN, publishTimeMs:0, lastOkMs:0, lastLatMs:0, err:"" },
  binF:{ mid:NaN, lastFundingRate:NaN, nextFundingTimeMs:0, lastOkMs:0, lastLatMs:0, err:"" },
  binS:{ mid:NaN, lastOkMs:0, lastLatMs:0, err:"" },
  hl:{ mid:NaN, lastOkMs:0, lastLatMs:0, err:"" },
  met:{ mid:NaN, lastOkMs:0, lastLatMs:0, err:"" },

  points:[], // {t, pyth, binUsd, binBps, hlUsd, hlBps, metUsd, metBps, apyPct}
  chartBasis:null,
  chartPyth:null,
  chartFunding:null,

  pollTimer:null,
  uiTimer:null,
};

// ---- Paint: top ----
function paintTop(){
  $("topUtc").textContent = utcTimeText();

  const px = state.pyth.price;
  $("topPythPx").textContent = fmtUsd(px, 2);

  // Change vs previous pyth point
  const pts = state.points;
  let chg = NaN, chgPct = NaN;
  if (pts.length >= 2) {
    const p1 = pts[pts.length-1]?.pyth;
    const p0 = pts[pts.length-2]?.pyth;
    if (Number.isFinite(p1) && Number.isFinite(p0)) {
      chg = p1 - p0;
      chgPct = (p0 !== 0) ? (chg / p0) * 100 : NaN;
    }
  }
  const chgEl = $("topPythChg");
  const pctEl = $("topPythChgPct");

  if (Number.isFinite(chg)) {
    chgEl.textContent = (chg>0?"+":"") + fmtNum(chg, 2);
    pctEl.textContent = `(${fmtPct(chgPct, 2)})`;
    chgEl.style.color = chg>0 ? "#00d47b" : (chg<0 ? "#ff3b3b" : "#d9dee7");
    pctEl.style.color = chg>0 ? "#00d47b" : (chg<0 ? "#ff3b3b" : "#d9dee7");
  } else {
    chgEl.textContent = "—";
    pctEl.textContent = "—";
    chgEl.style.color = "#d9dee7";
    pctEl.style.color = "#d9dee7";
  }
}

// ---- Status / errors ----
function setGlobalStatus(){
  const now = nowMs();
  const pOk = state.pyth.lastOkMs && (now - state.pyth.lastOkMs) <= STALE_MS;
  const bOk = state.binF.lastOkMs && (now - state.binF.lastOkMs) <= STALE_MS;
  const hOk = state.hl.lastOkMs && (now - state.hl.lastOkMs) <= STALE_MS;
  const mOk = state.met.lastOkMs && (now - state.met.lastOkMs) <= STALE_MS;

  const badge = $("globalStatus");
  badge.classList.remove("ok","warn","bad");

  let text = "LIVE";
  let cls = "ok";

  if (!pOk) { text = state.pyth.lastOkMs ? "STALE" : "ERROR"; cls = state.pyth.lastOkMs ? "warn" : "bad"; }
  else if (!bOk || !hOk || !mOk) { text = "PARTIAL"; cls = "warn"; }

  badge.textContent = text;
  badge.classList.add(cls);

  $("globalUpdated").textContent = state.lastTickMs ? `${ageText(state.lastTickMs)} ago` : "—";
}

function setGlobalError(msg){
  $("globalError").textContent = msg || "";
}

// ---- Snapshot tables ----
function paintSnapshot(){
  const ref = state.pyth.price;

  $("refPyth").textContent = fmtUsd(ref, 2);
  $("refPythTime").textContent = state.pyth.publishTimeMs
    ? new Date(state.pyth.publishTimeMs).toLocaleString()
    : "—";

  // Binance vs Pyth
  const bUsd = basisUsd(state.binF.mid, ref);
  const bBps = basisBps(state.binF.mid, ref);
  $("tblBinanceMid").textContent = fmtUsd(state.binF.mid, 2);
  $("tblBinanceBasisUsd").textContent = bUsd==null ? "—" : fmtUsd(bUsd, 2);
  $("tblBinanceBasisBps").textContent = bBps==null ? "—" : fmtBps(bBps);
  setBasisGlow($("tblBinanceBasisUsd"), bUsd);
  setBasisGlow($("tblBinanceBasisBps"), bBps);

  // Funding and next funding
  if (Number.isFinite(state.binF.lastFundingRate)) {
    $("tblBinanceFunding").textContent = fmtPct(state.binF.lastFundingRate * 100, 4);
  } else $("tblBinanceFunding").textContent = "—";
  $("tblBinanceNextFunding").textContent = state.binF.nextFundingTimeMs
    ? new Date(state.binF.nextFundingTimeMs).toLocaleTimeString()
    : "—";

  // HL vs Pyth
  const hUsd = basisUsd(state.hl.mid, ref);
  const hBps = basisBps(state.hl.mid, ref);
  $("tblHLMid").textContent = fmtUsd(state.hl.mid, 2);
  $("tblHLBasisUsd").textContent = hUsd==null ? "—" : fmtUsd(hUsd, 2);
  $("tblHLBasisBps").textContent = hBps==null ? "—" : fmtBps(hBps);
  setBasisGlow($("tblHLBasisUsd"), hUsd);
  setBasisGlow($("tblHLBasisBps"), hBps);

  // Meteora vs Pyth
  const mUsd = basisUsd(state.met.mid, ref);
  const mBps = basisBps(state.met.mid, ref);
  $("tblMeteoraMid").textContent = fmtUsd(state.met.mid, 2);
  $("tblMeteoraBasisUsd").textContent = mUsd==null ? "—" : fmtUsd(mUsd, 2);
  $("tblMeteoraBasisBps").textContent = mBps==null ? "—" : fmtBps(mBps);
  setBasisGlow($("tblMeteoraBasisUsd"), mUsd);
  setBasisGlow($("tblMeteoraBasisBps"), mBps);

  // Dislocations: Meteora vs Binance, Meteora vs HL
  const dMBusd = (Number.isFinite(state.met.mid) && Number.isFinite(state.binF.mid)) ? (state.met.mid - state.binF.mid) : null;
  const dMBbps = (Number.isFinite(state.met.mid) && Number.isFinite(state.binF.mid) && state.binF.mid!==0)
    ? ((state.met.mid / state.binF.mid) - 1) * 10000 : null;

  $("disMetBinUsd").textContent = dMBusd==null ? "—" : fmtUsd(dMBusd, 2);
  $("disMetBinBps").textContent = dMBbps==null ? "—" : fmtBps(dMBbps);
  setBasisGlow($("disMetBinUsd"), dMBusd ?? NaN);
  setBasisGlow($("disMetBinBps"), dMBbps ?? NaN);

  const dMHusd = (Number.isFinite(state.met.mid) && Number.isFinite(state.hl.mid)) ? (state.met.mid - state.hl.mid) : null;
  const dMHbps = (Number.isFinite(state.met.mid) && Number.isFinite(state.hl.mid) && state.hl.mid!==0)
    ? ((state.met.mid / state.hl.mid) - 1) * 10000 : null;

  $("disMetHlUsd").textContent = dMHusd==null ? "—" : fmtUsd(dMHusd, 2);
  $("disMetHlBps").textContent = dMHbps==null ? "—" : fmtBps(dMHbps);
  setBasisGlow($("disMetHlUsd"), dMHusd ?? NaN);
  setBasisGlow($("disMetHlBps"), dMHbps ?? NaN);

  // Conversion: XAUUSDC implied
  $("convXauUsdt").textContent = fmtUsd(state.binF.mid, 2);
  $("convUsdcUsdt").textContent = fmtNum(state.binS.mid, 6);
  let implied = NaN;
  if (Number.isFinite(state.binF.mid) && Number.isFinite(state.binS.mid) && state.binS.mid > 0) {
    implied = state.binF.mid / state.binS.mid;
  }
  $("convXauUsdc").textContent = fmtUsd(implied, 2);
}

// ---- Diagnostics ----
function paintDiagRow(prefix, feed){
  const st = feed.err ? "ERR" : statusFromAge(feed.lastOkMs);
  const stEl = $(prefix+"Status");
  stEl.textContent = st;
  stEl.style.color = st === "OK" ? "#00d47b" : (st === "STALE" ? "#ffd24a" : "#ff3b3b");

  $(prefix+"Age").textContent = feed.lastOkMs ? ageText(feed.lastOkMs) : "—";
  $(prefix+"Lat").textContent = feed.lastLatMs ? `${feed.lastLatMs}ms` : "—";
  const err = feed.err ? feed.err.slice(0, 180) : "—";
  $(prefix+"Err").textContent = err;
}

function paintDiagnostics(){
  paintDiagRow("diagPyth", state.pyth);
  paintDiagRow("diagBinF", state.binF);
  paintDiagRow("diagBinS", state.binS);
  paintDiagRow("diagHl", state.hl);
  paintDiagRow("diagMet", state.met);
}

// ---- Charts ----
function buildCharts(){
  if (typeof Chart === "undefined") return;

  // Basis chart
  state.chartBasis = new Chart($("basisChart").getContext("2d"), {
    type:"line",
    data:{ labels:[], datasets:[
      { label:"BINANCE basis", data:[], borderWidth:2, pointRadius:0, tension:0.15, borderColor:"#00c2ff" },
      { label:"HYPERLIQUID basis", data:[], borderWidth:2, pointRadius:0, tension:0.15, borderColor:"#ffb000" },
      { label:"METEORA basis", data:[], borderWidth:2, pointRadius:0, tension:0.15, borderColor:"#00d47b" },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, animation:false, spanGaps:false,
      plugins:{
        legend:{ labels:{ color:"#d9dee7", font:{ family:"monospace" }}},
        tooltip:{ callbacks:{ label:(c)=>{
          const v = c.parsed.y;
          return state.unit === "usd"
            ? `${c.dataset.label}: ${fmtUsd(v, 2)}`
            : `${c.dataset.label}: ${fmtBps(v)} bps`;
        }}}
      },
      scales:{
        x:{ ticks:{ color:"#8b93a7", maxRotation:0, autoSkip:true }, grid:{ color:"rgba(26,31,42,0.9)" }},
        y:{ ticks:{ color:"#8b93a7" }, grid:{ color:"rgba(26,31,42,0.9)" }},
      }
    }
  });

  // Pyth spot chart
  state.chartPyth = new Chart($("pythChart").getContext("2d"), {
    type:"line",
    data:{ labels:[], datasets:[
      { label:"PYTH XAUUSD", data:[], borderWidth:2, pointRadius:0, tension:0.15, borderColor:"#ffb000" },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, animation:false, spanGaps:false,
      plugins:{ legend:{ labels:{ color:"#d9dee7", font:{ family:"monospace" }}}},
      scales:{
        x:{ ticks:{ color:"#8b93a7", maxRotation:0, autoSkip:true }, grid:{ color:"rgba(26,31,42,0.9)" }},
        y:{ ticks:{ color:"#8b93a7" }, grid:{ color:"rgba(26,31,42,0.9)" }},
      }
    }
  });

  // Funding APY chart
  state.chartFunding = new Chart($("fundingChart").getContext("2d"), {
    type:"line",
    data:{ labels:[], datasets:[
      { label:"BINANCE APY", data:[], borderWidth:2, pointRadius:0, tension:0.15, borderColor:"#00c2ff" },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, animation:false, spanGaps:false,
      plugins:{
        legend:{ labels:{ color:"#d9dee7", font:{ family:"monospace" }}},
        tooltip:{ callbacks:{ label:(c)=> `${c.dataset.label}: ${fmtPct(c.parsed.y, 2)}` }}
      },
      scales:{
        x:{ ticks:{ color:"#8b93a7", maxRotation:0, autoSkip:true }, grid:{ color:"rgba(26,31,42,0.9)" }},
        y:{ ticks:{ color:"#8b93a7", callback:(v)=> `${v}%` }, grid:{ color:"rgba(26,31,42,0.9)" }},
      }
    }
  });
}

function prunePoints(){
  const cutoff = nowMs() - state.windowMs;
  state.points = state.points.filter(p => p.t >= cutoff);
}

function syncCharts(){
  prunePoints();
  const labels = state.points.map(p => timeLabel(p.t));

  // Basis datasets
  const bin = state.points.map(p => state.unit === "usd" ? p.binUsd : p.binBps);
  const hl  = state.points.map(p => state.unit === "usd" ? p.hlUsd  : p.hlBps);
  const met = state.points.map(p => state.unit === "usd" ? p.metUsd : p.metBps);

  state.chartBasis.data.labels = labels;
  state.chartBasis.data.datasets[0].data = bin;
  state.chartBasis.data.datasets[1].data = hl;
  state.chartBasis.data.datasets[2].data = met;
  state.chartBasis.update("none");

  // Pyth
  const pyth = state.points.map(p => p.pyth);
  state.chartPyth.data.labels = labels;
  state.chartPyth.data.datasets[0].data = pyth;
  state.chartPyth.update("none");

  // Funding APY
  const apy = state.points.map(p => p.apyPct);
  state.chartFunding.data.labels = labels;
  state.chartFunding.data.datasets[0].data = apy;
  state.chartFunding.update("none");
}

// ---- Tick ----
async function tick(){
  if (state.paused) return;

  const started = nowMs();
  state.lastTickMs = started;

  const [p, bf, bs, hl, met] = await Promise.all([
    timed(fetchPyth),
    timed(fetchBinanceFut),
    timed(fetchBinanceSpotUsdcUsdt),
    timed(fetchHyperliquid),
    timed(fetchMeteora),
  ]);

  // Update feeds
  if (p.ok){
    state.pyth.price = p.v.price;
    state.pyth.publishTimeMs = p.v.publishTimeMs;
    state.pyth.lastOkMs = started;
    state.pyth.err = "";
  } else state.pyth.err = `PYTH: ${p.err}`;
  state.pyth.lastLatMs = p.ms;

  if (bf.ok){
    state.binF.mid = bf.v.mid;
    state.binF.lastFundingRate = bf.v.lastFundingRate;
    state.binF.nextFundingTimeMs = bf.v.nextFundingTimeMs;
    state.binF.lastOkMs = started;
    state.binF.err = "";
  } else state.binF.err = `BINANCE FUT: ${bf.err}`;
  state.binF.lastLatMs = bf.ms;

  if (bs.ok){
    state.binS.mid = bs.v.mid;
    state.binS.lastOkMs = started;
    state.binS.err = "";
  } else state.binS.err = `BINANCE SPOT: ${bs.err}`;
  state.binS.lastLatMs = bs.ms;

  if (hl.ok){
    state.hl.mid = hl.v.mid;
    state.hl.lastOkMs = started;
    state.hl.err = "";
  } else state.hl.err = `HL: ${hl.err}`;
  state.hl.lastLatMs = hl.ms;

  if (met.ok){
    state.met.mid = met.v.mid;
    state.met.lastOkMs = started;
    state.met.err = "";
  } else state.met.err = `METEORA: ${met.err}`;
  state.met.lastLatMs = met.ms;

  // Push time-series point
  const ref = state.pyth.price;
  const apyPct = fundingApyPct(state.binF.lastFundingRate);

  state.points.push({
    t: started,
    pyth: Number.isFinite(ref) ? ref : null,
    binUsd: basisUsd(state.binF.mid, ref),
    binBps: basisBps(state.binF.mid, ref),
    hlUsd:  basisUsd(state.hl.mid, ref),
    hlBps:  basisBps(state.hl.mid, ref),
    metUsd: basisUsd(state.met.mid, ref),
    metBps: basisBps(state.met.mid, ref),
    apyPct: apyPct,
  });

  // Global error line (compact)
  const errs = [];
  if (state.pyth.err) errs.push(state.pyth.err);
  if (state.binF.err) errs.push(state.binF.err);
  if (state.binS.err) errs.push(state.binS.err);
  if (state.hl.err) errs.push(state.hl.err);
  if (state.met.err) errs.push(state.met.err);
  setGlobalError(errs.join(" • "));

  // Paint
  setGlobalStatus();
  paintTop();
  paintSnapshot();
  paintDiagnostics();
  syncCharts();
}

// ---- Timers ----
function startPoll(){
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => { tick(); }, state.refreshMs);
}
function startUi(){
  if (state.uiTimer) clearInterval(state.uiTimer);
  state.uiTimer = setInterval(() => {
    paintTop();
    setGlobalStatus();
    paintDiagnostics();
  }, 1000);
}

// ---- Controls ----
function wire(){
  $("refreshSelect").addEventListener("change", (e)=>{
    state.refreshMs = Number(e.target.value);
    startPoll();
  });
  $("windowSelect").addEventListener("change", (e)=>{
    state.windowMs = Number(e.target.value);
    prunePoints();
    syncCharts();
  });
  $("unitUsdBtn").addEventListener("click", ()=>{
    state.unit = "usd";
    $("unitUsdBtn").classList.add("on");
    $("unitBpsBtn").classList.remove("on");
    syncCharts();
  });
  $("unitBpsBtn").addEventListener("click", ()=>{
    state.unit = "bps";
    $("unitBpsBtn").classList.add("on");
    $("unitUsdBtn").classList.remove("on");
    syncCharts();
  });
  $("pauseBtn").addEventListener("click", ()=>{
    state.paused = true;
    $("pauseBtn").disabled = true;
    $("resumeBtn").disabled = false;
    setGlobalStatus();
  });
  $("resumeBtn").addEventListener("click", ()=>{
    state.paused = false;
    $("pauseBtn").disabled = false;
    $("resumeBtn").disabled = true;
    tick();
    setGlobalStatus();
  });
}

// ---- Boot ----
(function boot(){
  wire();
  buildCharts();
  paintTop();
  tick();
  startPoll();
  startUi();
})();
