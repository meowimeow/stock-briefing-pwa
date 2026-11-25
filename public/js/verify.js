import { h, api, spinner, safeUrl } from "./core.js";

// 교차 점검: 뉴스·기업 발표의 주장 vs 실제 재무·실적·내부자·IPO 데이터
const cache = {};
export async function fetchVerify(t) {
  const c = cache[t];
  if (c && Date.now() - c.at < 1800000) return c.v;
  const v = await api("/api/verify?t=" + encodeURIComponent(t));
  cache[t] = { at: Date.now(), v };
  return v;
}
const CLS = { 불일치: "down", 주의: "soon", 확인불가: "", 참고: "", 일치: "up" };

// 브리핑 AI에 넘길 한 줄 요약 (불일치·주의만)
export function verifyLine(v) {
  const bad = ((v && v.checks) || []).filter((c) => c.status === "불일치" || c.status === "주의");
  return bad.length ? bad.slice(0, 3).map((c) => `[${c.status}] ${c.title}: ${c.fact}`).join(" / ") : "";
}

export function verifyPanel(t, onLogin) {
  const box = h("div", {}, spinner("뉴스·발표와 실제 데이터를 대조하는 중…"));
  fetchVerify(t).then((v) => box.replaceChildren(view(v)), (x) => { if (x.code === 401) return onLogin(); box.replaceChildren(h("p", { class: "err" }, "교차 점검을 불러오지 못했습니다: " + x.message)); });
  return box;
}

function view(v) {
  const out = [];
  out.push(h("p", { class: "note" }, "최근 2주 뉴스에서 '실적 상회·성장·수익성·IPO' 같은 주장을 찾아, SEC 재무제표·실적 서프라이즈·내부자 거래·IPO 정보와 대조합니다. 진위 판정이 아니라 엇갈리는 곳을 알려주는 규칙 기반 점검입니다."));
  out.push(h("div", { class: "card pad" }, v.checks.map((c) => h("div", { class: "vf" },
    h("p", {}, h("span", { class: "up-tag " + (CLS[c.status] || "") }, c.status), " ", h("b", {}, c.title)),
    c.claim ? h("p", { class: "note" }, "발표·뉴스: " + c.claim) : null,
    h("p", {}, "실제 데이터: " + c.fact),
    c.note ? h("p", { class: "note" }, c.note) : null))));
  if (v.claims.length) out.push(h("details", { class: "more" }, h("summary", {}, `주장이 담긴 뉴스 ${v.claims.length}건`), ...v.claims.map((x) => h("div", { class: "note" }, h("a", { href: safeUrl(x.url), target: "_blank", rel: "noopener noreferrer" }, x.headline), `  ${x.source} · ${x.date} · ` + x.tags.map((g) => g.label).join(", ")))));
  if (v.errors && v.errors.length) out.push(h("p", { class: "err" }, "불러오지 못함: " + v.errors.slice(0, 3).join(" / ")));
  out.push(h("p", { class: "note" }, "한계: 뉴스는 영어 키워드로 찾으므로 놓칠 수 있고, SEC 연간(10-K) 기준이라 최근 분기 변화는 늦게 반영됩니다. 최종 확인은 공시 원문(SEC)에서 하세요."));
  return h("div", {}, out);
}
