// Live Pyth XAU/USD polling (every 5s)

// Pyth XAU/USD feed id
const PYTH_XAU_USD_ID =
  "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";

// Pyth Hermes latest price endpoint
const PYTH_LATEST_URL = "https://hermes.pyth.network/v2/updates/price/latest";

function $(id) { return document.getElementById(id); }

function fmtUsd(x) {
  if (!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 4
  }).format(x);
}

async function fetchPythXauUsd() {
  const url = `${PYTH_LATEST_URL}?ids[]=${encodeURIComponent(PYTH_XAU_USD_ID)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pyth HTTP ${res.status}`);

  const data = await res.json();
  const parsed = data?.parsed?.[0];
  if (!parsed?.price) throw new Error("Unexpected Pyth response shape");

  // price is integer with exponent
  const p = Number(parsed.price.price);
  const expo = Number(parsed.price.expo);
  const price = p * Math.pow(10, expo);
  const publishTimeMs = Number(parsed.price.publish_time) * 1000;

  return { price, publishTimeMs };
}

function setError(msg) { $("pythError").textContent = msg || ""; }

async function refresh() {
  $("lastRefresh").textContent = new Date().toLocaleString();

  try {
    setError("");
    const { price, publishTimeMs } = await fetchPythXauUsd();
    $("pythPrice").textContent = fmtUsd(price);
    $("pythTime").textContent = new Date(publishTimeMs).toLocaleString();
  } catch (e) {
    console.error(e);
    setError(String(e?.message || e));
  }
}

refresh();
setInterval(refresh, 5000);
