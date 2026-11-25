// 중국 쪽 반도체 뉴스: 키 없이 받을 수 있는 공개 RSS만 쓴다. (구글뉴스 검색 RSS, SCMP, TrendForce)
import { analyze } from "./news.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; personal-news-reader)", Accept: "application/rss+xml, application/xml, text/xml" };

const GNEWS = (q, zh = true) => `https://news.google.com/rss/search?${new URLSearchParams({ q: `${q} when:3d`, hl: zh ? "zh-CN" : "en-US", gl: zh ? "CN" : "US", ceid: zh ? "CN:zh-Hans" : "US:en" })}`;
const FEEDS = [
  { name: "구글뉴스(중국어)·과창판", url: GNEWS("科创板 半导体"), gnews: true },
  { name: "구글뉴스(중국어)·중국 반도체 기업", url: GNEWS("中芯国际 OR 华虹 OR 寒武纪 OR 长鑫 OR 长江存储 OR 北方华创"), gnews: true },
  { name: "구글뉴스(중국어)·정책·수출규제", url: GNEWS("半导体 出口管制 OR 国产替代 OR 大基金"), gnews: true },
  { name: "구글뉴스(영어)·STAR Market", url: GNEWS("STAR Market chip OR SMIC OR \"Hua Hong\" OR Cambricon", false), gnews: true },
  { name: "SCMP Tech", url: "https://www.scmp.com/rss/36/feed", filter: true },
  { name: "SCMP China", url: "https://www.scmp.com/rss/4/feed", filter: true },
  { name: "TrendForce", url: "https://www.trendforce.com/news/feed/", filter: "china" },
];

// 일반 매체는 반도체 관련 글만, TrendForce는 중국 관련 글만 남긴다.
const CHIP = /semiconductor|chip|foundry|wafer|lithograph|SMIC|Hua Hong|Huawei|Cambricon|CXMT|YMTC|Naura|AMEC|STAR Market|ASML|Nvidia|export control|rare earth|半导体|芯片|光刻|晶圆|科创板|国产替代/i;
const CN = /china|chinese|SMIC|Hua Hong|Huawei|Cambricon|CXMT|YMTC|Naura|AMEC|STAR Market|Beijing|Shanghai|Shenzhen|Hefei|Wuhan|Xiaomi|BYD|Alibaba|Tencent|中国|中芯/i;

const TOPICS = [
  ["과창판·중국 증시", /科创板|STAR Market|科创50|A股|A-share|science and technology innovation board/i],
  ["중국 반도체 기업", /中芯|SMIC|华虹|Hua Hong|寒武纪|Cambricon|长鑫|CXMT|长江存储|YMTC|华为|Huawei|海光|Hygon|北方华创|Naura|中微|AMEC|沪硅|Piotech|拓荆|SiCarrier|Moore Threads|摩尔线程/i],
  ["정책·수출규제", /出口管制|export control|制裁|sanction|大基金|Big Fund|补贴|subsid|关税|tariff|entity list|禁令|ban\b/i],
];
export const topicOf = (text) => { const t = TOPICS.find(([, r]) => r.test(text)); return t ? t[0] : "기타 중국·반도체"; };

export const unescape = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&");
export const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i")); return m ? unescape(m[1]).trim() : ""; };
export const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function readFeed(f) {
  let r;
  try { r = await fetch(f.url, { headers: UA }); } catch { throw new Error("네트워크 오류"); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  const out = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    let title = strip(tag(it, "title")), source = f.name;
    if (f.gnews) { const sm = tag(it, "source"); if (sm) { source = sm; if (title.endsWith(" - " + sm)) title = title.slice(0, -(sm.length + 3)); } }
    const link = tag(it, "link"), d = tag(it, "pubDate");
    const summary = f.gnews ? "" : strip(tag(it, "description")).slice(0, 280);
    if (!title || !link) continue;
    const at = d && !isNaN(Date.parse(d)) ? new Date(d).toISOString() : "";
    const text = `${title} ${summary}`;
    if (f.filter === true && !CHIP.test(text)) continue;
    if (f.filter === "china" && !CN.test(text)) continue;
    out.push({ title: title.slice(0, 200), summary, url: link, source, at, ticker: "" });
  }
  return out.slice(0, 30);
}

export async function chinaNews() {
  const errors = [], pool = [];
  const days = Date.now() - 4 * 86400e3;
  await Promise.all(FEEDS.map(async (f) => { try { pool.push(...(await readFeed(f))); } catch (e) { errors.push(`${f.name}: ${e.message}`); } }));
  const seen = new Set(), articles = [];
  for (const a of pool.sort((x, y) => (y.at || "").localeCompare(x.at || ""))) {
    if (a.at && Date.parse(a.at) < days) continue;
    const key = a.title.toLowerCase().slice(0, 60);
    if (seen.has(a.url) || seen.has(key)) continue;
    seen.add(a.url); seen.add(key);
    articles.push({ ...analyze(a), topic: topicOf(`${a.title} ${a.summary}`), zh: /[一-鿿]/.test(a.title) });
  }
  if (!articles.length && errors.length) throw new Error(errors[0]);
  return { articles: articles.slice(0, 80), errors };
}

// 중국 반도체 대표 종목 시세 (Yahoo 비공식 차트 API, 지연됨)
const WATCH = [["688981.SS", "SMIC(중芯国际)"], ["688347.SS", "화홍반도체"], ["688256.SS", "캄브리콘(寒武纪)"], ["002371.SZ", "북방화창(Naura)"], ["000688.SS", "과창판50 지수"]];
export async function chinaQuotes() {
  const rows = await Promise.all(WATCH.map(async ([sym, name]) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`, { headers: UA });
      if (!r.ok) return { symbol: sym, name, error: `HTTP ${r.status}` };
      const m = (await r.json()).chart.result[0].meta;
      const price = m.regularMarketPrice, prev = m.chartPreviousClose ?? m.previousClose;
      return { symbol: sym, name, price, pct: prev ? ((price - prev) / prev) * 100 : null, cur: m.currency || "" };
    } catch { return { symbol: sym, name, error: "조회 실패" }; }
  }));
  if (rows.every((x) => x.error)) throw new Error(rows[0].error);
  return { rows, at: new Date().toISOString() };
}
