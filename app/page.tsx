"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ExtractResult {
  productCode: string;
  brand: string;
  productType: string;
  price: number | null;
}

type SearchItem = {
  title: string;
  lprice: number;
  mallName: string;
  link: string;
  image: string;
};

const SIMILAR_THRESHOLD = 10_000;

type PriceCase = "online_cheaper" | "similar" | "store_cheaper";

function formatWon(n: number) {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

function parseItemLprice(n: number): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.trunc(n));
  }
  return 0;
}

function getPriceCase(
  storePrice: number,
  onlinePrice: number
): { priceCase: PriceCase; absDiff: number; diff: number } {
  const diff = storePrice - onlinePrice;
  const absDiff = Math.abs(diff);
  if (absDiff <= SIMILAR_THRESHOLD) {
    return { priceCase: "similar", absDiff, diff };
  }
  if (diff > 0) {
    return { priceCase: "online_cheaper", absDiff, diff };
  }
  return { priceCase: "store_cheaper", absDiff, diff };
}

function formatRecognitionLine(r: ExtractResult): string {
  const s = [r.brand, r.productType, r.productCode].filter(Boolean).join(" ");
  return s.trim() || "—";
}

function buildNaverShoppingSearchUrl(r: ExtractResult): string {
  const q = [r.brand, r.productCode]
    .filter((s) => s.trim().length > 0)
    .map((s) => s.trim())
    .join(" ");
  return `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(
    q || r.productCode
  )}`;
}

/** 네이버/스마트스토어 카드는 별도 안내로 이중 표시를 피함 */
function shouldShowMallCardCouponHint(mallName: string, link: string): boolean {
  const name = mallName.trim().toLowerCase();
  if (name === "네이버" || name.includes("스마트스토어")) {
    return false;
  }
  const u = link.toLowerCase();
  if (
    u.includes("smartstore.naver.com") ||
    u.includes("brand.naver.com")
  ) {
    return false;
  }
  return true;
}

function buildShareText(options: {
  extract: ExtractResult;
  storePriceNum: number | null;
  lowestPrice: number | null;
  origin: string;
}): string {
  const { extract, storePriceNum, lowestPrice, origin } = options;
  const lines: string[] = [
    "━━━━━━━━━━━━━━━━",
    "🔍 PriceTag로 확인한 가격 비교",
    "",
    `📌 ${formatRecognitionLine(extract)}`,
  ];

  const hasStorePrice =
    storePriceNum != null && Number.isFinite(storePriceNum) && storePriceNum > 0;

  if (hasStorePrice) {
    lines.push(`🏬 매장가: ${formatWon(storePriceNum)}원`);
  }

  if (lowestPrice != null) {
    lines.push(`✨ 온라인 최저: ${formatWon(lowestPrice)}원`);
  }

  if (hasStorePrice && lowestPrice != null) {
    const { priceCase, absDiff } = getPriceCase(storePriceNum, lowestPrice);
    lines.push("");
    if (priceCase === "online_cheaper") {
      lines.push(`🎉 최소 ${formatWon(absDiff)}원 아낄 수 있어요!`);
    } else if (priceCase === "similar") {
      lines.push(
        `😐 매장과 온라인 가격이 비슷해요 (차이 ${formatWon(absDiff)}원)`
      );
    } else {
      lines.push(`💪 매장이 ${formatWon(absDiff)}원 더 싸요!`);
    }
  }

  lines.push("");
  lines.push("📱 당신도 확인해보세요:");
  lines.push(origin);
  lines.push("━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

export default function Home() {
  const [imageBase64, setImageBase64] = useState<string>("");
  const [mimeType, setMimeType] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<"extract" | "search" | null>(
    null
  );
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(
    null
  );
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [storePrice, setStorePrice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(false);
  const toastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { sortedSearchResults, lowestPrice } = useMemo(() => {
    const withPrices = searchResults.map((item) => ({
      ...item,
      lprice: parseItemLprice(item.lprice),
    }));
    const pricesBefore = withPrices.map((i) => i.lprice);
    const sorted = [...withPrices].sort((a, b) => {
      const ap = a.lprice > 0 ? a.lprice : Number.POSITIVE_INFINITY;
      const bp = b.lprice > 0 ? b.lprice : Number.POSITIVE_INFINITY;
      return ap - bp;
    });
    const positive = sorted
      .map((i) => i.lprice)
      .filter((n) => Number.isFinite(n) && n > 0);
    const min: number | null =
      positive.length > 0 ? Math.min(...positive) : null;

    if (process.env.NODE_ENV === "development" && searchResults.length > 0) {
      console.log(
        "[pricetag/page] API에서 받은 items 개수:",
        searchResults.length
      );
      console.log(
        "[pricetag/page] 각 item lprice (정렬 전, 클라이언트 파싱):",
        pricesBefore
      );
      console.log("[pricetag/page] 최저가 계산 결과 (min):", min);
      console.log("[pricetag/page] 화면에 표시할 온라인 최저가:", min);
    }

    return { sortedSearchResults: sorted, lowestPrice: min };
  }, [searchResults]);

  const storePriceNum = storePrice.replace(/[^0-9]/g, "")
    ? Number(storePrice.replace(/[^0-9]/g, ""))
    : null;

  const hasStorePriceForCompare =
    storePriceNum != null &&
    Number.isFinite(storePriceNum) &&
    storePriceNum > 0;

  const priceCompare =
    hasStorePriceForCompare && lowestPrice != null
      ? getPriceCase(storePriceNum, lowestPrice)
      : null;

  const showToast = useCallback((message: string) => {
    if (toastHideTimerRef.current) {
      clearTimeout(toastHideTimerRef.current);
    }
    if (toastClearTimerRef.current) {
      clearTimeout(toastClearTimerRef.current);
    }
    setToastMessage(message);
    setToastVisible(true);
    toastHideTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastClearTimerRef.current = setTimeout(() => {
        setToastMessage(null);
      }, 400);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastHideTimerRef.current) {
        clearTimeout(toastHideTimerRef.current);
      }
      if (toastClearTimerRef.current) {
        clearTimeout(toastClearTimerRef.current);
      }
    };
  }, []);

  const fallbackCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showToast("✅ 공유 내용이 복사됐어요! 원하는 곳에 붙여넣으세요");
      } catch {
        showToast("❌ 복사 실패. 직접 복사해주세요");
      }
    },
    [showToast]
  );

  const handleShare = useCallback(async () => {
    if (!extractResult || lowestPrice == null) {
      return;
    }
    const shareText = buildShareText({
      extract: extractResult,
      storePriceNum,
      lowestPrice,
      origin: typeof window !== "undefined" ? window.location.origin : "",
    });

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "PriceTag - 가격 비교 결과",
          text: shareText,
          url: window.location.href,
        });
      } catch (err: unknown) {
        const aborted =
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");
        if (!aborted) {
          await fallbackCopy(shareText);
        }
      }
    } else {
      await fallbackCopy(shareText);
    }
  }, [extractResult, storePriceNum, lowestPrice, fallbackCopy]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    setError("");
    setExtractResult(null);
    setSearchResults([]);
    setStorePrice("");
    setTipDismissed(false);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (typeof result !== "string" || !result.includes(",")) {
        return;
      }
      const [, b64] = result.split(",", 2);
      setImageBase64(b64);
      setMimeType(file.type || "image/jpeg");
      setPreviewUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const runAnalyze = useCallback(async () => {
    if (!imageBase64 || !mimeType) {
      setError("먼저 사진을 선택해 주세요.");
      return;
    }

    setError("");
    setExtractResult(null);
    setSearchResults([]);
    setStorePrice("");
    setTipDismissed(false);
    setLoading(true);
    setLoadingStep("extract");

    try {
      const extractRes = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType }),
      });

      if (!extractRes.ok) {
        setError("일시적 오류, 다시 시도");
        return;
      }

      const extractJson = (await extractRes.json()) as ExtractResult & {
        error?: string;
      };

      if ("error" in extractJson && extractJson.error) {
        setError("일시적 오류, 다시 시도");
        return;
      }

      const productCode =
        typeof extractJson.productCode === "string"
          ? extractJson.productCode.trim()
          : "";
      const brand =
        typeof extractJson.brand === "string" ? extractJson.brand.trim() : "";
      const productType =
        typeof extractJson.productType === "string"
          ? extractJson.productType.trim()
          : "";
      const priceFromTag =
        typeof extractJson.price === "number" && Number.isFinite(extractJson.price)
          ? extractJson.price
          : null;

      setExtractResult({
        productCode,
        brand,
        productType,
        price: priceFromTag,
      });

      if (!productCode) {
        setError("태그가 잘 보이게 다시 찍어주세요");
        return;
      }

      if (priceFromTag !== null) {
        setStorePrice(formatWon(Math.max(0, Math.round(priceFromTag))));
      }

      setLoadingStep("search");
      const searchParams = new URLSearchParams();
      searchParams.set("query", productCode);
      if (brand) {
        searchParams.set("brand", brand);
      }
      if (productType) {
        searchParams.set("productType", productType);
      }
      const searchRes = await fetch(`/api/search?${searchParams.toString()}`);

      if (!searchRes.ok) {
        setError("일시적 오류, 다시 시도");
        return;
      }

      const searchJson = (await searchRes.json()) as {
        items?: SearchItem[];
        error?: string;
      };

      if ("error" in searchJson && searchJson.error) {
        setError("일시적 오류, 다시 시도");
        return;
      }

      const items = Array.isArray(searchJson.items) ? searchJson.items : [];
      if (items.length === 0) {
        setError("온라인에서 찾을 수 없는 상품");
        return;
      }

      setSearchResults(items);
    } catch {
      setError("일시적 오류, 다시 시도");
    } finally {
      setLoading(false);
      setLoadingStep(null);
    }
  }, [imageBase64, mimeType]);

  const hasSearchSuccess =
    extractResult != null && !error && searchResults.length > 0;
  const showFixedShoppingTip = hasSearchSuccess && !tipDismissed;

  const mainPadClass = !hasSearchSuccess
    ? "py-8"
    : tipDismissed
      ? "pt-6 pb-8"
      : "pt-28 pb-8";

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      {showFixedShoppingTip ? (
        <div className="fixed left-0 right-0 top-0 z-40 flex justify-center px-4 pt-3">
          <div
            className="flex w-full max-w-[500px] origin-top transform items-start justify-between gap-2 rounded-b-2xl bg-[#FFF3CD] p-3 px-4 shadow-lg transition-all duration-300 ease-out"
            role="region"
            aria-label="쇼핑 가격 안내"
          >
            <div className="min-w-0 flex-1 pr-1">
              <p className="text-base font-bold text-zinc-900">
                💰 들어가보면 더 싸질 수 있어요!
              </p>
              <p className="mt-1 text-sm leading-snug text-gray-700">
                쿠폰·회원할인·카드혜택이 숨어있어요. 링크 들어가서 꼭
                확인해보세요&nbsp;👀
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTipDismissed(true)}
              className="min-h-0 min-w-[2.5rem] shrink-0 rounded-lg p-2 text-2xl leading-none text-[#666] transition hover:bg-black/5 hover:opacity-80"
              aria-label="쇼핑 팁 닫기"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      <main
        className={`mx-auto flex w-full max-w-md flex-col gap-6 px-4 ${mainPadClass} transition-all duration-300 ease-out`}
      >
        <h1 className="text-center text-2xl font-bold sm:text-3xl">
          사기 전에, 3초만
        </h1>

        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 px-4 py-12 transition hover:border-zinc-400">
          <span className="text-lg font-medium text-zinc-600">사진 선택</span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileChange}
          />
        </label>

        {previewUrl ? (
          <img
            src={previewUrl}
            alt="선택한 상품 이미지 미리보기"
            className="mx-auto max-h-64 w-auto rounded-lg border object-contain"
          />
        ) : null}

        <button
          type="button"
          onClick={runAnalyze}
          disabled={loading || !imageBase64}
          className="h-14 w-full rounded-xl bg-zinc-900 text-lg font-semibold text-white transition enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          분석하기
        </button>

        {loading ? (
          <p className="text-center text-lg text-zinc-600">
            {loadingStep === "extract"
              ? "품번 인식 중..."
              : loadingStep === "search"
                ? "가격 검색 중..."
                : "처리 중..."}
          </p>
        ) : null}

        {error ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-red-800"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {extractResult && !error && searchResults.length > 0 ? (
          <section className="flex flex-col gap-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-lg font-semibold leading-snug">
                인식 결과: {formatRecognitionLine(extractResult)}
              </p>
              {extractResult.price !== null ? (
                <p className="mt-2 text-xs text-gray-500">
                  💡 태그에서 가격을 자동으로 읽었어요. 다르면 수정하세요
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-sm text-zinc-500">온라인 최저 표시가</p>
              <p className="text-4xl font-bold text-orange-600">
                {lowestPrice != null ? `${formatWon(lowestPrice)}원` : "—"}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                * 표시된 가격은 기본 판매가예요. 쇼핑몰 들어가면 더 저렴할 수
                있어요
              </p>
            </div>

            <div>
              <label
                htmlFor="store-price"
                className="mb-1 block text-sm font-medium text-zinc-600"
              >
                매장 가격 (원)
              </label>
              <input
                id="store-price"
                type="text"
                inputMode="numeric"
                placeholder="숫자만 입력"
                value={storePrice}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, "");
                  setStorePrice(raw ? formatWon(Number(raw)) : "");
                }}
                className="h-14 w-full rounded-xl border border-zinc-300 px-4 text-lg outline-none focus:border-zinc-900"
              />
            </div>

            {priceCompare ? (
              priceCompare.priceCase === "online_cheaper" ? (
                <div
                  className="rounded-2xl px-5 py-5 text-center"
                  style={{ backgroundColor: "#D4EDDA" }}
                >
                  <p className="text-lg font-bold text-green-900 sm:text-xl">
                    🎉 최소 {formatWon(priceCompare.absDiff)}원 아낄 수 있어요
                  </p>
                  <p className="mt-2 text-sm text-gray-600">
                    → 아래 쇼핑몰에서 더 싸게 구매하세요
                  </p>
                </div>
              ) : priceCompare.priceCase === "similar" ? (
                <div
                  className="rounded-2xl px-5 py-5 text-center"
                  style={{ backgroundColor: "#FFF3CD" }}
                >
                  <p className="text-lg font-bold text-zinc-900 sm:text-xl">
                    😐 비슷한 가격이에요
                  </p>
                  <p className="mt-2 text-sm text-gray-600">
                    차이 {formatWon(priceCompare.absDiff)}원 / 매장에서 바로
                    구매하셔도 손해 없어요
                  </p>
                </div>
              ) : (
                <div
                  className="rounded-2xl px-5 py-5 text-center"
                  style={{ backgroundColor: "#D1ECF1" }}
                >
                  <p className="text-lg font-bold text-cyan-950 sm:text-xl">
                    💪 매장이 {formatWon(priceCompare.absDiff)}원 더 싸네요!
                  </p>
                  <p className="mt-2 text-sm text-gray-600">
                    → 매장에서 구매하시는 게 이득이에요
                  </p>
                </div>
              )
            ) : null}

            <div>
              <p className="mb-2 text-sm font-medium text-zinc-600">
                가격 비교
              </p>
              <ul className="flex flex-col gap-3">
                {sortedSearchResults.map((item, idx) => (
                  <li key={`${item.link}-${idx}`}>
                    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white transition hover:border-zinc-400">
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full flex-col gap-1 p-4 text-left text-inherit no-underline transition hover:bg-zinc-50"
                      >
                        <span className="text-sm font-medium text-zinc-500">
                          {item.mallName}
                        </span>
                        <span className="line-clamp-2 text-base">
                          {item.title}
                        </span>
                        <span
                          className={
                            item.lprice === lowestPrice
                              ? "text-lg font-bold text-orange-600"
                              : "text-lg font-semibold"
                          }
                        >
                          {formatWon(item.lprice)}원
                          {item.lprice === lowestPrice ? " · 최저" : ""}
                        </span>
                      </a>
                      <div className="border-t border-zinc-100">
                        {shouldShowMallCardCouponHint(
                          item.mallName,
                          item.link
                        ) ? (
                          <p className="mb-2 px-4 pt-3 text-xs text-gray-500">
                            💡 쿠폰·할인 적용 시 더 저렴할 수 있어요
                          </p>
                        ) : null}
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full px-4 py-3 text-left text-sm font-medium text-blue-600 no-underline transition hover:bg-zinc-50"
                        >
                          → 쇼핑몰에서 확인하기
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <a
                href={buildNaverShoppingSearchUrl(extractResult)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex h-[50px] w-full items-center justify-center rounded-xl bg-[#03C75A] text-base font-medium text-white no-underline transition hover:opacity-90"
              >
                🔍 네이버 쇼핑에서 더 보기
              </a>
              <p className="mt-2 text-sm text-zinc-600">
                💡 즉시할인 적용된 실제 결제가는 네이버 쇼핑에서 확인해보세요
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleShare()}
              className="min-h-[60px] w-full rounded-2xl bg-[#FFEB3B] px-4 py-3 text-lg font-bold text-black shadow-sm transition hover:brightness-95 active:brightness-90"
            >
              📤 가족·친구에게 공유하기
            </button>
          </section>
        ) : null}
      </main>

      {toastMessage != null ? (
        <div
          className={`pointer-events-none fixed bottom-6 left-1/2 z-50 max-w-[min(100vw-2rem,28rem)] -translate-x-1/2 rounded-xl bg-black/80 px-4 py-3 text-center text-sm text-white shadow-lg transition-opacity duration-300 ${
            toastVisible ? "opacity-100" : "opacity-0"
          }`}
          role="status"
        >
          {toastMessage}
        </div>
      ) : null}
    </div>
  );
}
