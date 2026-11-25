// 교차 점검: 뉴스·기업 발표의 주장을 실제 데이터(SEC 재무제표, 실적 서프라이즈, 내부자 거래, IPO)와 규칙으로 대조한다.
// 규칙은 모두 단순하고 공개된 것이며, '진위 판정'이 아니라 '발표와 숫자가 엇갈리는지' 알려주는 용도다.
import { fh, day, addDays } from "./sources.js";
import * as src from "./sources.js";
import { companyCard } from "./company.js";

const CLAIMS = [
  ["record", /\brecord\b.{0,40}\b(revenue|sales|earnings|profit|quarter|growth)\b/i, "사상 최대 실적"],
  ["profit", /\b(profitab|turns? (a )?profit|returns? to profit|net income (rose|jump|surge))/i, "수익성 개선"],
  ["beat", /\b(beat|beats|tops|top|topped|exceed|exceeds|surpass(es)?|crush(es)?)\b.{0,40}\b(estimate|expectation|forecast|consensus|view)s?\b/i, "예상치 상회"],
  ["guide", /\b(rais(e|es|ed)|boost(s|ed)?|lift(s|ed)?|hike[sd]?)\b.{0,30}\b(guidance|outlook|forecast|target)\b/i, "가이던스 상향"],
  ["growth", /\b(revenue|sales)\b.{0,50}\b(grow|grew|growth|jump|jumped|surge|surged|soar|soared|rise|rose|up|increase[sd]?|climb)/i, "매출 성장"],
  ["demand", /\b(strong|surging|soaring|booming|robust|record|insatiable)\b.{0,20}\bdemand\b/i, "수요 강세"],
  ["ipo", /\b(ipo|initial public offering|go(es)? public|direct listing|spac)\b/i, "IPO·상장"],
];
const cleanText = (s) => String(s || "").replace(/\s+/g, " ").trim();

export function detectClaims(items) {
  const out = [];
  for (const x of items) {
    const text = cleanText(x.headline) + " " + cleanText(x.summary).slice(0, 240), tags = [];
    for (const [id, re, label] of CLAIMS) if (re.test(text)) tags.push({ id, label });
    if (!tags.length) continue;
    const pct = (text.match(/(\d{1,3}(?:\.\d+)?)\s?%/) || [])[1];
    out.push({ headline: cleanText(x.headline).slice(0, 160), url: x.url || "", source: x.source || "", date: x.datetime ? new Date(x.datetime * 1000).toISOString().slice(0, 10) : "", tags, pct: pct ? Number(pct) : null });
  }
  return out;
}

const last2 = (s) => (s && s.length >= 2 ? [s[s.length - 2], s[s.length - 1]] : null);
const pct = (a, b) => (a && b != null ? (b - a) / Math.abs(a) : null);
const P = (x) => (x == null ? "-" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%");
const B = (n) => (n == null ? "-" : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);
const yr = (e) => String(e).slice(0, 4);

// 순수 함수: 주장 + 실제 데이터 → 점검 목록 (시험하기 쉽게 분리)
export function buildChecks({ claims, card, earn, insider, ipo }) {
  const checks = [], S = (card && card.series) || {}, has = (id) => claims.filter((c) => c.tags.some((t) => t.id === id));
  const add = (id, title, status, claim, fact, note) => checks.push({ id, title, status, claim: claim || "", fact, note: note || "" });

  const rev = last2(S.revenue), ni = last2(S.netIncome), op = last2(S.operatingIncome), ocf = S.ocf && S.ocf.length ? S.ocf[S.ocf.length - 1][1] : null;
  const g = rev ? pct(rev[0][1], rev[1][1]) : null;
  // 1. 매출 성장 / 사상 최대 / 수요 강세 주장 vs 연간 매출
  const gc = [...has("growth"), ...has("record"), ...has("demand")];
  if (gc.length) {
    const claim = gc[0].headline + (gc[0].pct != null ? ` (기사 속 수치 ${gc[0].pct}%)` : "");
    if (g == null) add("rev", "매출 성장 주장", "확인불가", claim, "SEC 연간 매출 자료를 못 가져왔습니다", "");
    else add("rev", "매출 성장 주장", g > 0.02 ? "일치" : "불일치", claim, `최근 회계연도(${yr(rev[1][0])}) 매출 ${B(rev[1][1])}, 전년 대비 ${P(g)}`, g > 0.02 ? "연간 기준으로는 성장 방향이 맞습니다. 기사의 %가 분기·부문 기준이면 숫자는 다를 수 있습니다." : "기사는 성장을 말하지만 연간 매출은 늘지 않았습니다. 분기 기준 반등인지 원문을 확인하세요.");
  }
  // 2. 수익성 주장 vs 순이익
  const pc = has("profit");
  if (pc.length) {
    if (!ni) add("profit", "수익성 주장", "확인불가", pc[0].headline, "SEC 순이익 자료 없음", "");
    else add("profit", "수익성 주장", ni[1][1] > 0 ? "일치" : "불일치", pc[0].headline, `최근 회계연도(${yr(ni[1][0])}) 순이익 ${B(ni[1][1])} (전년 ${B(ni[0][1])})`, ni[1][1] > 0 ? "" : "연간 순이익은 아직 적자입니다. 영업이익이나 조정 이익(비GAAP) 기준 발표일 수 있습니다.");
  }
  // 3. 예상치 상회 / 사상 최대 vs 실적 서프라이즈
  const hist = (earn && earn.history) || [];
  const bc = has("beat");
  if (bc.length) {
    const rows = hist.filter((x) => x.epsEst != null && x.epsActual != null);
    if (!rows.length) add("beat", "예상치 상회 주장", "확인불가", bc[0].headline, "최근 실적 예상치 데이터 없음", "");
    else {
      const beats = rows.filter((x) => x.epsActual >= x.epsEst).length, L = rows[0];
      const revNote = L.revActual != null && L.revEst ? ` 매출은 예상 대비 ${P((L.revActual - L.revEst) / L.revEst)}.` : "";
      add("beat", "예상치 상회 주장", L.epsActual >= L.epsEst ? "일치" : "불일치", bc[0].headline, `직전(${L.date}) EPS 실제 ${L.epsActual} vs 예상 ${L.epsEst}.${revNote} 최근 ${rows.length}분기 중 ${beats}분기 상회`, "예상치는 회사가 사전에 유도하는 경우가 많아 '상회' 자체가 강한 신호는 아닙니다.");
    }
  }
  // 4. 가이던스 상향 주장: 숫자로 검증 불가 → 사실대로 표시
  const gu = has("guide");
  if (gu.length) add("guide", "가이던스 상향 주장", "확인불가", gu[0].headline, "가이던스는 회사의 전망치라 무료 데이터로 사후 검증이 어렵습니다", "과거 가이던스가 실제와 얼마나 맞았는지(직전 분기 EPS 서프라이즈 추세)만 참고하세요.");

  // 상시 점검 (뉴스에 주장이 없어도 항상 본다)
  if (ni && ocf != null && ni[1][1] > 0) {
    const r = ocf / ni[1][1];
    add("quality", "이익의 질 (순이익 vs 영업현금흐름)", r < 0.6 ? "주의" : "일치", "", `순이익 ${B(ni[1][1])} 대비 영업현금흐름 ${B(ocf)} (${(r * 100).toFixed(0)}%)`, r < 0.6 ? "장부상 이익만큼 현금이 들어오지 않았습니다. 매출채권·재고 증가 등을 확인하세요." : "이익이 현금으로도 뒷받침됩니다.");
  } else if (ni && ni[1][1] < 0 && ocf != null) add("quality", "이익의 질 (순이익 vs 영업현금흐름)", ocf < 0 ? "주의" : "참고", "", `순이익 ${B(ni[1][1])}, 영업현금흐름 ${B(ocf)}`, ocf < 0 ? "적자인데 영업현금도 마이너스라 자금 소진 속도를 봐야 합니다." : "적자이지만 영업현금은 플러스입니다.");
  if (rev && op && rev[0][1] > 0 && rev[1][1] > 0) {
    const m0 = op[0][1] / rev[0][1], m1 = op[1][1] / rev[1][1];
    add("margin", "영업이익률 추세", m1 < m0 - 0.03 ? "주의" : "일치", "", `${yr(rev[0][0])} ${(m0 * 100).toFixed(1)}% → ${yr(rev[1][0])} ${(m1 * 100).toFixed(1)}%`, m1 < m0 - 0.03 ? "매출이 늘어도 이익률이 내려가면 성장의 질이 나빠지는 신호일 수 있습니다." : "");
  }
  const sh = S.shares || [];
  if (sh.length >= 3) {
    const a = sh[sh.length - 3][1], b = sh[sh.length - 1][1], d = pct(a, b);
    add("dilution", "주식 수 희석", d != null && d > 0.05 ? "주의" : "일치", "", `희석 주식수 2년간 ${P(d)} (${yr(sh[sh.length - 3][0])}→${yr(sh[sh.length - 1][0])})`, d > 0.05 ? "주식이 늘면 같은 이익이 주당으로는 줄어듭니다. 이익 증가 발표와 주당 이익은 다를 수 있습니다." : "");
  }
  if (S.sbc && S.sbc.length && rev) {
    const s = S.sbc[S.sbc.length - 1][1], r = s / rev[1][1];
    if (r > 0.1) add("sbc", "주식보상비 비중", "주의", "", `주식보상비 ${B(s)} = 매출의 ${(r * 100).toFixed(0)}%`, "조정 이익(비GAAP)은 보통 이 비용을 빼고 계산합니다. 발표된 '조정 이익'과 GAAP 순이익의 차이를 보세요.");
  }
  if (insider) {
    const bullish = claims.some((c) => c.tags.some((t) => ["record", "beat", "growth", "demand", "guide"].includes(t.id)));
    const heavy = insider.sellValue >= 2e7 && insider.buyN === 0;
    if (heavy || (bullish && insider.sellN > insider.buyN * 3 && insider.sellN >= 3))
      add("insider", "내부자 거래 vs 낙관적 발표", "주의", bullish ? "낙관적 뉴스·발표가 있음" : "", `최근 6개월 내부자 매도 ${insider.sellN}건(${B(insider.sellValue)}), 매수 ${insider.buyN}건`, "정기 매도 계획(10b5-1)일 수 있어 단정할 수 없습니다. 방향만 참고하세요.");
    else if (insider.buyValue >= 1e6) add("insider", "내부자 거래", "일치", "", `최근 6개월 공개시장 매수 ${insider.buyN}건(${B(insider.buyValue)})`, "내부자가 자기 돈으로 산 것은 상대적으로 의미 있는 신호입니다.");
  }
  // IPO
  if (ipo && ipo.date) {
    const ago = Math.round((Date.now() - Date.parse(ipo.date)) / 86400000);
    if (ago >= 0 && ago <= 800) {
      const lock = day(addDays(new Date(ipo.date), 180)), toLock = Math.round((Date.parse(lock) - Date.now()) / 86400000);
      add("ipo", "IPO 이후 경과", ago < 365 ? "주의" : "참고", ipo.claim || "", `상장일 ${ipo.date} (${Math.round(ago / 30)}개월 전)${ipo.price ? `, 공모가 $${ipo.price}` : ""}. 보호예수 해제 추정일 ${lock}${toLock > 0 ? ` (D-${toLock})` : " (이미 지남)"}`, "보호예수 180일은 통상적인 추정이며 실제 기간은 S-1/424B 문서에서 확인해야 합니다. 상장 직후에는 과거 재무 이력이 짧습니다.");
    }
  }
  if (ipo && ipo.upcoming) add("ipo-up", "IPO 일정", "주의", "", `${ipo.upcoming.date} 상장 예정${ipo.upcoming.price ? `, 공모가 범위 ${ipo.upcoming.price}` : ""}${ipo.upcoming.shares ? `, ${Number(ipo.upcoming.shares).toLocaleString("en-US")}주` : ""}`, "상장 전 자료는 신고서(S-1)가 사실상 유일한 근거입니다. 첫날 변동이 매우 큽니다.");
  if (!checks.length) add("none", "점검할 주장 없음", "참고", "", "최근 2주 뉴스에서 실적·성장·IPO 관련 주장을 찾지 못했고 재무 자료도 부족합니다", "");
  return checks;
}

export async function verifyCard(env, t) {
  const errors = [], now = new Date();
  const [news, card, earn, ins, prof] = await Promise.allSettled([
    fh(env, "company-news", { symbol: t, from: day(addDays(now, -14)), to: day(now) }),
    companyCard(env, t, true), src.earnings(env, t), src.insider(env, t),
    fh(env, "calendar/ipo", { from: day(addDays(now, -100)), to: day(addDays(now, 60)) }),
  ]);
  const ok = (r, name) => { if (r.status === "fulfilled") return r.value; errors.push(`[${name}] ${r.reason && r.reason.message}`); return null; };
  const items = ok(news, "뉴스") || [], c = ok(card, "재무"), e = ok(earn, "실적"), i = ok(ins, "내부자"), cal = ok(prof, "IPO 일정");
  if (c && c.errors) errors.push(...c.errors);
  const claims = detectClaims(Array.isArray(items) ? items.slice(0, 60) : []).slice(0, 8);
  const ipo = { date: c && c.ipoDate, claim: (claims.find((x) => x.tags.some((g) => g.id === "ipo")) || {}).headline };
  const hit = cal && Array.isArray(cal.ipoCalendar) ? cal.ipoCalendar.find((x) => String(x.symbol).toUpperCase() === t) : null;
  if (hit && hit.date) { if (hit.date >= day(now)) ipo.upcoming = { date: hit.date, price: hit.price, shares: hit.numberOfShares }; else if (!ipo.date) { ipo.date = hit.date; ipo.price = hit.price; } }
  const checks = buildChecks({ claims, card: c, earn: e, insider: i, ipo });
  return { ticker: t, claims, checks, caution: checks.filter((x) => x.status === "불일치" || x.status === "주의").length, at: now.toISOString(), errors };
}

// AI에게 넘기는 요약(텍스트). 게시된 주장과 실제 데이터가 엇갈린 부분을 먼저 적는다.
export function verifyText(v) {
  if (!v || !v.checks || !v.checks.length) return "";
  const order = { 불일치: 0, 주의: 1, 확인불가: 2, 참고: 3, 일치: 4 };
  const L = v.checks.slice().sort((a, b) => order[a.status] - order[b.status]).map((c) => `- [${c.status}] ${c.title}${c.claim ? ` — 발표/뉴스: "${c.claim}"` : ""} / 실제 데이터: ${c.fact}${c.note ? ` (${c.note})` : ""}`);
  return "교차 점검(뉴스·기업 발표 vs SEC 재무제표·실적·내부자·IPO 데이터 대조):\n" + L.join("\n") + "\n→ 불일치·주의 항목은 낙관적 발표를 그대로 믿지 말고 위험 요인에 반영하세요.";
}
