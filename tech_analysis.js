// ============================================================
// ENHANCED: Technical Analysis Functions
// ============================================================

// Enhanced Data Loading with Multi-source Failover
var HAS_PX = false, PROXY = "", LIVE_TIMER = null, LIVE_IV = 20000;
let liveFailCount = 0;
const MAX_LIVE_FAILS = 5;

async function fetchWithFailover(symbol, endpoints) {
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { signal: AbortSignal.timeout(ep.timeout || 10000) });
      if (res.ok) {
        const data = await res.json();
        if (ep.transform) return ep.transform(data);
        return data;
      }
    } catch (e) {
      console.warn(`Fetch failed for ${symbol} from ${ep.name}:`, e.message);
    }
  }
  return null;
}

async function loadChart(symbol) {
  const endpoints = [
    { name: "Yahoo Primary", url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false`, transform: d => d?.chart?.result?.[0] },
    { name: "Yahoo Secondary", url: `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false`, transform: d => d?.chart?.result?.[0] },
  ];
  if (HAS_PX) {
    endpoints.unshift({ name: "Worker Proxy", url: `${PROXY}/chart?symbol=${encodeURIComponent(symbol)}&range=1y`, transform: d => d?.chart?.result?.[0] });
  }
  return fetchWithFailover(symbol, endpoints);
}

async function loadLiveQuote(symbol) {
  const endpoints = [
    { name: "Yahoo Quote", url: `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`, transform: d => {
      const q = d?.quoteResponse?.result?.[0];
      if (!q) return null;
      return { price: q.regularMarketPrice, change: q.regularMarketChange, changePercent: q.regularMarketChangePercent, volume: q.regularMarketVolume, high: q.regularMarketDayHigh, low: q.regularMarketDayLow, open: q.regularMarketOpen, prevClose: q.regularMarketPreviousClose, timestamp: q.regularMarketTime, _source: "Yahoo Finance" };
    }},
  ];
  if (HAS_PX) {
    endpoints.unshift({ name: "Worker Quote", url: `${PROXY}/quote?symbol=${encodeURIComponent(symbol)}`, transform: d => d });
  }
  return fetchWithFailover(symbol, endpoints);
}

// ---------- Technical Analysis Integration ----------
async function loadTechAnalysis(symbol) {
  if (!symbol || !data[symbol]) return;
  const box = $("indGrid");
  box.innerHTML = '<div class="loading">جاري حساب المؤشرات الفنية…</div>';
  
  try {
    const chart = await loadChart(symbol);
    if (!chart?.timestamp?.length) throw new Error("لا توجد بيانات شارت");
    
    const q = chart.indicators?.quote?.[0] || {};
    const opens = q.open || [];
    const highs = q.high || [];
    const lows = q.low || [];
    const closes = q.close || [];
    const volumes = q.volume || [];
    
    // Filter valid data points
    const validIdx = [];
    closes.forEach((c, i) => { if (c != null) validIdx.push(i); });
    if (validIdx.length < 50) throw new Error("بيانات غير كافية للتحليل (تحتاج 50+ يوم)");
    
    const o = validIdx.map(i => opens[i]), h = validIdx.map(i => highs[i]), 
        l = validIdx.map(i => lows[i]), c = validIdx.map(i => closes[i]), v = validIdx.map(i => volumes[i]);
    
    // Use the indicators module
    const { analyze, generateSignals, bollingerBands, macdArrays, rsiArray, stochasticArrays, atrArray, adxArray, obvArray, vwapArray } = await import("./scripts/indicators.js");
    
    const analysis = analyze(o, h, l, c, v);
    const signals = generateSignals(analysis);
    
    // Update source badge
    const srcEl = $("techSrc");
    srcEl.textContent = `مصدر البيانات: ${chart._source || "Yahoo Finance"}`;
    srcEl.className = "data-source-badge source-live";
    
    // Render indicator cards
    renderIndicatorCards(box, analysis, signals);
    renderSignalSummary(signals, analysis);
    renderSignalDetails($("sigDetails"), signals);
    drawIndicatorCharts(o, h, l, c, v);
    
  } catch (e) {
    box.innerHTML = `<p class="hint" style="color:var(--dn)">⚠️ تعذّر تحميل التحليل: ${e.message}</p>`;
    $("techSrc").textContent = "مصدر البيانات: خطأ";
    $("techSrc").className = "data-source-badge source-error";
  }
}

function renderIndicatorCards(container, analysis, signals) {
  const cards = [
    { key: 'price', name: 'السعر الحالي', value: analysis.price?.toFixed(2), unit: '$', signal: null },
    { key: 'change', name: 'التغير اليومي', value: analysis.change?.toFixed(2), unit: '%', signal: analysis.change >= 0 ? 'buy' : 'sell' },
    { key: 'rsi14', name: 'RSI (14)', value: analysis.rsi14?.toFixed(1), signal: analysis.rsi14 >= 70 ? 'sell' : analysis.rsi14 <= 30 ? 'buy' : analysis.rsi14 > 50 ? 'buy' : 'sell' },
    { key: 'macd', name: 'MACD', value: analysis.macd?.macd?.toFixed(3), signal: analysis.macd?.histogram > 0 ? 'buy' : 'sell' },
    { key: 'macdHist', name: 'MACD هيستوغرام', value: analysis.macd?.histogram?.toFixed(3), signal: analysis.macd?.histogram > 0 ? 'buy' : 'sell' },
    { key: 'sma20', name: 'SMA 20', value: analysis.sma20?.toFixed(2), signal: analysis.price > analysis.sma20 ? 'buy' : 'sell' },
    { key: 'sma50', name: 'SMA 50', value: analysis.sma50?.toFixed(2), signal: analysis.price > analysis.sma50 ? 'buy' : 'sell' },
    { key: 'sma200', name: 'SMA 200', value: analysis.sma200?.toFixed(2), signal: analysis.price > analysis.sma200 ? 'buy' : 'sell' },
    { key: 'bbPosition', name: 'موقع بولينجر %', value: analysis.bollinger?.position != null ? (analysis.bollinger.position * 100).toFixed(0) : null, signal: analysis.bollinger?.position < 0.2 ? 'buy' : analysis.bollinger?.position > 0.8 ? 'sell' : 'hold' },
    { key: 'bbWidth', name: 'عرض بولينجر %', value: analysis.bollinger?.width?.toFixed(1), signal: null },
    { key: 'atrPct', name: 'ATR %', value: analysis.atrPct?.toFixed(2), signal: null },
    { key: 'adx', name: 'ADX', value: analysis.adx?.adx?.toFixed(1), signal: analysis.adx?.adx > 25 ? (analysis.adx.plusDI > analysis.adx.minusDI ? 'buy' : 'sell') : 'hold' },
    { key: 'plusDI', name: '+DI', value: analysis.adx?.plusDI?.toFixed(1), signal: null },
    { key: 'minusDI', name: '-DI', value: analysis.adx?.minusDI?.toFixed(1), signal: null },
    { key: 'stochK', name: 'Stoch %K', value: analysis.stochastic?.k?.toFixed(1), signal: analysis.stochastic?.k > 80 ? 'sell' : analysis.stochastic?.k < 20 ? 'buy' : 'hold' },
    { key: 'stochD', name: 'Stoch %D', value: analysis.stochastic?.d?.toFixed(1), signal: null },
    { key: 'rvol', name: 'الحجم النسبي', value: analysis.rvol?.toFixed(2), signal: analysis.rvol > 1.5 ? (analysis.change >= 0 ? 'buy' : 'sell') : 'hold' },
    { key: 'vwap', name: 'VWAP', value: analysis.vwap?.toFixed(2), signal: analysis.vwap && analysis.price > analysis.vwap ? 'buy' : 'sell' },
    { key: 'obv', name: 'OBV', value: analysis.obv != null ? (analysis.obv/1e6).toFixed(1)+'M' : null, signal: null },
    { key: 'roc20', name: 'ROC 20 يوم', value: analysis.roc20?.toFixed(1), signal: analysis.roc20 > 10 ? 'buy' : analysis.roc20 < -10 ? 'sell' : 'hold' },
    { key: 'roc60', name: 'ROC 60 يوم', value: analysis.roc60?.toFixed(1), signal: null },
    { key: 'williamsR', name: 'Williams %R', value: analysis.williamsR?.toFixed(1), signal: analysis.williamsR > -20 ? 'sell' : analysis.williamsR < -80 ? 'buy' : 'hold' },
    { key: 'cci20', name: 'CCI (20)', value: analysis.cci20?.toFixed(0), signal: analysis.cci20 > 100 ? 'sell' : analysis.cci20 < -100 ? 'buy' : 'hold' },
    { key: 'supertrend', name: 'SuperTrend', value: analysis.supertrend?.trend === 1 ? 'صاعد' : 'هابط', signal: analysis.supertrend?.trend === 1 ? 'buy' : 'sell' },
    { key: 'ichimoku', name: 'إيشيموكو', value: analysis.ichimoku ? `T:${analysis.ichimoku.tenkan?.toFixed(1)} K:${analysis.ichimoku.kijun?.toFixed(1)}` : null, signal: analysis.ichimoku && analysis.price > analysis.ichimoku.tenkan && analysis.ichimoku.tenkan > analysis.ichimoku.kijun ? 'buy' : 'sell' },
  ];
  
  container.innerHTML = cards.map(card => {
    if (card.value === null || card.value === undefined) return '';
    const sigClass = card.signal ? `sig-${card.signal}` : '';
    const cardClass = card.signal ? `ind-card ${card.signal === 'buy' ? 'bullish' : card.signal === 'sell' ? 'bearish' : 'neutral'}` : 'ind-card neutral';
    return `<div class="${cardClass}"><div class="ind-name">${card.name}</div><div class="ind-value">${card.value}${card.unit || ''}</div>${card.signal ? `<span class="ind-signal ${sigClass}">${card.signal === 'buy' ? '📈 صاعد' : card.signal === 'sell' ? '📉 هابط' : '⏸ محايد'}</span>` : ''}</div>`;
  }).join("");
}

function renderSignalSummary(signals, analysis) {
  const summary = $("signalSummary");
  summary.style.display = "grid";
  
  const trendSignals = signals.signals.filter(s => s.type === 'trend');
  const momentumSignals = signals.signals.filter(s => s.type === 'momentum');
  const volumeSignals = signals.signals.filter(s => s.type === 'volume');
  
  const trendScore = trendSignals.reduce((sum, s) => sum + (s.bullish === true ? 1 : s.bullish === false ? -1 : 0), 0);
  const momentumScore = momentumSignals.reduce((sum, s) => sum + (s.bullish === true ? 1 : s.bullish === false ? -1 : 0), 0);
  const volumeScore = volumeSignals.reduce((sum, s) => sum + (s.bullish === true ? 1 : s.bullish === false ? -1 : 0), 0);
  
  $("sigScore").textContent = signals.score;
  $("sigScore").style.color = signals.score >= 20 ? "var(--up)" : signals.score <= -20 ? "var(--dn)" : "var(--ac)";
  $("sigLabel").textContent = signals.label;
  $("sigTrend").textContent = trendScore > 0 ? "+" + trendScore : trendScore;
  $("sigTrend").style.color = trendScore > 0 ? "var(--up)" : trendScore < 0 ? "var(--dn)" : "var(--mu)";
  $("sigMomentum").textContent = momentumScore > 0 ? "+" + momentumScore : momentumScore;
  $("sigMomentum").style.color = momentumScore > 0 ? "var(--up)" : momentumScore < 0 ? "var(--dn)" : "var(--mu)";
  $("sigVol").textContent = volumeScore > 0 ? "+" + volumeScore : volumeScore;
  $("sigVol").style.color = volumeScore > 0 ? "var(--up)" : volumeScore < 0 ? "var(--dn)" : "var(--mu)";
}

function renderSignalDetails(container, signals) {
  if (!signals.signals?.length) { container.innerHTML = ""; return; }
  
  const byType = {};
  signals.signals.forEach(s => {
    if (!byType[s.type]) byType[s.type] = [];
    byType[s.type].push(s);
  });
  
  const typeLabels = { trend: '📈 الاتجاه', momentum: '⚡ الزخم', volatility: '📊 التقلب', volume: '📦 الحجم' };
  
  container.innerHTML = Object.entries(byType).map(([type, sigs]) => `
    <div style="margin-bottom:12px">
      <div style="font-weight:600;color:var(--ac);margin-bottom:6px">${typeLabels[type] || type}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${sigs.map(s => `<span class="bd ${s.bullish === true ? 'buy' : s.bullish === false ? 'sell' : 'hold'}" style="font-size:11px;padding:4px 10px">${s.name}${s.bullish === true ? ' 📈' : s.bullish === false ? ' 📉' : ''}</span>`).join("")}
      </div>
    </div>
  `).join("");
}

function drawIndicatorCharts(o, h, l, c, v) {
  const container = $("indC");
  
  // Import indicators module functions
  import("./scripts/indicators.js").then(({ macdArrays, rsiArray, stochasticArrays, bollingerBandsArrays, atrArray, vwapArray }) => {
    const macd = macdArrays(c);
    const rsi = rsiArray(c);
    const stoch = stochasticArrays(h, l, c);
    const bb = bollingerBandsArrays(c);
    const atr = atrArray(h, l, c);
    const vwap = vwapArray(h, l, c, v);
    
    container.innerHTML = `
      <div style="display:grid;gap:16px">
        <div class="cd"><h3>MACD</h3>${drawMACDChart(macd)}</div>
        <div class="cd"><h3>RSI (14)</h3>${drawRSIChart(rsi)}</div>
        <div class="cd"><h3>Stochastic</h3>${drawStochChart(stoch)}</div>
        <div class="cd"><h3>Bollinger Bands</h3>${drawBBChart(c, bb)}</div>
        <div class="cd"><h3>ATR (14)</h3>${drawLineChart(atr, 'ATR', '#f5d76e')}</div>
        <div class="cd"><h3>VWAP vs Price</h3>${drawVWAPChart(c, vwap)}</div>
      </div>
    `;
  }).catch(e => {
    container.innerHTML = `<p class="hint" style="color:var(--dn)">⚠️ خطأ في رسم الرسوم البيانية: ${e.message}</p>`;
  });
}

function drawMACDChart(macd) {
  const { macdLine, signalLine, histogram } = macd;
  if (!macdLine?.length) return '<p class="hint">بيانات غير كافية</p>';
  
  const validMacd = macdLine.filter(x => x !== null);
  const validSignal = signalLine.filter(x => x !== null);
  const validHist = histogram.filter(x => x !== null);
  const allVals = [...validMacd, ...validSignal, ...validHist];
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const range = max - min || 1;
  const w = 600, h = 150, pad = 40;
  
  const xScale = (i) => pad + (i / (macdLine.length - 1)) * (w - 2 * pad);
  const yScale = (val) => h - pad - ((val - min) / range) * (h - 2 * pad);
  const zeroY = yScale(0);
  
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="ch">`;
  // Zero line
  svg += `<line x1="${pad}" y1="${zeroY}" x2="${w-pad}" y2="${zeroY}" stroke="var(--mu)" stroke-opacity="0.3" stroke-dasharray="4,4"/>`;
  // MACD line
  svg += `<polyline fill="none" stroke="#6aa9ff" stroke-width="2" points="${macdLine.map((v,i)=>v!==null?`${xScale(i)},${yScale(v)}`:'').join(" ")}"/>`;
  // Signal line
  svg += `<polyline fill="none" stroke="var(--ac)" stroke-width="2" points="${signalLine.map((v,i)=>v!==null?`${xScale(i+macdLine.length-signalLine.length)},${yScale(v)}`:'').join(" ")}"/>`;
  // Histogram
  histogram.forEach((v,i) => {
    if (v === null) return;
    const x = xScale(i);
    const y = yScale(v);
    const h = Math.abs(y - zeroY);
    svg += `<rect x="${x-2}" y="${Math.min(y, zeroY)}" width="3" height="${h}" fill="${v>=0?'var(--up)':'var(--dn)'}" opacity="0.6"/>`;
  });
  svg += `</svg>`;
  return svg;
}

function drawRSIChart(rsi) {
  if (!rsi?.length) return '<p class="hint">بيانات غير كافية</p>';
  const w = 600, h = 150, pad = 40;
  const min = 0, max = 100;
  const xScale = (i) => pad + (i / (rsi.length - 1)) * (w - 2 * pad);
  const yScale = (val) => h - pad - ((val - min) / (max - min)) * (h - 2 * pad);
  
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="ch">`;
  // Levels
  [70, 50, 30].forEach(level => {
    const y = yScale(level);
    svg += `<line x1="${pad}" y1="${y}" x2="${w-pad}" y2="${y}" stroke="${level===50?'var(--mu)':level===70?'var(--dn)':'var(--up)'}" stroke-opacity="0.3" stroke-dasharray="4,4"/>`;
    svg += `<text x="${pad-5}" y="${y+4}" text-anchor="end" font-size="10" fill="var(--mu)">${level}</text>`;
  });
  // RSI line
  svg += `<polyline fill="none" stroke="var(--pu)" stroke-width="2" points="${rsi.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  svg += `</svg>`;
  return svg;
}

function drawStochChart(stoch) {
  const { k, d } = stoch;
  if (!k?.length) return '<p class="hint">بيانات غير كافية</p>';
  const w = 600, h = 150, pad = 40;
  const min = 0, max = 100;
  const xScale = (i) => pad + (i / (k.length - 1)) * (w - 2 * pad);
  const yScale = (val) => h - pad - ((val - min) / (max - min)) * (h - 2 * pad);
  
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="ch">`;
  [80, 50, 20].forEach(level => {
    const y = yScale(level);
    svg += `<line x1="${pad}" y1="${y}" x2="${w-pad}" y2="${y}" stroke="${level===50?'var(--mu)':level===80?'var(--dn)':'var(--up)'}" stroke-opacity="0.3" stroke-dasharray="4,4"/>`;
  });
  svg += `<polyline fill="none" stroke="var(--pu)" stroke-width="2" points="${k.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  svg += `<polyline fill="none" stroke="var(--ac)" stroke-width="1.5" points="${d.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  svg += `</svg>`;
  return svg;
}

function drawBBChart(c, bb) {
  const { upper, middle, lower } = bb;
  if (!upper?.length) return '<p class="hint">بيانات غير كافية</p>';
  const n = c.length, m = upper.length;
  const offset = n - m;
  const slice = c.slice(offset);
  const allVals = [...slice, ...upper, ...middle, ...lower];
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const range = max - min || 1;
  const w = 600, h = 150, pad = 40;
  const xScale = (i) => pad + (i / (m - 1)) * (w - 2 * pad);
  const yScale = (val) => h - pad - ((val - min) / range) * (h - 2 * pad);
  
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="ch">`;
  // Bands
  svg += `<polyline fill="none" stroke="var(--dn)" stroke-width="1" stroke-dasharray="4,4" points="${upper.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  svg += `<polyline fill="none" stroke="var(--ac)" stroke-width="1.5" points="${middle.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  svg += `<polyline fill="none" stroke="var(--up)" stroke-width="1" stroke-dasharray="4,4" points="${lower.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  // Price
  svg += `<polyline fill="none" stroke="#6aa9ff" stroke-width="2" points="${slice.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  svg += `</svg>`;
  return svg;
}

function drawLineChart(values, label, color) {
  if (!values?.length) return '<p class="hint">بيانات غير كافية</p>';
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const w = 600, h = 150, pad = 40;
  const xScale = (i) => pad + (i / (values.length - 1)) * (w - 2 * pad);
  const yScale = (val) => h - pad - ((val - min) / range) * (h - 2 * pad);
  
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="ch">`;
  svg += `<polyline fill="none" stroke="${color}" stroke-width="2" points="${values.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  svg += `</svg>`;
  return svg;
}

function drawVWAPChart(c, vwap) {
  if (!vwap?.length) return '<p class="hint">بيانات غير كافية</p>';
  const n = c.length, m = vwap.length;
  const offset = n - m;
  const slice = c.slice(offset);
  const allVals = [...slice, ...vwap];
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const range = max - min || 1;
  const w = 600, h = 150, pad = 40;
  const xScale = (i) => pad + (i / (m - 1)) * (w - 2 * pad);
  const yScale = (val) => h - pad - ((val - min) / range) * (h - 2 * pad);
  
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="ch">`;
  svg += `<polyline fill="none" stroke="var(--ac)" stroke-width="2" points="${vwap.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  svg += `<polyline fill="none" stroke="#6aa9ff" stroke-width="2" points="${slice.map((v,i)=>`${xScale(i)},${yScale(v)}`).join(" ")}"/>`;
  svg += `</svg>`;
  return svg;
}

function exportTechAnalysis() {
  if (!cur || !data[cur]) return;
  const box = $("indGrid");
  const text = box.innerText || box.textContent;
  navigator.clipboard.writeText(text).then(() => $("msg").textContent = "✅ تم نسخ التحليل للوحة القص");
}

// ---------- Live Price Updates ----------
async function startLiveUpdates() {
  if (LIVE_TIMER) clearInterval(LIVE_TIMER);
  LIVE_IV = parseInt($("iv").value) * 1000 || 20000;
  
  const updateLoop = async () => {
    const symbols = Object.keys(data).filter(s => data[s]?.price);
    if (!symbols.length) return;
    
    const results = await Promise.allSettled(symbols.map(s => loadLiveQuote(s)));
    let updated = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value?.price) {
        const s = symbols[i];
        data[s].price = r.value.price;
        data[s].chg = r.value.changePercent;
        data[s].vol = r.value.volume;
        data[s].high = r.value.high;
        data[s].low = r.value.low;
        data[s].open = r.value.open;
        data[s].prevClose = r.value.prevClose;
        data[s].asof = Date.now();
        data[s]._source = r.value._source;
        updated++;
      }
    });
    
    if (updated > 0) {
      liveFailCount = 0;
      renderAll();
      updateLiveStatus(`تم تحديث ${updated} سهم`, true);
    } else {
      liveFailCount++;
      if (liveFailCount >= MAX_LIVE_FAILS) {
        updateLiveStatus("⚠️ فشل التحديث المتكرر - تحقق من الاتصال", false);
        clearInterval(LIVE_TIMER);
      }
    }
  };
  
  await updateLoop(); // Initial run
  LIVE_TIMER = setInterval(updateLoop, LIVE_IV);
}

function updateLiveStatus(msg, ok) {
  const el = $("live");
  const dot = el.querySelector(".dot");
  const txt = $("lt");
  txt.textContent = msg;
  el.className = "live " + (ok ? "on" : "err");
}

// Hook into the existing sel() function to load tech analysis
const originalSel = window.sel;
window.sel = function(symbol) {
  if (originalSel) originalSel(symbol);
  setTimeout(() => loadTechAnalysis(symbol), 500);
};

console.log("📊 Technical Analysis module loaded");
