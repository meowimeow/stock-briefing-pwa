import { h, LS, api, safeUrl, store, spinner, copyPromptBox, fmtTime, bar } from "./core.js";
import { sheet, crow, kstFmt } from "./ui.js";
import { macroSoon } from "./upcoming.js";
import { buildStories, boardOf, rankStories, moveOf, moveText, marketCheck, buildDigest, checkAi } from "./stories.js";

// 세계: 전 세계 공개 RSS 제목을 같은 소식끼리 묶어 산업별 타일로 보여주고, 업종 ETF 움직임과 대조한다.
let root = null, onLogin = () => {}, groups = null, data = {}, loading = false, progress = "", err = "", at = 0, region = "전체", macro = null, sectors = null;
const when = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const all = () => Object.values(data).flatMap((d) => d.articles);

export const worldTab = {
  id: "world", label: "세계",
  setLogin(fn) { onLogin = fn; },
  async show(el) { root = el; render(); if (!at || Date.now() - at > 600000) collect(); if (!macro) macroSoon(7).then((m) => { macro = m || []; render(); }).catch((x) => { if (x.code === 401) onLogin(); }); },
};

async function collect(force) {
  if (loading) return;
  loading = true; err = ""; progress = "준비 중"; render();
  try {
    if (!groups) groups = (await api("/api/trustedgroups")).groups;
    api("/api/sectors").then((v) => { sectors = v; render(); }, () => {}); // 실패해도 대조 표시만 빠진다
    const queue = groups.map((g) => g.id).filter((id) => force || !data[id] || Date.now() - data[id].fetched > 600000);
    const total = queue.length; let done = 0, auth = false;
    const run = async () => {
      while (queue.length && !auth) {
        const id = queue.shift();
        try { data[id] = { ...(await api("/api/trusted?g=" + id)), fetched: Date.now() }; }
        catch (x) { if (x.code === 401) { auth = true; return; } data[id] = { group: id, label: (groups.find((g) => g.id === id) || {}).label || id, articles: [], status: [], errors: [x.message], fetched: Date.now() }; }
        progress = `${++done}/${total}`; render();
      }
    };
    await Promise.all([run(), run(), run()]);
    if (auth) { loading = false; return onLogin(); }
    at = Date.now();
  } catch (x) { if (x.code === 401) { loading = false; return onLogin(); } err = x.message; }
  loading = false; progress = ""; render();
}

// 렌더가 잦으므로 기사 목록이 바뀔 때만 다시 묶는다.
let memo = { key: "", v: [] };
function stories() {
  const list = all(), key = list.length + "|" + at;
  if (memo.key !== key) memo = { key, v: buildStories(list) };
  return memo.v;
}

function render() {
  if (!root || !root.isConnected) return;
  const list = all(), sts = stories(), regions = ["전체", ...new Set(list.map((a) => a.region))];
  if (!regions.includes(region)) region = "전체";
  const f = region === "전체" ? sts : sts.filter((s) => s.regions.includes(region));
  const rows = boardOf(f).filter((o) => o.name !== "기타");
  const max = Math.max(1, ...rows.map((o) => o.n));
  const hot = rows[0], neg = rows.filter((o) => o.n >= 4).sort((a, b) => b.neg / b.n - a.neg / a.n)[0], pos = rows.filter((o) => o.n >= 4).sort((a, b) => b.pos / b.n - a.pos / a.n)[0];
  const summary = !rows.length ? (loading ? "" : "수집된 기사가 없습니다.") : `화제 1위 ${hot.name}` + (pos && pos.pos ? ` · 긍정 ${pos.name}` : "") + (neg && neg.neg ? ` · 부정 ${neg.name}` : "");
  root.replaceChildren(
    h("div", { class: "top" }, h("div", {}, h("h1", {}, "세계"), h("p", { class: "sub" }, list.length ? `${fmtTime(new Date(at).toISOString())} · 기사 ${list.length}건 → 이야기 ${sts.length}개 · 복수 확인 ${sts.filter((s) => s.grade !== "미확인").length}개` : loading ? "수집 중…" : "아직 수집하지 않았습니다")),
      h("div", { class: "top-r" }, h("button", { class: "ghost", disabled: loading, onclick: () => collect(true) }, loading ? progress || "수집 중" : "새로고침"))),
    loading ? h("div", { class: "progress" }, h("i", { style: `width:${(parseInt(progress) || 0) / (parseInt((progress || "0/1").split("/")[1]) || 1) * 100}%` })) : null,
    err ? h("p", { class: "err" }, err) : null,
    list.length ? h("div", { class: "chips pick" }, regions.map((r) => h("button", { type: "button", class: "tab-chip" + (r === region ? " on" : ""), onclick: () => { region = r; render(); } }, r))) : null,
    summary ? h("p", { class: "summary" }, summary) : null,
    rows.length ? h("div", { class: "heat" }, rows.slice(0, 8).map((o) => h("button", { type: "button", class: "ht", style: `--k:${(0.25 + 0.75 * (o.n / max)).toFixed(2)}`, onclick: () => industrySheet(o) },
      h("div", { class: "ht-r" }, h("b", {}, o.name), h("span", { class: "num ht-n" }, `${o.n}개`)), bar(o.pos, o.neg, o.n),
      h("small", { class: "note" }, `확인 ${o.conf} · 긍정 ${o.pos} · 부정 ${o.neg}`), marketLine(o))))
      : list.length ? h("p", { class: "note" }, "이 지역의 분류된 기사가 없습니다.") : loading ? spinner("전 세계 뉴스를 모으는 중…") : null,
    rows.length > 8 ? h("button", { type: "button", class: "ghost wide", onclick: () => sheet("산업 전체", h("div", { class: "card" }, rows.map((o) => h("button", { type: "button", class: "mine-row", onclick: () => industrySheet(o) }, h("span", { class: "name" }, o.name), h("span", { class: "px num" }, `${o.n}개 · 확인 ${o.conf} · 긍정 ${o.pos} · 부정 ${o.neg}`))))) }, `그 밖의 산업 ${rows.length - 8}개 보기`) : null,
    h("div", { class: "sec-h" }, "이번 주 경제지표"),
    h("div", { class: "sch" }, macro == null ? h("p", { class: "note" }, "일정 확인 중…") : macro.length ? macro.slice(0, 3).map((m) => crow("지표", (Date.parse(m.nextReleaseUtc) - Date.now()) / 3600e3 <= 48, m.label.replace(/\s*\(.*$/, ""), kstFmt(m.nextReleaseUtc))) : h("p", { class: "note" }, "7일 안에 예정된 주요 지표가 없습니다.")),
    list.length ? h("button", { type: "button", class: "primary wide", onclick: () => aiSheet(sts) }, "AI에게 산업 동향 분석 맡기기") : null,
    list.length ? h("p", { class: "note" }, "같은 소식은 한 이야기로 묶어 셉니다. '확인'은 공식 기관이거나 여러 매체가 따로 쓴 이야기입니다. 긍정·부정은 제목 키워드 판정, 산업 분류도 키워드라 틀릴 수 있습니다. ETF는 미국 상장 기준이라 다른 지역 시장은 반영하지 못합니다. 타일을 누르면 헤드라인이 열립니다.") : null);
}

function marketLine(o) {
  const mv = moveOf(sectors, o.name);
  if (!mv) return null;
  const c = marketCheck(o, mv);
  return h("small", { class: "note num" }, `${mv.etf} ${moveText(mv).split(" · ")[0]}`, c === "엇갈림" ? h("span", { class: "tag-warn" }, " 뉴스와 엇갈림") : null);
}
const GCLS = { 공식: "공식 기관", 확인: "복수 확인", 미확인: "1곳 보도" };
const storyRow = (s) => h("div", { class: "art" },
  h("a", { href: safeUrl(s.url), target: "_blank", rel: "noopener noreferrer" }, s.title),
  h("div", { class: "meta" }, h("span", { class: "pill" }, s.grade === "확인" ? `${s.outlets.length}곳 확인` : GCLS[s.grade]), h("span", { class: "pill" }, s.region), h("span", { class: "pill s-" + s.sentiment }, s.sentiment),
    h("span", { class: "note" }, [s.outlets.slice(0, 3).join(", "), when(s.at)].filter(Boolean).join(" · "))));
function industrySheet(o) {
  const mv = moveOf(sectors, o.name), c = marketCheck(o, mv);
  sheet(`${o.name} · 이야기 ${o.n}개`, h("div", {},
    mv ? h("p", { class: "note num" }, `${mv.etf} ${moveText(mv)}${mv.rel2 != null ? ` · 시장 대비 2일 ${mv.rel2 >= 0 ? "+" : ""}${mv.rel2.toFixed(1)}%` : ""}${c === "엇갈림" ? " · 뉴스 논조와 가격이 엇갈립니다" : c === "일치" ? " · 뉴스 논조와 가격 방향이 같습니다" : ""}`) : null,
    ...rankStories(o.stories).slice(0, 40).map(storyRow)));
}

let aiRes = null, aiErr = "";
function aiItem(x) {
  const tags = [];
  if (!x.cited.length) tags.push("근거 번호 없음: 확인 불가");
  else if (x.conf === 0) tags.push("1곳 보도뿐: 근거 약함");
  if (x.badNums.length) tags.push(`근거에 없는 숫자 ${x.badNums.slice(0, 3).join(", ")}`);
  if (x.against) tags.push(`가격과 엇갈림: ${x.move.etf} ${moveText(x.move)}`);
  return h("div", { class: "ai-ind" }, h("p", {}, h("span", { class: "up-tag" + (x.trend === "약세" ? " down" : x.trend === "강세" ? " up" : "") }, x.trend), " ", h("b", {}, x.name), h("span", { class: "note" }, ` (${x.regions})`), " ", x.evidence, x.risk ? h("span", { class: "note" }, " → 위험: " + x.risk) : null),
    tags.map((t) => h("p", { class: "tag-warn note" }, t)),
    x.cited.length ? h("p", { class: "note" }, "근거: ", ...x.cited.slice(0, 3).flatMap((s, i) => [i ? " · " : "", h("a", { href: safeUrl(s.url), target: "_blank", rel: "noopener noreferrer" }, s.title.slice(0, 60)), ` (${s.grade === "확인" ? s.outlets.length + "곳" : GCLS[s.grade]})`])) : null);
}
function aiSheet(sts) {
  const out = h("div", {}), dg = buildDigest(sts, sectors);
  const ul = (a) => (a && a.length ? h("ul", { class: "ai-list" }, a.map((x) => h("li", {}, x))) : null);
  const show = () => out.replaceChildren(aiErr ? h("p", { class: "err" }, aiErr) : null, aiRes ? h("div", { class: "ai-op" }, h("p", {}, h("b", {}, aiRes.headline), h("span", { class: "note" }, `  ${aiRes.model} · ${fmtTime(aiRes.at)}`)),
    ...aiRes.industries.map(aiItem),
    aiRes.cross_region.length ? h("p", { class: "note" }, "지역 간 엇갈림·연결고리") : null, ul(aiRes.cross_region), aiRes.droppedCross ? h("p", { class: "note" }, `근거 번호가 없는 주장 ${aiRes.droppedCross}개는 뺐습니다.`) : null, aiRes.watch.length ? h("p", { class: "note" }, "확인할 것") : null, ul(aiRes.watch),
    aiRes.caveat ? h("p", { class: "note" }, aiRes.caveat) : null, h("p", { class: "note" }, "참고용이며 투자 조언이 아닙니다.")) : null);
  const btn = h("button", { type: "button", class: "primary", onclick: async () => {
    btn.disabled = true; out.replaceChildren(spinner("AI가 읽는 중… (15~30초)")); aiErr = "";
    try { aiRes = checkAi(await api("/api/aiindustry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ digest: dg.text }) }), dg.map, sectors); }
    catch (x) { if (x.code === 401) return onLogin(); aiErr = x.message; }
    btn.disabled = false; show();
  } }, "AI로 산업 동향 분석");
  show();
  sheet("AI 산업 동향 분석", h("div", {}, h("p", { class: "note" }, "같은 소식을 묶은 이야기와 업종 ETF 수익률을 AI에게 넘깁니다. AI는 번호로 근거를 대야 하고, 앱이 그 근거를 다시 검사해 약한 부분을 표시합니다. 제목과 짧은 요약만 읽기 때문에 깊이는 얕습니다."), btn, out,
    copyPromptBox("API 대신 Gemini 앱에 붙여넣을 요약 만들기", async () => api("/api/aiindustry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ digest: dg.text, mode: "prompt" }) }), () => onLogin()),
    (() => { const st = Object.values(data).flatMap((d) => d.status || []), bad = st.filter((s) => s.error); return h("details", { class: "more" }, h("summary", {}, `출처 상태 · ${st.length - bad.length}/${st.length}곳 응답`), ...bad.slice(0, 30).map((s) => h("p", { class: "note" }, `${s.name} — ${s.error}`))); })()));
}
