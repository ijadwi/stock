// يجلب الشموع اليومية (سنة) من Yahoo لكل رمز في symbols.txt ويحفظها في data/
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const safe = (s) => s.replace(/[^A-Za-z0-9.\-]/g, "_");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const symbols = [...new Set(readFileSync("symbols.txt", "utf8").split(/\s+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
mkdirSync("data", { recursive: true });

async function get(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`;
  let err = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
      try {
        const r = await fetch(`https://${host}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
        if (r.ok) {
          const j = await r.json();
          const res = j?.chart?.result?.[0];
          if (res?.timestamp?.length) return j;
          err = "no data";
          return null; // رمز غير موجود، لا فائدة من إعادة المحاولة
        }
        err = "HTTP " + r.status;
      } catch (e) { err = String(e.message || e); }
    }
    await sleep(1500 * (attempt + 1));
  }
  console.warn(`✗ ${sym}: ${err}`);
  return null;
}

let ok = 0;
const failed = [];
for (let i = 0; i < symbols.length; i += 4) {
  const batch = symbols.slice(i, i + 4);
  const res = await Promise.all(batch.map(get));
  res.forEach((j, k) => {
    const s = batch[k];
    if (j) { writeFileSync(`data/${safe(s)}.json`, JSON.stringify(j)); ok++; }
    else failed.push(s);
  });
  await sleep(400);
}
writeFileSync("data/_status.json", JSON.stringify({ updated: new Date().toISOString(), ok, failed }));
console.log(`تم: ${ok}/${symbols.length}`, failed.length ? "· فشل: " + failed.join(", ") : "");
if (ok === 0) { console.error("لم ينجح أي رمز — Yahoo يرفض الطلبات من هذا الخادم."); process.exit(1); }
