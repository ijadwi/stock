// Cloudflare Worker — وسيط بيانات لمحلل الأسهم
// المسارات:
//   GET /chart?symbol=NVDA&range=1y   → شموع يومية من Yahoo Finance
//   GET /quote?symbol=NVDA            → سعر لحظي من Finnhub (المفتاح سري على الخادم)
//   GET /metric?symbol=NVDA           → مقاييس أساسية (Finnhub) للقواعد العشر
//   GET /profile?symbol=NVDA          → بطاقة الشركة (Finnhub)
//   GET /peers?symbol=NVDA            → الشركات المماثلة (Finnhub)
//   GET /health                       → فحص سريع
// المتغيرات (اختيارية) من لوحة Cloudflare:
//   FINNHUB_KEY    (Secret)  مفتاح Finnhub
//   ALLOWED_ORIGIN (Text)    مثال: https://USERNAME.github.io  (الافتراضي: *)

const RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y"]);
const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,15}$/;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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
    const symbol = (url.searchParams.get("symbol") || "").trim();

    if (url.pathname === "/health") return json({ ok: true, finnhub: !!env.FINNHUB_KEY });

    if (url.pathname === "/chart") {
      if (!SYMBOL_RE.test(symbol)) return json({ error: "bad symbol" }, 400);
      const range = RANGES.has(url.searchParams.get("range")) ? url.searchParams.get("range") : "1y";
      return cached(req, ctx, cors, 60, async () => {
        const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
        let last = null;
        for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
          try {
            const r = await fetch(`https://${host}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
            if (r.ok) return new Response(await r.text(), { status: 200, headers: { "Content-Type": "application/json" } });
            last = r.status;
          } catch (e) {
            last = 502;
          }
        }
        return new Response(JSON.stringify({ error: "yahoo " + last }), { status: 502, headers: { "Content-Type": "application/json" } });
      });
    }

    if (url.pathname === "/quote") {
      if (!SYMBOL_RE.test(symbol)) return json({ error: "bad symbol" }, 400);
      if (!env.FINNHUB_KEY) return json({ error: "FINNHUB_KEY not set" }, 501);
      return cached(req, ctx, cors, 10, async () => {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${env.FINNHUB_KEY}`);
        return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
      });
    }

    // بيانات أساسية من Finnhub (تقييم السهم بالقواعد العشر) — تُخزَّن 6 ساعات
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

// تخزين مؤقت قصير على حافة Cloudflare لتخفيف الطلبات
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
