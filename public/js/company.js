import { h, LS, api, store, limitsBox, spinner, sync, withWon } from "./core.js";
import { searchBox } from "./search.js";
import { tickerUpcoming } from "./upcoming.js";
import { scorePanel } from "./score.js";

// ---------- 계산 (Streamlit의 company_analysis.py / quant_indicators.py와 같은 공식) ----------
const cagr = (s) => {
  if (s.length < 2) return null;
  const [d0, v0] = s[0], [d1, v1] = s[s.length - 1], yrs = Number(d1.slice(0, 4)) - Number(d0.slice(0, 4));
  return v0 > 0 && v1 != null && yrs > 0 ? (v1 / v0) ** (1 / yrs) - 1 : null;
};
const margin = (num, den) => { const m = new Map(den); return num.filter(([d]) => m.get(d)).map(([d, v]) => [d, v / m.get(d)]); };
const yoy = (s) => s.slice(1).map(([d, v], i) => (s[i][1] ? v / s[i][1] - 1 : null)).filter((x) => x != null);
const vol = (s) => { const r = yoy(s); if (r.length < 2) return null; const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * 100; };
const mdd = (s) => { if (s.length < 2) return null; let peak = s[0][1], worst = 0; for (const [, v] of s) { peak = Math.max(peak, v); if (peak > 0) worst = Math.min(worst, v / peak - 1); } return worst; };

function dcf(fcf, g, wacc, tg, years) {
  if (wacc <= tg) return null;
  let pv = 0, f = fcf;
  for (let t = 1; t <= years; t++) { f *= 1 + g; pv += f / (1 + wacc) ** t; }
  return pv + (f * (1 + tg)) / (wacc - tg) / (1 + wacc) ** years;
}
function implied(cap, fcf, wacc, tg, years) {
  if (fcf == null || fcf <= 0) return { err: "FCF(잉여현금흐름)가 0 이하라 역DCF를 계산할 수 없습니다 (확인 필요)" };
  if (!cap || cap <= 0) return { err: "시가총액 데이터가 없습니다 (확인 필요)" };
  let lo = -0.3, hi = 0.6;
  const vl = dcf(fcf, lo, wacc, tg, years), vh = dcf(fcf, hi, wacc, tg, years);
  if (vl == null || vh == null) return { err: "할인율(WACC)이 영구성장률보다 낮아 계산할 수 없습니다" };
  if (!(vl < cap && cap < vh)) return { err: "탐색 범위(-30%~+60% 성장) 밖의 극단적인 값입니다. 수동 확인이 필요합니다" };
  let mid = 0;
  for (let i = 0; i < 100; i++) { mid = (lo + hi) / 2; const v = dcf(fcf, mid, wacc, tg, years); if (Math.abs(v - cap) < 1e6) break; if (v < cap) lo = mid; else hi = mid; }
  return { g: mid };
}

const usd0 = (n) => { if (n == null) return "확인 필요"; const a = Math.abs(n), s = n < 0 ? "-" : ""; return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : `${s}$${(a / 1e6).toFixed(1)}M`; };
const usd = (n) => (n == null ? "확인 필요" : withWon(usd0(n), n));
const pc = (x, d = 1) => (x == null ? "확인 필요" : (x * 100).toFixed(d) + "%");

// ---------- 화면 ----------
let root, body, cur = LS.get("co:t", ""), card = null, wacc = 9, tg = 2.5, years = 10;
export const companyTab = {
  id: "company", label: "기업분석",
  setLogin(fn) { companyTab.onLogin = fn; },
  async show(el) {
    root = el;
    root.replaceChildren(h("h1", {}, "기업분석"),
      h("p", { class: "sub" }, "① 기업 해독기: SEC 공시 기준 재무 추이. ② 가격 판독기: 지금 주가가 성립하려면 얼마나 성장해야 하는지 역산(역DCF)해 과거 성장률과 비교합니다. 매수/매도 신호를 내지 않으며 투자 자문이 아닙니다."),
      limitsBox([
        "재무 수치는 SEC 연간 보고서(10-K) 기준이라 가장 최근 분기 실적은 반영되지 않았습니다. 결산한 지 몇 달 지난 값일 수 있습니다.",
        "회사마다 공시 항목 이름이 달라서 일부 값은 '확인 필요'로 비어 있을 수 있습니다.",
        "역DCF는 할인율·영구성장률·기간 같은 가정에 크게 좌우되는 시뮬레이션이며 적정주가가 아닙니다.",
        "시가총액은 무료 데이터라 약간 늦을 수 있습니다. 미국 상장사만 지원하고, 외국 기업(20-F 제출)은 비어 있을 수 있습니다.",
        "내 생각 기록은 이 폰의 브라우저에만 저장되며, 브라우저 데이터를 지우면 사라집니다.",
      ]),
      pickRow(), body = h("div", {}));
    if (cur) load(cur); else body.replaceChildren(h("p", { class: "note" }, "관심종목을 고르거나 티커를 입력하면 바로 분석합니다."));
  },
};

// 탐색 탭에 끼워 넣는 용도: 선택한 종목의 분석을 담은 상자를 돌려준다.
export function companyView(t, onLogin) {
  companyTab.onLogin = onLogin; cur = t; body = h("div", {}); load(t); return body;
}

function pickRow() {
  const row = h("div", { class: "chips pick" });
  const draw = () => row.replaceChildren(...store.watch.map((t) => h("button", { class: "tab-chip" + (t === cur ? " on" : ""), onclick: () => go(t) }, t)));
  const go = (t) => { cur = t; LS.set("co:t", t); draw(); load(t); };
  draw();
  return h("div", {}, row, searchBox({ placeholder: "회사명 또는 티커 검색 (예: Tesla)", button: "분석", onPick: go, onLogin: () => companyTab.onLogin() }));
}

async function load(t) {
  body.replaceChildren(spinner("공시와 시세를 불러오는 중… (몇 초 걸립니다)"));
  try { card = await api("/api/company?t=" + encodeURIComponent(t)); if (cur === t) draw(); }
  catch (x) { if (x.code === 401) return companyTab.onLogin(); body.replaceChildren(h("p", { class: "err" }, "불러오지 못함: " + x.message)); }
}

function lineChart(s) {
  const W = 340, H = 130, pad = 6, ys = s.map((p) => p[1]), y0 = Math.min(0, ...ys), y1 = Math.max(...ys);
  const X = (i) => pad + (i / Math.max(1, s.length - 1)) * (W - 2 * pad), Y = (v) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "chart"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "연간 매출 추이");
  const mk = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); };
  mk("path", { d: s.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(""), fill: "none", stroke: "#00c805", "stroke-width": "1.8" });
  s.forEach((p, i) => mk("circle", { cx: X(i), cy: Y(p[1]), r: 2.4, fill: "#00c805" }));
  return svg;
}

// MacroTrends 방식의 연도별 막대 (최근 10개 회계연도)
function miniBars(label, s) {
  const d = s.slice(-10); if (d.length < 2) return null;
  const mx = Math.max(...d.map((p) => Math.abs(p[1]))) || 1, W = 150, H = 44, bw = W / d.length;
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "mini"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label + " 연도별");
  d.forEach((p, i) => { const r = document.createElementNS(ns, "rect"), hh = Math.max(1, (Math.abs(p[1]) / mx) * (H - 2)); r.setAttribute("x", i * bw + 1); r.setAttribute("width", Math.max(1, bw - 2)); r.setAttribute("height", hh); r.setAttribute("y", p[1] >= 0 ? H - hh : 0); r.setAttribute("fill", p[1] >= 0 ? "#00c805" : "#ff5000"); r.setAttribute("opacity", i === d.length - 1 ? "1" : ".6"); svg.append(r); });
  const g = cagr(d);
  return h("div", { class: "mb" }, h("small", { class: "note" }, label), svg, h("b", { class: "num" }, usd0(d[d.length - 1][1])), h("small", { class: "note" }, `${d[0][0].slice(0, 4)}~${d[d.length - 1][0].slice(0, 4)}` + (g != null ? ` · 연평균 ${(g * 100).toFixed(1)}%` : "")));
}

const metric = (k, v, cls) => h("div", { class: "metric" }, h("div", { class: "big num " + (cls || "") }, v), h("div", { class: "note" }, k));

function draw() {
  const c = card, S = c.series, rev = S.revenue;
  const kids = [];
  if (c.errors.length) kids.push(h("details", { class: "more" }, h("summary", {}, `불러오지 못한 항목 ${c.errors.length}건`), c.errors.map((e) => h("p", { class: "note" }, e))));
  kids.push(h("h2", {}, "종합 점수표 · 안정 ↔ 위험"), h("p", { class: "note" }, "재무제표·PER·PBR·현금흐름을 종합하고 최근 리스크를 반영해 100점 만점으로 매깁니다. 기준은 맨 아래 '점수는 무엇을 기준으로 매기나요?'에 있습니다."), scorePanel(c.ticker, () => companyTab.onLogin()));
  kids.push(h("h2", {}, "다가오는 일정"), tickerUpcoming(c.ticker));
  // 10년 재무 한눈에
  { const fcf0 = S.ocf.map(([d, v]) => [d, v - Math.abs((new Map(S.capex)).get(d) || 0)]);
    const mb = [miniBars("매출", rev), miniBars("영업이익", S.operatingIncome), miniBars("순이익", S.netIncome), miniBars("잉여현금흐름", fcf0)].filter(Boolean);
    if (mb.length) kids.push(h("h2", {}, "10년 재무 (SEC 10-K)"), h("div", { class: "mbs" }, mb), h("p", { class: "note" }, "막대는 회계연도별 값, 마지막 막대가 가장 최근입니다. 회사마다 공시 항목 이름이 달라 비어 있을 수 있습니다.")); }
  // ① 기업 해독기
  const revCagr = cagr(rev), opm = margin(S.operatingIncome, rev), nm = margin(S.netIncome, rev), rv = vol(rev), rd = mdd(rev);
  const mc = c.marketCapMusd ? c.marketCapMusd * 1e6 : null;
  kids.push(h("h2", {}, "① 기업 해독기"),
    h("div", { class: "card pad" },
      h("div", { class: "card-h" }, h("b", {}, `${c.name || c.ticker} (${c.ticker})`), h("span", { class: "pill" }, mc ? "시총 " + usd(mc) : "시총 확인 필요")),
      h("p", { class: "note" }, `업종: ${c.industry || "확인 필요"} · 거래소: ${c.exchange || "확인 필요"}`),
      rev.length ? [h("p", {}, h("b", {}, "매출 추이 "), h("span", { class: "note" }, "SEC 10-K 공시 기준 [사실]")), lineChart(rev),
        h("p", { class: "note" }, `최근 회계연도(${rev[rev.length - 1][0].slice(0, 4)}) 매출 ${usd(rev[rev.length - 1][1])} · 연평균성장률(CAGR, ${rev[0][0].slice(0, 4)}~${rev[rev.length - 1][0].slice(0, 4)}) ${pc(revCagr)} [해석: 과거 실제 성장 속도]`),
        rv != null || rd != null ? h("p", { class: "note" }, `매출 변동성(연간 성장률 표준편차) ${rv != null ? rv.toFixed(1) + "%p" : "확인 필요"} · 최대 낙폭 ${rd != null ? (rd * 100).toFixed(1) + "%" : "확인 필요"} [해석: 성장이 얼마나 들쭉날쭉했는지]`) : null]
        : h("p", { class: "note" }, "SEC 공시에서 매출 데이터를 찾지 못했습니다 (확인 필요 — 티커나 공시 태그가 다를 수 있음).")),
    h("div", { class: "metrics" }, metric("최근 영업이익률 [사실]", opm.length ? pc(opm[opm.length - 1][1]) : "확인 필요"), metric("최근 순이익률 [사실]", nm.length ? pc(nm[nm.length - 1][1]) : "확인 필요")));
  // ② 가격 판독기
  const capex = new Map(S.capex), fcf = S.ocf.map(([d, v]) => [d, v - Math.abs(capex.get(d) || 0)]);
  const last = fcf.length ? fcf[fcf.length - 1] : null, fcfCagr = cagr(fcf), fv = vol(fcf), fd = mdd(fcf);
  const out = h("div", {});
  const sl = (label, min, max, step, get, set) => { const v = h("b", { class: "num" }, String(get())); return h("label", { class: "slide" }, h("span", {}, label, " ", v), h("input", { type: "range", min, max, step, value: get(), oninput: (e) => { set(Number(e.target.value)); v.textContent = e.target.value; paint(); } })); };
  const paint = () => {
    const kidsB = [];
    if (!last) kidsB.push(h("p", { class: "note" }, "영업현금흐름/CAPEX 데이터를 찾지 못해 역DCF를 계산할 수 없습니다 (확인 필요)."));
    else {
      kidsB.push(h("div", { class: "metrics" }, metric(`최근 FCF [사실] (${last[0].slice(0, 4)})`, usd(last[1])), metric("과거 FCF 연평균성장률 [사실]", pc(fcfCagr))),
        h("p", { class: "note" }, "FCF = 영업현금흐름 − CAPEX (SEC 공시 기준)"));
      if (fv != null || fd != null) kidsB.push(h("p", { class: "note" }, `FCF 변동성 ${fv != null ? fv.toFixed(1) + "%p" : "확인 필요"} · 최대 낙폭 ${fd != null ? (fd * 100).toFixed(1) + "%" : "확인 필요"} [해석: 역DCF는 FCF가 꾸준히 성장한다고 가정하므로 변동성이 크면 그 가정을 의심해 보세요]`));
      const r = implied(mc, last[1], wacc / 100, tg / 100, years);
      if (r.err) kidsB.push(h("p", { class: "err" }, "역DCF 계산 불가: " + r.err));
      else {
        const ig = r.g * 100, hist = revCagr != null ? revCagr * 100 : null, gap = hist != null ? ig - hist : null;
        kidsB.push(h("div", { class: "big num", style: "color:#4da3ff;margin-top:14px" }, `시장 내재 성장률 ${ig.toFixed(1)}%`),
          h("p", { class: "note" }, `WACC ${wacc.toFixed(1)}% · 영구성장률 ${tg.toFixed(1)}% · ${years}년 예측 가정 [해석: 가정에 따라 달라짐]`));
        if (hist != null) kidsB.push(h("p", {}, `과거 매출 CAGR: ${hist.toFixed(1)}% → ${gap > 3 ? "시장이 과거 실적보다 더 높은 성장을 기대하고 있음" : gap < -3 ? "시장이 과거 실적보다 더 낮은 성장을 기대하고 있음" : "시장 기대치가 과거 실적과 비슷한 수준"} [해석]`));
        const sens = [-2, -1, 0, 1, 2].map((d) => { const w = Math.max(tg + 0.5, wacc + d); const x = implied(mc, last[1], w / 100, tg / 100, years); return [w, x.g]; });
        kidsB.push(h("p", { class: "note", style: "margin-top:12px" }, "WACC 민감도 (하나의 숫자에 의존하지 않기 위한 참고용)"),
          h("table", { class: "tbl num" }, h("tr", {}, sens.map(([w]) => h("th", {}, `WACC ${w.toFixed(1)}%`))), h("tr", {}, sens.map(([, g]) => h("td", {}, g != null ? (g * 100).toFixed(1) + "%" : "확인 필요")))));
      }
    }
    out.replaceChildren(...kidsB);
  };
  kids.push(h("h2", {}, "② 가격 판독기 (역DCF)"), h("p", { class: "note" }, "일반 DCF는 성장률을 추정해 적정주가를 계산하지만, 이건 거꾸로 '지금 시가총액이 정당화되려면 앞으로 얼마나 벌어야 하는가'를 역산합니다."),
    h("div", { class: "card pad" }, sl("할인율 WACC (%)", 4, 18, 0.5, () => wacc, (v) => (wacc = v)), sl("영구성장률 (%)", 0, 4, 0.5, () => tg, (v) => (tg = v)), sl("예측 기간 (년)", 5, 15, 1, () => years, (v) => (years = v)), out));
  paint();
  kids.push(notes(c.ticker, implied(mc, last && last[1], wacc / 100, tg / 100, years).g, revCagr));
  kids.push(h("p", { class: "foot" }, "투자 조언이 아닙니다. 실제 판단에 쓰는 숫자는 원문 공시에서 다시 확인하세요."));
  body.replaceChildren(...kids.flat(Infinity).filter(Boolean));
}

// ③ 내 생각 기록: 폰에만 저장한다.
function notes(t, impliedG, revCagr) {
  const list = LS.get("notes:" + t, []);
  const text = h("textarea", { rows: "3", placeholder: "예: AI 서버향 메모리 수요 증가로 향후 2년간 실적 개선을 예상함…", "aria-label": "내 생각" });
  const eg = h("input", { type: "number", step: "1", placeholder: "예상 성장률 % (선택)", "aria-label": "예상 성장률" });
  const st = h("select", { "aria-label": "방향성" }, ["중립", "긍정", "부정"].map((x) => h("option", {}, x)));
  const redraw = () => { const n = document.getElementById("co-notes"); if (n) n.replaceWith(notes(t, impliedG, revCagr)); };
  const lastN = list[list.length - 1];
  return h("div", { id: "co-notes" }, h("h2", {}, "③ 내 생각 기록 vs 현재 추세"),
    h("p", { class: "note" }, "맞다/틀리다를 판정하지 않고, 적어 둔 생각과 데이터 기반 추세를 나란히 보여줍니다."),
    h("div", { class: "card pad" }, text, h("div", { class: "row2" }, eg, st), h("button", { class: "primary", onclick: () => {
      if (!text.value.trim()) return;
      list.push({ date: new Date().toISOString().slice(0, 10), text: text.value.trim().slice(0, 500), g: eg.value === "" ? null : Number(eg.value), stance: st.value });
      LS.set("notes:" + t, list.slice(-30)); sync.touch(); redraw();
    } }, "기록 저장")),
    lastN ? h("div", { class: "card pad" }, h("p", { class: "note" }, `최근 기록(${lastN.date}) · ${lastN.stance}`), h("p", {}, lastN.text),
      h("div", { class: "metrics" }, metric("내 예상 성장률", lastN.g != null ? lastN.g.toFixed(1) + "%" : "미입력"), metric("시장 내재 성장률 [사실]", impliedG != null ? (impliedG * 100).toFixed(1) + "%" : "확인 필요"), metric("과거 매출 CAGR [사실]", pc(revCagr))),
      h("button", { class: "ghost", onclick: () => { LS.set("notes:" + t, list.slice(0, -1)); sync.touch(); redraw(); } }, "이 기록 삭제")) : null);
}
