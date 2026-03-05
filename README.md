# KIS Stock Analyzer (Cloudflare Pages Functions + React)

KIS OpenAPI 기반 한국 주식 멀티 타임프레임 분석 서비스입니다.

- 타임프레임: `month`, `week`, `day`
- 핵심 API: `/api/analysis?tf=multi`
- 보조 API: `/api/backtest` (일봉 시그널 백테스트)
- 보조 API: `/api/account` (내 계좌 요약/보유종목 조회)
- 보조 API: `/api/screener` (종목 입력 없이 후보 종목 랭킹)
- 보조 API: `/api/admin/rebuild-screener` (배치형 스크리너 재빌드)
- 보조 API: `/api/admin/rebuild-screener/status` (배치 진행상태 조회)
- 보조 API: `/api/admin/rebuild-screener/history` (변동/실패 히스토리 조회)
- 프론트: 월/주/일 탭 + 최종 판정/신뢰도 표시
- 프론트: 기술적 분석 카드(RSI/MACD/볼린저 요약) 표시
- 프론트: 투자 성향 프로필(단기/중기) 동시 표시 + 가중 점수 카드
- 프론트: 펀더멘털(PER/PBR/EPS/BPS/시총) + 수급(외국인/기관/개인/프로그램) 카드 표시
- 프론트: 상단 탭으로 `종목 분석` / `종목 추천(스크리너)` / `전략` / `내 계좌` / `운영(관리자)` 전환
- 프론트: 상단 탭으로 `운영(관리자)` 패널 제공(상태/실패/히스토리/수동 실행)
- 프론트: 스크리너에 `거래대금 상위 500 유니버스`/마지막 갱신 시각 표시
- 스크리너: 워크포워드 튜닝 임계값 + 지수 상대강도(RS) 필터 + 품질 게이트(유동성/급락/거래정지 징후) + 일일 순위/점수 변동 요약
- 스크리너: 주간/월간 전략 검증 자동화(워크포워드) + active cutoff 자동 반영
- 프론트: Risk 점수 분해 카드 + Entry/Stop/Target(참고) 레벨 표시
- 프론트: 백테스트 신호/보유봉 조건 선택 후 재조회 지원
- 프론트: 일봉 거래량 패턴 마커(BRK/TRAP/PB 기본, HOT/CAP/WB 고급 토글) + 최근 10개 패턴 리스트
- 프론트: 차트 마커 클릭 시 패턴 상세 패널(체크리스트/ref.level/경고·확증 문구) 표시
- 프론트: 선택 패턴의 `ref.level`을 `t-10 ~ t+10` 짧은 수평선으로 표시(토글 지원)
- 프론트: 선택 패턴 캔들 세로 하이라이트(`Highlight selected candle` 토글) 지원
- 프론트: 다중 관점 오버레이(Levels/Trendlines/Channels/Zones/Markers) 토글 지원
- 프론트: Confluence(강한 지지/저항 구간) 카드 + 오버레이 설명 카드 표시
- 프론트: 추가 전략 카드 5종(다르바스/NR7+인사이드바/추세 템플릿/RSI 다이버전스/수급 지속성) 표시

## 기술 스택

- Frontend: React + Vite
- Chart: `lightweight-charts`
- Backend: Cloudflare Pages Functions (Workers)
- Data: KIS Developers OpenAPI
- Cache/Store: Cloudflare Cache API (+ 선택: KV 또는 D1 영속 저장)

## 폴더 구조

```text
.
├─ functions/
│  ├─ api/
│  │  ├─ admin/
│  │  │  └─ rebuild-screener/
│  │  │     ├─ index.ts
│  │  │     ├─ status.ts
│  │  │     └─ history.ts
│  │  ├─ analysis.ts
│  │  ├─ account.ts
│  │  ├─ backtest.ts
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
│     ├─ screenerPersistence.ts
│     ├─ walkforward.ts
│     ├─ universe.ts
│     ├─ search.ts
│     ├─ stockResolver.ts
│     └─ ...
├─ src/
│  ├─ App.tsx
│  ├─ AdminOpsPanel.tsx
│  ├─ ScreenerPanel.tsx
│  ├─ types.ts
│  └─ styles.css
├─ data/kr-stocks.json
├─ .github/workflows/
│  ├─ ci.yml
│  ├─ pages-preview.yml
│  └─ screener-rebuild.yml
└─ tests/
```

## 환경 변수

Cloudflare Pages Functions env 또는 로컬 `.dev.vars`:

- `KIS_APP_KEY` (필수)
- `KIS_APP_SECRET` (필수)
- `KIS_BASE_URL` (선택, 기본: 실전 URL)
- `KIS_ENV` (선택, `real|demo`)
- `KIS_ACCOUNT_NO` (선택, `/api/account`용 계좌번호 앞 8자리)
- `KIS_ACCOUNT_PRDT_CD` (선택, `/api/account`용 계좌상품코드 뒤 2자리, 기본 `01`)
- `KIS_KV` (선택, KIS access_token 저장 KV 바인딩명)
- `RATE_LIMIT_MAX_REQUESTS` (선택, 기본 `120`)
- `RATE_LIMIT_WINDOW_SEC` (선택, 기본 `60`)
- `ADMIN_TOKEN` (선택, `/api/admin/rebuild-screener` 보호용)
- `SITE_AUTH_PASSWORD` (선택, 설정 시 사이트 전체 로그인 보호 활성화)
- `SITE_AUTH_USERNAME` (선택, 기본 `owner`)
- `SITE_AUTH_COOKIE_SECRET` (선택, 세션 서명 키 / 미설정 시 `ADMIN_TOKEN` 또는 비밀번호 사용)
- `SITE_AUTH_SESSION_HOURS` (선택, 기본 `12`)
- `SITE_AUTH_DEBUG` (선택, `true`면 인증 미들웨어 오류 응답에 `stage/detail` 포함)
- `SCREENER_AUTO_BOOTSTRAP` (선택, 기본 `true`)
- `SCREENER_AUTO_BOOTSTRAP_BATCH` (선택, 기본 `20`)
- `SCREENER_KV` (선택, KV 바인딩명)
- `SCREENER_DB` (선택, D1 바인딩명)

주의:
- 키/시크릿은 반드시 Functions env에서만 읽습니다.
- 브라우저 코드에는 노출하지 않습니다.
- `KIS_BASE_URL`은 KIS 도메인(`openapi*.koreainvestment.com`)만 사용하세요. 잘못된 값이면 서버가 기본 KIS URL로 폴백합니다.
- `KIS_KV` 바인딩이 있으면 KIS 토큰을 `kis:token` 키에 저장/재사용하며, 만료 2시간 전 자동 갱신합니다.
- `SCREENER_KV`/`SCREENER_DB`는 문자열 env가 아니라 Cloudflare Pages의 Binding으로 연결합니다.
  - 둘 다 없으면 스크리너는 Cache API만 사용하며, 캐시 소실 시 히스토리/마지막 성공 복원이 제한됩니다.
- 자동 부트스트랩 동작:
  - `SCREENER_AUTO_BOOTSTRAP=true` + `ADMIN_TOKEN` 설정 시
  - `/api/screener`가 오늘 스냅샷 미존재를 감지하면 백그라운드로 자동 rebuild를 시작합니다.
  - 일일 갱신은 기본적으로 GitHub Actions `05:00 KST` 스케줄이 담당합니다.
- 앱 내 접근 보호(선택):
  - `SITE_AUTH_PASSWORD`를 설정하면 전체 사이트/`/api/*`가 로그인 세션 쿠키로 보호됩니다.
  - 로그인 페이지: `/__auth`
  - 로그아웃: `/__auth/logout`
  - GitHub Actions 리빌드는 기존처럼 `x-admin-token` 또는 `?token=`이 맞으면 인증 우회 허용됩니다.
  - 장애 추적 시 `SITE_AUTH_DEBUG=true`를 잠시 켜면 `MIDDLEWARE_ERROR` 응답에 실패 단계(`stage`)와 원인(`detail`)이 포함됩니다.

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
4. Environment variables: `KIS_APP_KEY`, `KIS_APP_SECRET` (필수), `ADMIN_TOKEN`(관리자 API 사용 시) 설정
5. (선택) Bindings:
   - KV Namespace 바인딩명: `KIS_KV` (KIS 토큰 재사용/갱신용)
   - KV Namespace 바인딩명: `SCREENER_KV`
   - D1 Database 바인딩명: `SCREENER_DB`
   - 권장: 최소 하나는 연결해 스크리너 snapshot/히스토리 영속 보관
6. 배포

## API

### `GET /api/health`
- 상태 체크, 200 반환

### `GET /api/search?q=와이지&limit=8`
- 종목 코드/종목명/초성 검색
- 프론트 자동완성은 이 엔드포인트를 debounce 호출

### `GET /api/account`
- KIS 계좌 요약/보유종목 조회 (서버사이드 호출, 프론트에 키/시크릿 미노출)
- 필요 env:
  - `KIS_ACCOUNT_NO` (앞 8자리)
  - `KIS_ACCOUNT_PRDT_CD` (뒤 2자리, 미설정 시 `01`)
- 응답:
  - `meta`: `asOf/source/account`
  - `summary`: `totalAssetAmount/totalEvaluationAmount/totalPurchaseAmount/totalProfitAmount/totalProfitRate/cashAmount`
  - `holdings[]`: `code/name/quantity/orderableQuantity/purchaseAvgPrice/currentPrice/purchaseAmount/evaluationAmount/profitAmount/profitRate/weightPercent`
  - `warnings[]`: 보유종목 없음/페이지 절단 등 안내
- 보안:
  - `cache-control: no-store`로 응답하며 민감 데이터 캐시를 최소화합니다.

### `GET /api/screener?market=ALL&strategy=ALL&count=30`
- 종목코드 입력 없이 후보 종목 랭킹 조회 (캐시 기반, 실시간 계산 없음)
- 파라미터:
  - `market`: `KOSPI|KOSDAQ|ALL` (기본 `ALL`)
  - `strategy`: `ALL|VOLUME|HS|IHS|VCP|WASHOUT_PULLBACK|DARVAS|NR7|TREND_TEMPLATE|RSI_DIVERGENCE|FLOW_PERSISTENCE` (기본 `ALL`)
  - `count`: 반환 상위 개수(기본 30, 최대 100)
  - `universe`: UI 호환 파라미터(현재 v1 고정값 500)
- 응답:
  - `items[]`: 후보 리스트
    - `code,name,market,lastClose,lastDate`
    - `scoreTotal, confidence, overallLabel`
    - `hits.volume / hits.hs / hits.ihs / hits.vcp`
    - `reasons[]`, `levels{support,resistance,neckline}`
    - `rs{benchmark,ret63Diff,label}`
    - `tuning{thresholds{volume,hs,ihs,vcp},quality}`
    - `backtestSummary{trades,winRate,avgReturn,PF,MDD}` (옵션)
  - `warningItems[]`: H&S 확정 기반 리스크 경고 섹션
  - `warnings[]`: rebuild 필요/캐시 상태/데이터 주의 등
  - `meta.rebuildRequired`: 오늘 캐시 miss 시 `true` (마지막 성공 결과 반환)
  - `meta.universeLabel`: `거래대금 상위 500 유니버스`
  - `meta.lastUpdatedAt`: 마지막 성공 빌드 시각
  - `meta.lastRebuildStatus`: 진행률/실패/재시도 요약
  - `meta.changeSummary`: 신규/상승/하락 종목 요약
    - `scoreRisers/scoreFallers`로 점수 변화 TopN 제공
  - `meta.rsSummary`: RS 필터 집계
  - `meta.tuningSummary`: 워크포워드 튜닝 집계
  - `meta.validationSummary`: 주간/월간 자동 검증 시각 + 전략별 active cutoff
  - `meta.alertsMeta`: 알림 필터/쿨다운 기준 + 전송/스킵 건수
- 캐시 miss 시 fallback 순서:
  1. Cache API `last_success`
  2. 영속 저장소(KV/D1) `snapshot:date:YYYY-MM-DD`
  3. 영속 저장소(KV/D1) `snapshot:last_success`
- 자동 실행:
  - 첫 기동/초기 빈 상태에서 `/api/screener` 조회 시 자동 1회 bootstrap 실행 가능
  - 조건: `SCREENER_AUTO_BOOTSTRAP=true`, `ADMIN_TOKEN` 설정, HTTPS 환경
  - 일일 갱신 누락 시(오늘 스냅샷 없음) 05:00 KST 이후 첫 조회에서 자동 재시도
- 주의:
  - UI/문구는 후보/시그널 참고용이며 매수 추천/수익 보장을 의미하지 않습니다.

VCP 응답 핵심 필드:
- `hits.vcp.detected`: 감지 여부
- `hits.vcp.state`: `NONE|POTENTIAL|CONFIRMED`
- `hits.vcp.score`: 0~100
- `hits.vcp.resistance`: `{price,zoneLow,zoneHigh,touches}`
- `hits.vcp.distanceToR`: 저항까지 거리(비율)
- `hits.vcp.contractions[]`: 최근 컨트랙션(고점/저점/깊이/기간)
- `hits.vcp.atr`: `{atrPct20,atrPct120,shrink}`
- `hits.vcp.leadership`: `{label,ret63,ret126}` (`STRONG|OK|WEAK`)
- `hits.vcp.pivot`: `{label,nearHigh52,newHigh52,pivotReady}`
- `hits.vcp.volume`: `{dryUp,dryUpStrength,volRatioLast,volRatioAvg10}`
- `hits.vcp.rs`: `{index,ok,rsVsMa90,rsRet63}`
- `hits.vcp.risk`: `{invalidLow,entryRef,riskPct,riskGrade}`
- `hits.vcp.quality`: `{baseWidthOk,depthShrinkOk,durationOk,baseSpanBars,baseLenOk,baseDepthMax,gapCrashFlags}`
- `hits.vcp.breakout`: `{confirmed,rule}`
- `hits.vcp.reasons[]`
- VCP 후보 컷(v1.2): `detected=true && score>=adaptiveCutoff` (기본 80, 백테스트 품질에 따라 자동 보정)

### `POST /api/admin/rebuild-screener?token=...`
- 스크리너 배치 재빌드 실행 (관리자용)
- 실행 모드:
  - `mode=trigger`: 리빌드 세션/진행 상태만 초기화(실제 종목 처리 없음)
  - `mode=step`(기본): 배치 1스텝 실행(진행 중이면 이어서 처리)
- 검증 모드:
  - `validate=auto`(기본): 주간 7일/월간 1개월 주기 도래 시 자동 검증 실행
  - `validate=weekly|monthly|all|none`: 강제 실행/비활성화
- 알림 필터 파라미터(선택):
  - `alertTopN` (기본 5)
  - `alertMinScore` (기본 80)
  - `alertMinDelta` (기본 5)
  - `alertCooldownDays` (기본 2)
- 인증:
  - `token` 쿼리 또는 `x-admin-token` 헤더
  - env `ADMIN_TOKEN`과 일치해야 실행
- rebuild 순서:
  1. 유니버스 로드: `거래대금 상위 500`
     - key: `universe:turnoverTop500:YYYY-MM-DD`
     - miss 시 `ExternalProvider(sise_quant)` 조회
     - 1차 실패 시 `MarketSummaryProvider(sise_market_sum)` 보조 소스 조회
     - 모두 실패 시 `last_success` 폴백, 최종 실패 시 `StaticProvider`
  2. 유니버스 종목별 KIS 일봉 OHLCV 조회(기존 OHLCV 캐시 활용)
  3. VolumeScore + H&S/IHS + VCP + confidence 계산
     - 워크포워드 튜닝(전략별 임계값) 적용
     - 지수 상대강도(RS, KOSPI/KOSDAQ 벤치마크) 필터 적용
  4. 주간/월간 검증 모드에 따라 active cutoff 재산정 및 저장
  5. 점수 정렬 후 snapshot 저장(Top N 메타 포함)
     - key: `screener:v1:market=ALL:strategy=ALL:YYYY-MM-DD`
  5. `last_success` 키 갱신
- 타임아웃 회피(v1.1):
  - 한 번에 500개 전량 처리하지 않고 `batch` 단위로 분할 처리
  - 진행 상태 key: `screener:v1:rebuild-progress:YYYY-MM-DD`
  - 예: `batch=20`이면 호출 1회당 최대 20종목씩 처리(기본값 20)
  - 권장 호출 순서: `mode=trigger` 1회 -> `mode=step` 반복
  - 진행 중 응답은 `202` + `inProgress=true` + `progress` 필드 반환
  - 같은 엔드포인트를 재호출하면 이어서 처리, 완료 시 `200` + `inProgress=false`
  - 이미 다른 요청이 실행 중이어도 `409` 대신 `202(inProgress=true)`를 반환
  - 종목별 일시 실패는 자동 재시도(최대 2회) 후 `failedItems`에 기록
  - 완료 응답에 `alerts` 포함:
    - `eligible.added/risers/fallers`: 임계값+쿨다운 통과 항목
    - `sentCount`, `skippedCount`: 실제 전송 대상/쿨다운 스킵 건수
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

### `GET /api/admin/rebuild-screener/status?token=...`
- 현재 rebuild 락/진행률/마지막 스냅샷 상태 조회 (관리자용)
- 인증:
  - `token` 쿼리 또는 `x-admin-token` 헤더
  - env `ADMIN_TOKEN`과 일치해야 조회 가능
- 응답:
  - `storage`: `{backend,enabled,snapshotSource}` (`cache|kv|d1|none`)
  - `inProgress`: 현재 재빌드 진행 여부
  - `lock`: `{exists,startedAt,ageSec,stale,staleAfterSec,ttlSec}`
  - `progress`: `{processed,total,remaining,processedCount,ohlcvFailures,insufficientData,failedCount,failedItems,retryStats,lastBatch,...}` 또는 `null`
  - `snapshot`: 마지막 성공 스냅샷 요약(`changeSummary/rsSummary/tuningSummary/rebuildMeta` 포함) 또는 `null`

예시:

```bash
curl "https://<your-pages-domain>/api/admin/rebuild-screener/status?token=<ADMIN_TOKEN>"
```

### `GET /api/admin/rebuild-screener/history?token=...&limit=7`
- 관리자용 운영 히스토리 조회
- 응답:
  - `changes[]`: 일자별 순위 변동 요약 + alertsMeta
  - `failures[]`: 일자별 실패 종목/재시도 요약
  - `alerts`: 알림 상태 키 개수/마지막 갱신시각
  - `backend`: `kv|d1|none`
- 참고:
  - `SCREENER_KV`/`SCREENER_DB` 미연결 시 빈 배열 + 안내 메시지를 반환

### `GET /api/backtest?query=005930&count=520&holdBars=10&signal=GOOD&ruleId=score-card-v1-day-overall`
- 일봉 기반 시그널 백테스트 결과 반환
- 파라미터:
  - `count`: 백테스트용 일봉 수(기본 520, 내부 최소치 자동 보정)
  - `holdBars`: 최대 보유 봉 수(기본 day룰 10, washout 룰 20)
  - `signal`: 진입 신호 기준(`GOOD|NEUTRAL|CAUTION`, 기본 `GOOD`)
  - `ruleId`: `score-card-v1-day-overall|washout-pullback-v1|washout-pullback-v1.1`
  - `target`(washout 전용): `2R|3R|ANCHOR_HIGH` (기본 `2R`)
  - `exit`(washout v1.1 전용): `PARTIAL|SINGLE_2R` (기본 `PARTIAL`)
- 응답:
  - `summary`: 전체 구간 승률/평균손익률/평균R/손익비/PF/MDD
  - `periods`: 3개월/6개월/1년 구간별 지표(승률/손익비/MDD 포함)
  - `trades`: 최근 거래 내역(최대 80건, washout은 `entries/avgEntry/invalidLow/r` 포함)
  - `strategyMetrics`(washout): `avgTranchesFilled, fillRate1, fillRate2, fillRate3, partialExitRate, target2HitRate`
  - `warnings`: 데이터/표본 부족 경고
  - `meta.ruleId`: 적용된 백테스트 룰 ID
- 시뮬레이션 규칙(현재):
  - 현재 운영 중인 day 스코어 룰을 과거 데이터에 롤링 적용
  - 신호 발생 다음 봉 시가 진입
  - `tradePlan.stop/target` 터치 시 청산(동시 터치 시 보수적으로 손절 우선)
  - 미도달 시 `holdBars` 만기 종가 청산

백테스트 모듈 설계:
- `strategy.ts`: 현재 스코어 룰을 과거 시점에 적용해 진입 신호/손절/목표 생성
- `engine.ts`: 단일 포지션 시뮬레이션(진입/청산/보유기간)
- `metrics.ts`: 승률/손익비/PF/MDD 등 검증 지표 집계
- `washout.ts`: 거래대금 설거지+눌림목 전략(v1/v1.1) 전용 시뮬레이션(단일/분할)

### `GET /api/ohlcv?query=005930&tf=day&days=180`
- `tf`: `day|week|month`
- TF별 캔들 반환

### `GET /api/analysis?query=005930&tf=multi&count=180`
- `tf`: `day|week|month|multi`
- `count`: 일봉(day) 기준 조회 봉 수(week/month는 내부 최소치 강제)
- `view`(선택): `multi` 사용 시 다중 관점 오버레이(`overlays/confluence/explanations`) 포함
  - day `view=multi`에서 VCP 감지 시:
    - `overlays.priceLines`에 `VCP 저항R` 라인 추가
    - `overlays.priceLines`에 `VCP 무효화` 라인(Invalidation) 추가
    - `overlays.markers`에 최근 컨트랙션 고점/저점(`VCPPeak/VCPTrough`) 마커 추가
    - `CONFIRMED`이면 돌파 마커(`VCPBreakout`) 추가
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

## KIS 토큰 런타임 관리

- 토큰은 빌드/커밋 시 발급하지 않고, 런타임에서만 처리합니다.
- KV 바인딩 `KIS_KV` 사용 시:
  - 토큰 key: `kis:token`
  - lock key: `kis:token:lock` (TTL 30초)
  - 저장 포맷: `{ access_token, expires_at }` (`expires_at`는 epoch seconds)
- 갱신 규칙:
  - `expires_at - now <= 7200초` 이면 `/oauth2/tokenP` 재발급 후 KV 갱신
  - `> 7200초` 이면 기존 토큰 재사용
  - KIS가 “기존 토큰 재반환”해도 만료시간과 함께 KV를 갱신
- 동시성:
  - lock 충돌 시 200/400/800ms 백오프 재시도
  - 실패 시 KV 토큰을 다시 읽어 사용(유효 토큰이 없으면 오류)
- API 호출:
  - `kisFetch`가 항상 `Authorization: Bearer <token>` 헤더를 적용
  - 401/토큰오류 응답이면 1회 강제 갱신 후 재시도(무한루프 없음)

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
- 스크리너 고도화(v1.3)
  - 지수 상대강도 필터: KOSPI/KOSDAQ 대비 63일 초과수익 + RS(30) 기반으로 `STRONG/NEUTRAL/WEAK`
  - 기본 후보 리스트는 `RS=WEAK`를 제외(HS 경고 리스트는 유지)
  - 워크포워드 튜닝: 전략별 임계값(Volume/HS/IHS/VCP)을 종목 일봉 히스토리로 보정해 confidence 반영
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
  - 영속 저장소(KV/D1) 키(선택):
    - `snapshot:date:YYYY-MM-DD`, `snapshot:last_success`
    - `history:changes:YYYY-MM-DD`, `history:failures:YYYY-MM-DD`
    - `alerts:last_sent` (알림 쿨다운 상태)
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
  - `history/alerts state`(KV/D1): 180일/365일

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
- `.github/workflows/screener-rebuild.yml`
  - 매일 `KST 05:00`(UTC `20:00`) 자동 실행
  - `/api/admin/rebuild-screener?mode=trigger` 1회 호출 후
  - `/api/admin/rebuild-screener?mode=step`를 batch(기본 20) 반복 호출하며 `inProgress=false`까지 진행
  - 동시 실행 방지를 위해 workflow concurrency 적용
  - 완료 시 Top 변동 종목 요약을 Telegram/Slack으로 선택 전송
  - 기본 호출은 `validate=auto`로 동작해 주간/월간 검증 컷오프를 자동 갱신
  - 알림 임계값 파라미터:
    - `ALERT_MIN_SCORE`(기본 80), `ALERT_MIN_DELTA`(기본 5), `ALERT_COOLDOWN_DAYS`(기본 2), `NOTIFY_TOPN`(기본 5)
    - workflow env 기본값으로 동작하며 필요 시 파일에서 조정
  - 필요한 GitHub Secrets:
    - `SCREENER_REBUILD_URL` 예: `https://<your-pages-domain>/api/admin/rebuild-screener`
    - `SCREENER_ADMIN_TOKEN` (권장) 또는 `ADMIN_TOKEN`
    - (선택) `SCREENER_TELEGRAM_BOT_TOKEN`, `SCREENER_TELEGRAM_CHAT_ID`
    - (선택) `SCREENER_SLACK_WEBHOOK_URL`
  - 필요 시 GitHub Actions에서 `workflow_dispatch`로 수동 실행 가능

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
