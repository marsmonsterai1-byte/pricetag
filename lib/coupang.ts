import crypto from "node:crypto";

const DOMAIN = "https://api-gateway.coupang.com";
const SEARCH_PATH =
  "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search";
const DEEPLINK_PATH =
  "/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink";

export type CoupangProduct = {
  productId: number;
  productName: string;
  productPrice: number;
  productImage: string;
  productUrl: string;
  keyword: string;
  rank: number;
  isRocket: boolean;
  isFreeShipping: boolean;
  categoryName: string;
};

export type CoupangDeepLink = {
  originalUrl: string;
  shortenUrl: string;
  landingUrl: string;
};

function isMockMode(): boolean {
  const v = process.env.COUPANG_USE_MOCK?.trim().toLowerCase();
  return v === "true" || v === "1";
}

function requireKeys(): { accessKey: string; secretKey: string } {
  const accessKey = process.env.COUPANG_ACCESS_KEY?.trim();
  const secretKey = process.env.COUPANG_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) {
    throw new Error(
      "COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 환경변수가 설정되지 않았습니다"
    );
  }
  return { accessKey, secretKey };
}

/** 쿠팡 파트너스 서명 전용 시각 포맷: YYMMDDTHHMMSSZ (UTC). ISO 8601 아님. */
function formatSignatureDatetime(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = pad(now.getUTCFullYear() % 100);
  const mm = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  return `${yy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function buildAuthHeader(
  method: "GET" | "POST",
  path: string,
  query: string,
  accessKey: string,
  secretKey: string
): string {
  const datetime = formatSignatureDatetime();
  const message = datetime + method + path + query;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(message)
    .digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

function mockProducts(keyword: string, limit: number): CoupangProduct[] {
  const count = Math.min(Math.max(1, limit), 2);
  return Array.from({ length: count }, (_, i) => ({
    productId: 1_000_000 + i,
    productName: `[MOCK] ${keyword} 상품 ${i + 1}`,
    productPrice: 19_900 + i * 1_000,
    productImage: "https://static.coupangcdn.com/image/affiliate_open_api/mock.png",
    productUrl: `https://www.coupang.com/vp/products/${1_000_000 + i}`,
    keyword,
    rank: i + 1,
    isRocket: i === 0,
    isFreeShipping: true,
    categoryName: "MOCK",
  }));
}

export async function searchProducts(
  keyword: string,
  limit: number = 10
): Promise<CoupangProduct[]> {
  if (isMockMode()) {
    return mockProducts(keyword, limit);
  }

  const { accessKey, secretKey } = requireKeys();
  const params = new URLSearchParams({
    keyword,
    limit: String(limit),
  });
  const query = params.toString();
  const authHeader = buildAuthHeader(
    "GET",
    SEARCH_PATH,
    query,
    accessKey,
    secretKey
  );

  const res = await fetch(`${DOMAIN}${SEARCH_PATH}?${query}`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Coupang searchProducts 실패: ${res.status} ${res.statusText} - ${body}`
    );
  }

  const data = (await res.json()) as {
    data?: { productData?: CoupangProduct[] };
  };
  return data.data?.productData ?? [];
}

export async function createDeepLink(
  urls: string[]
): Promise<CoupangDeepLink[]> {
  if (isMockMode()) {
    return urls.map((u) => ({
      originalUrl: u,
      shortenUrl: u,
      landingUrl: u,
    }));
  }

  const { accessKey, secretKey } = requireKeys();
  const authHeader = buildAuthHeader(
    "POST",
    DEEPLINK_PATH,
    "",
    accessKey,
    secretKey
  );

  const res = await fetch(`${DOMAIN}${DEEPLINK_PATH}`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ coupangUrls: urls }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Coupang createDeepLink 실패: ${res.status} ${res.statusText} - ${body}`
    );
  }

  const data = (await res.json()) as { data?: CoupangDeepLink[] };
  return data.data ?? [];
}
