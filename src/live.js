// 실시간 체결 중계: Finnhub WebSocket(무료 키는 연결 1개)을 Durable Object 하나가 붙잡고,
// 앱마다 연결 하나로 여러 종목을 구독받아 종목별로 0.25초에 한 번씩 묶어서 나눠준다. 보는 화면이 없으면 바로 끊는다.
// 앱 → 서버: {"type":"sub","t":["NVDA","SPY"]} (매번 전체 목록), "ping"
// 서버 → 앱: {"type":"status","up":true}, {"type":"tick","t":"NVDA","p":123.4,"ts":체결시각(ms),"v":묶인 거래량}, "pong"
const FLUSH_MS = 250, MAX_CLIENTS = 20, MAX_SYMBOLS = 50, MAX_PER_CLIENT = 20;
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export class Live {
  constructor(state, env) {
    this.env = env;
    this.clients = new Map(); // 앱 쪽 소켓 -> 구독 종목 Set
    this.up = null; this.connecting = false; this.upTry = 0; this.upTimer = null;
    this.pending = new Map(); // 종목 -> 아직 안 보낸 { p, ts, v }
    this.last = new Map(); // 종목 -> 마지막 체결 (새로 구독한 화면에 바로 보여줄 것)
    this.flushTimer = null;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
    if (this.clients.size >= MAX_CLIENTS) return new Response("busy", { status: 503 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.clients.set(server, new Set());
    const drop = () => this.drop(server);
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);
    server.addEventListener("message", (e) => {
      if (e.data === "ping") return this.send(server, "pong");
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === "sub" && Array.isArray(m.t)) this.setSubs(server, m.t);
    });
    this.send(server, { type: "status", up: this.isUp() });
    // 예전 방식(?t=하나)으로 들어온 화면도 받아준다.
    const t = new URL(request.url).searchParams.get("t");
    if (t) this.setSubs(server, [t]);
    if (!this.isUp()) this.connect();
    return new Response(null, { status: 101, webSocket: client });
  }

  symbols() { const s = new Set(); for (const v of this.clients.values()) for (const t of v) s.add(t); return s; }
  isUp() { return !!this.up && this.up.readyState === 1; }
  send(ws, o) { try { ws.send(typeof o === "string" ? o : JSON.stringify(o)); } catch { this.drop(ws); } }
  upSend(o) { try { this.up.send(JSON.stringify(o)); } catch {} }

  // 이 화면의 구독을 새 목록으로 바꾸고, 전체 합이 달라진 만큼만 Finnhub에 구독·해제를 보낸다.
  setSubs(ws, list) {
    if (!this.clients.has(ws)) return;
    const before = this.symbols();
    const want = new Set(list.map((x) => String(x).toUpperCase()).filter((x) => TICKER_RE.test(x)).slice(0, MAX_PER_CLIENT));
    for (const t of [...want]) if (!before.has(t) && before.size + 1 > MAX_SYMBOLS) want.delete(t);
    const old = this.clients.get(ws);
    this.clients.set(ws, want);
    for (const t of want) if (!old.has(t)) { const k = this.last.get(t); if (k) this.send(ws, { type: "tick", t, p: k.p, ts: k.ts, v: 0 }); }
    this.diff(before);
  }
  diff(before) {
    const after = this.symbols();
    for (const t of before) if (!after.has(t)) this.pending.delete(t);
    if (!this.isUp()) return;
    for (const t of after) if (!before.has(t)) this.upSend({ type: "subscribe", symbol: t });
    for (const t of before) if (!after.has(t)) this.upSend({ type: "unsubscribe", symbol: t });
  }

  async connect() {
    if (this.connecting || this.isUp() || !this.clients.size) return;
    this.connecting = true; clearTimeout(this.upTimer);
    try {
      const r = await fetch(`https://ws.finnhub.io/?token=${encodeURIComponent(this.env.FINNHUB_KEY)}`, { headers: { Upgrade: "websocket" } });
      const ws = r.webSocket;
      if (!ws) throw new Error("HTTP " + r.status);
      ws.accept();
      this.up = ws; this.upTry = 0;
      ws.addEventListener("message", (e) => this.onUp(e.data));
      const gone = () => { if (this.up !== ws) return; this.up = null; this.broadcast({ type: "status", up: false }); this.retry(); };
      ws.addEventListener("close", gone);
      ws.addEventListener("error", gone);
      for (const s of this.symbols()) this.upSend({ type: "subscribe", symbol: s });
      this.broadcast({ type: "status", up: true });
    } catch { this.retry(); }
    finally { this.connecting = false; }
  }

  // 연결이 끊기거나 한도(429)에 걸리면 2초, 4초, … 최대 1분 간격으로 다시 붙는다.
  retry() {
    clearTimeout(this.upTimer);
    if (!this.clients.size) return;
    this.upTimer = setTimeout(() => this.connect(), Math.min(60000, 2000 * 2 ** this.upTry++));
  }
  broadcast(o) { for (const ws of this.clients.keys()) this.send(ws, o); }

  onUp(raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type !== "trade" || !Array.isArray(m.data)) return;
    const syms = this.symbols();
    for (const d of m.data) {
      if (!syms.has(d.s) || !(d.p > 0)) continue;
      const k = this.pending.get(d.s);
      if (!k) this.pending.set(d.s, { p: d.p, ts: d.t, v: d.v || 0 });
      else { if (d.t >= k.ts) { k.p = d.p; k.ts = d.t; } k.v += d.v || 0; }
    }
    if (this.pending.size && !this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  flush() {
    this.flushTimer = null;
    for (const [t, k] of this.pending) this.last.set(t, k);
    for (const [ws, subs] of this.clients) for (const [t, k] of this.pending) if (subs.has(t)) this.send(ws, { type: "tick", t, ...k });
    this.pending.clear();
  }

  drop(ws) {
    if (!this.clients.has(ws)) return;
    const before = this.symbols();
    this.clients.delete(ws);
    try { ws.close(1000); } catch {}
    if (this.clients.size) return this.diff(before);
    // 아무도 안 보면 Finnhub 연결을 닫아 객체가 잠들 수 있게 한다.
    this.pending.clear();
    clearTimeout(this.upTimer); clearTimeout(this.flushTimer); this.flushTimer = null;
    const up = this.up; this.up = null;
    if (up) try { up.close(1000); } catch {}
  }
}
