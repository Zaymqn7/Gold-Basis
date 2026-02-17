// GOLD BASIS TERMINAL

const PYTH_ID = "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";
const PYTH_URL = "https://hermes.pyth.network/v2/updates/price/latest";
const BIN_BOOK = "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=XAUUSDT";
const BIN_PREM = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XAUUSDT";
const BIN_SPOT = "https://api.binance.com/api/v3/ticker/bookTicker?symbol=USDCUSDT";
const HL_INFO = "https://api.hyperliquid.xyz/info";
const MET_URL = "https://dlmm.datapi.meteora.ag/pools/3Vj8miZuTSdonf4W1xLdYFatrXLm38CShrCi7NbZS5Ah";
const STALE = 30000;

const $ = id => document.getElementById(id);
const setText = (id, t) => { const e = $(id); if (e) e.textContent = t; };
const fmtUsd = (x, d=2) => !Number.isFinite(x) ? "—" : "US$" + x.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
const fmtNum = (x, d=2) => !Number.isFinite(x) ? "—" : x.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
const fmtBps = x => !Number.isFinite(x) ? "—" : (x>0?"+":"") + fmtNum(x, 2);
const fmtPct = (x, d=2) => !Number.isFinite(x) ? "—" : (x>0?"+":"") + fmtNum(x, d) + "%";
const ageStr = ms => !ms ? "—" : Math.max(0, Math.floor((Date.now()-ms)/1000)) + "s";
const timeStr = ms => new Date(ms).toLocaleTimeString("en-US", {hour12:false});
const utcStr = () => new Date().toUTCString().slice(-12, -4);

const basisUsd = (p, r) => (!Number.isFinite(p)||!Number.isFinite(r)||r===0) ? null : p - r;
const basisBps = (p, r) => (!Number.isFinite(p)||!Number.isFinite(r)||r===0) ? null : ((p/r)-1)*10000;
const fundApy = r => !Number.isFinite(r) ? null : (Math.pow(1+r, 1095)-1)*100;
const stFromAge = ms => !ms ? "ERR" : (Date.now()-ms) > STALE ? "STALE" : "OK";
const inRange = x => Number.isFinite(x) && x > 100 && x < 10000;

async function timed(fn) {
  const t0 = performance.now();
  try { return { ok:true, v:await fn(), ms:Math.round(performance.now()-t0), err:"" }; }
  catch(e) { return { ok:false, v:null, ms:Math.round(performance.now()-t0), err:String(e?.message||e) }; }
}

async function getPyth() {
  const r = await fetch(`${PYTH_URL}?ids[]=${encodeURIComponent(PYTH_ID)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json(), p = d?.parsed?.[0];
  if (!p?.price) throw new Error("Bad data");
  const price = Number(p.price.price) * Math.pow(10, Number(p.price.expo));
  if (!Number.isFinite(price)) throw new Error("NaN");
  return { price, pubMs: Number(p.price.publish_time)*1000 };
}

async function getBinFut() {
  const [br, pr] = await Promise.all([fetch(BIN_BOOK), fetch(BIN_PREM)]);
  if (!br.ok||!pr.ok) throw new Error("HTTP err");
  const [b, p] = await Promise.all([br.json(), pr.json()]);
  const mid = (Number(b.bidPrice)+Number(b.askPrice))/2;
  if (!Number.isFinite(mid)) throw new Error("NaN");
  return { mid, fundRate: Number(p.lastFundingRate), nextFundMs: Number(p.nextFundingTime) };
}

async function getBinSpot() {
  const r = await fetch(BIN_SPOT);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const mid = (Number(j.bidPrice)+Number(j.askPrice))/2;
  if (!Number.isFinite(mid)||mid<=0) throw new Error("NaN");
  return { mid };
}

async function getHL() {
  const dr = await fetch(HL_INFO, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({type:"perpDexs"})});
  if (!dr.ok) throw new Error("dexs err");
  const dexs = await dr.json();
  const dn = (Array.isArray(dexs)?dexs:[]).find(d=>String(d?.name).toLowerCase()==="flx")?.name || "flx";
  const mr = await fetch(HL_INFO, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({type:"allMids", dex:dn})});
  if (!mr.ok) throw new Error("mids err");
  const mids = await mr.json();
  let px = mids?.["GOLD"] ?? mids?.["flx:GOLD"] ?? mids?.["GOLD-USDC"];
  if (px==null && mids) { const k = Object.keys(mids).find(k=>k.toUpperCase().includes("GOLD")); if(k) px=mids[k]; }
  const mid = Number(px);
  if (!Number.isFinite(mid)) throw new Error("NaN");
  return { mid };
}

async function getMet() {
  const r = await fetch(MET_URL);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const p = Number(j?.current_price);
  if (!Number.isFinite(p)||p<=0) throw new Error("No price");
  const inv = 1/p;
  let mid = inRange(p) ? p : inRange(inv) ? inv : p;
  if (!Number.isFinite(mid)) throw new Error("NaN");
  return { mid };
}

const S = {
  paused:false, refrMs:5000, winMs:3600000, unit:"usd", lastTick:0,
  pyth:{price:NaN, pubMs:0, okMs:0, latMs:0, err:""},
  binF:{mid:NaN, fundRate:NaN, nextFundMs:0, okMs:0, latMs:0, err:""},
  binS:{mid:NaN, okMs:0, latMs:0, err:""},
  hl:{mid:NaN, okMs:0, latMs:0, err:""},
  met:{mid:NaN, okMs:0, latMs:0, err:""},
  pts:[], cBasis:null, cPyth:null, cFund:null
};

function paintHdr() {
  setText("topTime", utcStr());
  setText("footTime", utcStr() + " UTC");
  const px = S.pyth.price;
  setText("hdrPrice", Number.isFinite(px) ? fmtUsd(px,2) : "US$-----.--");
  let chg=NaN, pct=NaN;
  if (S.pts.length>=2) {
    const p1=S.pts[S.pts.length-1]?.pyth, p0=S.pts[0]?.pyth;
    if (Number.isFinite(p1)&&Number.isFinite(p0)) { chg=p1-p0; pct=p0?(chg/p0)*100:NaN; }
  }
  const ce=$("hdrChg"), pe=$("hdrPct");
  if(ce){ ce.textContent = Number.isFinite(chg) ? (chg>0?"+":"")+fmtNum(chg,2) : "--.--"; ce.className = chg>0?"chg-up":chg<0?"chg-dn":""; }
  if(pe) pe.textContent = Number.isFinite(pct) ? "("+fmtPct(pct,2)+")" : "(--.--%)"
}

function paintStatus() {
  const ok = S.pyth.okMs && (Date.now()-S.pyth.okMs)<=STALE;
  const dot=$("statusDot"), txt=$("statusTxt");
  if(dot){ dot.className = "dot " + (S.paused?"warn":ok?"":"err"); }
  if(txt) txt.textContent = S.paused?"PAUSED":ok?"LIVE":"ERROR";
  setText("updAge", S.lastTick ? ageStr(S.lastTick)+" ago" : "--");
}

function paintErr() {
  const errs = [S.pyth.err, S.binF.err, S.binS.err, S.hl.err, S.met.err].filter(Boolean);
  setText("errMsg", errs.join(" • "));
}

function setVC(id, v) {
  const e=$(id); if(!e) return;
  e.classList.remove("pos","neg");
  if(Number.isFinite(v)) e.classList.add(v>0?"pos":"neg");
}

function paintSnap() {
  const ref = S.pyth.price;

  const bU=basisUsd(S.binF.mid,ref), bB=basisBps(S.binF.mid,ref);
  setText("binMid", fmtUsd(S.binF.mid,2));
  setText("binBasisUsd", bU!=null?fmtUsd(bU,2):"—"); setVC("binBasisUsd",bU);
  setText("binBasisBps", bB!=null?fmtBps(bB):"—"); setVC("binBasisBps",bB);
  setText("binFund", Number.isFinite(S.binF.fundRate)?fmtPct(S.binF.fundRate*100,4):"—");
  setText("binNext", S.binF.nextFundMs?timeStr(S.binF.nextFundMs):"—");

  const hU=basisUsd(S.hl.mid,ref), hB=basisBps(S.hl.mid,ref);
  setText("hlMid", fmtUsd(S.hl.mid,2));
  setText("hlBasisUsd", hU!=null?fmtUsd(hU,2):"—"); setVC("hlBasisUsd",hU);
  setText("hlBasisBps", hB!=null?fmtBps(hB):"—"); setVC("hlBasisBps",hB);

  const mU=basisUsd(S.met.mid,ref), mB=basisBps(S.met.mid,ref);
  setText("metMid", fmtUsd(S.met.mid,2));
  setText("metBasisUsd", mU!=null?fmtUsd(mU,2):"—"); setVC("metBasisUsd",mU);
  setText("metBasisBps", mB!=null?fmtBps(mB):"—"); setVC("metBasisBps",mB);

  // Dislocations
  const dBu=(Number.isFinite(S.met.mid)&&Number.isFinite(S.binF.mid))?(S.met.mid-S.binF.mid):null;
  const dBb=dBu!=null&&S.binF.mid?((S.met.mid/S.binF.mid)-1)*10000:null;
  setText("dislMBusd", dBu!=null?fmtUsd(dBu,2):"—"); setVC("dislMBusd",dBu);
  setText("dislMBbps", dBb!=null?fmtBps(dBb):"—"); setVC("dislMBbps",dBb);

  const dHu=(Number.isFinite(S.met.mid)&&Number.isFinite(S.hl.mid))?(S.met.mid-S.hl.mid):null;
  const dHb=dHu!=null&&S.hl.mid?((S.met.mid/S.hl.mid)-1)*10000:null;
  setText("dislMHusd", dHu!=null?fmtUsd(dHu,2):"—"); setVC("dislMHusd",dHu);
  setText("dislMHbps", dHb!=null?fmtBps(dHb):"—"); setVC("dislMHbps",dHb);

  // Conversion
  setText("convXauUsdt", fmtUsd(S.binF.mid,2));
  setText("convUsdcUsdt", fmtNum(S.binS.mid,6));
  const impl = (Number.isFinite(S.binF.mid)&&Number.isFinite(S.binS.mid)&&S.binS.mid>0) ? S.binF.mid/S.binS.mid : NaN;
  setText("convImplied", fmtUsd(impl,2));
}

function paintDiagRow(pre, f) {
  const st = f.err ? "ERR" : stFromAge(f.okMs);
  const e = $(pre+"St");
  if(e){ e.textContent=st; e.className=st==="OK"?"st-ok":st==="STALE"?"st-wrn":"st-err"; }
  setText(pre+"Age", f.okMs ? ageStr(f.okMs) : "—");
  setText(pre+"Lat", f.latMs ? f.latMs+"ms" : "—");
  setText(pre+"Err", f.err ? f.err.slice(0,60) : "—");
}

function paintDiag() {
  paintDiagRow("dPyth", S.pyth);
  paintDiagRow("dBinF", S.binF);
  paintDiagRow("dHl", S.hl);
  paintDiagRow("dMet", S.met);
}

function buildCharts() {
  if (typeof Chart === "undefined") return;

  // Bloomberg chart style: white axes, dotted white grid lines, black background
  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        ticks: { color: "#ffffff", maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 9, family: "Consolas, monospace" } },
        grid: { color: "rgba(255,255,255,0.15)", borderColor: "#ffffff", borderDash: [2, 2] },
        border: { color: "#ffffff" }
      },
      y: {
        ticks: { color: "#ffffff", font: { size: 9, family: "Consolas, monospace" } },
        grid: { color: "rgba(255,255,255,0.15)", borderColor: "#ffffff", borderDash: [2, 2] },
        border: { color: "#ffffff" }
      }
    }
  };

  const basisCtx = $("chartBasis")?.getContext("2d");
  if (basisCtx) {
    S.cBasis = new Chart(basisCtx, {
      type: "line",
      data: { labels: [], datasets: [
        { label:"BIN", data:[], borderWidth:1.5, pointRadius:0, tension:0.2, borderColor:"#ff9900" },
        { label:"HL", data:[], borderWidth:1.5, pointRadius:0, tension:0.2, borderColor:"#00ff00" },
        { label:"MET", data:[], borderWidth:1.5, pointRadius:0, tension:0.2, borderColor:"#ff00ff" }
      ]},
      options: chartOpts
    });
  }

  const pythCtx = $("chartPyth")?.getContext("2d");
  if (pythCtx) {
    S.cPyth = new Chart(pythCtx, {
      type: "line",
      data: { labels: [], datasets: [
        { label:"PYTH", data:[], borderWidth:1.5, pointRadius:0, tension:0.2, borderColor:"#ff9900" }
      ]},
      options: chartOpts
    });
  }

  const fundCtx = $("chartFund")?.getContext("2d");
  if (fundCtx) {
    S.cFund = new Chart(fundCtx, {
      type: "line",
      data: { labels: [], datasets: [
        { label:"APY", data:[], borderWidth:1.5, pointRadius:0, tension:0.2, borderColor:"#00ffff" }
      ]},
      options: {
        ...chartOpts,
        scales: {
          ...chartOpts.scales,
          y: { ...chartOpts.scales.y, ticks: { ...chartOpts.scales.y.ticks, callback: v => v.toFixed(2)+"%" } }
        }
      }
    });
  }
}

function prune() {
  const cut = Date.now() - S.winMs;
  S.pts = S.pts.filter(p => p.t >= cut);
}

function syncCharts() {
  prune();
  const labels = S.pts.map(p => timeStr(p.t));

  if (S.cBasis) {
    S.cBasis.data.labels = labels;
    S.cBasis.data.datasets[0].data = S.pts.map(p => S.unit==="usd"?p.binUsd:p.binBps);
    S.cBasis.data.datasets[1].data = S.pts.map(p => S.unit==="usd"?p.hlUsd:p.hlBps);
    S.cBasis.data.datasets[2].data = S.pts.map(p => S.unit==="usd"?p.metUsd:p.metBps);
    S.cBasis.update("none");
  }

  if (S.cPyth) {
    S.cPyth.data.labels = labels;
    S.cPyth.data.datasets[0].data = S.pts.map(p => p.pyth);
    S.cPyth.update("none");
  }

  if (S.cFund) {
    S.cFund.data.labels = labels;
    S.cFund.data.datasets[0].data = S.pts.map(p => p.apy);
    S.cFund.update("none");
  }
}

async function tick() {
  if (S.paused) return;
  const now = Date.now();
  S.lastTick = now;

  const [rP, rBF, rBS, rHL, rM] = await Promise.all([timed(getPyth), timed(getBinFut), timed(getBinSpot), timed(getHL), timed(getMet)]);

  if (rP.ok) { S.pyth.price=rP.v.price; S.pyth.pubMs=rP.v.pubMs; S.pyth.okMs=now; S.pyth.err=""; }
  else S.pyth.err="PYTH: "+rP.err;
  S.pyth.latMs=rP.ms;

  if (rBF.ok) { S.binF.mid=rBF.v.mid; S.binF.fundRate=rBF.v.fundRate; S.binF.nextFundMs=rBF.v.nextFundMs; S.binF.okMs=now; S.binF.err=""; }
  else S.binF.err="BINANCE: "+rBF.err;
  S.binF.latMs=rBF.ms;

  if (rBS.ok) { S.binS.mid=rBS.v.mid; S.binS.okMs=now; S.binS.err=""; }
  else S.binS.err="BIN SPOT: "+rBS.err;
  S.binS.latMs=rBS.ms;

  if (rHL.ok) { S.hl.mid=rHL.v.mid; S.hl.okMs=now; S.hl.err=""; }
  else S.hl.err="HL: "+rHL.err;
  S.hl.latMs=rHL.ms;

  if (rM.ok) { S.met.mid=rM.v.mid; S.met.okMs=now; S.met.err=""; }
  else S.met.err="METEORA: "+rM.err;
  S.met.latMs=rM.ms;

  const ref = S.pyth.price;
  S.pts.push({
    t: now,
    pyth: Number.isFinite(ref) ? ref : null,
    binUsd: basisUsd(S.binF.mid, ref),
    binBps: basisBps(S.binF.mid, ref),
    hlUsd: basisUsd(S.hl.mid, ref),
    hlBps: basisBps(S.hl.mid, ref),
    metUsd: basisUsd(S.met.mid, ref),
    metBps: basisBps(S.met.mid, ref),
    apy: fundApy(S.binF.fundRate)
  });

  paintErr(); paintStatus(); paintHdr(); paintSnap(); paintDiag(); syncCharts();
}

let pollTimer, uiTimer;

function startPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(tick, S.refrMs);
}

function startUi() {
  if (uiTimer) clearInterval(uiTimer);
  uiTimer = setInterval(() => { paintHdr(); paintStatus(); paintDiag(); }, 1000);
}

function wire() {
  $("selRefr")?.addEventListener("change", e => { S.refrMs = Number(e.target.value); startPoll(); });
  $("selWin")?.addEventListener("change", e => { S.winMs = Number(e.target.value); prune(); syncCharts(); });

  $("btnUsd")?.addEventListener("click", () => {
    S.unit = "usd";
    $("btnUsd")?.classList.add("on");
    $("btnBps")?.classList.remove("on");
    syncCharts();
  });

  $("btnBps")?.addEventListener("click", () => {
    S.unit = "bps";
    $("btnBps")?.classList.add("on");
    $("btnUsd")?.classList.remove("on");
    syncCharts();
  });

  $("btnPause")?.addEventListener("click", () => {
    S.paused = true;
    $("btnPause").disabled = true;
    $("btnResume").disabled = false;
    paintStatus();
  });

  $("btnResume")?.addEventListener("click", () => {
    S.paused = false;
    $("btnPause").disabled = false;
    $("btnResume").disabled = true;
    tick();
    paintStatus();
  });
}

(function init() {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

function boot() {
  wire();
  buildCharts();
  paintHdr();
  paintStatus();
  tick();
  startPoll();
  startUi();
}
