// 최근 분기 변화: 회사가 SEC에 낸 10-Q·10-K 숫자로 분기별 매출·이익·EPS·이익률을 줄 세우고, 작년 같은 분기와 비교한다.
// 방식은 day-trader-skill의 trader-analyst(MIT, github.com/Jakeschincariol/day-trader-skill)를 따랐다:
// 4분기는 따로 보고하지 않으므로 연간에서 세 분기를 빼서 만들고 "계산값"으로 표시, 순이익이 영업이익보다 크면 본업 밖 이익을 의심,
// SEC 숫자 데이터가 이미 낸 보고서보다 늦으면 그 사실을 알린다. 사다·팔다 같은 판단은 하지 않는다.
// companyfacts 전체(수 MB)는 무료 Worker CPU 한도를 넘길 수 있어 항목별 companyconcept만 받는다.
import { getJson, SEC_UA } from "./sources.js";

const CONCEPTS = {
  revenue: { tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"], unit: "USD" },
  cost: { tags: ["CostOfGoodsAndServicesSold", "CostOfRevenue"], unit: "USD" },
  gross: { tags: ["GrossProfit"], unit: "USD" },
  op: { tags: ["OperatingIncomeLoss"], unit: "USD" },
  ni: { tags: ["NetIncomeLoss", "ProfitLoss"], unit: "USD" },
  eps: { tags: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"], unit: "USD/shares" },
};
const DAY = 86400000;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;

// 한 태그의 기간 값: {"시작|끝": 값}. 같은 기간이 여러 보고서에 나오면 나중에 낸 값(정정 반영)을 쓴다.
async function durations(cik, tag, unit) {
  try {
    const j = await getJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/us-gaap/${tag}.json`, SEC_UA);
    const out = new Map();
    for (const v of (j.units || {})[unit] || []) {
      if (!v.start || !v.end || !/^10-[QK]/.test(v.form || "")) continue;
      const k = v.start + "|" + v.end, old = out.get(k);
      if (!old || (v.filed || "") >= (old.filed || "")) out.set(k, v);
    }
    return out;
  } catch (e) { if (e.message === "HTTP 404") return new Map(); throw e; }
}

// 분기(약 3개월) 값과, 연간에서 세 분기를 빼 만든 4분기. {끝날짜: {value, start, end, derived}}
function quarterly(facts) {
  const q = {}, years = [];
  for (const v of facts.values()) {
    const d = days(v.start, v.end);
    if (d >= 80 && d <= 100) q[v.end] = { value: v.val, start: v.start, end: v.end, derived: false };
    else if (d >= 350 && d <= 380) years.push(v);
  }
  for (const y of years) {
    if (q[y.end]) continue;
    const inside = Object.values(q).filter((x) => !x.derived && x.start >= y.start && x.end < y.end).sort((a, b) => a.end.localeCompare(b.end));
    if (inside.length !== 3) continue;
    const start = new Date(Date.parse(inside[2].end) + DAY).toISOString().slice(0, 10);
    q[y.end] = { value: y.val - inside.reduce((s, x) => s + x.value, 0), start, end: y.end, derived: true };
  }
  return q;
}

// 후보 태그를 순서대로 보며, 앞 태그에 없는 분기만 뒤 태그로 채운다 (회사가 중간에 태그를 바꾸는 경우).
async function metric(cik, key) {
  const c = CONCEPTS[key], merged = {};
  const all = await Promise.all(c.tags.map((tag) => durations(cik, tag, c.unit)));
  for (const facts of all) for (const [end, v] of Object.entries(quarterly(facts))) if (!merged[end]) merged[end] = v;
  return merged;
}

const pct = (a, b) => (a != null && b != null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);
const margin = (part, whole) => (part != null && whole ? (part / whole) * 100 : null);
const yearAgo = (s, end) => Object.values(s).find((x) => Math.abs(days(x.end, end) - 365) <= 10) || null;

export async function quarterCard(env, t) {
  const dir = await getJson("https://www.sec.gov/files/company_tickers.json", SEC_UA);
  const hit = Object.values(dir).find((x) => String(x.ticker).toUpperCase() === t);
  if (!hit) throw new Error(`SEC에서 '${t}'를 찾을 수 없습니다 (미국 상장사만)`);
  const cik = hit.cik_str, errors = [];
  const keys = Object.keys(CONCEPTS);
  const [subR, ...ms] = await Promise.allSettled([getJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, SEC_UA), ...keys.map((k) => metric(cik, k))]);
  const S = {};
  keys.forEach((k, i) => { if (ms[i].status === "fulfilled") S[k] = ms[i].value; else { S[k] = {}; errors.push(`[SEC ${k}] ${ms[i].reason.message}`); } });

  const ends = Object.keys(S.revenue).length ? Object.keys(S.revenue) : Object.keys(S.ni);
  const rows = ends.sort().slice(-8).map((end) => {
    const g = (k) => (S[k][end] ? S[k][end].value : null);
    const rev = g("revenue"), op = g("op"), ni = g("ni"), eps = g("eps");
    const gross = g("gross") ?? (rev != null && g("cost") != null ? rev - g("cost") : null);
    const ago = (k) => { const y = yearAgo(S[k], end); return y ? y.value : null; };
    return {
      end, start: (S.revenue[end] || S.ni[end]).start, derived: ["revenue", "ni", "eps"].some((k) => S[k][end] && S[k][end].derived),
      rev, op, ni, eps, gm: margin(gross, rev), om: margin(op, rev), nm: margin(ni, rev),
      revYoy: pct(rev, ago("revenue")), niYoy: pct(ni, ago("ni")), epsYoy: pct(eps, ago("eps")),
    };
  });
  if (!rows.length) return { ticker: t, name: hit.title, rows: [], errors: errors.length ? errors : ["SEC에 분기 숫자가 없습니다 (외국 기업·신규 상장일 수 있음)"] };

  const latest = rows[rows.length - 1], before = rows.length > 1 ? rows[rows.length - 2] : null;
  // 최근 4분기 합: 네 분기가 끊김 없이 이어질 때만 (빈 분기가 있으면 합이 틀리므로 내지 않는다)
  const last4 = rows.slice(-4), chained = last4.length === 4 && last4.every((r, i) => i === 0 || Math.abs(days(last4[i - 1].end, r.end) - 91) <= 12);
  const sum = (k) => (chained && last4.every((r) => r[k] != null) ? last4.reduce((s, r) => s + r[k], 0) : null);
  const ttm = { rev: sum("rev"), ni: sum("ni"), eps: sum("eps") };

  const flags = [];
  if (latest.ni != null && latest.op != null && latest.ni > latest.op) flags.push({ kind: "oneoff", text: "순이익이 영업이익보다 큽니다. 투자 평가이익·세금 항목 같은 본업 밖 이익이 섞여 있을 수 있어, 본업 실적은 영업이익으로 보는 편이 정확합니다." });
  if (latest.derived) flags.push({ kind: "derived", text: "최근 분기는 회사가 따로 보고하지 않는 4분기라 연간(10-K)에서 1~3분기를 빼 계산했습니다. EPS는 그 사이 주식 수가 변해 근사값입니다." });
  if (latest.gm == null && latest.rev != null) flags.push({ kind: "nogm", text: "매출원가를 따로 보고하지 않는 회사(은행·보험 등)라 매출총이익률은 비워 둡니다." });

  // 가장 최근 10-Q/10-K, 실적 발표 8-K(항목 2.02)
  let report = null, release = null;
  if (subR.status === "fulfilled") {
    const r = subR.value.filings.recent, link = (i) => `https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i] || ""}`;
    for (let i = 0; i < r.form.length; i++) {
      if (!report && /^10-[QK]$/.test(r.form[i])) report = { form: r.form[i], filed: r.filingDate[i], period: r.reportDate[i] || null, url: link(i) };
      if (!release && r.form[i] === "8-K" && String((r.items || [])[i] || "").includes("2.02")) release = { filed: r.filingDate[i], url: link(i) };
      if (report && release) break;
    }
    if (report && report.period && report.period > latest.end) flags.push({ kind: "stale", text: `SEC 숫자 데이터는 ${latest.end} 분기까지인데, ${report.period} 분기 ${report.form}가 ${report.filed}에 이미 제출됐습니다. 최신 숫자는 보고서 원문을 확인하세요.`, url: report.url });
  } else errors.push(`[SEC 제출목록] ${subR.reason.message}`);

  return {
    ticker: t, name: hit.title, rows, latest, before, ttm, flags, report, release, errors,
    gmChange: latest.gm != null && before && before.gm != null ? latest.gm - before.gm : null,
    omChange: latest.om != null && before && before.om != null ? latest.om - before.om : null,
    at: new Date().toISOString(),
  };
}
