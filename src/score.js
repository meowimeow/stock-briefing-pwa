// 기업 종합 점수표(안정↔위험): 널리 쓰는 재무 지표를 구간표로 점수화한다. 밸류에이션(PER·PBR)은 동종업체 비교가 필요해 화면에서 합친다.
// 모든 구간은 '경험칙'이며 업종마다 다르다(은행·리츠는 부채가 많고 성장주는 PER이 높다). 그래서 항목별 값·기준·점수를 모두 보여준다.
import { fh, getJson } from "./sources.js";
import { companyCard } from "./company.js";

const num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
// 구간표: [기준값, 점수] 를 위에서부터 보며 처음 만족하는 점수. dir "ge": 값≥기준, "le": 값≤기준
const band = (v, rows, dir = "ge") => { for (const [t, p] of rows) if (dir === "ge" ? v >= t : v <= t) return p; return 0; };

export const RULES = {
  de: { label: "부채비율 (총부채/자기자본)", fmt: "x", rows: [[0.5, 100], [1, 75], [2, 45], [Infinity, 15]], dir: "le", text: "≤0.5배 100 · ≤1배 75 · ≤2배 45 · 초과 15 (자기자본 음수면 0)" },
  cr: { label: "유동비율", fmt: "x", rows: [[2, 100], [1.5, 80], [1, 55], [-Infinity, 25]], dir: "ge", text: "≥2배 100 · ≥1.5배 80 · ≥1배 55 · 미만 25" },
  ic: { label: "이자보상배율", fmt: "x", rows: [[10, 100], [5, 80], [2, 50], [0, 15], [-Infinity, 0]], dir: "ge", text: "≥10배 100 · ≥5배 80 · ≥2배 50 · ≥0 15 · 음수 0" },
  opm: { label: "영업이익률", fmt: "%", rows: [[25, 100], [15, 80], [8, 60], [0, 35], [-Infinity, 10]], dir: "ge", text: "≥25% 100 · ≥15% 80 · ≥8% 60 · ≥0% 35 · 적자 10" },
  roe: { label: "자기자본이익률(ROE)", fmt: "%", rows: [[20, 100], [12, 80], [6, 55], [0, 30], [-Infinity, 5]], dir: "ge", text: "≥20% 100 · ≥12% 80 · ≥6% 55 · ≥0% 30 · 적자 5" },
  rg: { label: "매출 성장률(전년 대비)", fmt: "%", rows: [[20, 100], [10, 80], [3, 60], [0, 40], [-Infinity, 15]], dir: "ge", text: "≥20% 100 · ≥10% 80 · ≥3% 60 · ≥0% 40 · 감소 15" },
  eg: { label: "EPS 성장률(전년 대비)", fmt: "%", rows: [[20, 100], [10, 80], [0, 55], [-Infinity, 20]], dir: "ge", text: "≥20% 100 · ≥10% 80 · ≥0% 55 · 감소 20" },
  fcfm: { label: "잉여현금흐름 마진 (FCF/매출)", fmt: "%", rows: [[15, 100], [8, 80], [0, 55], [-Infinity, 15]], dir: "ge", text: "≥15% 100 · ≥8% 80 · ≥0% 55 · 음수 15" },
  oq: { label: "이익의 질 (영업현금흐름/순이익)", fmt: "x", rows: [[1, 100], [0.8, 75], [0.5, 45], [-Infinity, 20]], dir: "ge", text: "≥1배 100 · ≥0.8배 75 · ≥0.5배 45 · 미만 20" },
};
export const WEIGHTS = { health: 30, profit: 25, growth: 15, cash: 20, value: 10 };
export const LABELS = { health: "재무 건전성", profit: "수익성", growth: "성장성", cash: "현금흐름", value: "밸류에이션" };

const last = (s) => (s && s.length ? s[s.length - 1] : null);
const prev = (s) => (s && s.length > 1 ? s[s.length - 2] : null);

export function buildScore({ m, S }) {
  const A = [], used = {}, add = (cat, id, v, src, extra = {}) => {
    const r = RULES[id];
    if (v == null) { A.push({ cat, id, label: r.label, value: null, pts: null, rule: r.text, src: "데이터 없음" }); return; }
    A.push({ cat, id, label: r.label, value: v, fmt: r.fmt, pts: extra.pts != null ? extra.pts : band(v, r.rows, r.dir), rule: r.text, src, note: extra.note || "" });
  };
  const rev = last(S.revenue), rev0 = prev(S.revenue), ni = last(S.netIncome), op = last(S.operatingIncome), ocf = last(S.ocf), cap = last(S.capex);
  // 재무 건전성
  let de = num(m["totalDebt/totalEquityQuarterly"]) ?? num(m["totalDebt/totalEquityAnnual"]);
  if (de != null && de > 25) de = de / 100; // 일부 값이 %로 오는 경우 방어
  const eqNeg = num(m.pbQuarterly) != null && m.pbQuarterly < 0;
  add("health", "de", de, "Finnhub", eqNeg ? { pts: 0, note: "자기자본이 음수일 가능성" } : {});
  add("health", "cr", num(m.currentRatioQuarterly) ?? num(m.currentRatioAnnual), "Finnhub");
  add("health", "ic", num(m.netInterestCoverageTTM) ?? num(m.netInterestCoverageAnnual), "Finnhub");
  // 수익성
  let opm = num(m.operatingMarginTTM), opmSrc = "Finnhub";
  if (opm == null && op && rev && rev[1] > 0) { opm = (op[1] / rev[1]) * 100; opmSrc = "SEC 10-K"; }
  add("profit", "opm", opm, opmSrc);
  add("profit", "roe", num(m.roeTTM) ?? num(m.roeRfy), "Finnhub");
  // 성장성
  let rg = num(m.revenueGrowthTTMYoy), rgSrc = "Finnhub";
  if (rg == null && rev && rev0 && rev0[1] > 0) { rg = (rev[1] / rev0[1] - 1) * 100; rgSrc = "SEC 10-K"; }
  add("growth", "rg", rg, rgSrc);
  add("growth", "eg", num(m.epsGrowthTTMYoy), "Finnhub");
  // 현금흐름 (SEC 연간)
  const fcf = ocf ? ocf[1] - Math.abs(cap ? cap[1] : 0) : null;
  add("cash", "fcfm", fcf != null && rev && rev[1] > 0 ? (fcf / rev[1]) * 100 : null, "SEC 10-K");
  add("cash", "oq", ocf && ni && ni[1] > 0 ? ocf[1] / ni[1] : null, "SEC 10-K", ni && ni[1] <= 0 ? {} : {});
  if (ni && ni[1] <= 0 && ocf) { const x = A.find((a) => a.id === "oq"); x.value = null; x.pts = ocf[1] > 0 ? 40 : 10; x.src = "SEC 10-K"; x.note = "순이익이 적자라 비율 대신 영업현금흐름 부호로 평가"; x.display = `순이익 적자, 영업현금흐름 ${ocf[1] > 0 ? "플러스" : "마이너스"}`; }
  const cats = Object.keys(WEIGHTS).filter((k) => k !== "value").map((k) => {
    const items = A.filter((a) => a.cat === k), have = items.filter((a) => a.pts != null);
    return { id: k, label: LABELS[k], weight: WEIGHTS[k], score: have.length ? Math.round(have.reduce((s, a) => s + a.pts, 0) / have.length) : null, items };
  });
  return cats;
}

export async function scoreCard(env, t) {
  const errors = [];
  const [mm, pr, cd] = await Promise.allSettled([fh(env, "stock/metric", { symbol: t, metric: "all" }), fh(env, "stock/peers", { symbol: t }), companyCard(env, t)]);
  const m = mm.status === "fulfilled" && mm.value && mm.value.metric ? mm.value.metric : (errors.push("[지표] " + (mm.reason ? mm.reason.message : "데이터 없음")), {});
  const card = cd.status === "fulfilled" ? cd.value : (errors.push("[재무] " + cd.reason.message), { series: { revenue: [], netIncome: [], operatingIncome: [], ocf: [], capex: [] }, errors: [] });
  errors.push(...(card.errors || []));
  const cats = buildScore({ m, S: card.series });
  const peers = pr.status === "fulfilled" && Array.isArray(pr.value) ? pr.value.filter((p) => p && p !== t).slice(0, 5) : [];
  const val = { pe: num(m.peTTM) ?? num(m.peBasicExclExtraTTM), pb: num(m.pbQuarterly) ?? num(m.pbAnnual), ps: num(m.psTTM), evFcf: num(m["currentEv/freeCashFlowTTM"]), pfcf: num(m.pfcfShareTTM), divYield: num(m.dividendYieldIndicatedAnnual), beta: num(m.beta), hi52: num(m["52WeekHigh"]), lo52: num(m["52WeekLow"]), mcap: num(m.marketCapitalization) };
  return { ticker: t, name: card.name || "", industry: card.industry || "", cats, val, peers, errors, at: new Date().toISOString() };
}

// 동종업체의 PER·PBR 한 종목분 (화면에서 중앙값을 낸다)
export async function peerMultiples(env, p) {
  const j = await fh(env, "stock/metric", { symbol: p, metric: "all" });
  const m = (j && j.metric) || {};
  return { t: p, pe: num(m.peTTM) ?? num(m.peBasicExclExtraTTM), pb: num(m.pbQuarterly) ?? num(m.pbAnnual) };
}
