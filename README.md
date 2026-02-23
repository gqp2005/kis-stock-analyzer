# KIS Stock Analyzer (Cloudflare Pages Functions + React)

KIS OpenAPI 기반 한국 주식 멀티 타임프레임 분석 서비스입니다.

- 타임프레임: `month`, `week`, `day`
- 핵심 API: `/api/analysis?tf=multi`
- 보조 API: `/api/backtest` (일봉 시그널 백테스트)
- 보조 API: `/api/screener` (종목 입력 없이 후보 종목 랭킹)
- 보조 API: `/api/admin/rebuild-screener` (배치형 스크리너 재빌드)
- 보조 API: `/api/commentary` (AI 한줄평, 서버 측 호출)
- 프론트: 월/주/일 탭 + 최종 판정/신뢰도 표시
- 프론트: 기술적 분석 카드(RSI/MACD/볼린저 요약) 표시
- 프론트: 투자 성향 프로필(단기/중기) 동시 표시 + 가중 점수 카드
- 프론트: 펀더멘털(PER/PBR/EPS/BPS/시총) + 수급(외국인/기관/개인/프로그램) 카드 표시
- 프론트: 상단 탭으로 `종목 분석` / `종목 추천(스크리너)` 전환
- 프론트: 스크리너에 `거래대금 상위 500 유니버스`/마지막 갱신 시각 표시
- 프론트: Risk 점수 분해 카드 + Entry/Stop/Target(참고) 레벨 표시
- 프론트: 백테스트 신호/보유봉 조건 선택 후 재조회 지원
- 프론트: 일봉 거래량 패턴 마커(BRK/TRAP/PB 기본, HOT/CAP/WB 고급 토글) + 최근 10개 패턴 리스트
- 프론트: 차트 마커 클릭 시 패턴 상세 패널(체크리스트/ref.level/경고·확증 문구) 표시
- 프론트: 선택 패턴의 `ref.level`을 `t-10 ~ t+10` 짧은 수평선으로 표시(토글 지원)
- 프론트: 선택 패턴 캔들 세로 하이라이트(`Highlight selected candle` 토글) 지원
- 프론트: 다중 관점 오버레이(Levels/Trendlines/Channels/Zones/Markers) 토글 지원
- 프론트: Confluence(강한 지지/저항 구간) 카드 + 오버레이 설명 카드 표시
- 프론트: 분석 결과 기반 AI 한줄평 자동 생성 카드 표시

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
│  │  ├─ admin/
│  │  │  └─ rebuild-screener.ts
│  │  ├─ analysis.ts
│  │  ├─ backtest.ts
│  │  ├─ commentary.ts
│  │  ├─ screener.ts
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
│     ├─ screener.ts
│     ├─ screenerStore.ts
│     ├─ universe.ts
│     ├─ search.ts
│     ├─ stockResolver.ts
│     └─ ...
├─ src/
│  ├─ App.tsx
│  ├─ ScreenerPanel.tsx
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
- `ADMIN_TOKEN` (선택, `/api/admin/rebuild-screener` 보호용)
- `OPENAI_API_KEY` (선택, `/api/commentary`용 서버 키)
- `OPENAI_MODEL` (선택, 기본 `gpt-4o-mini`)

주의:
- 키/시크릿은 반드시 Functions env에서만 읽습니다.
- 브라우저 코드에는 노출하지 않습니다.
- `KIS_BASE_URL`은 KIS 도메인(`openapi*.koreainvestment.com`)만 사용하세요. 잘못된 값이면 서버가 기본 KIS URL로 폴백합니다.

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
4. Environment variables: `KIS_APP_KEY`, `KIS_APP_SECRET` (필수), `ADMIN_TOKEN`(관리자 API 사용 시), `OPENAI_API_KEY`(AI 한줄평 사용 시) 설정
5. 배포

## API

### `GET /api/health`
- 상태 체크, 200 반환

### `GET /api/search?q=와이지&limit=8`
- 종목 코드/종목명/초성 검색
- 프론트 자동완성은 이 엔드포인트를 debounce 호출

### `POST /api/commentary`
- 목적: 분석 결과를 기반으로 한국어 한줄평 생성
- 호출 위치: 프론트 -> Pages Functions(`/api/commentary`) -> OpenAI API
- 브라우저에서 OpenAI를 직접 호출하지 않으며, 키는 서버 env만 사용
- 요청 예시:

```json
{
  "meta": { "symbol": "005930", "name": "삼성전자", "market": "KOSPI", "asOf": "2026-02-23T10:00:00+09:00", "profile": "short" },
  "final": { "overall": "NEUTRAL", "confidence": 68, "summary": "혼조 · 모멘텀 보통 · 변동성 보통" },
  "timeframe": { "tf": "day", "trend": 62, "momentum": 58, "risk": 47, "reasons": ["..."], "volumeScore": 55, "volRatio": 1.12 }
}
```

- 응답 예시:

```json
{
  "meta": { "symbol": "005930", "name": "삼성전자", "asOf": "2026-02-23T10:00:00+09:00", "source": "OPENAI", "model": "gpt-4o-mini", "cacheTtlSec": 60 },
  "comment": "일봉 기준 추세는 버티지만 변동성 관리가 필요한 국면입니다.",
  "disclaimer": "본 코멘트는 참고용 정보이며 투자 판단과 책임은 이용자에게 있습니다.",
  "warnings": []
}
```

- OpenAI 실패/미설정 시에도 `source: "RULE"` 폴백 한줄평을 반환

### `GET /api/screener?market=ALL&strategy=ALL&count=30`
- 종목코드 입력 없이 후보 종목 랭킹 조회 (캐시 기반, 실시간 계산 없음)
- 파라미터:
  - `market`: `KOSPI|KOSDAQ|ALL` (기본 `ALL`)
  - `strategy`: `ALL|VOLUME|HS|IHS` (기본 `ALL`)
  - `count`: 반환 상위 개수(기본 30, 최대 100)
  - `universe`: UI 호환 파라미터(현재 v1 고정값 500)
- 응답:
  - `items[]`: 후보 리스트
    - `code,name,market,lastClose,lastDate`
    - `scoreTotal, confidence, overallLabel`
    - `hits.volume / hits.hs / hits.ihs`
    - `reasons[]`, `levels{support,resistance,neckline}`
    - `backtestSummary{trades,winRate,avgReturn,PF,MDD}` (옵션)
  - `warningItems[]`: H&S 확정 기반 리스크 경고 섹션
  - `warnings[]`: rebuild 필요/캐시 상태/데이터 주의 등
  - `meta.rebuildRequired`: 오늘 캐시 miss 시 `true` (마지막 성공 결과 반환)
  - `meta.universeLabel`: `거래대금 상위 500 유니버스`
  - `meta.lastUpdatedAt`: 마지막 성공 빌드 시각
- 주의:
  - UI/문구는 후보/시그널 참고용이며 매수 추천/수익 보장을 의미하지 않습니다.

### `POST /api/admin/rebuild-screener?token=...`
- 스크리너 배치 재빌드 실행 (관리자용)
- 인증:
  - `token` 쿼리 또는 `x-admin-token` 헤더
  - env `ADMIN_TOKEN`과 일치해야 실행
- rebuild 순서:
  1. 유니버스 로드: `거래대금 상위 500`
     - key: `universe:turnoverTop500:YYYY-MM-DD`
     - miss 시 `ExternalProvider` 조회, 실패 시 `last_success` 폴백, 최종 실패 시 `StaticProvider`
  2. 유니버스 종목별 KIS 일봉 OHLCV 조회(기존 OHLCV 캐시 활용)
  3. VolumeScore + H&S/IHS + confidence 계산
  4. 점수 정렬 후 snapshot 저장(Top N 메타 포함)
     - key: `screener:v1:market=ALL:strategy=ALL:YYYY-MM-DD`
  5. `last_success` 키 갱신
- 타임아웃 회피(v1.1):
  - 한 번에 500개 전량 처리하지 않고 `batch` 단위로 분할 처리
  - 진행 상태 key: `screener:v1:rebuild-progress:YYYY-MM-DD`
  - 예: `batch=20`이면 호출 1회당 최대 20종목씩 처리(기본값 20)
  - 진행 중 응답은 `202` + `inProgress=true` + `progress` 필드 반환
  - 같은 엔드포인트를 재호출하면 이어서 처리, 완료 시 `200` + `inProgress=false`
  - 이미 다른 요청이 실행 중이어도 `409` 대신 `202(inProgress=true)`를 반환
- 동시 실행 방지:
  - lock key: `lock:rebuild-screener`
  - lock이 비정상 종료로 남아도 5분 이상 stale이면 자동 정리 후 재시도
- 실패 시:
  - 기존 `last_success` 캐시를 유지

예시:

```bash
curl -X POST "https://<your-pages-domain>/api/admin/rebuild-screener?token=<ADMIN_TOKEN>"
```

분할 처리 예시(batch 20):

```bash
curl -X POST "https://<your-pages-domain>/api/admin/rebuild-screener?token=<ADMIN_TOKEN>&batch=20"
```

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
- `tf`: `day|week|month`
- TF별 캔들 반환

### `GET /api/analysis?query=005930&tf=multi&count=180`
- `tf`: `day|week|month|multi`
- `count`: 일봉(day) 기준 조회 봉 수(week/month는 내부 최소치 강제)
- `view`(선택): `multi` 사용 시 다중 관점 오버레이(`overlays/confluence/explanations`) 포함
- `profile`(선택): `short|mid` (기본 `short`)
  - `short`: 추세 30 / 모멘텀 50 / 위험 20
  - `mid`: 추세 50 / 모멘텀 20 / 위험 30
- `higher_tf_source`(선택): `resample|kis` (기본 `resample`)
  - `resample`: day OHLCV를 서버에서 주봉/월봉으로 집계
  - `kis`: week/month를 KIS에 별도 호출
- `tf=multi` 응답 구조:

```json
{
  "meta": { "profile": "short|mid" },
  "final": {
    "overall": "GOOD|NEUTRAL|CAUTION",
    "confidence": 0,
    "summary": "",
    "profile": {}
  },
  "timeframes": {
    "month": {},
    "week": {},
    "day": {}
  },
  "warnings": []
}
```

- `tf=multi`는 부분 성공 허용:
  - 일부 TF 데이터가 부족해도 가능한 TF 결과를 반환
  - `day`만 가능하면 final은 day 기반으로 계산
- `timeframes.month/week/day`는 데이터 부족 시 `null`일 수 있음
- 각 TF 결과에는 `indicators`(MA/RSI/BB 시계열) 포함:
  - `indicators.ma`(기간/시계열), `indicators.rsi14`, `indicators.bb`, `indicators.macd`
- 각 TF 결과에는 `tradePlan`(entry/stop/target/riskReward/note) 포함
- 각 TF 결과에는 `profile`(성향 가중 점수/판정/가중치/설명) 포함
- 각 TF 결과에는 `overlays`/`confluence`/`explanations` 포함:
  - `overlays.priceLines[]`: 수평 레벨/존 라인
  - `overlays.zones[]`: 지지/저항 존(low/high/strength)
  - `overlays.segments[]`: 추세선/채널 선분 (t1,p1)-(t2,p2)
  - `overlays.markers[]`: 거래량 패턴 마커
  - `confluence[]`: 밴드별 강도와 근거
  - `explanations[]`: 선/구간 생성 사유 요약
- `signals.risk.breakdown`으로 Risk 구성점수(ATR/BB/MDD/급락)를 확인 가능
- `signals.momentum`에 `macd/macdSignal/macdHist/macdBullish` 포함
- 일봉 기준 `signals.volumePatterns[]`와 `signals.volume` 제공:
  - `volRatio`, `turnover`, `bodyPct`, `upperWickPct`, `lowerWickPct`, `pos20`, `volumeScore`, `reasons`
  - `volumePatterns[]` 원소: `{ t, type, label, desc, strength?, ref? }`
  - 패턴 타입: `BreakoutConfirmed`, `Upthrust`, `PullbackReaccumulation`, `ClimaxUp`, `CapitulationAbsorption`, `WeakBounce`
- 각 TF 결과에는 `signals.fundamental`(PER/PBR/EPS/BPS/시가총액/결산월/레이블) 포함
- 각 TF 결과에는 `signals.flow`(외국인·기관·개인·프로그램 순매수/외국인 보유율/레이블) 포함
- `tf=day|week|month`는 단일 TF 분석 응답(기존 day 응답 호환) 반환

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
- 펀더멘털/수급:
  - KIS `inquire-price`로 PER/PBR/EPS/BPS/시총/외국인 보유율/프로그램 순매수 조회
  - KIS `inquire-investor`로 외국인/기관/개인 순매수 조회

## 스코어링 v1 (요약)

- TF별 지표
  - month: MA(6/12/24), RSI14, BB20, ATR14, breakout(12)
  - week: MA(10/30/60), RSI14, BB20, ATR14, breakout(20)
  - day: MA(20/60/120), RSI14, BB20, ATR14, breakout(20)
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
  - 일봉 `volumeScore` 반영:
    - `>=70`: +8, `50~69`: +3, `<50`: -5
    - 단 `day risk < 35`이면 반영치를 50% 축소
## 캐시 정책

- 분석 캐시 + 원천 OHLCV 캐시를 분리 사용
- TF별 캐시 키(`종목 + tf`)로 저장
- 스크리너는 배치 snapshot 캐시를 사용(실시간 계산 없음)
  - 유니버스: `universe:turnoverTop500:YYYY-MM-DD`
  - 스크리너: `screener:v1:market=ALL:strategy=ALL:YYYY-MM-DD`
  - 재빌드 진행상태: `screener:v1:rebuild-progress:YYYY-MM-DD`
  - last success:
    - `universe:turnoverTop500:last_success`
    - `screener:v1:market=ALL:strategy=ALL:last_success`
- rebuild lock: `lock:rebuild-screener`
- multi 디버그를 위해 `warnings`에 `timeframes.*.candles.length`를 포함
- TTL:
  - `day`
    - 장중: 60초
    - 장마감 후 평일: 30분
    - 주말: 6시간
  - `week/month`
    - 장중: 30분
    - 장마감 후 평일: 60분
    - 주말: 24시간
  - `universe/screener snapshot`: 24시간

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
### 다중 관점 오버레이(v1)
- Horizontal Levels: 스윙 고저점(L=3) 클러스터링(±2.5%)으로 지지/저항 존 산출
- Trendlines: 최근 120봉 피벗 기반 상승/하락 추세선 추정
- Channels: 추세선과 반대 피벗 거리 평균으로 평행 채널 산출
- Volume Price Action: 기존 패턴(A~F)을 마커로 변환
- Confluence: 존/레벨/추세선/채널/MA/피보/패턴 기준가를 가격대 클러스터링해 강도 계산
