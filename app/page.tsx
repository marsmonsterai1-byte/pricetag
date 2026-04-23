"use client";

import { useCallback, useState } from "react";

export interface ExtractResult {
  productCode: string;
  price: number | null;
}

type SearchItem = {
  title: string;
  lprice: number;
  mallName: string;
  link: string;
  image: string;
};

function formatWon(n: number) {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
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

  const lowestPrice =
    searchResults.length > 0
      ? Math.min(...searchResults.map((i) => i.lprice))
      : null;

  const storePriceNum = storePrice.replace(/[^0-9]/g, "")
    ? Number(storePrice.replace(/[^0-9]/g, ""))
    : null;

  const savings =
    lowestPrice != null &&
    storePriceNum != null &&
    storePriceNum > lowestPrice
      ? storePriceNum - lowestPrice
      : null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    setError("");
    setExtractResult(null);
    setSearchResults([]);
    setStorePrice("");

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
      const priceFromTag =
        typeof extractJson.price === "number" && Number.isFinite(extractJson.price)
          ? extractJson.price
          : null;

      setExtractResult({ productCode, price: priceFromTag });

      if (!productCode) {
        setError("태그가 잘 보이게 다시 찍어주세요");
        return;
      }

      if (priceFromTag !== null) {
        setStorePrice(formatWon(Math.max(0, Math.round(priceFromTag))));
      }

      setLoadingStep("search");
      const searchRes = await fetch(
        `/api/search?query=${encodeURIComponent(productCode)}`
      );

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

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-8">
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
              <p className="text-sm text-zinc-500">인식 결과</p>
              <p className="text-lg font-semibold">
                {extractResult.productCode || "—"}
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
                * 쇼핑몰 쿠폰·회원 혜택 적용 시 더 저렴할 수 있어요
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

            {savings != null && savings > 0 ? (
              <div className="rounded-xl bg-green-100 px-4 py-4 text-center text-xl text-green-900">
                <span className="font-black">최소</span>
                <span className="font-bold">
                  {" "}
                  {formatWon(savings)}원 아낄 수 있어요
                </span>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-medium text-zinc-600">
                가격 비교
              </p>
              <ul className="flex flex-col gap-3">
                {searchResults.map((item, idx) => (
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
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full border-t border-zinc-100 px-4 py-3 text-left text-sm font-medium text-blue-600 no-underline transition hover:bg-zinc-50"
                      >
                        → 쇼핑몰에서 확인하기
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl bg-yellow-50 p-4 text-sm leading-relaxed text-zinc-800">
              <p className="mb-2 font-semibold text-zinc-900">💡 쇼핑 팁</p>
              <p>
                각 쇼핑몰은 회원 쿠폰, 카드 할인, 첫구매 혜택 등으로 표시가보다
                더 저렴할 수 있어요. 링크로 들어가 실제 결제 가격을
                확인해보세요.
              </p>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
