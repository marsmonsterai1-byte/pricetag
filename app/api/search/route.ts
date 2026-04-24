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
  productType?: string
): string {
  const parts: string[] = [];
  if (brand?.trim()) {
    parts.push(brand.trim());
  }
  if (productType?.trim()) {
    parts.push(productType.trim());
  }
  if (query?.trim()) {
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

type NaverResult = {
  ok: boolean;
  items: NormalizedItem[];
};

type CoupangResult = {
  ok: boolean;
  products: CoupangProduct[];
  cheapest: CoupangProduct | null;
  deepLink: string | null;
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

const COUPANG_RELEVANCE_THRESHOLD = 30;

const COUPANG_GENERIC_WORDS = new Set([
  "슬랙스",
  "모자",
  "티셔츠",
  "바지",
  "원피스",
  "자켓",
  "코트",
  "신발",
  "운동화",
  "가방",
  "지갑",
  "시계",
]);

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

function scoreCoupangRelevance(
  product: CoupangProduct,
  query: string,
  extractedCode: string | null,
  brandHint: string
): number {
  const name = (product.productName ?? "").toLowerCase();
  let score = 0;

  if (extractedCode && name.includes(extractedCode.toLowerCase())) {
    score += 100;
  }

  if (brandHint && name.includes(brandHint.toLowerCase())) {
    score += 30;
  }

  const seen = new Set<string>();
  for (const raw of query.split(/\s+/)) {
    const t = raw.trim();
    if (t.length < 2 || COUPANG_GENERIC_WORDS.has(t)) {
      continue;
    }
    const tl = t.toLowerCase();
    if (seen.has(tl)) {
      continue;
    }
    seen.add(tl);
    if (name.includes(tl)) {
      score += 10;
    }
  }

  return score;
}

function filterCoupangByRelevance(
  products: CoupangProduct[],
  query: string,
  brand: string
): CoupangProduct[] {
  const code = extractProductCode(query);
  const brandHint = extractBrandHint(brand, query);
  const before = products.length;

  const scored: { p: CoupangProduct; score: number }[] = products.map((p) => ({
    p,
    score: scoreCoupangRelevance(p, query, code, brandHint),
  }));
  const passed = scored.filter(
    (s) => s.score >= COUPANG_RELEVANCE_THRESHOLD
  );
  const topScore = passed.reduce((m, s) => Math.max(m, s.score), 0);

  console.log("[coupang filter]", {
    query,
    extractedCode: code,
    brandHint: brandHint || null,
    before,
    after: passed.length,
    topScore,
  });

  return passed.map((s) => s.p);
}

async function runNaver(
  primaryQuery: string,
  fallbackQuery: string,
  hasExtraTerms: boolean
): Promise<NaverResult> {
  const clientId = process.env.NAVER_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    console.error("[search] 네이버 API 키 미설정");
    return { ok: false, items: [] };
  }

  try {
    let items = await fetchNaverShop(primaryQuery, clientId, clientSecret);
    if (items.length === 0 && hasExtraTerms && primaryQuery !== fallbackQuery) {
      items = await fetchNaverShop(fallbackQuery, clientId, clientSecret);
    }
    return { ok: true, items };
  } catch (e) {
    console.error("[search] 네이버 호출 실패:", e);
    return { ok: false, items: [] };
  }
}

async function runCoupang(
  primaryQuery: string,
  fallbackQuery: string,
  hasExtraTerms: boolean,
  brand: string
): Promise<CoupangResult> {
  try {
    let products = (await coupangSearchProducts(primaryQuery, COUPANG_LIMIT))
      .filter((p) => p.productPrice > 0);
    products = filterCoupangByRelevance(products, primaryQuery, brand);

    if (
      products.length === 0 &&
      hasExtraTerms &&
      primaryQuery !== fallbackQuery
    ) {
      const fallback = (
        await coupangSearchProducts(fallbackQuery, COUPANG_LIMIT)
      ).filter((p) => p.productPrice > 0);
      products = filterCoupangByRelevance(fallback, fallbackQuery, brand);
    }

    if (products.length === 0) {
      return { ok: true, products: [], cheapest: null, deepLink: null };
    }

    const cheapest = products.reduce((min, p) =>
      p.productPrice < min.productPrice ? p : min
    );

    return {
      ok: true,
      products,
      cheapest,
      deepLink: cheapest.productUrl,
    };
  } catch (e) {
    console.error("[search] 쿠팡 호출 실패:", e);
    return {
      ok: false,
      products: [],
      cheapest: null,
      deepLink: null,
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
    const productType =
      request.nextUrl.searchParams.get("productType")?.trim() ?? "";

    const hasExtraTerms = Boolean(brand || productType);
    const primaryQuery = buildSearchQuery(
      query,
      brand || undefined,
      productType || undefined
    );

    if (!primaryQuery) {
      return NextResponse.json(
        { error: "검색어가 비어 있습니다" },
        { status: 400 }
      );
    }

    const settled = await Promise.allSettled([
      runNaver(primaryQuery, query, hasExtraTerms),
      runCoupang(primaryQuery, query, hasExtraTerms, brand),
    ]);

    const naverResult: NaverResult =
      settled[0].status === "fulfilled"
        ? settled[0].value
        : { ok: false, items: [] };

    const coupangResult: CoupangResult =
      settled[1].status === "fulfilled"
        ? settled[1].value
        : {
            ok: false,
            products: [],
            cheapest: null,
            deepLink: null,
            error: getErrorMessage(settled[1].reason),
          };

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
