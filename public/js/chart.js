import { h, LS, api, signed, money, won, withWon } from "./core.js";
import { subscribe, onLiveStatus, liveOk, regular, flash, sessionOf } from "./live.js";

// 증권사 앱처럼 쓰는 차트: TradingView lightweight-charts(앱에 포함된 파일)를 쓴다.
// 1일은 1분봉(프리·애프터 포함), 5일·1개월은 분봉, 그 이상은 일봉. 실시간 체결(WebSocket)로 마지막 봉을 움직이고, 체결이 끊기면 주기적으로 다시 받는다.
// 장외 체결은 1일 차트에만 넣는다 (5일 이상은 정규장 봉만 있어서 머리말 가격만 바꾼다). 왼쪽에는 가격대별 거래량(매물대)을 겹쳐 그린다.
let libP = null;
function loadLib() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (!libP) libP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/vendor/lightweight-charts.js"; s.onload = () => res(window.LightweightCharts); s.onerror = () => { libP = null; rej(new Error("차트 라이브러리를 불러오지 못했습니다")); }; document.head.append(s); });
  return libP;
}
const RANGES = [["1d", "1일"], ["5d", "5일"], ["1mo", "1개월"], ["6mo", "6개월"], ["1y", "1년"], ["2y", "2년"]];
const ET = { timeZone: "America/New_York", hour12: false };
const etTime = (ts, o) => new Date(ts * 1000).toLocaleString("en-US", { ...ET, ...o });
const sma = (bars, n) => { const out = []; let s = 0; bars.forEach((b, i) => { s += b.close; if (i >= n) s -= bars[i - n].close; if (i >= n - 1) out.push({ time: b.time, value: s / n }); }); return out; };
const daily = {}, intra = {};

export function liveChart(t, onLogin) {
  let range = LS.get("chart:range", "1d"), mode = LS.get("chart:mode", "candle"), ma = LS.get("chart:ma", false);
  let chart = null, main = null, vol = null, m20 = null, m60 = null, bars = [], isIntra = false, prevClose = null, timer = null, dead = false, seq = 0, lib = null, lineOnly = false, col = {}, srcVol = true;
  let lastTick = 0, shown = null, unsub = null, offStatus = null, tween = null, profQueued = false;
  const price = h("div", { class: "cp-price num" }, "…"), sub = h("div", { class: "cp-sub num" }), tip = h("div", { class: "cp-tip num" }), live = h("span", { class: "cp-live" }), volTxt = h("span", { class: "cp-vol num" });
  const holder = h("div", { class: "cp-holder" }), dot = h("div", { class: "cp-dot", "aria-hidden": "true" }), prof = h("canvas", { class: "cp-prof", "aria-hidden": "true" }), msg = h("p", { class: "note cp-msg" });
  const rbtns = h("div", { class: "seg small", role: "tablist" });
  const mbtns = h("div", { class: "cp-tools" });
  const el = h("div", { class: "cp" }, h("div", { class: "cp-head" }, price, sub, volTxt, live), tip, h("div", { class: "cp-wrap" }, holder, prof, dot), msg, rbtns, mbtns);

  const drawBtns = () => {
    rbtns.replaceChildren(...RANGES.map(([v, l]) => h("button", { type: "button", role: "tab", "aria-selected": String(v === range), class: v === range ? "on" : "", onclick: () => { range = v; LS.set("chart:range", v); drawBtns(); load(); } }, l)));
    mbtns.replaceChildren(
      h("button", { type: "button", class: "chip-s" + (mode === "candle" ? " on" : ""), onclick: () => { mode = mode === "candle" ? "line" : "candle"; LS.set("chart:mode", mode); drawBtns(); build(); } }, mode === "candle" ? "캔들" : "라인"),
      h("button", { type: "button", class: "chip-s" + (ma ? " on" : ""), disabled: isIntra, onclick: () => { ma = !ma; LS.set("chart:ma", ma); drawBtns(); build(); } }, "이동평균"),
      h("button", { type: "button", class: "chip-s", onclick: () => load(true) }, "새로고침"));
  };

  const header = (px, base) => {
    if (px == null) return;
    const ch = base ? (px / base - 1) * 100 : null;
    if (shown != null && px !== shown) flash(price, px > shown);
    shown = px;
    price.replaceChildren(money(px));
    sub.replaceChildren(h("span", { class: ch == null ? "" : ch >= 0 ? "up" : "down" }, ch == null ? "" : `${signed(ch, 2)} (${(px - base >= 0 ? "+" : "") + (px - base).toFixed(2)})`), won(px) ? h("span", { class: "won" }, " " + won(px)) : null);
  };

  function build() {
    if (!lib || !bars.length) return;
    if (chart) { chart.remove(); chart = null; }
    const css = getComputedStyle(document.documentElement), c = (k, d) => css.getPropertyValue(k).trim() || d;
    const up = c("--up", "#00c805"), down = c("--down", "#ff5000"); col = { up, down };
    const dim = c("--dim", "#8b8b93"), line = c("--line", "#1f1f23");
    const fmtTick = (time) => (isIntra ? etTime(time, range === "1d" ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric" }) : null);
    chart = lib.createChart(holder, {
      width: holder.clientWidth, height: holder.clientHeight || 280,
      layout: { background: { color: "transparent" }, textColor: dim, fontSize: 11, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: line } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderVisible: false, timeVisible: isIntra, secondsVisible: false, rightOffset: 4, tickMarkFormatter: isIntra ? (time) => fmtTick(time) : undefined },
      localization: { locale: "en-US", timeFormatter: isIntra ? (time) => etTime(time, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " ET" : undefined },
      crosshair: { mode: 0, vertLine: { color: dim, labelBackgroundColor: "#2a2a30" }, horzLine: { color: dim, labelBackgroundColor: "#2a2a30" } },
      handleScale: { axisPressedMouseMove: true }, kineticScroll: { touch: true },
    });
    const useLine = mode === "line" || lineOnly;
    const lastUp = bars.length < 2 || bars[bars.length - 1].close >= (prevClose != null && isIntra && range === "1d" ? prevClose : bars[0].open);
    if (useLine) main = chart.addAreaSeries({ lineColor: lastUp ? up : down, topColor: (lastUp ? up : down) + "44", bottomColor: "transparent", lineWidth: 2, priceLineVisible: true });
    else main = chart.addCandlestickSeries({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceLineVisible: true });
    main.setData(useLine ? bars.map((b) => ({ time: b.time, value: b.close })) : bars);
    if (!lineOnly) {
      vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: (b.close >= b.open ? up : down) + "66" })));
    }
    if (ma && !isIntra) {
      m20 = chart.addLineSeries({ color: "#4da3ff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }); m20.setData(sma(bars, 20));
      m60 = chart.addLineSeries({ color: "#f5a524", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }); m60.setData(sma(bars, 60));
    }
    if (isIntra && range === "1d" && prevClose != null) main.createPriceLine({ price: prevClose, color: dim, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "전일" });
    chart.timeScale().fitContent();
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => { placeDot(); queueProfile(); });
    requestAnimationFrame(() => { placeDot(); queueProfile(); volLabel(); });
    chart.subscribeCrosshairMove((p) => {
      if (!p.time || !p.seriesData.size) { tip.textContent = ""; return; }
      const d = p.seriesData.get(main); if (!d) return;
      const when = isIntra ? etTime(p.time, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " ET" : String(p.time);
      const v = bars.find((b) => b.time === p.time);
      tip.textContent = d.close != null ? `${when} · 시 ${d.open.toFixed(2)} 고 ${d.high.toFixed(2)} 저 ${d.low.toFixed(2)} 종 ${d.close.toFixed(2)}${v && v.volume ? ` · 거래량 ${v.volume >= 1e6 ? (v.volume / 1e6).toFixed(1) + "M" : Math.round(v.volume).toLocaleString("en-US")}` : ""}` : `${when} · ${d.value.toFixed(2)}`;
    });
  }

  async function load(force) {
    const my = ++seq; msg.textContent = ""; isIntra = ["1d", "5d", "1mo"].includes(range); lineOnly = false; drawBtns();
    try {
      lib = await loadLib();
      if (isIntra) {
        let d = intra[t + range];
        if (force || !d || Date.now() - d.at > 45000) { try { d = { at: Date.now(), v: await api(`/api/intraday?t=${encodeURIComponent(t)}&r=${range}`) }; intra[t + range] = d; } catch (x) { if (x.code === 401) throw x; d = null; msg.textContent = `분봉을 못 받아 일봉으로 보여줍니다 (${x.message})`; isIntra = false; } }
        if (d) { bars = d.v.bars.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume })); prevClose = d.v.prevClose; srcVol = bars.some((b) => b.volume); }
      }
      if (!isIntra) {
        let d = daily[t];
        if (force || !d || Date.now() - d.at > 3600000) { d = { at: Date.now(), v: await api("/api/chart?t=" + encodeURIComponent(t)) }; daily[t] = d; }
        const all = d.v.bars.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
        const n = { "1mo": 22, "6mo": 130, "1y": 252, "2y": 520, "5d": 5, "1d": 2 }[range] || 252;
        bars = all.slice(-Math.max(n, 2)); lineOnly = !!d.v.lineOnly; prevClose = bars.length > 1 ? bars[bars.length - 2].close : null;
        if (d.v.note && !msg.textContent) msg.textContent = d.v.note;
      }
      if (my !== seq || dead) return;
      const last = bars[bars.length - 1];
      const base = isIntra && range === "1d" ? prevClose : isIntra ? bars[0].open : prevClose;
      header(last.close, base);
      build();
    } catch (x) { if (x.code === 401) return onLogin && onLogin(); if (my === seq) { msg.textContent = "차트를 불러오지 못했습니다: " + x.message; } }
  }

  // 체결이 들어오면 쉬고, 끊겼을 때만 받아온다. 1일 차트는 1분봉 끝부분을 합치고, 나머지는 현재가만 받는다.
  async function poll() {
    if (dead) return;
    if (!el.isConnected) { stop(); return; }
    if (document.hidden || !bars.length || !main || Date.now() - lastTick < 20000) return;
    const sid = sessionOf().id;
    if (sid === "closed" || sid === "day") return; // 이 시간대엔 새 데이터가 없다
    try {
      if (isIntra && range === "1d") {
        const v = await api(`/api/intraday?t=${encodeURIComponent(t)}&r=1d`);
        if (dead) return;
        for (const [time, open, high, low, close, volume] of v.bars.slice(-5)) {
          const i = bars.findIndex((b) => b.time === time), b = { time, open, high, low, close, volume };
          if (i >= 0) { b.volume = Math.max(b.volume || 0, bars[i].volume || 0); bars[i] = b; } else if (time > bars[bars.length - 1].time) bars.push(b); else continue;
          draw(b);
        }
        const last = bars[bars.length - 1];
        header(last.close, prevClose); placeDot(); queueProfile(); volLabel();
        return;
      }
      const q = await api("/api/live?t=" + encodeURIComponent(t));
      if (!q.price || dead) return;
      const last = bars[bars.length - 1];
      last.close = q.price; last.high = Math.max(last.high, q.price); last.low = Math.min(last.low, q.price);
      draw(last);
      header(q.price, isIntra && range !== "1d" ? bars[0].open : q.prev || prevClose);
    } catch (x) { if (x.code === 401) { stop(); onLogin && onLogin(); } }
  }

  function draw(b, close = b.close) {
    if (!main) return;
    try {
      main.update(mode === "line" || lineOnly ? { time: b.time, value: close } : { ...b, close, high: Math.max(b.high, close), low: Math.min(b.low, close) });
      if (isIntra && !lineOnly && vol) vol.update({ time: b.time, value: b.volume || 0, color: (b.close >= b.open ? col.up : col.down) + "66" });
    } catch {}
  }
  // 체결 사이를 짧게 이어 줘서 가격이 뚝뚝 끊기지 않고 움직이게 한다. 뒤처지지 않도록 0.2초 안에 끝낸다.
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function glide(b, from) {
    if (tween) cancelAnimationFrame(tween);
    if (calm || from == null || document.hidden) { draw(b); return; }
    const t0 = performance.now(), to = b.close;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 200), e = 1 - (1 - k) ** 3;
      if (dead) return;
      draw(b, from + (to - from) * e); placeDot(from + (to - from) * e);
      tween = k < 1 ? requestAnimationFrame(step) : null;
    };
    tween = requestAnimationFrame(step);
  }

  // 머리말 거래량: 분봉은 마지막 봉과 같은 날의 합, 일봉은 마지막 봉. 프리장은 Yahoo 거래량이 0이라 체결로 더한 양만 있으므로 다르게 적는다.
  function volLabel() {
    const last = bars[bars.length - 1];
    if (!last) return;
    const key = isIntra ? etTime(last.time, { month: "numeric", day: "numeric" }) : null;
    const v = isIntra ? bars.filter((b) => etTime(b.time, { month: "numeric", day: "numeric" }) === key).reduce((s, b) => s + (b.volume || 0), 0) : last.volume || 0;
    volTxt.textContent = v ? `${isIntra && !srcVol ? "화면 켠 뒤 체결" : "거래량"} ${v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : Math.round(v)}` : "";
  }

  // 매물대: 화면에 보이는 봉의 거래량을 가격 구간별로 합쳐 왼쪽에 막대로 그린다.
  function queueProfile() { if (profQueued) return; profQueued = true; requestAnimationFrame(() => { profQueued = false; drawProfile(); }); }
  function drawProfile() {
    if (dead || !chart || !main || !bars.length) return;
    const ts = chart.timeScale(), hh = Math.max(1, holder.clientHeight - ts.height()), w = 56, rows = 26, rh = hh / rows, dpr = window.devicePixelRatio || 1;
    prof.width = w * dpr; prof.height = hh * dpr; prof.style.height = hh + "px";
    const c = prof.getContext("2d"), sum = new Array(rows).fill(0), vr = ts.getVisibleRange();
    c.scale(dpr, dpr);
    for (const b of bars) {
      if (vr && (b.time < vr.from || b.time > vr.to)) continue;
      const y = main.priceToCoordinate(b.close);
      if (y == null || y < 0 || y >= hh) continue;
      sum[Math.floor(y / rh)] += b.volume || 0;
    }
    const max = Math.max(...sum);
    if (!max) return;
    const peak = sum.indexOf(max);
    sum.forEach((v, i) => { if (!v) return; c.fillStyle = i === peak ? "rgba(139,139,147,.6)" : "rgba(139,139,147,.28)"; c.fillRect(0, i * rh + 0.5, Math.max(1, (v / max) * w), Math.max(1, rh - 1)); });
  }

  // 체결 하나(서버가 0.25초씩 묶은 것)를 마지막 봉에 반영한다. 분봉은 시간이 넘어가면 새 봉을 붙인다.
  function tick(p, ts, v) {
    if (dead || !el.isConnected || !bars.length || !main || !(p > 0)) return;
    let last = bars[bars.length - 1], from = last.close;
    const sec = Math.floor(ts / 1000);
    if (isIntra && bars.length > 2) {
      const iv = Math.min(...bars.slice(-4).map((b, i, a) => (i ? b.time - a[i - 1].time : Infinity)));
      if (iv > 0 && iv < Infinity && sec >= last.time + iv) {
        last = { time: last.time + iv * Math.floor((sec - last.time) / iv), open: p, high: p, low: p, close: p, volume: 0 };
        bars.push(last); from = null;
      }
    }
    last.close = p; last.high = Math.max(last.high, p); last.low = Math.min(last.low, p);
    if (isIntra && !lineOnly && v) last.volume = (last.volume || 0) + v;
    glide(last, from);
    header(p, isIntra && range !== "1d" ? bars[0].open : prevClose);
    volLabel(); queueProfile();
  }
  // 체결이 들어오는 동안 마지막 봉 끝에 작은 점이 맥박친다.
  function placeDot(px) {
    const last = bars[bars.length - 1], fresh = Date.now() - lastTick < 20000;
    const x = chart && main && last && liveOk() && fresh ? chart.timeScale().timeToCoordinate(last.time) : null;
    const y = x == null ? null : main.priceToCoordinate(px ?? last.close);
    if (x == null || y == null || x < 0 || x > holder.clientWidth) { dot.classList.remove("on"); return; }
    dot.style.transform = `translate(${x}px, ${y}px)`;
    dot.style.background = last.close >= (isIntra && range !== "1d" ? bars[0].open : prevClose ?? last.open) ? col.up : col.down;
    dot.classList.add("on");
  }
  // 받는 상태를 있는 그대로 쓴다: 연결만 됐고 체결이 없으면 실시간이라고 하지 않는다.
  const liveMark = () => {
    const s = sessionOf().id, fresh = Date.now() - lastTick < 20000;
    live.textContent = !liveOk() ? "" : fresh ? "실시간" : s === "day" ? "데이장 시세 없음" : s === "closed" ? "휴장" : "체결 대기";
    live.classList.toggle("idle", !fresh);
    placeDot();
  };
  function onTick(m) {
    if (dead) return;
    if (!el.isConnected) return stop();
    const wasFresh = Date.now() - lastTick < 20000;
    lastTick = Date.now();
    if (!wasFresh) liveMark();
    if (range === "1d" || regular(m.ts)) tick(m.p, m.ts, m.v);
    else header(m.p, isIntra ? bars[0] && bars[0].open : prevClose);
  }

  function stop() { dead = true; clearInterval(timer); clearInterval(markTimer); if (tween) cancelAnimationFrame(tween); if (unsub) unsub(); if (offStatus) offStatus(); if (chart) { chart.remove(); chart = null; } }
  new ResizeObserver(() => { if (chart && !dead) { chart.applyOptions({ width: holder.clientWidth }); placeDot(); queueProfile(); } }).observe(holder);
  timer = setInterval(poll, 15000);
  const markTimer = setInterval(() => { if (!dead) liveMark(); }, 5000); // 체결이 끊기면 표시도 바뀌게
  drawBtns(); holder.style.height = "280px";
  setTimeout(() => { if (dead) return; load(); unsub = subscribe([t], onTick); offStatus = onLiveStatus(liveMark); liveMark(); }, 0);
  return { el, destroy: stop };
}
