// 전 세계 뉴스 모음: 공개 RSS/Atom만 쓴다(키 불필요). 무료 플랜은 요청 1건당 외부 호출 50번이 한도라 묶음(그룹)으로 나눠 받는다.
//  등급: 공식 = 정부·중앙은행·규제기관 / 경제지 = 취재 기반 경제 매체 / 종합 = 종합 일간지·방송 / 모음 = 구글뉴스 지역판(여러 매체를 모아 보여줌)
import { tag, strip, unescape } from "./cn.js";
import { analyze } from "./news.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; personal-news-reader)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" };
const G = (topic, hl, gl, ceid) => `https://news.google.com/rss/headlines/section/topic/${topic}?hl=${hl}&gl=${gl}&ceid=${ceid}`;
const GQ = (q, hl, gl, ceid) => `https://news.google.com/rss/search?${new URLSearchParams({ q: q + " when:2d", hl, gl, ceid })}`;
const f = (id, name, tier, url, extra = {}) => ({ id, name, tier, url, ...extra });

export const GROUPS = [
  { id: "us", label: "미국 경제·시장", region: "미국", feeds: [
    f("cnbc", "CNBC 톱뉴스", "경제지", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    f("cnbce", "CNBC 경제", "경제지", "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    f("cnbcr", "CNBC 실적", "경제지", "https://www.cnbc.com/id/15839135/device/rss/rss.html"),
    f("mw", "MarketWatch", "경제지", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    f("mwp", "MarketWatch 마켓펄스", "경제지", "https://feeds.content.dowjones.io/public/rss/mw_marketpulse"),
    f("wsj", "WSJ 시장", "경제지", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"),
    f("yf", "Yahoo Finance", "경제지", "https://finance.yahoo.com/news/rssindex"),
    f("npr", "NPR 경제", "종합", "https://feeds.npr.org/1006/rss.xml"),
    f("nyt", "뉴욕타임스 경제", "종합", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml"),
    f("gus", "구글뉴스 미국 경제", "모음", G("BUSINESS", "en-US", "US", "US:en"), { gnews: true }),
  ] },
  { id: "ustech", label: "미국 기술·산업", region: "미국", feeds: [
    f("cnbct", "CNBC 기술", "경제지", "https://www.cnbc.com/id/19854910/device/rss/rss.html"),
    f("cnbcen", "CNBC 에너지", "경제지", "https://www.cnbc.com/id/19836768/device/rss/rss.html"),
    f("nytt", "뉴욕타임스 기술", "종합", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml"),
    f("tc", "TechCrunch", "경제지", "https://techcrunch.com/feed/"),
    f("vrg", "The Verge", "경제지", "https://www.theverge.com/rss/index.xml"),
    f("ars", "Ars Technica", "경제지", "https://feeds.arstechnica.com/arstechnica/index"),
    f("eet", "EE Times (반도체)", "경제지", "https://www.eetimes.com/feed/"),
    f("gust", "구글뉴스 미국 기술", "모음", G("TECHNOLOGY", "en-US", "US", "US:en"), { gnews: true }),
    f("gussemi", "구글뉴스 반도체·AI칩", "모음", GQ("semiconductor OR \"AI chip\" OR Nvidia OR TSMC OR ASML OR HBM", "en-US", "US", "US:en"), { gnews: true }),
  ] },
  { id: "eu", label: "유럽", region: "유럽", feeds: [
    f("bbc", "BBC 경제", "종합", "https://feeds.bbci.co.uk/news/business/rss.xml"),
    f("grd", "가디언 경제", "종합", "https://www.theguardian.com/business/rss"),
    f("ft", "파이낸셜타임스", "경제지", "https://www.ft.com/rss/home"),
    f("dw", "도이체벨레 경제", "종합", "https://rss.dw.com/rdf/rss-en-bus"),
    f("eun", "유로뉴스 경제", "종합", "https://www.euronews.com/rss?level=theme&name=business"),
    f("eco", "이코노미스트 경제", "경제지", "https://www.economist.com/finance-and-economics/rss.xml"),
    f("guk", "구글뉴스 영국 경제", "모음", G("BUSINESS", "en-GB", "GB", "GB:en"), { gnews: true }),
    f("gde", "구글뉴스 독일 경제", "모음", G("BUSINESS", "de", "DE", "DE:de"), { gnews: true }),
    f("gfr", "구글뉴스 프랑스 경제", "모음", G("BUSINESS", "fr", "FR", "FR:fr"), { gnews: true }),
    f("gnl", "구글뉴스 이탈리아 경제", "모음", G("BUSINESS", "it", "IT", "IT:it"), { gnews: true }),
  ] },
  { id: "jp", label: "일본", region: "일본", feeds: [
    f("nik", "Nikkei Asia", "경제지", "https://asia.nikkei.com/rss/feed/nar"),
    f("jt", "재팬타임스", "종합", "https://www.japantimes.co.jp/feed/"),
    f("nhk", "NHK 경제", "종합", "https://www3.nhk.or.jp/rss/news/cat5.xml"),
    f("gjp", "구글뉴스 일본 경제", "모음", G("BUSINESS", "ja", "JP", "JP:ja"), { gnews: true }),
    f("gjpt", "구글뉴스 일본 기술", "모음", G("TECHNOLOGY", "ja", "JP", "JP:ja"), { gnews: true }),
    f("gjpq", "구글뉴스 일본 반도체·자동차", "모음", GQ("半導体 OR 日経平均 OR 日銀 OR トヨタ", "ja", "JP", "JP:ja"), { gnews: true }),
    f("gjpe", "구글뉴스 일본(영어)", "모음", GQ("Japan economy OR Nikkei OR yen OR Toyota OR Sony", "en-US", "US", "US:en"), { gnews: true }),
  ] },
  { id: "cn", label: "중국·홍콩·대만", region: "중국·대만", feeds: [
    f("scmpb", "SCMP 경제", "경제지", "https://www.scmp.com/rss/92/feed"),
    f("scmpc", "SCMP 중국", "경제지", "https://www.scmp.com/rss/4/feed"),
    f("scmpt", "SCMP 기술", "경제지", "https://www.scmp.com/rss/36/feed"),
    f("cd", "차이나데일리 경제", "종합", "http://www.chinadaily.com.cn/rss/business_rss.xml"),
    f("tf", "TrendForce", "경제지", "https://www.trendforce.com/news/feed/"),
    f("gcn", "구글뉴스 중국 경제", "모음", G("BUSINESS", "zh-CN", "CN", "CN:zh-Hans"), { gnews: true }),
    f("gcnt", "구글뉴스 중국 기술", "모음", G("TECHNOLOGY", "zh-CN", "CN", "CN:zh-Hans"), { gnews: true }),
    f("gtw", "구글뉴스 대만 경제", "모음", G("BUSINESS", "zh-TW", "TW", "TW:zh-Hant"), { gnews: true }),
    f("ghk", "구글뉴스 홍콩 경제", "모음", G("BUSINESS", "zh-HK", "HK", "HK:zh-Hant"), { gnews: true }),
    f("gcnq", "구글뉴스 중국 반도체·정책", "모음", GQ("半导体 OR 科创板 OR 出口管制 OR 国产替代", "zh-CN", "CN", "CN:zh-Hans"), { gnews: true }),
  ] },
  { id: "kr", label: "한국", region: "한국", feeds: [
    f("yna", "연합뉴스 경제", "종합", "https://www.yna.co.kr/rss/economy.xml"),
    f("hk", "한국경제", "경제지", "https://www.hankyung.com/feed/economy"),
    f("mk", "매일경제", "경제지", "https://www.mk.co.kr/rss/30100041/"),
    f("kh", "코리아헤럴드 경제", "종합", "http://www.koreaherald.com/common/rss_xml.php?ct=102"),
    f("gkr", "구글뉴스 한국 경제", "모음", G("BUSINESS", "ko", "KR", "KR:ko"), { gnews: true }),
    f("gkrt", "구글뉴스 한국 기술", "모음", G("TECHNOLOGY", "ko", "KR", "KR:ko"), { gnews: true }),
    f("gkrq", "구글뉴스 한국 반도체·배터리", "모음", GQ("반도체 OR HBM OR 배터리 OR 코스피", "ko", "KR", "KR:ko"), { gnews: true }),
  ] },
  { id: "world", label: "아시아·중동·기타", region: "기타", feeds: [
    f("aj", "알자지라", "종합", "https://www.aljazeera.com/xml/rss/all.xml"),
    f("et", "이코노믹타임스(인도)", "경제지", "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"),
    f("st", "스트레이츠타임스 경제(싱가포르)", "종합", "https://www.straitstimes.com/news/business/rss.xml"),
    f("abc", "ABC 호주 경제", "종합", "https://www.abc.net.au/news/feed/51120/rss.xml"),
    f("gin", "구글뉴스 인도 경제", "모음", G("BUSINESS", "en-IN", "IN", "IN:en"), { gnews: true }),
    f("gsg", "구글뉴스 싱가포르 경제", "모음", G("BUSINESS", "en-SG", "SG", "SG:en"), { gnews: true }),
    f("gau", "구글뉴스 호주 경제", "모음", G("BUSINESS", "en-AU", "AU", "AU:en"), { gnews: true }),
    f("gwd", "구글뉴스 세계", "모음", G("WORLD", "en-US", "US", "US:en"), { gnews: true }),
  ] },
  { id: "official", label: "공식·중앙은행", region: "공식", feeds: [
    f("fed", "미 연준(Fed)", "공식", "https://www.federalreserve.gov/feeds/press_all.xml"),
    f("sec", "미 SEC", "공식", "https://www.sec.gov/news/pressreleases.rss"),
    f("ecb", "유럽중앙은행(ECB)", "공식", "https://www.ecb.europa.eu/rss/press.html"),
    f("boj", "일본은행(BOJ)", "공식", "https://www.boj.or.jp/en/rss/whatsnew.xml"),
    f("imf", "IMF", "공식", "https://www.imf.org/en/News/rss?language=eng"),
  ] },
];

// 산업 분류(영·일·중·한·독·불 키워드). 앞에서부터 처음 맞는 산업 하나로 분류한다.
const INDUSTRIES = [
  ["반도체", /semiconductor|\bchips?\b|chipmaker|foundry|TSMC|Nvidia|ASML|\bHBM\d?\b|DRAM|\bNAND\b|SK ?hynix|Micron|Intel\b|半導体|半导体|芯片|晶圆|晶圓|半導體|반도체|Halbleiter|semi-?conducteur/i],
  ["AI·소프트웨어·클라우드", /\bAI\b|artificial intelligence|OpenAI|Anthropic|\bcloud\b|software|data ?cent(er|re)|Microsoft|Alphabet|Google|生成AI|人工知能|人工智能|인공지능|\bKI\b|Rechenzentrum|intelligence artificielle/i],
  ["전기차·배터리", /\bEVs?\b|electric vehicle|battery|batteries|lithium|Tesla|\bBYD\b|CATL|蓄電池|电池|電池|배터리|전기차|二次电池|Akku|batterie/i],
  ["에너지·원자재", /\boil\b|crude|OPEC|natural gas|\bLNG\b|uranium|copper|\bcoal\b|\bgold\b|silver|rare earth|石油|原油|天然气|天然氣|유가|원유|희토류|稀土|Ölpreis|pétrole/i],
  ["금융·금리·거시", /\bbanks?\b|Federal Reserve|\bFed\b|\bECB\b|\bBOJ\b|interest rates?|inflation|yields?|treasur(y|ies)|\bGDP\b|recession|金利|利上げ|日銀|央行|加息|降息|通胀|금리|기준금리|물가|Zinsen|Inflation|taux d'intérêt|banque/i],
  ["제약·바이오", /pharma|\bdrugs?\b|\bFDA\b|biotech|vaccine|obesity|GLP-1|Novo|Eli Lilly|医薬|制药|製藥|药|제약|바이오|Arznei|laboratoire/i],
  ["자동차·모빌리티", /automaker|carmaker|auto (sales|industry)|Toyota|Volkswagen|Hyundai|Honda|Stellantis|自動車|汽车|汽車|자동차|Autobauer|constructeur/i],
  ["방산·우주·항공", /defen[cs]e|missile|rocket|SpaceX|satellite|Boeing|Airbus|aerospace|防衛|航天|航空|우주|방산|국방|Rüstung/i],
  ["소비·유통", /retail|consumer|Walmart|Amazon|Nike|luxury|e-commerce|小売|消费|消費|零售|소비|유통|Einzelhandel|distribution/i],
  ["부동산·건설", /real estate|property|housing|mortgage|REIT|不動産|房地产|房地產|楼市|부동산|Immobilien|immobilier/i],
  ["물류·해운·공급망", /shipping|freight|supply chain|container|\bports?\b|logistics|海運|物流|航运|航運|해운|물류|Lieferkette/i],
  ["정책·지정학·무역", /tariffs?|sanctions?|export controls?|trade war|trade deal|geopolit|summit|\bwar\b|conflict|election|関税|制裁|关税|關稅|수출규제|관세|제재|Zölle|droits de douane/i],
];
export const industryOf = (text) => { for (const [n, r] of INDUSTRIES) if (r.test(text)) return n; return "기타"; };

async function readFeed(f) {
  let r;
  try { r = await fetch(f.url, { headers: UA }); } catch { throw new Error("네트워크 오류"); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text(), out = [];
  const take = (it) => {
    let title = strip(tag(it, "title")), source = f.name;
    let link = strip(tag(it, "link")) || (it.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || strip(tag(it, "guid"));
    link = unescape(link || "");
    const d = tag(it, "pubDate") || tag(it, "dc:date") || tag(it, "published") || tag(it, "updated");
    if (f.gnews) { const sm = strip(tag(it, "source")); if (sm) { source = sm; if (title.endsWith(" - " + sm)) title = title.slice(0, -(sm.length + 3)); } }
    if (!title || !/^https?:\/\//.test(link)) return;
    const summary = f.gnews ? "" : strip(tag(it, "description") || tag(it, "summary")).slice(0, 200);
    out.push({ title: title.slice(0, 200), summary, url: link, source, feed: f.name, tier: f.tier, at: d && !isNaN(Date.parse(d)) ? new Date(d).toISOString() : "", ticker: "" });
  };
  let n = 0;
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) { take(m[1]); if (++n >= 40) break; }
  if (!out.length) for (const m of xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)) { take(m[1]); if (++n >= 40) break; }
  if (!out.length) throw new Error("기사 없음(형식이 바뀌었거나 막힘)");
  return out;
}

export async function trustedNews(gid) {
  const g = GROUPS.find((x) => x.id === gid);
  const errors = [], pool = [], status = [];
  await Promise.all(g.feeds.map(async (f) => {
    try { const a = await readFeed(f); pool.push(...a); status.push({ id: f.id, name: f.name, tier: f.tier, n: a.length }); }
    catch (e) { errors.push(`${f.name}: ${e.message}`); status.push({ id: f.id, name: f.name, tier: f.tier, n: 0, error: e.message }); }
  }));
  const cut = Date.now() - 2 * 86400e3, seen = new Set(), articles = [];
  for (const a of pool.sort((x, y) => (y.at || "").localeCompare(x.at || ""))) {
    if (a.at && Date.parse(a.at) < cut) continue;
    const k = a.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 50);
    if (seen.has(k)) continue; seen.add(k);
    const x = analyze(a);
    articles.push({ title: x.title, summary: x.summary, url: x.url, source: x.source, tier: x.tier, at: x.at, sentiment: x.sentiment, impact: x.impact, risk: x.risk, industry: industryOf(`${a.title} ${a.summary}`), region: g.region, group: g.id });
  }
  return { group: g.id, label: g.label, region: g.region, articles: articles.slice(0, 160), status, errors, at: new Date().toISOString() };
}
