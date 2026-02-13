// app.js — GOLD BASIS MONITOR
// Pyth + Binance Futures + Hyperliquid + Meteora DLMM + Binance Spot USDCUSDT conversion
// Chart.js uses category x-axis (no time adapter).

// ---------- Config ----------
const PYTH_XAU_USD_ID =
  "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";
const PYTH_LATEST_URL = "https://hermes.pyth.network/v2/updates/price/latest";

// Binance USD-M Futures
const BINANCE_BOOK_TICKER =
  "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=XAUUSDT";
const BINANCE_PREMIUM_INDEX =
  "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XAUUSDT";

// Binance Spot (USDCUSDT)
const BINANCE_SPOT_BOOK_TICKER =
  "https://api.binance.com/api/v3/ticker/bookTicker?symbol=USDCUSDT";

// Hyperliquid
const HL_INFO = "https://api.hyperliquid.xyz/info";

// Meteora DLMM pool (from your link)
const METEORA_POOL_ADDRESS = "3Vj8miZuTSdonf4W1xLdYFatrXLm38CShrCi7NbZS5Ah";
const METEORA_POOL_URL = `https://dlmm.datapi.meteora.ag/pools/${METEORA_POOL_ADDRESS}`;

// Staleness thresholds (ms)
const STALE_MS = 30_000;

// ---------- Helpers ----------
function $(id) { return document.getElementById(id); }
function nowMs() { return Date.now(); }

function fmtUsd(x, dp = 2) {
  if (!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dp,
    minimumFractionDigits: dp,
  }).format(x);
}

function fmtNum(x, dp = 2) {
  if (!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: dp,
    minimumFractionDigits: dp,
  }).format(x);
}

function fmtBps(x) {
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${fmtNum(x, 2)}`;
}

function ageText(lastOkMs) {
  if (!lastOkMs) return "—";
  const s = Math.max(0, Math.floor((nowMs() - lastOkMs) / 1000));
  return `${s}s`;
}

function setDot(dotId, status) {
  const el = $(dotId);
  if (!el) return;
  el.classList.remove("ok", "warn", "bad");
  el.classList.add(status);
}

function statusFromAge(lastOkMs) {
  if (!lastOkMs) return "warn";
  return (nowMs() - lastOkMs) > STALE_MS ? "warn" : "ok";
}

function timeLabel(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function setBasisGlow(el, value) {
  if (!el) return;
  el.classList.remove("pos", "neg");
  if (!Number.isFinite(value)) return;
  if (value > 0) el.classList.add("pos");
  else if (value < 0) el.classList.add("neg");
}

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

// ---------- Data fetchers ----------
async function fetchPythXauUsd() {
  const url = `${PYTH_LATEST_URL}?ids[]=${encodeURIComponent(PYTH_XAU_USD_ID)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pyth HTTP ${res.status}`);

  const data = await res.json();
  const parsed = data?.parsed?.[0];
  if (!parsed?.price) throw new Error("Unexpected Pyth response");

  const p = Number(parsed.price.price);
  const expo = Number(parsed.price.expo);
  const price = p * Math.pow(10, expo);
  const publishTimeMs = Number(parsed.price.publish_time) * 1000;

  if (!Number.isFinite(price)) throw new Error("Pyth price not finite");
  return { price, publishTimeMs };
}

async function fetchBinanceMidAndFunding() {
  const [bookRes, premRes] = await Promise.all([
    fetch(BINANCE_BOOK_TICKER),
    fetch(BINANCE_PREMIUM_INDEX),
  ]);

  if (!bookRes.ok) throw new Error(`Binance bookTicker HTTP ${bookRes.status}`);
  if (!premRes.ok) throw new Error(`Binance premiumIndex HTTP ${premRes.status}`);

  const book = await bookRes.json();
  const prem = await premRes.json();

  const bid = Number(book.bidPrice);
  const ask = Number(book.askPrice);
  const mid = (bid + ask) / 2;

  const lastFundingRate = Number(prem.lastFundingRate);
  const nextFundingTimeMs = Number(prem.nextFundingTime);

  if (!Number.isFinite(mid)) throw new Error("Binance mid not finite");
  return { mid, lastFundingRate, nextFundingTimeMs };
}

async function fetchBinanceUsdcUsdtMidSpot() {
  const res = await fetch(BINANCE_SPOT_BOOK_TICKER);
  if (!res.ok) throw new Error(`Binance spot USDCUSDT HTTP ${res.status}`);

  const j = await res.json();
  const bid = Number(j.bidPrice);
  const ask = Number(j.askPrice);
  const mid = (bid + ask) / 2;

  if (!Number.isFinite(mid) || mid <= 0) throw new Error("USDCUSDT mid not finite");
  return { mid };
}

// Hyperliquid: query flx dex mids (your market is flx:GOLD / GOLD-USDC in UI)
async function fetchHyperliquidMid() {
  const dexsRes = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "perpDexs" }),
  });
  if (!dexsRes.ok) throw new Error(`Hyperliquid perpDexs HTTP ${dexsRes.status}`);

  const dexs = await dexsRes.json();
  const dexObjs = (Array.isArray(dexs) ? dexs : []).filter(
    (x) => x && typeof x === "object" && x.name
  );

  const dexName =
    dexObjs.find((d) => String(d.name).toLowerCase() === "flx")?.name || "flx";

  const midsRes = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids", dex: dexName }),
  });
  if (!midsRes.ok) throw new Error(`Hyperliquid allMids HTTP ${midsRes.status}`);

  const mids = await midsRes.json();

  let px = null;
  const candidates = ["GOLD", "flx:GOLD", "GOLD-USDC"];
  for (const k of candidates) {
    if (mids && mids[k] != null) { px = mids[k]; break; }
  }
  if (px == null && mids && typeof mids === "object") {
    const hit = Object.keys(mids).find((k) => k.toUpperCase().includes("GOLD"));
    if (hit) px = mids[hit];
  }

  const mid = Number(px);
  if (!Number.isFinite(mid)) throw new Error("Hyperliquid mid not finite");
  return { mid };
}

// Meteora DLMM: GET /pools/{address} -> current_price (pool price) :contentReference[oaicite:1]{index=1}
async function fetchMeteoraMid() {
  const res = await fetch(METEORA_POOL_URL);
  if (!res.ok) throw new Error(`Meteora HTTP ${res.status}`);

  const j = await res.json();
  const p = Number(j?.current_price);
  if (!Number.isFinite(p) || p <= 0) throw new Error("Meteora current_price missing");

  const sx = j?.token_x?.symbol;
  const sy = j?.token_y?.symbol;

  // We want USD per GOLD. current_price direction can vary by pair orientation.
  // Strategy:
  // 1) If it looks like GOLD/USDC pair, choose orientation using magnitude (gold is ~100..10000).
  // 2) Otherwise still pick the orientation that falls into gold price range.
  const direct = p;
  const inv = 1 / p;

  let mid = direct;
  if (inGoldUsdRange(direct) && !inGoldUsdRange(inv)) mid = direct;
  else if (!inGoldUsdRange(direct) && inGoldUsdRange(inv)) mid = inv;
  else {
    // If both "plausible" or both not, fall back using symbol hints:
    const goldX = isGoldLike(sx), goldY = isGoldLike(sy);
    const usdcX = isUsdcLike(sx), usdcY = isUsdcLike(sy);

    // If token_x is GOLD and token_y is USDC, direct is likely USDC per GOLD
    if (goldX && usdcY) mid = direct;
    else if (usdcX && goldY) mid = inv;
    else mid = direct; // last fallback
  }

  if (!Number.isFinite(mid)) throw new Error("Meteora mid not finite");
  return { mid };
}

// ---------- Basis math ----------
function basisUsd(venue, ref) {
  if (!Number.isFinite(venue) || !Number.isFinite(ref) || ref === 0) return null;
  return venue - ref;
}

function basisBps(venue, ref) {
  if (!Number.isFinite(venue) || !Number.isFinite(ref) || ref === 0) return null;
  return ((venue / ref) - 1) * 10000.0;
}

// ---------- State ----------
const state = {
  paused: false,
  refreshMs: 5000,
  windowMs: 3600000,
  unit: "usd",
  lastTickMs: 0,

  pyth: { price: NaN, publishTimeMs: 0, lastOkMs: 0, err: "" },
  binance: { mid: NaN, lastFundingRate: NaN, nextFundingTimeMs: 0, lastOkMs: 0, err: "" },
  hl: { mid: NaN, lastOkMs: 0, err: "" },
  meteora: { mid: NaN, lastOkMs: 0, err: "" },
  usdcusdt: { mid: NaN, lastOkMs: 0, err: "" },

  // points: { t, binUsd, binBps, hlUsd, hlBps, metUsd, metBps }
  points: [],
  chart: null,

  pollTimer: null,
  uiTimer: null,
};

// ---------- UI ----------
function setGlobalError(msg) {
  const el = $("globalError");
  if (el) el.textContent = msg || "";
}

function setGlobalStatus() {
  const now = nowMs();
  const pOk = state.pyth.lastOkMs && (now - state.pyth.lastOkMs) <= STALE_MS;

  const bOk = state.binance.lastOkMs && (now - state.binance.lastOkMs) <= STALE_MS;
  const hOk = state.hl.lastOkMs && (now - state.hl.lastOkMs) <= STALE_MS;
  const mOk = state.meteora.lastOkMs && (now - state.meteora.lastOkMs) <= STALE_MS;

  const badge = $("globalStatus");
  if (badge) {
    badge.classList.remove("ok", "warn", "bad");

    let text = "LIVE";
    let cls = "ok";

    if (!pOk) {
      text = state.pyth.lastOkMs ? "STALE" : "ERROR";
      cls = state.pyth.lastOkMs ? "warn" : "bad";
    } else if (!bOk || !hOk || !mOk) {
      text = "PARTIAL";
      cls = "warn";
    }

    badge.textContent = text;
    badge.classList.add(cls);
  }

  const upd = $("globalUpdated");
  if (upd) upd.textContent = state.lastTickMs ? `${ageText(state.lastTickMs)} ago` : "—";
}

function paintStrip() {
  setDot("dotPyth", statusFromAge(state.pyth.lastOkMs));
  $("pxPyth").textContent = fmtUsd(state.pyth.price, 2);
  $("agePyth").textContent = ageText(state.pyth.lastOkMs);

  setDot("dotBinance", statusFromAge(state.binance.lastOkMs));
  $("pxBinance").textContent = fmtUsd(state.binance.mid, 2);
  $("ageBinance").textContent = ageText(state.binance.lastOkMs);

  if (Number.isFinite(state.binance.lastFundingRate)) {
    const frPct = state.binance.lastFundingRate * 100;
    const sign = frPct > 0 ? "+" : "";
    $("fundBinance").textContent = `funding: ${sign}${fmtNum(frPct, 4)}%`;
  } else {
    $("fundBinance").textContent = "funding: —";
  }

  setDot("dotHL", statusFromAge(state.hl.lastOkMs));
  $("pxHL").textContent = fmtUsd(state.hl.mid, 2);
  $("ageHL").textContent = ageText(state.hl.lastOkMs);

  setDot("dotMeteora", statusFromAge(state.meteora.lastOkMs));
  $("pxMeteora").textContent = fmtUsd(state.meteora.mid, 2);
  $("ageMeteora").textContent = ageText(state.meteora.lastOkMs);
}

function paintTable() {
  const ref = state.pyth.price;

  $("refPyth").textContent = fmtUsd(ref, 2);
  $("refPythTime").textContent = state.pyth.publishTimeMs
    ? new Date(state.pyth.publishTimeMs).toLocaleString()
    : "—";

  // Binance
  const bUsd = basisUsd(state.binance.mid, ref);
  const bBps = basisBps(state.binance.mid, ref);

  $("tblBinanceMid").textContent = fmtUsd(state.binance.mid, 2);
  $("tblBinanceBasisUsd").textContent = bUsd == null ? "—" : fmtUsd(bUsd, 2);
  $("tblBinanceBasisBps").textContent = bBps == null ? "—" : fmtBps(bBps);

  setBasisGlow($("tblBinanceBasisUsd"), bUsd);
  setBasisGlow($("tblBinanceBasisBps"), bBps);

  if (Number.isFinite(state.binance.lastFundingRate)) {
    const frPct = state.binance.lastFundingRate * 100;
    const sign = frPct > 0 ? "+" : "";
    $("tblBinanceFunding").textContent = `${sign}${fmtNum(frPct, 4)}%`;
  } else {
    $("tblBinanceFunding").textContent = "—";
  }

  $("tblBinanceNextFunding").textContent = state.binance.nextFundingTimeMs
    ? new Date(state.binance.nextFundingTimeMs).toLocaleTimeString()
    : "—";

  // Hyperliquid
  const hUsd = basisUsd(state.hl.mid, ref);
  const hBps = basisBps(state.hl.mid, ref);

  $("tblHLMid").textContent = fmtUsd(state.hl.mid, 2);
  $("tblHLBasisUsd").textContent = hUsd == null ? "—" : fmtUsd(hUsd, 2);
  $("tblHLBasisBps").textContent = hBps == null ? "—" : fmtBps(hBps);

  setBasisGlow($("tblHLBasisUsd"), hUsd);
  setBasisGlow($("tblHLBasisBps"), hBps);

  // Meteora
  const mUsd = basisUsd(state.meteora.mid, ref);
  const mBps = basisBps(state.meteora.mid, ref);

  $("tblMeteoraMid").textContent = fmtUsd(state.meteora.mid, 2);
  $("tblMeteoraBasisUsd").textContent = mUsd == null ? "—" : fmtUsd(mUsd, 2);
  $("tblMeteoraBasisBps").textContent = mBps == null ? "—" : fmtBps(mBps);

  setBasisGlow($("tblMeteoraBasisUsd"), mUsd);
  setBasisGlow($("tblMeteoraBasisBps"), mBps);
}

function paintConversion() {
  $("convXauUsdt").textContent = fmtUsd(state.binance.mid, 2);
  $("convUsdcUsdt").textContent = fmtNum(state.usdcusdt.mid, 6);

  let implied = NaN;
  if (Number.isFinite(state.binance.mid) && Number.isFinite(state.usdcusdt.mid) && state.usdcusdt.mid > 0) {
    implied = state.binance.mid / state.usdcusdt.mid;
  }
  $("convXauUsdc").textContent = fmtUsd(implied, 2);
}

// ---------- Chart ----------
function buildChart() {
  const canvas = $("basisChart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "BINANCE basis", data: [], borderWidth: 2, pointRadius: 0, tension: 0.15 },
        { label: "HYPERLIQUID basis", data: [], borderWidth: 2, pointRadius: 0, tension: 0.15 },
        { label: "METEORA basis", data: [], borderWidth: 2, pointRadius: 0, tension: 0.15 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      spanGaps: false,
      plugins: {
        legend: { labels: { color: "#d9dee7", font: { family: "monospace" } } },
        tooltip: {
          callbacks: {
            label: (c) => {
              const v = c.parsed.y;
              return state.unit === "usd"
                ? `${c.dataset.label}: ${fmtUsd(v, 2)}`
                : `${c.dataset.label}: ${fmtBps(v)} bps`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#8b93a7", maxRotation: 0, autoSkip: true }, grid: { color: "rgba(26,31,42,0.9)" } },
        y: { ticks: { color: "#8b93a7" }, grid: { color: "rgba(26,31,42,0.9)" } },
      },
    },
  });
}

function prunePoints() {
  const cutoff = nowMs() - state.windowMs;
  state.points = state.points.filter((p) => p.t >= cutoff);
}

function syncChart() {
  if (!state.chart) return;

  prunePoints();

  const labels = state.points.map((p) => timeLabel(p.t));
  const bin = state.points.map((p) => (state.unit === "usd" ? p.binUsd : p.binBps));
  const hl  = state.points.map((p) => (state.unit === "usd" ? p.hlUsd  : p.hlBps));
  const met = state.points.map((p) => (state.unit === "usd" ? p.metUsd : p.metBps));

  state.chart.data.labels = labels;
  state.chart.data.datasets[0].data = bin;
  state.chart.data.datasets[1].data = hl;
  state.chart.data.datasets[2].data = met;

  state.chart.update("none");
}

// ---------- Poll loop ----------
async function tick() {
  if (state.paused) return;

  const started = nowMs();
  state.lastTickMs = started;
  setGlobalError("");

  const [pythR, binR, hlR, metR, usdcR] = await Promise.allSettled([
    fetchPythXauUsd(),
    fetchBinanceMidAndFunding(),
    fetchHyperliquidMid(),
    fetchMeteoraMid(),
    fetchBinanceUsdcUsdtMidSpot(),
  ]);

  if (pythR.status === "fulfilled") {
    state.pyth.price = pythR.value.price;
    state.pyth.publishTimeMs = pythR.value.publishTimeMs;
    state.pyth.lastOkMs = started;
    state.pyth.err = "";
  } else state.pyth.err = String(pythR.reason?.message || pythR.reason);

  if (binR.status === "fulfilled") {
    state.binance.mid = binR.value.mid;
    state.binance.lastFundingRate = binR.value.lastFundingRate;
    state.binance.nextFundingTimeMs = binR.value.nextFundingTimeMs;
    state.binance.lastOkMs = started;
    state.binance.err = "";
  } else state.binance.err = String(binR.reason?.message || binR.reason);

  if (hlR.status === "fulfilled") {
    state.hl.mid = hlR.value.mid;
    state.hl.lastOkMs = started;
    state.hl.err = "";
  } else state.hl.err = String(hlR.reason?.message || hlR.reason);

  if (metR.status === "fulfilled") {
    state.meteora.mid = metR.value.mid;
    state.meteora.lastOkMs = started;
    state.meteora.err = "";
  } else state.meteora.err = String(metR.reason?.message || metR.reason);

  if (usdcR.status === "fulfilled") {
    state.usdcusdt.mid = usdcR.value.mid;
    state.usdcusdt.lastOkMs = started;
    state.usdcusdt.err = "";
  } else state.usdcusdt.err = String(usdcR.reason?.message || usdcR.reason);

  const ref = state.pyth.price;
  state.points.push({
    t: started,
    binUsd: basisUsd(state.binance.mid, ref),
    binBps: basisBps(state.binance.mid, ref),
    hlUsd:  basisUsd(state.hl.mid, ref),
    hlBps:  basisBps(state.hl.mid, ref),
    metUsd: basisUsd(state.meteora.mid, ref),
    metBps: basisBps(state.meteora.mid, ref),
  });

  const errs = [];
  if (state.pyth.err) errs.push(`PYTH: ${state.pyth.err}`);
  if (state.binance.err) errs.push(`BINANCE: ${state.binance.err}`);
  if (state.hl.err) errs.push(`HYPERLIQUID: ${state.hl.err}`);
  if (state.meteora.err) errs.push(`METEORA: ${state.meteora.err}`);
  if (state.usdcusdt.err) errs.push(`USDCUSDT: ${state.usdcusdt.err}`);
  setGlobalError(errs.join(" • "));

  setGlobalStatus();
  paintStrip();
  paintTable();
  paintConversion();
  syncChart();
}

// ---------- Timers ----------
function startPollTimer() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    tick().catch((e) => setGlobalError(`TICK: ${String(e?.message || e)}`));
  }, state.refreshMs);
}

function startUiTimer() {
  if (state.uiTimer) clearInterval(state.uiTimer);
  state.uiTimer = setInterval(() => {
    setGlobalStatus();
    paintStrip();
  }, 1000);
}

// ---------- Controls ----------
function wireControls() {
  $("refreshSelect").addEventListener("change", (e) => {
    state.refreshMs = Number(e.target.value);
    startPollTimer();
  });

  $("windowSelect").addEventListener("change", (e) => {
    state.windowMs = Number(e.target.value);
    prunePoints();
    syncChart();
  });

  $("unitUsdBtn").addEventListener("click", () => {
    state.unit = "usd";
    $("unitUsdBtn").classList.add("btn-on");
    $("unitBpsBtn").classList.remove("btn-on");
    syncChart();
  });

  $("unitBpsBtn").addEventListener("click", () => {
    state.unit = "bps";
    $("unitBpsBtn").classList.add("btn-on");
    $("unitUsdBtn").classList.remove("btn-on");
    syncChart();
  });

  $("pauseBtn").addEventListener("click", () => {
    state.paused = true;
    $("pauseBtn").disabled = true;
    $("resumeBtn").disabled = false;
    setGlobalStatus();
  });

  $("resumeBtn").addEventListener("click", () => {
    state.paused = false;
    $("pauseBtn").disabled = false;
    $("resumeBtn").disabled = true;
    tick();
    setGlobalStatus();
  });
}

// ---------- Boot ----------
(function boot() {
  try {
    wireControls();
    buildChart();
    tick();
    startPollTimer();
    startUiTimer();
  } catch (e) {
    setGlobalError(`BOOT: ${String(e?.message || e)}`);
    console.error(e);
  }
})();
