import { NextRequest, NextResponse } from "next/server";

const NAVER_SHOP_URL = "https://openapi.naver.com/v1/search/shop.json";

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

export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.NAVER_CLIENT_ID?.trim();
    const clientSecret = process.env.NAVER_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: "네이버 API 키가 설정되지 않았습니다" },
        { status: 500 }
      );
    }

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

    let items: NormalizedItem[];
    try {
      items = await fetchNaverShop(primaryQuery, clientId, clientSecret);
    } catch {
      return NextResponse.json(
        { error: "네이버 API 호출에 실패했습니다" },
        { status: 500 }
      );
    }

    if (items.length === 0 && hasExtraTerms) {
      try {
        items = await fetchNaverShop(query, clientId, clientSecret);
      } catch {
        return NextResponse.json(
          { error: "네이버 API 호출에 실패했습니다" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ items });
  } catch (e) {
    console.error("search route:", e);
    return NextResponse.json(
      { error: "일시적 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}
