// ============================================
// GOLD BASIS TERMINAL — Bloomberg Style
// ============================================
// Feeds: Pyth XAU/USD, Binance XAUUSDT perp, Binance spot USDCUSDT,
//        Hyperliquid GOLD-USDC (flx dex), Meteora DLMM pool.

const PYTH_XAU_USD_ID = "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";
const PYTH_LATEST_URL = "https://hermes.pyth.network/v2/updates/price/latest";

const BINANCE_BOOK_TICKER = "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=XAUUSDT";
const BINANCE_PREMIUM_INDEX = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XAUUSDT";
const BINANCE_SPOT_BOOK_TICKER = "https://api.binance.com/api/v3/ticker/bookTicker?symbol=USDCUSDT";

const HL_INFO = "https://api.hyperliquid.xyz/info";

const METEORA_POOL_ADDRESS = "3Vj8miZuTSdonf4W1xLdYFatrXLm38CShrCi7NbZS5Ah";
const METEORA_POOL_URL = `https://dlmm.datapi.meteora.ag/pools/${METEORA_POOL_ADDRESS}`;

const STALE_MS = 30_000;

// ============================================
// SAFE DOM HELPER - Prevents null errors
// ============================================
function $(id) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`Element not found: #${id}`);
  }
  return el;
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function setClass(id, className, add = true) {
  const el = $(id);
  if (el) {
    if (add) el.classList.add(className);
    else el.classList.remove(className);
  }
}

function setClasses(id, classes) {
  const el = $(id);
  if (el) {
    el.classList.remove('pos', 'neg', 'ok', 'warn', 'bad', 'live', 'stale', 'error');
    classes.forEach(c => el.classList.add(c));
  }
}

// ============================================
// FORMATTING UTILITIES
// ============================================
function nowMs() { return Date.now(); }

function fmtUsd(x, dp = 2) {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: dp,
    maximumFractionDigits: dp
  });
}

function fmtNum(x, dp = 2) {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp
  });
}

function fmtBps(x) {
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${fmtNum(x, 2)}`;
}

function fmtPct(x, dp = 2) {
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${fmtNum(x, dp)}%`;
}

function ageText(ms) {
  if (!ms) return "—";
  const s = Math.max(0, Math.floor((nowMs() - ms) / 1000));
  return `${s}s`;
}

function utcTimeText() {
  const d = new Date();
  return d.toUTCString().slice(-12, -4);
}

function timeLabel(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function formatDate() {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ============================================
// CALCULATION HELPERS
// ============================================
function basisUsd(px, ref) {
  if (!Number.isFinite(px) || !Number.isFinite(ref) || ref === 0) return null;
  return px - ref;
}

function basisBps(px, ref) {
  if (!Number.isFinite(px) || !Number.isFinite(ref) || ref === 0) return null;
  return ((px / ref) - 1) * 10000.0;
}

function fundingApyPct(lastFundingRate) {
  if (!Number.isFinite(lastFundingRate)) return null;
  const n = 3 * 365; // 3 fundings/day
  const apy = (Math.pow(1 + lastFundingRate, n) - 1) * 100;
  return apy;
}

function statusFromAge(lastOkMs) {
  if (!lastOkMs) return "ERR";
  return (nowMs() - lastOkMs) > STALE_MS ? "STALE" : "OK";
}

// Meteora helpers
function isGoldLike(sym) {
  const s = String(sym || "").toUpperCase();
  return s.includes("GOLD") || s.includes("XAU");
}

function isUsdcLike(sym) {
  const s = String(sym || "").toUpperCase();
  return s.includes("USDC");
}

function inGoldUsdRange(x) {
  return Number.isFinite(x) && x > 100 && x < 10000;
}

// ============================================
// TIMED FETCH WRAPPER
// ============================================
async function timed(fn) {
  const t0 = performance.now();
  try {
    const v = await fn();
    const ms = Math.round(performance.now() - t0);
    return { ok: true, v, ms, err: "" };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { ok: false, v: null, ms, err: String(e?.message || e) };
  }
}

// ============================================
// DATA FETCHERS
// ============================================
async function fetchPyth() {
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

async function fetchBinanceFut() {
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

async function fetchBinanceSpotUsdcUsdt() {
  const res = await fetch(BINANCE_SPOT_BOOK_TICKER);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const bid = Number(j.bidPrice);
  const ask = Number(j.askPrice);
  const mid = (bid + ask) / 2;
  if (!Number.isFinite(mid) || mid <= 0) throw new Error("Mid not finite");
  return { mid };
}

async function fetchHyperliquid() {
  const dexsRes = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "perpDexs" })
  });
  if (!dexsRes.ok) throw new Error(`perpDexs HTTP ${dexsRes.status}`);
  const dexs = await dexsRes.json();
  const dexObjs = (Array.isArray(dexs) ? dexs : []).filter(x => x && typeof x === "object" && x.name);
  const dexName = dexObjs.find(d => String(d.name).toLowerCase() === "flx")?.name || "flx";

  const midsRes = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids", dex: dexName })
  });
  if (!midsRes.ok) throw new Error(`allMids HTTP ${midsRes.status}`);
  const mids = await midsRes.json();

  let px = null;
  for (const k of ["GOLD", "flx:GOLD", "GOLD-USDC"]) {
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

async function fetchMeteora() {
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

// ============================================
// APPLICATION STATE
// ============================================
const state = {
  paused: false,
  refreshMs: 5000,
  windowMs: 3600000,
  unit: "usd",
  lastTickMs: 0,

  pyth: { price: NaN, publishTimeMs: 0, lastOkMs: 0, lastLatMs: 0, err: "" },
  binF: { mid: NaN, lastFundingRate: NaN, nextFundingTimeMs: 0, lastOkMs: 0, lastLatMs: 0, err: "" },
  binS: { mid: NaN, lastOkMs: 0, lastLatMs: 0, err: "" },
  hl: { mid: NaN, lastOkMs: 0, lastLatMs: 0, err: "" },
  met: { mid: NaN, lastOkMs: 0, lastLatMs: 0, err: "" },

  points: [],
  chartBasis: null,
  chartPyth: null,
  chartFunding: null,

  pollTimer: null,
  uiTimer: null,
};

// ============================================
// UI PAINTING FUNCTIONS
// ============================================
function paintHeader() {
  // Time
  setText("headerTime", utcTimeText());
  setText("headerDate", formatDate());
  setText("footerTime", `${utcTimeText()} UTC`);

  // Price
  const px = state.pyth.price;
  setText("headerPrice", Number.isFinite(px) ? fmtNum(px, 2) : "-----.--");

  // Change calculation
  const pts = state.points;
  let chg = NaN, chgPct = NaN;
  if (pts.length >= 2) {
    const p1 = pts[pts.length - 1]?.pyth;
    const p0 = pts[0]?.pyth; // Compare to first point in window
    if (Number.isFinite(p1) && Number.isFinite(p0)) {
      chg = p1 - p0;
      chgPct = (p0 !== 0) ? (chg / p0) * 100 : NaN;
    }
  }

  const chgEl = $("headerChange");
  const pctEl = $("headerChangePct");

  if (chgEl && pctEl) {
    if (Number.isFinite(chg)) {
      chgEl.textContent = (chg > 0 ? "+" : "") + fmtNum(chg, 2);
      pctEl.textContent = `(${fmtPct(chgPct, 2)})`;
      chgEl.className = "bb-change " + (chg > 0 ? "positive" : chg < 0 ? "negative" : "");
    } else {
      chgEl.textContent = "--.--";
      pctEl.textContent = "(--.--%)"
      chgEl.className = "bb-change";
    }
  }
}

function paintStatus() {
  const now = nowMs();
  const pOk = state.pyth.lastOkMs && (now - state.pyth.lastOkMs) <= STALE_MS;
  const bOk = state.binF.lastOkMs && (now - state.binF.lastOkMs) <= STALE_MS;
  const hOk = state.hl.lastOkMs && (now - state.hl.lastOkMs) <= STALE_MS;
  const mOk = state.met.lastOkMs && (now - state.met.lastOkMs) <= STALE_MS;

  const light = $("statusLight");
  const text = $("statusText");

  if (light && text) {
    light.classList.remove("live", "stale", "error");
    text.classList.remove("stale", "error");

    if (state.paused) {
      text.textContent = "PAUSED";
      light.classList.add("stale");
      text.classList.add("stale");
    } else if (!pOk) {
      text.textContent = state.pyth.lastOkMs ? "STALE" : "ERROR";
      light.classList.add(state.pyth.lastOkMs ? "stale" : "error");
      text.classList.add(state.pyth.lastOkMs ? "stale" : "error");
    } else if (!bOk || !hOk || !mOk) {
      text.textContent = "PARTIAL";
      light.classList.add("stale");
      text.classList.add("stale");
    } else {
      text.textContent = "LIVE";
      light.classList.add("live");
    }
  }

  setText("globalUpdated", state.lastTickMs ? `${ageText(state.lastTickMs)} ago` : "--");
}

function paintError() {
  const errs = [];
  if (state.pyth.err) errs.push(state.pyth.err);
  if (state.binF.err) errs.push(state.binF.err);
  if (state.binS.err) errs.push(state.binS.err);
  if (state.hl.err) errs.push(state.hl.err);
  if (state.met.err) errs.push(state.met.err);
  setText("globalError", errs.join(" • "));
}

function setBasisGlow(id, val) {
  const el = $(id);
  if (!el) return;
  el.classList.remove("pos", "neg");
  if (!Number.isFinite(val)) return;
  if (val > 0) el.classList.add("pos");
  else if (val < 0) el.classList.add("neg");
}

function paintSnapshot() {
  const ref = state.pyth.price;

  // Reference
  setText("refPyth", fmtUsd(ref, 2));
  setText("refPythTime", state.pyth.publishTimeMs
    ? new Date(state.pyth.publishTimeMs).toLocaleString()
    : "—");

  // Binance vs Pyth
  const bUsd = basisUsd(state.binF.mid, ref);
  const bBps = basisBps(state.binF.mid, ref);
  setText("tblBinanceMid", fmtUsd(state.binF.mid, 2));
  setText("tblBinanceBasisUsd", bUsd == null ? "—" : fmtUsd(bUsd, 2));
  setText("tblBinanceBasisBps", bBps == null ? "—" : fmtBps(bBps));
  setBasisGlow("tblBinanceBasisUsd", bUsd);
  setBasisGlow("tblBinanceBasisBps", bBps);

  // Funding
  if (Number.isFinite(state.binF.lastFundingRate)) {
    setText("tblBinanceFunding", fmtPct(state.binF.lastFundingRate * 100, 4));
  } else {
    setText("tblBinanceFunding", "—");
  }
  setText("tblBinanceNextFunding", state.binF.nextFundingTimeMs
    ? new Date(state.binF.nextFundingTimeMs).toLocaleTimeString()
    : "—");

  // Hyperliquid vs Pyth
  const hUsd = basisUsd(state.hl.mid, ref);
  const hBps = basisBps(state.hl.mid, ref);
  setText("tblHLMid", fmtUsd(state.hl.mid, 2));
  setText("tblHLBasisUsd", hUsd == null ? "—" : fmtUsd(hUsd, 2));
  setText("tblHLBasisBps", hBps == null ? "—" : fmtBps(hBps));
  setBasisGlow("tblHLBasisUsd", hUsd);
  setBasisGlow("tblHLBasisBps", hBps);

  // Meteora vs Pyth
  const mUsd = basisUsd(state.met.mid, ref);
  const mBps = basisBps(state.met.mid, ref);
  setText("tblMeteoraMid", fmtUsd(state.met.mid, 2));
  setText("tblMeteoraBasisUsd", mUsd == null ? "—" : fmtUsd(mUsd, 2));
  setText("tblMeteoraBasisBps", mBps == null ? "—" : fmtBps(mBps));
  setBasisGlow("tblMeteoraBasisUsd", mUsd);
  setBasisGlow("tblMeteoraBasisBps", mBps);

  // Dislocations
  const dMBusd = (Number.isFinite(state.met.mid) && Number.isFinite(state.binF.mid))
    ? (state.met.mid - state.binF.mid) : null;
  const dMBbps = (Number.isFinite(state.met.mid) && Number.isFinite(state.binF.mid) && state.binF.mid !== 0)
    ? ((state.met.mid / state.binF.mid) - 1) * 10000 : null;

  setText("disMetBinUsd", dMBusd == null ? "—" : fmtUsd(dMBusd, 2));
  setText("disMetBinBps", dMBbps == null ? "—" : fmtBps(dMBbps));
  setBasisGlow("disMetBinUsd", dMBusd);
  setBasisGlow("disMetBinBps", dMBbps);

  const dMHusd = (Number.isFinite(state.met.mid) && Number.isFinite(state.hl.mid))
    ? (state.met.mid - state.hl.mid) : null;
  const dMHbps = (Number.isFinite(state.met.mid) && Number.isFinite(state.hl.mid) && state.hl.mid !== 0)
    ? ((state.met.mid / state.hl.mid) - 1) * 10000 : null;

  setText("disMetHlUsd", dMHusd == null ? "—" : fmtUsd(dMHusd, 2));
  setText("disMetHlBps", dMHbps == null ? "—" : fmtBps(dMHbps));
  setBasisGlow("disMetHlUsd", dMHusd);
  setBasisGlow("disMetHlBps", dMHbps);

  // Conversion
  setText("convXauUsdt", fmtUsd(state.binF.mid, 2));
  setText("convUsdcUsdt", fmtNum(state.binS.mid, 6));
  let implied = NaN;
  if (Number.isFinite(state.binF.mid) && Number.isFinite(state.binS.mid) && state.binS.mid > 0) {
    implied = state.binF.mid / state.binS.mid;
  }
  setText("convXauUsdc", fmtUsd(implied, 2));
}

function paintDiagRow(prefix, feed) {
  const st = feed.err ? "ERR" : statusFromAge(feed.lastOkMs);
  const statusEl = $(prefix + "Status");
  
  if (statusEl) {
    statusEl.textContent = st;
    statusEl.classList.remove("ok", "warn", "bad");
    if (st === "OK") statusEl.classList.add("ok");
    else if (st === "STALE") statusEl.classList.add("warn");
    else statusEl.classList.add("bad");
  }

  setText(prefix + "Age", feed.lastOkMs ? ageText(feed.lastOkMs) : "—");
  setText(prefix + "Lat", feed.lastLatMs ? `${feed.lastLatMs}ms` : "—");
  setText(prefix + "Err", feed.err ? feed.err.slice(0, 100) : "—");
}

function paintDiagnostics() {
  paintDiagRow("diagPyth", state.pyth);
  paintDiagRow("diagBinF", state.binF);
  paintDiagRow("diagBinS", state.binS);
  paintDiagRow("diagHl", state.hl);
  paintDiagRow("diagMet", state.met);
}

// ============================================
// CHARTS
// ============================================
function buildCharts() {
  if (typeof Chart === "undefined") {
    console.error("Chart.js not loaded");
    return;
  }

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    spanGaps: false,
    plugins: {
      legend: {
        display: false
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#888888',
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
          font: { family: 'Consolas, monospace', size: 10 }
        },
        grid: { color: 'rgba(42, 42, 42, 0.5)' }
      },
      y: {
        ticks: {
          color: '#888888',
          font: { family: 'Consolas, monospace', size: 10 }
        },
        grid: { color: 'rgba(42, 42, 42, 0.5)' }
      }
    }
  };

  // Basis chart
  const basisCtx = $("basisChart")?.getContext("2d");
  if (basisCtx) {
    state.chartBasis = new Chart(basisCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "BINANCE", data: [], borderWidth: 2, pointRadius: 0, tension: 0.2, borderColor: "#f0b90b" },
          { label: "HYPERLIQUID", data: [], borderWidth: 2, pointRadius: 0, tension: 0.2, borderColor: "#00ff88" },
          { label: "METEORA", data: [], borderWidth: 2, pointRadius: 0, tension: 0.2, borderColor: "#9945ff" },
        ]
      },
      options: {
        ...chartDefaults,
        plugins: {
          ...chartDefaults.plugins,
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = c.parsed.y;
                return state.unit === "usd"
                  ? `${c.dataset.label}: ${fmtUsd(v, 2)}`
                  : `${c.dataset.label}: ${fmtBps(v)} bps`;
              }
            }
          }
        }
      }
    });
  }

  // Pyth spot chart
  const pythCtx = $("pythChart")?.getContext("2d");
  if (pythCtx) {
    state.chartPyth = new Chart(pythCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "PYTH XAUUSD", data: [], borderWidth: 2, pointRadius: 0, tension: 0.2, borderColor: "#ff6600", fill: true, backgroundColor: 'rgba(255, 102, 0, 0.1)' },
        ]
      },
      options: chartDefaults
    });
  }

  // Funding APY chart
  const fundingCtx = $("fundingChart")?.getContext("2d");
  if (fundingCtx) {
    state.chartFunding = new Chart(fundingCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "BINANCE APY", data: [], borderWidth: 2, pointRadius: 0, tension: 0.2, borderColor: "#00ccff", fill: true, backgroundColor: 'rgba(0, 204, 255, 0.1)' },
        ]
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          y: {
            ...chartDefaults.scales.y,
            ticks: {
              ...chartDefaults.scales.y.ticks,
              callback: (v) => `${v}%`
            }
          }
        }
      }
    });
  }
}

function prunePoints() {
  const cutoff = nowMs() - state.windowMs;
  state.points = state.points.filter(p => p.t >= cutoff);
}

function syncCharts() {
  prunePoints();
  const labels = state.points.map(p => timeLabel(p.t));

  // Basis datasets
  if (state.chartBasis) {
    const bin = state.points.map(p => state.unit === "usd" ? p.binUsd : p.binBps);
    const hl = state.points.map(p => state.unit === "usd" ? p.hlUsd : p.hlBps);
    const met = state.points.map(p => state.unit === "usd" ? p.metUsd : p.metBps);

    state.chartBasis.data.labels = labels;
    state.chartBasis.data.datasets[0].data = bin;
    state.chartBasis.data.datasets[1].data = hl;
    state.chartBasis.data.datasets[2].data = met;
    state.chartBasis.update("none");
  }

  // Pyth
  if (state.chartPyth) {
    const pyth = state.points.map(p => p.pyth);
    state.chartPyth.data.labels = labels;
    state.chartPyth.data.datasets[0].data = pyth;
    state.chartPyth.update("none");
  }

  // Funding APY
  if (state.chartFunding) {
    const apy = state.points.map(p => p.apyPct);
    state.chartFunding.data.labels = labels;
    state.chartFunding.data.datasets[0].data = apy;
    state.chartFunding.update("none");
  }
}

// ============================================
// MAIN TICK FUNCTION
// ============================================
async function tick() {
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
  if (p.ok) {
    state.pyth.price = p.v.price;
    state.pyth.publishTimeMs = p.v.publishTimeMs;
    state.pyth.lastOkMs = started;
    state.pyth.err = "";
  } else {
    state.pyth.err = `PYTH: ${p.err}`;
  }
  state.pyth.lastLatMs = p.ms;

  if (bf.ok) {
    state.binF.mid = bf.v.mid;
    state.binF.lastFundingRate = bf.v.lastFundingRate;
    state.binF.nextFundingTimeMs = bf.v.nextFundingTimeMs;
    state.binF.lastOkMs = started;
    state.binF.err = "";
  } else {
    state.binF.err = `BINANCE FUT: ${bf.err}`;
  }
  state.binF.lastLatMs = bf.ms;

  if (bs.ok) {
    state.binS.mid = bs.v.mid;
    state.binS.lastOkMs = started;
    state.binS.err = "";
  } else {
    state.binS.err = `BINANCE SPOT: ${bs.err}`;
  }
  state.binS.lastLatMs = bs.ms;

  if (hl.ok) {
    state.hl.mid = hl.v.mid;
    state.hl.lastOkMs = started;
    state.hl.err = "";
  } else {
    state.hl.err = `HL: ${hl.err}`;
  }
  state.hl.lastLatMs = hl.ms;

  if (met.ok) {
    state.met.mid = met.v.mid;
    state.met.lastOkMs = started;
    state.met.err = "";
  } else {
    state.met.err = `METEORA: ${met.err}`;
  }
  state.met.lastLatMs = met.ms;

  // Push time-series point
  const ref = state.pyth.price;
  const apyPct = fundingApyPct(state.binF.lastFundingRate);

  state.points.push({
    t: started,
    pyth: Number.isFinite(ref) ? ref : null,
    binUsd: basisUsd(state.binF.mid, ref),
    binBps: basisBps(state.binF.mid, ref),
    hlUsd: basisUsd(state.hl.mid, ref),
    hlBps: basisBps(state.hl.mid, ref),
    metUsd: basisUsd(state.met.mid, ref),
    metBps: basisBps(state.met.mid, ref),
    apyPct: apyPct,
  });

  // Paint everything
  paintError();
  paintStatus();
  paintHeader();
  paintSnapshot();
  paintDiagnostics();
  syncCharts();
}

// ============================================
// TIMERS
// ============================================
function startPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => tick(), state.refreshMs);
}

function startUi() {
  if (state.uiTimer) clearInterval(state.uiTimer);
  state.uiTimer = setInterval(() => {
    paintHeader();
    paintStatus();
    paintDiagnostics();
  }, 1000);
}

// ============================================
// CONTROL WIRING
// ============================================
function wire() {
  const refreshSelect = $("refreshSelect");
  if (refreshSelect) {
    refreshSelect.addEventListener("change", (e) => {
      state.refreshMs = Number(e.target.value);
      startPoll();
    });
  }

  const windowSelect = $("windowSelect");
  if (windowSelect) {
    windowSelect.addEventListener("change", (e) => {
      state.windowMs = Number(e.target.value);
      prunePoints();
      syncCharts();
    });
  }

  const unitUsdBtn = $("unitUsdBtn");
  const unitBpsBtn = $("unitBpsBtn");
  
  if (unitUsdBtn) {
    unitUsdBtn.addEventListener("click", () => {
      state.unit = "usd";
      unitUsdBtn.classList.add("active");
      unitBpsBtn?.classList.remove("active");
      syncCharts();
    });
  }

  if (unitBpsBtn) {
    unitBpsBtn.addEventListener("click", () => {
      state.unit = "bps";
      unitBpsBtn.classList.add("active");
      unitUsdBtn?.classList.remove("active");
      syncCharts();
    });
  }

  const pauseBtn = $("pauseBtn");
  const resumeBtn = $("resumeBtn");

  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      state.paused = true;
      pauseBtn.disabled = true;
      if (resumeBtn) resumeBtn.disabled = false;
      paintStatus();
    });
  }

  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      state.paused = false;
      if (pauseBtn) pauseBtn.disabled = false;
      resumeBtn.disabled = true;
      tick();
      paintStatus();
    });
  }

  // Function key clicks
  document.querySelectorAll('.bb-fkey').forEach(key => {
    key.addEventListener('click', () => {
      document.querySelectorAll('.bb-fkey').forEach(k => k.classList.remove('active'));
      key.classList.add('active');
    });
  });
}

// ============================================
// INITIALIZATION
// ============================================
function init() {
  console.log("Gold Basis Terminal initializing...");
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

function boot() {
  console.log("Booting terminal...");
  wire();
  buildCharts();
  paintHeader();
  paintStatus();
  tick();
  startPoll();
  startUi();
  console.log("Terminal ready!");
}

// Start the application
init();
