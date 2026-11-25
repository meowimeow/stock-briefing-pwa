// 차트용 일봉 데이터. Massive(구 Polygon) API가 있으면 그걸 쓰고, 없거나 실패하면 Yahoo/Stooq 종가로 대신한다.
import { priceHistory } from "./global.js";
import { day, addDays } from "./sources.js";

async function massive(env, t) {
  const now = new Date();
  const url = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(t)}/range/1/day/${day(addDays(now, -720))}/${day(now)}?${new URLSearchParams({ adjusted: "true", sort: "asc", limit: "5000", apiKey: env.MASSIVE_KEY })}`;
  let r;
  try { r = await fetch(url); } catch { throw new Error("Massive 네트워크 오류"); }
  if (r.status === 429) throw new Error("Massive 요청 한도 초과 (무료 플랜은 분당 호출이 적습니다. 잠시 뒤 다시)");
  if (r.status === 401 || r.status === 403) throw new Error(`Massive 인증/권한 오류 (HTTP ${r.status}) — 키와 요금제를 확인하세요`);
  if (!r.ok) throw new Error(`Massive HTTP ${r.status}`);
  const j = await r.json();
  const res = j.results || [];
  if (!res.length) throw new Error("Massive에 이 종목의 데이터가 없습니다");
  return res.map((b) => [new Date(b.t).toISOString().slice(0, 10), b.o, b.h, b.l, b.c, b.v || 0]);
}

export async function chartBars(env, t) {
  let note = "";
  if (env.MASSIVE_KEY) {
    try { return { source: "Massive", bars: await massive(env, t), note }; } catch (e) { note = e.message; }
  } else note = "MASSIVE_KEY가 서버에 없어 대체 출처를 썼습니다";
  const h = await priceHistory(t);
  const cut = day(addDays(new Date(), -730));
  return { source: h.source + " (종가만)", lineOnly: true, bars: h.prices.filter((p) => p[0] >= cut).map(([d, c]) => [d, c, c, c, c, 0]), note };
}
