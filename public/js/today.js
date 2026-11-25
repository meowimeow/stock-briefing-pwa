import { h, LS, api, store, signed, money, won, fxState, ensureFx, fmtTime, limitsBox, fxNote, backup, copyPromptBox, spinner } from "./core.js";
import { searchBox } from "./search.js";
import { sheet, nav, KEY_STOCK, crow, kstFmt } from "./ui.js";
import { quickLight, lightOf, dotCls, getLights, digest as lightDigest, warnPanel } from "./lights.js";
import { macroSoon, macroRow, earnRow, dDay, earnKst } from "./upcoming.js";
import { subscribe, onLiveStatus, liveOk, regular, flash } from "./live.js";

// 오늘: 한 화면에 시장·먼저 볼 것·내 종목·이번 주 일정을 모은다.
let root = null, onLogin = () => {}, timer = null, liveOff = null, statusOff = null;
const S = { q: {}, earn: {}, macro: null, at: 0, errs: [] };
const MKT = ["SPY", "QQQ"];
const RANK = { red: 2, yellow: 1, green: 0 };

export const todayTab = {
  id: "today", label: "오늘",
  setLogin(fn) { onLogin = fn; },
  async show(el) {
    root = el; clearInterval(timer); render(); load(); listen();
    timer = setInterval(() => {
      if (!root || !root.isConnected) { clearInterval(timer); return unlisten(); }
      // 정규장에 실시간이 붙어 있으면 1분 갱신은 건너뛴다.
      if (!document.hidden && !(liveOk() && regular(Date.now()))) loadQuotes();
    }, 60000);
  },
};

export const tileTickers = () => { const hold = store.hold.map((x) => x.t), rest = store.watch.filter((t) => !hold.includes(t)); return [...hold, ...rest].slice(0, 12); };

// 시장·내 종목 타일 가격을 정규장 체결로 바로 고친다 (화면 전체를 다시 그리지 않고 숫자만).
function unlisten() { if (liveOff) liveOff(); if (statusOff) statusOff(); liveOff = statusOff = null; }
function listen() {
  unlisten();
  liveOff = subscribe([...MKT, ...tileTickers()], (m) => {
    if (!root || !root.isConnected) return unlisten();
    const q = S.q[m.t];
    if (!q || !regular(m.ts) || m.p === q.price) return;
    if (q.base == null) q.base = q.pct != null ? q.price / (1 + q.pct / 100) : null;
    const rose = m.p > q.price;
    const sub = root.querySelector(".top .sub"); if (sub && sub.textContent !== "시세 실시간") sub.textContent = "시세 실시간";
    q.price = m.p; if (q.base) q.pct = (m.p / q.base - 1) * 100;
    for (const box of root.querySelectorAll(`[data-q="${m.t}"]`)) {
      const px = box.querySelector(".px"), pc = box.querySelector(".pc");
      px.textContent = money(q.price);
      if (pc && q.pct != null) { pc.textContent = (box.classList.contains("mk") ? " " : "") + signed(q.pct, 1); pc.className = "pc num " + pctCls(q.pct); }
      flash(px, rose);
    }
  });
  statusOff = onLiveStatus(() => render());
}

async function loadQuotes() {
  const list = [...MKT, ...tileTickers()].slice(0, 15);
  try { const r = await api("/api/quotes?t=" + list.join(",")); for (const x of r.rows) if (!x.error) S.q[x.t] = x; S.at = Date.now(); ensureFx().catch(() => {}); render(); }
  catch (x) { if (x.code === 401) return onLogin(); S.errs.push("시세: " + x.message); render(); }
}
async function load() {
  S.errs = [];
  loadQuotes();
  const ts = tileTickers();
  // 경고등(가벼운 점검) · 실적 일정은 3개씩 나눠 받는다
  const q1 = [...ts], q2 = [...ts];
  const run1 = async () => { while (q1.length) { const t = q1.shift(); try { await quickLight(t); } catch (x) { if (x.code === 401) { q1.length = 0; return onLogin(); } } render(); } };
  const run2 = async () => { while (q2.length) { const t = q2.shift(); if (S.earn[t] && Date.now() - S.earn[t].at < 1800000) continue; try { S.earn[t] = { at: Date.now(), v: await api("/api/earn?t=" + encodeURIComponent(t)) }; } catch (x) { if (x.code === 401) { q2.length = 0; return onLogin(); } S.earn[t] = { at: Date.now(), err: x.message }; } render(); } };
  macroSoon(7).then((m) => { S.macro = m || []; render(); }).catch((x) => { if (x.code === 401) onLogin(); });
  await Promise.all([run1(), run1(), run2(), run2()]);
}

const pctCls = (p) => (p == null ? "" : p >= 0 ? "up" : "down");
function mktTile(label, t) {
  const q = S.q[t];
  return h("div", { class: "mk", "data-q": t }, h("small", {}, label), h("b", { class: "num" }, h("span", { class: "px" }, q ? money(q.price) : "–"), h("small", { class: "pc num " + pctCls(q && q.pct) }, q && q.pct != null ? " " + signed(q.pct, 1) : "")));
}

// 먼저 볼 것: 경고등이 켜진 종목, 임박한 실적, 곧 나올 경제지표를 우선순위로 3줄만
function focusLines() {
  const out = [];
  for (const t of tileTickers()) {
    const o = lightOf(t); if (!o) continue;
    for (const l of o.lights) if (l.level !== "green") out.push({ k: RANK[l.level] * 10 + (store.hold.some((x) => x.t === t) ? 3 : 0), t, level: l.level, text: `${l.label} — ${l.text}` });
  }
  out.sort((a, b) => b.k - a.k);
  const seen = new Set(), pick = [];
  for (const x of out) { if (seen.has(x.t)) continue; seen.add(x.t); pick.push(x); if (pick.length >= 3) break; }
  return pick;
}

function schedule() {
  const rows = [];
  for (const t of tileTickers()) { const e = S.earn[t] && S.earn[t].v; if (e && e.date) { const n = dDay(e.date); if (n >= 0 && n <= 7) { const k = earnKst(e); rows.push({ at: k.at, node: crow("실적", n <= 3, t, `${k.short} · ${n === 0 ? "오늘" : "D-" + n}`) }); } } }
  for (const m of S.macro || []) rows.push({ at: Date.parse(m.nextReleaseUtc), node: crow("지표", (Date.parse(m.nextReleaseUtc) - Date.now()) / 3600e3 <= 48, m.label.replace(/\s*\(.*$/, ""), kstFmt(m.nextReleaseUtc)) });
  rows.sort((a, b) => a.at - b.at);
  return rows;
}

function render() {
  if (!root || !root.isConnected) return;
  const ts = tileTickers(), focus = focusLines(), sch = schedule();
  const fx = fxState.rate;
  root.replaceChildren(
    h("div", { class: "top" }, h("div", {}, h("h1", {}, "오늘"), h("p", { class: "sub" }, S.at ? liveOk() && regular(Date.now()) ? "시세 실시간" : `${fmtTime(new Date(S.at).toISOString())} 기준 · 시세 1분마다 갱신` : "불러오는 중…")),
      h("div", { class: "top-r" }, h("button", { class: "ghost", onclick: () => aiSheet(), "aria-label": "AI 점검" }, "AI"), h("button", { class: "ghost", onclick: () => settings(), "aria-label": "설정" }, "⚙"))),
    h("div", { class: "mkt" }, mktTile("S&P500", "SPY"), mktTile("나스닥100", "QQQ"),
      h("div", { class: "mk" }, h("small", {}, "원/달러"), h("b", { class: "num" }, fx ? fx.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "–"))),
    h("div", { class: "sec-h" }, "먼저 볼 것"),
    h("div", { class: "focus" }, focus.length ? focus.map((f) => h("button", { type: "button", class: "fx-row", onclick: () => open(f.t) }, h("span", { class: dotCls(f.level) }), h("b", {}, f.t), h("span", { class: "tx" }, f.text)))
      : h("p", { class: "note" }, ts.every((t) => lightOf(t)) ? "눈에 띄는 경고가 없습니다. 조용한 날일 수 있습니다." : "경고등 점검 중…")),
    h("div", { class: "sec-h" }, "내 종목", h("small", {}, " 눌러서 차트 보기")),
    h("div", { class: "tiles" }, ts.map((t) => tile(t)), h("button", { type: "button", class: "tile add", onclick: () => settings(), "aria-label": "종목 추가" }, "+")),
    h("div", { class: "sec-h" }, "이번 주 일정"),
    h("div", { class: "sch" }, sch.length ? sch.slice(0, 4).map((r) => r.node) : h("p", { class: "note" }, S.macro == null ? "일정 확인 중…" : "7일 안에 잡힌 실적·경제지표가 없습니다.")),
    S.errs.length ? h("p", { class: "err" }, S.errs.slice(0, 2).join(" / ")) : null);
}

function tile(t) {
  const q = S.q[t], o = lightOf(t), held = store.hold.some((x) => x.t === t), e = S.earn[t] && S.earn[t].v, d = e && e.date ? dDay(e.date) : null;
  return h("button", { type: "button", class: "tile" + (held ? " held" : ""), onclick: () => open(t), "aria-label": `${t} ${q ? money(q.price) : ""}` },
    h("div", { class: "t1" }, o ? h("span", { class: dotCls(o.level), "aria-label": "경고등" }) : h("span", { class: "lt lt-none" }), h("b", {}, t), d != null && d >= 0 && d <= 3 ? h("small", { class: "t4" }, `D-${d}`) : null),
    h("div", { class: "t2 num", "data-q": t }, h("span", { class: "px" }, q ? money(q.price) : "…"), h("span", { class: "pc num " + pctCls(q && q.pct) }, q && q.pct != null ? signed(q.pct, 1) : "")));
}

function open(t) { LS.set(KEY_STOCK, t); nav.go("stocks"); }

// AI 시트: 오늘 브리핑 + 위험 종합 점검
function aiSheet() {
  const brief = h("div", {}), warn = warnPanel(() => onLogin(), () => {});
  const ts = tileTickers();
  const digest = () => ts.map((t) => { const q = S.q[t], o = lightOf(t), e = S.earn[t] && S.earn[t].v; return `${t}: ${q ? `현재가 ${q.price}, 등락 ${q.pct == null ? "-" : q.pct.toFixed(1) + "%"}` : "시세 없음"}; 경고: ${o ? (o.lights.filter((x) => x.level !== "green").map((x) => `${x.label} ${x.text}`).join(" / ") || "없음") : "점검 전"}; 다음 실적: ${e && e.date ? e.date : "미확정"}`; }).join("\n");
  const ul = (a) => (a && a.length ? h("ul", { class: "ai-list" }, a.map((x) => h("li", {}, x))) : null);
  const saved = LS.get("aibrief", null);
  const show = (o) => brief.replaceChildren(h("div", { class: "ai-op" }, h("p", {}, h("b", {}, o.headline), h("span", { class: "note" }, `  ${o.model} · ${fmtTime(o.at)}`)),
    ...o.items.map((x) => h("p", {}, h("span", { class: "up-tag" + (x.level === "주의" ? " soon" : "") }, x.level), " ", h("b", {}, x.t), " ", x.note)),
    o.today.length ? h("p", { class: "note" }, "오늘 확인할 것") : null, ul(o.today), o.caveat ? h("p", { class: "note" }, o.caveat) : null, h("p", { class: "note" }, "참고용이며 투자 조언이 아닙니다.")));
  if (saved && Date.now() - Date.parse(saved.o.at) < 3 * 3600e3) show(saved.o);
  const btn = h("button", { type: "button", class: "primary", onclick: async () => {
    btn.disabled = true; brief.replaceChildren(spinner("AI가 정리하는 중… (10~20초)"));
    try { const o = await api("/api/aibrief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ digest: digest() }) }); LS.set("aibrief", { o }); show(o); }
    catch (x) { if (x.code === 401) return onLogin(); brief.replaceChildren(h("p", { class: "err" }, x.message)); }
    finally { btn.disabled = false; }
  } }, "AI로 오늘 브리핑");
  sheet("AI 점검", h("div", {}, btn, brief,
    copyPromptBox("API 대신 Gemini 앱에 붙여넣을 브리핑 만들기", () => api("/api/aibrief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ digest: digest(), mode: "prompt" }) }), () => onLogin()),
    h("div", { class: "sec-h" }, "위험·포지션 경고등 (내 종목 전체)"), warn));
}

// 설정 시트: 관심종목 편집, 보유 표시, 백업, 잠그기
function settings() {
  const body = h("div", {});
  const draw = () => body.replaceChildren(
    h("div", { class: "sec-h" }, "관심종목", h("small", {}, " ★ 눌러 보유 표시")),
    h("div", { class: "chips" }, store.watch.map((t) => h("span", { class: "chip" }, h("button", { type: "button", "aria-label": `${t} 보유 표시 ${store.hold.some((x) => x.t === t) ? "해제" : ""}`, class: "star" + (store.hold.some((x) => x.t === t) ? " on" : ""), onclick: () => { if (store.hold.some((x) => x.t === t)) store.hold = store.hold.filter((x) => x.t !== t); else store.hold.push({ t, memo: "" }); store.saveHold(); draw(); } }, "★"), t,
      h("button", { "aria-label": t + " 삭제", onclick: () => { store.watch = store.watch.filter((x) => x !== t); store.save(); draw(); } }, "×")))),
    searchBox({ placeholder: "회사명 또는 티커로 추가", button: "추가", onLogin: () => onLogin(), onPick: (t) => { if (!store.watch.includes(t)) { store.watch.push(t); store.save(); draw(); } } }),
    h("p", { class: "note" }, "★ 표시한 종목은 '보유'로 보고 오늘 화면 맨 앞에 둡니다. 수량·평단·손익은 저장하지 않습니다."),
    h("div", { class: "sec-h" }, "백업"),
    h("p", { class: "foot" }, h("button", { class: "ghost", onclick: () => {
      const blob = new Blob([JSON.stringify(backup.data(), null, 1)], { type: "application/json" });
      const a = h("a", { href: URL.createObjectURL(blob), download: `briefing-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } }, "내보내기"), h("button", { class: "ghost", onclick: () => {
      const inp = h("input", { type: "file", accept: "application/json,.json", style: "display:none" });
      inp.onchange = async () => { try { const o = JSON.parse(await inp.files[0].text()); if (!confirm(`이 기기의 관심종목·메모·보유 표시를 백업 파일(${(o.at || "").slice(0, 10)})로 덮어씁니다. 계속할까요?`)) return; backup.restore(o); draw(); load(); } catch (x) { alert("불러오지 못했습니다: " + x.message); } finally { inp.remove(); } };
      document.body.append(inp); inp.click();
    } }, "불러오기")),
    fxNote(),
    limitsBox([
      "무료 데이터라 속보나 완전한 실시간이 아닙니다. 시세는 지연될 수 있고, 차트는 15초마다 현재가를 받아 마지막 봉을 움직입니다.",
      "경고등과 점수는 정해진 규칙으로 계산한 참고용이며 투자 조언이 아닙니다. 주문은 증권사 앱에서 직접 하세요.",
      "AI 답변은 앱이 모은 자료만 읽고, 틀릴 수 있습니다.",
      "메모는 이 앱 서버에 저장됩니다. 계좌번호나 금액은 적지 마세요.",
    ]),
    h("p", { class: "foot" }, h("button", { class: "ghost", onclick: async () => { try { await api("/api/logout", { method: "POST" }); } catch {} onLogin(); } }, "잠그기")));
  draw();
  sheet("설정", body, () => load());
}
