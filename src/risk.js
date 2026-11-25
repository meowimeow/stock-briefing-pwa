// 산업 전반에 영향을 줄 수 있는 리스크 키워드 (Streamlit 앱의 risk_keywords.py와 같은 목록)
export const RISK = {
  "중국 리스크": ["china", "china slowdown", "china property", "evergrande", "yuan devaluation", "china export control", "china tariff", "us-china", "china stimulus", "taiwan", "taiwan strait", "south china sea", "중국", "헝다", "위안화", "미중", "대만", "남중국해"],
  "지정학": ["sanctions", "export control", "export ban", "tariff", "war", "conflict", "invasion", "strait of hormuz", "제재", "수출규제", "관세", "전쟁", "분쟁", "호르무즈"],
  "공급망/원자재": ["rare earth", "copper", "lithium", "cobalt", "chip equipment", "shipping", "supply chain", "port congestion", "freight", "희토류", "구리", "리튬", "코발트", "물류", "해운", "공급망"],
  "거시경제": ["interest rate", "fed", "federal reserve", "inflation", "cpi", "recession", "exchange rate", "yield", "금리", "연준", "인플레이션", "환율", "경기침체"],
  "인프라": ["power grid", "blackout", "power shortage", "data center power", "electricity shortage", "전력망", "정전", "전력 부족"],
  "사이버/사고": ["cyberattack", "data breach", "hack", "ransomware", "factory fire", "explosion", "recall", "strike", "walkout", "해킹", "랜섬웨어", "화재", "폭발", "리콜", "파업"],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 영어 키워드는 단어 경계로 맞춘다 ("war"가 "software"에 걸리지 않게). 한글은 포함 여부로 본다.
const RULES = Object.entries(RISK).map(([cat, kws]) => [
  cat,
  kws.map((k) => (/^[a-z0-9 \-]+$/i.test(k) ? new RegExp(`\\b${esc(k)}\\b`, "i") : new RegExp(esc(k), "i"))),
]);

export function riskCategory(text) {
  for (const [cat, res] of RULES) if (res.some((r) => r.test(text))) return cat;
  return "";
}
