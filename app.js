// GOLD BASIS MONITOR
// Pyth = reference (oracle price), Binance = true mid from bid/ask, Hyperliquid = mid from allMids

// ---------- Config ----------
const PYTH_XAU_USD_ID =
  "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";

const PYTH_LATEST_URL = "https://hermes.pyth.network/v2/updates/price/latest";

// Binance USD-M Futures
const BINANCE_BOOK_TICKER = "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=XAUUSDT";
const BINANCE_PREMIUM_INDEX = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XAUUSDT";

// Hyperliquid
const HL_INFO = "https://api.hyperliquid.xyz/info";
const HL_ASSET = "GOLD"; // if Hyperliquid uses a different key, change this (we auto-try to find a match)

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
    minimumFractionDigits: dp
  }).format(x);
}

function fmtNum(x, dp = 2) {
  if (!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: dp,
    minimumFractionDigits: dp
  }).format(x);
}

function fmtBps(x) {
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${fmtNum(x, 2)}`;
}

function ageText(lastOkMs) {
  if (!lastOkMs) return "—";
  const s = Math.max(0, Math.round((nowMs() - lastOkMs) / 1000));
  return `${s}s`;
}

function setDot(dotId, status) {
  const el = $(dotId);
  el.classList.remove("ok", "warn", "bad");
  el.classList.add(status);
}

function statusFromAge(lastOkMs) {
  if (!lastOkMs) return "warn";
  return (nowMs() - lastOkMs) > STALE_MS ? "warn" : "ok";
}

function signColorClass(x) {
  if (!Number.isFinite(x)) return "";
  if (x > 0) return "pos";
  if (x < 0) return "neg";
  return "";
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
  const [bookRes, premRes] = await Promise.all([fetch(BINANCE_BOOK_TICKER), fetch(BINANCE_PREMIUM_INDEX)]);
  if (!bookRes.ok) throw new Error(`Binance bookTicker HTTP ${bookRes.status}`);
  if (!premRes.ok) throw new Error(`Binance premiumIndex HTTP ${premRes.status}`);

  const book = await bookRes.json();
  const prem = await premRes.json();

  const bid = Number(book.bidPrice);
  const ask = Number(book.askPrice);
  const mid = (bid + ask) / 2;

  const lastFundingRate = Number(prem.lastFundingRate); // per funding interval (typically 8h)
  const nextFundingTimeMs = Number(prem.nextFundingTime);

  if (!Number.isFinite(mid)) throw new Error("Binance mid not finite");
  return { bid, ask, mid, lastFundingRate, nextFundingTimeMs };
}

async function fetchHyperliquidMid() {
  const res = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" })
  });

  if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
  const data = await res.json();

  // data is a map: { "BTC": "xxxx", ... }
  let px = data?.[HL_ASSET];

  // If not found, try to locate something like GOLD
  if (px == null) {
    const keys = Object.keys(data || {});
    const hit = keys.find(k => k.toUpperCase() === HL_ASSET.toUpperCase())
             || keys.find(k => k.toUpperCase().includes("GOLD"));
    if (hit) px = data[hit];
  }

  const mid = Number(px);
  if (!Number.isFinite(mid)) throw new Error(`Hyperliquid mid missing for ${HL_ASSET}`);
  return { mid };
}

// ---------- State ----------
const state = {
  paused: false,
  refreshMs: 5000,
  windowMs: 3600000,
  unit: "usd", // "usd" | "bps"
  lastTickMs: 0,

  pyth: { price: NaN, publishTimeMs: 0, lastOkMs: 0, err: "" },
  binance: { mid: NaN, lastFundingRate: NaN, nextFundingTimeMs: 0, lastOkMs: 0, err: "" },
  hl: { mid: NaN, lastOkMs: 0, err: "" },

  // time series: {t, usd, bps}
  series: {
    binance: [],
    hl: []
  },

  chart: null
};

// ---------- Basis math ----------
function basisUsd(venue, ref) {
  if (!Number.isFinite(venue) || !Number.isFinite(ref) || ref === 0) return NaN;
  return venue - ref;
}
function basisBps(venue, ref) {
  if (!Number.isFinite(venue) || !Number.isFinite(ref) || ref === 0) return NaN;
  return ((venue / ref) - 1) * 10000.0;
}

// ---------- UI updates ----------
function setGlobalError(msg) {
  $("globalError").textContent = msg || "";
}

function setGlobalStatus() {
  // If Pyth is missing, you can't compute basis → treat as WARN/BAD
  const now = nowMs();
  const pOk = state.pyth.lastOkMs && (now - state.pyth.lastOkMs) <= STALE_MS;
  const bOk = state.binance.lastOkMs && (now - state.binance.lastOkMs) <= STALE_MS;
  const hOk = state.hl.lastOkMs && (now - state.hl.lastOkMs) <= STALE_MS;

  let badge = $("globalStatus");
  badge.classList.remove("ok", "warn", "bad");

  let text = "LIVE";
  let cls = "ok";

  if (!pOk) { text = "STALE"; cls = "warn"; }
  if (!pOk && (!state.pyth.lastOkMs)) { text = "ERROR"; cls = "bad"; }

  // if multiple feeds failing, degrade
  if (pOk && (!bOk || !hOk)) { text = "PARTIAL"; cls = "warn"; }

  badge.textContent = text;
  badge.classList.add(cls);

  // Updated field
  const last = state.lastTickMs;
  $("globalUpdated").textContent = last ? `${Math.round((now - last)/1000)}s ago` : "—";
}

function paintStrip() {
  // Pyth
  setDot("dotPyth", statusFromAge(state.pyth.lastOkMs));
  $("pxPyth").textContent = fmtUsd(state.pyth.price, 2);
  $("agePyth").textContent = ageText(state.pyth.lastOkMs);

  // Binance
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

  // HL
  setDot("dotHL", statusFromAge(state.hl.lastOkMs));
  $("pxHL").textContent = fmtUsd(state.hl.mid, 2);
  $("ageHL").textContent = ageText(state.hl.lastOkMs);
}

function paintTable() {
  const ref = state.pyth.price;

  // footer ref
  $("refPyth").textContent = fmtUsd(ref, 2);
  $("refPythTime").textContent = state.pyth.publishTimeMs ? new Date(state.pyth.publishTimeMs).toLocaleString() : "—";

  // Binance
  const bMid = state.binance.mid;
  const bUsd = basisUsd(bMid, ref);
  const bBps = basisBps(bMid, ref);

  $("tblBinanceMid").textContent = fmtUsd(bMid, 2);
  $("tblBinanceBasisUsd").textContent = Number.isFinite(bUsd) ? fmtUsd(bUsd, 2) : "—";
  $("tblBinanceBasisBps").textContent = Number.isFinite(bBps) ? fmtBps(bBps) : "—";

  if (Number.isFinite(state.binance.lastFundingRate)) {
    const frPct = state.binance.lastFundingRate * 100;
    const sign = frPct > 0 ? "+" : "";
    $("tblBinanceFunding").textContent = `${sign}${fmtNum(frPct, 4)}%`;
  } else {
    $("tblBinanceFunding").textContent = "—";
  }

  $("tblBinanceNextFunding").textContent =
    state.binance.nextFundingTimeMs ? new Date(state.binance.nextFundingTimeMs).toLocaleTimeString() : "—";

  $("tblBinanceAge").textContent = ageText(state.binance.lastOkMs);

  // HL
  const hMid = state.hl.mid;
  const hUsd = basisUsd(hMid, ref);
  const hBps = basisBps(hMid, ref);

  $("tblHLMid").textContent = fmtUsd(hMid, 2);
  $("tblHLBasisUsd").textContent = Number.isFinite(hUsd) ? fmtUsd(hUsd, 2) : "—";
  $("tblHLBasisBps").textContent = Number.isFinite(hBps) ? fmtBps(hBps) : "—";
  $("tblHLAge").textContent = ageText(state.hl.lastOkMs);
}

// ---------- Chart ----------
function buildChart() {
  const ctx = $("basisChart").getContext("2d");

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "BINANCE basis",
          data: [],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.15
        },
        {
          label: "HYPERLIQUID basis",
          data: [],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.15
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      animation: false,
      plugins: {
        legend: { labels: { color: "#d9dee7", font: { family: "monospace" } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return state.unit === "usd" ? `${ctx.dataset.label}: ${fmtUsd(v, 2)}` : `${ctx.dataset.label}: ${fmtBps(v)} bps`;
            }
          }
        }
      },
      scales: {
        x: {
          type: "time",
          time: { tooltipFormat: "HH:mm:ss" },
          ticks: { color: "#8b93a7" },
          grid: { color: "rgba(26,31,42,0.9)" }
        },
        y: {
          ticks: {
            color: "#8b93a7",
            callback: (v) => state.unit === "usd" ? fmtNum(v, 0) : fmtNum(v, 0)
          },
          grid: { color: "rgba(26,31,42,0.9)" }
        }
      }
    }
  });

  state.chart = chart;
}

function pruneSeries() {
  const cutoff = nowMs() - state.windowMs;
  for (const k of Object.keys(state.series)) {
    state.series[k] = state.series[k].filter(p => p.t >= cutoff);
  }
}

function syncChart() {
  if (!state.chart) return;

  pruneSeries();

  const pick = (p) => ({ x: p.t, y: state.unit === "usd" ? p.usd : p.bps });

  state.chart.data.datasets[0].data = state.series.binance.map(pick);
  state.chart.data.datasets[1].data = state.series.hl.map(pick);

  state.chart.update("none");
}

// ---------- Poll loop ----------
async function tick() {
  if (state.paused) return;

  const started = nowMs();
  state.lastTickMs = started;
  setGlobalError("");

  // Fetch in parallel, but basis computation needs Pyth
  const [pythR, binR, hlR] = await Promise.allSettled([
    fetchPythXauUsd(),
    fetchBinanceMidAndFunding(),
    fetchHyperliquidMid()
  ]);

  // Pyth
  if (pythR.status === "fulfilled") {
    state.pyth.price = pythR.value.price;
    state.pyth.publishTimeMs = pythR.value.publishTimeMs;
    state.pyth.lastOkMs = started;
    state.pyth.err = "";
  } else {
    state.pyth.err = String(pythR.reason?.message || pythR.reason);
  }

  // Binance
  if (binR.status === "fulfilled") {
    state.binance.mid = binR.value.mid;
    state.binance.lastFundingRate = binR.value.lastFundingRate;
    state.binance.nextFundingTimeMs = binR.value.nextFundingTimeMs;
    state.binance.lastOkMs = started;
    state.binance.err = "";
  } else {
    state.binance.err = String(binR.reason?.message || binR.reason);
  }

  // Hyperliquid
  if (hlR.status === "fulfilled") {
    state.hl.mid = hlR.value.mid;
    state.hl.lastOkMs = started;
    state.hl.err = "";
  } else {
    state.hl.err = String(hlR.reason?.message || hlR.reason);
  }

  // If we have reference, append basis points for successful venues
  const ref = state.pyth.price;
  if (Number.isFinite(ref)) {
    if (binR.status === "fulfilled") {
      state.series.binance.push({
        t: started,
        usd: basisUsd(state.binance.mid, ref),
        bps: basisBps(state.binance.mid, ref)
      });
    }
    if (hlR.status === "fulfilled") {
      state.series.hl.push({
        t: started,
        usd: basisUsd(state.hl.mid, ref),
        bps: basisBps(state.hl.mid, ref)
      });
    }
  }

  // Display any errors (non-blocking)
  const errs = [];
  if (state.pyth.err) errs.push(`PYTH: ${state.pyth.err}`);
  if (state.binance.err) errs.push(`BINANCE: ${state.binance.err}`);
  if (state.hl.err) errs.push(`HYPERLIQUID: ${state.hl.err}`);
  setGlobalError(errs.join(" • "));

  // Paint UI
  setGlobalStatus();
  paintStrip();
  paintTable();
  syncChart();
}

let timer = null;
function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, state.refreshMs);
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------- Controls ----------
function wireControls() {
  $("refreshSelect").addEventListener("change", (e) => {
    state.refreshMs = Number(e.target.value);
    startTimer();
  });

  $("windowSelect").addEventListener("change", (e) => {
    state.windowMs = Number(e.target.value);
    pruneSeries();
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
    tick(); // immediate refresh
    setGlobalStatus();
  });
}

// ---------- Boot ----------
(function boot() {
  wireControls();
  buildChart();
  tick();
  startTimer();
})();
