// فحص يومي لكل الأسهم العادية في universe.json: يجلب سنة شموع لكل سهم، يحسب مقاييس فنية، ويحفظ أقوى 100 في data/screen.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CACHE_DIR = ".cache/screen";
const CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

mkdirSync(CACHE_DIR, { recursive: true });

const uni = JSON.parse(readFileSync("data/universe.json", "utf8")).filter((x) => x[3] && !x[4]);
if (!uni.length) { console.error("universe.json فارغ — شغّل universe.mjs أولاً"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// ======== Data Sources (same as fetch.mjs) ========
const SOURCES = {
  yahoo: {
    name: "Yahoo Finance",
    chart: (sym, range = "1y", interval = "1d") => 
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`,
    headers: { "User-Agent": UA, Accept: "application/json" },
    hosts: ["query1.finance.yahoo.com", "query2.finance.yahoo.com"],
    parseChart: (j) => j?.chart?.result?.[0],
  },
  alphaVantage: {
    name: "Alpha Vantage",
    enabled: !!process.env.ALPHA_VANTAGE_KEY,
    chart: (sym) => `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(sym)}&outputsize=full&apikey=${process.env.ALPHA_VANTAGE_KEY}`,
    parseChart: (j) => {
      const ts = j["Time Series (Daily)"];
      if (!ts) return null;
      const timestamps = [], open = [], high = [], low = [], close = [], volume = [];
      for (const [date, v] of Object.entries(ts).sort().reverse().slice(0, 252)) {
        timestamps.unshift(Math.floor(new Date(date).getTime() / 1000));
        open.unshift(parseFloat(v["1. open"]));
        high.unshift(parseFloat(v["2. high"]));
        low.unshift(parseFloat(v["3. low"]));
        close.unshift(parseFloat(v["4. close"]));
        volume.unshift(parseInt(v["6. volume"]));
      }
      return { timestamp: timestamps, indicators: { quote: [{ open, high, low, close, volume }] } };
    },
  },
  twelveData: {
    name: "Twelve Data",
    enabled: !!process.env.TWELVE_DATA_KEY,
    chart: (sym) => `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=252&apikey=${process.env.TWELVE_DATA_KEY}`,
    parseChart: (j) => {
      const v = j.values;
      if (!v || !v.length) return null;
      const timestamps = [], open = [], high = [], low = [], close = [], volume = [];
      for (const row of v.reverse()) {
        timestamps.push(Math.floor(new Date(row.datetime).getTime() / 1000));
        open.push(parseFloat(row.open));
        high.push(parseFloat(row.high));
        low.push(parseFloat(row.low));
        close.push(parseFloat(row.close));
        volume.push(parseInt(row.volume));
      }
      return { timestamp: timestamps, indicators: { quote: [{ open, high, low, close, volume }] } };
    },
  },
  finnhub: {
    name: "Finnhub",
    enabled: !!process.env.FINNHUB_KEY,
    chart: (sym) => `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(sym)}&resolution=D&from=${Math.floor(Date.now()/1000)-31536000}&to=${Math.floor(Date.now()/1000)}&token=${process.env.FINNHUB_KEY}`,
    parseChart: (j) => {
      if (j.s !== "ok" || !j.t?.length) return null;
      return { timestamp: j.t, indicators: { quote: [{ o: j.o, h: j.h, l: j.l, c: j.c, v: j.v }] } };
    },
  },
};

// ======== Cache Helpers ========
function cacheKey(source, sym, range) {
  return createHash("md5").update(`${source}:${sym}:${range}`).digest("hex");
}

function readCache(key) {
  const path = `${CACHE_DIR}/${key}.json`;
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (Date.now() - data.ts < CACHE_TTL) return data.data;
  } catch {}
  return null;
}

function writeCache(key, data) {
  writeFileSync(`${CACHE_DIR}/${key}.json`, JSON.stringify({ ts: Date.now(), data }));
}

// ======== Fetch with Failover ========
async function fetchChart(sym, range = "1y", interval = "1d") {
  const enabledSources = Object.entries(SOURCES).filter(([, s]) => s.enabled !== false);
  
  for (const [name, source] of enabledSources) {
    const key = cacheKey(name, sym, range);
    const cached = readCache(key);
    if (cached) return cached;

    const hosts = source.hosts || [new URL(source.chart(sym, range, interval)).host];
    let lastErr = "";

    for (const host of hosts) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const url = source.chart(sym, range, interval).replace(/https?:\/\/[^/]+/, `https://${host}`);
          const r = await fetch(url, { headers: source.headers, signal: AbortSignal.timeout(15000) });
          
          if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
          if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; }

          const j = await r.json();
          const parsed = source.parseChart ? source.parseChart(j) : j?.chart?.result?.[0];
          
          if (parsed?.timestamp?.length) {
            const result = normalizeChart(parsed);
            writeCache(key, result);
            return result;
          }
          lastErr = "empty data";
        } catch (e) { lastErr = String(e.message || e); }
        await sleep(500 * (attempt + 1));
      }
    }
  }
  return null;
}

function normalizeChart(parsed) {
  const q = parsed.indicators?.quote?.[0] || {};
  const o = q.o || q.open || [];
  const h = q.h || q.high || [];
  const l = q.l || q.low || [];
  const c = q.c || q.close || [];
  const v = q.v || q.volume || [];
  return { timestamp: parsed.timestamp, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } };
}

// ======== Enhanced Technical Metrics ========
export function metrics(j) {
  const res = j; // already normalized
  if (!res?.timestamp) return null;
  const q = res.indicators.quote[0], ix = [];
  res.timestamp.forEach((_, i) => { if (q.close[i] != null) ix.push(i); });
  if (ix.length < 110) return null;
  
  const c = ix.map((i) => q.close[i]), v = ix.map((i) => q.volume[i] || 0), 
        hi = ix.map((i) => q.high[i] ?? q.close[i]), lo = ix.map((i) => q.low[i] ?? q.close[i]);
  const n = c.length, p = c[n - 1];
  const sma = (k) => (n >= k ? avg(c.slice(-k)) : null);
  const ema = (k) => {
    if (n < k) return null;
    const mult = 2 / (k + 1);
    let e = c[n - k];
    for (let i = n - k + 1; i < n; i++) e = (c[i] - e) * mult + e;
    return e;
  };
  
  const s20 = sma(20), s50 = sma(50), s200 = sma(200);
  const e20 = ema(20), e50 = ema(50);
  const v20 = avg(v.slice(-21, -1)) || 1, rvol = v[n - 1] / v20;
  const adv = avg(c.slice(-20).map((x, i) => x * v[n - 20 + i]));
  const roc = (k) => (n > k ? (p / c[n - 1 - k] - 1) * 100 : 0);
  const hi52 = Math.max(...hi), dist = (hi52 - p) / hi52;
  
  // ATR calculation
  let tr = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    tr += Math.max(hi[i] - lo[i], Math.abs(hi[i] - c[i - 1]), Math.abs(lo[i] - c[i - 1]));
  }
  const atr = (tr / 14 / p) * 100;
  const atrAbs = tr / 14;
  
  // RSI
  let gains = 0, losses = 0;
  for (let i = n - 14; i < n; i++) {
    const diff = c[i] - c[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = 100 - 100 / (1 + rs);
  
  // MACD
  const ema12 = ema(12), ema26 = ema(26);
  const macdLine = ema12 && ema26 ? ema12 - ema26 : null;
  const signal = macdLine !== null ? (() => {
    const macds = [];
    for (let i = 25; i < n; i++) {
      const e12 = (() => { let e = c[i-11]; for(let j=i-10;j<=i;j++) e=(c[j]-e)*2/13+e; return e; })();
      const e26 = (() => { let e = c[i-25]; for(let j=i-24;j<=i;j++) e=(c[j]-e)*2/27+e; return e; })();
      macds.push(e12 - e26);
    }
    let s = macds[macds.length-9]; for(let i=macds.length-8;i<macds.length;i++) s=(macds[i]-s)*2/10+s; return s;
  })() : null;
  const histogram = macdLine && signal ? macdLine - signal : null;
  
  // Bollinger Bands
  const bbPeriod = 20, bbStd = 2;
  const bbMid = s20;
  const bbStdDev = bbMid ? Math.sqrt(c.slice(-bbPeriod).reduce((sum, x) => sum + Math.pow(x - bbMid, 2), 0) / bbPeriod) : 0;
  const bbUpper = bbMid ? bbMid + bbStd * bbStdDev : null;
  const bbLower = bbMid ? bbMid - bbStd * bbStdDev : null;
  const bbWidth = bbMid && bbUpper && bbLower ? (bbUpper - bbLower) / bbMid * 100 : null;
  const bbPosition = bbMid && bbUpper && bbLower ? (p - bbLower) / (bbUpper - bbLower) : null;
  
  // Stochastic
  const stochPeriod = 14;
  const stochHigh = Math.max(...hi.slice(-stochPeriod));
  const stochLow = Math.min(...lo.slice(-stochPeriod));
  const stochK = stochHigh !== stochLow ? (p - stochLow) / (stochHigh - stochLow) * 100 : 50;
  const stochD = (() => { const ks = []; for(let i=n-stochPeriod;i<n;i++){ const h=Math.max(...hi.slice(i-stochPeriod+1,i+1)), l=Math.min(...lo.slice(i-stochPeriod+1,i+1)); ks.push(h!==l?(c[i]-l)/(h-l)*100:50); } return avg(ks.slice(-3)); })();
  
  // ADX (Average Directional Index)
  const adxPeriod = 14;
  let plusDM = 0, minusDM = 0, trSum = 0;
  for (let i = n - adxPeriod; i < n; i++) {
    const up = hi[i] - hi[i - 1], down = lo[i - 1] - lo[i];
    plusDM += up > down && up > 0 ? up : 0;
    minusDM += down > up && down > 0 ? down : 0;
    trSum += Math.max(hi[i] - lo[i], Math.abs(hi[i] - c[i - 1]), Math.abs(lo[i] - c[i - 1]));
  }
  const plusDI = trSum ? (plusDM / trSum) * 100 : 0;
  const minusDI = trSum ? (minusDM / trSum) * 100 : 0;
  const dx = plusDI + minusDI ? Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 : 0;
  const adx = dx; // Simplified single-period ADX
  
  // Volume Profile / OBV
  let obv = 0;
  for (let i = 1; i < n; i++) {
    if (c[i] > c[i - 1]) obv += v[i];
    else if (c[i] < c[i - 1]) obv -= v[i];
  }
  const obvChange = v[n-1] > 0 ? (c[n-1] > c[n-2] ? v[n-1] : c[n-1] < c[n-2] ? -v[n-1] : 0) : 0;
  
  // Trend scoring
  const trend = (p > s50 ? 10 : 0) + (s200 && s50 > s200 ? 10 : 0) + (s200 && p > s200 ? 10 : 0) +
                (e20 && e50 && e20 > e50 ? 5 : 0) + (histogram && histogram > 0 ? 5 : 0);
  const mom = (clamp(roc(60), 0, 40) / 40) * 15 + (clamp(roc(20), 0, 20) / 20) * 10;
  const near = clamp(1 - dist / 0.15, 0, 1) * 20;
  const vol = clamp((rvol - 1) / 1.5, 0, 1) * 15;
  const volat = clamp(1 - Math.abs(atr - 3.5) / 6, 0, 1) * 10;
  const rsiScore = rsi >= 50 && rsi <= 70 ? 10 : rsi > 70 ? 5 : rsi < 30 ? 5 : 0;
  const bbScore = bbPosition !== null ? (bbPosition > 0.2 && bbPosition < 0.8 ? 5 : bbPosition <= 0.2 ? 3 : 0) : 0;
  
  return { 
    p, chg: (p / c[n - 2] - 1) * 100, 
    score: Math.round(trend + mom + near + vol + volat + rsiScore + bbScore),
    rvol, roc20: roc(20), roc60: roc(60), hi52d: dist * 100, atr, atrAbs, adv,
    // Enhanced indicators
    rsi, macd: macdLine, macdSignal: signal, macdHist: histogram,
    bbUpper, bbMid, bbLower, bbWidth, bbPosition,
    stochK, stochD, adx, plusDI, minusDI,
    obv, obvChange,
    s20, s50, s200, e20, e50,
  };
}

const results = []; let done = 0, ok = 0, bad = 0, i = 0;
async function worker() {
  while (i < uni.length) {
    const x = uni[i++], j = await fetchChart(x[0]);
    done++;
    if (j) { const m = metrics(j); if (m) { ok++; results.push({ s: x[0], n: x[1], ...m }); } }
    else bad++;
    if (done === 300 && bad / done > 0.6) { console.error("Yahoo يرفض معظم الطلبات — أُوقف الفحص وأبقي النتيجة السابقة"); process.exit(1); }
    if (done % 500 === 0) console.log(`${done}/${uni.length} · ناجح ${ok}`);
    await sleep(120);
  }
}

console.log(`🔍 Screening ${uni.length} stocks...`);
console.log(`📡 Enabled sources: ${Object.entries(SOURCES).filter(([,s])=>s.enabled!==false).map(([k])=>k).join(", ")}`);
await Promise.all(Array.from({ length: 8 }, worker));

const top = results.filter((r) => r.p >= 5 && r.adv >= 10e6)
  .sort((a, b) => b.score - a.score || b.adv - a.adv).slice(0, 100)
  .map((r) => ({ 
    ...r, p: +r.p.toFixed(2), chg: +r.chg.toFixed(2), rvol: +r.rvol.toFixed(2), 
    roc20: +r.roc20.toFixed(1), roc60: +r.roc60.toFixed(1), hi52d: +r.hi52d.toFixed(1), 
    atr: +r.atr.toFixed(2), atrAbs: +r.atrAbs.toFixed(2), adv: Math.round(r.adv),
    rsi: +r.rsi.toFixed(1), macd: r.macd? +r.macd.toFixed(3):null, macdSignal: r.macdSignal? +r.macdSignal.toFixed(3):null, macdHist: r.macdHist? +r.macdHist.toFixed(3):null,
    bbUpper: r.bbUpper? +r.bbUpper.toFixed(2):null, bbMid: r.bbMid? +r.bbMid.toFixed(2):null, bbLower: r.bbLower? +r.bbLower.toFixed(2):null,
    bbWidth: r.bbWidth? +r.bbWidth.toFixed(2):null, bbPosition: r.bbPosition? +r.bbPosition.toFixed(2):null,
    stochK: +r.stochK.toFixed(1), stochD: +r.stochD.toFixed(1), adx: +r.adx.toFixed(1), plusDI: +r.plusDI.toFixed(1), minusDI: +r.minusDI.toFixed(1),
  }));

if (ok < 500) { console.error("نتائج ناجحة قليلة جداً: " + ok); process.exit(1); }
writeFileSync("data/screen.json", JSON.stringify({ date: new Date().toISOString(), scanned: uni.length, ok, failed: uni.length - ok, top }));
console.log(`تم فحص ${ok}/${uni.length} سهماً · أعلى 100 محفوظة`);
