# PriceTag — 프로젝트 계획·진행 현황

> 서비스 한 줄: **「사기 전에, 3초만」** — 매장 태그 사진으로 온라인 표시가를 빠르게 비교하는 웹앱 (가제명 PriceTag).

## 기술 스택

| 영역 | 선택 |
|------|------|
| 프레임워크 | Next.js 16 (App Router), TypeScript |
| 스타일 | Tailwind CSS v4 |
| 이미지 → 서버 | JSON Base64 (`imageBase64`, `mimeType`) |
| 품번·가격 인식 | **KIE.AI** — Anthropic Messages 호환 `POST https://api.kie.ai/claude/v1/messages` (`fetch`, SDK 없음) |
| 쇼핑 가격 | **네이버 쇼핑 오픈 API** `GET /api/search` |

## 환경 변수 (`.env.local`)

- `KIE_API_KEY`, `KIE_API_BASE_URL` (기본 `https://api.kie.ai`), `KIE_VISION_MODEL` (예: `claude-sonnet-4-6`)
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`

## 디렉터리 / API 요약

| 경로 | 역할 |
|------|------|
| [`app/page.tsx`](app/page.tsx) | 클라이언트 UI: 업로드 → `/api/extract` → `/api/search`, 매장가·절약액, 결과 리스트 (`<a>` 직링크) |
| [`app/api/extract/route.ts`](app/api/extract/route.ts) | 태그 이미지 분석 → `{ productCode, price }` |
| [`app/api/search/route.ts`](app/api/search/route.ts) | 네이버 `shop.json` 프록시 → `{ items: [{ title, lprice, mallName, link, image }] }` |
| [`app/layout.tsx`](app/layout.tsx) | 루트 레이아웃 |
| [`.cursorrules`](.cursorrules) | 프로젝트 규칙 요약 |

---

## Phase별 진행 내역 (지금까지)

### Phase 1 — 프로젝트 초기화 (완료)

- `create-next-app` (TypeScript, Tailwind, App Router, `@/*` 별칭)
- `.env.local` 템플릿, `.gitignore` (`.env*` 포함), `.cursorrules`

### Phase 2 — 네이버 쇼핑 검색 API (완료)

- [`app/api/search/route.ts`](app/api/search/route.ts): `GET ?query=`, `display=10`, `sort=asc`, `<b>` 제거, `lprice` 숫자화

### Phase 3 — 품번 추출 API (완료, 이후 스펙 변경됨)

- 최초 Anthropic SDK → **KIE.AI Messages API**로 전환
- 요청/응답·에러 처리 정리

### Phase 4 — 최소 UI (완료)

- [`app/page.tsx`](app/page.tsx): 파일 업로드, 분석, 결과·에러 처리

### Phase 5 — (시도·롤백 정리)

- **네이버 직링크 차단 대응**으로 네이버 검색 우회 / Google 우회 / 클립보드 복사 등을 적용했다가 **요청에 따라 롤백**
- 현재: **모든 몰 동일하게 `item.link`를 `<a target="_blank">`로 연결**
- **`/api/search-scrape` + cheerio**: 저장소에 **추가되지 않음** (또는 제거된 상태)

### Phase 6 — 태그에서 가격 자동 인식 (완료)

- Extract 프롬프트·파싱: **`{ productCode, price }`** (`price`는 `number | null`)
- 레거시 `{ brand, code }` 응답은 **품번 문자열만 폴백**, 가격 없음
- 프론트: `price !== null`이면 **매장가 입력란 자동 채움** + 안내 문구

---

## UI에서 유지 중인 카피·동작

- **온라인 최저 표시가** + `* 쇼핑몰 쿠폰·회원 혜택 적용 시 더 저렴할 수 있어요`
- 절약액: **「최소 N원 아낄 수 있어요」** (`최소` 강조)
- 노란 **쇼핑 팁** 박스
- 가격 비교 카드 하단: **「→ 쇼핑몰에서 확인하기」**

---

## 아직 하지 않은 것 (원 지시서 기준 참고)

- **Phase 6 (디자인 완성)**: Pretendard CDN, `tailwind.config` 커스텀 컬러, 크림/브랜드 컬러 전면 적용, 하단 공유(Web Share) 등
- **Phase 7**: GitHub + Vercel 배포, 환경 변수 등록

---

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저: `http://localhost:3000`

---

## 변경 이력 요약

| 구분 | 내용 |
|------|------|
| 비전 API | Anthropic SDK 제거 → KIE.AI Anthropic Messages 포맷 + `fetch` |
| Extract 응답 | `brand`/`code` → **`productCode` / `price`** (검색 쿼리는 `productCode`) |
| 네이버 링크 | 특수 처리 제거, **직링크** |

이 파일은 진행 상황을 한곳에 모아 둔 **살아 있는 계획서**로 두고, Phase가 바뀔 때마다 업데이트하면 됩니다.
