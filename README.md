# KIS Stock Analyzer (Cloudflare Pages Functions + React)

KIS OpenAPI 기반 한국 주식 멀티 타임프레임 분석 서비스입니다.

- 타임프레임: `month`, `week`, `day`, `min15`
- 핵심 API: `/api/analysis?tf=multi`
- 프론트: 월/주/일/15분 탭 + 최종 판정/신뢰도 표시

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
│  │  ├─ ohlcv.ts
│  │  └─ health.ts
│  └─ lib/
│     ├─ kis.ts
│     ├─ market.ts
│     ├─ indicators.ts
│     ├─ scoring.ts
│     ├─ stockResolver.ts
│     └─ ...
├─ src/
│  ├─ App.tsx
│  ├─ types.ts
│  └─ styles.css
├─ data/kr-stocks.json
└─ tests/
```

## 환경 변수

Cloudflare Pages Functions env 또는 로컬 `.dev.vars`:

- `KIS_APP_KEY` (필수)
- `KIS_APP_SECRET` (필수)
- `KIS_BASE_URL` (선택, 기본: 실전 URL)
- `KIS_ENV` (선택, `real|demo`)

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
- `tf=day|week|month|min15`는 단일 TF 분석 응답(기존 day 응답 호환) 반환

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
- KIS 호출 로그: `[kis-call] ...`

## 종목명 검색 데이터

- `data/kr-stocks.json`은 KIS 마스터 파일 기반
- 갱신:

```bash
npm run stocks:refresh
```
