# KIS Stock Analyzer (Cloudflare Pages Functions + React)

KIS OpenAPI 기반 한국 주식 멀티 타임프레임 분석 서비스입니다.

- 타임프레임: `month`, `week`, `day`, `min15`
- 핵심 API: `/api/analysis?tf=multi`
- 보조 API: `/api/backtest` (일봉 시그널 백테스트)
- 프론트: 월/주/일/15분 탭 + 최종 판정/신뢰도 표시
- 프론트: Risk 점수 분해 카드 + Entry/Stop/Target(참고) 레벨 표시
- 프론트: 백테스트 신호/보유봉 조건 선택 후 재조회 지원

## 기술 스택

- Frontend: React + Vite
- Chart: `lightweight-charts`
- Backend: Cloudflare Pages Functions (Workers)
- Data: KIS Developers OpenAPI
- Cache: Cloudflare Cache API

## 폴더 구조

```text
.
├─ functions/
│  ├─ api/
│  │  ├─ analysis.ts
│  │  ├─ backtest.ts
│  │  ├─ search.ts
│  │  ├─ ohlcv.ts
│  │  └─ health.ts
│  └─ lib/
│     ├─ backtest.ts
│     ├─ backtest/
│     │  ├─ index.ts
│     │  ├─ strategy.ts
│     │  ├─ engine.ts
│     │  ├─ metrics.ts
│     │  └─ constants.ts
│     ├─ kis.ts
│     ├─ observability.ts
│     ├─ market.ts
│     ├─ indicators.ts
│     ├─ scoring.ts
│     ├─ search.ts
│     ├─ stockResolver.ts
│     └─ ...
├─ src/
│  ├─ App.tsx
│  ├─ types.ts
│  └─ styles.css
├─ data/kr-stocks.json
├─ .github/workflows/
│  ├─ ci.yml
│  └─ pages-preview.yml
└─ tests/
```

## 환경 변수

Cloudflare Pages Functions env 또는 로컬 `.dev.vars`:

- `KIS_APP_KEY` (필수)
- `KIS_APP_SECRET` (필수)
- `KIS_BASE_URL` (선택, 기본: 실전 URL)
- `KIS_ENV` (선택, `real|demo`)
- `RATE_LIMIT_MAX_REQUESTS` (선택, 기본 `120`)
- `RATE_LIMIT_WINDOW_SEC` (선택, 기본 `60`)

주의:
- 키/시크릿은 반드시 Functions env에서만 읽습니다.
- 브라우저 코드에는 노출하지 않습니다.

## 로컬 실행

```bash
npm install
npm test
npm run build
npm run cf:dev
```

## Cloudflare Pages 배포

1. Pages 프로젝트 생성 (Git 연동)
2. Build command: `npm run build`
3. Build output: `dist`
4. Environment variables: `KIS_APP_KEY`, `KIS_APP_SECRET` 설정
5. 배포

## API

### `GET /api/health`
- 상태 체크, 200 반환

### `GET /api/search?q=와이지&limit=8`
- 종목 코드/종목명/초성 검색
- 프론트 자동완성은 이 엔드포인트를 debounce 호출

### `GET /api/backtest?query=005930&count=520&holdBars=10&signal=GOOD`
- 일봉 기반 시그널 백테스트 결과 반환
- 파라미터:
  - `count`: 백테스트용 일봉 수(기본 520, 내부 최소치 자동 보정)
  - `holdBars`: 최대 보유 봉 수(기본 10)
  - `signal`: 진입 신호 기준(`GOOD|NEUTRAL|CAUTION`, 기본 `GOOD`)
- 응답:
  - `summary`: 전체 구간 승률/평균손익률/평균R/손익비/PF/MDD
  - `periods`: 3개월/6개월/1년 구간별 지표(승률/손익비/MDD 포함)
  - `trades`: 최근 거래 내역(최대 80건)
  - `warnings`: 데이터/표본 부족 경고
  - `meta.ruleId`: 적용된 백테스트 룰 ID (`score-card-v1-day-overall`)
- 시뮬레이션 규칙(현재):
  - 현재 운영 중인 day 스코어 룰을 과거 데이터에 롤링 적용
  - 신호 발생 다음 봉 시가 진입
  - `tradePlan.stop/target` 터치 시 청산(동시 터치 시 보수적으로 손절 우선)
  - 미도달 시 `holdBars` 만기 종가 청산

백테스트 모듈 설계:
- `strategy.ts`: 현재 스코어 룰을 과거 시점에 적용해 진입 신호/손절/목표 생성
- `engine.ts`: 단일 포지션 시뮬레이션(진입/청산/보유기간)
- `metrics.ts`: 승률/손익비/PF/MDD 등 검증 지표 집계

### `GET /api/ohlcv?query=005930&tf=day&days=180`
- `tf`: `day|week|month|min15`
- TF별 캔들 반환

### `GET /api/analysis?query=005930&tf=multi&count=180`
- `tf`: `day|week|month|min15|multi`
- `count`: 일봉(day) 기준 조회 봉 수(week/month는 내부 최소치 강제)
- `higher_tf_source`(선택): `resample|kis` (기본 `resample`)
  - `resample`: day OHLCV를 서버에서 주봉/월봉으로 집계
  - `kis`: week/month를 KIS에 별도 호출
- `tf=multi` 응답 구조:

```json
{
  "meta": {},
  "final": { "overall": "GOOD|NEUTRAL|CAUTION", "confidence": 0, "summary": "" },
  "timeframes": {
    "month": {},
    "week": {},
    "day": {},
    "min15": {}
  },
  "warnings": []
}
```

- `tf=multi`는 부분 성공 허용:
  - 일부 TF 데이터가 부족해도 가능한 TF 결과를 반환
  - `day`만 가능하면 final은 day 기반으로 계산
  - `min15`가 없으면 `timing=null` + warnings에 비활성 안내 추가
- `timeframes.month/week/day/min15`는 데이터 부족 시 `null`일 수 있음
- 각 TF 결과에는 `indicators`(MA/RSI/BB 시계열) 포함:
  - `indicators.ma`(기간/시계열), `indicators.rsi14`, `indicators.bb`
- 각 TF 결과에는 `tradePlan`(entry/stop/target/riskReward/note) 포함
- `signals.risk.breakdown`으로 Risk 구성점수(ATR/BB/MDD/급락)를 확인 가능
- `tf=day|week|month|min15`는 단일 TF 분석 응답(기존 day 응답 호환) 반환

오류 응답 포맷(공통):

```json
{
  "ok": false,
  "error": "메시지",
  "code": "BAD_REQUEST|RATE_LIMITED|INTERNAL_ERROR",
  "requestId": "uuid",
  "timestamp": "ISO-8601"
}
```

## 데이터 수집 로직

- `month/week/day`:
  - KIS `inquire-daily-itemchartprice` 호출 (일봉 직접 조회)
  - multi 기본 모드에서는 day를 충분히 수집한 뒤 주봉/월봉으로 리샘플링
- `min15`:
  - KIS `inquire-time-itemchartprice`(주식당일분봉조회)로 당일 분봉 수집
  - 서버에서 15분봉으로 리샘플링(OHLCV/Volume 집계)

제약:
- `min15`는 KIS 제약상 **당일 분봉 기반**입니다.
- 전일 이전 분봉은 제공되지 않습니다.

## 스코어링 v1 (요약)

- TF별 지표
  - month: MA(6/12/24), RSI14, BB20, ATR14, breakout(12)
  - week: MA(10/30/60), RSI14, BB20, ATR14, breakout(20)
  - day: MA(20/60/120), RSI14, BB20, ATR14, breakout(20)
  - min15: MA(20/60), RSI14, BB20, ATR14, breakout(20)
- 레짐
  - `trend >= 70`: `UP`
  - `40~69`: `SIDE`
  - `<40`: `DOWN`
- 최종 결합
  - day overall 기준
  - month DOWN: 1단계 강등 + `장기 역풍`
  - week DOWN: 1단계 강등 + `중기 역풍`
  - month/ week 모두 DOWN: 최소 `CAUTION`
- confidence(0~100)
  - base 50 + 명세 가중치
  - month/ week 모두 UP일 때 confidence +10 보너스
- min15 timingScore
  - 명세 기반 계산 + timingLabel(`타이밍 양호/관망·조건부/진입 비추`)

## 캐시 정책

- 분석 캐시 + 원천 OHLCV 캐시를 분리 사용
- TF별 캐시 키(`종목 + tf`)로 저장
- multi 디버그를 위해 `warnings`에 `timeframes.*.candles.length`를 포함
- TTL:
  - `day/min15`
    - 장중: 60초
    - 장마감 후 평일: 30분
    - 주말: 6시간
  - `week/month`
    - 장중: 30분
    - 장마감 후 평일: 60분
    - 주말: 24시간

로그:
- 캐시 히트/미스: `[analysis-cache-hit]`, `[data-cache-hit]`
- 백테스트 캐시 히트/미스: `[backtest-cache-hit]`, `[backtest-cache-miss]`
- KIS 호출 로그: `[kis-call] ...`
- 요청 메트릭 로그: `[api-metrics] ...`
  - `durationMs`, `apiCacheHitRatio`, `dataCacheHitRatio`, `kisCalls` 포함

응답 헤더:
- `x-request-id`
- `x-response-time-ms`
- `x-api-cache-hit-ratio`
- `x-data-cache-hit-ratio`
- `x-kis-calls`

## Rate Limiting

- 대상: `/api/*` GET (단, `/api/health` 제외)
- 기본값: 60초당 120회/IP
- 초과 시 429 + `retry-after`, `x-rate-limit-*` 헤더 반환

## CI/CD

- `.github/workflows/ci.yml`
  - PR/`master` push 마다 `npm test`, `npm run build` 실행
- `.github/workflows/pages-preview.yml`
  - PR마다 Cloudflare Pages Preview 배포 (secrets 필요)
  - 필요한 GitHub Secrets:
    - `CLOUDFLARE_API_TOKEN`
    - `CLOUDFLARE_ACCOUNT_ID`
    - `CLOUDFLARE_PROJECT_NAME`

## KIS 키 롤링 절차

1. KIS에서 새 AppKey/AppSecret 발급
2. Cloudflare Pages Environment Variables에 새 키 등록
3. 배포 후 `/api/health` 및 `/api/analysis` 정상 호출 확인
4. 확인 후 기존 키 폐기

## 종목명 검색 데이터

- `data/kr-stocks.json`은 KIS 마스터 파일 기반
- 갱신:

```bash
npm run stocks:refresh
```
