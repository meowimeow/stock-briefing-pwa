// 기업분석의 데이터 수집부 (Streamlit의 company_analysis.py를 옮긴 것).
// companyfacts 전체(수 MB)는 무료 Worker의 CPU 한도를 넘길 수 있어서, 항목별로 작은 companyconcept 응답만 받는다.
import { fh, getJson, SEC_UA } from "./sources.js";

const TAGS = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForCapitalImprovements", "PaymentsToAcquireProductiveAssets"],
};

// 교차 점검용 추가 항목: 주식보상비(USD), 희석 주식수(shares)
const EXTRA = {
  sbc: { tags: ["ShareBasedCompensation"], unit: "USD" },
  shares: { tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares" },
};

const annual = (v) => {
  if (v.form !== "10-K" || v.fp !== "FY" || !v.start || !v.end) return false;
  const days = (Date.parse(v.end) - Date.parse(v.start)) / 86400000;
  return days >= 350 && days <= 380;
};

async function concept(cik, tag, unit = "USD") {
  try {
    const j = await getJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/us-gaap/${tag}.json`, SEC_UA);
    return { rows: ((j.units || {})[unit] || []).filter(annual) };
  } catch (e) {
    return e.message === "HTTP 404" ? { rows: [] } : { error: e.message };
  }
}

// 회사가 중간에 태그를 바꿔도 이어 붙이도록 모든 후보 태그를 합치고, 같은 회계연도말은 나중에 제출된 값을 쓴다.
async function series(cik, key, errors) {
  const ex = EXTRA[key], res = await Promise.all((ex ? ex.tags : TAGS[key]).map((tag) => concept(cik, tag, ex ? ex.unit : "USD")));
  const byEnd = new Map();
  for (const r of res) {
    if (r.error) { errors.push(`[SEC ${key}] ${r.error}`); continue; }
    for (const v of r.rows) { const old = byEnd.get(v.end); if (!old || (v.filed || "") >= (old.filed || "")) byEnd.set(v.end, v); }
  }
  return [...byEnd.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([end, v]) => [end, v.val]);
}

export async function companyCard(env, t, extra = false) {
  const errors = [];
  let cik = null, name = "";
  try {
    const dir = await getJson("https://www.sec.gov/files/company_tickers.json", SEC_UA);
    const hit = Object.values(dir).find((x) => String(x.ticker).toUpperCase() === t);
    if (hit) { cik = hit.cik_str; name = hit.title || ""; } else errors.push(`[SEC] '${t}' 티커를 찾을 수 없습니다 (미국 상장사만 지원, 확인 필요)`);
  } catch (e) { errors.push(`[SEC] ${e.message}`); }

  const profileP = fh(env, "stock/profile2", { symbol: t }).catch((e) => { errors.push(`[Finnhub] ${e.message}`); return null; });
  const keys = Object.keys(TAGS).concat(extra ? Object.keys(EXTRA) : []);
  const sers = cik ? await Promise.all(keys.map((k) => series(cik, k, errors))) : keys.map(() => []);
  const p = (await profileP) || {};
  const out = { ticker: t, cik, name: name || p.name || "", industry: p.finnhubIndustry || "", exchange: p.exchange || "", marketCapMusd: p.marketCapitalization || null, ipoDate: p.ipo || null, series: {}, errors };
  keys.forEach((k, i) => (out.series[k] = sers[i]));
  return out;
}
