/**
 * Enhanced Data Fetcher - Multi-source, resilient, with caching
 * Fetches OHLCV data from multiple providers with automatic failover
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const OUT = process.env.OUT || "_site/data";
const CACHE_DIR = ".cache/fetch";
const CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const safe = (s) => s.replace(/[^A-Za-z0-9.\-]/g, "_");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ======== Data Sources ========
const SOURCES = {
  yahoo: {
    name: "Yahoo Finance",
    chart: (sym, range = "1y", interval = "1d") => 
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`,
    quote: (sym) => `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`,
    headers: { "User-Agent": UA, Accept: "application/json" },
    hosts: ["query1.finance.yahoo.com", "query2.finance.yahoo.com"],
    parseChart: (j) => j?.chart?.result?.[0],
    parseQuote: (j) => j?.quoteResponse?.result?.[0],
  },
  yahooRapid: {
    name: "Yahoo Finance (RapidAPI)",
    enabled: false,
    chart: (sym) => `https://yahoo-finance15.p.rapidapi.com/api/v1/markets/stock/${sym}/chart?interval=1d&range=1y`,
    headers: { "X-RapidAPI-Key": process.env.YAHOO_RAPID_KEY || "", "X-RapidAPI-Host": "yahoo-finance15.p.rapidapi.com" },
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
      return {
        timestamp: j.t,
        indicators: { quote: [{ o: j.o, h: j.h, l: j.l, c: j.c, v: j.v }] },
      };
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
async function fetchWithFailover(sym, range = "1y", interval = "1d") {
  const enabledSources = Object.entries(SOURCES).filter(([, s]) => s.enabled !== false);
  
  for (const [name, source] of enabledSources) {
    const key = cacheKey(name, sym, range);
    const cached = readCache(key);
    if (cached) {
      console.log(`  ↳ ${sym}: cached from ${source.name}`);
      return cached;
    }

    const hosts = source.hosts || [new URL(source.chart(sym, range, interval)).host];
    let lastErr = "";

    for (const host of hosts) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const url = source.chart(sym, range, interval).replace(/https?:\/\/[^/]+/, `https://${host}`);
          const r = await fetch(url, { headers: source.headers, signal: AbortSignal.timeout(15000) });
          
          if (r.status === 429) {
            await sleep(2000 * (attempt + 1));
            continue;
          }
          
          if (!r.ok) {
            lastErr = `HTTP ${r.status}`;
            continue;
          }

          const j = await r.json();
          const parsed = source.parseChart ? source.parseChart(j) : j?.chart?.result?.[0];
          
          if (parsed?.timestamp?.length) {
            const result = normalizeChart(parsed, source.name);
            writeCache(key, result);
            console.log(`  ✓ ${sym}: ${source.name} (${result.timestamp.length} bars)`);
            return result;
          }
          lastErr = "empty data";
        } catch (e) {
          lastErr = String(e.message || e);
        }
        await sleep(500 * (attempt + 1));
      }
    }
    console.warn(`  ✗ ${sym}: ${source.name} failed - ${lastErr}`);
  }
  return null;
}

function normalizeChart(parsed, sourceName) {
  const q = parsed.indicators?.quote?.[0] || {};
  const o = q.o || q.open || [];
  const h = q.h || q.high || [];
  const l = q.l || q.low || [];
  const c = q.c || q.close || [];
  const v = q.v || q.volume || [];
  
  return {
    meta: parsed.meta || {},
    timestamp: parsed.timestamp,
    indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] },
    _source: sourceName,
  };
}

// ======== Live Quote Fetching ========
async function fetchLiveQuote(sym) {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json();
      const q = j?.quoteResponse?.result?.[0];
      if (q) return {
        price: q.regularMarketPrice,
        change: q.regularMarketChange,
        changePercent: q.regularMarketChangePercent,
        volume: q.regularMarketVolume,
        high: q.regularMarketDayHigh,
        low: q.regularMarketDayLow,
        open: q.regularMarketOpen,
        prevClose: q.regularMarketPreviousClose,
        timestamp: q.regularMarketTime,
        _source: "Yahoo Finance",
      };
    }
  } catch (e) {
    console.warn(`Yahoo quote failed for ${sym}:`, e.message);
  }

  if (process.env.FINNHUB_KEY) {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_KEY}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const q = await r.json();
        if (q.c) return {
          price: q.c,
          change: q.d,
          changePercent: q.dp,
          high: q.h,
          low: q.l,
          open: q.o,
          prevClose: q.pc,
          timestamp: q.t,
          _source: "Finnhub",
        };
      }
    } catch (e) {
      console.warn(`Finnhub quote failed for ${sym}:`, e.message);
    }
  }
  return null;
}

// ======== Main ========
let symbols = readFileSync("symbols.txt", "utf8").split(/\s+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
if (existsSync("data/screen.json")) {
  try { symbols.push(...JSON.parse(readFileSync("data/screen.json", "utf8")).top.slice(0, 40).map((x) => x.s)); } catch {}
}
symbols = [...new Set(symbols)];

console.log(`📥 Fetching data for ${symbols.length} symbols...`);
console.log(`📡 Enabled sources: ${Object.entries(SOURCES).filter(([,s])=>s.enabled!==false).map(([k])=>k).join(", ")}`);

let ok = 0, failed = [];
const BATCH_SIZE = 3;

for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
  const batch = symbols.slice(i, i + BATCH_SIZE);
  console.log(`\n📦 Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(symbols.length/BATCH_SIZE)}: ${batch.join(", ")}`);
  
  const results = await Promise.all(batch.map(async (sym) => {
    const chart = await fetchWithFailover(sym);
    if (!chart) return { sym, ok: false };
    
    writeFileSync(`${OUT}/${safe(sym)}.json`, JSON.stringify({ chart: { result: [chart], error: null } }));
    
    const quote = await fetchLiveQuote(sym);
    if (quote) {
      writeFileSync(`${OUT}/${safe(sym)}_quote.json`, JSON.stringify(quote));
    }
    
    return { sym, ok: true };
  }));

  results.forEach(r => { if (r.ok) ok++; else failed.push(r.sym); });
  await sleep(500);
}

console.log("\n📊 Fetching live quotes...");
const quoteResults = await Promise.all(symbols.map(s => fetchLiveQuote(s)));
quoteResults.forEach((q, i) => {
  if (q) writeFileSync(`${OUT}/${safe(symbols[i])}_quote.json`, JSON.stringify(q));
});

writeFileSync(`${OUT}/_status.json`, JSON.stringify({ 
  updated: new Date().toISOString(), 
  ok, 
  failed,
  sources: Object.entries(SOURCES).filter(([,s])=>s.enabled!==false).map(([k,v])=>({name:k,label:v.name}))
}));
console.log(`\n✅ Completed: ${ok}/${symbols.length} successful`);
if (failed.length) console.log(`❌ Failed: ${failed.join(", ")}`);
if (ok === 0) { console.error("No symbols fetched successfully"); process.exit(1); }
