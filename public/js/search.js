import { h, api } from "./core.js";

// 회사명이나 티커 일부를 치면 후보를 보여준다. 후보를 고르거나, 티커를 그대로 쳐서 확인을 눌러도 된다.
export function searchBox({ placeholder, button, onPick, onLogin }) {
  const input = h("input", { placeholder, autocapitalize: "none", autocomplete: "off", maxlength: "40", "aria-label": placeholder });
  const list = h("div", { class: "sugg" });
  let timer = null, seq = 0;
  const pick = (sym) => { input.value = ""; list.replaceChildren(); onPick(sym); };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { list.replaceChildren(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const r = await api("/api/search?q=" + encodeURIComponent(q));
        if (my !== seq) return;
        list.replaceChildren(...r.rows.map((x) => h("button", { type: "button", class: "sugg-row", onclick: () => pick(x.symbol) }, h("b", {}, x.symbol), h("span", { class: "note" }, x.name))));
      } catch (e) { if (e.code === 401 && onLogin) onLogin(); else list.replaceChildren(); }
    }, 350);
  });
  return h("div", {}, h("form", { class: "add", onsubmit: (e) => {
    e.preventDefault();
    const q = input.value.trim().toUpperCase();
    if (/^[A-Z0-9.\-]{1,10}$/.test(q)) pick(q); else if (list.firstChild) list.firstChild.click();
  } }, input, h("button", { type: "submit" }, button)), list);
}
