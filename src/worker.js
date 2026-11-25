import { passwordOk, makeCookie, clearCookie, isAuthed } from "./auth.js";
import * as src from "./sources.js";
import * as gv from "./global.js";
import * as nw from "./news.js";
import * as co from "./company.js";
import * as vf from "./verify.js";
import * as fd from "./feeds.js";
import * as ex from "./experts.js";
import * as lt from "./lights.js";
import * as sc from "./score.js";
import * as cn from "./cn.js";
import * as ch from "./chart.js";
import * as ai from "./ai.js";
import * as id from "./intraday.js";
import * as qt from "./quarters.js";
import * as sm from "./sectors.js";
export { Live } from "./live.js";

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

// 같은 종목을 짧은 시간에 여러 번 부르면 외부 API를 다시 부르지 않는다 (무료 한도 보호).
async function cached(request, ttl, produce) {
  const c = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(new URL(request.url).toString().replace(/^https?:/, "https:"), { method: "GET" });
  if (c) {
    const hit = await c.match(key);
    if (hit) return hit;
  }
  const body = await produce();
  const res = new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `private, max-age=${ttl}` } });
  // 일부라도 실패한 결과는 저장하지 않는다 (한도 초과 같은 일시 오류가 15분 동안 남지 않게).
  const failed = body && body.errors && Object.keys(body.errors).length > 0;
  if (c && !failed) await c.put(key, res.clone());
  return res;
}

// 캐시(또는 방금 만든) 응답을 매번 새로 받은 것처럼 내보낸다. 쿠키 연장 헤더를 같이 붙인다.
const pass = (res, extra = {}) => new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

// 로그인 시도 제한: 한 IP가 15분에 5번, 전체가 1시간에 30번을 넘으면 새 로그인을 잠근다.
// 이미 로그인한 기기는 쿠키로 들어오므로 전체 잠금이 걸려도 계속 쓸 수 있다.
const IP_MAX = 5, IP_WIN = 15 * 60000, ALL_MAX = 30, ALL_WIN = 60 * 60000;

// 기기 사이에 맞추는 작은 저장소 (Durable Object 하나가 JSON 하나를 들고 있다). 로그인 시도 기록도 여기 둔다.
export class Store {
  constructor(state) { this.state = state; }
  // try: 잠겼는지 보고, 아니면 이번 시도를 실패로 먼저 적어 둔다(동시에 여러 번 보내도 한 번씩 센다). ok: 성공했으니 그 IP 기록과 이번 시도를 지운다.
  async guard({ op, ip, at }) {
    const now = Date.now(), g = (await this.state.storage.get("guard")) || { ips: {}, all: [] };
    g.all = g.all.filter((t) => now - t < ALL_WIN);
    for (const k of Object.keys(g.ips)) { g.ips[k] = g.ips[k].filter((t) => now - t < IP_WIN); if (!g.ips[k].length) delete g.ips[k]; }
    let out = { locked: false };
    if (op === "try") {
      const mine = g.ips[ip] || [];
      if (mine.length >= IP_MAX) out = { locked: true, wait: mine[0] + IP_WIN - now };
      else if (g.all.length >= ALL_MAX) out = { locked: true, wait: g.all[0] + ALL_WIN - now };
      else { g.ips[ip] = [...mine, now]; g.all.push(now); out = { locked: false, at: now }; }
    } else if (op === "ok") {
      delete g.ips[ip];
      const i = g.all.indexOf(at); if (i >= 0) g.all.splice(i, 1);
    }
    await this.state.storage.put("guard", g);
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  }
  async fetch(request) {
    if (new URL(request.url).pathname === "/guard") return this.guard(await request.json());
    if (request.method === "PUT") { await this.state.storage.put("data", await request.text()); return new Response("ok"); }
    return new Response((await this.state.storage.get("data")) || "null", { headers: { "Content-Type": "application/json" } });
  }
}
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
// 보유 종목 목록: 티커와 짧은 메모만 저장한다. 수량·평단·금액은 받지 않는다(증권사 앱에서 확인).
function cleanHold(a) {
  return (Array.isArray(a) ? a : []).slice(0, 20).filter((x) => x && TICKER_RE.test(String(x.t || ""))).map((x) => ({ t: x.t, memo: String(x.memo || "").slice(0, 400) }));
}
const store = (env) => (env.STORE ? env.STORE.get(env.STORE.idFromName("main")) : null);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secure = url.protocol === "https:";
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    src.setContact(env);
    if (!env.APP_PASSWORD || !env.FINNHUB_KEY) return json({ error: "서버 설정(APP_PASSWORD, FINNHUB_KEY)이 없습니다." }, 500);

    // 다른 사이트에서 보낸 쓰기 요청과 실시간 연결은 받지 않는다 (브라우저가 붙이는 Origin으로 확인).
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin && (request.method !== "GET" || request.headers.get("Upgrade") === "websocket")) return json({ error: "허용되지 않은 출처입니다." }, 403);

    if (url.pathname === "/api/login" && request.method === "POST") {
      const st = store(env), ip = request.headers.get("CF-Connecting-IP") || "local";
      // 저장소가 없거나 실패하면 제한 없이 진행한다 (주인이 못 들어가는 일은 없게).
      const guard = async (o) => { if (!st) return {}; try { return await (await st.fetch("https://store/guard", { method: "POST", body: JSON.stringify({ ...o, ip }) })).json(); } catch { return {}; } };
      const g = await guard({ op: "try" });
      if (g.locked) { const m = Math.max(1, Math.ceil(g.wait / 60000)); return json({ error: `로그인 시도가 너무 많습니다. ${m}분 뒤에 다시 해 보세요.` }, 429, { "Retry-After": String(m * 60) }); }
      let body = {};
      try { body = await request.json(); } catch {}
      if (await passwordOk(env, body.password ?? "")) {
        await guard({ op: "ok", at: g.at });
        return json({ ok: true }, 200, { "Set-Cookie": await makeCookie(env, secure) });
      }
      await new Promise((r) => setTimeout(r, 800));
      return json({ error: "비밀번호가 맞지 않습니다." }, 401);
    }
    if (url.pathname === "/api/logout" && request.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearCookie(secure) });

    if (!(await isAuthed(env, request))) return json({ error: "로그인이 필요합니다." }, 401);

    // 열 때마다 만료일을 새로 늘린다.
    const renew = { "Set-Cookie": await makeCookie(env, secure) };
    if (url.pathname === "/api/me") return json({ ok: true }, 200, renew);

    if (url.pathname === "/api/macro") {
      try {
        return pass(await cached(request, 21600, () => gv.macroView(env)), renew);
      } catch (e) { return json({ error: e.message }, 502); }
    }

    if (url.pathname === "/api/accuracy") {
      const list = [...new Set((url.searchParams.get("t") || "").split(",").map((x) => x.trim().toUpperCase()))].filter((x) => TICKER_RE.test(x)).slice(0, 14);
      if (!list.length) return json({ error: "티커가 없습니다." }, 400);
      return pass(await cached(request, 21600, () => gv.accuracyView(env, list)), renew);
    }

    if (url.pathname === "/api/sync") {
      const st = store(env);
      if (!st) return json({ error: "서버 저장소가 없습니다." }, 501, renew);
      if (request.method === "PUT") {
        const raw = await request.text();
        if (raw.length > 300000) return json({ error: "너무 큽니다." }, 413, renew);
        let o; try { o = JSON.parse(raw); } catch { return json({ error: "형식 오류" }, 400, renew); }
        const clean = { at: Number(o.at) || Date.now(), watch: Array.isArray(o.watch) ? o.watch.filter((x) => TICKER_RE.test(x)).slice(0, 40) : [], kw: typeof o.kw === "string" ? o.kw.slice(0, 600) : "", notes: o.notes && typeof o.notes === "object" ? o.notes : {}, hold: cleanHold(o.hold) };
        await st.fetch("https://store/", { method: "PUT", body: JSON.stringify(clean) });
        return json({ ok: true }, 200, renew);
      }
      const r = await st.fetch("https://store/");
      return new Response(await r.text(), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...renew } });
    }
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
      if (q.length < 1) return json({ rows: [] }, 200, renew);
      try {
        const res = await cached(request, 86400, async () => {
          const d = await src.fh(env, "search", { q });
          return { rows: ((d && d.result) || []).filter((x) => x.type === "Common Stock" && x.symbol && !x.symbol.includes(".")).slice(0, 8).map((x) => ({ symbol: x.symbol, name: x.description || "" })) };
        });
        return pass(res, renew);
      } catch (e) { return json({ error: e.message }, 502); }
    }

    if (url.pathname === "/api/cnnews" || url.pathname === "/api/cnquote") {
      try {
        return pass(await cached(request, url.pathname === "/api/cnnews" ? 900 : 600, () => (url.pathname === "/api/cnnews" ? cn.chinaNews() : cn.chinaQuotes())), renew);
      } catch (e) { return json({ error: e.message }, 502); }
    }
    if (url.pathname === "/api/quotes") {
      const list = [...new Set((url.searchParams.get("t") || "").split(",").map((x) => x.trim().toUpperCase()))].filter((x) => TICKER_RE.test(x)).slice(0, 15);
      if (!list.length) return json({ error: "티커가 없습니다." }, 400, renew);
      return pass(await cached(request, 120, async () => ({ rows: await Promise.all(list.map(async (t) => { try { const q = await src.quote(env, t); return { t, price: q.price, pct: q.pct }; } catch (e) { return { t, error: e.message }; } })) })), renew);
    }
    if (url.pathname === "/api/usdkrw") {
      try {
        return pass(await cached(request, 300, () => nw.usdKrw()), renew);
      } catch (e) { return json({ error: e.message }, 502); }
    }
    if (url.pathname === "/api/fx") {
      try {
        return pass(await cached(request, 21600, () => nw.fxRates()), renew);
      } catch (e) { return json({ error: e.message }, 502); }
    }
    if (url.pathname === "/api/newsmkt" || url.pathname === "/api/newsq") {
      try {
        const res = await cached(request, 900, async () => {
          if (url.pathname === "/api/newsmkt") return { articles: await nw.marketNews(env) };
          const risk = url.searchParams.get("risk") === "1";
          const words = risk ? nw.riskWords() : (url.searchParams.get("k") || "").split(",").map((x) => x.trim()).filter((x) => x && x.length <= 40 && !/["\\]/.test(x)).slice(0, 20);
          if (!words.length) throw new Error("키워드가 없습니다.");
          return { articles: await nw.keywordNews(env, words, risk ? { size: 25 } : {}) };
        });
        return pass(res, renew);
      } catch (e) { return json({ error: e.message }, e.message.includes("NEWSAPI_KEY") ? 501 : 502); }
    }

    if (url.pathname === "/api/aibrief" && request.method === "POST") {
      try {
        const raw = await request.text();
        if (raw.length > 16000) return json({ error: "자료가 너무 큽니다." }, 413, renew);
        let b = {}; try { b = JSON.parse(raw); } catch {}
        if (!b.digest) return json({ error: "자료가 없습니다." }, 400, renew);
        if (b.mode === "prompt") return json(ai.briefPrompt(String(b.digest)), 200, renew);
        return json(await ai.brief(env, String(b.digest)), 200, renew);
      } catch (e) { return json({ error: e.message }, e.message.includes("_KEY") ? 501 : 502, renew); }
    }
    if (url.pathname === "/api/aiwarn" && request.method === "POST") {
      try {
        const raw = await request.text();
        if (raw.length > 16000) return json({ error: "자료가 너무 큽니다." }, 413, renew);
        let b = {}; try { b = JSON.parse(raw); } catch {}
        if (!b.digest) return json({ error: "자료가 없습니다." }, 400, renew);
        if (b.mode === "prompt") return json(ai.warnPrompt(String(b.digest)), 200, renew);
        return json(await ai.warn(env, String(b.digest)), 200, renew);
      } catch (e) { return json({ error: e.message }, e.message.includes("_KEY") ? 501 : 502, renew); }
    }
    for (const [path, mk, mkPrompt] of [["/api/aiscore", (d) => ai.scoreAi(env, d), (d) => ai.scorePrompt(d)], ["/api/aiindustry", (d) => ai.industryAi(env, d), (d) => ai.industryPrompt(d)]]) {
      if (url.pathname === path && request.method === "POST") {
        try {
          const raw = await request.text();
          if (raw.length > 18000) return json({ error: "자료가 너무 큽니다." }, 413, renew);
          let b = {}; try { b = JSON.parse(raw); } catch {}
          if (!b.digest) return json({ error: "자료가 없습니다." }, 400, renew);
          if (b.mode === "prompt") return json(mkPrompt(String(b.digest)), 200, renew);
          return json(await mk(String(b.digest)), 200, renew);
        } catch (e) { return json({ error: e.message }, e.message.includes("_KEY") ? 501 : 502, renew); }
      }
    }
    if (url.pathname === "/api/holidays") {
      try { return pass(await cached(request, 86400, async () => ({ days: ((await src.fh(env, "stock/market-holiday", { exchange: "US" })).data || []).map((x) => ({ date: x.atDate, hours: x.tradingHour || "", name: x.eventName || "" })) })), renew); }
      catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/sectors") {
      try { return pass(await cached(request, 900, () => sm.sectorMoves(env)), renew); }
      catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/trustedgroups") return json({ groups: fd.GROUPS.map((g) => ({ id: g.id, label: g.label, n: g.feeds.length })) }, 200, renew);
    if (url.pathname === "/api/trusted") {
      const g = (url.searchParams.get("g") || "us").replace(/[^a-z0-9]/g, "");
      if (!fd.GROUPS.some((x) => x.id === g)) return json({ error: "없는 묶음입니다." }, 400, renew);
      return pass(await cached(request, 600, () => fd.trustedNews(g)), renew);
    }
    if (url.pathname === "/api/fund") {
      try {
        const id = (url.searchParams.get("id") || "").trim();
        if (!/^\d{3,10}$/.test(id)) return json({ error: "투자자 번호가 올바르지 않습니다." }, 400, renew);
        return pass(await cached(request, 21600, () => ex.fundCard(id)), renew);
      } catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/funds") return json({ funds: ex.FUNDS }, 200, renew);
    if (url.pathname === "/api/names") {
      try {
        const list = (url.searchParams.get("t") || "").toUpperCase().split(",").filter((x) => TICKER_RE.test(x)).slice(0, 30);
        if (!list.length) return json({ names: {} }, 200, renew);
        return pass(await cached(request, 86400, async () => ({ names: await ex.names(list) })), renew);
      } catch (e) { return json({ error: e.message }, 502, renew); }
    }
    // 실시간 체결: 로그인 쿠키를 확인한 뒤 WebSocket을 중계 객체(LIVE)로 넘긴다. 구독 종목은 연결 뒤 메시지로 받는다.
    if (url.pathname === "/api/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket 전용 주소입니다." }, 426, renew);
      if (!env.LIVE) return json({ error: "실시간 중계가 설정되지 않았습니다." }, 501, renew);
      return env.LIVE.get(env.LIVE.idFromName("finnhub")).fetch(new Request("https://live/" + url.search, request));
    }
    const t = (url.searchParams.get("t") || "").trim().toUpperCase();
    if (!TICKER_RE.test(t)) return json({ error: "티커 형식이 올바르지 않습니다." }, 400);

    if (url.pathname === "/api/ticker") {
      return pass(await cached(request, 900, () => src.ticker(env, t)), renew);
    }
    if (url.pathname === "/api/company") {
      return pass(await cached(request, 21600, () => co.companyCard(env, t)), renew);
    }
    if (url.pathname === "/api/verify") {
      try {
        return pass(await cached(request, 7200, () => vf.verifyCard(env, t)), renew);
      } catch (e) { return json({ error: e.message }, 502); }
    }
    if (url.pathname === "/api/experts") {
      try {
        return pass(await cached(request, 1800, () => ex.tickerExperts(env, t)), renew);
      } catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/score") {
      try {
        return pass(await cached(request, 21600, () => sc.scoreCard(env, t)), renew);
      } catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/quarters") {
      try { return pass(await cached(request, 21600, () => qt.quarterCard(env, t)), renew); }
      catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/peerval") {
      try {
        return pass(await cached(request, 21600, () => sc.peerMultiples(env, t)), renew);
      } catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/lights") {
      try {
        return pass(await cached(request, 1800, () => lt.lightsCard(env, t)), renew);
      } catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/intraday") {
      try {
        const r = ["1d", "5d", "1mo"].includes(url.searchParams.get("r")) ? url.searchParams.get("r") : "1d";
        return pass(await cached(request, 60, () => id.intraday(t, r)), renew);
      } catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/live") {
      try { const q = await src.quote(env, t); return json({ t, price: q.price, pct: q.pct, prev: q.prev, at: Date.now() }, 200, renew); }
      catch (e) { return json({ error: e.message }, 502, renew); }
    }
    if (url.pathname === "/api/chart") {
      try {
        return pass(await cached(request, 21600, async () => { const r = await ch.chartBars(env, t); if (r.note && r.source.startsWith("Massive") === false && env.MASSIVE_KEY) return { ...r, errors: { massive: r.note } }; return r; }), renew);
      } catch (e) { return json({ error: e.message }, 502); }
    }
    if (url.pathname === "/api/ai") {
      try {
        if (request.method === "POST") {
          let b = {}; try { b = await request.json(); } catch {}
          if (b.mode === "prompt") return json(await ai.opinionPrompt(env, t, String(b.memo || "").slice(0, 400)), 200, renew);
          const out = await ai.opinion(env, t, String(b.memo || "").slice(0, 400));
          return json(out, 200, renew);
        }
        return pass(await cached(request, 1800, () => ai.opinion(env, t, "")), renew);
      } catch (e) { return json({ error: e.message }, e.message.includes("_KEY") ? 501 : 502); }
    }
    if (url.pathname === "/api/earn") {
      try {
        return pass(await cached(request, 21600, () => src.earnings(env, t)), renew);
      } catch (e) { return json({ error: e.message }, 502); }
    }
    if (url.pathname === "/api/news") {
      try {
        return pass(await cached(request, 900, async () => ({ articles: await nw.companyNews(env, t) })), renew);
      } catch (e) { return json({ error: e.message }, 502); }
    }
    if (url.pathname === "/api/global") {
      return pass(await cached(request, 1800, () => gv.globalView(env, t)), renew);
    }
    if (url.pathname === "/api/peers") {
      try {
        return pass(await cached(request, 3600, async () => ({ rows: await src.peers(env, t) })), renew);
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }
    return json({ error: "없는 주소" }, 404);
  },
};
