// 뉴스를 '기사'가 아니라 '이야기' 단위로 센다. 같은 소식을 여러 매체가 쓰면 건수만 부풀기 때문이다.
// 묶기는 제목 단어가 겹치는 정도로만 판단하므로 언어가 다르면 합치지 못한다. 등급도 "사실"이 아니라 "몇 곳이 따로 썼나"일 뿐이다.
const STOP = new Set("the a an of to in on for and or as at by from with is are was be its it this that after amid over new says say said will has have more than into about how why what".split(" "));
const UP = new Set(["rise", "rose", "surge", "jump", "gain", "rally", "soar", "climb", "up", "beat", "상승", "급등", "涨", "上涨"]);
const DOWN = new Set(["fall", "fell", "drop", "slide", "sink", "plunge", "slump", "tumble", "down", "miss", "하락", "급락", "跌", "下跌"]);
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function tokens(title) {
  const out = new Set();
  for (const w of String(title).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    if (CJK.test(w)) { if (UP.has(w) || DOWN.has(w)) out.add(w); for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2)); }
    else if (w.length > 1 && !STOP.has(w)) out.add(w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  }
  return out;
}

// 같은 이야기면 0보다 큰 유사도, 아니면 0. 단어가 겹쳐도 방향이 반대면("주가 상승"/"주가 하락") 다른 이야기다.
export function similar(a, b) {
  const dir = (s) => [[...s].some((w) => UP.has(w)), [...s].some((w) => DOWN.has(w))];
  const [au, ad] = dir(a), [bu, bd] = dir(b);
  if ((au && !ad && bd && !bu) || (ad && !au && bu && !bd)) return 0;
  let shared = 0; for (const w of a) if (b.has(w)) shared++;
  const union = a.size + b.size - shared;
  if (shared < 3 || !union || shared / Math.min(a.size, b.size) < 0.6) return 0;
  const j = shared / union;
  return j >= 0.4 ? j : 0;
}

// 피드 이름과 구글뉴스 출처명이 달라도 같은 매체는 한 곳으로 센다 (CNBC 톱뉴스 + CNBC 실적 = 1곳).
const ALIAS = [[/wsj|wall street journal/i, "wsj"], [/nyt|new york times|뉴욕타임스/i, "nyt"], [/bloomberg|블룸버그/i, "bloomberg"], [/reuters|로이터/i, "reuters"], [/cnbc/i, "cnbc"], [/marketwatch/i, "marketwatch"], [/financial times/i, "ft"], [/\bbbc\b/i, "bbc"], [/yahoo/i, "yahoo"], [/연합뉴스|yonhap/i, "yonhap"], [/nikkei|닛케이/i, "nikkei"]];
export const outletKey = (s) => { const x = String(s || ""); for (const [r, k] of ALIAS) if (r.test(x)) return k; return x.toLowerCase().replace(/^the\s+/, "").trim(); };

const TIER = { 공식: 3, 경제지: 2, 종합: 2, 모음: 1 };
const GRADE = { 공식: 2, 확인: 1, 미확인: 0 };
const major = (arr) => { const c = {}; for (const x of arr) c[x] = (c[x] || 0) + 1; return Object.entries(c).sort((p, q) => q[1] - p[1])[0][0]; };

function finish(s) {
  const outlets = [...new Map(s.arts.map((a) => [outletKey(a.source), a.source])).values()];
  const direct = s.arts.some((a) => a.tier === "경제지" || a.tier === "종합");
  const grade = s.arts.some((a) => a.tier === "공식") ? "공식" : (outlets.length >= 2 && direct) || outlets.length >= 3 ? "확인" : "미확인";
  const pos = s.arts.filter((a) => a.sentiment === "긍정").length, neg = s.arts.filter((a) => a.sentiment === "부정").length;
  const named = s.arts.map((a) => a.industry).filter((x) => x !== "기타");
  return {
    title: s.arts[0].title, summary: (s.arts.find((a) => a.summary) || {}).summary || "", url: s.arts[0].url, arts: s.arts, outlets, grade,
    sentiment: pos > neg ? "긍정" : neg > pos ? "부정" : "중립", impact: Math.max(...s.arts.map((a) => a.impact || 1)),
    industry: named.length ? major(named) : "기타", region: major(s.arts.map((a) => a.region)), regions: [...new Set(s.arts.map((a) => a.region))],
    at: s.arts.map((a) => a.at || "").sort().pop(),
  };
}

const rank = (a, b) => GRADE[b.grade] - GRADE[a.grade] || b.outlets.length - a.outlets.length || b.impact - a.impact || (b.at || "").localeCompare(a.at || "");

// 기사 목록 → 이야기 목록. 등급이 높은 기사가 대표 제목이 되게 공식·경제지부터 넣는다. id는 AI 근거 번호로 쓴다.
export function buildStories(list) {
  const groups = [], index = new Map();
  const sorted = [...list].sort((a, b) => (TIER[b.tier] || 0) - (TIER[a.tier] || 0) || (b.at || "").localeCompare(a.at || ""));
  for (const a of sorted) {
    const tk = tokens(a.title), cand = new Set();
    for (const w of tk) for (const g of index.get(w) || []) cand.add(g);
    let best = null, top = 0;
    for (const g of cand) { const v = similar(tk, g.tk); if (v > top) { top = v; best = g; } }
    if (best) { best.arts.push(a); continue; }
    const g = { tk, arts: [a] }; groups.push(g);
    for (const w of tk) { if (!index.has(w)) index.set(w, []); index.get(w).push(g); }
  }
  return groups.map(finish).sort(rank).map((s, i) => ({ ...s, id: i + 1 }));
}

export function boardOf(stories) {
  const m = new Map();
  for (const s of stories) {
    const o = m.get(s.industry) || { name: s.industry, n: 0, conf: 0, pos: 0, neg: 0, reg: {}, stories: [] };
    o.n++; if (s.grade !== "미확인") o.conf++; if (s.sentiment === "긍정") o.pos++; if (s.sentiment === "부정") o.neg++;
    o.reg[s.region] = (o.reg[s.region] || 0) + 1; o.stories.push(s); m.set(s.industry, o);
  }
  return [...m.values()].sort((a, b) => (a.name === "기타") - (b.name === "기타") || b.conf - a.conf || b.n - a.n);
}
export const rankStories = (arr) => [...arr].sort(rank);

// 뉴스 논조와 실제 업종 ETF 움직임 대조. 뉴스 창이 이틀이라 2거래일 수익률(시장 대비)과 비교한다. 애매하면 판단하지 않는다.
export const moveOf = (sectors, name) => (sectors && sectors.rows || []).find((r) => r.industry === name) || null;
const gap = (mv) => (mv ? mv.rel2 ?? mv.r2 ?? mv.r1 ?? null : null);
export function marketCheck(o, mv) {
  const v = gap(mv);
  if (v == null || o.n < 4) return null;
  const tilt = (o.pos - o.neg) / o.n;
  if (Math.abs(tilt) < 0.25 || Math.abs(v) < 1) return null;
  return tilt > 0 === v > 0 ? "일치" : "엇갈림";
}
const pc = (x) => (x == null ? "-" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
export const moveText = (mv) => (mv ? [mv.r2 != null ? `2일 ${pc(mv.r2)}` : mv.r1 != null ? `하루 ${pc(mv.r1)}` : null, mv.r5 != null ? `5일 ${pc(mv.r5)}` : null].filter(Boolean).join(" · ") : "");

// AI에게 넘길 자료. 이야기마다 번호를 붙여 근거를 번호로 대게 한다. 키워드 긍정·부정은 AI 판단을 흐리므로 넣지 않는다.
function pick(arr, k) {
  const by = {}; for (const s of arr) (by[s.region] = by[s.region] || []).push(s);
  Object.values(by).forEach((v) => v.sort(rank));
  const out = []; for (let i = 0; out.length < k && i < 7; i++) for (const r of Object.keys(by)) if (by[r][i] && out.length < k) out.push(by[r][i]);
  return out;
}
export function buildDigest(stories, sectors) {
  const rows = boardOf(stories).filter((o) => o.name !== "기타" || o.n >= 5), map = {};
  const lines = [`이야기 ${stories.length}개 (같은 소식을 쓴 기사는 하나로 묶음), 기준 ${new Date().toISOString().slice(0, 16)}Z`];
  if (sectors && sectors.spy) lines.push(`시장 기준 SPY: ${moveText(sectors.spy)} (미국 상장 ETF 기준이라 다른 지역 시장은 반영 못 함)`);
  for (const o of rows) {
    const mv = moveOf(sectors, o.name);
    lines.push(`■ ${o.name}: 이야기 ${o.n}개 중 공식·복수확인 ${o.conf}개, 지역별 ${Object.entries(o.reg).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", ")}${mv ? ` / 시장 ${mv.etf}: ${moveText(mv)}` : ""}`);
    for (const s of pick(o.stories, 7)) {
      map[s.id] = s;
      lines.push(`  [${s.id}] (${s.grade === "공식" ? "공식기관" : s.grade === "확인" ? `${s.outlets.length}곳 보도` : "1곳만 보도"}) [${s.region}] ${s.title.slice(0, 110)}${s.summary ? ` — ${s.summary.slice(0, 90)}` : ""} (${s.outlets.slice(0, 3).join(", ")})`);
    }
  }
  let text = lines.join("\n");
  while (text.length > 14500 && lines.length > 3) { lines.pop(); text = lines.join("\n"); }
  // 잘려 나간 번호는 AI가 본 적 없으므로 근거로 인정하지 않는다.
  for (const id of Object.keys(map)) if (!text.includes(`[${id}] (`)) delete map[id];
  return { text, map };
}

// AI 답을 앱이 다시 검사한다: 근거 번호가 실제로 있는지, 확인된 이야기가 있는지, 숫자가 근거에 있는지, 시장과 맞는지.
const nums = (s) => String(s).match(/\d+(?:[.,]\d+)?/g) || [];
export function checkAi(res, map, sectors) {
  const industries = res.industries.map((x) => {
    const cited = (x.ids || []).map((i) => map[i]).filter(Boolean), v = gap(moveOf(sectors, x.name));
    const src = cited.map((s) => `${s.title} ${s.summary}`).join(" ") + " " + JSON.stringify(moveOf(sectors, x.name) || {});
    return {
      ...x, cited, conf: cited.filter((s) => s.grade !== "미확인").length,
      badNums: nums(`${x.evidence} ${x.risk}`).filter((n) => !src.includes(n)),
      against: v != null && Math.abs(v) >= 1 && ((x.trend === "강세" && v < 0) || (x.trend === "약세" && v > 0)),
      move: moveOf(sectors, x.name),
    };
  });
  // 근거 번호 없는 지역 간 주장은 버린다.
  const cross = res.cross_region.filter((t) => (t.match(/\[(\d+)\]/g) || []).some((m) => map[m.slice(1, -1)])).map((t) => t.replace(/\s*\[\d+\]/g, ""));
  return { ...res, industries, cross_region: cross, droppedCross: res.cross_region.length - cross.length };
}
