# Read current index.html
with open(r"C:\Users\1051798211\Downloads\Codex 2026\stock-main\index.html", "r", encoding="utf-8") as f:
    content = f.read()

# Replace the <head> section to add the indicators module import
old_head = '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>\n<style>'
new_head = """<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<script type="module" src="scripts/indicators.js"></script>
<style>"""

content = content.replace(old_head, new_head)

# Add the tech analysis section after the anC section
old_an_section = """<section class="g3"><div class="cd"><h2>مؤشر القوة النسبية RSI (14)</h2><div id="rsiC"></div></div><div class="cd"><h2>MACD (الهيستوغرام) مع السعر</h2><div id="macdC"></div></div>
 <div class="cd" id="anC"><h2>المحللون وبيوت المال</h2><div id="an"></div></div></section>"""

new_an_section = """<section class="g3"><div class="cd"><h2>مؤشر القوة النسبية RSI (14)</h2><div id="rsiC"></div></div><div class="cd"><h2>MACD (الهيستوغرام) مع السعر</h2><div id="macdC"></div></div>
 <div class="cd" id="anC"><h2>المحللون وبيوت المال</h2><div id="an"></div></div></section>
<section class="cd" id="tech"><div class="mh"><h2>🔬 التحليل الفني الشامل <span id="techSrc" class="data-source-badge source-delayed">مصدر البيانات: —</span></h2><div class="noprint" style="display:flex;gap:8px;flex-wrap:wrap"><button class="bt" onclick="loadTechAnalysis(cur)">🔄 تحديث التحليل</button><button class="bt" onclick="exportTechAnalysis()">📤 تصدير JSON</button></div></div>
 <div class="ind-grid" id="indGrid"><div class="loading">جاري تحميل المؤشرات الفنية…</div></div>
 <div class="signal-summary" id="signalSummary" style="display:none"><div class="signal-box"><div class="signal-score" id="sigScore">—</div><div class="signal-label" id="sigLabel">التقييم العام</div></div><div class="signal-box"><div class="signal-score" id="sigTrend">—</div><div class="signal-label">الاتجاه</div></div><div class="signal-box"><div class="signal-score" id="sigMomentum">—</div><div class="signal-label">الزخم</div></div><div class="signal-box"><div class="signal-score" id="sigVol">—</div><div class="signal-label">الحجم</div></div></div>
 <div id="indC" class="chw" style="margin-top:16px"><p class="hint">اختر سهماً لعرض رسوم المؤشرات التفصيلية…</p></div>
 <div class="hint" style="margin-top:8px">جميع المؤشرات تُحسب محلياً من بيانات OHLCV اليومية. راجع قسم "الإشارات" أدناه لتفاصيل كل إشارة.</div>
 <div id="sigDetails" style="margin-top:12px"></div></section>"""

content = content.replace(old_an_section, new_an_section)

# Write back
with open(r"C:\Users\1051798211\Downloads\Codex 2026\stock-main\index.html", "w", encoding="utf-8") as f:
    f.write(content)

print("Updated index.html with tech analysis section and indicators module import")
