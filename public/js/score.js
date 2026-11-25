import { h, api, spinner, copyPromptBox, fmtTime, safeUrl } from "./core.js";
import { getLights } from "./lights.js";

// 기업 종합 점수표 — 재무 4항목(건전성·수익성·성장성·현금흐름) + 밸류에이션(동종업체 대비)을 가중 평균한 '재무 점수'에서,
// 최근 리스크 경고등(변동성·낙폭·실적일정·내부자·뉴스·발표 vs 실제 불일치)만큼 감점한 것이 '종합 안정도'다.
const W = { health: 30, profit: 25, growth: 15, cash: 20, value: 10 };
const LAB = { health: "재무 건전성", profit: "수익성", growth: "성장성", cash: "현금흐름", value: "밸류에이션" };
const GRADE = (s) => (s >= 75 ? "안정" : s >= 60 ? "보통" : s >= 45 ? "주의" : "위험");
const GCLS = { 안정: "green", 보통: "none", 주의: "yellow", 위험: "red" };
const med = (a) => { const x = a.filter((v) => v != null && v > 0).sort((p, q) => p - q); return x.length ? (x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2) : null; };
const relPts = (r) => (r <= 0.8 ? 100 : r <= 1.2 ? 75 : r <= 1.8 ? 45 : 20);
const fmtV = (it) => (it.display ? it.display : it.value == null ? "데이터 없음" : it.fmt === "%" ? it.value.toFixed(1) + "%" : it.value.toFixed(2) + "배");

export function valuation(val, pm) {
  const items = [];
  const rule = "동종업체 중앙값 대비 ≤0.8배 100 · ≤1.2배 75 · ≤1.8배 45 · 초과 20 (동종 자료가 없으면 절대 구간: PER<15 90 · <25 70 · <40 45 · 이상 25)";
  if (val.pe == null) items.push({ label: "PER (주가수익비율)", value: null, display: "없음(적자일 가능성)", pts: 15, rule, src: "Finnhub", note: "이익이 없거나 데이터가 없어 낮게 평가" });
  else {
    const r = pm.pe ? val.pe / pm.pe : null;
    items.push({ label: "PER (주가수익비율)", value: val.pe, fmt: "x", display: `${val.pe.toFixed(1)}배${pm.pe ? ` (동종 중앙값 ${pm.pe.toFixed(1)}배)` : ""}`, pts: r != null ? relPts(r) : val.pe < 15 ? 90 : val.pe < 25 ? 70 : val.pe < 40 ? 45 : 25, rule, src: pm.pe ? `Finnhub, 동종 ${pm.n}곳` : "Finnhub", note: "" });
  }
  if (val.pb != null) {
    const r = pm.pb ? val.pb / pm.pb : null;
    items.push({ label: "PBR (주가순자산비율)", value: val.pb, fmt: "x", display: `${val.pb.toFixed(2)}배${pm.pb ? ` (동종 중앙값 ${pm.pb.toFixed(2)}배)` : ""}`, pts: val.pb <= 0 ? 0 : r != null ? relPts(r) : val.pb <= 3 ? 80 : val.pb <= 8 ? 55 : 30, rule: rule.replace(/\(동종 자료가 없으면.*\)/, "(동종 자료가 없으면 절대 구간: ≤3배 80 · ≤8배 55 · 초과 30, 자기자본 음수 0)"), src: pm.pb ? `Finnhub, 동종 ${pm.n}곳` : "Finnhub", note: val.pb <= 0 ? "자기자본이 음수" : "" });
  }
  const have = items.filter((i) => i.pts != null);
  return { id: "value", label: LAB.value, weight: W.value, score: have.length ? Math.round(have.reduce((s, i) => s + i.pts, 0) / have.length) : null, items };
}
export function total(cats) {
  const ok = cats.filter((c) => c.score != null), w = ok.reduce((s, c) => s + c.weight, 0);
  const base = w ? Math.round(ok.reduce((s, c) => s + c.score * c.weight, 0) / w) : null;
  const n = cats.flatMap((c) => c.items).filter((i) => i.pts != null).length, all = cats.flatMap((c) => c.items).length;
  return { base, n, all, cover: w };
}
export const deduct = (lights) => Math.min(25, (lights || []).reduce((s, x) => s + (x.level === "red" ? 8 : x.level === "yellow" ? 3 : 0), 0));

const st = {}; // 티커별 상태 캐시
export function scorePanel(t, onLogin) {
  const box = h("div", {}, spinner("재무제표·지표를 모으는 중… (10초 안팎)"));
  const S = st[t] && Date.now() - st[t].at < 1800000 ? st[t] : (st[t] = { at: Date.now(), ai: null });
  (async () => {
    try {
      S.sc = S.sc || await api("/api/score?t=" + encodeURIComponent(t));
      S.pm = S.pm || { pe: null, pb: null, n: 0 };
      draw(box, t, S, onLogin);
      // 분기 숫자는 SEC를 여러 번 읽어 느리므로 따로 받아 오는 대로 다시 그린다.
      if (!S.qt && !S.qtErr) api("/api/quarters?t=" + encodeURIComponent(t)).then((v) => { S.qt = v; }, (x) => { if (x.code === 401) return onLogin(); S.qtErr = x.message; }).then(() => { if (box.isConnected) draw(box, t, S, onLogin); });
      const lp = S.lt ? null : getLights(t).then((v) => { S.lt = v; }, (x) => { S.ltErr = x.message; });
      const np = S.news ? null : api("/api/news?t=" + encodeURIComponent(t)).then((r) => { S.news = r.articles.filter((a) => a.risk).slice(0, 5); }, () => { S.news = []; });
      const pp = S.pm.n ? null : Promise.allSettled((S.sc.peers || []).slice(0, 4).map((p) => api("/api/peerval?t=" + encodeURIComponent(p)))).then((rs) => { const ok = rs.filter((r) => r.status === "fulfilled").map((r) => r.value); S.pm = { pe: med(ok.map((x) => x.pe)), pb: med(ok.map((x) => x.pb)), n: ok.length, names: ok.map((x) => x.t) }; });
      await Promise.all([lp, np, pp].filter(Boolean)); draw(box, t, S, onLogin);
    } catch (x) { if (x.code === 401) return onLogin(); box.replaceChildren(h("p", { class: "err" }, "점수표를 만들지 못했습니다: " + x.message)); }
  })();
  return box;
}

// 최근 분기 변화 (SEC 10-Q·10-K). 방식은 day-trader-skill의 trader-analyst(MIT)를 따랐다.
const usd = (v) => (v == null ? "-" : (v < 0 ? "-$" : "$") + (Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(2) + "B" : (Math.abs(v) / 1e6).toFixed(0) + "M"));
const chg = (v, unit = "%") => (v == null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}${unit}`);
const qEnd = (r) => { const [y, m, d] = r.end.split("-"); return `${y}.${+m}.${+d}`; };
const pctTxt = (v) => (v == null ? "-" : v.toFixed(1) + "%");
function quarterBlock(S) {
  const head = h("h3", {}, "최근 분기 변화");
  if (!S.qt && !S.qtErr) return [head, spinner("SEC 분기 보고서 숫자를 읽는 중…")];
  if (S.qtErr) return [head, h("p", { class: "err" }, "분기 숫자를 불러오지 못했습니다: " + S.qtErr)];
  const q = S.qt, L = q.latest;
  if (!L) return [head, h("p", { class: "note" }, q.errors.join(" / "))];
  const yoy = (v) => (v == null ? h("span", { class: "note" }, "  작년 같은 분기 없음") : [h("span", { class: "note" }, "  작년 같은 분기 대비 "), h("span", { class: "num " + (v >= 0 ? "up" : "down") }, chg(v))]);
  const line = (label, val, y) => h("p", {}, h("b", {}, label), "  ", h("span", { class: "num" }, val), yoy(y));
  const mg = (label, v, d) => `${label} ${pctTxt(v)}${d != null ? ` (직전 분기 대비 ${chg(d, "%p")})` : ""}`;
  const links = [q.report ? h("a", { href: safeUrl(q.report.url), target: "_blank", rel: "noopener noreferrer" }, `${q.report.form} 원문 (${q.report.filed} 제출)`) : null, q.release ? h("a", { href: safeUrl(q.release.url), target: "_blank", rel: "noopener noreferrer" }, `실적 발표 8-K (${q.release.filed})`) : null].filter(Boolean);
  return [head, h("div", { class: "card pad" },
    h("p", { class: "note" }, `${qEnd(L)} 마감 분기${L.derived ? " · 계산값" : ""}`),
    line("매출", usd(L.rev), L.revYoy), line("순이익", usd(L.ni), L.niYoy), line("희석 EPS", L.eps == null ? "-" : (L.eps < 0 ? "-$" : "$") + Math.abs(L.eps).toFixed(2), L.epsYoy),
    h("p", { class: "note num" }, [L.gm != null ? mg("매출총이익률", L.gm, q.gmChange) : null, L.om != null ? mg("영업이익률", L.om, q.omChange) : null, L.nm != null ? `순이익률 ${pctTxt(L.nm)}` : null].filter(Boolean).join(" · ")),
    q.ttm.rev != null ? h("p", { class: "note num" }, `최근 4분기 합: 매출 ${usd(q.ttm.rev)} · 순이익 ${usd(q.ttm.ni)}${q.ttm.eps != null ? ` · EPS $${q.ttm.eps.toFixed(2)}` : ""}`) : null,
    q.flags.map((f) => h("p", { class: "note" }, h("span", { class: "lt lt-yellow" }), " ", f.text, f.url ? [" ", h("a", { href: safeUrl(f.url), target: "_blank", rel: "noopener noreferrer" }, "원문")] : null)),
    links.length ? h("p", { class: "note" }, ...links.flatMap((a, i) => (i ? [" · ", a] : [a]))) : null,
    q.rows.length > 1 ? h("details", { class: "more" }, h("summary", {}, `분기별 숫자 (최근 ${q.rows.length}개)`),
      h("div", { class: "tbl-scroll" }, h("table", { class: "tbl num" }, h("tr", {}, ["분기말", "매출", "전년비", "영업이익률", "순이익", "EPS"].map((x) => h("th", {}, x))),
        q.rows.slice().reverse().map((r) => h("tr", {}, h("td", {}, qEnd(r).slice(2) + (r.derived ? "*" : "")), h("td", {}, usd(r.rev)), h("td", { class: r.revYoy == null ? "" : r.revYoy >= 0 ? "up" : "down" }, chg(r.revYoy)), h("td", {}, pctTxt(r.om)), h("td", {}, usd(r.ni)), h("td", {}, r.eps == null ? "-" : r.eps.toFixed(2)))))),
      q.rows.some((r) => r.derived) ? h("p", { class: "note" }, "* 4분기: 연간에서 1~3분기를 빼서 계산한 값") : null) : null,
    q.errors.length ? h("p", { class: "note" }, "일부 항목 없음: " + q.errors.slice(0, 2).join(" / ")) : null,
    h("p", { class: "note" }, "회사가 SEC에 제출한 10-Q·10-K 숫자입니다. 계절성이 있어 성장률은 작년 같은 분기와 비교합니다. 이 카드는 점수에 넣지 않습니다. 정리 방식: trader-analyst(MIT)."))];
}

function digestOf(t, S, cats, tot, ded) {
  const v = S.sc.val, L = [`종목 ${t} (${S.sc.name || ""}), 업종: ${S.sc.industry || "미상"}`, `종합 안정도 ${tot.base == null ? "-" : Math.max(0, tot.base - ded)}점/100 (${GRADE(Math.max(0, tot.base - ded))}) = 재무 점수 ${tot.base} − 최근 리스크 감점 ${ded}. 근거 항목 ${tot.n}/${tot.all}개.`];
  for (const c of cats) L.push(`${c.label} ${c.score == null ? "-" : c.score}점 (가중 ${c.weight}%): ` + c.items.map((i) => `${i.label} ${fmtV(i)}${i.pts != null ? ` → ${i.pts}점` : ""}`).join(" / "));
  L.push(`참고 지표: PSR ${v.ps != null ? v.ps.toFixed(1) : "-"}, 베타 ${v.beta != null ? v.beta.toFixed(2) : "-"}, 배당수익률 ${v.divYield != null ? v.divYield.toFixed(2) + "%" : "-"}, 52주 ${v.lo52 ?? "-"}~${v.hi52 ?? "-"}, 시총 ${v.mcap != null ? Math.round(v.mcap).toLocaleString("en-US") + "M USD" : "-"}`);
  if (S.pm && S.pm.n) L.push(`동종업체(${S.pm.names.join(", ")}) PER 중앙값 ${S.pm.pe ? S.pm.pe.toFixed(1) : "-"}, PBR 중앙값 ${S.pm.pb ? S.pm.pb.toFixed(2) : "-"}`);
  if (S.lt) L.push("최근 리스크 경고등: " + (S.lt.lights.length ? S.lt.lights.map((x) => `[${{ red: "빨강", yellow: "노랑", green: "초록" }[x.level]}] ${x.label}: ${x.text}`).join(" / ") : "없음"));
  if (S.qt && S.qt.latest) { const q = S.qt, r = q.latest; L.push(`최근 분기(${r.end} 마감${r.derived ? ", 연간에서 계산" : ""}, SEC 제출 숫자): 매출 ${usd(r.rev)} (작년 같은 분기 대비 ${chg(r.revYoy)}), 순이익 ${usd(r.ni)} (${chg(r.niYoy)}), EPS ${r.eps ?? "-"} (${chg(r.epsYoy)}), 매출총이익률 ${pctTxt(r.gm)}, 영업이익률 ${pctTxt(r.om)}` + (q.flags.length ? ` / 주의: ${q.flags.map((f) => f.text).join(" ")}` : "")); }
  if (S.news && S.news.length) L.push("리스크 키워드 뉴스: " + S.news.map((a) => a.title).join(" | "));
  return L.join("\n");
}

function draw(box, t, S, onLogin) {
  const sc = S.sc, cats = [...sc.cats, valuation(sc.val, S.pm || {})], tot = total(cats), ded = S.lt ? deduct(S.lt.lights) : 0;
  const fin = tot.base == null ? null : Math.max(0, tot.base - ded), g = fin == null ? null : GRADE(fin);
  const dot = (c) => h("span", { class: "lt lt-" + c });
  const ul = (a) => (a && a.length ? h("ul", { class: "ai-list" }, a.map((x) => h("li", {}, x))) : null);
  const kids = [];
  if (fin == null) kids.push(h("p", { class: "err" }, "점수를 낼 만큼 데이터를 받지 못했습니다. " + sc.errors.slice(0, 2).join(" / ")));
  else {
    kids.push(h("div", { class: "card pad" },
      h("div", { class: "card-h" }, h("div", { class: "big num" }, `${fin}`, h("small", { class: "note" }, " / 100")), h("span", { class: "pill" }, dot(GCLS[g]), g)),
      h("div", { class: "sbar score", "aria-hidden": "true" }, h("i", { class: "p", style: `width:${fin}%` })),
      h("p", { class: "note" }, `재무 점수 ${tot.base}${S.lt ? ` − 최근 리스크 감점 ${ded}` : " (최근 리스크 점검 중…)"} · 근거 항목 ${tot.n}/${tot.all}개${tot.n < tot.all ? " (없는 항목은 빼고 계산)" : ""}`),
      h("p", { class: "note" }, "75 이상 안정 · 60~74 보통 · 45~59 주의 · 44 이하 위험. 확률이 아니라 공개 재무지표를 구간표로 점수화한 값이며, 매수·매도 신호가 아닙니다.")));
    kids.push(h("div", { class: "card" }, cats.map((c) => h("details", { class: "lt-row" },
      h("summary", {}, dot(c.score == null ? "none" : c.score >= 70 ? "green" : c.score >= 45 ? "yellow" : "red"), h("span", { class: "name" }, c.label), h("span", { class: "note" }, `가중 ${c.weight}% · ${c.score == null ? "데이터 없음" : c.score + "점"}`)),
      h("div", { class: "body" }, ...c.items.map((i) => h("div", {}, h("p", {}, h("b", {}, i.label), "  ", h("span", { class: "num" }, fmtV(i)), h("span", { class: "note" }, i.pts != null ? ` → ${i.pts}점 · ${i.src}` : " · 점수 제외")), h("p", { class: "note" }, "기준: " + i.rule + (i.note ? ` — ${i.note}` : "")))))))));
  }
  kids.push(quarterBlock(S));
  // 최근 리스크
  kids.push(h("h3", {}, "최근 리스크"));
  if (!S.lt && !S.ltErr) kids.push(spinner("리스크 점검 중…"));
  else if (S.ltErr) kids.push(h("p", { class: "err" }, "리스크 점검 실패: " + S.ltErr));
  else {
    kids.push(S.lt.lights.length ? h("div", { class: "card pad" }, S.lt.lights.map((x) => h("p", {}, dot(x.level), " ", h("b", {}, x.label), h("span", { class: "note" }, " " + x.text)))) : h("p", { class: "note" }, "규칙에 걸린 최근 리스크가 없습니다."));
  }
  if (S.news && S.news.length) kids.push(h("div", { class: "news" }, S.news.map((a) => h("a", { href: safeUrl(a.url), target: "_blank", rel: "noopener noreferrer", class: "risk" }, a.title, h("small", {}, `${a.risk} · ${a.source}`)))));
  // 참고 지표
  const v = sc.val;
  const info = [v.ps != null ? `PSR ${v.ps.toFixed(1)}` : null, v.beta != null ? `베타 ${v.beta.toFixed(2)}` : null, v.divYield != null ? `배당수익률 ${v.divYield.toFixed(2)}%` : null, v.hi52 && v.lo52 ? `52주 ${v.lo52}~${v.hi52}` : null, S.pm && S.pm.n ? `동종 ${S.pm.n}곳 PER 중앙값 ${S.pm.pe ? S.pm.pe.toFixed(1) : "-"}` : null].filter(Boolean);
  if (info.length) kids.push(h("p", { class: "note" }, "참고: " + info.join(" · ") + " (점수에는 직접 넣지 않음)"));
  if (sc.errors.length) kids.push(h("details", { class: "more" }, h("summary", {}, `불러오지 못한 항목 ${sc.errors.length}건`), sc.errors.map((e) => h("p", { class: "note" }, e))));
  // AI
  if (fin != null) {
    const ab = h("button", { type: "button", class: "primary", disabled: S.busy, onclick: async () => {
      S.busy = true; S.aiErr = ""; draw(box, t, S, onLogin);
      try { S.ai = await api("/api/aiscore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ digest: digestOf(t, S, cats, tot, ded) }) }); }
      catch (x) { if (x.code === 401) { S.busy = false; return onLogin(); } S.aiErr = x.message; }
      S.busy = false; draw(box, t, S, onLogin);
    } }, S.busy ? "AI가 읽는 중… (10~20초)" : "AI로 업종 맥락 해석");
    kids.push(h("div", { style: "height:8px" }), ab, S.aiErr ? h("p", { class: "err" }, S.aiErr) : null,
      S.ai ? h("div", { class: "ai-op" }, h("p", {}, h("b", {}, `AI 총평: ${S.ai.verdict}`), h("span", { class: "note" }, `  ${S.ai.model} · ${fmtTime(S.ai.at)}`)), h("p", {}, S.ai.headline),
        S.ai.strengths.length ? h("p", { class: "note" }, "강점") : null, ul(S.ai.strengths), S.ai.concerns.length ? h("p", { class: "note" }, "우려") : null, ul(S.ai.concerns),
        S.ai.industry_note ? h("p", { class: "note" }, "업종 맥락: " + S.ai.industry_note) : null, S.ai.check.length ? h("p", { class: "note" }, "확인할 것") : null, ul(S.ai.check),
        h("p", { class: "note" }, "참고용 해석이며 투자 조언이 아닙니다.")) : null,
      copyPromptBox("API 대신 Gemini 앱에 붙여넣을 요약 만들기", async () => api("/api/aiscore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ digest: digestOf(t, S, cats, tot, ded), mode: "prompt" }) }), () => onLogin()));
  }
  kids.push(h("details", { class: "more" }, h("summary", {}, "점수는 무엇을 기준으로 매기나요?"),
    h("p", { class: "note" }, "애널리스트와 신용평가에서 흔히 보는 지표를 구간표로 점수화했습니다. ① 재무 건전성 30% (부채비율·유동비율·이자보상배율: 빚을 감당할 수 있나) ② 수익성 25% (영업이익률·ROE: 본업에서 남기나) ③ 현금흐름 20% (FCF 마진·이익의 질: 장부 이익이 현금으로 들어오나) ④ 성장성 15% (매출·EPS 성장률) ⑤ 밸류에이션 10% (PER·PBR을 동종업체와 비교: 비싸게 사는 건 아닌가)."),
    h("p", { class: "note" }, "그다음 최근 리스크(큰 변동성, 고점 대비 낙폭, 실적 발표 임박, 내부자 매도, 애널리스트 하향, 리스크 뉴스, 발표와 실제 데이터 불일치)로 빨강 8점·노랑 3점씩 최대 25점 깎습니다. 항목별 기준은 위 각 줄을 눌러 확인하세요."),
    h("p", { class: "note" }, "한계: 구간은 업종을 가리지 않는 경험칙입니다. 은행·리츠는 부채가 구조적으로 많아 건전성이 낮게, 성장주는 PER이 높아 밸류에이션이 낮게 나올 수 있습니다. 그래서 동종업체 비교와 'AI로 업종 맥락 해석'을 함께 쓰세요. 재무 수치는 최근 분기가 아닌 TTM/연간 기준일 수 있고, 데이터가 없는 항목은 빼고 계산합니다."),
    h("p", { class: "note" }, "참고: 이 점수가 높다고 주가가 오른다는 뜻이 아닙니다. 재무가 튼튼한 회사도 비싸게 사면 손실이 날 수 있습니다.")));
  box.replaceChildren(...kids.flat(Infinity).filter(Boolean));
}
