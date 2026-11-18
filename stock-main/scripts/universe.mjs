// يحمّل قائمة كل الأسهم الأمريكية المدرجة (Nasdaq + NYSE + NYSE American + Arca + Cboe) → data/universe.json
// الصيغة: [الرمز, الاسم, البورصة, 1=سهم عادي, 1=ETF]
import { writeFileSync, mkdirSync } from "node:fs";
const U = "https://www.nasdaqtrader.com/dynamic/symdir/";
const EXCH = { A: "NYSE American", N: "NYSE", P: "NYSE Arca", Z: "Cboe", V: "IEX" };
const NONCOMMON = /warrant|\bright|\bunits?\b|preferred|depositary|notes?\b|debenture|subordinated|due \d{4}|%/i;
const getText = async (f) => {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(U + f, { headers: { "User-Agent": "Mozilla/5.0" } }); if (r.ok) return r.text(); } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("تعذّر تحميل " + f);
};
const rows = (txt) => txt.split(/\r?\n/).slice(1).filter((l) => l && !l.startsWith("File Creation Time")).map((l) => l.split("|"));
const yahooSym = (s) => s.trim().toUpperCase().replace(/\$/g, "-P").replace(/\./g, "-");
const short = (n) => n.split(" - ")[0].trim();
const out = new Map();
const add = (sym, name, exch, test, etf) => {
  if (!sym || test === "Y" || /[^A-Z0-9\-]/.test(sym)) return;
  const common = etf !== "Y" && !NONCOMMON.test(name) ? 1 : 0;
  if (!out.has(sym)) out.set(sym, [sym, short(name), exch, common, etf === "Y" ? 1 : 0]);
};
for (const c of rows(await getText("nasdaqlisted.txt"))) add(yahooSym(c[0] || ""), c[1] || "", "Nasdaq", c[3], c[6]);
for (const c of rows(await getText("otherlisted.txt"))) add(yahooSym(c[0] || ""), c[1] || "", EXCH[c[2]] || c[2], c[6], c[4]);
const list = [...out.values()].sort((a, b) => a[0].localeCompare(b[0]));
if (list.length < 3000) throw new Error("القائمة قصيرة بشكل مريب: " + list.length);
mkdirSync("data", { recursive: true });
writeFileSync("data/universe.json", JSON.stringify(list));
console.log(`universe: ${list.length} (أسهم عادية: ${list.filter((x) => x[3]).length}، ETF: ${list.filter((x) => x[4]).length})`);
