// 위험·포지션 경고등: 단순 규칙으로 종목마다 초록/노랑/빨강을 매긴다. (확률이 아니라 '먼저 살펴볼 곳' 표시)
import * as src from "./sources.js";
import * as ch from "./chart.js";
import { fh } from "./sources.js";
import { riskCategory } from "./risk.js";

const P = (x) => (x == null || !isFinite(x) ? "-" : (x >= 0 ? "+" : "") + (x * 100).toFixed(0) + "%");

export function lightsFrom({ quote, earnings, analyst, insider, news, bars, profile }) {
  const L = [], add = (id, label, level, text) => L.push({ id, label, level, text });
  if (quote && quote.pct != null) {
    const a = Math.abs(quote.pct);
    if (a >= 5) add("day", "당일 변동", "red", `전일 대비 ${quote.pct >= 0 ? "+" : ""}${quote.pct.toFixed(1)}%`);
    else if (a >= 3) add("day", "당일 변동", "yellow", `전일 대비 ${quote.pct >= 0 ? "+" : ""}${quote.pct.toFixed(1)}%`);
  }
  const c = (bars || []).map((b) => b[4]).filter((x) => x > 0), n = c.length;
  if (n >= 60) {
    const last = c[n - 1], w = c.slice(-252), hi = Math.max(...w), lo = Math.min(...w), dd = last / hi - 1;
    const avg = (k) => c.slice(-k).reduce((s, x) => s + x, 0) / Math.min(k, n);
    const r = []; for (let i = n - 20; i < n; i++) if (i > 0) r.push(Math.log(c[i] / c[i - 1]));
    const mu = r.reduce((s, x) => s + x, 0) / r.length, vol = Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, r.length - 1)) * Math.sqrt(252);
    if (vol > 0.6) add("vol", "변동성", "red", `최근 20일 연환산 변동성 약 ${Math.round(vol * 100)}%`);
    else if (vol > 0.4) add("vol", "변동성", "yellow", `최근 20일 연환산 변동성 약 ${Math.round(vol * 100)}%`);
    if (dd <= -0.3) add("dd", "고점 대비 낙폭", "red", `52주 고가 대비 ${P(dd)}`);
    else if (dd <= -0.15) add("dd", "고점 대비 낙폭", "yellow", `52주 고가 대비 ${P(dd)}`);
    if (n >= 200) { const m50 = avg(50), m200 = avg(200); if (last < m200 && m50 < m200) add("trend", "추세", "yellow", `200일 이동평균 아래(${P(last / m200 - 1)}), 50일선도 그 아래`); }
    const r3 = n > 63 ? last / c[n - 64] - 1 : null;
    if (hi > lo && (last - lo) / (hi - lo) >= 0.95 && r3 != null && r3 > 0.4) add("heat", "단기 과열", "yellow", `52주 범위 상단, 3개월 ${P(r3)} 상승 — 급등 뒤 되돌림이 잦은 구간`);
  }
  if (earnings && earnings.date) {
    const d = Math.round((Date.parse(earnings.date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000);
    if (d >= 0 && d <= 3) add("earn", "실적 발표", "red", `${d}일 뒤(${earnings.date}) — 발표 전후 변동 확대`);
    else if (d > 3 && d <= 10) add("earn", "실적 발표", "yellow", `${d}일 뒤(${earnings.date})`);
  }
  if (insider && insider.sellValue >= 2e7 && insider.buyN === 0) add("ins", "내부자 매도", "yellow", `6개월 매도 ${insider.sellN}건 약 $${(insider.sellValue / 1e6).toFixed(0)}M, 매수 없음 (정기 매도일 수 있음)`);
  if (analyst) {
    if (analyst.change != null && analyst.change <= -0.15) add("ana", "애널리스트", "yellow", `전월 대비 의견 점수 ${analyst.change.toFixed(2)} 하향`);
    else if (analyst.neg > analyst.pos && analyst.neg + analyst.pos > 0) add("ana", "애널리스트", "yellow", `매도 ${analyst.neg} > 매수 ${analyst.pos}`);
  }
  if (news && news.riskyN) {
    const cats = [...new Set(news.risky.map((x) => x.risk))].join(", ");
    add("news", "뉴스 리스크", news.riskyN >= 3 ? "red" : "yellow", `리스크 키워드 뉴스 ${news.riskyN}건 (${cats})`);
  }
  return L;
}

export const overall = (L) => { const s = L.reduce((a, x) => a + (x.level === "red" ? 3 : x.level === "yellow" ? 1 : 0), 0); return { score: s, level: s >= 3 ? "red" : s >= 1 ? "yellow" : "green" }; };

export async function lightsCard(env, t) {
  const errors = [];
  const [q, e, a, i, n, b, p] = await Promise.allSettled([src.quote(env, t), src.earnings(env, t), src.analyst(env, t), src.insider(env, t), src.news(env, t), ch.chartBars(env, t), fh(env, "stock/profile2", { symbol: t })]);
  const ok = (r, name) => { if (r.status === "fulfilled") return r.value; errors.push(`${name}: ${r.reason && r.reason.message}`); return null; };
  const quote = ok(q, "시세"), earnings = ok(e, "실적"), analyst = ok(a, "애널리스트"), insider = ok(i, "내부자"), news = ok(n, "뉴스"), cb = ok(b, "차트"), pf = ok(p, "프로필");
  const lights = lightsFrom({ quote, earnings, analyst, insider, news, bars: cb && cb.bars });
  const o = overall(lights);
  return { ticker: t, industry: (pf && pf.finnhubIndustry) || "", price: quote ? quote.price : null, pct: quote ? quote.pct : null, lights, level: o.level, score: o.score, errors, at: new Date().toISOString() };
}
