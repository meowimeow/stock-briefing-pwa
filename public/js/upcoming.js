import { h, api } from "./core.js";

const KST = { timeZone: "Asia/Seoul" };
const kst = (iso, o) => new Date(iso).toLocaleString("ko-KR", { ...KST, hour12: false, ...o });
const todayStr = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/New_York" });
export const dDay = (date) => Math.round((Date.parse(date) - Date.parse(todayStr())) / 86400000);
const dLabel = (n) => (n <= 0 ? "오늘" : `D-${n}`);
const hourLabel = { bmo: "미국 장 시작 전 발표", amc: "미국 장 마감 후 발표", dmh: "장중 발표" };

// 미국 동부시간 날짜·시각이 실제로 언제인지 (그날의 서머타임 여부를 반영).
const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
function etInstant(date, hh, mm) {
  const [y, mo, d] = date.split("-").map(Number), guess = Date.UTC(y, mo - 1, d, hh, mm);
  const p = {}; for (const x of etFmt.formatToParts(new Date(guess))) p[x.type] = Number(x.value);
  return guess + (guess - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute));
}
// 실적 발표가 한국시간으로 언제인지. Finnhub는 정확한 시각 대신 장 전·장 마감 후만 알려주므로 그 경계(동부 9:30, 16:00)로 말한다.
// 보통 장 전 발표는 동부 6~8시, 장 마감 후 발표는 16시 직후에 나온다.
const kstFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const kstDay = (ms) => { const p = {}; for (const x of kstFmt.formatToParts(new Date(ms))) p[x.type] = x.value; return { day: `${p.month}.${p.day}(${p.weekday})`, time: `${p.hour}:${p.minute}` }; };
export function earnKst(e) {
  if (!e || !e.date) return null;
  const open = etInstant(e.date, 9, 30), close = etInstant(e.date, 16, 0), o = kstDay(open), c = kstDay(close);
  if (e.hour === "bmo") return { at: open, text: `한국시간 ${o.day} ${o.time} 전`, short: `${o.day} ${o.time} 전` };
  if (e.hour === "amc") return { at: close, text: `한국시간 ${c.day} ${c.time} 이후`, short: `${c.day} ${c.time} 이후` };
  if (e.hour === "dmh") return { at: open, text: `한국시간 ${o.day} ${o.time} ~ ${c.day} ${c.time} 사이`, short: `${o.day} ${o.time}~` };
  return { at: open, text: `한국시간 ${o.day} 밤 ~ ${c.day} 아침 (발표 시각 미공개)`, short: `${o.day} 밤~` };
}

let macroCache = null;
export async function macroSoon(days) {
  try {
    if (!macroCache || Date.now() - macroCache.at > 600000) { const p = api("/api/macro"); macroCache = { at: Date.now(), p }; p.catch(() => { macroCache = null; }); }
    const d = await macroCache.p;
    const end = Date.now() + days * 86400e3, now = Date.now() - 2 * 3600e3;
    return d.items.filter((i) => !i.error && i.nextReleaseUtc && Date.parse(i.nextReleaseUtc) >= now && Date.parse(i.nextReleaseUtc) <= end).sort((a, b) => a.nextReleaseUtc.localeCompare(b.nextReleaseUtc));
  } catch (x) { if (x.code === 401) throw x; return null; } // 키가 없거나 실패하면 조용히 생략
}

export const macroRow = (i) => {
  const hrs = (Date.parse(i.nextReleaseUtc) - Date.now()) / 3600e3;
  return h("div", { class: "up-row" }, h("span", { class: "up-tag" + (hrs <= 48 ? " soon" : "") }, "지표"),
    h("div", {}, h("b", {}, i.label), h("div", { class: "note" }, `${kst(i.nextReleaseUtc, { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })} (한국시간)` + (i.prev != null ? ` · 직전 ${i.prev.toLocaleString(undefined, { maximumFractionDigits: 2 })}${i.suffix}` : ""))));
};

export const earnRow = (t, e) => {
  const n = dDay(e.date);
  return h("div", { class: "up-row" }, h("span", { class: "up-tag" + (n <= 3 ? " soon" : "") }, "실적"),
    h("div", {}, h("b", {}, `${t} · ${e.date} (${dLabel(n)})`),
      h("div", { class: "note" }, earnKst(e).text),
      h("div", { class: "note" }, [hourLabel[e.hour], e.epsEst != null ? `예상 EPS ${e.epsEst}` : null, e.revEst ? `예상 매출 $${(e.revEst / 1e9).toFixed(2)}B` : null].filter(Boolean).join(" · ") || "시간·예상치 정보 없음")));
};

const surprise = (a, e) => (e ? ((a - e) / Math.abs(e)) * 100 : null);
const sp = (v) => (v == null ? "" : ` (${v >= 0 ? "상회" : "하회"} ${v >= 0 ? "+" : ""}${v.toFixed(1)}%)`);
export const resultRow = (t, L) => {
  const eps = surprise(L.epsActual, L.epsEst), rev = L.revEst ? surprise(L.revActual, L.revEst) : null;
  const ago = -dDay(L.date);
  return h("div", { class: "up-row" }, h("span", { class: "up-tag" + (ago <= 3 ? " soon" : "") }, "결과"),
    h("div", {}, h("b", {}, `${t ? t + " · " : ""}${L.date} 발표${ago >= 0 ? ` (${ago === 0 ? "오늘" : ago + "일 전"})` : ""}`),
      h("div", { class: eps == null ? "note" : eps >= 0 ? "up" : "down" }, `EPS ${L.epsActual}` + (L.epsEst != null ? ` / 예상 ${L.epsEst}` : "") + sp(eps)),
      L.revActual != null ? h("div", { class: "note" }, `매출 $${(L.revActual / 1e9).toFixed(2)}B` + (L.revEst ? ` / 예상 $${(L.revEst / 1e9).toFixed(2)}B${sp(rev)}` : "")) : null));
};

// 기업분석 화면: 이 종목의 실적 일정 + 곧 나올 경제지표
export function tickerUpcoming(t) {
  const box = h("div", { class: "card pad" }, h("p", { class: "note" }, "일정 확인 중…"));
  (async () => {
    const rows = [];
    let earnErr = null;
    try {
      const e = await api("/api/earn?t=" + encodeURIComponent(t));
      rows.push(e.date ? earnRow(t, e) : h("p", { class: "note" }, "90일 안에 예정된 실적 발표가 없습니다(또는 아직 일정이 공개되지 않았습니다)."));
      if (e.last) rows.push(resultRow(t, e.last));
      if (e.history && e.history.length > 1) rows.push(h("details", { class: "more" }, h("summary", {}, `지난 ${e.history.length}번의 실적 발표`), h("table", { class: "tbl num" }, h("tr", {}, ["발표일", "실제 EPS", "예상", "차이"].map((x) => h("th", {}, x))),
        e.history.map((r) => { const v = surprise(r.epsActual, r.epsEst); return h("tr", {}, h("td", {}, r.date), h("td", {}, r.epsActual), h("td", {}, r.epsEst ?? "-"), h("td", { class: v == null ? "" : v >= 0 ? "up" : "down" }, v == null ? "-" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%")); }))));
    }
    catch (x) { if (x.code === 401) return; earnErr = x.message; }
    const m = await macroSoon(7).catch(() => null);
    if (m && m.length) rows.push(h("p", { class: "note", style: "margin-top:10px" }, "앞으로 7일 안에 나오는 주요 경제지표"), ...m.map(macroRow));
    else if (m) rows.push(h("p", { class: "note", style: "margin-top:10px" }, "앞으로 7일 안에 예정된 주요 경제지표가 없습니다."));
    if (earnErr) rows.push(h("p", { class: "err" }, "실적 일정을 불러오지 못함: " + earnErr));
    box.replaceChildren(...rows);
  })();
  return box;
}

// 브리핑 화면: 관심종목 실적(14일 안) + 곧 나올 경제지표(3일 안). 이미 받은 데이터를 쓰므로 추가 호출은 경제지표뿐이다.
export function briefUpcoming(items, tickers, onLogin) {
  const box = h("div", {});
  const earn = tickers.map((t) => [t, items[t] && items[t].earnings]).filter(([, e]) => e && e.date && dDay(e.date) >= 0 && dDay(e.date) <= 14).sort((a, b) => a[1].date.localeCompare(b[1].date));
  const res = tickers.map((t) => [t, items[t] && items[t].earnings && items[t].earnings.last]).filter(([, L]) => L && L.date && -dDay(L.date) >= 0 && -dDay(L.date) <= 3);
  const draw = (m) => {
    const rows = [...res.map(([t, L]) => resultRow(t, L)), ...earn.map(([t, e]) => earnRow(t, e)), ...(m || []).map(macroRow)];
    box.replaceChildren(...(rows.length ? [h("h2", {}, "곧 있는 일정"), h("div", { class: "card pad" }, rows)] : []));
  };
  draw(null);
  macroSoon(3).then(draw).catch((x) => { if (x.code === 401) onLogin(); });
  return box;
}
