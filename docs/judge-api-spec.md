# judge-api-spec — 판정 API 계약

> `worker/` 배포 코드(`src/index.ts`, `types.ts`, `engine.ts`, `kma.ts`) 기준으로 작성한 계약서예요.
> 계산은 서버가 전부 하고, 프론트는 이 응답 JSON을 그리기만 해요.

## 기본 정보

| 항목 | 값 |
| --- | --- |
| Base URL | `https://today-outside-api.yoonjeonghyeon.workers.dev` |
| 런타임 | Cloudflare Workers |
| 인증 | 없음 (공개) |
| CORS | `Access-Control-Allow-Origin: *` / `Methods: GET, OPTIONS` / `Headers: Content-Type` |
| 콘텐츠 타입 | `application/json; charset=utf-8` |

`OPTIONS` 요청에는 본문 없이 CORS 헤더만 200으로 응답해요.

---

## 엔드포인트

### `GET /judge`

지금 판정 + 지표 + 시간창을 한 번에 돌려줘요. 프론트가 쓰는 유일한 엔드포인트예요.

#### 쿼리 파라미터

| 이름 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `nx` | ✅ | number | 기상청 격자 X. 정수 **1–149** 범위. 벗어나면 400 |
| `ny` | ✅ | number | 기상청 격자 Y. 정수 **1–253** 범위. 벗어나면 400 |
| `profile` | ✅ | `runner` \| `worker` \| `dog` | 이 셋 중 하나가 아니면 400 |
| `areaNo` | ⬜ | string | 기상청 생활기상지수 행정구역코드. **있으면** 실측 자외선지수를 시간대별로 사용하고, **없으면** 태양고도로 자외선을 추정해요. 없어도 정상 동작해요 |
| `area` | ⬜ | string | 지역명(예: `고양시 일산동구`, `서울 강남구`). 폭염특보 `alert`를 이 구역으로 필터해요. **있으면** 그 구역의 특보 등급만 노출, **없으면** 전국에 발효 중인 최고 등급으로 폴백. 없어도 정상 동작해요 |

예시:

```
GET /judge?nx=57&ny=127&profile=dog
GET /judge?nx=57&ny=127&profile=runner&areaNo=4128510000
GET /judge?nx=57&ny=127&profile=dog&area=고양시%20일산동구
```

> `nx`/`ny`는 위경도가 아니라 **격자 좌표**예요. 프론트는 위경도 → 격자 변환을 직접 하거나(기상청 LCC 공식), `data/`의 지역·격자 매핑 테이블에서 뽑아 넘겨요. 워커도 내부적으로 같은 LCC 공식(`worker/src/geo.ts`)을 써요.

### `GET /health`

```json
{ "ok": true }
```

---

## 성공 응답 (200) — `JudgeResponse`

```jsonc
{
  "generatedAt": "2026-07-27T13:20:00+09:00", // 응답 생성 시각 (KST, ISO8601)
  "observedAt":  "2026-07-27T13:00:00+09:00", // 실황 관측 기준 시각 (KST)
  "stale": false,                              // 캐시 폴백 여부 (아래 참고)
  "profile": "dog",                            // 요청한 프로필 그대로
  "now": { /* Verdict */ },
  "metrics": { /* Metrics */ },
  "hourly": [ /* HourSlot × 18 (06~23시) */ ],
  "bestWindow": { /* BestWindow | null */ },
  "alert": null,                               // Alert | null
  "source": "기상청"
}
```

- 모든 시각 문자열은 **KST(+09:00) ISO8601**이에요.
- `stale`: 현재 배포 코드는 항상 `false`를 반환해요. (기획서상 업스트림 장애 시 마지막 캐시를 `stale:true`로 서빙하려는 예약 필드. 프론트는 `true`일 때 "N분 전 기준" 배지를 띄울 수 있게 대비해 두세요.)
- `alert`: 폭염특보 배너. 발효 중이면 `{ "type": "heat", "text": "폭염경보가 발효 중이에요. 한낮 야외 활동을 줄여요" }`, 없으면 `null`. `area`를 주면 그 구역 기준, 없으면 전국 최고 등급. (기상특보 서비스 미신청/장애 시에도 안전하게 `null`.)
- `source`: 항상 `"기상청"`. 지표 화면 출처 표기에 그대로 써요.

### `now` — `Verdict`

```jsonc
{
  "level": 4,                 // 1~5 판정 등급
  "score": 79,               // 0~100 위험도 (정수, 참고용)
  "headline": "지금은 흙길이나 잔디로만 가요", // 판정 한 줄 (프로필×등급 규칙 생성)
  "reason": "아스팔트가 51℃까지 올라 발바닥에 무리가 갈 수 있어요", // 근거 한 줄
  "gate": null               // 하드 게이트로 등급이 강제됐으면 그 ID, 아니면 null
}
```

**등급(`level`) ↔ 색 ↔ 점수 구간**

| level | 의미 | 색 | score 구간 |
| --- | --- | --- | --- |
| 1 | 좋음 | `#0E9F6E` | 0–19 |
| 2 | 보통 | `#A3C13A` | 20–39 |
| 3 | 주의 | `#F5A524` | 40–59 |
| 4 | 위험 | `#F2711C` | 60–79 |
| 5 | 매우 위험 | `#E03131` | 80–100 |

`headline`/`reason`은 서버가 규칙 기반(LLM 미사용)으로 생성해요. 프론트는 문자열을 그대로 출력하면 돼요. `headline`에는 `\n`이 없지만 화면 폭에 맞춰 프론트에서 줄바꿈해도 좋아요.

**`gate` 값** — 특정 지표가 임계를 넘어 등급이 최소치로 강제됐을 때만 채워져요.

| gate ID | 조건 | 강제 최소 등급 |
| --- | --- | --- |
| `UV_11` | 자외선지수 ≥ 11 | 3 |
| `WORKER_33` | worker + 체감온도 ≥ 33℃ | 3 |
| `DOG_ROAD_52` | dog + 노면 ≥ 52℃ | 4 |
| `HEAT_35` | 체감온도 ≥ 35℃ (전 프로필) | 4 |
| `ROAD_60` | 노면 ≥ 60℃ (전 프로필) | 5 |
| `RAIN` | 강수(비/비눈/소나기, `pty` 1·2·4) | 3 |

### `metrics` — `Metrics`

```jsonc
{
  "airTemp": 32.0,          // 기온 ℃ (소수 1자리)
  "humidity": 68,           // 상대습도 % (정수)
  "windSpeed": 1.2,         // 풍속 m/s (소수 1자리)
  "feelsLike": 33.1,        // 체감온도 ℃ (소수 1자리)
  "uvi": 8,                 // 자외선지수 (정수)
  "uviLabel": "매우높음",    // 낮음/보통/높음/매우높음/위험
  "roadTemp": 51.0,         // 대표 노면온도 = 아스팔트 (소수 1자리, 항상 추정)
  "roadTempEstimated": true, // 항상 true → '추정' 배지 필수
  "roadBasis": "기온 32℃ + 강한 햇빛 + 약한 바람 기준", // 노면 근거 한 줄
  "roadBySurface": {
    "asphalt": 51.0,        // roadTemp와 동일 값
    "pavement": 46.3,       // 보도블록
    "grass": 37.5,          // 잔디
    "soil": 36.8            // 흙길
  }
}
```

- `roadTemp`는 `roadBySurface.asphalt`와 항상 같아요 (아스팔트가 대표 노면).
- `roadTempEstimated`는 **항상 `true`** 예요. 노면온도 옆에는 반드시 `추정` 배지를 붙이세요 (정책·기획 제약).
- `uviLabel`: `낮음`(uvi<3) / `보통`(3–5) / `높음`(6–7) / `매우높음`(8–10) / `위험`(11+).

### `hourly` — `HourSlot[]`

**06시부터 23시까지 18개** 슬롯이 시간 오름차순으로 들어와요. 시간창 스트립을 그리는 데이터예요.

```jsonc
[
  { "hour": 6,  "level": 1, "feelsLike": 26.4, "roadTemp": 30.1 },
  { "hour": 7,  "level": 1, "feelsLike": 27.0, "roadTemp": 32.8 },
  // …
  { "hour": 13, "level": 4, "feelsLike": 33.1, "roadTemp": 51.0 },
  // …
  { "hour": 23, "level": 1, "feelsLike": 25.9, "roadTemp": 28.4 }
]
```

각 슬롯은 `hour`(6–23), `level`(1–5), `feelsLike`(℃), `roadTemp`(아스팔트 ℃)만 담아요. `headline`/`reason`은 시간별로 주지 않아요 — 프론트가 등급 색으로만 칠하고, 탭 시 지표를 툴팁으로 보여줄 수 있어요.

### `bestWindow` — `BestWindow | null`

현재 시각 **이후**, `level ≤ 2`(보통 이하)가 연속되는 가장 이른 구간이에요.

```jsonc
{
  "start": 19,                  // 시작 시각(시)
  "end": 23,                    // 끝 시각(시, 포함)
  "label": "저녁 7시부터 좋아요"   // 그대로 출력할 라벨
}
```

- 구간이 뒤(예보 끝)에서 잘리지 않으면 **2시간 이상**, 끝까지 이어지면 **1시간 이상**일 때 잡혀요.
- 조건에 맞는 구간이 없으면 `null`. 프론트는 `null`일 때 "오늘은 좋은 시간이 없어요" 류로 폴백하세요.
- `label` 접두어: `오전 N시` / `낮 12시` / `오후 N시` / `저녁 N시`(18시 이후).

---

## 에러 응답

형태는 공통이에요:

```jsonc
{ "error": "INVALID_PARAM", "message": "nx, ny, profile을 확인해 주세요" }
```

| HTTP | `error` | 상황 |
| --- | --- | --- |
| 400 | `INVALID_PARAM` | `nx`/`ny`가 격자 범위(정수 1–149 / 1–253) 밖이거나 `profile`이 셋 중 하나가 아님 |
| 404 | `NOT_FOUND` | `/judge`, `/health` 외의 경로 |
| 503 | `UPSTREAM_UNAVAILABLE` | 기상청 API 장애·키 오류 등 상류 실패 |

> 503이 뜨면 프론트는 마지막 성공 응답을 자체 캐시에서 그려주고 "잠시 후 다시 시도"를 안내하는 게 좋아요 (빈 화면 금지, 기획 리스크 대응).

---

## 캐시·발표 주기 (참고)

워커가 기상청 응답을 격자·발표시각 단위로 캐시해요. 프론트가 신경 쓸 필요는 없지만 갱신 감각을 위해:

| 데이터 | 발표 | 워커 캐시 TTL |
| --- | --- | --- |
| 초단기실황 (기온·습도·풍속·강수) | 매시 40분 | 10분 |
| 단기예보 (시간별) | 02·05·08·11·14·17·20·23시 | 3시간 |
| 자외선지수 | 06·18시 | 6시간 |

`observedAt`은 실황 발표 기준 시각이라 `generatedAt`보다 뒤처질 수 있어요. "언제 기준" 표기에는 `observedAt`을 쓰세요.

---

## 프론트 체크리스트

- [ ] `roadTemp`/`roadBySurface`에는 **항상 `추정` 배지** + `roadBasis` 근거 노출
- [ ] `level` → 등급 색(위 표) 매핑을 단일 상수로 관리
- [ ] `hourly`는 18칸 고정, 현재 시각 슬롯에 인디케이터
- [ ] `bestWindow === null` 폴백 처리
- [ ] `stale === true` / `alert !== null` 도 언젠가 올 수 있으니 렌더 분기 대비
- [ ] 503·네트워크 실패 시 마지막 응답 캐시 서빙 + "N분 전 기준"
- [ ] `source`("기상청") 출처 표기 필수
