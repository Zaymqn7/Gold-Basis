// GOLD BASIS MONITOR (no Chart.js time adapter needed)
//
// Pyth = reference (oracle price)
// Binance = true mid from bid/ask
// Hyperliquid = mid from allMids

// ---------- Config ----------
const PYTH_XAU_USD_ID =
  "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";

const PYTH_LATEST_URL = "https://hermes.pyth.network/v2/updates/price/latest";

// Binance USD-M Futures
const BINANCE_BOOK_TICKER =
  "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=XAUUSDT";
const BINANCE_PREMIUM_INDEX =
  "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XAUUSDT";

// Hyperliquid
const HL_INFO = "https://api.hyperliquid.xyz/info";
const HL_ASSET = "GOLD"; // if HL uses a different key, we attempt to auto-find GOLD-ish keys

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
  const s = Math.max(0, Math.round((nowMs() - lastOkMs) / 1000));
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
  // HH:MM:SS in local time
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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

  const lastFundingRate = Number(prem.lastFundingRate); // e.g. 0.0001
  const nextFundingTimeMs = Number(prem.nextFundingTime);

  if (!Number.isFinite(mid)) throw new Error("Binance mid not finite");
  return { mid, lastFundingRate, nextFundingTimeMs };
}

async function fetchHyperliquidMid() {
  // 1) Get perp dex list so we can find the TradFi / flx dex
  const dexsRes = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "perpDexs" }),
  });
  if (!dexsRes.ok) throw new Error(`Hyperliquid perpDexs HTTP ${dexsRes.status}`);

  const dexs = await dexsRes.json();
  const dexObjs = (Array.isArray(dexs) ? dexs : []).filter(
    (x) => x && typeof x === "object" && x.name
  );

  // Prefer flx (your UI shows flx:GOLD). Fallbacks included.
  const dexName =
    dexObjs.find((d) => String(d.name).toLowerCase() === "flx")?.name ||
    dexObjs.find((d) => String(d.name).toLowerCase().includes("trad"))?.name ||
    "flx";

  // 2) Pull mids for that specific perp dex
  const midsRes = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids", dex: dexName }),
  });
  if (!midsRes.ok) throw new Error(`Hyperliquid allMids HTTP ${midsRes.status}`);

  const mids = await midsRes.json();

  // 3) Find the GOLD market key in that dex's mids
  const candidates = ["GOLD", "flx:GOLD", "GOLD-USDC"];
  let px = null;

  for (const k of candidates) {
    if (mids && mids[k] != null) { px = mids[k]; break; }
  }

  // fallback: any key containing "GOLD"
  if (px == null && mids && typeof mids === "object") {
    const hit = Object.keys(mids).find((k) => k.toUpperCase().includes("GOLD"));
    if (hit) px = mids[hit];
  }

  const mid = Number(px);
  if (!Number.isFinite(mid)) {
    const goldKeys =
      mids && typeof mids === "object"
        ? Object.keys(mids).filter((k) => k.toUpperCase().includes("GOLD")).slice(0, 20)
        : [];
    throw new Error(
      `Hyperliquid: GOLD not found on dex="${dexName}". GOLD-like keys: ${goldKeys.join(", ")}`
    );
  }

  return { mid };
}
);

  if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);

  const data = await res.json();

  const universe = data?.[0]?.universe;
  const ctxs = data?.[1];

  if (!Array.isArray(universe) || !Array.isArray(ctxs)) {
    throw new Error("Hyperliquid: unexpected metaAndAssetCtxs response shape");
  }

  // We’ll match the “TradFi” GOLD market safely.
  // Common names you might see: "flx:GOLD", "GOLD", sometimes "XAU".
  const targets = ["flx:GOLD", "GOLD", "GOLD-USDC", "XAU"];

  // 1) try exact match first
  let idx = -1;
  for (const t of targets) {
    idx = universe.findIndex((u) => (u?.name || "").toUpperCase() === t.toUpperCase());
    if (idx !== -1) break;
  }

  // 2) fallback: contains match
  if (idx === -1) {
    idx = universe.findIndex((u) => (u?.name || "").toUpperCase().includes("GOLD"));
  }

  if (idx === -1) {
    // Helpful error: show any universe names containing "GOLD"
    const goldLike = universe
      .map((u) => u?.name)
      .filter((n) => typeof n === "string" && n.toUpperCase().includes("GOLD"))
      .slice(0, 20);

    throw new Error(`Hyperliquid: GOLD market not found. GOLD-like names: ${goldLike.join(", ")}`);
  }

  const ctx = ctxs[idx];
  const mid = Number(ctx?.midPx ?? ctx?.markPx);

  if (!Number.isFinite(mid)) {
    throw new Error(`Hyperliquid: midPx not finite for ${universe[idx]?.name}`);
  }

  return { mid };
}),
  });

  if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
  const data = await res.json();

  let px = data?.[HL_ASSET];

  if (px == null) {
    const keys = Object.keys(data || {});
    const hit =
      keys.find((k) => k.toUpperCase() === HL_ASSET.toUpperCase()) ||
      keys.find((k) => k.toUpperCase().includes("GOLD"));
    if (hit) px = data[hit];
  }

  const mid = Number(px);
  if (!Number.isFinite(mid)) throw new Error(`Hyperliquid mid missing for ${HL_ASSET}`);
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
  unit: "usd", // "usd" | "bps"
  lastTickMs: 0,

  pyth: { price: NaN, publishTimeMs: 0, lastOkMs: 0, err: "" },
  binance: { mid: NaN, lastFundingRate: NaN, nextFundingTimeMs: 0, lastOkMs: 0, err: "" },
  hl: { mid: NaN, lastOkMs: 0, err: "" },

  // unified time series points
  // { t, binUsd, binBps, hlUsd, hlBps }
  points: [],

  chart: null,
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

  const badge = $("globalStatus");
  if (badge) {
    badge.classList.remove("ok", "warn", "bad");

    let text = "LIVE";
    let cls = "ok";

    if (!pOk) { text = state.pyth.lastOkMs ? "STALE" : "ERROR"; cls = state.pyth.lastOkMs ? "warn" : "bad"; }
    if (pOk && (!bOk || !hOk)) { text = "PARTIAL"; cls = "warn"; }

    badge.textContent = text;
    badge.classList.add(cls);
  }

  const upd = $("globalUpdated");
  if (upd) upd.textContent = state.lastTickMs ? `${Math.round((now - state.lastTickMs)/1000)}s ago` : "—";
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

  $("tblBinanceAge").textContent = ageText(state.binance.lastOkMs);

  // Hyperliquid
  const hUsd = basisUsd(state.hl.mid, ref);
  const hBps = basisBps(state.hl.mid, ref);

  $("tblHLMid").textContent = fmtUsd(state.hl.mid, 2);
  $("tblHLBasisUsd").textContent = hUsd == null ? "—" : fmtUsd(hUsd, 2);
  $("tblHLBasisBps").textContent = hBps == null ? "—" : fmtBps(hBps);
  $("tblHLAge").textContent = ageText(state.hl.lastOkMs);
}

// ---------- Chart (category axis, no adapters) ----------
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
  const hl = state.points.map((p) => (state.unit === "usd" ? p.hlUsd : p.hlBps));

  state.chart.data.labels = labels;
  state.chart.data.datasets[0].data = bin;
  state.chart.data.datasets[1].data = hl;

  state.chart.update("none");
}

// ---------- Poll loop ----------
async function tick() {
  if (state.paused) return;

  const started = nowMs();
  state.lastTickMs = started;
  setGlobalError("");

  const [pythR, binR, hlR] = await Promise.allSettled([
    fetchPythXauUsd(),
    fetchBinanceMidAndFunding(),
    fetchHyperliquidMid(),
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

  // Append unified point (nulls create chart gaps)
  const ref = state.pyth.price;
  const binUsd = basisUsd(state.binance.mid, ref);
  const binBps = basisBps(state.binance.mid, ref);
  const hlUsd = basisUsd(state.hl.mid, ref);
  const hlBps = basisBps(state.hl.mid, ref);

  state.points.push({
    t: started,
    binUsd,
    binBps,
    hlUsd,
    hlBps,
  });

  // Errors to display (non-blocking)
  const errs = [];
  if (state.pyth.err) errs.push(`PYTH: ${state.pyth.err}`);
  if (state.binance.err) errs.push(`BINANCE: ${state.binance.err}`);
  if (state.hl.err) errs.push(`HYPERLIQUID: ${state.hl.err}`);
  setGlobalError(errs.join(" • "));

  setGlobalStatus();
  paintStrip();
  paintTable();
  syncChart();
}

let timer = null;
function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    tick().catch((e) => setGlobalError(`TICK: ${String(e?.message || e)}`));
  }, state.refreshMs);
}

// ---------- Controls ----------
function wireControls() {
  $("refreshSelect").addEventListener("change", (e) => {
    state.refreshMs = Number(e.target.value);
    startTimer();
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
    startTimer();
  } catch (e) {
    setGlobalError(`BOOT: ${String(e?.message || e)}`);
    console.error(e);
  }
})();
