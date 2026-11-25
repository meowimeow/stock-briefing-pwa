// 뉴스 수집과 규칙 기반 분석 (Streamlit의 fetcher.py + local_analyzer.py + exchange.py를 옮긴 것)
import { fh, getJson, day, addDays } from "./sources.js";
import { riskCategory, RISK } from "./risk.js";

const POS = ["surge", "soar", "rally", "record high", "beat expectations", "beats estimates", "jump", "gain", "rise", "growth", "breakthrough", "upgrade", "outperform", "profit", "strong demand", "expansion", "approval", "win", "boom",
  "급등", "호실적", "신기록", "성장", "호재", "수주", "흑자", "승인", "최대",
  "大涨", "涨停", "暴涨", "突破", "增长", "利好", "订单", "扩产", "获批", "国产替代", "超预期", "创新高"];
const NEG = ["plunge", "slump", "crash", "miss expectations", "misses estimates", "fall", "drop", "decline", "layoff", "recall", "lawsuit", "downgrade", "underperform", "loss", "weak demand", "shortage", "ban", "tariff", "probe", "investigation", "delay", "bankruptcy",
  "급락", "적자", "리콜", "소송", "규제", "제재", "감원", "부진", "하락", "우려",
  "大跌", "跌停", "暴跌", "制裁", "出口管制", "亏损", "减持", "退市", "调查", "处罚", "限制", "禁令", "下滑", "承压"];
const HIGH = ["record", "crash", "plunge", "surge", "soar", "bankruptcy", "recall", "lawsuit", "ban", "tariff", "merger", "acquisition", "acquire", "ipo", "investigation", "probe", "breakthrough", "regulation",
  "급등", "급락", "파산", "리콜", "소송", "규제", "인수", "합병", "제재",
  "涨停", "跌停", "制裁", "出口管制", "禁令", "收购", "并购", "重组", "破产"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 영어는 단어 경계 + 흔한 어미(s, es, ed, d, ing)까지만 허용한다. ("ban"이 "bank"에, "win"이 "window"에 걸리지 않게)
const rx = (w) => (/^[a-z0-9 \-]+$/i.test(w) ? new RegExp(`\\b${esc(w)}(?:s|es|ed|d|ing)?\\b`, "i") : new RegExp(esc(w), "i"));
const build = (list) => list.map((w) => [w, rx(w)]);
const POS_R = build(POS), NEG_R = build(NEG), HIGH_R = build(HIGH);
const hits = (text, rules) => rules.filter(([, r]) => r.test(text)).map(([w]) => w);

export function analyze(a) {
  const text = `${a.title} ${a.summary}`;
  const pos = hits(text, POS_R), neg = hits(text, NEG_R), imp = hits(text, HIGH_R);
  const sentiment = pos.length > neg.length ? "긍정" : neg.length > pos.length ? "부정" : "중립";
  const reason = [];
  if (pos.length) reason.push("긍정 키워드: " + pos.slice(0, 3).join(", "));
  if (neg.length) reason.push("부정 키워드: " + neg.slice(0, 3).join(", "));
  return { ...a, sentiment, impact: 1 + Math.min(4, imp.length), reason: reason.join(" / ") || "뚜렷한 감성 키워드 없음 (제목/요약만으로 판단)", risk: riskCategory(text) };
}

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const fromFinnhub = (x, ticker) => ({
  title: clip(x.headline, 200) || "(제목 없음)", summary: clip(x.summary, 280), url: x.url || "", source: x.source || "",
  at: x.datetime ? new Date(x.datetime * 1000).toISOString() : "", ticker: ticker || "",
});

export async function companyNews(env, t, daysBack = 3) {
  const now = new Date();
  const items = await fh(env, "company-news", { symbol: t, from: day(addDays(now, -daysBack)), to: day(now) });
  if (!Array.isArray(items)) throw new Error("뉴스 응답 형식 오류");
  return items.slice(0, 25).map((x) => analyze(fromFinnhub(x, t)));
}

export async function marketNews(env) {
  const items = await fh(env, "news", { category: "general" });
  if (!Array.isArray(items)) throw new Error("뉴스 응답 형식 오류");
  return items.slice(0, 40).map((x) => analyze(fromFinnhub(x, "")));
}

// NewsAPI는 검색어가 500자를 넘으면 거절하므로 나눠서 보낸다.
function chunks(words, max = 450) {
  const out = []; let cur = [], len = 0;
  for (const w of words) {
    const piece = w.length + 2 + (cur.length ? 4 : 0);
    if (cur.length && len + piece > max) { out.push(cur); cur = []; len = 0; }
    cur.push(w); len += w.length + 2 + (cur.length > 1 ? 4 : 0);
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function keywordNews(env, words, { daysBack = 3, size = 30, maxChunks = 2 } = {}) {
  if (!env.NEWSAPI_KEY) throw new Error("NEWSAPI_KEY가 서버에 없습니다");
  const from = day(addDays(new Date(), -daysBack));
  const arts = [], errs = [];
  for (const ch of chunks(words).slice(0, maxChunks)) {
    const q = ch.map((k) => `"${k}"`).join(" OR ");
    try {
      const j = await getJson(`https://newsapi.org/v2/everything?${new URLSearchParams({ q, from, sortBy: "publishedAt", language: "en", pageSize: String(size), apiKey: env.NEWSAPI_KEY })}`);
      if (j.status !== "ok") throw new Error(j.message || "NewsAPI 오류");
      for (const a of j.articles || []) arts.push(analyze({ title: clip(a.title, 200) || "(제목 없음)", summary: clip(a.description, 280), url: a.url || "", source: (a.source || {}).name || "", at: a.publishedAt || "", ticker: "" }));
    } catch (e) { errs.push(e.message); }
  }
  if (!arts.length && errs.length) throw new Error(errs[0]);
  return arts;
}

export const riskWords = () => Object.values(RISK).flat().filter((w) => /^[a-z0-9 \-]+$/i.test(w));

export async function fxRates() {
  const j = await getJson("https://api.frankfurter.app/latest?from=KRW&to=USD,JPY,CNY");
  const L = { USD: "달러(USD)", JPY: "엔(JPY, 100엔 기준)", CNY: "위안(CNY)" };
  const rows = Object.entries(L).filter(([c]) => j.rates && j.rates[c]).map(([c, label]) => ({ cur: c, label, value: (1 / j.rates[c]) * (c === "JPY" ? 100 : 1) }));
  if (!rows.length) throw new Error("환율 데이터가 비어 있습니다");
  return { date: j.date, rows };
}

// 달러-원 환율: Yahoo(거의 실시간, 비공식) → 실패 시 Frankfurter(하루 한 번, ECB 기준)
export async function usdKrw() {
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/KRW%3DX?range=1d&interval=1m", { headers: { "User-Agent": "Mozilla/5.0 (compatible; personal-news-reader)" } });
    if (r.ok) {
      const m = (await r.json()).chart.result[0].meta, v = m.regularMarketPrice;
      if (v > 500 && v < 3000) return { rate: v, at: new Date((m.regularMarketTime || Date.now() / 1000) * 1000).toISOString(), source: "Yahoo(시장 환율, 수 분 지연 가능)" };
    }
  } catch {}
  const j = await getJson("https://api.frankfurter.app/latest?from=USD&to=KRW");
  if (!j || !j.rates || !j.rates.KRW) throw new Error("환율을 가져오지 못했습니다");
  return { rate: j.rates.KRW, at: j.date + "T00:00:00Z", source: "Frankfurter(하루 한 번 갱신)" };
}
