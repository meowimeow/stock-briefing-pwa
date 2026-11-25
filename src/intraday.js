// 분봉 데이터 (Yahoo 비공식 차트 API). 장중 흐름용이라 실패해도 앱은 일봉으로 대신 보여준다.
const UA = { "User-Agent": "Mozilla/5.0 (compatible; personal-app)" };
const RANGES = { "1d": ["1d", "1m"], "5d": ["5d", "15m"], "1mo": ["1mo", "60m"] };

export async function intraday(t, r) {
  const [range, interval] = RANGES[r] || RANGES["1d"];
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=${range}&interval=${interval}&includePrePost=${r === "1d"}`, { headers: UA });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const j = await res.json();
  const x = j.chart && j.chart.result && j.chart.result[0];
  if (!x || !x.timestamp) throw new Error("분봉 데이터 없음");
  const q = x.indicators.quote[0], bars = [];
  x.timestamp.forEach((ts, i) => {
    if (q.close[i] == null || q.open[i] == null) return;
    bars.push([ts, q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] || 0]);
  });
  if (!bars.length) throw new Error("분봉 데이터 없음");
  const m = x.meta || {};
  return { source: "Yahoo", range: r, interval, prevClose: m.chartPreviousClose ?? m.previousClose ?? null, bars };
}
