// 해외 시각 / 예측 vs 실제 / 경제지표용 데이터 (Streamlit의 global_views.py, fred_indicators.py를 옮긴 것)
import { fh, getJson, SEC_UA, day, addDays } from "./sources.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; news-analyzer personal use)" };

// ---------------------------------------------------------------- 애널리스트
export const analystScore = (r) => {
  const sb = r.strongBuy || 0, b = r.buy || 0, h = r.hold || 0, s = r.sell || 0, ss = r.strongSell || 0;
  const tot = sb + b + h + s + ss;
  return tot ? (2 * sb + b - s - 2 * ss) / tot : null;
};

async function analystRows(env, t) {
  const rows = await fh(env, "stock/recommendation", { symbol: t });
  if (!Array.isArray(rows) || !rows.length) throw new Error("애널리스트 데이터 없음");
  return rows.sort((a, b) => (b.period || "").localeCompare(a.period || ""));
}

export async function analystDetail(env, t) {
  const rows = await analystRows(env, t);
  const a = rows[0], p = rows[1] ? analystScore(rows[1]) : null, s = analystScore(a);
  return {
    summary: { period: a.period, pos: (a.strongBuy || 0) + (a.buy || 0), neu: a.hold || 0, neg: (a.sell || 0) + (a.strongSell || 0),
      total: (a.strongBuy || 0) + (a.buy || 0) + (a.hold || 0) + (a.sell || 0) + (a.strongSell || 0), score: s, change: s != null && p != null ? s - p : null },
    rows: rows.slice(0, 6).map((r) => ({ ...r, score: analystScore(r) })),
  };
}

// ---------------------------------------------------------------- StockTwits
export async function stocktwits(env, t) {
  let r;
  try { r = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(t)}.json`, { headers: UA }); }
  catch { throw new Error("네트워크 오류"); }
  if (r.status === 403 || r.status === 429) throw new Error(`StockTwits가 이 서버의 접속을 막았습니다 (HTTP ${r.status})`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  let msgs;
  try { msgs = (await r.json()).messages || []; } catch { throw new Error("응답을 읽을 수 없습니다"); }
  const list = msgs.map((m) => ({ body: String(m.body || "").slice(0, 200), tag: ((m.entities || {}).sentiment || {}).basic || null }));
  const pos = list.filter((m) => m.tag === "Bullish").length, neg = list.filter((m) => m.tag === "Bearish").length;
  return { summary: { pos, neg, total: list.length, tagged: pos + neg }, messages: list.slice(0, 8) };
}

// ---------------------------------------------------------------- 실적 / 내부자 / 공시
export async function earningsDetail(env, t) {
  const d = await fh(env, "stock/earnings", { symbol: t, limit: 8 });
  const rows = (Array.isArray(d) ? d : []).filter((x) => x && x.actual != null && x.estimate != null).sort((a, b) => (b.period || "").localeCompare(a.period || ""));
  if (!rows.length) throw new Error("실적 데이터가 없습니다");
  const pcts = rows.map((r) => r.surprisePercent).filter((x) => x != null);
  return {
    summary: { total: rows.length, pos: rows.filter((r) => r.actual > r.estimate).length, neg: rows.filter((r) => r.actual < r.estimate).length,
      avgSurprise: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null },
    rows: rows.map((r) => ({ period: r.period, actual: r.actual, estimate: r.estimate, pct: r.surprisePercent ?? null })),
  };
}

export async function insiderDetail(env, t) {
  const d = await fh(env, "stock/insider-transactions", { symbol: t, from: day(addDays(new Date(), -180)) });
  const rows = (d && d.data) || [];
  const money = (rs) => rs.reduce((s, r) => s + Math.abs(r.change || 0) * (r.transactionPrice || 0), 0);
  const buys = rows.filter((r) => r.transactionCode === "P"), sells = rows.filter((r) => r.transactionCode === "S");
  const recent = [...buys, ...sells].sort((a, b) => (b.transactionDate || "").localeCompare(a.transactionDate || "")).slice(0, 6)
    .map((r) => ({ name: r.name, code: r.transactionCode, date: r.transactionDate, shares: Math.abs(r.change || 0), price: r.transactionPrice || null }));
  return { summary: { pos: buys.length, neg: sells.length, total: buys.length + sells.length, buyValue: money(buys), sellValue: money(sells) }, recent };
}

export async function filingsDetail(env, t) {
  const dir = await getJson("https://www.sec.gov/files/company_tickers.json", SEC_UA);
  const hit = Object.values(dir).find((x) => (x.ticker || "").toUpperCase() === t);
  if (!hit) throw new Error("SEC에 없는 티커 (미국 상장사만)");
  const sub = await getJson(`https://data.sec.gov/submissions/CIK${String(hit.cik_str).padStart(10, "0")}.json`, SEC_UA);
  const rc = sub.filings.recent, keep = ["10-K", "10-Q", "8-K", "20-F", "6-K", "S-1", "DEF 14A"], rows = [];
  for (let i = 0; i < rc.form.length && rows.length < 10; i++) {
    if (!keep.includes(rc.form[i])) continue;
    rows.push({ form: rc.form[i], date: rc.filingDate[i], url: `https://www.sec.gov/Archives/edgar/data/${Number(hit.cik_str)}/${rc.accessionNumber[i].replace(/-/g, "")}/${rc.primaryDocument[i]}` });
  }
  const cutoff = day(addDays(new Date(), -30));
  return { rows, recent8k: rows.filter((r) => r.form === "8-K" && r.date >= cutoff).length };
}

export async function globalView(env, t) {
  const parts = { analyst: analystDetail, stocktwits, earnings: earningsDetail, insider: insiderDetail, filings: filingsDetail };
  const out = { ticker: t, errors: {}, at: new Date().toISOString() };
  await Promise.all(Object.entries(parts).map(async ([k, fn]) => {
    try { out[k] = await fn(env, t); } catch (e) { out[k] = null; out.errors[k] = e.message; }
  }));
  return out;
}

// ---------------------------------------------------------------- 주가 이력 (Yahoo → Stooq)
export async function priceHistory(t) {
  let err = "";
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=5y&interval=1d`, { headers: UA });
    if (r.ok) {
      const res = (await r.json()).chart.result[0];
      const closes = res.indicators.quote[0].close, out = [];
      res.timestamp.forEach((ts, i) => { if (closes[i] != null) out.push([new Date(ts * 1000).toISOString().slice(0, 10), closes[i]]); });
      if (out.length) return { source: "Yahoo", prices: out };
    }
    err = `Yahoo HTTP ${r.status}`;
  } catch (e) { err = "Yahoo 실패"; }
  try {
    const r = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(t.toLowerCase())}.us&i=d`, { headers: UA });
    const txt = await r.text();
    if (r.ok && txt.startsWith("Date")) {
      const out = txt.trim().split("\n").slice(1).map((l) => l.split(",")).filter((c) => c[4] && !isNaN(Number(c[4]))).map((c) => [c[0], Number(c[4])]);
      if (out.length) return { source: "Stooq", prices: out };
    }
    err += ` / Stooq HTTP ${r.status}`;
  } catch { err += " / Stooq 실패"; }
  throw new Error(err);
}

// ---------------------------------------------------------------- 적중률 계산 (네트워크 없음)
const firstOnOrAfter = (prices, d) => { // prices: [[date, close]] 오름차순
  let lo = 0, hi = prices.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (prices[m][0] < d) lo = m + 1; else hi = m; }
  return lo < prices.length ? prices[lo] : null;
};
const addMonths = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export function buildAccuracyTable(recRows, prices) {
  const rows = [...recRows].sort((a, b) => (a.period || "").localeCompare(b.period || ""));
  const last = prices[prices.length - 1][0];
  const out = []; let prev = null;
  for (const r of rows) {
    const score = analystScore(r);
    if (score == null) continue;
    const tot = ["strongBuy", "buy", "hold", "sell", "strongSell"].reduce((s, k) => s + (r[k] || 0), 0);
    const p0 = firstOnOrAfter(prices, r.period);
    const rec = { period: r.period, score, buyShare: ((r.strongBuy || 0) + (r.buy || 0)) / tot, scoreChange: prev != null ? score - prev : null, price: p0 ? p0[1] : null };
    for (const h of [1, 3]) {
      const end = addMonths(r.period, h);
      if (!p0 || end > last) { rec[`ret${h}`] = null; continue; }
      const p1 = firstOnOrAfter(prices, end);
      rec[`ret${h}`] = p1 ? p1[1] / p0[1] - 1 : null;
    }
    prev = score; out.push(rec);
  }
  return out;
}

export function accuracySummary(table, h, buyThreshold = 0.5) {
  const key = `ret${h}`, t = table.filter((r) => r[key] != null), n = t.length;
  if (!n) return { n: 0, horizon: h };
  const rate = (arr, f) => (arr.length ? arr.filter(f).length / arr.length : null);
  const bull = t.filter((r) => r.buyShare >= buyThreshold), upg = t.filter((r) => r.scoreChange != null && r.scoreChange > 0), dng = t.filter((r) => r.scoreChange != null && r.scoreChange < 0);
  let corr = null;
  if (n >= 3) {
    const xs = t.map((r) => r.score), ys = t.map((r) => r[key]), mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0), sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0), syy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
    corr = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  }
  return { n, horizon: h, baseUpRate: rate(t, (r) => r[key] > 0), bullN: bull.length, bullUpRate: rate(bull, (r) => r[key] > 0),
    upgradeN: upg.length, upgradeUpRate: rate(upg, (r) => r[key] > 0), downgradeN: dng.length, downgradeDownRate: rate(dng, (r) => r[key] < 0), corr };
}

export async function accuracyOne(env, t) {
  const [rows, ph] = await Promise.all([analystRows(env, t), priceHistory(t)]);
  const table = buildAccuracyTable(rows, ph.prices);
  const since = table.length ? addMonths(table[0].period, -1) : "0000";
  return { table, h1: accuracySummary(table, 1), h3: accuracySummary(table, 3), prices: ph.prices.filter((p) => p[0] >= since).filter((_, i) => i % 3 === 0), source: ph.source };
}

export async function accuracyView(env, tickers) {
  const out = { tickers: {}, errors: {}, at: new Date().toISOString() };
  await Promise.all(tickers.map(async (t) => { try { out.tickers[t] = await accuracyOne(env, t); } catch (e) { out.errors[t] = e.message; } }));
  const all = Object.values(out.tickers).flatMap((x) => x.table);
  out.pooled = { h1: accuracySummary(all, 1), h3: accuracySummary(all, 3) };
  return out;
}

// ---------------------------------------------------------------- 경제지표 (FRED)
const INDICATORS = [
  ["cpi_yoy", "CPI (소비자물가지수, 전년동월비)", "CPIAUCSL", "pc1", "%", false, "미국 전체 소비자물가 상승률. 인플레이션의 대표 지표로, 낮을수록 물가 안정을 의미.", 8, 30],
  ["core_cpi_yoy", "근원 CPI (식품·에너지 제외, 전년동월비)", "CPILFESL", "pc1", "%", false, "변동성 큰 식품·에너지를 뺀 물가상승률. 연준이 CPI보다 더 주목하는 지표.", 8, 30],
  ["pce_yoy", "PCE 물가지수 (전년동월비)", "PCEPI", "pc1", "%", false, "개인소비지출 물가지수. 연준이 통화정책 판단 시 가장 공식적으로 참고하는 물가지표.", 8, 30],
  ["core_pce_yoy", "근원 PCE (전년동월비)", "PCEPILFE", "pc1", "%", false, "식품·에너지 제외 PCE. 연준의 '진짜' 목표 물가지표로 불림 (목표 2%).", 8, 30],
  ["unemployment", "실업률", "UNRATE", "lin", "%", false, "경제활동인구 중 실업자 비율. 낮을수록 고용시장이 튼튼하다는 뜻.", 8, 30],
  ["nonfarm_payrolls", "비농업 고용 (전월대비 증감)", "PAYEMS", "chg", "천명", true, "농업을 제외한 신규 취업자 수 변화. 고용시장 활력을 보여주는 핵심 지표(NFP).", 8, 30],
  ["gdp_growth", "실질GDP 성장률 (전분기대비 연율)", "A191RL1Q225SBEA", "lin", "%", true, "물가 영향을 제거한 실질 경제성장률(연율 환산). 경기 전반의 성적표.", 8, 30],
  ["retail_sales_mom", "소매판매 (전월대비)", "RSAFS", "pch", "%", true, "소매 매출 증감률. 소비 심리와 경기 체감을 보여주는 빠른 지표.", 8, 30],
  ["fed_funds_rate", "연방기금금리 (실효금리)", "FEDFUNDS", "lin", "%", false, "연준의 기준금리. 단순화를 위해 '내리면 완화적=좋음'으로 판정.", 14, 0],
];

// 미국 동부시간 날짜+시각을 실제 시각(UTC ISO)으로. 서머타임은 그 날짜 기준으로 반영한다.
export function etToUtcIso(dateStr, hour, minute) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, Number(x.value)]));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += Date.UTC(y, m - 1, d, hour, minute) - shown;
  }
  return new Date(guess).toISOString();
}

const fred = async (env, endpoint, params) => {
  const j = await getJson(`https://api.stlouisfed.org/fred/${endpoint}?${new URLSearchParams({ ...params, api_key: env.FRED_KEY, file_type: "json" })}`);
  return j;
};
const num = (v) => { const n = Number(v); return v == null || v === "." || isNaN(n) ? null : n; };

async function oneIndicator(env, spec) {
  const [key, label, sid, units, suffix, hib, description, hh, mm] = spec;
  const out = { key, label, suffix, description, higherIsBetter: hib };
  try {
    const obs = (await fred(env, "series/observations", { series_id: sid, units, sort_order: "desc", limit: 2 })).observations || [];
    const latest = num((obs[0] || {}).value), prev = num((obs[1] || {}).value);
    out.latest = latest; out.prev = prev; out.period = (obs[0] || {}).date || null;
    out.change = latest != null && prev != null ? latest - prev : null;
    out.goodBad = out.change ? ((out.change > 0) === hib ? "good" : "bad") : null;
    const rid = ((await fred(env, "series/release", { series_id: sid })).releases || [])[0]?.id;
    if (rid) {
      const dates = ((await fred(env, "release/dates", { release_id: rid, sort_order: "desc", include_release_dates_with_no_data: "true", limit: 20 })).release_dates || []).map((x) => x.date).filter(Boolean);
      const today = day(new Date());
      const past = dates.filter((d) => d < today), fut = dates.filter((d) => d >= today);
      out.lastDateEt = past.length ? past.sort().pop() : null;
      const next = fut.length ? fut.sort()[0] : null;
      out.nextReleaseUtc = etToUtcIso(next, hh, mm);
    }
  } catch (e) { out.error = e.message; }
  return out;
}

export async function macroView(env) {
  if (!env.FRED_KEY) throw new Error("FRED_KEY가 서버에 없습니다");
  return { items: await Promise.all(INDICATORS.map((s) => oneIndicator(env, s))), at: new Date().toISOString() };
}
