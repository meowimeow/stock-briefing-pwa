import { h, LS, api, store, signed, money, won, safeUrl, spinner, copyPromptBox, fmtTime, limitsBox } from "./core.js";
import { searchBox } from "./search.js";
import { liveChart } from "./chart.js";
import { sheet, seg, KEY_STOCK } from "./ui.js";
import { quickLight, lightOf, dotCls } from "./lights.js";
import { tickerUpcoming } from "./upcoming.js";
import { verifyPanel } from "./verify.js";
import { scorePanel } from "./score.js";

// 내 종목: 위쪽은 증권사 앱처럼 움직이는 차트, 아래는 한 줄 판단과 5개 탭(요약·점수·뉴스·전문가·메모).
let root = null, onLogin = () => {}, cur = null, tab = LS.get("stock:tab", "sum"), chartObj = null;
const tk = {}, ex = {}, aiCache = {};
const COL = { red: "빨강", yellow: "노랑", green: "초록" };

export const stocksTab = {
  id: "stocks", label: "내 종목",
  setLogin(fn) { onLogin = fn; },
  async show(el) {
    root = el;
    const want = LS.get(KEY_STOCK, null);
    cur = store.watch.includes(want) ? want : store.watch[0] || null;
    render(); warm();
  },
};

// 모든 칩에 경고등을 채운다 (차트를 다시 그리지 않고 점만 바꾼다)
async function warm() {
  const q = [...store.watch];
  const run = async () => { while (q.length) { const t = q.shift(); try { const o = await quickLight(t); const b = root && root.querySelector(`[data-tk="${t}"]`); if (b) { b.querySelector(".lt")?.remove(); b.prepend(h("span", { class: dotCls(o.level) })); } } catch (x) { if (x.code === 401) { q.length = 0; return onLogin(); } } } };
  await Promise.all([run(), run()]);
}

function render() {
  if (chartObj) { chartObj.destroy(); chartObj = null; }
  if (!root) return;
  const chips = h("div", { class: "chips pick tk" }, store.watch.map((t) => {
    const o = lightOf(t);
    return h("button", { type: "button", "data-tk": t, class: "tab-chip" + (t === cur ? " on" : ""), onclick: () => { cur = t; LS.set(KEY_STOCK, t); render(); } }, o ? h("span", { class: dotCls(o.level) }) : null, t, store.hold.some((x) => x.t === t) ? h("small", { class: "hold-mark" }, "★") : null);
  }), h("button", { type: "button", class: "tab-chip", "aria-label": "종목 추가", onclick: addSheet }, "+"));
  if (!cur) { root.replaceChildren(h("h1", {}, "내 종목"), chips, h("p", { class: "note" }, "+ 를 눌러 종목을 추가하세요.")); return; }
  chartObj = liveChart(cur, () => onLogin());
  const verdict = h("div", { class: "verdict" }, h("span", { class: "lt lt-none" }), h("span", { class: "note" }, "점검 중…"));
  const body = h("div", { class: "stk-body" });
  root.replaceChildren(chips, h("div", { class: "stk-head" }, h("h1", {}, cur), h("span", { class: "note", id: "stk-name" })), chartObj.el, verdict,
    seg([["sum", "요약"], ["score", "점수"], ["news", "뉴스"], ["pro", "전문가"], ["memo", "메모"]], tab, (v) => { tab = v; LS.set("stock:tab", v); drawTab(body); }), body);
  const t = cur;
  quickLight(t).then((o) => { if (cur !== t) return; const bad = o.lights.filter((x) => x.level !== "green").sort((a, b) => (b.level === "red") - (a.level === "red"));
    verdict.replaceChildren(h("span", { class: dotCls(o.level) }), h("b", {}, o.level === "green" ? "특별한 경고 없음" : `경고 ${bad.length}개`), h("span", { class: "note" }, bad[0] ? ` · ${bad[0].label}: ${bad[0].text}`.slice(0, 90) : o.industry ? ` · ${o.industry}` : "")); })
    .catch((x) => { if (x.code === 401) onLogin(); else if (cur === t) verdict.replaceChildren(h("span", { class: "note" }, "경고등 점검 실패: " + x.message)); });
  drawTab(body);
  api("/api/names?t=" + encodeURIComponent(t)).then((r) => { const n = document.getElementById("stk-name"); if (n && cur === t && r.names && r.names[t]) n.textContent = r.names[t]; }).catch(() => {});
}

function addSheet() {
  const s = sheet("종목 추가", h("div", {}, searchBox({ placeholder: "회사명 또는 티커로 추가", button: "추가", onLogin: () => onLogin(), onPick: (t) => { if (!store.watch.includes(t)) { store.watch.push(t); store.save(); } cur = t; LS.set(KEY_STOCK, t); s.close(); render(); } }),
    h("p", { class: "note" }, "미국 상장 종목만 지원합니다. 한국 종목은 보지 않습니다.")));
}

function drawTab(body) {
  const t = cur;
  if (tab === "sum") return sumTab(body, t);
  if (tab === "score") return body.replaceChildren(scorePanel(t, () => onLogin()));
  if (tab === "news") return newsTab(body, t);
  if (tab === "pro") return proTab(body, t);
  return memoTab(body, t);
}

function sumTab(body, t) {
  body.replaceChildren(spinner("신호 확인 중…"));
  quickLight(t).then((o) => {
    if (cur !== t || tab !== "sum") return;
    const rows = o.lights.slice().sort((a, b) => (b.level === "red") - (a.level === "red") || (b.level === "yellow") - (a.level === "yellow"));
    body.replaceChildren(
      h("div", { class: "card" }, rows.length ? rows.map((x) => h("div", { class: "lrow" }, h("span", { class: dotCls(x.level) }), h("div", {}, h("b", {}, x.label), h("div", { class: "note" }, x.text)))) : h("p", { class: "note pad" }, "규칙에 걸린 항목이 없습니다.")),
      h("div", { class: "sec-h" }, "일정"), tickerUpcoming(t),
      h("details", { class: "more" }, h("summary", {}, "교차 점검 · 발표 vs 실제 데이터"), verifyPanel(t, () => onLogin())),
      h("p", { class: "note" }, "경고등은 변동성·낙폭·실적일정·내부자·애널리스트·뉴스를 규칙으로 본 참고용입니다. 투자 조언이 아닙니다."));
  }).catch((x) => { if (x.code === 401) return onLogin(); body.replaceChildren(h("p", { class: "err" }, x.message)); });
}

async function ticker(t) {
  if (tk[t] && Date.now() - tk[t].at < 600000) return tk[t].v;
  const v = await api("/api/ticker?t=" + encodeURIComponent(t)); tk[t] = { at: Date.now(), v }; return v;
}
function newsTab(body, t) {
  body.replaceChildren(spinner("뉴스를 불러오는 중…"));
  ticker(t).then((p) => {
    if (cur !== t || tab !== "news") return;
    const n = p.news && p.news.articles || [], f = p.filings && p.filings.rows || [];
    body.replaceChildren(
      n.length ? h("div", { class: "news" }, n.map((x) => h("a", { href: safeUrl(x.url), target: "_blank", rel: "noopener noreferrer", class: x.risk ? "risk" : "" }, x.title, h("small", {}, `${x.source} · ${(x.at || "").slice(0, 10)}`)))) : h("p", { class: "note" }, "최근 뉴스가 없습니다."),
      f.length ? h("details", { class: "more" }, h("summary", {}, `최근 공시 ${f.length}건`), ...f.map((r) => h("div", { class: "note" }, h("a", { href: safeUrl(r.url), target: "_blank", rel: "noopener noreferrer" }, `${r.form} · ${r.date}`)))) : null,
      p.events && p.events.length ? h("details", { class: "more" }, h("summary", {}, "규칙으로 잡은 신호"), h("ul", {}, p.events.map(([, cat, txt]) => h("li", {}, h("b", {}, cat), " · ", txt)))) : null,
      h("p", { class: "note" }, "빨간 제목은 키워드 규칙이 리스크로 본 기사입니다. 제목만 보고 판단하지 말고 원문을 확인하세요."));
  }).catch((x) => { if (x.code === 401) return onLogin(); body.replaceChildren(h("p", { class: "err" }, x.message)); });
}

function proTab(body, t) {
  body.replaceChildren(spinner("전문가 의견을 불러오는 중…"));
  (ex[t] && Date.now() - ex[t].at < 1800000 ? Promise.resolve(ex[t].v) : api("/api/experts?t=" + encodeURIComponent(t)).then((v) => (ex[t] = { at: Date.now(), v }, v))).then((v) => {
    if (cur !== t || tab !== "pro") return;
    const a = v.analyst[0], p = v.analyst[1];
    const sum = a ? `매수 ${a.sb + a.b} · 중립 ${a.h} · 매도 ${a.s + a.ss}` : "";
    const trend = a && p ? (() => { const s = (x) => (2 * x.sb + x.b - x.s - 2 * x.ss) / Math.max(1, x.sb + x.b + x.h + x.s + x.ss); const d = s(a) - s(p); return Math.abs(d) < 0.05 ? "전월과 비슷" : d > 0 ? "전월 대비 우호적으로 이동" : "전월 대비 보수적으로 이동"; })() : "";
    body.replaceChildren(
      h("div", { class: "card pad" }, a ? h("p", {}, h("b", {}, `애널리스트 ${a.period}`), h("span", { class: "note" }, `  ${sum}${trend ? " · " + trend : ""}`)) : h("p", { class: "note" }, "애널리스트 데이터 없음"),
        a ? h("div", { class: "sbar" }, h("i", { class: "p", style: `width:${((a.sb + a.b) / Math.max(1, a.sb + a.b + a.h + a.s + a.ss)) * 100}%` }), h("i", { class: "n", style: `width:${((a.s + a.ss) / Math.max(1, a.sb + a.b + a.h + a.s + a.ss)) * 100}%` })) : null),
      h("div", { class: "card pad" }, h("p", { class: "note" }, "최근 4개월 내부자 공개시장 거래 (Form 4)"),
        v.insiders.length ? v.insiders.map((x) => h("p", { class: "note" }, `${x.filed || x.date} · ${x.code === "P" ? "매수" : "매도"} ${x.shares.toLocaleString("en-US")}주${x.price ? ` @ $${x.price}` : ""} · ${x.name}`)) : h("p", { class: "note" }, "공개시장 매수·매도 없음")),
      v.errors.length ? h("p", { class: "note" }, "일부 불러오지 못함: " + v.errors.join(" / ")) : null,
      h("p", { class: "note" }, "큰손(13F) 보유는 탐색 탭의 '큰손'에서 봅니다. 애널리스트 의견도 틀립니다."));
  }).catch((x) => { if (x.code === 401) return onLogin(); body.replaceChildren(h("p", { class: "err" }, x.message)); });
}

function memoTab(body, t) {
  const held = store.hold.find((x) => x.t === t);
  const toggle = h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: !!held, onchange: (e) => { if (e.target.checked) { if (!store.hold.some((x) => x.t === t)) store.hold.push({ t, memo: "" }); } else if (confirm(`${t}의 보유 표시와 메모를 지울까요?`)) store.hold = store.hold.filter((x) => x.t !== t); else { e.target.checked = true; return; } store.saveHold(); drawTab(body); } }), " 보유 중으로 표시");
  const entry = store.hold.find((x) => x.t === t);
  const memo = h("textarea", { rows: "3", maxlength: "400", disabled: !entry, placeholder: entry ? "왜 들고 있나요? 무엇이 달라지면 다시 판단하나요? (금액·계좌 정보는 적지 마세요)" : "보유 중으로 표시하면 메모를 쓸 수 있습니다", "aria-label": t + " 메모" }, entry ? entry.memo || "" : "");
  let timer = null;
  memo.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { if (entry) { entry.memo = memo.value.slice(0, 400); store.saveHold(); } }, 700); });
  const aiBox = h("div", {}), aiBtn = h("button", { type: "button", class: "primary", onclick: async () => {
    aiBtn.disabled = true; aiBox.replaceChildren(spinner("AI가 자료를 읽는 중… (10~20초)"));
    try { const o = await api("/api/ai?t=" + encodeURIComponent(t), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memo: entry ? entry.memo || "" : "" }) }); aiCache[t] = { at: Date.now(), o }; showAI(aiBox, o); }
    catch (x) { if (x.code === 401) return onLogin(); aiBox.replaceChildren(h("p", { class: "err" }, x.message)); }
    finally { aiBtn.disabled = false; }
  } }, "AI로 점검하기");
  if (aiCache[t] && Date.now() - aiCache[t].at < 1800000) showAI(aiBox, aiCache[t].o);
  body.replaceChildren(toggle, memo, h("div", { style: "height:10px" }), aiBtn, aiBox,
    copyPromptBox("API 대신 Gemini 앱에 붙여넣을 요약 만들기", () => api("/api/ai?t=" + encodeURIComponent(t), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memo: entry ? entry.memo || "" : "", mode: "prompt" }) }), () => onLogin()),
    h("p", { class: "foot" }, h("button", { class: "ghost", onclick: () => { if (confirm(`${t}을(를) 관심종목에서 뺄까요?`)) { store.watch = store.watch.filter((x) => x !== t); store.hold = store.hold.filter((x) => x.t !== t); store.save(); store.saveHold(); cur = store.watch[0] || null; render(); } } }, "관심종목에서 빼기")),
    h("p", { class: "note" }, "메모는 이 앱 서버에 저장되고 AI 점검 때 AI에게 전달됩니다."));
}
function showAI(box, o) {
  const ul = (a) => (a && a.length ? h("ul", { class: "ai-list" }, a.map((x) => h("li", {}, x))) : null);
  box.replaceChildren(h("div", { class: "ai-op" },
    h("p", {}, h("b", {}, `전망 점검: ${o.stance}`), h("span", { class: "note" }, `  확신 ${o.confidence}% · ${o.model} · ${fmtTime(o.at)}`)), h("p", {}, o.summary),
    o.bull.length ? h("p", { class: "note" }, "긍정 근거") : null, ul(o.bull), o.bear.length ? h("p", { class: "note" }, "위험 요인") : null, ul(o.bear),
    o.invalidate ? h("p", { class: "note" }, "이 전망이 틀렸다고 볼 조건: " + o.invalidate) : null, o.watch.length ? h("p", { class: "note" }, "확인할 것") : null, ul(o.watch),
    h("p", { class: "note" }, "참고용 점검이며 투자 조언이 아닙니다. 틀릴 수 있고, 판단과 주문은 직접 하세요.")));
}
