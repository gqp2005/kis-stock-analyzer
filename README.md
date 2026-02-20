# KIS Stock Analyzer (Cloudflare Pages Functions + React)

한국 주식 종목코드/종목명을 입력하면 아래를 제공하는 웹 서비스입니다.

1. 일봉 OHLCV 차트
2. RSI / Bollinger Bands / Moving Average / ATR 계산
3. trend / momentum / risk 점수 + overall 판정
4. 판정 근거(reasons) 3~6개

## 기술 스택

- Frontend: React + Vite
- Chart: `lightweight-charts` (캔들 + 거래량 히스토그램)
- Backend: Cloudflare Pages Functions (Workers 런타임)
- Data: 한국투자증권 KIS OpenAPI
- Cache: Cloudflare Cache API

## 폴더 구조

```text
.
├─ functions/
│  ├─ api/
│  │  ├─ analysis.ts
│  │  ├─ ohlcv.ts
│  │  └─ health.ts
│  └─ lib/
│     ├─ kis.ts
│     ├─ indicators.ts
│     ├─ scoring.ts
│     ├─ stockResolver.ts
│     └─ ...
├─ src/
│  ├─ App.tsx
│  ├─ main.tsx
│  └─ styles.css
├─ data/
│  └─ kr-stocks.json
├─ tests/
│  ├─ indicators.test.ts
│  └─ health.test.ts
└─ scripts/
   └─ build-stock-map.mjs
```

## 환경 변수

Cloudflare Pages Functions env 또는 로컬 `.dev.vars`에 아래 값을 넣어주세요.

- `KIS_APP_KEY` (필수)
- `KIS_APP_SECRET` (필수)
- `KIS_BASE_URL` (선택, 기본값: `https://openapi.koreainvestment.com:9443`)
- `KIS_ENV` (선택, `real`/`demo`, 기본 `real`)

로컬 테스트용 파일:

1. `.dev.vars.example`을 복사해서 `.dev.vars` 생성
2. `KIS_APP_KEY`, `KIS_APP_SECRET` 입력

## 로컬 실행

1. 설치

```bash
npm install
```

2. 테스트 실행

```bash
npm test
```

3. 프론트 개발 서버

```bash
npm run dev
```

4. Functions 포함 전체 동작 확인 (권장)

```bash
npm run cf:dev
```

`cf:dev`는 `dist`를 빌드한 뒤 Pages Functions를 함께 띄웁니다.

## Cloudflare Pages 배포

1. Cloudflare Pages 프로젝트 생성 (Git 연동)
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Environment Variables에 `KIS_APP_KEY`, `KIS_APP_SECRET` 등록
5. 배포

Functions는 `functions/` 폴더를 자동 인식합니다.

## API 엔드포인트

### `GET /api/health`

- 200 응답으로 헬스체크

### `GET /api/ohlcv?query=005930&days=180`

- OHLCV 캔들 반환
- `query`는 종목코드 또는 종목명

### `GET /api/analysis?query=삼성전자&days=180`

- 응답 구조:

```json
{
  "meta": {},
  "scores": {},
  "signals": {},
  "reasons": [],
  "levels": {},
  "candles": []
}
```

## 스코어 카드 v1 구현 내용

- Trend(0~100)
  - `close > ma60` +25
  - `ma20 > ma60` +25
  - `ma60 slope up` +20
  - `ma60 > ma120` +20
  - `20일 신고가` +10
- Momentum(0~100)
  - `rsi>=55` +20, `45~54` +10, `<45` +0
  - `rsi 5일 상승` +20
  - `close > ma20` +20
  - `5일 수익률 > 0` +20
  - `vol > vol_ma20` +20
- Risk(0~100)
  - ATR% 구간 점수
    - `<=2%` 30, `2~4%` 20, `4~6%` 10, `>6%` 0
  - 볼밴 위치
    - 밴드 내부 `+10`, 상단 돌파 `-20`, 하단 이탈 `-10`
  - 20일 MDD
    - `>= -5%` +20, `>= -10%` +10, 그 외 +0
  - 급락일(당일 수익률 `<= -5%`) `-20`
- Overall
  - `GOOD`: `trend>=70 && momentum>=55 && risk>=45`
  - `NEUTRAL`: `trend>=40 && risk>=35`
  - else `CAUTION`

## KIS 토큰/호출 흐름

1. `/api/analysis` 또는 `/api/ohlcv` 요청 수신
2. 종목명 입력이면 로컬 `kr-stocks.json`으로 코드 해석
3. Cache API에서 분석 캐시 확인
4. KIS access token 캐시 확인 (메모리 + Cache API)
5. 토큰 만료 5분 전이면 `/oauth2/tokenP` 재발급
6. `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` 호출
7. 지표/점수 계산 후 결과 캐시 저장 및 응답

## 캐시 동작

- `analysis` / `ohlcv` 결과를 Cache API에 저장
- TTL 정책
  - 장중(한국시간 09:00~15:30, 평일): `60초`
  - 장마감 후 평일: `30분`
  - 주말: `60분`
- 동일 종목 재조회 시 KIS 호출 최소화

## 종목명 매핑 데이터

- `data/kr-stocks.json`은 KIS 제공 마스터 파일(`kospi_code.mst`, `kosdaq_code.mst`) 기반으로 생성
- 갱신 명령:

```bash
npm run stocks:refresh
```

## GitHub 업로드 팁

```bash
git init
git add .
git commit -m "feat: KIS stock analysis web service on Cloudflare Pages"
```

