// 실시간 체결: 앱 전체가 WebSocket 하나를 같이 쓴다. 화면은 종목을 구독하고, 사라지면 해제한다.
// 연결이 안 되면 liveOk()가 false이고, 각 화면은 원래대로 주기적으로 시세를 받는다.
const subs = new Map(); // 종목 -> 받을 함수 Set
const statusFns = new Set();
let ws = null, up = false, tries = 0, retryT = null, pingT = null, idleT = null, sendT = null;

export const liveOk = () => up;
export function onLiveStatus(fn) { statusFns.add(fn); return () => statusFns.delete(fn); }

// list의 종목 체결을 fn({ t, p, ts, v })으로 받는다. 돌려주는 함수를 부르면 해제.
export function subscribe(list, fn) {
  const ts = [...new Set(list)];
  for (const t of ts) { if (!subs.has(t)) subs.set(t, new Set()); subs.get(t).add(fn); }
  changed();
  let done = false;
  return () => {
    if (done) return; done = true;
    for (const t of ts) { const s = subs.get(t); if (s) { s.delete(fn); if (!s.size) subs.delete(t); } }
    changed();
  };
}

function setUp(v) { if (up === v) return; up = v; statusFns.forEach((f) => f(v)); }
function changed() {
  clearTimeout(idleT);
  // 화면을 바꾸는 사이 잠깐 비는 것은 기다렸다가, 계속 비어 있으면 끊는다.
  if (!subs.size) { idleT = setTimeout(close, 3000); return; }
  if (ws && ws.readyState === 1) send(); else open();
}
function send() {
  clearTimeout(sendT);
  sendT = setTimeout(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "sub", t: [...subs.keys()] })); }, 50);
}
function open() {
  if (ws || document.hidden || !subs.size || typeof WebSocket === "undefined") return;
  clearTimeout(retryT);
  const s = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
  ws = s;
  s.onopen = () => { send(); pingT = setInterval(() => { if (s.readyState === 1) s.send("ping"); }, 30000); };
  s.onmessage = (e) => {
    if (e.data === "pong") return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "status") { if (m.up) tries = 0; setUp(!!m.up); }
    else if (m.type === "tick") { setUp(true); const fns = subs.get(m.t); if (fns) [...fns].forEach((f) => f(m)); }
  };
  s.onclose = () => {
    if (ws !== s) return;
    ws = null; clearInterval(pingT); setUp(false);
    if (subs.size && !document.hidden) retryT = setTimeout(open, Math.min(60000, 3000 * 2 ** tries++));
  };
}
function close() { clearTimeout(retryT); clearInterval(pingT); const s = ws; ws = null; setUp(false); if (s) s.close(); }
document.addEventListener("visibilitychange", () => (document.hidden ? close() : open()));

// 미국 정규장(동부시간 평일 9:30~16:00) 체결인지. 공휴일은 따지지 않는다.
const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
export function regular(ts) {
  const p = {}; for (const x of etFmt.formatToParts(new Date(ts))) p[x.type] = x.value;
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const m = Number(p.hour) * 60 + Number(p.minute);
  return m >= 570 && m < 960;
}

// 지금 미국 주식 거래 시간대. 동부시간 기준으로 데이장 20:00~04:00(일~목 밤 시작), 프리장 04:00~09:30, 본장 09:30~16:00, 애프터장 16:00~20:00.
// 휴장일·조기 폐장은 서버에서 받은 달력으로 고친다 (못 받으면 주말만 따진다). 데이장은 한국 증권사의 주간거래 시간이다.
const etDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York" });
const CAL = {}, NAMES = {};
export function setHolidays(days) { for (const d of days || []) { CAL[d.date] = d.hours || ""; NAMES[d.date] = d.name || ""; } }
const closeMin = (date) => { const m = /-(\d+):(\d+)/.exec(CAL[date] || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : 960; };
const isHoliday = (date) => date in CAL && !CAL[date];
const nextDay = (date) => new Date(Date.parse(date) + 864e5).toISOString().slice(0, 10);
export function sessionOf(ts = Date.now()) {
  const p = {}; for (const x of etFmt.formatToParts(new Date(ts))) p[x.type] = x.value;
  const m = Number(p.hour) * 60 + Number(p.minute), date = etDay.format(new Date(ts)), wd = p.weekday, weekday = wd !== "Sat" && wd !== "Sun";
  const left = (end) => ({ left: end - m });
  // 저녁 20시 이후 데이장은 다음 거래일 몫이다.
  if (m >= 1200) return wd !== "Fri" && wd !== "Sat" && !isHoliday(nextDay(date)) ? { id: "day", label: "데이장", ...left(1680) } : { id: "closed", label: "휴장" };
  if (!weekday || isHoliday(date)) return { id: "closed", label: "휴장" };
  if (m < 240) return { id: "day", label: "데이장", ...left(240) };
  if (m < 570) return { id: "pre", label: "프리장", ...left(570) };
  const end = closeMin(date);
  if (m < end) return { id: "reg", label: "본장", ...left(end) };
  return { id: "post", label: "애프터장", ...left(1200) };
}

// 앞으로 within일 안의 가장 가까운 휴장일·조기 폐장일. 오늘이면 dday가 0이다. 달력을 못 받았으면 null.
const KO_NAME = [[/new year/i, "신정"], [/martin luther/i, "마틴 루터 킹 데이"], [/washington|president/i, "대통령의 날"], [/good friday/i, "성금요일"], [/memorial/i, "현충일"], [/juneteenth/i, "준틴스"], [/independence/i, "독립기념일"], [/labor/i, "노동절"], [/thanksgiving/i, "추수감사절"], [/christmas/i, "성탄절"]];
export function nextClosure(ts = Date.now(), within = 31) {
  const today = etDay.format(new Date(ts));
  for (const date of Object.keys(CAL).sort()) {
    if (date < today) continue;
    const dday = Math.round((Date.parse(date) - Date.parse(today)) / 864e5);
    if (dday > within) return null;
    const closed = isHoliday(date);
    if (!closed && closeMin(date) >= 960) continue;
    const raw = NAMES[date] || "", ko = KO_NAME.find(([r]) => r.test(raw));
    return { date, dday, closed, name: ko ? ko[1] : raw, day: "일월화수목금토"[new Date(Date.parse(date)).getUTCDay()] };
  }
  return null;
}

// 값이 바뀐 숫자에 잠깐 색을 번지게 한다 (오르면 초록, 내리면 주황). 체결이 잦아도 번쩍이지 않게 간격을 둔다.
const lastFlash = new WeakMap();
export function flash(el, rose) {
  if (!el) return;
  if (Date.now() - (lastFlash.get(el) || 0) < 700) return;
  lastFlash.set(el, Date.now());
  el.classList.remove("flash-up", "flash-down");
  void el.offsetWidth;
  el.classList.add(rose ? "flash-up" : "flash-down");
}
