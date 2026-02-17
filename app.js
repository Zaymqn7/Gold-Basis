// Gold Basis Dashboard - Modern Clean Version
// ============================================

// CONFIGURATION
// ============================================
const CONFIG = {
  PYTH_ID: "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
  PYTH_URL: "https://hermes.pyth.network/v2/updates/price/latest",
  BIN_BOOK: "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=XAUUSDT",
  BIN_PREM: "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XAUUSDT",
  BIN_SPOT: "https://api.binance.com/api/v3/ticker/bookTicker?symbol=USDCUSDT",
  HL_INFO: "https://api.hyperliquid.xyz/info",
  MET_URL: "https://dlmm.datapi.meteora.ag/pools/3Vj8miZuTSdonf4W1xLdYFatrXLm38CShrCi7NbZS5Ah",
  STALE_MS: 30000
};

// Pull colors from CSS variables so the dashboard theme is the source of truth
const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

const COLORS = {
  binance: cssVar('--chart-binance', '#f2b84b'),
  hl: cssVar('--chart-hl', '#2ee59d'),
  meteora: cssVar('--chart-meteora', '#b38cff'),
  pyth: cssVar('--chart-pyth', '#f2b84b'),
  funding: cssVar('--chart-funding', '#4ed6e0'),
  grid: 'rgba(255, 255, 255, 0.06)',
  text: 'rgba(210, 220, 238, 0.62)',
  textLight: 'rgba(242, 246, 255, 0.92)',
  tooltipBg: 'rgba(14, 20, 31, 0.92)',
  tooltipBorder: 'rgba(255, 255, 255, 0.10)'
};

// ============================================
// UTILITIES
// ============================================
const $ = id => document.getElementById(id);

const setText = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text;
};

const formatUsd = (n, decimals = 2) => {
  if (!Number.isFinite(n)) return '--';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatNum = (n, decimals = 2) => {
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatBps = n => {
  if (!Number.isFinite(n)) return '--';
  return (n > 0 ? '+' : '') + formatNum(n, 2);
};

const formatPct = (n, decimals = 2) => {
  if (!Number.isFinite(n)) return '--';
  return (n > 0 ? '+' : '') + formatNum(n, decimals) + '%';
};

const timeAgo = ms => {
  if (!ms) return '--';
  const secs = Math.floor((Date.now() - ms) / 1000);
  return secs + 's ago';
};

const formatTime = ms => new Date(ms).toLocaleTimeString('en-US', { hour12: false });

// Calculations
const basisUsd = (price, ref) => (Number.isFinite(price) && Number.isFinite(ref) && ref !== 0) ? price - ref : null;
const basisBps = (price, ref) => (Number.isFinite(price) && Number.isFinite(ref) && ref !== 0) ? ((price / ref) - 1) * 10000 : null;
const fundingApy = rate => Number.isFinite(rate) ? (Math.pow(1 + rate, 1095) - 1) * 100 : null;
const inGoldRange = x => Number.isFinite(x) && x > 100 && x < 10000;

// ============================================
// STATE
// ============================================
const state = {
  paused: false,
  refreshMs: 5000,
  windowMs: 3600000,
  unit: 'usd',
  lastTick: 0,

  pyth: { price: NaN, pubMs: 0, okMs: 0, latMs: 0, err: '' },
  binF: { mid: NaN, fundRate: NaN, nextFundMs: 0, okMs: 0, latMs: 0, err: '' },
  binS: { mid: NaN, okMs: 0, latMs: 0, err: '' },
  hl: { mid: NaN, okMs: 0, latMs: 0, err: '' },
  met: { mid: NaN, okMs: 0, latMs: 0, err: '' },

  points: [],
  prevPrice: NaN,
  charts: { pyth: null, basis: null, disloc: null, funding: null }
};

// ============================================
// DATA FETCHERS
// ============================================
async function timedFetch(fn) {
  const start = performance.now();
  try {
    const result = await fn();
    return { ok: true, data: result, ms: Math.round(performance.now() - start), err: '' };
  } catch (e) {
    return { ok: false, data: null, ms: Math.round(performance.now() - start), err: e.message || String(e) };
  }
}

async function fetchPyth() {
  const res = await fetch(`${CONFIG.PYTH_URL}?ids[]=${encodeURIComponent(CONFIG.PYTH_ID)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const parsed = data?.parsed?.[0];
  if (!parsed?.price) throw new Error('Invalid data');
  const price = Number(parsed.price.price) * Math.pow(10, Number(parsed.price.expo));
  if (!Number.isFinite(price)) throw new Error('Invalid price');
  return { price, pubMs: Number(parsed.price.publish_time) * 1000 };
}

async function fetchBinanceFutures() {
  const [bookRes, premRes] = await Promise.all([fetch(CONFIG.BIN_BOOK), fetch(CONFIG.BIN_PREM)]);
  if (!bookRes.ok || !premRes.ok) throw new Error('HTTP error');
  const [book, prem] = await Promise.all([bookRes.json(), premRes.json()]);
  const mid = (Number(book.bidPrice) + Number(book.askPrice)) / 2;
  if (!Number.isFinite(mid)) throw new Error('Invalid mid');
  return { mid, fundRate: Number(prem.lastFundingRate), nextFundMs: Number(prem.nextFundingTime) };
}

async function fetchBinanceSpot() {
  const res = await fetch(CONFIG.BIN_SPOT);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const mid = (Number(data.bidPrice) + Number(data.askPrice)) / 2;
  if (!Number.isFinite(mid) || mid <= 0) throw new Error('Invalid mid');
  return { mid };
}

async function fetchHyperliquid() {
  const dexRes = await fetch(CONFIG.HL_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'perpDexs' })
  });
  if (!dexRes.ok) throw new Error('Dex fetch failed');
  const dexs = await dexRes.json();
  const dexName = (Array.isArray(dexs) ? dexs : []).find(d => String(d?.name).toLowerCase() === 'flx')?.name || 'flx';

  const midsRes = await fetch(CONFIG.HL_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids', dex: dexName })
  });
  if (!midsRes.ok) throw new Error('Mids fetch failed');

  const mids = await midsRes.json();
  let price = mids?.['GOLD'] ?? mids?.['flx:GOLD'] ?? mids?.['GOLD-USDC'];
  if (price == null && mids) {
    const key = Object.keys(mids).find(k => k.toUpperCase().includes('GOLD'));
    if (key) price = mids[key];
  }
  const mid = Number(price);
  if (!Number.isFinite(mid)) throw new Error('Invalid mid');
  return { mid };
}

async function fetchMeteora() {
  const res = await fetch(CONFIG.MET_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const price = Number(data?.current_price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid price');
  const inv = 1 / price;
  const mid = inGoldRange(price) ? price : inGoldRange(inv) ? inv : price;
  if (!Number.isFinite(mid)) throw new Error('Invalid mid');
  return { mid };
}

// ============================================
// UI UPDATE FUNCTIONS
// ============================================
function updateHeader() {
  const price = state.pyth.price;
  const priceEl = $('price');

  // Animate price changes
  if (priceEl && Number.isFinite(price)) {
    const newText = formatUsd(price, 2);
    if (priceEl.textContent !== newText) {
      priceEl.textContent = newText;

      if (Number.isFinite(state.prevPrice)) {
        priceEl.classList.remove('value-flash-up', 'value-flash-down');
        void priceEl.offsetWidth;
        priceEl.classList.add(price > state.prevPrice ? 'value-flash-up' : 'value-flash-down');
      }
    }
  }

  // Change from first point in window
  let change = NaN, changePct = NaN;
  if (state.points.length >= 2) {
    const first = state.points[0]?.pyth;
    const last = state.points[state.points.length - 1]?.pyth;
    if (Number.isFinite(first) && Number.isFinite(last)) {
      change = last - first;
      changePct = (change / first) * 100;
    }
  }

  const changeEl = $('change');
  const changeValEl = $('changeVal');
  const changePctEl = $('changePct');

  if (changeEl && changeValEl && changePctEl) {
    changeEl.classList.remove('positive', 'negative');
    if (Number.isFinite(change)) {
      changeValEl.textContent = (change > 0 ? '+' : '') + formatNum(change, 2);
      changePctEl.textContent = `(${formatPct(changePct, 2)})`;
      changeEl.classList.add(change >= 0 ? 'positive' : 'negative');
    } else {
      changeValEl.textContent = '--';
      changePctEl.textContent = '(--)';
    }
  }

  setText('updatedText', `Updated ${timeAgo(state.lastTick)}`);
}

function updateStatus() {
  const now = Date.now();
  const pythOk = state.pyth.okMs && (now - state.pyth.okMs) <= CONFIG.STALE_MS;
  const allOk = pythOk &&
    state.binF.okMs && (now - state.binF.okMs) <= CONFIG.STALE_MS &&
    state.hl.okMs && (now - state.hl.okMs) <= CONFIG.STALE_MS &&
    state.met.okMs && (now - state.met.okMs) <= CONFIG.STALE_MS;

  const dot = $('statusDot');
  const text = $('statusText');
  const indicator = dot?.parentElement;

  if (dot && text && indicator) {
    dot.classList.remove('warning', 'error');
    text.classList.remove('warning', 'error');

    if (state.paused) {
      dot.classList.add('warning');
      text.classList.add('warning');
      text.textContent = 'PAUSED';
    } else if (!pythOk) {
      dot.classList.add('error');
      text.classList.add('error');
      text.textContent = 'ERROR';
    } else if (!allOk) {
      dot.classList.add('warning');
      text.classList.add('warning');
      text.textContent = 'PARTIAL';
    } else {
      text.textContent = 'LIVE';
    }
  }
}

function updateFeedStatus() {
  const now = Date.now();
  const feeds = [
    { id: 'feedPyth', okMs: state.pyth.okMs },
    { id: 'feedBinance', okMs: state.binF.okMs },
    { id: 'feedHL', okMs: state.hl.okMs },
    { id: 'feedMeteora', okMs: state.met.okMs }
  ];

  feeds.forEach(feed => {
    const el = $(feed.id);
    if (el) {
      el.classList.remove('warn', 'err');
      if (!feed.okMs) el.classList.add('err');
      else if (now - feed.okMs > CONFIG.STALE_MS) el.classList.add('warn');
    }
  });
}

function updateErrors() {
  const errors = [state.pyth.err, state.binF.err, state.binS.err, state.hl.err, state.met.err].filter(Boolean);
  const banner = $('errorBanner');
  if (banner) {
    banner.textContent = errors.join(' • ');
    banner.classList.toggle('visible', errors.length > 0);
  }
}

function setValueClass(id, value) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('value-positive', 'value-negative');
  if (Number.isFinite(value)) {
    if (value > 0) el.classList.add('value-positive');
    else if (value < 0) el.classList.add('value-negative');
  }
}

function updatePriceMatrix() {
  const ref = state.pyth.price;

  // Binance
  const binBasisU = basisUsd(state.binF.mid, ref);
  const binBasisB = basisBps(state.binF.mid, ref);
  setText('binMid', formatUsd(state.binF.mid, 2));
  setText('binBasisUsd', binBasisU != null ? formatUsd(binBasisU, 2) : '--');
  setText('binBasisBps', binBasisB != null ? formatBps(binBasisB) : '--');
  setValueClass('binBasisUsd', binBasisU);
  setValueClass('binBasisBps', binBasisB);
  setText('binFund', Number.isFinite(state.binF.fundRate) ? formatPct(state.binF.fundRate * 100, 4) : '--');
  setText('binNext', state.binF.nextFundMs ? formatTime(state.binF.nextFundMs) : '--');

  // Hyperliquid
  const hlBasisU = basisUsd(state.hl.mid, ref);
  const hlBasisB = basisBps(state.hl.mid, ref);
  setText('hlMid', formatUsd(state.hl.mid, 2));
  setText('hlBasisUsd', hlBasisU != null ? formatUsd(hlBasisU, 2) : '--');
  setText('hlBasisBps', hlBasisB != null ? formatBps(hlBasisB) : '--');
  setValueClass('hlBasisUsd', hlBasisU);
  setValueClass('hlBasisBps', hlBasisB);

  // Meteora
  const metBasisU = basisUsd(state.met.mid, ref);
  const metBasisB = basisBps(state.met.mid, ref);
  setText('metMid', formatUsd(state.met.mid, 2));
  setText('metBasisUsd', metBasisU != null ? formatUsd(metBasisU, 2) : '--');
  setText('metBasisBps', metBasisB != null ? formatBps(metBasisB) : '--');
  setValueClass('metBasisUsd', metBasisU);
  setValueClass('metBasisBps', metBasisB);

  // Conversion stats
  setText('usdcMid', formatNum(state.binS.mid, 6));
  const implied = (Number.isFinite(state.binF.mid) && Number.isFinite(state.binS.mid) && state.binS.mid > 0)
    ? state.binF.mid / state.binS.mid
    : NaN;
  setText('xauUsdcImplied', formatUsd(implied, 2));
}

// ============================================
// CHARTS
// ============================================
function buildCharts() {
  if (typeof Chart === 'undefined') return;

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 280 },
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: COLORS.tooltipBg,
        titleColor: COLORS.textLight,
        bodyColor: COLORS.textLight,
        borderColor: COLORS.tooltipBorder,
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: { title: items => items[0]?.label || '' }
      }
    },
    scales: {
      x: {
        grid: { color: COLORS.grid, drawBorder: false },
        ticks: { color: COLORS.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 10 } },
        border: { display: false }
      },
      y: {
        grid: { color: COLORS.grid, drawBorder: false },
        ticks: { color: COLORS.text, font: { size: 10 } },
        border: { display: false }
      }
    }
  };

  // Pyth chart
  const pythCtx = $('chartPyth')?.getContext('2d');
  if (pythCtx) {
    const gradient = pythCtx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(242, 184, 75, 0.22)');
    gradient.addColorStop(1, 'rgba(242, 184, 75, 0)');
    state.charts.pyth = new Chart(pythCtx, {
      type: 'line',
      data: { labels: [], datasets: [{ data: [], borderColor: COLORS.pyth, backgroundColor: gradient, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true }] },
      options: baseOptions
    });
  }

  // Basis chart
  const basisCtx = $('chartBasis')?.getContext('2d');
  if (basisCtx) {
    state.charts.basis = new Chart(basisCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { data: [], borderColor: COLORS.binance, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false },
          { data: [], borderColor: COLORS.hl, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false },
          { data: [], borderColor: COLORS.meteora, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false }
        ]
      },
      options: baseOptions
    });
  }

  // Dislocations chart
  const dislocCtx = $('chartDisloc')?.getContext('2d');
  if (dislocCtx) {
    const gradientMet = dislocCtx.createLinearGradient(0, 0, 0, 230);
    gradientMet.addColorStop(0, 'rgba(179, 140, 255, 0.22)');
    gradientMet.addColorStop(1, 'rgba(179, 140, 255, 0)');

    const gradientHl = dislocCtx.createLinearGradient(0, 0, 0, 230);
    gradientHl.addColorStop(0, 'rgba(46, 229, 157, 0.18)');
    gradientHl.addColorStop(1, 'rgba(46, 229, 157, 0)');

    state.charts.disloc = new Chart(dislocCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { data: [], borderColor: COLORS.meteora, backgroundColor: gradientMet, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true },
          { data: [], borderColor: COLORS.hl, backgroundColor: gradientHl, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true }
        ]
      },
      options: baseOptions
    });
  }

  // Funding chart
  const fundingCtx = $('chartFunding')?.getContext('2d');
  if (fundingCtx) {
    const gradient = fundingCtx.createLinearGradient(0, 0, 0, 230);
    gradient.addColorStop(0, 'rgba(78, 214, 224, 0.18)');
    gradient.addColorStop(1, 'rgba(78, 214, 224, 0)');

    state.charts.funding = new Chart(fundingCtx, {
      type: 'line',
      data: { labels: [], datasets: [{ data: [], borderColor: COLORS.funding, backgroundColor: gradient, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true }] },
      options: {
        ...baseOptions,
        scales: {
          ...baseOptions.scales,
          y: {
            ...baseOptions.scales.y,
            ticks: { ...baseOptions.scales.y.ticks, callback: v => Number(v).toFixed(2) + '%' }
          }
        }
      }
    });
  }
}

function prunePoints() {
  const cutoff = Date.now() - state.windowMs;
  state.points = state.points.filter(p => p.t >= cutoff);
}

function updateCharts() {
  prunePoints();
  const labels = state.points.map(p => formatTime(p.t));

  if (state.charts.pyth) {
    state.charts.pyth.data.labels = labels;
    state.charts.pyth.data.datasets[0].data = state.points.map(p => p.pyth);
    state.charts.pyth.update('none');
  }

  if (state.charts.basis) {
    state.charts.basis.data.labels = labels;
    state.charts.basis.data.datasets[0].data = state.points.map(p => state.unit === 'usd' ? p.binBasisUsd : p.binBasisBps);
    state.charts.basis.data.datasets[1].data = state.points.map(p => state.unit === 'usd' ? p.hlBasisUsd : p.hlBasisBps);
    state.charts.basis.data.datasets[2].data = state.points.map(p => state.unit === 'usd' ? p.metBasisUsd : p.metBasisBps);
    state.charts.basis.update('none');
  }

  if (state.charts.disloc) {
    state.charts.disloc.data.labels = labels;
    state.charts.disloc.data.datasets[0].data = state.points.map(p => state.unit === 'usd' ? p.dislocMBusd : p.dislocMBbps);
    state.charts.disloc.data.datasets[1].data = state.points.map(p => state.unit === 'usd' ? p.dislocMHusd : p.dislocMHbps);
    state.charts.disloc.update('none');
  }

  if (state.charts.funding) {
    state.charts.funding.data.labels = labels;
    state.charts.funding.data.datasets[0].data = state.points.map(p => p.apy);
    state.charts.funding.update('none');
  }
}

// ============================================
// MAIN TICK
// ============================================
async function tick() {
  if (state.paused) return;

  const now = Date.now();
  state.lastTick = now;
  state.prevPrice = state.pyth.price;

  const [pyth, binF, binS, hl, met] = await Promise.all([
    timedFetch(fetchPyth),
    timedFetch(fetchBinanceFutures),
    timedFetch(fetchBinanceSpot),
    timedFetch(fetchHyperliquid),
    timedFetch(fetchMeteora)
  ]);

  if (pyth.ok) {
    state.pyth.price = pyth.data.price;
    state.pyth.pubMs = pyth.data.pubMs;
    state.pyth.okMs = now;
    state.pyth.err = '';
  } else {
    state.pyth.err = 'Pyth: ' + pyth.err;
  }
  state.pyth.latMs = pyth.ms;

  if (binF.ok) {
    state.binF.mid = binF.data.mid;
    state.binF.fundRate = binF.data.fundRate;
    state.binF.nextFundMs = binF.data.nextFundMs;
    state.binF.okMs = now;
    state.binF.err = '';
  } else {
    state.binF.err = 'Binance: ' + binF.err;
  }
  state.binF.latMs = binF.ms;

  if (binS.ok) {
    state.binS.mid = binS.data.mid;
    state.binS.okMs = now;
    state.binS.err = '';
  } else {
    state.binS.err = 'Binance Spot: ' + binS.err;
  }
  state.binS.latMs = binS.ms;

  if (hl.ok) {
    state.hl.mid = hl.data.mid;
    state.hl.okMs = now;
    state.hl.err = '';
  } else {
    state.hl.err = 'Hyperliquid: ' + hl.err;
  }
  state.hl.latMs = hl.ms;

  if (met.ok) {
    state.met.mid = met.data.mid;
    state.met.okMs = now;
    state.met.err = '';
  } else {
    state.met.err = 'Meteora: ' + met.err;
  }
  state.met.latMs = met.ms;

  // Derived values
  const ref = state.pyth.price;
  const binBasisUsd = basisUsd(state.binF.mid, ref);
  const binBasisBps = basisBps(state.binF.mid, ref);
  const hlBasisUsd = basisUsd(state.hl.mid, ref);
  const hlBasisBps = basisBps(state.hl.mid, ref);
  const metBasisUsd = basisUsd(state.met.mid, ref);
  const metBasisBps = basisBps(state.met.mid, ref);

  const dislocMBusd = (Number.isFinite(state.met.mid) && Number.isFinite(state.binF.mid)) ? state.met.mid - state.binF.mid : null;
  const dislocMBbps = (dislocMBusd != null && state.binF.mid) ? ((state.met.mid / state.binF.mid) - 1) * 10000 : null;

  const dislocMHusd = (Number.isFinite(state.met.mid) && Number.isFinite(state.hl.mid)) ? state.met.mid - state.hl.mid : null;
  const dislocMHbps = (dislocMHusd != null && state.hl.mid) ? ((state.met.mid / state.hl.mid) - 1) * 10000 : null;

  state.points.push({
    t: now,
    pyth: Number.isFinite(ref) ? ref : null,
    binBasisUsd, binBasisBps,
    hlBasisUsd, hlBasisBps,
    metBasisUsd, metBasisBps,
    dislocMBusd, dislocMBbps,
    dislocMHusd, dislocMHbps,
    apy: fundingApy(state.binF.fundRate)
  });

  // UI update
  updateHeader();
  updateStatus();
  updateFeedStatus();
  updateErrors();
  updatePriceMatrix();
  updateCharts();
}

// ============================================
// CONTROLS & INITIALIZATION
// ============================================
let pollInterval, uiInterval;

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(tick, state.refreshMs);
}

function startUIUpdates() {
  if (uiInterval) clearInterval(uiInterval);
  uiInterval = setInterval(() => {
    updateHeader();
    updateStatus();
    updateFeedStatus();
  }, 1000);
}

function wireControls() {
  $('selRefresh')?.addEventListener('change', e => {
    state.refreshMs = Number(e.target.value);
    startPolling();
  });

  $('selWindow')?.addEventListener('change', e => {
    state.windowMs = Number(e.target.value);
    prunePoints();
    updateCharts();
  });

  $('btnUsd')?.addEventListener('click', () => {
    state.unit = 'usd';
    $('btnUsd')?.classList.add('active');
    $('btnBps')?.classList.remove('active');
    updateCharts();
  });

  $('btnBps')?.addEventListener('click', () => {
    state.unit = 'bps';
    $('btnBps')?.classList.add('active');
    $('btnUsd')?.classList.remove('active');
    updateCharts();
  });

  $('btnPause')?.addEventListener('click', () => {
    state.paused = true;
    $('btnPause').disabled = true;
    $('btnResume').disabled = false;
    updateStatus();
  });

  $('btnResume')?.addEventListener('click', () => {
    state.paused = false;
    $('btnPause').disabled = false;
    $('btnResume').disabled = true;
    tick();
    updateStatus();
  });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.key.toLowerCase()) {
      case 'r':
        if (!state.paused) tick();
        break;

      case 'p':
        if (!state.paused) {
          state.paused = true;
          $('btnPause').disabled = true;
          $('btnResume').disabled = false;
        } else {
          state.paused = false;
          $('btnPause').disabled = false;
          $('btnResume').disabled = true;
          tick();
        }
        updateStatus();
        break;

      case 'u':
        if (state.unit === 'usd') {
          state.unit = 'bps';
          $('btnBps')?.classList.add('active');
          $('btnUsd')?.classList.remove('active');
        } else {
          state.unit = 'usd';
          $('btnUsd')?.classList.add('active');
          $('btnBps')?.classList.remove('active');
        }
        updateCharts();
        break;
    }
  });
}

function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

function boot() {
  wireControls();
  buildCharts();
  tick();
  startPolling();
  startUIUpdates();
}

init();
