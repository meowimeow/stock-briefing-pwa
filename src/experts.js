// 전문가·큰손: (1) 유명 투자자의 13F 보유 내역(SEC, 분기 종료 후 최대 45일 뒤 공개), (2) 종목별 애널리스트 의견 추이와 최근 내부자 거래(Form 4).
import { fh, getJson, SEC_UA, day, addDays } from "./sources.js";

// 라벨은 참고용이고, 실제 제출자 이름은 SEC 응답의 name을 함께 보여준다. (CIK가 틀리면 이름이 달라 바로 보인다)
export const FUNDS = [
  { id: "1067983", label: "버크셔 해서웨이 (워런 버핏)" },
  { id: "1649339", label: "Scion (마이클 버리)" },
  { id: "1336528", label: "퍼싱 스퀘어 (빌 애크먼)" },
  { id: "1656456", label: "아파루사 (데이비드 테퍼)" },
  { id: "1040273", label: "서드 포인트 (대니얼 로브)" },
  { id: "1029160", label: "소로스 펀드 매니지먼트" },
  { id: "1167483", label: "타이거 글로벌" },
  { id: "1536411", label: "듀케인 패밀리 오피스 (드러켄밀러)" },
  { id: "1061768", label: "바우포스트 (세스 클라만)" },
  { id: "1079114", label: "그린라이트 (데이비드 아인혼)" },
  { id: "1135730", label: "코튜 매니지먼트" },
  { id: "1697748", label: "ARK 인베스트" },
];

const pad = (c) => String(c).padStart(10, "0");
const P = "(?:[\\w-]+:)?";
const val = (s, name) => { const m = s.match(new RegExp(`<${P}${name}>\\s*([^<]*?)\\s*</${P}${name}>`, "i")); return m ? m[1] : ""; };
const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"');

export function parseInfoTable(xml, inThousands) {
  const rows = new Map();
  for (const m of xml.matchAll(new RegExp(`<${P}infoTable>([\\s\\S]*?)</${P}infoTable>`, "gi"))) {
    const s = m[1], cusip = val(s, "cusip"), pc = val(s, "putCall"), key = cusip + pc;
    const v = Number(val(s, "value")) * (inThousands ? 1000 : 1), sh = Number(val(s, "sshPrnamt"));
    if (!cusip || !isFinite(v)) continue;
    const o = rows.get(key) || { name: unesc(val(s, "nameOfIssuer")).slice(0, 60), cusip, put: pc, value: 0, shares: 0 };
    o.value += v; o.shares += isFinite(sh) ? sh : 0; rows.set(key, o);
  }
  return [...rows.values()].sort((a, b) => b.value - a.value);
}

async function infotable(cikNum, acc, filed) {
  const base = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc.replace(/-/g, "")}`;
  const idx = await getJson(`${base}/index.json`, SEC_UA);
  const xmls = ((idx.directory || {}).item || []).filter((x) => /\.xml$/i.test(x.name) && !/primary_doc/i.test(x.name)).sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
  if (!xmls.length) throw new Error("보유 내역 파일(infotable)을 찾지 못함");
  const r = await fetch(`${base}/${xmls[0].name}`, { headers: SEC_UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  if (xml.length > 1500000) throw new Error("보유 내역이 너무 커서 무료 서버에서 처리하지 않습니다");
  return parseInfoTable(xml, filed < "2023-01-03");
}

export async function fundCard(id) {
  const f = FUNDS.find((x) => x.id === id);
  if (!f) throw new Error("지원하지 않는 투자자입니다");
  const sub = await getJson(`https://data.sec.gov/submissions/CIK${pad(id)}.json`, SEC_UA);
  const rc = sub.filings.recent, hr = [];
  for (let i = 0; i < rc.form.length && hr.length < 2; i++) if (rc.form[i] === "13F-HR") hr.push({ acc: rc.accessionNumber[i], filed: rc.filingDate[i], period: rc.reportDate[i] });
  if (!hr.length) throw new Error("최근 13F-HR 제출이 없습니다");
  const [cur, prev] = await Promise.all([infotable(Number(id), hr[0].acc, hr[0].filed), hr[1] ? infotable(Number(id), hr[1].acc, hr[1].filed).catch(() => null) : null]);
  const total = cur.reduce((s, x) => s + x.value, 0), pm = new Map((prev || []).map((x) => [x.cusip + x.put, x]));
  const rows = cur.slice(0, 40).map((x) => {
    const o = pm.get(x.cusip + x.put); let change = prev ? "신규" : "";
    if (o) { const d = o.shares ? (x.shares - o.shares) / o.shares : 0; change = d > 0.05 ? "확대" : d < -0.05 ? "축소" : "유지"; return { ...x, pct: total ? x.value / total : 0, change, chgPct: d }; }
    return { ...x, pct: total ? x.value / total : 0, change, chgPct: null };
  });
  const cm = new Set(cur.map((x) => x.cusip + x.put));
  const exited = prev ? prev.filter((x) => !cm.has(x.cusip + x.put)).slice(0, 6).map((x) => ({ name: x.name, value: x.value })) : [];
  return { id, label: f.label, filer: sub.name || "", period: hr[0].period, filed: hr[0].filed, prevPeriod: hr[1] ? hr[1].period : null, total, count: cur.length, rows, exited, at: new Date().toISOString() };
}

export async function tickerExperts(env, t) {
  const errors = [];
  const [rec, ins] = await Promise.allSettled([fh(env, "stock/recommendation", { symbol: t }), fh(env, "stock/insider-transactions", { symbol: t, from: day(addDays(new Date(), -120)) })]);
  const analyst = rec.status === "fulfilled" && Array.isArray(rec.value) ? rec.value.slice(0, 4).map((r) => ({ period: r.period, sb: r.strongBuy || 0, b: r.buy || 0, h: r.hold || 0, s: r.sell || 0, ss: r.strongSell || 0 })) : [];
  if (rec.status === "rejected") errors.push("애널리스트: " + rec.reason.message);
  let insiders = [];
  if (ins.status === "fulfilled") insiders = ((ins.value && ins.value.data) || []).filter((x) => x.transactionCode === "P" || x.transactionCode === "S").sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || "")).slice(0, 8).map((x) => ({ name: String(x.name || "").slice(0, 40), code: x.transactionCode, shares: Math.abs(x.change || 0), price: x.transactionPrice || null, date: x.transactionDate || "", filed: x.filingDate || "" }));
  else errors.push("내부자: " + ins.reason.message);
  return { ticker: t, analyst, insiders, errors, at: new Date().toISOString() };
}

// 티커 → SEC 등록 회사명 (큰손 보유 종목과 이름으로 대조하기 위함)
export async function names(list) {
  const dir = await getJson("https://www.sec.gov/files/company_tickers.json", SEC_UA), want = new Set(list), out = {};
  for (const x of Object.values(dir)) { const t = String(x.ticker).toUpperCase(); if (want.has(t)) out[t] = x.title || ""; }
  return out;
}
