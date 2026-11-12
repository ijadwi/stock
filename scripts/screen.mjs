// فحص يومي لكل الأسهم العادية في universe.json: يجلب سنة شموع لكل سهم، يحسب مقاييس فنية، ويحفظ أقوى 100 في data/screen.json
import { readFileSync, writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const uni = JSON.parse(readFileSync("data/universe.json", "utf8")).filter((x) => x[3] && !x[4]);
if (!uni.length) { console.error("universe.json فارغ — شغّل universe.mjs أولاً"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

async function get(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`;
  for (let k = 0; k < 2; k++) {
    for (const h of ["query1", "query2"]) {
      try {
        const r = await fetch(`https://${h}.finance.yahoo.com${path}`, { headers: { "User-Agent": UA } });
        if (r.status === 404) return { missing: true };
        if (r.ok) return await r.json();
        if (r.status === 429) await sleep(2500);
      } catch {}
    }
    await sleep(800);
  }
  return null;
}

export function metrics(j) {
  const res = j?.chart?.result?.[0]; if (!res?.timestamp) return null;
  const q = res.indicators.quote[0], ix = [];
  res.timestamp.forEach((_, i) => { if (q.close[i] != null) ix.push(i); });
  if (ix.length < 110) return null;
  const c = ix.map((i) => q.close[i]), v = ix.map((i) => q.volume[i] || 0), hi = ix.map((i) => q.high[i] ?? q.close[i]), lo = ix.map((i) => q.low[i] ?? q.close[i]);
  const n = c.length, p = c[n - 1], sma = (k) => (n >= k ? avg(c.slice(-k)) : null);
  const s50 = sma(50), s200 = sma(200);
  const v20 = avg(v.slice(-21, -1)) || 1, rvol = v[n - 1] / v20;
  const adv = avg(c.slice(-20).map((x, i) => x * v[n - 20 + i]));
  const roc = (k) => (n > k ? (p / c[n - 1 - k] - 1) * 100 : 0);
  const hi52 = Math.max(...hi), dist = (hi52 - p) / hi52;
  let tr = 0; for (let i = n - 14; i < n; i++) tr += Math.max(hi[i] - lo[i], Math.abs(hi[i] - c[i - 1]), Math.abs(lo[i] - c[i - 1]));
  const atr = (tr / 14 / p) * 100;
  const trend = (p > s50 ? 10 : 0) + (s200 && s50 > s200 ? 10 : 0) + (s200 && p > s200 ? 10 : 0);
  const mom = (clamp(roc(60), 0, 40) / 40) * 15 + (clamp(roc(20), 0, 20) / 20) * 10;
  const near = clamp(1 - dist / 0.15, 0, 1) * 20;
  const vol = clamp((rvol - 1) / 1.5, 0, 1) * 15;
  const volat = clamp(1 - Math.abs(atr - 3.5) / 6, 0, 1) * 10;
  return { p, chg: (p / c[n - 2] - 1) * 100, score: Math.round(trend + mom + near + vol + volat), rvol, roc20: roc(20), roc60: roc(60), hi52d: dist * 100, atr, adv };
}

const results = []; let done = 0, ok = 0, bad = 0, i = 0;
async function worker() {
  while (i < uni.length) {
    const x = uni[i++], j = await get(x[0]);
    done++;
    if (j && !j.missing) { const m = metrics(j); if (m) { ok++; results.push({ s: x[0], n: x[1], ...m }); } }
    else if (!j) bad++;
    if (done === 300 && bad / done > 0.6) { console.error("Yahoo يرفض معظم الطلبات — أُوقف الفحص وأبقي النتيجة السابقة"); process.exit(1); }
    if (done % 500 === 0) console.log(`${done}/${uni.length} · ناجح ${ok}`);
    await sleep(120);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
const top = results.filter((r) => r.p >= 5 && r.adv >= 10e6).sort((a, b) => b.score - a.score || b.adv - a.adv).slice(0, 100)
  .map((r) => ({ ...r, p: +r.p.toFixed(2), chg: +r.chg.toFixed(2), rvol: +r.rvol.toFixed(2), roc20: +r.roc20.toFixed(1), roc60: +r.roc60.toFixed(1), hi52d: +r.hi52d.toFixed(1), atr: +r.atr.toFixed(2), adv: Math.round(r.adv) }));
if (ok < 500) { console.error("نتائج ناجحة قليلة جداً: " + ok); process.exit(1); }
writeFileSync("data/screen.json", JSON.stringify({ date: new Date().toISOString(), scanned: uni.length, ok, failed: uni.length - ok, top }));
console.log(`تم فحص ${ok}/${uni.length} سهماً · أعلى 100 محفوظة`);
