import { NextRequest, NextResponse } from "next/server";
import {
  searchProducts as coupangSearchProducts,
  type CoupangProduct,
} from "@/lib/coupang";

const NAVER_SHOP_URL = "https://openapi.naver.com/v1/search/shop.json";
const COUPANG_LIMIT = 5;

function stripBoldTags(title: string): string {
  return title.replace(/<\/?b>/gi, "");
}

type NaverShopItem = {
  title?: string;
  lprice?: string;
  mallName?: string;
  link?: string;
  image?: string;
};

type NaverShopResponse = {
  items?: NaverShopItem[];
};

export function buildSearchQuery(
  query: string,
  brand?: string,
  productType?: string,
  modelName?: string
): string {
  // 모델명이 있으면 코드(query)는 빼고 brand+modelName+productType 으로 검색.
  // 코드는 시즌·컬러별로 자주 바뀌어 listing 매칭이 어렵지만 모델명은 안정적임.
  const parts: string[] = [];
  if (brand?.trim()) {
    parts.push(brand.trim());
  }
  if (modelName?.trim()) {
    parts.push(modelName.trim());
  }
  if (productType?.trim()) {
    parts.push(productType.trim());
  }
  if (!modelName?.trim() && query?.trim()) {
    parts.push(query.trim());
  }
  return parts.join(" ");
}

type NormalizedItem = {
  title: string;
  lprice: number;
  mallName: string;
  link: string;
  image: string;
};

/**
 * Naver lprice는 문자열·숫자 혼용. 쉼표·공백 제거 후 정수로 통일.
 */
function parseLprice(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) {
    return 0;
  }
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function mapNaverItems(raw: NaverShopItem[]): NormalizedItem[] {
  return raw.map((item) => ({
    title: stripBoldTags(String(item.title ?? "")),
    lprice: parseLprice(item.lprice),
    mallName: String(item.mallName ?? ""),
    link: String(item.link ?? ""),
    image: String(item.image ?? ""),
  }));
}

function sortByLpriceAsc(items: NormalizedItem[]): NormalizedItem[] {
  return [...items].sort((a, b) => {
    const ap = a.lprice > 0 ? a.lprice : Number.POSITIVE_INFINITY;
    const bp = b.lprice > 0 ? b.lprice : Number.POSITIVE_INFINITY;
    if (ap !== bp) {
      return ap - bp;
    }
    return 0;
  });
}

function computeLowestLprice(items: NormalizedItem[]): number | null {
  const positive = items
    .map((i) => i.lprice)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (positive.length === 0) {
    return null;
  }
  return Math.min(...positive);
}

/** 네이버 쇼핑 API 최대 display=100. 적게 받으면 저가가 목록에 안 들어올 수 있음. */
const SHOP_DISPLAY = "100";

async function fetchNaverShop(
  searchQuery: string,
  clientId: string,
  clientSecret: string
): Promise<NormalizedItem[]> {
  const params = new URLSearchParams({
    query: searchQuery,
    display: SHOP_DISPLAY,
    sort: "asc",
  });

  const upstream = await fetch(`${NAVER_SHOP_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
  });

  if (!upstream.ok) {
    const errBody = await upstream.text();
    console.error("네이버 쇼핑 API 오류:", upstream.status, errBody);
    throw new Error("NAVER_API_ERROR");
  }

  const data = (await upstream.json()) as NaverShopResponse;
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const mapped = mapNaverItems(rawItems);
  const beforeSort = mapped.map((i) => i.lprice);
  const sorted = sortByLpriceAsc(mapped);
  const lowestLprice = computeLowestLprice(sorted);

  if (process.env.NODE_ENV === "development") {
    console.log("[pricetag/search] 받은 items 개수:", rawItems.length);
    console.log(
      "[pricetag/search] 각 item lprice (정렬 전, 파싱 후):",
      beforeSort
    );
    console.log(
      "[pricetag/search] 최저가 계산 결과 (lprice>0 기준 min):",
      lowestLprice
    );
    console.log(
      "[pricetag/search] 화면/응답에 쓰일 최저가 (검산):",
      lowestLprice,
      "/ 첫 행 lprice:",
      sorted[0]?.lprice
    );
  }

  return sorted;
}

type CodePermutationInfo = {
  used: true;
  originalCode: string;
  matchedCode: string;
};

type SearchStepNumber = 1 | 2 | 3 | 4 | 5 | 6;

type SearchStep = {
  step: SearchStepNumber;
  query: string;
  /** 필터에 넘길 modelName. 단계별로 strict/model/loose 모드 결정. */
  filterModelName: string;
  /** Step 3 (코드 변형) 일 때만 채워짐. usedCodePermutation 메타 추적용. */
  variant?: string;
};

type SearchStrategy = {
  step: SearchStepNumber;
  query: string;
  attempted: number;
};

/**
 * 6단계 폴백 쿼리 배열 빌드 (matched 검색 위해 단계별 시도 후보).
 * 빈 토큰 자동 제외, 동일 쿼리 dedup.
 *
 *  1. brand + modelName + code  (가장 정확)
 *  2. brand + code             (productType 노이즈 제거)
 *  3. brand + code변형들        (OCR 실수 보정)
 *  4. brand + modelName        (코드 자체가 잘못된 경우)
 *  5. brand + productType      (last resort, loose)
 *  (Step 6 = barcode 단독 — 호출부에서 별도 처리)
 */
function buildSearchSteps(args: {
  brand: string;
  modelName: string;
  productType: string;
  code: string | null;
}): SearchStep[] {
  const { brand, modelName, productType, code } = args;
  const steps: SearchStep[] = [];
  const seen = new Set<string>();

  function push(
    step: Exclude<SearchStepNumber, 6>,
    tokens: string[],
    filterModelName: string,
    variant?: string
  ) {
    const query = tokens
      .map((t) => (t || "").trim())
      .filter((t) => t.length > 0)
      .join(" ");
    if (!query || seen.has(query)) {
      return;
    }
    seen.add(query);
    steps.push({ step, query, filterModelName, variant });
  }

  if (brand && modelName && code) {
    push(1, [brand, modelName, code], modelName);
  }
  if (brand && code) {
    push(2, [brand, code], "");
  }
  if (code && code.length >= PRODUCT_CODE_MIN_LENGTH) {
    const variants = generateCodePermutations(code);
    for (const v of variants) {
      push(3, [brand, v], "", v);
    }
  }
  if (brand && modelName) {
    push(4, [brand, modelName], modelName);
  }
  if (brand && productType) {
    push(5, [brand, productType], "");
  }

  return steps;
}

type NaverResult = {
  ok: boolean;
  items: NormalizedItem[];
  usedBarcode: boolean;
  usedRelaxedMatch: boolean;
  usedCodePermutation: CodePermutationInfo | null;
  searchStrategy: SearchStrategy | null;
};

type CoupangResult = {
  ok: boolean;
  products: CoupangProduct[];
  cheapest: CoupangProduct | null;
  deepLink: string | null;
  usedBarcode: boolean;
  usedRelaxedMatch: boolean;
  usedCodePermutation: CodePermutationInfo | null;
  searchStrategy: SearchStrategy | null;
  error?: string;
};

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === "string") {
    return e;
  }
  return "unknown error";
}

const RELEVANCE_THRESHOLD = 30;
const PRODUCT_CODE_MIN_LENGTH = 5;

const GENERIC_WORDS = new Set([
  // 의류/잡화
  "슬랙스", "모자", "티셔츠", "바지", "원피스", "자켓", "코트", "신발", "운동화",
  "가방", "지갑", "시계", "선글라스", "안경", "반팔", "긴팔", "정장", "셔츠", "후드", "맨투맨",
  // 가전
  "에어프라이어", "청소기", "공기청정기", "전자레인지", "냉장고", "세탁기", "건조기",
  "믹서기", "토스터", "전기포트", "정수기", "선풍기", "히터", "전기장판",
  // 액세서리·소모품
  "베이킹페이퍼", "파치먼트페이퍼", "라이너", "필터", "소모품", "액세서리",
  // 호환·대체 단어 (토큰 점수도 0 — 호환 키워드 컷이 1차 차단)
  "인공", "호환", "교체용", "리필", "케이스", "파우치", "홀더",
]);

/** title/productName 에 호환·대체품 명시 키워드가 있으면 정품 검색 의도와 어긋나므로 무조건 컷. */
const COMPATIBLE_KEYWORDS = [
  "호환",
  "대체",
  "compatible",
  "fit for",
  "for use with",
];

function isCompatibleAccessory(name: string): boolean {
  const lower = (name ?? "").toLowerCase();
  return COMPATIBLE_KEYWORDS.some((kw) => lower.includes(kw));
}

/** "NWSLPK0400" 같은 영문대문자+숫자 코드 추출 (없으면 null) */
function extractProductCode(query: string): string | null {
  const m = query.toUpperCase().match(/[A-Z]{2,}[A-Z0-9]{3,}/);
  return m ? m[0] : null;
}

/**
 * 브랜드 힌트 우선순위:
 *  1) API에서 받은 brand
 *  2) 쿼리 첫 토큰이 한글/영문 단어이면서 숫자 안 섞인 경우
 *  3) (코드 단독 같은 케이스) 빈 문자열
 */
function extractBrandHint(brandFromApi: string, query: string): string {
  if (brandFromApi) {
    return brandFromApi;
  }
  const m = query.trim().match(/^\S+/);
  if (!m) {
    return "";
  }
  const firstToken = m[0];
  if (/\d/.test(firstToken)) {
    return "";
  }
  const brandMatch = firstToken.match(/^[가-힣A-Za-z]+/);
  return brandMatch ? brandMatch[0] : "";
}

/** 알파벳/숫자만 남기고 lowercase. 코드 매칭에서 하이픈·공백·슬래시 변형 흡수. */
function normalizeAlphanumeric(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** OCR 자주 혼동하는 문자 양방향 매핑. extractProductCode 가 uppercase 반환하므로 키도 uppercase. */
const OCR_CONFUSION_MAP: Record<string, string[]> = {
  O: ["0"],
  "0": ["O"],
  I: ["1"],
  "1": ["I"],
  B: ["8"],
  "8": ["B"],
  S: ["5"],
  "5": ["S"],
  Y: ["V"],
  V: ["Y"],
  Z: ["2"],
  "2": ["Z"],
};

/**
 * productCode 를 1글자씩 양방향 변형. 한 번에 한 글자만 (조합 폭발 방지).
 * 원본은 호출부에서 이미 시도하므로 결과에 포함하지 않음. 최대 max 개.
 */
function generateCodePermutations(code: string, max: number = 10): string[] {
  if (!code) {
    return [];
  }
  const seen = new Set<string>([code]);
  const result: string[] = [];

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const replacements = OCR_CONFUSION_MAP[ch];
    if (!replacements) {
      continue;
    }
    for (const rep of replacements) {
      const variant = code.slice(0, i) + rep + code.slice(i + 1);
      if (seen.has(variant)) {
        continue;
      }
      seen.add(variant);
      result.push(variant);
      if (result.length >= max) {
        return result;
      }
    }
  }

  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreItemRelevance(
  name: string,
  query: string,
  extractedCode: string | null,
  brandHint: string,
  modelName: string
): number {
  const lowerName = (name ?? "").toLowerCase();
  const normalizedName = normalizeAlphanumeric(lowerName);
  let score = 0;

  if (extractedCode) {
    const normalizedCode = normalizeAlphanumeric(extractedCode);
    if (normalizedCode && normalizedName.includes(normalizedCode)) {
      score += 100;
    }
  }

  if (modelName && modelName.trim()) {
    const lowerModel = modelName.trim().toLowerCase();
    if (lowerName.includes(lowerModel)) {
      score += 50;
    }
  }

  if (brandHint && lowerName.includes(brandHint.toLowerCase())) {
    score += 30;
  }

  const seen = new Set<string>();
  for (const raw of query.split(/\s+/)) {
    const t = raw.trim();
    if (t.length < 2 || GENERIC_WORDS.has(t)) {
      continue;
    }
    const tl = t.toLowerCase();
    if (seen.has(tl)) {
      continue;
    }
    seen.add(tl);
    if (lowerName.includes(tl)) {
      score += 10;
    }
  }

  return score;
}

/**
 * 우선순위:
 *  1) productCode 가 명확(5자 이상)하면 strict — 코드 매칭(+100) 필수
 *  2) modelName 있으면 model — 모델명 매칭(+50) 필수
 *  3) 둘 다 없으면 loose — 브랜드+토큰 합산 30 이상
 *
 * strict 모드에서 결과 0개면 호출부에서 relaxed 폴백으로 재필터.
 */
function effectiveThresholdFor(
  extractedCode: string | null,
  modelName: string
): { threshold: number; mode: "strict" | "model" | "loose" } {
  if (extractedCode && extractedCode.length >= PRODUCT_CODE_MIN_LENGTH) {
    return { threshold: 100, mode: "strict" };
  }
  if (modelName && modelName.trim()) {
    return { threshold: 50, mode: "model" };
  }
  return { threshold: RELEVANCE_THRESHOLD, mode: "loose" };
}

function relaxedThresholdFor(modelName: string): number {
  if (modelName && modelName.trim()) {
    return 50;
  }
  return RELEVANCE_THRESHOLD;
}

function filterCoupangByRelevance(
  products: CoupangProduct[],
  query: string,
  brand: string,
  modelName: string
): { products: CoupangProduct[]; usedRelaxedMatch: boolean } {
  const code = extractProductCode(query);
  const brandHint = extractBrandHint(brand, query);
  const { threshold, mode } = effectiveThresholdFor(code, modelName);
  const before = products.length;

  // 1) 호환·대체품 사전 컷 (항상 적용, threshold 무관)
  const beforeCompat = products.length;
  const compatFiltered = products.filter(
    (p) => !isCompatibleAccessory(p.productName)
  );
  const compatibleCut = beforeCompat - compatFiltered.length;

  // 2) 점수 산정
  const scored: { p: CoupangProduct; score: number }[] = compatFiltered.map(
    (p) => ({
      p,
      score: scoreItemRelevance(
        p.productName,
        query,
        code,
        brandHint,
        modelName
      ),
    })
  );

  let passed = scored.filter((s) => s.score >= threshold);
  let usedRelaxedMatch = false;
  let relaxedBrandCut = 0;
  let relaxedBrandKept = 0;

  // 3) strict 0개 → relaxed 폴백 + brand 강제 가드
  if (passed.length === 0 && mode === "strict") {
    const relaxed = relaxedThresholdFor(modelName);
    let relaxedPassed = scored.filter((s) => s.score >= relaxed);

    if (brandHint && relaxedPassed.length > 0) {
      const before2 = relaxedPassed.length;
      const lowerBrand = brandHint.toLowerCase();
      relaxedPassed = relaxedPassed.filter((s) =>
        s.p.productName.toLowerCase().includes(lowerBrand)
      );
      relaxedBrandCut = before2 - relaxedPassed.length;
      relaxedBrandKept = relaxedPassed.length;
    }

    if (relaxedPassed.length > 0) {
      passed = relaxedPassed;
      usedRelaxedMatch = true;
    }
  }

  const topScore = passed.reduce((m, s) => Math.max(m, s.score), 0);

  console.log("[coupang filter]", {
    query,
    mode,
    threshold,
    productCode: code,
    modelName: modelName || null,
    brandHint: brandHint || null,
    before,
    compatibleCut,
    after: passed.length,
    usedRelaxedMatch,
    relaxedBrandCut,
    relaxedBrandKept,
    topScore,
  });

  return {
    products: passed.map((s) => s.p),
    usedRelaxedMatch,
  };
}

function filterNaverByRelevance(
  items: NormalizedItem[],
  query: string,
  brand: string,
  modelName: string
): { items: NormalizedItem[]; usedRelaxedMatch: boolean } {
  const code = extractProductCode(query);
  const brandHint = extractBrandHint(brand, query);
  const { threshold, mode } = effectiveThresholdFor(code, modelName);
  const before = items.length;

  const beforeCompat = items.length;
  const compatFiltered = items.filter(
    (i) => !isCompatibleAccessory(i.title)
  );
  const compatibleCut = beforeCompat - compatFiltered.length;

  const scored: { i: NormalizedItem; score: number }[] = compatFiltered.map(
    (i) => ({
      i,
      score: scoreItemRelevance(i.title, query, code, brandHint, modelName),
    })
  );

  let passed = scored.filter((s) => s.score >= threshold);
  let usedRelaxedMatch = false;
  let relaxedBrandCut = 0;
  let relaxedBrandKept = 0;

  if (passed.length === 0 && mode === "strict") {
    const relaxed = relaxedThresholdFor(modelName);
    let relaxedPassed = scored.filter((s) => s.score >= relaxed);

    if (brandHint && relaxedPassed.length > 0) {
      const before2 = relaxedPassed.length;
      const lowerBrand = brandHint.toLowerCase();
      relaxedPassed = relaxedPassed.filter((s) =>
        s.i.title.toLowerCase().includes(lowerBrand)
      );
      relaxedBrandCut = before2 - relaxedPassed.length;
      relaxedBrandKept = relaxedPassed.length;
    }

    if (relaxedPassed.length > 0) {
      passed = relaxedPassed;
      usedRelaxedMatch = true;
    }
  }

  const topScore = passed.reduce((m, s) => Math.max(m, s.score), 0);

  console.log("[naver filter]", {
    query,
    mode,
    threshold,
    productCode: code,
    modelName: modelName || null,
    brandHint: brandHint || null,
    before,
    compatibleCut,
    after: passed.length,
    usedRelaxedMatch,
    relaxedBrandCut,
    relaxedBrandKept,
    topScore,
  });

  return {
    items: passed.map((s) => s.i),
    usedRelaxedMatch,
  };
}

async function runNaver(
  primaryQuery: string,
  brand: string,
  modelName: string,
  productType: string,
  barcode: string
): Promise<NaverResult> {
  const clientId = process.env.NAVER_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    console.error("[search] 네이버 API 키 미설정");
    return {
      ok: false,
      items: [],
      usedBarcode: false,
      usedRelaxedMatch: false,
      usedCodePermutation: null,
      searchStrategy: null,
    };
  }

  try {
    const code = extractProductCode(primaryQuery);
    const steps = buildSearchSteps({ brand, modelName, productType, code });

    let items: NormalizedItem[] = [];
    let usedRelaxedMatch = false;
    let usedCodePermutation: CodePermutationInfo | null = null;
    let matchedStep: SearchStepNumber | null = null;
    let matchedQuery = "";
    let attempted = 0;

    for (const step of steps) {
      attempted++;
      const raw = await fetchNaverShop(step.query, clientId, clientSecret);
      const filtered = filterNaverByRelevance(
        raw,
        step.query,
        brand,
        step.filterModelName
      );
      const matched = filtered.items.length > 0;
      console.log("[search step] (naver)", {
        step: step.step,
        query: step.query,
        before: raw.length,
        after: filtered.items.length,
        matched,
      });
      if (matched) {
        items = filtered.items;
        usedRelaxedMatch = filtered.usedRelaxedMatch;
        matchedStep = step.step;
        matchedQuery = step.query;
        if (step.step === 3 && step.variant && code) {
          usedCodePermutation = {
            used: true,
            originalCode: code,
            matchedCode: step.variant,
          };
        }
        console.log("[search] success (naver)", {
          step: step.step,
          query: step.query,
        });
        break;
      }
    }

    // Step 6: barcode (관련도 필터 우회)
    let usedBarcode = false;
    if (items.length === 0 && barcode) {
      attempted++;
      console.log("[search] 네이버 barcode 폴백 시도:", barcode);
      const byBarcode = await fetchNaverShop(
        barcode,
        clientId,
        clientSecret
      );
      if (byBarcode.length > 0) {
        items = byBarcode;
        usedBarcode = true;
        usedRelaxedMatch = false;
        usedCodePermutation = null;
        matchedStep = 6;
        matchedQuery = barcode;
      }
    }

    const searchStrategy: SearchStrategy | null = matchedStep
      ? { step: matchedStep, query: matchedQuery, attempted }
      : null;

    return {
      ok: true,
      items,
      usedBarcode,
      usedRelaxedMatch,
      usedCodePermutation,
      searchStrategy,
    };
  } catch (e) {
    console.error("[search] 네이버 호출 실패:", e);
    return {
      ok: false,
      items: [],
      usedBarcode: false,
      usedRelaxedMatch: false,
      usedCodePermutation: null,
      searchStrategy: null,
    };
  }
}

async function runCoupang(
  primaryQuery: string,
  brand: string,
  modelName: string,
  productType: string,
  barcode: string
): Promise<CoupangResult> {
  try {
    const code = extractProductCode(primaryQuery);
    const steps = buildSearchSteps({ brand, modelName, productType, code });

    let products: CoupangProduct[] = [];
    let usedRelaxedMatch = false;
    let usedCodePermutation: CodePermutationInfo | null = null;
    let matchedStep: SearchStepNumber | null = null;
    let matchedQuery = "";
    let attempted = 0;

    for (const step of steps) {
      attempted++;
      const raw = (
        await coupangSearchProducts(step.query, COUPANG_LIMIT)
      ).filter((p) => p.productPrice > 0);
      const filtered = filterCoupangByRelevance(
        raw,
        step.query,
        brand,
        step.filterModelName
      );
      const matched = filtered.products.length > 0;
      console.log("[search step] (coupang)", {
        step: step.step,
        query: step.query,
        before: raw.length,
        after: filtered.products.length,
        matched,
      });
      if (matched) {
        products = filtered.products;
        usedRelaxedMatch = filtered.usedRelaxedMatch;
        matchedStep = step.step;
        matchedQuery = step.query;
        if (step.step === 3 && step.variant && code) {
          usedCodePermutation = {
            used: true,
            originalCode: code,
            matchedCode: step.variant,
          };
        }
        console.log("[search] success (coupang)", {
          step: step.step,
          query: step.query,
        });
        break;
      }
    }

    // Step 6: barcode (관련도 필터 우회)
    let usedBarcode = false;
    if (products.length === 0 && barcode) {
      attempted++;
      console.log("[search] 쿠팡 barcode 폴백 시도:", barcode);
      const byBarcode = (
        await coupangSearchProducts(barcode, COUPANG_LIMIT)
      ).filter((p) => p.productPrice > 0);
      if (byBarcode.length > 0) {
        products = byBarcode;
        usedBarcode = true;
        usedRelaxedMatch = false;
        usedCodePermutation = null;
        matchedStep = 6;
        matchedQuery = barcode;
      }
    }

    const searchStrategy: SearchStrategy | null = matchedStep
      ? { step: matchedStep, query: matchedQuery, attempted }
      : null;

    if (products.length === 0) {
      return {
        ok: true,
        products: [],
        cheapest: null,
        deepLink: null,
        usedBarcode: false,
        usedRelaxedMatch: false,
        usedCodePermutation: null,
        searchStrategy: null,
      };
    }

    const cheapest = products.reduce((min, p) =>
      p.productPrice < min.productPrice ? p : min
    );

    return {
      ok: true,
      products,
      cheapest,
      deepLink: cheapest.productUrl,
      usedBarcode,
      usedRelaxedMatch,
      usedCodePermutation,
      searchStrategy,
    };
  } catch (e) {
    console.error("[search] 쿠팡 호출 실패:", e);
    return {
      ok: false,
      products: [],
      cheapest: null,
      deepLink: null,
      usedBarcode: false,
      usedRelaxedMatch: false,
      usedCodePermutation: null,
      searchStrategy: null,
      error: getErrorMessage(e),
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("query")?.trim();
    if (!query) {
      return NextResponse.json(
        { error: "query 파라미터가 필요합니다" },
        { status: 400 }
      );
    }

    const brand = request.nextUrl.searchParams.get("brand")?.trim() ?? "";
    const modelName =
      request.nextUrl.searchParams.get("modelName")?.trim() ?? "";
    const productType =
      request.nextUrl.searchParams.get("productType")?.trim() ?? "";
    const barcodeRaw =
      request.nextUrl.searchParams.get("barcode")?.trim() ?? "";
    const barcode =
      barcodeRaw.length === 12 || barcodeRaw.length === 13 ? barcodeRaw : "";

    const primaryQuery = buildSearchQuery(
      query,
      brand || undefined,
      productType || undefined,
      modelName || undefined
    );

    if (!primaryQuery) {
      return NextResponse.json(
        { error: "검색어가 비어 있습니다" },
        { status: 400 }
      );
    }

    const settled = await Promise.allSettled([
      runNaver(primaryQuery, brand, modelName, productType, barcode),
      runCoupang(primaryQuery, brand, modelName, productType, barcode),
    ]);

    const naverResult: NaverResult =
      settled[0].status === "fulfilled"
        ? settled[0].value
        : {
            ok: false,
            items: [],
            usedBarcode: false,
            usedRelaxedMatch: false,
            usedCodePermutation: null,
            searchStrategy: null,
          };

    const coupangResult: CoupangResult =
      settled[1].status === "fulfilled"
        ? settled[1].value
        : {
            ok: false,
            products: [],
            cheapest: null,
            deepLink: null,
            usedBarcode: false,
            usedRelaxedMatch: false,
            usedCodePermutation: null,
            searchStrategy: null,
            error: getErrorMessage(settled[1].reason),
          };

    const codePermutation =
      naverResult.usedCodePermutation || coupangResult.usedCodePermutation;
    const searchStrategy =
      naverResult.searchStrategy || coupangResult.searchStrategy;

    return NextResponse.json({
      items: naverResult.items,
      naver: { items: naverResult.items },
      coupang: {
        products: coupangResult.products,
        cheapest: coupangResult.cheapest,
        deepLink: coupangResult.deepLink,
      },
      meta: {
        naverOk: naverResult.ok,
        coupangOk: coupangResult.ok,
        usedBarcodeFallback:
          naverResult.usedBarcode || coupangResult.usedBarcode,
        usedRelaxedMatch:
          naverResult.usedRelaxedMatch || coupangResult.usedRelaxedMatch,
        ...(codePermutation ? { usedCodePermutation: codePermutation } : {}),
        ...(searchStrategy ? { searchStrategy } : {}),
        ...(coupangResult.error
          ? { coupangError: coupangResult.error }
          : {}),
      },
    });
  } catch (e) {
    console.error("search route:", e);
    return NextResponse.json(
      { error: "일시적 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}
