// 로컬 시험용: Worker를 Node에서 돌리고 public/을 정적 파일로 제공한다. 외부 API는 가짜 응답으로 대체.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import worker, { Store } from "./src/worker.js";
import { GROUPS } from "./src/feeds.js";
const FEEDSET = new Set(GROUPS.flatMap((g) => g.feeds.map((f) => new URL(f.url).hostname)));
const realFetch = globalThis.fetch;
const now = Math.floor(Date.now() / 1000);
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init) => {
  const u = new URL(url); const sym = u.searchParams.get("symbol");
  if (u.hostname === "finnhub.io") {
    if (u.pathname.endsWith("/quote")) return J({ c: 123.4, dp: sym === "NVDA" ? 6.2 : -1.1, pc: 116 });
    if (u.pathname.includes("calendar/earnings")) return J({ earningsCalendar: sym === "AAPL" ? [] : [{ date: new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10), epsEstimate: 1.23, revenueEstimate: 2e10, hour: "amc" }, { date: new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10), epsEstimate: 1.1, epsActual: 1.25, revenueEstimate: 1.9e10, revenueActual: 2.0e10 }, { date: "2026-07-20", epsEstimate: 1.0, epsActual: 0.95 }, { date: "2026-04-20", epsEstimate: 0.9, epsActual: 0.99 }] });
    if (u.pathname.endsWith("market-holiday")) return J({ exchange: "US", data: [{ eventName: "Thanksgiving Day", atDate: "2026-11-26", tradingHour: "" }, { eventName: "Thanksgiving Day", atDate: "2026-11-27", tradingHour: "09:30-13:00" }] });
    if (u.pathname.includes("calendar/ipo")) return J({ ipoCalendar: [{ symbol: sym || "NVDA", date: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10), price: "14-16", numberOfShares: 20000000 }] });
    if (u.pathname.includes("company-news") && u.searchParams.get("from") < new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)) return J([{ headline: `${sym} posts record revenue, beats estimates on AI demand`, summary: "Revenue grew 40% year over year", url: "https://example.com/v1", source: "Reuters", datetime: now - 3600 }, { headline: `${sym} turns profitable, raises guidance`, summary: "", url: "https://example.com/v2", source: "PR", datetime: now - 7200 }, { headline: "Weather today", summary: "", url: "x", source: "x", datetime: now }]);
    if (u.pathname.includes("company-news")) return J([0, 1, 2].map((i) => ({ headline: i === 0 ? `${sym} hit by export control tariff news` : `${sym} product update ${i}`, summary: "software war", url: "https://example.com/" + i, source: "Reuters", datetime: now - 3600 * i })));
    if (u.pathname.includes("stock/metric")) { const k = sym === "NVDA" ? 1 : (sym.charCodeAt(0) % 5) + 2; return J({ metric: { peTTM: sym === "NVDA" ? 40 : 10 + k * 5, pbQuarterly: sym === "NVDA" ? 6.2 : k, psTTM: 9, "totalDebt/totalEquityQuarterly": 0.6, currentRatioQuarterly: 1.8, netInterestCoverageTTM: 12, operatingMarginTTM: 30, roeTTM: 25, revenueGrowthTTMYoy: 15, epsGrowthTTMYoy: 22, beta: 1.4, dividendYieldIndicatedAnnual: 0.4, "52WeekHigh": 150, "52WeekLow": 80, marketCapitalization: 900000 }, series: {} }); }
    if (u.pathname.includes("stock/earnings")) return J([{ period: "2026-06-30", actual: 1.3, estimate: 1.2, surprisePercent: 8 }, { period: "2026-03-31", actual: 1.0, estimate: 1.1, surprisePercent: -9 }]);
    if (u.pathname.includes("recommendation")) return J(Array.from({ length: 20 }, (_, i) => { const d = new Date(Date.UTC(2026, 9 - i, 1)); return { period: d.toISOString().slice(0, 10), strongBuy: 8 + (i % 4), buy: 10, hold: 8 - (i % 3), sell: 1, strongSell: 0 }; }));
    if (u.pathname.includes("insider")) return J({ data: [{ transactionCode: "P", change: 20000, transactionPrice: 100 }, { transactionCode: "S", change: -1000, transactionPrice: 120 }] });
    if (u.pathname.includes("profile2")) return J({ name: "NVIDIA Corp", finnhubIndustry: "Semiconductors", exchange: "NASDAQ", marketCapitalization: 900000, ipo: "2026-05-01" });
    if (u.pathname.endsWith("/search")) return J({ result: [{ symbol: "TSLA", description: "TESLA INC", type: "Common Stock" }, { symbol: "TSLA.MX", description: "TESLA MX", type: "Common Stock" }, { symbol: "TSLY", description: "YIELDMAX TSLA ETF", type: "ETP" }] });
    if (u.pathname.includes("peers")) return J([sym, "AMD", "INTC", "MU"]);
  }
  if (u.hostname === "generativelanguage.googleapis.com" && u.pathname.endsWith("/interactions")) { const b = JSON.parse(init.body); const brief = /브리핑/.test(b.system_instruction), warn = /위험 점검/.test(b.system_instruction), scoreAi = /재무 점검/.test(b.system_instruction), indAi = /산업 동향/.test(b.system_instruction); globalThis.__lastModel = b.model; return J({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: scoreAi ? JSON.stringify({ verdict: "보통", headline: "재무는 탄탄하나 밸류에이션 부담", strengths: ["영업이익률 30%"], concerns: ["PER이 동종 대비 높음"], industry_note: "반도체는 경기 순환 업종", check: ["다음 실적"], caveat: "TTM 기준" }) : indAi ? JSON.stringify({ headline: "AI 반도체 강세, 에너지 약세", industries: [{ name: "반도체", trend: "강세", regions: "미국·일본", ids: [1, 2, 99999], evidence: "TSMC 증설로 87% 성장", risk: "수출규제" }, { name: "에너지·원자재", trend: "약세", regions: "미국", ids: [], evidence: "유가 하락", risk: "" }], cross_region: ["미국 강세 vs 중국 규제 [1]", "근거 없는 주장"], watch: ["연준"], caveat: "제목만" }) : warn ? JSON.stringify({ headline: "반도체 쏠림과 실적 집중이 핵심 위험", level: "노랑", items: [{ t: "NVDA", level: "빨강", reason: "급등 직후 실적 D-4", check: "실적 발표 전 변동성 확인" }], portfolio: ["두 종목 모두 반도체"], caveat: "수량 정보 없음" }) : brief ? JSON.stringify({ headline: "NVDA 급등과 실적 임박이 핵심", items: [{ t: "NVDA", level: "주의", note: "+6.2% 급등, 실적 D-4" }], today: ["NVDA 실적 확인"], caveat: "무료 데이터 기준" }) : JSON.stringify({ stance: "긍정", confidence: 70, summary: "아르곤 테스트", bull: ["a"], bear: ["b"], invalidate: "x", watch: ["w"] }) }] }] }); }
  if (u.hostname === "generativelanguage.googleapis.com") return J({ candidates: [{ content: { parts: [{ text: JSON.stringify({ stance: "매수", confidence: 64, summary: "실적 개선 기대와 애널리스트 우호적 의견이 근거입니다.", bull: ["EPS 서프라이즈", "애널리스트 매수 우위"], bear: ["수출 규제 뉴스"], invalidate: "다음 실적에서 가이던스 하향", watch: ["실적발표일"] }) }] } }] });
  if (u.hostname === "api.massive.com") { const rs = []; let p = 100; for (let i = 0; i < 500; i++) { const o = p; p *= 1 + Math.sin(i / 17) * 0.012 + 0.0008; rs.push({ t: Date.now() - (500 - i) * 864e5, o, h: Math.max(o, p) * 1.01, l: Math.min(o, p) * 0.99, c: p, v: 1e6 + i * 1000 }); } return J({ status: "OK", results: rs }); }
  const RSS = (items) => new Response(`<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title><![CDATA[${i[0]}]]></title><link>${i[1]}</link><pubDate>${new Date().toUTCString()}</pubDate><description><![CDATA[${i[2] || ""}]]></description>${i[3] ? `<source url="x">${i[3]}</source>` : ""}</item>`).join("")}</channel></rss>`, { headers: { "Content-Type": "application/xml" } });
  if (u.hostname === "www.sec.gov" && u.pathname.endsWith("/index.json")) return J({ directory: { item: [{ name: "primary_doc.xml", size: "3000" }, { name: "form13fInfoTable.xml", size: "9000" }] } });
  if (u.hostname === "www.sec.gov" && u.pathname.endsWith("form13fInfoTable.xml")) { const cur = u.pathname.includes("26000002"); const row = (n, c, v, sh) => `<ns1:infoTable><ns1:nameOfIssuer>${n}</ns1:nameOfIssuer><ns1:cusip>${c}</ns1:cusip><ns1:value>${v}</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>${sh}</ns1:sshPrnamt></ns1:shrsOrPrnAmt></ns1:infoTable>`; return new Response(`<?xml version="1.0"?><ns1:informationTable xmlns:ns1="x">${row("APPLE INC", "037833100", cur ? 90e9 : 100e9, cur ? 800e6 : 900e6)}${row("NVIDIA CORPORATION", "67066G104", cur ? 8e9 : 2e9, cur ? 60e6 : 20e6)}${row("COCA COLA CO", "191216100", 25e9, 400e6)}${cur ? "" : row("OLD HOLDING CORP", "999999999", 3e9, 1e6)}</ns1:informationTable>`, { headers: { "Content-Type": "application/xml" } }); }
  if (u.hostname === "www.sec.gov" && u.pathname === "/news/pressreleases.rss") return RSS([["SEC charges firm in accounting fraud case", "https://sec.gov/n1", "enforcement"]]);
  if (u.hostname === "www.sec.gov") return J({ 0: { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" }, 1: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, 2: { cik_str: 2488, ticker: "AMD", title: "ADVANCED MICRO DEVICES INC" } });
  if (u.hostname === "data.sec.gov" && u.pathname.includes("companyconcept")) {
    const tag = u.pathname.split("/").pop().replace(".json", "");
    const base = { Revenues: 100e9, NetIncomeLoss: 20e9, OperatingIncomeLoss: 28e9, NetCashProvidedByUsedInOperatingActivities: 30e9, PaymentsToAcquirePropertyPlantAndEquipment: 5e9, ShareBasedCompensation: 15e9, WeightedAverageNumberOfDilutedSharesOutstanding: 2e9, CostOfGoodsAndServicesSold: 55e9, EarningsPerShareDiluted: 10 }[tag];
    if (!base) return new Response("nf", { status: 404 });
    const unit = tag.startsWith("Weighted") ? "shares" : tag.startsWith("EarningsPerShare") ? "USD/shares" : "USD";
    // 연간(2020~2025, 10-K)과 분기(2024~2026의 1~3분기, 10-Q). 4분기는 연간에서 빼서 만들어지는지 보려고 일부러 안 넣는다.
    const yearVal = (y) => base * (1 + 0.12 * (y - 2020)) * (y === 2023 ? 0.9 : 1);
    const annualRows = Array.from({ length: 6 }, (_, i) => ({ start: `${2020 + i}-01-01`, end: `${2020 + i}-12-31`, val: yearVal(2020 + i), form: "10-K", fp: "FY", filed: `${2021 + i}-02-01` }));
    const qEnds = ["03-31", "06-30", "09-30"], qStarts = ["01-01", "04-01", "07-01"];
    const qRows = [2024, 2025, 2026].flatMap((y) => qEnds.map((e, k) => ({ start: `${y}-${qStarts[k]}`, end: `${y}-${e}`, val: Math.round((yearVal(y) / 4) * (0.92 + 0.05 * k) * (tag === "NetIncomeLoss" && y === 2026 && k === 2 && process.env.ONEOFF ? 2 : 1) * 100) / 100, form: "10-Q", fp: "Q" + (k + 1), filed: `${y}-${["05", "08", "11"][k]}-01` })));
    return J({ units: { [unit]: [...annualRows, ...qRows] } });
  }
  if (u.hostname === "data.sec.gov") return J({ name: "FAKE CAPITAL LP", filings: { recent: { form: ["8-K", "10-Q", "13F-HR", "13F-HR"], filingDate: [new Date().toISOString().slice(0, 10), "2026-08-01", "2026-08-14", "2026-05-15"], reportDate: ["", process.env.STALE ? "2026-12-31" : "2026-09-30", "2026-06-30", "2026-03-31"], items: ["2.02,9.01", "", "", ""], accessionNumber: ["0001-26-000001", "0001-26-000002", "0000000000-26-000002", "0000000000-26-000001"], primaryDocument: ["a.htm", "b.htm", "c.htm", "d.htm"] } } });
  const FEEDHOST = { "www.federalreserve.gov": "Fed", "www.cnbc.com": "CNBC", "feeds.content.dowjones.io": "MarketWatch", "feeds.a.dj.com": "WSJ", "finance.yahoo.com": "Yahoo", "asia.nikkei.com": "Nikkei", "rss.nytimes.com": "NYT", "feeds.bbci.co.uk": "BBC" };
  if (FEEDHOST[u.hostname]) { const n = FEEDHOST[u.hostname]; return RSS([[`${n}: Nvidia surges as AI chip demand lifts record revenue`, `https://${u.hostname}/a`, "NVDA rally"], [`${n}: Fed holds rates, inflation cooling`, `https://${u.hostname}/b`, "yield falls"], [`${n}: Celebrity gala draws crowd`, `https://${u.hostname}/c`, "nothing"]]); }
  if (u.hostname === "www.yna.co.kr") return new Response("denied", { status: 403 });
  if (u.hostname === "www.theguardian.com") return new Response("nf", { status: 404 });
  if (u.hostname === "news.google.com" && u.pathname.includes("headlines/section")) { const hl = u.searchParams.get("hl") || "en"; const T = { ja: ["半導体大手が増産へ AI需要で", "日銀 金利据え置き 円安進む", "トヨタ 電気自動車 電池 投資拡大"], "zh-CN": ["芯片需求大涨 国产替代加速", "央行 降息 预期升温", "电池 龙头 扩产 出口"], "zh-TW": ["台積電 先進製程 擴產 AI晶片", "房地產 成交 下滑", "航運 運價 上漲"], "zh-HK": ["港股 科技股 反彈 人工智能", "樓市 回暖", "央行 利率"], de: ["Halbleiter: Zölle belasten Autobauer", "Inflation sinkt, EZB senkt Zinsen", "Rechenzentrum Boom treibt Strombedarf"], fr: ["Semi-conducteurs: taxes douane inquiètent", "Banque centrale: taux d'intérêt stables"], it: ["Banca centrale: inflazione cala"], ko: ["삼성전자 HBM 수주 확대, 반도체 훈풍", "한국은행 기준금리 동결, 물가 둔화", "배터리 업계 전기차 수요 둔화 우려"] }[hl] || ["Chipmaker TSMC lifts capex as AI chip demand booms", "Oil falls as OPEC raises output", "Fed rate cut hopes lift bank stocks", "Tariff threat hits automakers and shipping"]; return RSS(T.map((x, i) => [x + " - " + (hl === "ja" ? "日本経済新聞" : "Outlet" + i), "https://news.google.com/x/" + hl + i, "", hl === "ja" ? "日本経済新聞" : "Outlet" + i])); }
  if (u.hostname === "news.google.com" && u.pathname.includes("/rss/search") && !/科创板|中芯/.test(u.searchParams.get("q") || "")) return RSS([["Semiconductor stocks rally on AI demand - Reuters", "https://news.google.com/s1", "", "Reuters"], ["Oil prices slide, energy stocks fall - Bloomberg", "https://news.google.com/s2", "", "Bloomberg"]]);
  if (u.hostname === "news.google.com") return RSS([["科创板半导体板块大涨 国产替代订单增长 - 财联社", "https://news.google.com/a1", "", "财联社"], ["美国拟扩大对华半导体出口管制 - 证券时报", "https://news.google.com/a2", "", "证券时报"], ["中芯国际扩产获批 - 证券时报", "https://news.google.com/a3", "", "证券时报"]]);
  if (u.hostname === "www.scmp.com") return RSS([["China chip firm SMIC raises capex as export control bites", "https://scmp.com/1", "SMIC and Huawei"], ["Celebrity wedding", "https://scmp.com/2", "nothing"]]);
  if (u.hostname === "www.trendforce.com") return RSS([["[News] China's CXMT Expands DRAM Output", "https://tf.com/1", "CXMT"], ["[News] Samsung HBM4", "https://tf.com/2", "Korea only"]]);
  if (u.hostname === "api.frankfurter.app") return u.searchParams.get("from") === "USD" ? J({ date: "2026-10-13", rates: { KRW: 1388.9 } }) : J({ date: "2026-10-09", rates: { USD: 0.00072, JPY: 0.108, CNY: 0.0051 } });
  if (u.hostname === "newsapi.org") return J({ status: "ok", articles: [{ title: "Semiconductor stocks surge on AI chip demand", description: "Record growth; China tariff worries remain", url: "https://example.com/n1", source: { name: "Bloomberg" }, publishedAt: new Date().toISOString() }, { title: "Bank of America downgrade on window of risk", description: "window dressing", url: "https://example.com/n2", source: { name: "FT" }, publishedAt: new Date().toISOString() }, { title: "Energy storage maker faces lawsuit", description: "recall", url: "https://example.com/n3", source: { name: "Reuters" }, publishedAt: new Date().toISOString() }] });
  if (u.hostname === "finnhub.io" && u.pathname.endsWith("/news")) return J([{ headline: "Fed signals interest rate path; inflation cools", summary: "yield falls", url: "https://example.com/m1", source: "CNBC", datetime: now }, { headline: "Celebrity gala draws crowd", summary: "nothing", url: "https://example.com/m2", source: "X", datetime: now }, { headline: "Cloud service outage hits AI customers", summary: "ransomware suspected", url: "https://example.com/m3", source: "WSJ", datetime: now }]);
  if (u.hostname === "api.stocktwits.com") return J({ messages: [{ body: "$X to the moon", entities: { sentiment: { basic: "Bullish" } } }, { body: "dump", entities: { sentiment: { basic: "Bearish" } } }, { body: "hi", entities: {} }, { body: "up", entities: { sentiment: { basic: "Bullish" } } }] });
  if (u.hostname === "query1.finance.yahoo.com" && /interval=(1m|5m|15m|60m)/.test(u.search)) { const iv = /interval=(\d+)m/.exec(u.search)[1] * 60, n = /range=1d/.test(u.search) ? 390 : /range=5d/.test(u.search) ? 130 : 150, ts = [], o = [], hi = [], lo = [], cl = [], vo = []; let p = 100; const t0 = Math.floor(Date.now() / 1000 / iv) * iv - n * iv; for (let i = 0; i < n; i++) { ts.push(t0 + i * iv); const a = p; p *= 1 + Math.sin(i / 9) * 0.004 + 0.0002; o.push(a); cl.push(p); hi.push(Math.max(a, p) * 1.002); lo.push(Math.min(a, p) * 0.998); vo.push(process.env.NOVOL ? 0 : 1000 + (i * 37) % 500); } cl[3] = null; return J({ chart: { result: [{ meta: { chartPreviousClose: 99 }, timestamp: ts, indicators: { quote: [{ open: o, high: hi, low: lo, close: cl, volume: vo }] } }] } }); }
  if (u.hostname === "query1.finance.yahoo.com") { const ts = [], cl = []; let p = 100; const sh = [...u.pathname].reduce((n, c) => n + c.charCodeAt(0), 0) % 7; for (let i = 0; i < 700; i++) { ts.push(Math.floor((Date.now() - (700 - i) * 864e5) / 1000)); p *= 1 + Math.sin(i / 17 + sh) * 0.01 + 0.0006; cl.push(p); } return J({ chart: { result: [{ meta: { regularMarketPrice: p, chartPreviousClose: p / 1.02, currency: "CNY" }, timestamp: ts, indicators: { quote: [{ close: cl }] } }] } }); }
  if (u.hostname === "api.stlouisfed.org") {
    if (u.pathname.endsWith("series/observations")) return J({ observations: [{ date: "2026-09-01", value: "3.1" }, { date: "2026-08-01", value: "3.3" }] });
    if (u.pathname.endsWith("series/release")) return J({ releases: [{ id: 10 }] });
    if (u.pathname.endsWith("release/dates")) { const f = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10); return J({ release_dates: [{ date: f(2) }, { date: f(20) }, { date: f(-25) }] }); }
  }
  if (FEEDSET.has(u.hostname)) { const n = u.hostname.replace(/^(www|feeds|rss)\./, "").split(".")[0]; return RSS([[`${n}: TSMC raises capex as AI chip demand booms`, `https://${u.hostname}/a`, "semiconductor"], [`${n}: Oil falls as OPEC raises output, inflation cools`, `https://${u.hostname}/b`, "crude"], [`${n}: Tesla battery plant delay hits EV makers`, `https://${u.hostname}/c`, "battery"], [`${n}: Weather today`, `https://${u.hostname}/d`, "nothing"]]); }
  return realFetch(url, init);
};
// 저장소는 진짜 Store 클래스를 메모리 위에서 돌린다 (동기화 + 로그인 시도 제한).
const mem = new Map(), storeObj = new Store({ storage: { get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, v); } } });
const STORE = { idFromName: () => "x", get: () => ({ fetch: (u, init) => storeObj.fetch(new Request(u, init)) }) };
// 실시간 중계 대신: Worker가 LIVE로 넘기면 표시만 해 두고, 아래 upgrade 처리에서 가짜 체결을 흘려 보낸다.
const LIVE = { idFromName: () => "x", get: () => ({ fetch: async (req) => new Response(null, { headers: { "x-dev-ws": new URL(req.url).searchParams.get("t") } }) }) };
const env = { LIVE: process.env.NOLIVE ? undefined : LIVE, STORE: process.env.NOSTORE ? undefined : STORE, APP_PASSWORD: "testpw", FINNHUB_KEY: "dummy", SEC_CONTACT: process.env.NOSEC ? undefined : "local-dev", GEMINI_KEY: process.env.NOGEMINI ? undefined : "dummy", MASSIVE_KEY: process.env.NOMASSIVE ? undefined : "dummy", FRED_KEY: process.env.NOFRED ? undefined : "dummy", NEWSAPI_KEY: process.env.NONEWS ? undefined : "dummy", ASSETS: { fetch: async (req) => {
  let p = new URL(req.url).pathname; if (p === "/") p = "/index.html";
  const f = path.join("public", p); if (!fs.existsSync(f)) return new Response("nf", { status: 404 });
  const ct = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" }[path.extname(f)] || "application/octet-stream";
  return new Response(fs.readFileSync(f), { headers: { "Content-Type": ct } });
} } };
const server = http.createServer(async (rq, rs) => {
  const chunks = []; for await (const c of rq) chunks.push(c);
  const req = new Request(`http://${rq.headers.host}${rq.url}`, { method: rq.method, headers: rq.headers, body: ["GET", "HEAD"].includes(rq.method) ? undefined : Buffer.concat(chunks) });
  const res = await worker.fetch(req, env);
  const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
  const sc = res.headers.getSetCookie?.(); if (sc && sc.length) headers["set-cookie"] = sc;
  rs.writeHead(res.status, headers); rs.end(Buffer.from(await res.arrayBuffer()));
});
const frame = (txt) => { const b = Buffer.from(txt); const head = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); return Buffer.concat([head, b]); };
server.on("upgrade", async (rq, sock) => {
  const res = await worker.fetch(new Request(`http://${rq.headers.host}${rq.url}`, { headers: rq.headers }), env);
  if (!res.headers.has("x-dev-ws")) { sock.end(`HTTP/1.1 ${res.status} x\r\nContent-Length: 0\r\n\r\n`); return; }
  const accept = crypto.createHash("sha1").update(rq.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const send = (o) => { if (!sock.destroyed) sock.write(frame(typeof o === "string" ? o : JSON.stringify(o))); };
  send({ type: "status", up: true });
  // 구독한 종목마다 가짜 체결을 흘린다 (가격은 가짜 분봉 끝값 근처에서 움직인다).
  const subs = new Set(res.headers.get("x-dev-ws") ? [res.headers.get("x-dev-ws")] : []), px = {};
  const iv = setInterval(() => { for (const t of subs) { const p = (px[t] ??= 107.9); px[t] = Math.round(p * (1 + (Math.random() - 0.5) * 0.0008) * 100) / 100; send({ type: "tick", t, p: px[t], ts: Date.now(), v: Math.round(Math.random() * 12) }); } }, Number(process.env.TICKMS) || 250);
  // 앱이 보내는 프레임(가려진 텍스트 한 개씩): 닫기면 끝내고, ping은 pong, sub는 구독 목록을 바꾼다.
  sock.on("data", (d) => {
    const op = d[0] & 15; if (op === 8) { clearInterval(iv); return sock.end(); } if (op !== 1) return;
    let len = d[1] & 127, at = 2; if (len === 126) { len = d.readUInt16BE(2); at = 4; }
    const mask = d.subarray(at, at + 4), txt = Buffer.from(d.subarray(at + 4, at + 4 + len).map((b, i) => b ^ mask[i % 4])).toString();
    if (txt === "ping") return send("pong");
    try { const m = JSON.parse(txt); if (m.type === "sub") { subs.clear(); m.t.forEach((x) => subs.add(x)); console.log("ws sub", m.t.join(",")); } } catch {}
  });
  sock.on("close", () => clearInterval(iv)); sock.on("error", () => clearInterval(iv));
});
server.listen(8790, () => console.log("up"));
