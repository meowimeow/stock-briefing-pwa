import { h } from "./core.js";

// 아래에서 올라오는 시트. Esc·바깥 터치·닫기 버튼으로 닫는다.
let openSheet = null;
export function sheet(title, content, onClose) {
  if (openSheet) openSheet.close();
  const prevFocus = document.activeElement;
  const body = h("div", { class: "sheet-body" }, typeof content === "function" ? content() : content);
  const bg = h("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } });
  const box = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "sheet-h" }, h("b", {}, title), h("button", { type: "button", class: "ghost", "aria-label": "닫기", onclick: () => close() }, "닫기")), body);
  bg.append(box);
  const key = (e) => { if (e.key === "Escape") close(); };
  function close() { document.removeEventListener("keydown", key); document.body.classList.remove("noscroll"); bg.remove(); openSheet = null; try { onClose && onClose(); } catch {} try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch {} }
  document.addEventListener("keydown", key);
  document.body.classList.add("noscroll");
  document.body.append(bg);
  openSheet = { close };
  box.querySelector("button").focus();
  return { close, body };
}
export const closeSheet = () => openSheet && openSheet.close();

// 가로 선택 버튼 (탭 전환)
export function seg(options, cur, onChange) {
  const row = h("div", { class: "seg", role: "tablist" });
  const draw = () => row.replaceChildren(...options.map(([v, l]) => h("button", { type: "button", role: "tab", "aria-selected": String(v === cur), class: v === cur ? "on" : "", onclick: () => { cur = v; draw(); onChange(v); } }, l)));
  draw();
  return row;
}

export const bar2 = (pos, neg) => { const t = pos + neg || 1; return h("div", { class: "sbar", "aria-hidden": "true" }, h("i", { class: "p", style: `width:${(pos / t) * 100}%` }), h("i", { class: "n", style: `width:${(neg / t) * 100}%` })); };

// 탭 사이 이동 (main.js가 채운다)
export const nav = { go: () => {} };
export const KEY_STOCK = "pick:stock";

export const kstFmt = (iso) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const crow = (tag, soon, title, when) => h("div", { class: "crow" }, h("span", { class: "up-tag" + (soon ? " soon" : "") }, tag), h("b", {}, title), h("small", { class: "note" }, when));
