// ============================================================
// Technical Indicators Module - Professional Grade
// Works in both Node.js and Browser (ES Module)
// ============================================================

/**
 * Core utility functions
 */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sum = (a) => a.reduce((x, y) => x + y, 0);

/**
 * Simple Moving Average
 */
export function sma(values, period) {
  if (values.length < period) return null;
  return avg(values.slice(-period));
}

/**
 * Exponential Moving Average
 */
export function ema(values, period) {
  if (values.length < period) return null;
  const mult = 2 / (period + 1);
  let e = values[values.length - period];
  for (let i = values.length - period + 1; i < values.length; i++) {
    e = (values[i] - e) * mult + e;
  }
  return e;
}

/**
 * EMA array (returns full array of EMA values)
 */
export function emaArray(values, period) {
  if (values.length < period) return [];
  const mult = 2 / (period + 1);
  const result = [];
  let e = values[0];
  result.push(e);
  for (let i = 1; i < values.length; i++) {
    e = (values[i] - e) * mult + e;
    result.push(e);
  }
  return result;
}

/**
 * Standard Deviation
 */
export function stdDev(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = avg(slice);
  const variance = avg(slice.map(x => Math.pow(x - mean, 2)));
  return Math.sqrt(variance);
}

/**
 * RSI (Relative Strength Index)
 */
export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  return 100 - 100 / (1 + rs);
}

/**
 * RSI array
 */
export function rsiArray(values, period = 14) {
  if (values.length < period + 1) return [];
  const result = [];
  for (let i = period; i < values.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - values[j - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

/**
 * MACD (Moving Average Convergence Divergence)
 */
export function macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (values.length < slowPeriod + signalPeriod) return { macd: null, signal: null, histogram: null };
  const fastEMA = emaArray(values, fastPeriod);
  const slowEMA = emaArray(values, slowPeriod);
  
  const macdLine = [];
  for (let i = 0; i < values.length; i++) {
    if (i < slowPeriod - 1) { macdLine.push(null); continue; }
    macdLine.push(fastEMA[i] - slowEMA[i]);
  }
  
  // Signal line (EMA of MACD line)
  const validMACD = macdLine.filter(x => x !== null);
  if (validMACD.length < signalPeriod) return { macd: macdLine[macdLine.length - 1], signal: null, histogram: null };
  
  const signalLine = emaArray(validMACD, signalPeriod);
  const signal = signalLine[signalLine.length - 1];
  const macdValue = macdLine[macdLine.length - 1];
  const histogram = macdValue !== null && signal !== null ? macdValue - signal : null;
  
  return { macd: macdValue, signal, histogram };
}

/**
 * MACD arrays for charting
 */
export function macdArrays(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = emaArray(values, fastPeriod);
  const slowEMA = emaArray(values, slowPeriod);
  
  const macdLine = [];
  for (let i = 0; i < values.length; i++) {
    if (i < slowPeriod - 1) { macdLine.push(null); continue; }
    macdLine.push(fastEMA[i] - slowEMA[i]);
  }
  
  const validMACD = macdLine.filter(x => x !== null);
  if (validMACD.length < signalPeriod) return { macdLine, signalLine: [], histogram: [] };
  
  const signalLine = emaArray(validMACD, signalPeriod);
  const histogram = [];
  let signalIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null || signalIdx >= signalLine.length) { histogram.push(null); continue; }
    histogram.push(macdLine[i] - signalLine[signalIdx++]);
  }
  
  return { macdLine, signalLine, histogram };
}

/**
 * Bollinger Bands
 */
export function bollingerBands(values, period = 20, stdDevMult = 2) {
  if (values.length < period) return { upper: null, middle: null, lower: null, width: null, position: null };
  const middle = sma(values, period);
  const sd = stdDev(values, period);
  const upper = middle + stdDevMult * sd;
  const lower = middle - stdDevMult * sd;
  const width = middle !== 0 ? (upper - lower) / middle * 100 : null;
  const position = upper !== lower ? (values[values.length - 1] - lower) / (upper - lower) : null;
  return { upper, middle, lower, width, position };
}

/**
 * Bollinger Bands arrays
 */
export function bollingerBandsArrays(values, period = 20, stdDevMult = 2) {
  const upper = [], middle = [], lower = [], width = [], position = [];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const m = avg(slice);
    const sd = Math.sqrt(avg(slice.map(x => Math.pow(x - m, 2))));
    const u = m + stdDevMult * sd;
    const l = m - stdDevMult * sd;
    middle.push(m);
    upper.push(u);
    lower.push(l);
    width.push(m !== 0 ? (u - l) / m * 100 : null);
    position.push(u !== l ? (values[i] - l) / (u - l) : null);
  }
  return { upper, middle, lower, width, position };
}

/**
 * Stochastic Oscillator
 */
export function stochastic(high, low, close, period = 14, smoothK = 3, smoothD = 3) {
  if (close.length < period) return { k: null, d: null };
  let stochK = [];
  for (let i = period - 1; i < close.length; i++) {
    const h = Math.max(...high.slice(i - period + 1, i + 1));
    const l = Math.min(...low.slice(i - period + 1, i + 1));
    stochK.push(h !== l ? (close[i] - l) / (h - l) * 100 : 50);
  }
  // Smooth %K
  let k = stochK;
  for (let s = 0; s < smoothK - 1; s++) {
    const smoothed = [];
    for (let i = 1; i < k.length; i++) smoothed.push((k[i - 1] + k[i]) / 2);
    k = [k[0], ...smoothed];
  }
  // %D is SMA of %K
  let d = [];
  for (let i = smoothD - 1; i < k.length; i++) {
    d.push(avg(k.slice(i - smoothD + 1, i + 1)));
  }
  return { k: k[k.length - 1], d: d[d.length - 1] };
}

/**
 * Stochastic arrays
 */
export function stochasticArrays(high, low, close, period = 14, smoothK = 3, smoothD = 3) {
  let stochK = [];
  for (let i = period - 1; i < close.length; i++) {
    const h = Math.max(...high.slice(i - period + 1, i + 1));
    const l = Math.min(...low.slice(i - period + 1, i + 1));
    stochK.push(h !== l ? (close[i] - l) / (h - l) * 100 : 50);
  }
  let k = stochK;
  for (let s = 0; s < smoothK - 1; s++) {
    const smoothed = [];
    for (let i = 1; i < k.length; i++) smoothed.push((k[i - 1] + k[i]) / 2);
    k = [k[0], ...smoothed];
  }
  let d = [];
  for (let i = smoothD - 1; i < k.length; i++) {
    d.push(avg(k.slice(i - smoothD + 1, i + 1)));
  }
  return { k, d };
}

/**
 * ATR (Average True Range)
 */
export function atr(high, low, close, period = 14) {
  if (high.length < period + 1) return null;
  let trSum = 0;
  for (let i = high.length - period; i < high.length; i++) {
    const tr = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
    trSum += tr;
  }
  return trSum / period;
}

/**
 * ATR array
 */
export function atrArray(high, low, close, period = 14) {
  const result = [];
  for (let i = period; i < high.length; i++) {
    let trSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      trSum += Math.max(
        high[j] - low[j],
        Math.abs(high[j] - close[j - 1]),
        Math.abs(low[j] - close[j - 1])
      );
    }
    result.push(trSum / period);
  }
  return result;
}

/**
 * ADX (Average Directional Index)
 */
export function adx(high, low, close, period = 14) {
  if (high.length < period + 1) return { adx: null, plusDI: null, minusDI: null };
  let plusDM = 0, minusDM = 0, trSum = 0;
  for (let i = high.length - period; i < high.length; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    plusDM += up > down && up > 0 ? up : 0;
    minusDM += down > up && down > 0 ? down : 0;
    trSum += Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  const plusDI = trSum ? (plusDM / trSum) * 100 : 0;
  const minusDI = trSum ? (minusDM / trSum) * 100 : 0;
  const dx = plusDI + minusDI ? Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 : 0;
  return { adx: dx, plusDI, minusDI };
}

/**
 * ADX array
 */
export function adxArray(high, low, close, period = 14) {
  const plusDI = [], minusDI = [], adx = [];
  for (let i = period; i < high.length; i++) {
    let pDM = 0, mDM = 0, tr = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const up = high[j] - high[j - 1];
      const down = low[j - 1] - low[j];
      pDM += up > down && up > 0 ? up : 0;
      mDM += down > up && down > 0 ? down : 0;
      tr += Math.max(high[j] - low[j], Math.abs(high[j] - close[j - 1]), Math.abs(low[j] - close[j - 1]));
    }
    const pDI = tr ? (pDM / tr) * 100 : 0;
    const mDI = tr ? (mDM / tr) * 100 : 0;
    const dx = pDI + mDI ? Math.abs(pDI - mDI) / (pDI + mDI) * 100 : 0;
    plusDI.push(pDI);
    minusDI.push(mDI);
    adx.push(dx);
  }
  return { plusDI, minusDI, adx };
}

/**
 * OBV (On-Balance Volume)
 */
export function obv(close, volume) {
  if (close.length !== volume.length || close.length < 2) return 0;
  let obvValue = volume[0];
  for (let i = 1; i < close.length; i++) {
    if (close[i] > close[i - 1]) obvValue += volume[i];
    else if (close[i] < close[i - 1]) obvValue -= volume[i];
  }
  return obvValue;
}

/**
 * OBV array
 */
export function obvArray(close, volume) {
  if (close.length !== volume.length) return [];
  const result = [volume[0]];
  for (let i = 1; i < close.length; i++) {
    let v = result[result.length - 1];
    if (close[i] > close[i - 1]) v += volume[i];
    else if (close[i] < close[i - 1]) v -= volume[i];
    result.push(v);
  }
  return result;
}

/**
 * VWAP (Volume Weighted Average Price)
 */
export function vwap(high, low, close, volume) {
  if (high.length !== volume.length || high.length === 0) return null;
  let sumPV = 0, sumV = 0;
  for (let i = 0; i < high.length; i++) {
    const typical = (high[i] + low[i] + close[i]) / 3;
    sumPV += typical * volume[i];
    sumV += volume[i];
  }
  return sumV ? sumPV / sumV : null;
}

/**
 * VWAP array (session-based)
 */
export function vwapArray(high, low, close, volume) {
  const result = [];
  let sumPV = 0, sumV = 0;
  for (let i = 0; i < high.length; i++) {
    const typical = (high[i] + low[i] + close[i]) / 3;
    sumPV += typical * volume[i];
    sumV += volume[i];
    result.push(sumV ? sumPV / sumV : null);
  }
  return result;
}

/**
 * Rate of Change (ROC)
 */
export function roc(values, period) {
  if (values.length <= period) return null;
  const current = values[values.length - 1];
  const past = values[values.length - 1 - period];
  return past ? ((current - past) / past) * 100 : null;
}

/**
 * Williams %R
 */
export function williamsR(high, low, close, period = 14) {
  if (high.length < period) return null;
  const h = Math.max(...high.slice(-period));
  const l = Math.min(...low.slice(-period));
  const c = close[close.length - 1];
  return h !== l ? (h - c) / (h - l) * -100 : -50;
}

/**
 * CCI (Commodity Channel Index)
 */
export function cci(high, low, close, period = 20) {
  if (high.length < period) return null;
  const typical = [];
  for (let i = high.length - period; i < high.length; i++) {
    typical.push((high[i] + low[i] + close[i]) / 3);
  }
  const mean = avg(typical);
  const meanDev = avg(typical.map(x => Math.abs(x - mean)));
  const lastTypical = typical[typical.length - 1];
  return meanDev ? (lastTypical - mean) / (0.015 * meanDev) : 0;
}

/**
 * Parabolic SAR
 */
export function parabolicSAR(high, low, acceleration = 0.02, maxAccel = 0.2) {
  if (high.length < 2) return null;
  let sar = low[0];
  let ep = high[0];
  let af = acceleration;
  let trend = 1; // 1 = up, -1 = down
  
  for (let i = 1; i < high.length; i++) {
    if (trend === 1) {
      sar = sar + af * (ep - sar);
      if (low[i] < sar) {
        trend = -1;
        sar = ep;
        ep = low[i];
        af = acceleration;
      } else if (high[i] > ep) {
        ep = high[i];
        af = Math.min(af + acceleration, maxAccel);
      }
    } else {
      sar = sar + af * (ep - sar);
      if (high[i] > sar) {
        trend = 1;
        sar = ep;
        ep = high[i];
        af = acceleration;
      } else if (low[i] < ep) {
        ep = low[i];
        af = Math.min(af + acceleration, maxAccel);
      }
    }
  }
  return { sar, trend };
}

/**
 * Ichimoku Cloud
 */
export function ichimoku(high, low, close, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
  if (high.length < senkouBPeriod) return null;
  
  const tenkan = (Math.max(...high.slice(-tenkanPeriod)) + Math.min(...low.slice(-tenkanPeriod))) / 2;
  const kijun = (Math.max(...high.slice(-kijunPeriod)) + Math.min(...low.slice(-kijunPeriod))) / 2;
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = (Math.max(...high.slice(-senkouBPeriod)) + Math.min(...low.slice(-senkouBPeriod))) / 2;
  const chikou = close[close.length - 1];
  
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

/**
 * Pivot Points (Standard)
 */
export function pivotPoints(high, low, close) {
  const h = high[high.length - 1];
  const l = low[low.length - 1];
  const c = close[close.length - 1];
  const pp = (h + l + c) / 3;
  const r1 = 2 * pp - l;
  const s1 = 2 * pp - h;
  const r2 = pp + (h - l);
  const s2 = pp - (h - l);
  const r3 = h + 2 * (pp - l);
  const s3 = l - 2 * (h - pp);
  return { pp, r1, r2, r3, s1, s2, s3 };
}

/**
 * Fibonacci Retracements
 */
export function fibonacciRetracements(high, low) {
  const h = Math.max(...high);
  const l = Math.min(...low);
  const diff = h - l;
  return {
    '0%': h,
    '23.6%': h - 0.236 * diff,
    '38.2%': h - 0.382 * diff,
    '50%': h - 0.5 * diff,
    '61.8%': h - 0.618 * diff,
    '78.6%': h - 0.786 * diff,
    '100%': l
  };
}

/**
 * Volume Profile
 */
export function volumeProfile(close, volume, bins = 20) {
  if (close.length !== volume.length || close.length === 0) return [];
  const minPrice = Math.min(...close);
  const maxPrice = Math.max(...close);
  const binSize = (maxPrice - minPrice) / bins;
  
  const profile = Array(bins).fill(0);
  for (let i = 0; i < close.length; i++) {
    const bin = Math.min(Math.floor((close[i] - minPrice) / binSize), bins - 1);
    profile[bin] += volume[i];
  }
  
  return profile.map((vol, i) => ({
    price: minPrice + (i + 0.5) * binSize,
    volume: vol
  })).filter(x => x.volume > 0);
}

/**
 * SuperTrend
 */
export function supertrend(high, low, close, period = 10, multiplier = 3) {
  const atrVal = atr(high, low, close, period);
  if (!atrVal) return null;
  
  const basicUpper = [], basicLower = [], finalUpper = [], finalLower = [], st = [], trend = [];
  
  for (let i = 0; i < close.length; i++) {
    const bu = (high[i] + low[i]) / 2 + multiplier * atrVal;
    const bl = (high[i] + low[i]) / 2 - multiplier * atrVal;
    basicUpper.push(bu);
    basicLower.push(bl);
  }
  
  finalUpper[0] = basicUpper[0];
  finalLower[0] = basicLower[0];
  st[0] = finalUpper[0];
  trend[0] = -1;
  
  for (let i = 1; i < close.length; i++) {
    finalUpper[i] = basicUpper[i] < finalUpper[i - 1] || close[i - 1] > finalUpper[i - 1] 
      ? basicUpper[i] : finalUpper[i - 1];
    finalLower[i] = basicLower[i] > finalLower[i - 1] || close[i - 1] < finalLower[i - 1]
      ? basicLower[i] : finalLower[i - 1];
    
    if (st[i - 1] === finalUpper[i - 1] && close[i] <= finalUpper[i]) {
      st[i] = finalUpper[i];
      trend[i] = -1;
    } else if (st[i - 1] === finalUpper[i - 1] && close[i] > finalUpper[i]) {
      st[i] = finalLower[i];
      trend[i] = 1;
    } else if (st[i - 1] === finalLower[i - 1] && close[i] >= finalLower[i]) {
      st[i] = finalLower[i];
      trend[i] = 1;
    } else {
      st[i] = finalUpper[i];
      trend[i] = -1;
    }
  }
  
  return { supertrend: st[st.length - 1], trend: trend[trend.length - 1] };
}

/**
 * Complete Technical Analysis - Returns all indicators for a symbol
 */
export function analyze(open, high, low, close, volume) {
  const n = close.length;
  if (n < 50) return { error: 'Insufficient data (need 50+ bars)' };
  
  const current = close[n - 1];
  
  return {
    price: current,
    change: n > 1 ? ((current - close[n - 2]) / close[n - 2]) * 100 : 0,
    
    // Trend
    sma20: sma(close, 20),
    sma50: sma(close, 50),
    sma200: sma(close, 200),
    ema20: ema(close, 20),
    ema50: ema(close, 50),
    
    // Momentum
    rsi14: rsi(close, 14),
    rsi7: rsi(close, 7),
    rsi21: rsi(close, 21),
    
    // MACD
    macd: macd(close),
    
    // Volatility
    bollinger: bollingerBands(close, 20, 2),
    atr14: atr(high, low, close, 14),
    atrPct: atr(high, low, close, 14) ? (atr(high, low, close, 14) / current * 100) : null,
    
    // Trend Strength
    adx: adx(high, low, close, 14),
    
    // Volume
    obv: obv(close, volume),
    vwap: vwap(high, low, close, volume),
    rvol: volume[n - 1] / (avg(volume.slice(-21, -1)) || 1),
    
    // Stochastic
    stochastic: stochastic(high, low, close),
    
    // Other
    williamsR: williamsR(high, low, close),
    cci20: cci(high, low, close, 20),
    roc20: roc(close, 20),
    roc60: roc(close, 60),
    roc120: roc(close, 120),
    
    // Support/Resistance
    pivots: pivotPoints(high, low, close),
    fibs: fibonacciRetracements(high, low),
    
    // SuperTrend
    supertrend: supertrend(high, low, close),
    
    // Ichimoku
    ichimoku: ichimoku(high, low, close),
    
    // High/Low
    hi52: Math.max(...high),
    lo52: Math.min(...low),
    distFromHi: ((Math.max(...high) - current) / Math.max(...high)) * 100,
    distFromLo: ((current - Math.min(...low)) / Math.min(...low)) * 100,
  };
}

/**
 * Signal Generation from Indicators
 */
export function generateSignals(indicators) {
  const signals = [];
  let score = 0;
  
  // Trend signals
  if (indicators.price > indicators.sma20) { score += 5; signals.push({ type: 'trend', name: 'السعر > SMA20', bullish: true }); }
  else { score -= 5; signals.push({ type: 'trend', name: 'السعر < SMA20', bullish: false }); }
  
  if (indicators.price > indicators.sma50) { score += 5; signals.push({ type: 'trend', name: 'السعر > SMA50', bullish: true }); }
  else { score -= 5; signals.push({ type: 'trend', name: 'السعر < SMA50', bullish: false }); }
  
  if (indicators.sma20 > indicators.sma50) { score += 5; signals.push({ type: 'trend', name: 'SMA20 > SMA50 (تقاطع ذهبي)', bullish: true }); }
  else { score -= 5; signals.push({ type: 'trend', name: 'SMA20 < SMA50 (تقاطع الموت)', bullish: false }); }
  
  if (indicators.price > indicators.sma200) { score += 10; signals.push({ type: 'trend', name: 'السعر > SMA200', bullish: true }); }
  else { score -= 10; signals.push({ type: 'trend', name: 'السعر < SMA200', bullish: false }); }
  
  // MACD
  if (indicators.macd?.histogram > 0) { score += 5; signals.push({ type: 'momentum', name: 'MACD هيستوغرام إيجابي', bullish: true }); }
  else if (indicators.macd?.histogram < 0) { score -= 5; signals.push({ type: 'momentum', name: 'MACD هيستوغرام سلبي', bullish: false }); }
  
  if (indicators.macd?.macd > indicators.macd?.signal) { score += 3; signals.push({ type: 'momentum', name: 'MACD > الإشارة', bullish: true }); }
  else { score -= 3; signals.push({ type: 'momentum', name: 'MACD < الإشارة', bullish: false }); }
  
  // RSI
  if (indicators.rsi14 >= 70) { score -= 5; signals.push({ type: 'momentum', name: 'RSI تشبع شرائي (≥70)', bullish: false }); }
  else if (indicators.rsi14 <= 30) { score += 5; signals.push({ type: 'momentum', name: 'RSI تشبع بيعي (≤30)', bullish: true }); }
  else if (indicators.rsi14 > 50) { score += 2; signals.push({ type: 'momentum', name: 'RSI > 50', bullish: true }); }
  else { score -= 2; signals.push({ type: 'momentum', name: 'RSI < 50', bullish: false }); }
  
  // Bollinger Bands
  const bbPos = indicators.bollinger?.position;
  if (bbPos !== null) {
    if (bbPos > 0.8) { score -= 3; signals.push({ type: 'volatility', name: 'السعر قريب من الحد العلوي لبولينجر', bullish: false }); }
    else if (bbPos < 0.2) { score += 3; signals.push({ type: 'volatility', name: 'السعر قريب من الحد السفلي لبولينجر', bullish: true }); }
    else { signals.push({ type: 'volatility', name: 'السعر في منتصف نطاق بولينجر', bullish: null }); }
  }
  
  // ADX
  if (indicators.adx?.adx > 25) {
    if (indicators.adx.plusDI > indicators.adx.minusDI) { score += 5; signals.push({ type: 'trend', name: 'ADX > 25 +DI > -DI (ترند قوي صاعد)', bullish: true }); }
    else { score -= 5; signals.push({ type: 'trend', name: 'ADX > 25 -DI > +DI (ترند قوي هابط)', bullish: false }); }
  } else { signals.push({ type: 'trend', name: 'ADX < 25 (ترند ضعيف/عرضي)', bullish: null }); }
  
  // Stochastic
  const stoch = indicators.stochastic;
  if (stoch?.k > 80) { score -= 3; signals.push({ type: 'momentum', name: 'Stochastic تشبع شرائي', bullish: false }); }
  else if (stoch?.k < 20) { score += 3; signals.push({ type: 'momentum', name: 'Stochastic تشبع بيعي', bullish: true }); }
  
  // Volume
  if (indicators.rvol > 2) { score += 3; signals.push({ type: 'volume', name: 'حجم تداول عالي جداً (>2x المتوسط)', bullish: indicators.change >= 0 }); }
  else if (indicators.rvol > 1.5) { score += 1; signals.push({ type: 'volume', name: 'حجم تداول أعلى من المتوسط', bullish: indicators.change >= 0 }); }
  
  // SuperTrend
  if (indicators.supertrend?.trend === 1) { score += 5; signals.push({ type: 'trend', name: 'SuperTrend صاعد', bullish: true }); }
  else { score -= 5; signals.push({ type: 'trend', name: 'SuperTrend هابط', bullish: false }); }
  
  // Price vs VWAP
  if (indicators.vwap && indicators.price > indicators.vwap) { score += 3; signals.push({ type: 'volume', name: 'السعر > VWAP', bullish: true }); }
  else if (indicators.vwap) { score -= 3; signals.push({ type: 'volume', name: 'السعر < VWAP', bullish: false }); }
  
  // ROC Momentum
  if (indicators.roc20 > 10) { score += 3; signals.push({ type: 'momentum', name: 'ROC 20 يوم > 10%', bullish: true }); }
  else if (indicators.roc20 < -10) { score -= 3; signals.push({ type: 'momentum', name: 'ROC 20 يوم < -10%', bullish: false }); }
  
  // Normalize score to -100..100
  score = Math.max(-100, Math.min(100, score));
  
  const label = score >= 50 ? 'شراء قوي' : score >= 20 ? 'شراء' : score <= -50 ? 'بيع قوي' : score <= -20 ? 'بيع' : 'محايد';
  const cls = score >= 20 ? 'buy' : score <= -20 ? 'sell' : 'hold';
  
  return { score, label, cls, signals };
}

export default {
  sma, ema, emaArray, stdDev,
  rsi, rsiArray,
  macd, macdArrays,
  bollingerBands, bollingerBandsArrays,
  stochastic, stochasticArrays,
  atr, atrArray,
  adx, adxArray,
  obv, obvArray,
  vwap, vwapArray,
  roc, williamsR, cci,
  parabolicSAR, ichimoku,
  pivotPoints, fibonacciRetracements,
  volumeProfile, supertrend,
  analyze, generateSignals
};
