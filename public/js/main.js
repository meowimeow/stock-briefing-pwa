import { sessionOf, setHolidays, nextClosure } from "./live.js";
import { h, api, sync, ensureFx } from "./core.js";
import { todayTab } from "./today.js";
import { stocksTab } from "./stocks.js";
import { worldTab } from "./world.js";
import { exploreTab } from "./explore.js";
import { nav as navBus } from "./ui.js";

const $app = document.getElementById("app");
const mods = [todayTab, stocksTab, worldTab, exploreTab];
const TABS = mods.map((m) => ({ short: m.label }));
let current = 0;

function showLogin(msg) {
  const pw = h("input", { type: "password", placeholder: "비밀번호", autocomplete: "current-password", "aria-label": "비밀번호", autofocus: true });
  const err = h("div", { class: "err", role: "alert" }, msg || "");
  const btn = h("button", { class: "primary", type: "submit" }, "열기");
  document.body.classList.remove("in");
  $app.replaceChildren(h("div", { class: "login" },
    h("div", {}, h("h1", {}, "브리핑"), h("p", { class: "sub" }, "개인용 앱입니다. 비밀번호를 입력하세요.")),
    h("form", { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; err.textContent = "";
      try { await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw.value }) }); start(); }
      catch (x) { err.textContent = x.code === 401 ? "비밀번호가 맞지 않습니다." : x.message; btn.disabled = false; }
    } }, pw, btn, err)));
}

let nav, mktTimer = null;
function shell() {
  document.body.classList.add("in");
  const view = h("div", { id: "view" });
  const mkt = h("div", { class: "mkt-sess" }), drawMkt = () => {
    const s = sessionOf(), hm = s.left == null ? "" : ` · 끝까지 ${Math.floor(s.left / 60) ? Math.floor(s.left / 60) + "시간 " : ""}${s.left % 60}분`;
    mkt.className = "mkt-sess s-" + s.id;
    const c = nextClosure(), off = c && `${c.dday ? `${Number(c.date.slice(5, 7))}/${Number(c.date.slice(8))}(${c.day})` : "오늘"} ${c.closed ? "휴장" : "조기 폐장"}${c.name ? ` · ${c.name}` : ""}${c.dday ? ` D-${c.dday}` : ""}`;
    mkt.replaceChildren(h("span", {}, `미국 ${s.label}${hm}`), off ? h("span", { class: "mkt-off" }, off) : "");
  };
  drawMkt(); clearInterval(mktTimer); mktTimer = setInterval(drawMkt, 30000);
  api("/api/holidays").then((r) => { setHolidays(r.days); drawMkt(); }).catch(() => {});
  nav = h("nav", { class: "tabs", "aria-label": "메뉴" }, TABS.map((t, i) => h("button", { class: i === current ? "on" : "", onclick: () => go(i) }, t.short)));
  $app.replaceChildren(mkt, view);
  document.querySelector("nav.tabs")?.remove();
  document.body.append(nav);
}

async function go(i) {
  current = i;
  nav.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", j === i));
  const view = document.getElementById("view");
  view.replaceChildren();
  window.scrollTo(0, 0);
  try { localStorage.setItem("tab", String(i)); } catch {}
  try { await Promise.race([ensureFx(), new Promise((r) => setTimeout(r, 1500))]); } catch {}
  if (i !== current) return;
  // 탭마다 새 상자를 준다. 다른 탭으로 가면 상자가 떨어져 나가서(isConnected=false) 늦게 온 갱신이 화면을 덮지 않는다.
  const pane = document.createElement("div");
  view.replaceChildren(pane);
  mods[i].show(pane);
}
navBus.go = (id) => { const i = mods.findIndex((m) => m.id === id); if (i >= 0) go(i); };

async function start() {
  try { await api("/api/me"); }
  catch (x) { if (x.code === 401) return showLogin(); return showLogin(x.message); }
  try { await sync.pull(); } catch (x) { if (x.code === 401) return showLogin(); }
  document.querySelector("nav.tabs")?.remove();
  let i = 0; try { i = Number(localStorage.getItem("tab")) || 0; } catch {}
  current = i >= 0 && i < mods.length ? i : 0;
  shell(); go(current);
}

const toLogin = () => { document.querySelector("nav.tabs")?.remove(); showLogin(); };
mods.forEach((m) => m.setLogin(toLogin));
import("./company.js").then((c) => c.companyTab.setLogin(toLogin));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
start();
