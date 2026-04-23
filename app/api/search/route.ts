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

    const params = new URLSearchParams({
      query,
      display: "10",
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
      return NextResponse.json(
        { error: "네이버 API 호출에 실패했습니다" },
        { status: 500 }
      );
    }

    const data = (await upstream.json()) as NaverShopResponse;
    const rawItems = Array.isArray(data.items) ? data.items : [];

    const items = rawItems.map((item) => ({
      title: stripBoldTags(String(item.title ?? "")),
      lprice: Number(item.lprice ?? 0),
      mallName: String(item.mallName ?? ""),
      link: String(item.link ?? ""),
      image: String(item.image ?? ""),
    }));

    return NextResponse.json({ items });
  } catch (e) {
    console.error("search route:", e);
    return NextResponse.json(
      { error: "일시적 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}
