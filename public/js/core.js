// 공통 도우미. 서버에서 온 글자는 항상 textContent로 넣어서 화면에 코드가 섞여 들어오지 못하게 한다.
export const DEFAULT_TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"];

export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// replaceChildren에 null/false를 넘기면 'null' 글자가 화면에 찍힌다. 비어 있는 값은 걸러서 넣는다.
const _rc = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...k) { return _rc.apply(this, k.flat(Infinity).filter((x) => x != null && x !== false)); };

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

export const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
export const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- 달러 → 원 환산 (앱 전체 공통). 환율은 5분 단위로 갱신, 못 가져오면 마지막 값 ----
const fxSaved = LS.get("fx:usdkrw", null);
export const fxState = { rate: fxSaved && fxSaved.rate > 0 ? fxSaved.rate : null, at: fxSaved ? fxSaved.at : null, source: fxSaved ? fxSaved.source : "", checked: 0 };
export function krwFmt(n) {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e12) return `${s}₩${(a / 1e12).toFixed(2)}조`;
  if (a >= 1e8) return `${s}₩${(a / 1e8).toFixed(1)}억`;
  return `${s}₩${Math.round(a).toLocaleString("ko-KR")}`;
}
export const won = (usd) => (fxState.rate && usd != null && isFinite(usd) ? krwFmt(usd * fxState.rate) : "");
export const withWon = (text, usd) => { const w = won(usd); return w ? `${text} (${w})` : text; };
export async function ensureFx(force) {
  if (!force && fxState.rate && Date.now() - fxState.checked < 300000) return;
  fxState.checked = Date.now();
  try {
    const r = await api("/api/usdkrw");
    if (r && r.rate > 0) { Object.assign(fxState, { rate: r.rate, at: r.at, source: r.source }); LS.set("fx:usdkrw", { rate: r.rate, at: r.at, source: r.source }); }
  } catch (x) { if (x.code === 401) throw x; }
}
export const fxNote = () => h("p", { class: "note" }, fxState.rate ? `원화는 1달러 = ${fxState.rate.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}원 기준 환산(${fxState.source}, ${fmtTime(fxState.at)} 확인). 실제 증권사 환율·환전 수수료와 다릅니다.` : "환율을 가져오지 못해 원화 환산을 생략했습니다.");
export const signed = (n, d = 1) => (n >= 0 ? "+" : "") + Number(n).toFixed(d) + "%";
export const pct = (x, d = 0) => (x == null || x !== x ? "-" : (x * 100).toFixed(d) + "%");
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "");

export async function api(path, opts) {
  const r = await fetch(path, { credentials: "same-origin", ...opts });
  let body = null;
  try { body = await r.json(); } catch {}
  if (r.status === 401) { const e = new Error("login"); e.code = 401; throw e; }
  if (!r.ok) throw new Error((body && body.error) || `HTTP ${r.status}`);
  return body;
}

// 관심종목은 모든 화면이 같이 쓴다.
export const store = {
  watch: LS.get("watch", DEFAULT_TICKERS),
  save() { LS.set("watch", this.watch); sync.touch(); },
  // 내가 실제로 투자 중인 종목(티커 + 짧은 메모). 수량·평단·금액은 저장하지 않는다.
  hold: LS.get("hold", []),
  saveHold() { LS.set("hold", this.hold); sync.touch(); },
};

// 관심종목·키워드·메모를 서버에 맞춰 둔다. 서버 저장소가 없거나 실패하면 조용히 이 기기에만 저장한다.
let syncOff = false, timer = null;
const localNotes = () => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("notes:")) o[k.slice(6)] = JSON.parse(localStorage.getItem(k)); } } catch {} return o; };
export const backup = {
  data: () => ({ app: "phone-briefing", v: 1, at: new Date().toISOString(), watch: store.watch, kw: LS.get("kw", ""), notes: localNotes(), hold: store.hold }),
  // 파일 내용을 검사한 뒤에만 덮어쓴다. 형식이 맞지 않으면 아무것도 바꾸지 않고 오류를 던진다.
  restore(o) {
    if (!o || o.app !== "phone-briefing" || o.v !== 1) throw new Error("이 앱의 백업 파일이 아닙니다.");
    if (!Array.isArray(o.watch) || o.watch.length > 40 || !o.watch.every((x) => typeof x === "string" && /^[A-Z0-9.\-]{1,10}$/.test(x))) throw new Error("관심종목 형식이 올바르지 않습니다.");
    const hold = Array.isArray(o.hold) ? o.hold : [];
    if (hold.length > 20 || !hold.every((x) => x && /^[A-Z0-9.\-]{1,10}$/.test(x.t || ""))) throw new Error("내 종목 형식이 올바르지 않습니다.");
    store.watch.length = 0; store.watch.push(...o.watch); LS.set("watch", store.watch);
    LS.set("kw", typeof o.kw === "string" ? o.kw.slice(0, 600) : "");
    for (const [t, arr] of Object.entries(o.notes && typeof o.notes === "object" ? o.notes : {})) if (/^[A-Z0-9.\-]{1,10}$/.test(t)) LS.set("notes:" + t, arr);
    store.hold.length = 0; store.hold.push(...hold.map((x) => ({ t: x.t, memo: String(x.memo || "").slice(0, 400) }))); LS.set("hold", store.hold);
    LS.set("syncAt", Date.now()); pushNow();
  },
};
const pushNow = async () => {
  if (syncOff) return;
  try { await api("/api/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ at: LS.get("syncAt", Date.now()), watch: store.watch, kw: LS.get("kw", ""), notes: localNotes(), hold: store.hold }) }); }
  catch (x) { if (x.message && /서버 저장소/.test(x.message)) syncOff = true; }
};
export const sync = {
  touch() { LS.set("syncAt", Date.now()); clearTimeout(timer); timer = setTimeout(pushNow, 1200); },
  async pull() {
    try {
      const srv = await Promise.race([api("/api/sync"), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000))]);
      const localAt = LS.get("syncAt", 0);
      if (!srv) { if (localAt) await pushNow(); return; }
      if (srv.at > localAt) {
        store.watch.length = 0; store.watch.push(...srv.watch); LS.set("watch", store.watch);
        if (srv.kw) LS.set("kw", srv.kw);
        for (const [t, arr] of Object.entries(srv.notes || {})) LS.set("notes:" + t, arr);
        if (Array.isArray(srv.hold)) { store.hold.length = 0; store.hold.push(...srv.hold); LS.set("hold", store.hold); }
        LS.set("syncAt", srv.at);
      } else if (localAt > srv.at) await pushNow();
    } catch (x) { if (x.code === 401) throw x; if (/서버 저장소/.test(x.message || "")) syncOff = true; }
  },
};

export function limitsBox(items) {
  return h("details", { class: "limits" }, h("summary", {}, "이 분석의 한계 (참고용)"), h("ul", {}, items.map((t) => h("li", {}, t))));
}

// 종목 고르기 (칩). allowAll이면 맨 앞에 '전체 합산'.
export function picker(key, onChange, { allowAll = false } = {}) {
  const opts = (allowAll ? ["ALL"] : []).concat(store.watch);
  let cur = LS.get("pick:" + key, opts[0]);
  if (!opts.includes(cur) && cur !== "ALL") cur = opts[0];
  const row = h("div", { class: "chips pick" });
  const draw = () => {
    row.replaceChildren(...opts.map((t) => h("button", { class: "tab-chip" + (t === cur ? " on" : ""), onclick: () => { cur = t; LS.set("pick:" + key, t); draw(); onChange(t); } }, t === "ALL" ? "전체 합산" : t)));
  };
  draw();
  return { el: row, get value() { return cur; } };
}

export function bar(pos, neg, total) {
  const w = (x) => (total ? (x / total) * 100 : 0);
  return h("div", { class: "sbar", "aria-hidden": "true" }, h("i", { class: "p", style: `width:${w(pos)}%` }), h("i", { class: "n", style: `width:${w(neg)}%` }));
}

export function spinner(text) { return h("p", { class: "note" }, text || "불러오는 중…"); }

// API 없이 Gemini 앱에서 쓰는 방법: 프롬프트+자료를 만들어 보여주고 복사하게 한다. (iOS는 비동기 뒤 자동 복사가 막힐 수 있어 복사 버튼을 따로 둔다)
export function copyPromptBox(label, fetchPrompt, onLogin) {
  const box = h("div", {});
  const btn = h("button", { type: "button", class: "ghost", onclick: async () => {
    btn.disabled = true; box.replaceChildren(spinner("자료를 모으는 중…"));
    try {
      const { prompt } = await fetchPrompt();
      const ta = h("textarea", { rows: "8", readonly: "true", "aria-label": "Gemini 앱에 붙여넣을 요약" }, prompt);
      const done = h("span", { class: "note" });
      const copy = h("button", { type: "button", class: "primary", onclick: async () => {
        try { await navigator.clipboard.writeText(prompt); done.textContent = " 복사했습니다. Gemini 앱에 붙여넣으세요."; }
        catch { ta.focus(); ta.select(); try { document.execCommand("copy"); done.textContent = " 복사했습니다. Gemini 앱에 붙여넣으세요."; } catch { done.textContent = " 자동 복사가 막혔습니다. 위 글을 길게 눌러 전체 선택 후 복사하세요."; } }
      } }, "복사");
      box.replaceChildren(ta, h("div", { style: "margin-top:8px" }, copy, done),
        h("p", { class: "note" }, "Gemini 앱에서 Gemini 4 Argon을 고른 뒤 붙여넣으면 됩니다. 앱이 모은 자료만 담겨 있고, 답변은 참고용이며 투자 조언이 아닙니다."));
    } catch (x) { if (x.code === 401) return onLogin && onLogin(); box.replaceChildren(h("p", { class: "err" }, x.message)); }
    finally { btn.disabled = false; }
  } }, label);
  return h("div", {}, btn, box);
}
