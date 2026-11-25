// AI 의견 — 공급자를 바꿔 끼울 수 있게 호출부만 따로 둔다. 기본 Gemini, AI_PROVIDER=anthropic 으로 전환 가능.
import * as src from "./sources.js";
import * as nw from "./news.js";
import * as ch from "./chart.js";
import { verifyCard, verifyText } from "./verify.js";

const SYSTEM = `당신은 개인 투자자가 이미 보유 중인 종목을 점검하도록 돕는 리서치 보조입니다. 사고팔라고 지시하지 말고, 전망을 점검해 주세요. 아래 '제공된 자료'만 근거로 쓰고, 자료에 없는 사실은 지어내지 마세요. 모르면 모른다고 쓰세요.
확정적 예측이나 수익 보장은 하지 않습니다. 주가 추세는 과거 값일 뿐 미래를 보장하지 않으며, 자료끼리 엇갈리면 그 점을 위험으로 적으세요. 기업 발표·뉴스의 주장은 그대로 믿지 말고 '교차 점검' 결과와 대조하세요(불일치·주의 항목은 bear에 반영). bull/bear의 각 항목 끝에 근거가 된 자료 이름을 괄호로 붙이세요(예: (애널리스트), (주가 추세)). 반드시 아래 JSON만 출력하세요(한국어):
{"stance":"긍정|중립|부정"(향후 1~3개월 전망 관점),"confidence":0~100 정수,"summary":"두세 문장 요약","bull":["상승 근거 최대 3개"],"bear":["하락·위험 근거 최대 3개"],"invalidate":"이 판단이 틀렸다고 볼 조건 한 문장","watch":["다음에 확인할 것 최대 3개"]}`;

const fmt = (n) => (n == null ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));

const pc = (x) => (x == null || !isFinite(x) ? "-" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%");
export function trendLines(bars, spyBars) {
  const c = (bars || []).map((b) => b[4]).filter((x) => x > 0), n = c.length;
  if (n < 30) return [];
  const sc = (spyBars || []).map((b) => b[4]).filter((x) => x > 0), m = sc.length;
  const ret = (a, k) => (a.length > k ? a[a.length - 1] / a[a.length - 1 - k] - 1 : null);
  const avg = (a, k) => a.slice(-k).reduce((s, x) => s + x, 0) / Math.min(k, a.length);
  const out = [];
  out.push("주가 추세(일봉 종가): " + [["1개월", 21], ["3개월", 63], ["6개월", 126], ["1년", 252]].filter(([, k]) => n > k).map(([l, k]) => `${l} ${pc(ret(c, k))}${m > k ? ` (SPY ${pc(ret(sc, k))})` : ""}`).join(", "));
  const w = c.slice(-252), hi = Math.max(...w), lo = Math.min(...w);
  out.push(`52주 범위: 저가 ${lo.toFixed(2)} ~ 고가 ${hi.toFixed(2)}, 현재는 범위의 ${hi > lo ? Math.round(((c[n - 1] - lo) / (hi - lo)) * 100) : 50}% 위치 (고가 대비 ${pc(c[n - 1] / hi - 1)})`);
  const ma = [50, 200].filter((k) => n >= k).map((k) => `${k}일 이동평균 대비 ${pc(c[n - 1] / avg(c, k) - 1)}`);
  if (ma.length) out.push(ma.join(", "));
  const r = []; for (let i = n - 20; i < n; i++) if (i > 0) r.push(Math.log(c[i] / c[i - 1]));
  if (r.length > 10) { const mu = r.reduce((s, x) => s + x, 0) / r.length, sd = Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / (r.length - 1)); out.push(`최근 20일 연환산 변동성 약 ${Math.round(sd * Math.sqrt(252) * 100)}%`); }
  const v = (bars || []).map((b) => b[5]).filter((x) => x > 0);
  if (v.length > 60) out.push(`최근 5일 평균 거래량은 60일 평균의 ${Math.round((avg(v, 5) / avg(v, 60)) * 100)}%`);
  return out;
}

async function gather(env, t, memo) {
  const [q, e, a, i, n, hb, sb, vf] = await Promise.allSettled([src.quote(env, t), src.earnings(env, t), src.analyst(env, t), src.insider(env, t), nw.companyNews(env, t, 5), ch.chartBars(env, t), t === "SPY" ? Promise.resolve({ bars: [] }) : ch.chartBars(env, "SPY"), verifyCard(env, t)]);
  const L = [`종목: ${t}`];
  if (memo) L.push(`사용자 메모(보유 이유·재검토 조건): ${memo}\n→ 이 메모의 가정이 아직 유효한지 자료와 대조해 summary나 invalidate에 반영하세요.`);
  if (q.status === "fulfilled") L.push(`현재가 ${fmt(q.value.price)}, 전일 대비 ${fmt(q.value.pct)}%`);
  if (e.status === "fulfilled") {
    const v = e.value;
    L.push(`다음 실적발표: ${v.date || "미확정"}${v.epsEst != null ? ` (EPS 예상 ${fmt(v.epsEst)})` : ""}`);
    if (v.last) L.push(`직전 실적: ${v.last.date} EPS 실제 ${fmt(v.last.epsActual)} / 예상 ${fmt(v.last.epsEst)}`);
  }
  if (hb.status === "fulfilled") L.push(...trendLines(hb.value.bars, sb.status === "fulfilled" ? sb.value.bars : []));
  if (a.status === "fulfilled") L.push(`애널리스트(${a.value.period}): 매수 ${a.value.pos} · 중립 ${a.value.neu} · 매도 ${a.value.neg}`);
  if (i.status === "fulfilled") L.push(`내부자 거래(180일): 매수 ${i.value.buyN}건 ($${fmt(i.value.buyValue)}), 매도 ${i.value.sellN}건 ($${fmt(i.value.sellValue)})`);
  if (n.status === "fulfilled" && n.value.length) L.push("최근 뉴스 제목:\n" + n.value.slice(0, 12).map((x) => "- " + String(x.title || x.headline || "").slice(0, 140)).join("\n"));
  if (vf.status === "fulfilled") { const vt = verifyText(vf.value); if (vt) L.push(vt); }
  return L.join("\n");
}

export const DEFAULT_MODEL = "gemini-4-argon";
const errMsg = async (r) => { try { const j = await r.json(); return ((j.error || {}).message || "").slice(0, 160); } catch { return ""; } };

// Gemini 4 계열은 Interactions API(v1beta/interactions)로, 그 이전 모델은 generateContent로 부른다.
// 같은 JSON 지시문을 쓰고 응답에서 {...}만 뽑아 쓰므로 JSON 모드 필드에 의존하지 않는다.
async function gemini(env, system, prompt) {
  if (!env.GEMINI_KEY) throw new Error("GEMINI_KEY가 서버에 없습니다. Cloudflare Secret으로 추가하세요.");
  const model = env.AI_MODEL || DEFAULT_MODEL, h = { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY };
  const interactions = /^gemini-[4-9]/.test(model) || env.AI_API === "interactions";
  const r = interactions
    ? await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: h, body: JSON.stringify({ model, input: prompt, system_instruction: system, generation_config: { thinking_level: env.AI_THINKING || "low", max_output_tokens: 6000 } }) })
    : await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: h, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { ...(/gemini-2/.test(model) ? { temperature: 0.3 } : {}), responseMimeType: "application/json", maxOutputTokens: 2500 } }) });
  if (r.status === 429) throw new Error("Gemini 호출 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.");
  if (r.status === 403 || r.status === 401) throw new Error(`Gemini 인증/권한 오류 (${model}) — 키와 결제(유료 티어) 설정을 확인하세요. ${await errMsg(r)}`);
  if (!r.ok) throw new Error(`Gemini 오류 ${r.status} (${model})${(await errMsg(r)) ? ": " + (await errMsg(r)) : ""}`);
  const d = await r.json();
  let text = "";
  if (interactions) {
    if (typeof d.output_text === "string") text = d.output_text;
    for (const st of d.steps || []) if (st.type === "model_output") for (const c of st.content || []) if (c.type === "text") text += c.text || "";
    if (!text) for (const c of d.outputs || []) if (c.type === "text") text += c.text || "";
    if (d.status && d.status !== "completed" && !text) throw new Error(`Gemini 응답 상태: ${d.status}`);
  } else text = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts ? d.candidates[0].content.parts.map((p) => p.text || "").join("") : "";
  if (!text) throw new Error("Gemini가 빈 응답을 보냈습니다(안전 필터이거나 응답 형식이 달라졌을 수 있음).");
  return { text, model };
}

async function anthropic(env, system, prompt) {
  if (!env.ANTHROPIC_KEY) throw new Error("ANTHROPIC_KEY가 서버에 없습니다.");
  const model = env.AI_MODEL || "claude-haiku-4-5-20251001";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1500, temperature: 0.3, system, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Anthropic 오류 ${r.status}`);
  const d = await r.json();
  return { text: (d.content || []).map((c) => c.text || "").join(""), model };
}
const callModel = (env, system, prompt) => ((env.AI_PROVIDER || "gemini").toLowerCase() === "anthropic" ? anthropic : gemini)(env, system, prompt);

const list = (a) => (Array.isArray(a) ? a.slice(0, 3).map((x) => String(x).slice(0, 200)) : []);
export function parseOpinion(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 응답을 해석하지 못했습니다.");
  const o = JSON.parse(m[0]);
  const stance = ["긍정", "중립", "부정"].includes(o.stance) ? o.stance : "중립";
  const c = Math.max(0, Math.min(100, Math.round(Number(o.confidence) || 0)));
  return { stance, confidence: c, summary: String(o.summary || "").slice(0, 600), bull: list(o.bull), bear: list(o.bear), invalidate: String(o.invalidate || "").slice(0, 300), watch: list(o.watch) };
}

export async function opinion(env, t, memo = "") {
  const data = await gather(env, t, memo);
  const { text, model } = await callModel(env, SYSTEM, "제공된 자료:\n" + data + "\n\n위 자료만으로 이 종목의 전망 점검 결과를 JSON으로 주세요.");
  return { t, ...parseOpinion(text), model, at: new Date().toISOString() };
}

// ---- 브리핑: 앱이 이미 모은 관심종목 신호를 한 번에 요약한다 ----
const BRIEF_SYSTEM = `당신은 개인 투자자의 관심종목 브리핑을 쓰는 보조입니다. 아래 '제공된 자료'만 근거로 쓰고, 자료에 없는 사실은 지어내지 마세요. 사고팔라고 지시하거나 수익을 단정하지 마세요. 영향의 크기를 예측하지 말고, 무엇을 먼저 확인할지 정리하세요.
반드시 아래 JSON만 출력하세요(한국어):
{"headline":"오늘의 핵심 한두 문장","items":[{"t":"티커","level":"주의|참고","note":"한 문장, 근거 자료 포함"}],"today":["오늘·이번 주 확인할 일정/행동 최대 4개"],"caveat":"이 브리핑의 한계 한 문장"}
items는 가장 중요한 순서로 최대 8개입니다.`;
export function parseBrief(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 응답을 해석하지 못했습니다.");
  const o = JSON.parse(m[0]);
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 8).map((x) => ({ t: String(x.t || "").toUpperCase().slice(0, 10), level: x.level === "주의" ? "주의" : "참고", note: String(x.note || "").slice(0, 300) })).filter((x) => x.t && x.note);
  return { headline: String(o.headline || "").slice(0, 400), items, today: list4(o.today), caveat: String(o.caveat || "").slice(0, 200) };
}
const list4 = (a) => (Array.isArray(a) ? a.slice(0, 4).map((x) => String(x).slice(0, 200)) : []);
export async function brief(env, digest) {
  const { text, model } = await callModel(env, BRIEF_SYSTEM, "제공된 자료(관심종목별 신호):\n" + String(digest).slice(0, 12000) + "\n\n위 자료만으로 오늘의 브리핑을 JSON으로 주세요.");
  return { ...parseBrief(text), model, at: new Date().toISOString() };
}

// ---- API 없이 쓰는 방법: Gemini 앱에 붙여넣을 요약 자료(프롬프트 + 데이터)를 만든다 ----
const COPY_OPINION = `당신은 개인 투자자가 이미 보유 중인 종목을 점검하도록 돕는 리서치 보조입니다. 아래 '제공된 자료'만 근거로 쓰고, 자료에 없는 사실은 지어내지 마세요. 모르면 모른다고 쓰세요. 사고팔라고 지시하거나 수익을 보장하지 마세요. 주가 추세는 과거 값일 뿐입니다. 기업 발표·뉴스의 주장은 그대로 믿지 말고 '교차 점검' 결과와 대조하고, 불일치·주의 항목은 위험 요인에 반영하세요.
다음 형식의 한국어로 답하세요:
1) 전망 점검: 긍정/중립/부정 중 하나 + 확신도(0~100%) — 향후 1~3개월 관점
2) 핵심 요약 (2~3문장)
3) 긍정 근거 (최대 3개, 각 항목 끝에 근거 자료 이름을 괄호로)
4) 위험 요인 (최대 3개, 같은 방식)
5) 이 전망이 틀렸다고 볼 조건 (한 문장)
6) 다음에 확인할 것 (최대 3개)`;
const COPY_BRIEF = `당신은 개인 투자자의 관심종목 브리핑을 쓰는 보조입니다. 아래 '제공된 자료'만 근거로 쓰고, 자료에 없는 사실은 지어내지 마세요. 사고팔라고 지시하거나 수익을 단정하지 말고, 영향의 크기를 예측하지 말고 무엇을 먼저 확인할지 정리하세요.
다음 형식의 한국어로 답하세요:
1) 오늘의 핵심 (한두 문장)
2) 종목별 (중요한 순서로 최대 8개): [주의 또는 참고] 티커 — 한 문장, 근거 자료 포함
3) 오늘·이번 주 확인할 것 (최대 4개)
4) 이 브리핑의 한계 (한 문장)`;
export async function opinionPrompt(env, t, memo = "") {
  return { prompt: COPY_OPINION + "\n\n제공된 자료:\n" + (await gather(env, t, memo)) };
}
export function briefPrompt(digest) {
  return { prompt: COPY_BRIEF + "\n\n제공된 자료(관심종목별 신호):\n" + String(digest).slice(0, 12000) };
}

// ---- 위험·포지션 경고: 앱이 규칙으로 만든 경고등 목록을 AI가 종합해 읽어준다 ----
const WARN_SYSTEM = `당신은 개인 투자자의 보유 종목 위험 점검을 돕는 보조입니다. 아래 '제공된 자료'(종목별 경고등과 업종)만 근거로 쓰고, 자료에 없는 사실은 지어내지 마세요. 사고팔라고 지시하거나 수익·손실을 단정하지 말고, 무엇을 먼저 확인할지 정리하세요. 수량·비중 정보는 없으므로 집중도는 종목 수·업종 쏠림으로만 말하세요. 같은 업종·테마가 많으면 서로 같이 움직일 위험으로 짚으세요.
반드시 아래 JSON만 출력하세요(한국어):
{"headline":"포트폴리오 전체 위험을 한두 문장으로","level":"초록|노랑|빨강","items":[{"t":"티커","level":"초록|노랑|빨강","reason":"경고등 근거를 묶은 한 문장","check":"먼저 확인할 것 한 문장"}],"portfolio":["종목 간 겹침·쏠림·일정 집중 등 포트폴리오 수준 경고 최대 3개"],"caveat":"한계 한 문장"}
items는 위험이 큰 순서로 최대 8개입니다.`;
const lv = (x) => (["초록", "노랑", "빨강"].includes(x) ? x : "노랑");
export function parseWarn(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 응답을 해석하지 못했습니다.");
  const o = JSON.parse(m[0]);
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 8).map((x) => ({ t: String(x.t || "").toUpperCase().slice(0, 10), level: lv(x.level), reason: String(x.reason || "").slice(0, 300), check: String(x.check || "").slice(0, 240) })).filter((x) => x.t && x.reason);
  return { headline: String(o.headline || "").slice(0, 400), level: lv(o.level), items, portfolio: list(o.portfolio), caveat: String(o.caveat || "").slice(0, 200) };
}
export async function warn(env, digest) {
  const { text, model } = await callModel(env, WARN_SYSTEM, "제공된 자료(종목별 경고등):\n" + String(digest).slice(0, 12000) + "\n\n위 자료만으로 위험 점검 결과를 JSON으로 주세요.");
  return { ...parseWarn(text), model, at: new Date().toISOString() };
}
const COPY_WARN = `당신은 개인 투자자의 보유 종목 위험 점검을 돕는 보조입니다. 아래 '제공된 자료'(종목별 경고등과 업종)만 근거로 쓰고, 자료에 없는 사실은 지어내지 마세요. 사고팔라고 지시하거나 수익·손실을 단정하지 마세요. 수량·비중 정보는 없으므로 집중도는 종목 수·업종 쏠림으로만 말하고, 같은 업종·테마가 많으면 같이 움직일 위험으로 짚어주세요.
다음 형식의 한국어로 답하세요:
1) 포트폴리오 전체 위험 (초록/노랑/빨강 + 한두 문장)
2) 종목별 (위험 큰 순서로 최대 8개): [색] 티커 — 경고등 근거 한 문장 / 먼저 확인할 것 한 문장
3) 포트폴리오 수준 경고 (겹침·쏠림·일정 집중, 최대 3개)
4) 이 점검의 한계 (한 문장)`;
export function warnPrompt(digest) {
  return { prompt: COPY_WARN + "\n\n제공된 자료(종목별 경고등):\n" + String(digest).slice(0, 12000) };
}

// ---- 기업 점수표 해석: 앱이 계산한 점수·지표·리스크를 업종 맥락에서 읽어준다 ----
const SCORE_SYSTEM = `당신은 개인 투자자의 기업 재무 점검을 돕는 보조입니다. 아래 '제공된 자료'(앱이 규칙으로 계산한 안정도 점수표, 재무 지표, 동종업체 비교, 최근 리스크 목록, 업종)만 근거로 쓰고, 자료에 없는 사실은 지어내지 마세요. 사고팔라고 지시하거나 주가를 예측하지 마세요. 점수 기준은 업종과 무관한 경험칙이므로, 업종 특성(예: 은행·리츠는 부채가 구조적으로 많음, 성장주는 PER이 높음, 반도체는 경기 순환)을 고려해 점수가 과하게 낮거나 높게 나온 항목이 있으면 짚으세요.
반드시 아래 JSON만 출력하세요(한국어):
{"verdict":"안정|보통|주의|위험","headline":"한두 문장 총평","strengths":["강점 최대 3개(근거 지표 포함)"],"concerns":["우려 최대 3개(근거 지표 포함)"],"industry_note":"업종 맥락에서 점수를 어떻게 읽어야 하는지 한두 문장","check":["다음에 확인할 것 최대 3개"],"caveat":"한계 한 문장"}`;
const vd = (x) => (["안정", "보통", "주의", "위험"].includes(x) ? x : "보통");
export function parseScore(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 응답을 해석하지 못했습니다.");
  const o = JSON.parse(m[0]);
  return { verdict: vd(o.verdict), headline: String(o.headline || "").slice(0, 400), strengths: list(o.strengths), concerns: list(o.concerns), industry_note: String(o.industry_note || "").slice(0, 400), check: list(o.check), caveat: String(o.caveat || "").slice(0, 200) };
}
export async function scoreAi(env, digest) {
  const { text, model } = await callModel(env, SCORE_SYSTEM, "제공된 자료:\n" + String(digest).slice(0, 12000) + "\n\n위 자료만으로 이 기업의 재무 안정도 해석을 JSON으로 주세요.");
  return { ...parseScore(text), model, at: new Date().toISOString() };
}
const COPY_SCORE = `당신은 개인 투자자의 기업 재무 점검을 돕는 보조입니다. 아래 '제공된 자료'(앱이 규칙으로 계산한 안정도 점수표, 재무 지표, 동종업체 비교, 최근 리스크, 업종)만 근거로 쓰고, 자료에 없는 사실은 지어내지 마세요. 사고팔라고 지시하거나 주가를 예측하지 마세요. 점수 기준은 업종과 무관한 경험칙이므로 업종 특성(은행·리츠의 높은 부채, 성장주의 높은 PER, 반도체의 경기 순환 등)을 고려해 점수가 과하게 나온 항목을 짚어주세요.
다음 형식의 한국어로 답하세요:
1) 총평: 안정/보통/주의/위험 중 하나 + 한두 문장
2) 강점 (최대 3개, 근거 지표 포함)
3) 우려 (최대 3개, 근거 지표 포함)
4) 업종 맥락에서 점수 읽는 법 (한두 문장)
5) 다음에 확인할 것 (최대 3개)
6) 이 점검의 한계 (한 문장)`;
export const scorePrompt = (digest) => ({ prompt: COPY_SCORE + "\n\n제공된 자료:\n" + String(digest).slice(0, 12000) });

// ---- 전 세계 뉴스 산업 동향 분석 ----
const IND_SYSTEM = `당신은 전 세계 경제 뉴스 제목을 읽고 산업 동향을 정리하는 리서치 보조입니다. 아래 '제공된 자료'(같은 소식을 묶은 '이야기' 목록과 업종 ETF 수익률)만 근거로 쓰고, 자료에 없는 사실·숫자·원인은 지어내지 마세요. 사고팔라고 지시하거나 주가를 예측하지 마세요.
근거 규칙: 이야기마다 [번호]가 있습니다. 모든 판단은 이 번호로 근거를 대야 하고, 번호를 댈 수 없는 내용은 쓰지 마세요. '1곳만 보도'는 확인되지 않은 소식으로 다루고, 공식기관이나 여러 곳이 보도한 이야기가 없는 산업은 trend를 중립으로 두고 근거가 약하다고 쓰세요. 강세·약세는 뉴스 논조이지 주가 전망이 아닙니다. 업종 ETF 수익률은 뉴스를 검증하는 값입니다. 뉴스 논조와 가격이 엇갈리면 숨기지 말고 위험에 적으세요. 제목과 짧은 요약만 본 것이므로 본문을 읽은 것처럼 쓰지 마세요. 지역 간 온도 차이(예: 미국은 강세인데 중국은 규제 우려)를 눈여겨보세요. 지역 표시는 [미국][유럽][일본][중국·대만][한국][기타]입니다.
반드시 아래 JSON만 출력하세요(한국어):
{"headline":"오늘 세계 산업 동향 한두 문장","industries":[{"name":"산업","trend":"강세|중립|약세","regions":"어느 지역에서 두드러지는지","ids":[근거 이야기 번호 1~4개],"evidence":"근거가 된 이야기 흐름 한 문장","risk":"함께 볼 위험 한 문장, 시장과 엇갈리면 그 내용"}],"cross_region":["지역 간 엇갈림·연결고리 최대 3개, 문장 끝에 근거 번호를 [12]처럼"],"watch":["앞으로 확인할 것 최대 4개"],"caveat":"한계 한 문장"}
industries는 중요한 순서로 최대 8개입니다.`;
const tr = (x) => (["강세", "중립", "약세"].includes(x) ? x : "중립");
export function parseInd(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 응답을 해석하지 못했습니다.");
  const o = JSON.parse(m[0]);
  const industries = (Array.isArray(o.industries) ? o.industries : []).slice(0, 8).map((x) => ({ name: String(x.name || "").slice(0, 40), trend: tr(x.trend), regions: String(x.regions || "").slice(0, 80), ids: (Array.isArray(x.ids) ? x.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 6), evidence: String(x.evidence || "").slice(0, 300), risk: String(x.risk || "").slice(0, 240) })).filter((x) => x.name);
  return { headline: String(o.headline || "").slice(0, 400), industries, cross_region: list(o.cross_region), watch: list4(o.watch), caveat: String(o.caveat || "").slice(0, 200) };
}
export async function industryAi(env, digest) {
  const { text, model } = await callModel(env, IND_SYSTEM, "제공된 자료:\n" + String(digest).slice(0, 15000) + "\n\n위 자료만으로 산업 동향 분석을 JSON으로 주세요.");
  return { ...parseInd(text), model, at: new Date().toISOString() };
}
const COPY_IND = `당신은 전 세계 경제 뉴스 제목을 읽고 산업 동향을 정리하는 리서치 보조입니다. 아래 '제공된 자료'(같은 소식을 묶은 '이야기' 목록과 업종 ETF 수익률)만 근거로 쓰고, 자료에 없는 사실·숫자·원인은 지어내지 마세요. 사고팔라고 지시하거나 주가를 예측하지 마세요.
근거 규칙: 이야기마다 [번호]가 있습니다. 모든 판단은 이 번호로 근거를 대야 하고, 번호를 댈 수 없는 내용은 쓰지 마세요. '1곳만 보도'는 확인되지 않은 소식으로 다루고, 공식기관이나 여러 곳이 보도한 이야기가 없는 산업은 trend를 중립으로 두고 근거가 약하다고 쓰세요. 강세·약세는 뉴스 논조이지 주가 전망이 아닙니다. 업종 ETF 수익률은 뉴스를 검증하는 값입니다. 뉴스 논조와 가격이 엇갈리면 숨기지 말고 위험에 적으세요. 제목과 짧은 요약만 본 것이므로 본문을 읽은 것처럼 쓰지 마세요. 일본어·중국어·독일어 등 외국어 제목은 번역해서 읽어주세요.
다음 형식의 한국어로 답하세요:
1) 오늘 세계 산업 동향 (한두 문장)
2) 산업별 (중요한 순서로 최대 8개): 산업 — 강세/중립/약세, 두드러지는 지역, 근거 이야기 번호와 내용, 함께 볼 위험(시장과 엇갈리면 그 내용)
3) 지역 간 엇갈림·연결고리 (최대 3개, 근거 번호 포함)
4) 앞으로 확인할 것 (최대 4개)
5) 이 분석의 한계 (한 문장)`;
export const industryPrompt = (digest) => ({ prompt: COPY_IND + "\n\n제공된 자료:\n" + String(digest).slice(0, 15000) });
