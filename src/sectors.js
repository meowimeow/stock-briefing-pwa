// 뉴스가 말하는 산업 흐름을 실제 가격과 대조하기 위한 업종 ETF 수익률. 모두 미국 상장이라 다른 지역 시장은 반영하지 못한다.
// Yahoo 일봉을 먼저 쓰고(비공식이라 막힐 수 있음), 실패하면 Finnhub 현재가의 하루 등락만이라도 쓴다.
import { quote } from "./sources.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; personal-app)" };
export const SECTORS = [["반도체", "SMH"], ["AI·소프트웨어·클라우드", "IGV"], ["전기차·배터리", "LIT"], ["에너지·원자재", "XLE"], ["금융·금리·거시", "XLF"], ["제약·바이오", "XBI"], ["자동차·모빌리티", "CARZ"], ["방산·우주·항공", "ITA"], ["소비·유통", "XRT"], ["부동산·건설", "XLRE"], ["물류·해운·공급망", "IYT"]];

const ret = (c, k) => (c.length > k ? (c[c.length - 1] / c[c.length - 1 - k] - 1) * 100 : null);
async function moves(env, etf) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${etf}?range=1mo&interval=1d`, { headers: UA });
    if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
    const x = (await r.json()).chart.result[0], c = x.indicators.quote[0].close.filter((v) => v > 0);
    if (c.length < 6) throw new Error("일봉 부족");
    return { r1: ret(c, 1), r2: ret(c, 2), r5: ret(c, 5), source: "Yahoo" };
  } catch {
    const q = await quote(env, etf);
    return { r1: q.pct, r2: null, r5: null, source: "Finnhub" };
  }
}

export async function sectorMoves(env) {
  const errors = [], all = await Promise.allSettled([["", "SPY"], ...SECTORS].map(([, etf]) => moves(env, etf)));
  const get = (i, etf) => { if (all[i].status === "fulfilled") return all[i].value; errors.push(`${etf}: ${all[i].reason.message}`); return null; };
  const spy = get(0, "SPY");
  const rows = SECTORS.map(([industry, etf], i) => {
    const m = get(i + 1, etf);
    if (!m) return null;
    return { industry, etf, ...m, rel2: m.r2 != null && spy && spy.r2 != null ? m.r2 - spy.r2 : null };
  }).filter(Boolean);
  return { spy: spy ? { etf: "SPY", ...spy } : null, rows, errors, at: new Date().toISOString() };
}
