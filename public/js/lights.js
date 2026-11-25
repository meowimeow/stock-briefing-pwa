import { h, api, store, spinner, copyPromptBox, fmtTime } from "./core.js";
import { fetchVerify } from "./verify.js";

// 위험·포지션 경고등. 시세·변동성·낙폭·실적일정·내부자·애널리스트·뉴스는 서버 규칙(/api/lights), 발표 vs 실제 데이터 불일치는 교차 점검 결과를 합친다.
const cache = {}, COL = { red: "빨강", yellow: "노랑", green: "초록" }, RANK = { red: 2, yellow: 1, green: 0 };
export const getLights = (t) => one(t);
export const lightOf = (t) => (cache[t] && cache[t].v ? cache[t].v : null);
export const dotCls = (lv) => "lt lt-" + lv;

// 타일용 가벼운 점검: 서버 규칙(시세·변동성·낙폭·일정·내부자·애널리스트·뉴스)만 쓰고 교차 점검은 생략한다.
const qpend = {};
export async function quickLight(t) {
  const c = cache[t];
  if (c && c.v && Date.now() - c.at < 1800000) return c.v;
  if (qpend[t]) return qpend[t];
  qpend[t] = api("/api/lights?t=" + encodeURIComponent(t)).then((v) => { cache[t] = { at: Date.now(), v, quick: true }; return v; }).finally(() => { delete qpend[t]; });
  return qpend[t];
}

async function one(t) {
  const c = cache[t];
  if (c && !c.quick && Date.now() - c.at < 1800000) return c.v;
  const [l, v] = await Promise.allSettled([api("/api/lights?t=" + encodeURIComponent(t)), fetchVerify(t)]);
  if (l.status === "rejected") throw l.reason;
  const o = { ...l.value, lights: [...l.value.lights] };
  if (v.status === "fulfilled") {
    const bad = v.value.checks.filter((x) => x.status === "불일치"), warn = v.value.checks.filter((x) => x.status === "주의");
    if (bad.length) o.lights.push({ id: "vf", label: "발표 vs 실제 데이터", level: "red", text: bad.map((x) => `${x.title}: ${x.fact}`).join(" / ").slice(0, 220) });
    else if (warn.length >= 2) o.lights.push({ id: "vf", label: "교차 점검 주의", level: "yellow", text: warn.slice(0, 3).map((x) => x.title).join(", ") + ` 등 ${warn.length}건` });
    const s = o.lights.reduce((a, x) => a + (x.level === "red" ? 3 : x.level === "yellow" ? 1 : 0), 0);
    o.score = s; o.level = s >= 3 ? "red" : s >= 1 ? "yellow" : "green";
  }
  cache[t] = { at: Date.now(), v: o };
  return o;
}

// 수량을 저장하지 않으므로 집중도는 '같은 업종 종목 수'로만 본다.
export function concentration(tickers) {
  const g = {};
  for (const t of tickers) { const i = lightOf(t) && lightOf(t).industry; if (i) (g[i] = g[i] || []).push(t); }
  const out = [];
  for (const [ind, arr] of Object.entries(g)) if (arr.length >= 2 && arr.length / Math.max(1, tickers.length) >= 0.4) out.push(`${ind} 업종이 ${tickers.length}종목 중 ${arr.length}개(${arr.join(", ")}) — 같은 재료에 함께 흔들릴 수 있습니다`);
  return out;
}
const earnCluster = (tickers) => { const e = tickers.filter((t) => lightOf(t) && lightOf(t).lights.some((x) => x.id === "earn")); return e.length >= 2 ? [`실적 발표가 임박한 종목이 ${e.length}개(${e.join(", ")}) — 같은 주에 변동이 몰립니다`] : []; };

export function digest(tickers) {
  const lines = tickers.filter(lightOf).map((t) => { const o = lightOf(t); return `${t} (업종: ${o.industry || "미상"}): 종합 ${COL[o.level]}; ` + (o.lights.length ? o.lights.map((x) => `[${COL[x.level]}] ${x.label}: ${x.text}`).join(" / ") : "특별한 경고 없음"); });
  const port = [...concentration(tickers), ...earnCluster(tickers)];
  return lines.join("\n") + (port.length ? "\n포트폴리오 규칙 경고: " + port.join(" | ") : "") + `\n(총 ${tickers.length}종목, 수량·비중 정보 없음)`;
}

let aiRes = null, aiErr = "", aiBusy = false;
export function warnPanel(onLogin, onUpdate) {
  const box = h("div", {}), ai = h("div", {});
  const tickers = () => store.hold.map((x) => x.t);
  const draw = () => {
    const ts = tickers();
    if (!ts.length) { box.replaceChildren(h("p", { class: "note" }, "내 종목을 고르면 경고등이 켜집니다.")); ai.replaceChildren(); return; }
    const rows = ts.map((t) => ({ t, o: lightOf(t), err: cache[t] && cache[t].err })).sort((a, b) => (b.o ? RANK[b.o.level] : -1) - (a.o ? RANK[a.o.level] : -1));
    const port = [...concentration(ts), ...earnCluster(ts)];
    box.replaceChildren(
      port.length ? h("div", { class: "card pad" }, h("p", {}, h("span", { class: dotCls("yellow") }), h("b", {}, " 포트폴리오 경고")), ...port.map((x) => h("p", { class: "note" }, x))) : null,
      h("div", { class: "card" }, rows.map(({ t, o, err }) => h("details", { class: "lt-row" },
        h("summary", {}, o ? h("span", { class: dotCls(o.level) }) : h("span", { class: "lt lt-none" }), h("span", { class: "name" }, t), h("span", { class: "note" }, o ? (o.lights.length ? `${o.lights.length}개 경고` : "경고 없음") + (o.industry ? ` · ${o.industry}` : "") : err ? "불러오지 못함" : "점검 중…")),
        o ? h("div", { class: "body" }, o.lights.length ? o.lights.map((x) => h("p", {}, h("span", { class: dotCls(x.level) }), " ", h("b", {}, x.label), h("span", { class: "note" }, " " + x.text))) : h("p", { class: "note" }, "규칙에 걸린 항목이 없습니다."),
          o.errors && o.errors.length ? h("p", { class: "note" }, "일부 자료 없음: " + o.errors.slice(0, 2).join(" / ")) : null) : err ? h("div", { class: "body" }, h("p", { class: "err" }, err)) : null))));
    ai.replaceChildren(h("div", { style: "height:12px" }), ...aiView());
  };
  const aiView = () => {
    const ts = tickers().filter(lightOf), ul = (a) => (a && a.length ? h("ul", { class: "ai-list" }, a.map((x) => h("li", {}, x))) : null);
    const out = [h("button", { type: "button", class: "primary", disabled: aiBusy || !ts.length, onclick: async () => {
      aiBusy = true; aiErr = ""; draw();
      try { aiRes = await api("/api/aiwarn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ digest: digest(ts) }) }); }
      catch (x) { if (x.code === 401) { aiBusy = false; return onLogin(); } aiErr = x.message; }
      aiBusy = false; draw();
    } }, aiBusy ? "AI가 점검하는 중… (10~20초)" : "AI로 위험 종합 점검")];
    if (aiErr) out.push(h("p", { class: "err" }, aiErr));
    if (aiRes) out.push(h("div", { class: "ai-op" }, h("p", {}, h("span", { class: dotCls({ 초록: "green", 노랑: "yellow", 빨강: "red" }[aiRes.level]) }), h("b", {}, " " + aiRes.headline), h("span", { class: "note" }, `  ${aiRes.model} · ${fmtTime(aiRes.at)}`)),
      ...aiRes.items.map((x) => h("p", {}, h("span", { class: dotCls({ 초록: "green", 노랑: "yellow", 빨강: "red" }[x.level]) }), " ", h("b", {}, x.t), " ", x.reason, x.check ? h("span", { class: "note" }, " → 확인: " + x.check) : null)),
      aiRes.portfolio.length ? h("p", { class: "note" }, "포트폴리오 수준") : null, ul(aiRes.portfolio), aiRes.caveat ? h("p", { class: "note" }, aiRes.caveat) : null,
      h("p", { class: "note" }, "참고용 점검이며 투자 조언이 아닙니다.")));
    out.push(ts.length ? copyPromptBox("API 대신 Gemini 앱에 붙여넣을 요약 만들기", async () => api("/api/aiwarn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ digest: digest(ts), mode: "prompt" }) }), () => onLogin()) : null);
    return out;
  };
  draw();
  (async () => {
    const queue = tickers().filter((t) => !cache[t] || !cache[t].v || Date.now() - cache[t].at > 1800000);
    const run = async () => { while (queue.length) { const t = queue.shift(); try { await one(t); } catch (x) { if (x.code === 401) { queue.length = 0; return onLogin(); } cache[t] = { at: Date.now(), err: x.message }; } draw(); onUpdate && onUpdate(); } };
    await Promise.all([run(), run()]);
  })();
  return h("div", {}, h("p", { class: "note" }, "내 종목마다 변동성·고점 대비 낙폭·실적 일정·내부자 매도·애널리스트 하향·리스크 뉴스·발표 vs 실제 데이터 불일치를 규칙으로 점검해 초록·노랑·빨강으로 표시합니다. 수량과 비중은 저장하지 않아서 '얼마나 위험한 포지션인지'가 아니라 '무엇이 걸려 있는지'를 알려줍니다. 업종 쏠림은 종목 수로만 계산합니다."), box, ai);
}
