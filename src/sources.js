// 여러 모듈이 같이 쓰는 데이터 도우미: Finnhub 호출, 시세·실적·의견·내부자·뉴스·공시.
// 키와 연락처는 전부 환경변수(Cloudflare Secrets)에서 읽는다. 코드에는 개인 값을 두지 않는다.
import { riskCategory } from "./risk.js";
import { analystDetail, insiderDetail, filingsDetail } from "./global.js";

// SEC는 자동 요청에 연락처를 요구한다. 배포한 사람이 SEC_CONTACT에 직접 넣는다 (Worker가 요청마다 채운다).
export const SEC_UA = {};
export function setContact(env) {
  // 헤더에는 ASCII만 넣을 수 있다.
  const c = String(env.SEC_CONTACT || "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, 100);
  if (c) SEC_UA["User-Agent"] = `stock-briefing-pwa (${c})`; else delete SEC_UA["User-Agent"];
}

export const day = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * 864e5);

export async function getJson(url, headers = {}) {
  if (headers === SEC_UA && !SEC_UA["User-Agent"]) throw new Error("SEC_CONTACT가 서버에 없습니다. Cloudflare Secret으로 추가하세요");
  let r;
  try { r = await fetch(url, { headers }); } catch { throw new Error("네트워크 오류"); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  try { return await r.json(); } catch { throw new Error("응답을 읽을 수 없습니다"); }
}

export const fh = (env, path, params = {}) =>
  getJson(`https://finnhub.io/api/v1/${path}?${new URLSearchParams(params)}`, { "X-Finnhub-Token": env.FINNHUB_KEY });

export async function quote(env, t) {
  const q = await fh(env, "quote", { symbol: t });
  if (!(q.c > 0)) throw new Error("시세 없음");
  return { price: q.c, pct: q.dp ?? null, prev: q.pc || null };
}

// 다음 실적 일정과 지난 결과
export async function earnings(env, t) {
  const now = new Date(), today = day(now);
  const j = await fh(env, "calendar/earnings", { symbol: t, from: day(addDays(now, -400)), to: day(addDays(now, 90)) });
  const rows = (j.earningsCalendar || []).filter((x) => x && x.date)
    .map((x) => ({ date: x.date, hour: x.hour || "", epsEst: x.epsEstimate ?? null, epsActual: x.epsActual ?? null, revEst: x.revenueEstimate ?? null, revActual: x.revenueActual ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = rows.find((x) => x.date >= today && x.epsActual == null) || {};
  const history = rows.filter((x) => x.epsActual != null).reverse().slice(0, 8);
  return { date: next.date || null, hour: next.hour || "", epsEst: next.epsEst ?? null, revEst: next.revEst ?? null, last: history[0] || null, history };
}

export const analyst = async (env, t) => (await analystDetail(env, t)).summary;
export async function insider(env, t) {
  const s = (await insiderDetail(env, t)).summary;
  return { buyN: s.pos, sellN: s.neg, buyValue: s.buyValue, sellValue: s.sellValue };
}

export async function news(env, t) {
  const now = new Date(), items = await fh(env, "company-news", { symbol: t, from: day(addDays(now, -3)), to: day(now) });
  if (!Array.isArray(items)) throw new Error("뉴스 응답 형식 오류");
  const articles = items.slice(0, 25).map((x) => ({
    title: String(x.headline || "(제목 없음)").slice(0, 200), url: x.url || "", source: x.source || "",
    at: x.datetime ? new Date(x.datetime * 1000).toISOString() : "", risk: riskCategory(`${x.headline || ""} ${x.summary || ""}`),
  }));
  const risky = articles.filter((x) => x.risk);
  return { articles, risky, riskyN: risky.length };
}

// 종목 화면의 뉴스 탭: 뉴스 + 공시 + 규칙 신호
export async function ticker(env, t) {
  const errors = {}, [n, f] = await Promise.allSettled([news(env, t), filingsDetail(env, t)]);
  const ok = (r, name) => { if (r.status === "fulfilled") return r.value; errors[name] = r.reason.message; return null; };
  const nv = ok(n, "news"), fv = ok(f, "filings"), events = [];
  if (nv && nv.riskyN) events.push(["warn", "뉴스", `리스크 키워드 뉴스 ${nv.riskyN}건 (${[...new Set(nv.risky.map((x) => x.risk))].join(", ")})`]);
  return { ticker: t, news: nv, filings: fv, events, errors, at: new Date().toISOString() };
}

export async function peers(env, t) {
  const list = await fh(env, "stock/peers", { symbol: t });
  return Promise.all((Array.isArray(list) ? list : []).filter((x) => x && x !== t).slice(0, 6)
    .map(async (x) => { try { const q = await quote(env, x); return { t: x, price: q.price, pct: q.pct }; } catch (e) { return { t: x, error: e.message }; } }));
}
