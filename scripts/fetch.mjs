// يجلب شموع سنة لقائمة symbols.txt + أقوى 40 من فحص السوق → _site/data/ (لا يُحفظ في المستودع، يُنشر مباشرة)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const OUT = process.env.OUT || "_site/data";
const safe = (s) => s.replace(/[^A-Za-z0-9.\-]/g, "_");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let symbols = readFileSync("symbols.txt", "utf8").split(/\s+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
if (existsSync("data/screen.json")) { try { symbols.push(...JSON.parse(readFileSync("data/screen.json", "utf8")).top.slice(0, 40).map((x) => x.s)); } catch {} }
symbols = [...new Set(symbols)];
mkdirSync(OUT, { recursive: true });

async function get(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`;
  let err = "";
  for (let a = 0; a < 3; a++) {
    for (const h of ["query1", "query2"]) {
      try {
        const r = await fetch(`https://${h}.finance.yahoo.com${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
        if (r.ok) { const j = await r.json(); if (j?.chart?.result?.[0]?.timestamp?.length) return j; return null; }
        err = "HTTP " + r.status;
      } catch (e) { err = String(e.message || e); }
    }
    await sleep(1500 * (a + 1));
  }
  console.warn(`✗ ${sym}: ${err}`);
  return null;
}
let ok = 0; const failed = [];
for (let i = 0; i < symbols.length; i += 4) {
  const b = symbols.slice(i, i + 4), res = await Promise.all(b.map(get));
  res.forEach((j, k) => { if (j) { writeFileSync(`${OUT}/${safe(b[k])}.json`, JSON.stringify(j)); ok++; } else failed.push(b[k]); });
  await sleep(300);
}
writeFileSync(`${OUT}/_status.json`, JSON.stringify({ updated: new Date().toISOString(), ok, failed }));
console.log(`تم: ${ok}/${symbols.length}`, failed.length ? "· فشل: " + failed.join(", ") : "");
if (ok === 0) { console.error("لم ينجح أي رمز — Yahoo يرفض الطلبات من هذا الخادم."); process.exit(1); }
