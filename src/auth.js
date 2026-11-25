// 비밀번호 확인 + 서명된 로그인 쿠키. 쿠키는 서버가 HttpOnly로 심어서 JS로 못 읽고,
// Safari의 "스크립트 쿠키 7일 제한"도 받지 않는다. 비밀번호를 바꾸면 이전 쿠키는 전부 무효가 된다.
const COOKIE = "np_auth";
const DAYS = 30;
const enc = new TextEncoder();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function passwordOk(env, typed) {
  if (!env.APP_PASSWORD) return false;
  // 길이가 달라도 같은 시간이 걸리도록 해시끼리 비교한다.
  const [a, b] = await Promise.all([hmac("pw", String(typed)), hmac("pw", env.APP_PASSWORD)]);
  return safeEqual(a, b);
}

export async function makeCookie(env, secure = true) {
  const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
  const val = `${exp}.${await hmac(env.APP_PASSWORD, `np1:${exp}`)}`;
  return `${COOKIE}=${val}; Max-Age=${DAYS * 86400}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearCookie(secure = true) {
  return `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export async function isAuthed(env, request) {
  if (!env.APP_PASSWORD) return false;
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [expS, sig] = m[1].split(".");
  const exp = Number(expS);
  if (!exp || exp < Date.now() / 1000 || !sig) return false;
  return safeEqual(sig, await hmac(env.APP_PASSWORD, `np1:${exp}`));
}
