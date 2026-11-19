// Cloudflare Worker — وسيط بيانات محسن لمحلل الأسهم
// المسارات:
//   GET /chart?symbol=NVDA&range=1y   → شموع يومية من Yahoo Finance (مع failover)
//   GET /quote?symbol=NVDA            → سعر لحظي من Finnhub/Yahoo
//   GET /metric?symbol=NVDA           → مقاييس أساسية (Finnhub) للقواعد العشر
//   GET /profile?symbol=NVDA          → بطاقة الشركة (Finnhub)
//   GET /peers?symbol=NVDA            → الشركات المماثلة (Finnhub)
//   GET /health                       → فحص سريع
// المتغيرات من لوحة Cloudflare:
//   FINNHUB_KEY    (Secret)  مفتاح Finnhub
//   ALPHA_VANTAGE_KEY (Secret) مفتاح Alpha Vantage
//   TWELVE_DATA_KEY (Secret)   مفتاح Twelve Data
//   ALLOWED_ORIGIN (Text)      مثال: https://USERNAME.github.io  (الافتراضي: *)

const RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y"]);
const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,15}$/;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Data sources with failover
const CHART_SOURCES = [
  {
    name: "Yahoo Finance",
    chart: (sym, range, interval) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`,
    hosts: ["query1.finance.yahoo.com", "query2.finance.yahoo.com"],
    parseChart: (j) => j?.chart?.result?.[0],
    headers: { "User-Agent": UA, Accept: "application/json" },
  },
  {
    name: "Alpha Vantage",
    enabled: (env) => !!env.ALPHA_VANTAGE_KEY,
    chart: (sym, range, interval, env) => `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(sym)}&outputsize=full&apikey=${env.ALPHA_VANTAGE_KEY}`,
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
  {
    name: "Twelve Data",
    enabled: (env) => !!env.TWELVE_DATA_KEY,
    chart: (sym, range, interval, env) => `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=252&apikey=${env.TWELVE_DATA_KEY}`,
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
  {
    name: "Finnhub",
    enabled: (env) => !!env.FINNHUB_KEY,
    chart: (sym, range, interval, env) => `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(sym)}&resolution=D&from=${Math.floor(Date.now()/1000)-31536000}&to=${Math.floor(Date.now()/1000)}&token=${env.FINNHUB_KEY}`,
    parseChart: (j) => {
      if (j.s !== "ok" || !j.t?.length) return null;
      return { timestamp: j.t, indicators: { quote: [{ o: j.o, h: j.h, l: j.l, c: j.c, v: j.v }] } };
    },
  },
];

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin") || "";
    const allow = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allow === "*" ? "*" : allow,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    const json = (obj, status = 200, extra = {}) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...cors, ...extra },
      });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    if (allow !== "*" && origin && origin !== allow) return json({ error: "origin not allowed" }, 403);

    const url = new URL(req.url);
    const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();

    if (url.pathname === "/health") return json({ ok: true, finnhub: !!env.FINNHUB_KEY, alphaVantage: !!env.ALPHA_VANTAGE_KEY, twelveData: !!env.TWELVE_DATA_KEY });

    // ---------- Chart endpoint with multi-source failover ----------
    if (url.pathname === "/chart") {
      if (!SYMBOL_RE.test(symbol)) return json({ error: "bad symbol" }, 400);
      const range = RANGES.has(url.searchParams.get("range")) ? url.searchParams.get("range") : "1y";
      const interval = url.searchParams.get("interval") || "1d";
      
      return cached(req, ctx, cors, 60, async () => {
        // Try each source in order
        for (const source of CHART_SOURCES) {
          if (source.enabled && !source.enabled(env)) continue;
          
          const hosts = source.hosts || [new URL(source.chart(symbol, range, interval, env)).host];
          
          for (const host of hosts) {
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const baseUrl = source.chart(symbol, range, interval, env);
                const url = baseUrl.replace(/https?:\/\/[^/]+/, `https://${host}`);
                const r = await fetch(url, { headers: source.headers, signal: AbortSignal.timeout(15000) });
                
                if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
                if (!r.ok) continue;
                
                const j = await r.json();
                const parsed = source.parseChart(j);
                
                if (parsed?.timestamp?.length) {
                  const normalized = normalizeChart(parsed, source.name);
                  return new Response(JSON.stringify({ chart: { result: [normalized], error: null } }), { 
                    status: 200, 
                    headers: { "Content-Type": "application/json" } 
                  });
                }
              } catch (e) {
                // Try next host/attempt
              }
              await sleep(500 * (attempt + 1));
            }
          }
        }
        return new Response(JSON.stringify({ error: "All data sources failed" }), { status: 502, headers: { "Content-Type": "application/json" } });
      });
    }

    // ---------- Live Quote endpoint ----------
    if (url.pathname === "/quote") {
      if (!SYMBOL_RE.test(symbol)) return json({ error: "bad symbol" }, 400);
      return cached(req, ctx, cors, 10, async () => {
        // Try Yahoo first (no key needed)
        try {
          const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`, { 
            headers: { "User-Agent": UA }, 
            signal: AbortSignal.timeout(8000) 
          });
          if (r.ok) {
            const j = await r.json();
            const q = j?.quoteResponse?.result?.[0];
            if (q) return new Response(JSON.stringify(normalizeQuote(q, "Yahoo Finance")), { status: 200, headers: { "Content-Type": "application/json" } });
          }
        } catch (e) {}
        
        // Fallback to Finnhub
        if (env.FINNHUB_KEY) {
          try {
            const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${env.FINNHUB_KEY}`, { signal: AbortSignal.timeout(8000) });
            if (r.ok) {
              const q = await r.json();
              if (q.c) return new Response(JSON.stringify(normalizeQuote(q, "Finnhub")), { status: 200, headers: { "Content-Type": "application/json" } });
            }
          } catch (e) {}
        }
        
        return new Response(JSON.stringify({ error: "Failed to fetch quote" }), { status: 502, headers: { "Content-Type": "application/json" } });
      });
    }

    // ---------- Fundamental Data endpoints (Finnhub) ----------
    const FH = { "/metric": "stock/metric", "/profile": "stock/profile2", "/peers": "stock/peers" };
    if (FH[url.pathname]) {
      if (!SYMBOL_RE.test(symbol)) return json({ error: "bad symbol" }, 400);
      if (!env.FINNHUB_KEY) return json({ error: "FINNHUB_KEY not set" }, 501);
      const extra = url.pathname === "/metric" ? "&metric=all" : "";
      return cached(req, ctx, cors, 21600, async () => {
        const r = await fetch(`https://finnhub.io/api/v1/${FH[url.pathname]}?symbol=${encodeURIComponent(symbol)}${extra}&token=${env.FINNHUB_KEY}`);
        return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
      });
    }

    return json({ error: "not found", routes: ["/chart", "/quote", "/metric", "/profile", "/peers", "/health"] }, 404);
  },
};

// ---- Helpers ----
function normalizeChart(parsed, sourceName) {
  const q = parsed.indicators?.quote?.[0] || {};
  const o = q.o || q.open || [];
  const h = q.h || q.high || [];
  const l = q.l || q.low || [];
  const c = q.c || q.close || [];
  const v = q.v || q.volume || [];
  return { meta: parsed.meta || {}, timestamp: parsed.timestamp, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] }, _source: sourceName };
}

function normalizeQuote(q, source) {
  if (source === "Yahoo Finance") {
    return {
      price: q.regularMarketPrice, change: q.regularMarketChange, changePercent: q.regularMarketChangePercent,
      volume: q.regularMarketVolume, high: q.regularMarketDayHigh, low: q.regularMarketDayLow,
      open: q.regularMarketOpen, prevClose: q.regularMarketPreviousClose, timestamp: q.regularMarketTime,
      _source: "Yahoo Finance"
    };
  }
  // Finnhub
  return {
    price: q.c, change: q.d, changePercent: q.dp, high: q.h, low: q.l, open: q.o, prevClose: q.pc, timestamp: q.t,
    _source: "Finnhub"
  };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cached(req, ctx, cors, ttl, produce) {
  const cache = caches.default;
  const key = new Request(req.url, { method: "GET" });
  let res = await cache.match(key);
  if (!res) {
    const fresh = await produce();
    res = new Response(fresh.body, fresh);
    if (res.status === 200) {
      res.headers.set("Cache-Control", `public, max-age=${ttl}`);
      ctx.waitUntil(cache.put(key, res.clone()));
    }
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}
