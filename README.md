# 주식·뉴스 브리핑 PWA

혼자 쓰려고 만든 미국 주식·뉴스 앱입니다. Cloudflare Workers와 프레임워크 없는 자바스크립트로 만들었습니다. 투자 조언이나 주문 기능은 없습니다.

## 구성
- `public/` 화면(HTML/JS/CSS, 서비스 워커)
- `src/` Worker: 로그인, API 라우트, 외부 데이터 모으기, 신호 계산
- `dev.mjs` 대부분의 외부 데이터를 가짜로 채우는 로컬 서버

## 로컬 실행
```bash
node dev.mjs
```
http://localhost:8790 을 열고 비밀번호 `testpw`로 들어갑니다. 로컬 전용이니 실제 비밀번호로 쓰지 마세요.

## 내 값 넣기
저장소에는 코드만 있습니다. 키, 비밀번호, 연락처는 각자 발급받아 직접 넣습니다.

| 이름 | 필수 | 쓰는 곳 |
|---|---|---|
| `APP_PASSWORD` | 예 | 앱 로그인 비밀번호 (직접 정함) |
| `FINNHUB_KEY` | 예 | 시세, 실시간, 종목 뉴스, 실적 |
| `SEC_CONTACT` | 선택 | SEC에 보낼 본인 연락처. 없으면 공시·재무 기능이 쉼 |
| `GEMINI_KEY` | 선택 | AI 점검 |
| `MASSIVE_KEY` | 선택 | 일봉 차트. 없으면 대체 출처 사용 |
| `FRED_KEY` | 선택 | 경제지표 |
| `NEWSAPI_KEY` | 선택 | 추가 뉴스 검색 |
| `AI_PROVIDER`, `ANTHROPIC_KEY` | 선택 | Gemini 대신 Claude를 쓸 때 (`AI_PROVIDER=anthropic`) |

`SEC_CONTACT`는 SEC 요청 헤더에 담겨 전송됩니다. 공개해도 되는 연락처를 영문으로 넣으세요.

## 배포 (Cloudflare)
```bash
npx wrangler deploy
```
```bash
npx wrangler secret put APP_PASSWORD
```
나머지도 같은 방법으로 넣습니다. 실제 키로 로컬에서 돌리려면 `.dev.vars.example`을 `.dev.vars`로 복사해 채우고 `npx wrangler dev`를 실행합니다.

## 실시간과 거래 시간대
Durable Object `LIVE` 하나가 Finnhub WebSocket을 열어 여러 화면에 0.25초 단위로 나눠 줍니다. 보는 화면이 없으면 닫습니다. 1일 차트는 프리·애프터장을 포함한 1분봉이고, 데이장(주간거래)은 시세 제공처가 없어 멈춥니다.

## 알아둘 것
- 비밀번호 하나로 들어가며 관심종목과 메모를 함께 씁니다. 여러 사람에게 공유하는 용도가 아닙니다.
- 제공처마다 이용 조건이 다르고 Yahoo는 비공식 경로입니다. 직접 확인하고 쓰세요.
- 숫자와 AI 요약은 틀릴 수 있습니다.

외부 코드와 참고한 방식은 [NOTICE](NOTICE)에 적었습니다.
