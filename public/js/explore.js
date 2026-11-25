import { h, LS, api, store, spinner, safeUrl } from "./core.js";
import { searchBox } from "./search.js";
import { sheet, seg, KEY_STOCK } from "./ui.js";
import { companyView } from "./company.js";

// 탐색: 큰손(13F 집계, Dataroma 방식) | 기업(재무 10년·역DCF) | 링크(외부 사이트)
let root = null, onLogin = () => {}, segv = LS.get("explore:seg", "big"), bm = LS.get("bigmoney", null), bmBusy = false, bmProg = "", bmErr = "";
const nameMap = {};
export const exploreTab = {
  id: "explore", label: "탐색",
  setLogin(fn) { onLogin = fn; },
  async show(el) { root = el; render(); },
};

const norm = (s) => String(s || "").toUpperCase().replace(/[.,'&]/g, " ").replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HOLDINGS?|GROUP|CLASS|CL|COM|NEW|THE|ORD|SHS|ADR|SPONSORED|CAP|STK)\b/g, " ").replace(/\b[A-C]\b/g, " ").replace(/\s+/g, " ").trim();
const mineOf = (name) => { const n = norm(name); if (n.length < 4) return null; const e = Object.entries(nameMap).find(([, v]) => { const m = norm(v); return m && (m === n || (m.length >= 5 && (m.startsWith(n) || n.startsWith(m)))); }); return e ? e[0] : null; };

function render() {
  if (!root) return;
  const body = h("div", {});
  root.replaceChildren(h("h1", {}, "탐색"), seg([["big", "큰손"], ["co", "기업"], ["link", "링크"]], segv, (v) => { segv = v; LS.set("explore:seg", v); draw(body); }), body);
  draw(body);
}
function draw(body) {
  if (segv === "big") return bigTab(body);
  if (segv === "co") return coTab(body);
  return linkTab(body);
}

// ---------- 큰손: 12개 펀드 13F를 모아 '같이 산 종목' ----------
const STALE = 6 * 3600e3;
async function loadBig(force, body) {
  if (bmBusy) return;
  if (!force && bm && Date.now() - bm.at < STALE) return;
  bmBusy = true; bmErr = ""; bmProg = "펀드 목록"; if (segv === "big") draw(body);
  try {
    const funds = (await api("/api/funds")).funds, out = [], q = [...funds];
    let done = 0, auth = false;
    const run = async () => {
      while (q.length && !auth) {
        const f = q.shift();
        try {
          const r = await api("/api/fund?id=" + encodeURIComponent(f.id));
          out.push({ id: f.id, label: f.label.split(" (")[0], period: r.period, filed: r.filed, total: r.total, rows: r.rows.slice(0, 30).map((x) => [x.name, +x.pct.toFixed(4), x.change || "", x.chgPct == null ? null : +x.chgPct.toFixed(3), x.put || ""]), exited: r.exited.slice(0, 5).map((x) => x.name) });
        } catch (x) { if (x.code === 401) { auth = true; return; } out.push({ id: f.id, label: f.label.split(" (")[0], err: x.message, rows: [] }); }
        bmProg = `${++done}/${funds.length}`; if (segv === "big") draw(body);
      }
    };
    await Promise.all([run(), run()]);
    if (auth) { bmBusy = false; return onLogin(); }
    const good = out.filter((x) => x.rows.length);
    if (good.length) { bm = { at: Date.now(), funds: out.sort((a, b) => a.label.localeCompare(b.label)) }; LS.set("bigmoney", bm); } else bmErr = "13F를 하나도 받지 못했습니다: " + (out[0] && out[0].err || "");
  } catch (x) { if (x.code === 401) { bmBusy = false; return onLogin(); } bmErr = x.message; }
  bmBusy = false; bmProg = ""; if (segv === "big") draw(body);
}
function aggregate() {
  const m = new Map();
  for (const f of bm.funds) for (const [name, pct, change, chg, put] of f.rows) {
    if (put) continue;
    const k = norm(name); if (!k) continue;
    const o = m.get(k) || { name, n: 0, w: 0, nw: 0, inc: 0, dec: 0, by: [] };
    o.n++; o.w += pct; if (change === "신규") o.nw++; if (change === "확대") o.inc++; if (change === "축소") o.dec++; o.by.push({ f: f.label, pct, change, chg }); m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.w - a.w);
}
async function bigTab(body) {
  if (!bm && !bmBusy) { body.replaceChildren(spinner("")); loadBig(false, body); }
  if (!bm) { body.replaceChildren(bmBusy ? spinner(`SEC에서 13F를 읽는 중… ${bmProg} (처음 한 번 1분 안팎)`) : null, bmErr ? h("p", { class: "err" }, bmErr) : null, !bmBusy ? h("button", { class: "primary", onclick: () => loadBig(true, body) }, "다시 시도") : null); return; }
  loadBig(false, body);
  if (!Object.keys(nameMap).length) api("/api/names?t=" + encodeURIComponent(store.watch.slice(0, 14).join(","))).then((r) => { Object.assign(nameMap, r.names || {}); if (segv === "big") draw(body); }).catch(() => {});
  const ok = bm.funds.filter((f) => f.rows.length), agg = aggregate();
  const common = agg.filter((x) => x.n >= 2).slice(0, 25), mx = ok.length;
  body.replaceChildren(
    h("p", { class: "note" }, `${ok.length}개 펀드의 최신 13F 상위 보유를 합쳐, 여러 곳이 함께 들고 있는 종목을 위에 둡니다 (Dataroma 방식). 분기 말 기준이라 최대 45일 늦습니다.`),
    h("div", { class: "card" }, common.map((x) => { const mine = mineOf(x.name); return h("button", { type: "button", class: "mine-row", onclick: () => holdersSheet(x), }, h("span", { class: "name", style: "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis" }, x.name, mine ? h("span", { class: "pill", style: "margin-left:6px" }, mine) : null),
      h("span", { class: "px num" }, `${x.n}/${mx}곳`, h("small", { class: "blk " + (x.nw + x.inc > x.dec ? "up" : x.dec > x.nw + x.inc ? "down" : "") }, `평균 ${(x.w / x.n * 100).toFixed(1)}%` + (x.nw ? ` · 신규 ${x.nw}` : "") + (x.inc ? ` · 확대 ${x.inc}` : "") + (x.dec ? ` · 축소 ${x.dec}` : "")))); })),
    h("div", { class: "sec-h" }, "큰손별 보기"),
    h("div", { class: "chips pick" }, ok.map((f) => h("button", { type: "button", class: "tab-chip", onclick: () => fundSheet(f) }, f.label))),
    h("p", { class: "note" }, `갱신 ${new Date(bm.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} · 펀드마다 상위 30개 종목만 사용 · 옵션(PUT/CALL)은 제외했습니다. 누군가 샀다는 사실이 좋은 종목이라는 뜻은 아닙니다.`),
    bm.funds.some((f) => f.err) ? h("p", { class: "note" }, "받지 못한 펀드: " + bm.funds.filter((f) => f.err).map((f) => f.label).join(", ")) : null,
    h("button", { class: "ghost", disabled: bmBusy, onclick: () => loadBig(true, body) }, bmBusy ? `갱신 중 ${bmProg}` : "13F 새로 받기"));
}
const chgTxt = (c, chg) => (c ? c + (chg != null && c !== "유지" && c !== "신규" ? ` ${chg > 0 ? "+" : ""}${(chg * 100).toFixed(0)}%` : "") : "");
function holdersSheet(x) {
  sheet(x.name, h("div", { class: "card pad" }, x.by.sort((a, b) => b.pct - a.pct).map((b) => h("div", { class: "up-row" }, h("b", {}, b.f), h("div", { class: "num", style: "margin-left:auto;text-align:right" }, `${(b.pct * 100).toFixed(1)}%`, h("small", { class: "blk " + (b.change === "신규" || b.change === "확대" ? "up" : b.change === "축소" ? "down" : "") }, chgTxt(b.change, b.chg))))),
    h("p", { class: "note" }, "비중은 그 펀드의 13F 전체 대비입니다.")));
}
function fundSheet(f) {
  sheet(f.label, h("div", {}, h("p", { class: "note" }, `기준 ${f.period} (제출 ${f.filed})`), h("div", { class: "card pad" }, f.rows.slice(0, 20).map(([name, pct, change, chg, put]) => h("div", { class: "up-row" }, h("div", {}, h("b", {}, name), put ? h("span", { class: "note" }, " " + put) : null),
    h("div", { class: "num", style: "margin-left:auto;text-align:right" }, `${(pct * 100).toFixed(1)}%`, h("small", { class: "blk " + (change === "신규" || change === "확대" ? "up" : change === "축소" ? "down" : "") }, chgTxt(change, chg)))))),
    f.exited && f.exited.length ? h("p", { class: "note" }, "직전 분기에 있다가 사라진 종목: " + f.exited.join(", ")) : null));
}

// ---------- 기업 ----------
function coTab(body) {
  const holder = h("div", {});
  const go = (t) => { LS.set("co:t", t); holder.replaceChildren(companyView(t, () => onLogin())); };
  const cur = LS.get("co:t", "") || LS.get(KEY_STOCK, "") || store.watch[0];
  const chips = h("div", { class: "chips pick" }, store.watch.map((t) => h("button", { type: "button", class: "tab-chip", onclick: () => go(t) }, t)));
  body.replaceChildren(searchBox({ placeholder: "회사명 또는 티커 검색 (예: Tesla)", button: "분석", onPick: go, onLogin: () => onLogin() }), chips, holder);
  if (cur) go(cur); else holder.replaceChildren(h("p", { class: "note" }, "티커를 입력하면 10년 재무와 점수, 역DCF를 보여줍니다."));
}

// ---------- 링크 ----------
function linkTab(body) {
  const t = LS.get(KEY_STOCK, store.watch[0] || "AAPL");
  const L = (name, desc, url) => h("a", { class: "lnk", href: safeUrl(url), target: "_blank", rel: "noopener noreferrer" }, h("b", {}, name), h("span", { class: "note" }, desc), h("span", { class: "arrow", "aria-hidden": "true" }, "↗"));
  body.replaceChildren(
    h("p", { class: "note" }, "공개 API가 없거나 약관상 앱에서 긁어올 수 없는 사이트입니다. 새 창으로 열립니다."),
    h("div", { class: "sec-h" }, `${t} 바로가기`),
    h("div", { class: "card" },
      L("Dataroma", "이 종목을 보유한 큰손 목록", `https://www.dataroma.com/m/stock.php?sym=${encodeURIComponent(t)}`),
      L("MacroTrends", "수십 년치 재무·PER 차트", `https://www.macrotrends.net/stocks/charts/${encodeURIComponent(t)}/${encodeURIComponent(t.toLowerCase())}/revenue`),
      L("Quartr", "실적 콜 녹음·자료", "https://quartr.com/"),
      L("SEC EDGAR", "공시 원문", `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(t)}&type=&dateb=&owner=include&count=40`),
      L("Finviz", "스크리너·요약", `https://finviz.com/quote.ashx?t=${encodeURIComponent(t)}`)),
    h("div", { class: "sec-h" }, "전체"),
    h("div", { class: "card" },
      L("Dataroma 홈", "슈퍼투자자 포트폴리오 모음", "https://www.dataroma.com/m/home.php"),
      L("한경컨센서스", "국내 증권사 리포트 모음", "https://consensus.hankyung.com/"),
      L("MacroTrends 홈", "재무 데이터 검색", "https://www.macrotrends.net/"),
      L("Quartr 홈", "실적 발표 캘린더", "https://quartr.com/")),
    h("p", { class: "note" }, "종목 바로가기는 '내 종목'에서 마지막으로 본 종목 기준입니다. MacroTrends 주소가 맞지 않으면 홈에서 검색하세요."));
}
