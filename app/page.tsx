"use client";

import confetti from "canvas-confetti";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CoupangProduct } from "@/lib/coupang";

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

type MergedItem = {
  title: string;
  lprice: number;
  mallName: string;
  link: string;
  image: string;
  isCoupang?: boolean;
};

const SIMILAR_THRESHOLD = 10_000;

type PriceCase = "online_cheaper" | "similar" | "store_cheaper";

type SavingsCardType = "similar" | "online_cheaper" | "store_cheaper";

type SavingsCardData = {
  type: SavingsCardType;
  absDiff: number;
  emoji: string;
  label: string;
  mainValue: string;
  mainSuffix: string;
  subMessage: string;
  bottomHint: string;
  bgGradient: string;
  borderColor: string;
  mainColor: string;
  subColor: string;
  borderLineColor: string;
  glowColor: string;
};

function formatWon(n: number) {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

/** 매장가 입력란: 숫자만 저장, 표시는 쉼표(원은 별도 span) */
function formatStorePriceInput(value: string): string {
  if (!value) {
    return "";
  }
  const numbers = value.replace(/[^0-9]/g, "");
  if (!numbers) {
    return "";
  }
  const n = parseInt(numbers, 10);
  if (!Number.isFinite(n)) {
    return "";
  }
  return n.toLocaleString("ko-KR");
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

function buildCoupangSearchUrl(r: ExtractResult): string {
  const q = [r.brand, r.productType, r.productCode]
    .filter((s) => s.trim().length > 0)
    .map((s) => s.trim())
    .join(" ");
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(
    q || r.productCode
  )}`;
}

function formatBrandTypeLine(r: ExtractResult): string {
  return [r.brand, r.productType].filter(Boolean).join(" ").trim() || "—";
}

/** 겹친 문서 + 글래스 느낌 (업로드 영역) */
function UploadDocumentIcon() {
  const uid = useId().replace(/:/g, "");
  const back = `${uid}-back`;
  const glass = `${uid}-glass`;
  const sheen = `${uid}-sheen`;
  const clip = `${uid}-clip`;

  return (
    <svg
      width={64}
      height={64}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      style={{
        filter: "drop-shadow(0 4px 14px rgba(60, 120, 220, 0.28))",
      }}
      aria-hidden
    >
      <defs>
        <linearGradient
          id={back}
          x1="6"
          y1="18"
          x2="6"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#5CB0FF" />
          <stop offset="1" stopColor="#2B7AE8" />
        </linearGradient>
        <linearGradient
          id={glass}
          x1="20"
          y1="6"
          x2="52"
          y2="50"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="rgba(255,255,255,0.52)" />
          <stop offset="0.45" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="1" stopColor="rgba(210,230,255,0.14)" />
        </linearGradient>
        <linearGradient
          id={sheen}
          x1="18"
          y1="6"
          x2="18"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="rgba(255,255,255,0.5)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <clipPath id={clip}>
          <rect x="18" y="6" width="36" height="40" rx="9" />
        </clipPath>
      </defs>
      <rect x="4" y="20" width="36" height="40" rx="9" fill={`url(#${back})`} />
      <rect
        x="18"
        y="6"
        width="36"
        height="40"
        rx="9"
        fill={`url(#${glass})`}
        stroke="rgba(255,255,255,0.72)"
        strokeWidth="1"
      />
      <rect
        x="18"
        y="6"
        width="36"
        height="22"
        fill={`url(#${sheen})`}
        clipPath={`url(#${clip})`}
      />
      <rect x="24" y="16" width="24" height="2.5" rx="1.25" fill="white" />
      <rect x="24" y="22" width="24" height="2.5" rx="1.25" fill="white" />
      <rect x="24" y="28" width="24" height="2.5" rx="1.25" fill="white" />
      <rect x="24" y="34" width="12" height="2.5" rx="1.25" fill="white" />
    </svg>
  );
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
    "🔍 BOGOSA로 확인한 가격 비교",
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
  const [coupangProducts, setCoupangProducts] = useState<CoupangProduct[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [storePrice, setStorePrice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(false);
  const [confettiTick, setConfettiTick] = useState(0);
  const [showCompareCta, setShowCompareCta] = useState(true);
  const toastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confettiFiredForSessionRef = useRef(false);
  const confettiIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { sortedSearchResults, lowestPrice } = useMemo(() => {
    const naverMapped: MergedItem[] = searchResults.map((item) => ({
      ...item,
      lprice: parseItemLprice(item.lprice),
    }));
    const coupangMapped: MergedItem[] = coupangProducts.map((p) => ({
      title: p.productName,
      lprice: parseItemLprice(p.productPrice),
      mallName: p.isRocket ? "쿠팡 로켓배송" : "쿠팡",
      link: p.productUrl,
      image: p.productImage,
      isCoupang: true,
    }));
    const merged: MergedItem[] = [...naverMapped, ...coupangMapped];
    const sorted = [...merged].sort((a, b) => {
      const ap = a.lprice > 0 ? a.lprice : Number.POSITIVE_INFINITY;
      const bp = b.lprice > 0 ? b.lprice : Number.POSITIVE_INFINITY;
      return ap - bp;
    });
    const positive = sorted
      .map((i) => i.lprice)
      .filter((n) => Number.isFinite(n) && n > 0);
    const min: number | null =
      positive.length > 0 ? Math.min(...positive) : null;

    if (
      process.env.NODE_ENV === "development" &&
      (searchResults.length > 0 || coupangProducts.length > 0)
    ) {
      console.log(
        "[pricetag/page] 통합 items 개수:",
        sorted.length,
        "(네이버:",
        naverMapped.length,
        "쿠팡:",
        coupangMapped.length,
        ")"
      );
      console.log("[pricetag/page] 통합 최저가:", min);
    }

    return { sortedSearchResults: sorted, lowestPrice: min };
  }, [searchResults, coupangProducts]);

  const storePriceNum = storePrice.replace(/[^0-9]/g, "")
    ? Number(storePrice.replace(/[^0-9]/g, ""))
    : null;

  const savingsData = useMemo((): SavingsCardData | null => {
    if (!storePrice || lowestPrice == null) {
      return null;
    }
    const storeNum = parseInt(storePrice.replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(storeNum) || storeNum <= 0) {
      return null;
    }
    const diff = storeNum - lowestPrice;
    const absDiff = Math.abs(diff);

    if (absDiff <= SIMILAR_THRESHOLD) {
      return {
        type: "similar",
        absDiff,
        emoji: "🤝",
        label: "가격 차이",
        mainValue: `${absDiff.toLocaleString("ko-KR")}원`,
        mainSuffix: "비슷해요",
        subMessage: "매장에서 바로 구매하셔도 손해 없어요",
        bottomHint: "매장·온라인 모두 OK",
        bgGradient: "#FEF3C7",
        borderColor: "rgba(234, 179, 8, 0.25)",
        mainColor: "#854D0E",
        subColor: "#A16207",
        borderLineColor: "rgba(234, 179, 8, 0.2)",
        glowColor: "rgba(234, 179, 8, 0.1)",
      };
    }
    if (diff > 0) {
      return {
        type: "online_cheaper",
        absDiff,
        emoji: "🎉",
        label: "절약 가능 금액",
        mainValue: `${absDiff.toLocaleString("ko-KR")}원`,
        mainSuffix: "아낄 수 있어요",
        subMessage: "온라인이 더 저렴해요",
        bottomHint: "아래 쇼핑몰에서 더 싸게 구매하세요 ↓",
        bgGradient: "#DCFCE7",
        borderColor: "rgba(34, 197, 94, 0.25)",
        mainColor: "#15803D",
        subColor: "#16A34A",
        borderLineColor: "rgba(34, 197, 94, 0.2)",
        glowColor: "rgba(34, 197, 94, 0.1)",
      };
    }
    return {
      type: "store_cheaper",
      absDiff,
      emoji: "💪",
      label: "매장이 더 저렴해요",
      mainValue: `${absDiff.toLocaleString("ko-KR")}원`,
      mainSuffix: "더 싸요",
      subMessage: "매장 구매가 이득이에요",
      bottomHint: "매장에서 구매하세요 ↑",
      bgGradient: "#DBEAFE",
      borderColor: "rgba(59, 130, 246, 0.25)",
      mainColor: "#1E40AF",
      subColor: "#2563EB",
      borderLineColor: "rgba(59, 130, 246, 0.2)",
      glowColor: "rgba(59, 130, 246, 0.1)",
    };
  }, [storePrice, lowestPrice]);

  const confettiSavingsKey =
    savingsData?.type === "online_cheaper" && savingsData.absDiff > 0
      ? savingsData.absDiff
      : null;

  const confettiRunKey =
    confettiSavingsKey != null
      ? `${confettiTick}-${confettiSavingsKey}`
      : null;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (confettiRunKey == null) {
      return;
    }
    if (confettiFiredForSessionRef.current) {
      return;
    }
    confettiFiredForSessionRef.current = true;

    const timer = setTimeout(() => {
      const duration = 2000;
      const end = Date.now() + duration;
      const id = setInterval(() => {
        if (Date.now() > end) {
          if (confettiIntervalRef.current) {
            clearInterval(confettiIntervalRef.current);
            confettiIntervalRef.current = null;
          }
          return;
        }
        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.6 },
          colors: ["#22C55E", "#10B981", "#FFD700", "#FF6B6B", "#4A90FF"],
          shapes: ["circle", "square"],
          scalar: 1,
        });
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.6 },
          colors: ["#22C55E", "#10B981", "#FFD700", "#FF6B6B", "#4A90FF"],
          shapes: ["circle", "square"],
          scalar: 1,
        });
      }, 150);
      confettiIntervalRef.current = id;
    }, 300);

    return () => {
      clearTimeout(timer);
      if (confettiIntervalRef.current) {
        clearInterval(confettiIntervalRef.current);
        confettiIntervalRef.current = null;
      }
    };
  }, [confettiRunKey]);

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

  const handleCopyProductCode = useCallback(async () => {
    const code = extractResult?.productCode?.trim() ?? "";
    if (!code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      showToast(`✅ "${code}" 복사됨`);
    } catch {
      showToast("❌ 복사 실패. 직접 선택해 복사해주세요");
    }
  }, [extractResult, showToast]);

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

  const handleResetToHome = useCallback(() => {
    if (toastHideTimerRef.current) {
      clearTimeout(toastHideTimerRef.current);
      toastHideTimerRef.current = null;
    }
    if (toastClearTimerRef.current) {
      clearTimeout(toastClearTimerRef.current);
      toastClearTimerRef.current = null;
    }
    setImageBase64("");
    setMimeType("");
    setPreviewUrl("");
    setLoading(false);
    setLoadingStep(null);
    setExtractResult(null);
    setSearchResults([]);
    setCoupangProducts([]);
    setStorePrice("");
    setError("");
    setToastMessage(null);
    setToastVisible(false);
    setTipDismissed(false);
    confettiFiredForSessionRef.current = false;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setShowCompareCta(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

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
          title: "BOGOSA - 가격 비교 결과",
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
    setCoupangProducts([]);
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
      setShowCompareCta(true);
    };
    reader.readAsDataURL(file);
  };

  const runAnalyze = useCallback(async () => {
    if (!imageBase64 || !mimeType) {
      setError("먼저 사진을 선택해 주세요.");
      return;
    }

    setShowCompareCta(false);
    let analysisSucceededWithItems = false;
    setError("");
    setExtractResult(null);
    setSearchResults([]);
    setCoupangProducts([]);
    setStorePrice("");
    setTipDismissed(false);
    confettiFiredForSessionRef.current = false;
    setConfettiTick((t) => t + 1);
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
        setStorePrice(String(Math.max(0, Math.round(priceFromTag))));
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
        coupang?: {
          products: CoupangProduct[];
          cheapest: CoupangProduct | null;
          deepLink: string | null;
        };
        meta?: {
          naverOk: boolean;
          coupangOk: boolean;
          coupangError?: string;
        };
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
      if (
        searchJson.meta?.coupangOk &&
        Array.isArray(searchJson.coupang?.products)
      ) {
        setCoupangProducts(searchJson.coupang.products);
      } else {
        setCoupangProducts([]);
      }
      analysisSucceededWithItems = true;
    } catch {
      setError("일시적 오류, 다시 시도");
    } finally {
      setLoading(false);
      setLoadingStep(null);
      if (!analysisSucceededWithItems) {
        setShowCompareCta(true);
      }
    }
  }, [imageBase64, mimeType]);

  const runManualSearch = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query || loading) {
        return;
      }

      if (process.env.NODE_ENV === "development") {
        console.log("[search] manual query:", query);
      }

      setError("");
      setExtractResult(null);
      setSearchResults([]);
      setCoupangProducts([]);
      setStorePrice("");
      setTipDismissed(false);
      setImageBase64("");
      setMimeType("");
      setPreviewUrl("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      confettiFiredForSessionRef.current = false;
      setConfettiTick((t) => t + 1);
      setLoading(true);
      setLoadingStep("search");

      try {
        const searchParams = new URLSearchParams();
        searchParams.set("query", query);
        const searchRes = await fetch(
          `/api/search?${searchParams.toString()}`
        );

        if (!searchRes.ok) {
          setError("일시적 오류, 다시 시도");
          return;
        }

        const searchJson = (await searchRes.json()) as {
          items?: SearchItem[];
          error?: string;
          coupang?: {
            products: CoupangProduct[];
            cheapest: CoupangProduct | null;
            deepLink: string | null;
          };
          meta?: {
            naverOk: boolean;
            coupangOk: boolean;
            coupangError?: string;
          };
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
        if (
          searchJson.meta?.coupangOk &&
          Array.isArray(searchJson.coupang?.products)
        ) {
          setCoupangProducts(searchJson.coupang.products);
        } else {
          setCoupangProducts([]);
        }
      } catch {
        setError("일시적 오류, 다시 시도");
      } finally {
        setLoading(false);
        setLoadingStep(null);
      }
    },
    [loading]
  );

  const hasSearchSuccess = !error && searchResults.length > 0;
  const showFixedShoppingTip = hasSearchSuccess && !tipDismissed;

  const mainPadClass = !hasSearchSuccess
    ? "pt-[60px] pb-8"
    : tipDismissed
      ? "pt-[60px] pb-8"
      : "pt-40 pb-8";

  return (
    <div
      className="relative z-[1] flex min-h-screen flex-col"
      style={{ color: "var(--text-primary)" }}
    >
      {showFixedShoppingTip ? (
        <div className="fixed left-0 right-0 top-0 z-40 flex justify-center px-4 pt-2">
          <div
            className="flex w-full max-w-[500px] origin-top transform items-start justify-between gap-3 border border-[var(--tip-border)] px-5 py-4 transition-all duration-300 ease-in-out [background:var(--tip-bg)] [backdrop-filter:blur(20px)] [-webkit-backdrop-filter:blur(20px)] [box-shadow:0_4px_20px_rgba(255,213,0,0.15)] rounded-b-3xl"
            role="region"
            aria-label="쇼핑 가격 안내"
          >
            <div className="min-w-0 flex-1 pr-1">
              <p
                className="text-base font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                💰 들어가보면 더 싸질 수 있어요!
              </p>
              <p
                className="mt-1 text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                쿠폰·회원할인·카드혜택이 숨어있어요. 링크 들어가서 꼭
                확인해보세요&nbsp;👀
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTipDismissed(true)}
              className="min-h-0 min-w-[2.5rem] shrink-0 rounded-xl p-2 text-2xl leading-none transition hover:bg-white/20"
              style={{ color: "var(--text-secondary)" }}
              aria-label="쇼핑 팁 닫기"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      <main
        className={`mx-auto flex w-full max-w-[500px] flex-1 flex-col items-center gap-6 px-6 sm:px-6 ${mainPadClass} transition-all duration-200 ease-out`}
      >
        <button
          type="button"
          onClick={handleResetToHome}
          className="logo-button flex w-full flex-col items-center"
          style={{ marginBottom: "48px", gap: "6px" }}
          aria-label="홈으로 이동"
        >
          <h1
            className="leading-none"
            style={{
              fontSize: "48px",
              fontWeight: 900,
              letterSpacing: "-0.04em",
              color: "var(--text-primary)",
              marginBottom: "4px",
            }}
          >
            BOGOSA
          </h1>
          <p
            style={{
              fontSize: "15px",
              color: "#4493FF",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            보고, 사자!
          </p>
          <p
            style={{
              fontSize: "13px",
              color: "var(--text-tertiary)",
              letterSpacing: "-0.015em",
              lineHeight: 1,
            }}
          >
            사기 전에, 3초만
          </p>
        </button>

        <input
          id="tag-photo-input"
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleFileChange}
        />
        {!previewUrl ? (
          <div className="upload-box-ambient w-full">
            <label htmlFor="tag-photo-input" className="upload-box w-full">
              <UploadDocumentIcon />
              <div
                className="flex w-full flex-col items-center"
                style={{ gap: "6px" }}
              >
                <p
                  className="m-0 text-center"
                  style={{
                    fontSize: "19px",
                    fontWeight: 700,
                    color: "#1A1D29",
                    letterSpacing: "-0.025em",
                    lineHeight: 1.4,
                  }}
                >
                  태그 사진 올려주세요
                </p>
                <p
                  className="m-0 text-center"
                  style={{
                    fontSize: "14px",
                    color: "#7A8595",
                    letterSpacing: "-0.015em",
                    lineHeight: 1.5,
                  }}
                >
                  가격·품번이 잘 보이게 찍어주세요
                </p>
              </div>
            </label>
          </div>
        ) : null}

        {previewUrl ? (
          <div className="upload-box-ambient w-full">
            <div className="upload-preview-card w-full">
              <img
                src={previewUrl}
                alt="선택한 상품 이미지 미리보기"
                className="block max-h-64 w-full rounded-[20px] object-contain"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 w-full"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#4A90FF",
                  fontSize: "15px",
                  fontWeight: 500,
                  padding: "12px",
                  cursor: "pointer",
                }}
              >
                사진 다시 선택
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex w-full flex-col gap-2">
          <p
            className="text-center text-xs"
            style={{
              color: "var(--text-tertiary)",
              letterSpacing: "-0.015em",
            }}
          >
            또는 상품명으로 검색
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runManualSearch(searchQuery);
            }}
            className="manual-search-bar w-full"
          >
            <svg
              width={22}
              height={22}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx={11} cy={11} r={7} />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              aria-label="상품명 또는 코드로 검색"
              placeholder="상품명 또는 코드"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={loading}
            />
          </form>
        </div>

        {showCompareCta ? (
          <button
            type="button"
            onClick={() => {
              if (loading) {
                return;
              }
              if (imageBase64) {
                void runAnalyze();
              } else if (searchQuery.trim()) {
                void runManualSearch(searchQuery);
              }
            }}
            disabled={
              loading || (!imageBase64 && !searchQuery.trim())
            }
            className="analyze-button"
            style={{
              background:
                loading || (!imageBase64 && !searchQuery.trim())
                  ? "#D5DBE3"
                  : "#4493FF",
              borderRadius: "32px",
              height: "64px",
              width: "100%",
              border: "none",
              boxShadow: "none",
              color: "white",
              fontSize: "18px",
              fontWeight: 700,
              cursor:
                loading || (!imageBase64 && !searchQuery.trim())
                  ? "not-allowed"
                  : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            지금 비교하기
          </button>
        ) : null}

        {loading ? (
          <div
            className="flex items-center justify-center gap-3 px-4 py-4 text-base font-medium"
            style={{ color: "var(--text-secondary)" }}
            role="status"
            aria-live="polite"
          >
            <span
              className="loading-spinner"
              aria-hidden
            />
            <span>
              {loadingStep === "extract"
                ? "품번 인식 중..."
                : loadingStep === "search"
                  ? "가격 검색 중..."
                  : "처리 중..."}
            </span>
          </div>
        ) : null}

        {error ? (
          <div
            className="rounded-2xl border p-4 text-center text-sm leading-relaxed [backdrop-filter:blur(10px)] [-webkit-backdrop-filter:blur(10px)]"
            style={{
              background: "var(--error-bg)",
              borderColor: "rgba(239, 68, 68, 0.2)",
              color: "var(--error-text)",
            }}
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {!error && searchResults.length > 0 ? (
          <section className="flex flex-col gap-4 sm:gap-6">
            {extractResult ? (
              <div className="glass-card !p-6">
                <p
                  className="text-sm"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  인식 결과
                </p>
                <p
                  className="mt-1 text-xl font-medium leading-snug"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatBrandTypeLine(extractResult)}
                </p>
                {(() => {
                  const productCode = extractResult.productCode?.trim() ?? "";
                  return (
                    <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
                      <h2
                        className={
                          productCode
                            ? "min-w-0 flex-1 cursor-pointer text-[28px] font-bold leading-tight"
                            : "min-w-0 flex-1 text-[28px] font-bold leading-tight"
                        }
                        onClick={
                          productCode ? handleCopyProductCode : undefined
                        }
                        onKeyDown={
                          productCode
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  void handleCopyProductCode();
                                }
                              }
                            : undefined
                        }
                        tabIndex={productCode ? 0 : undefined}
                        aria-label={
                          productCode
                            ? `품번 ${productCode}, 클릭하여 복사`
                            : undefined
                        }
                        style={{
                          color: "var(--text-primary)",
                          wordBreak: "break-all",
                        }}
                      >
                        {productCode || "—"}
                      </h2>
                      {productCode ? (
                        <button
                          type="button"
                          onClick={handleCopyProductCode}
                          className="copy-button"
                          aria-label="품번 복사"
                        >
                          복사
                        </button>
                      ) : null}
                    </div>
                  );
                })()}
                {extractResult.price !== null ? (
                  <p
                    className="mt-4 text-xs"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    💡 태그에서 가격 자동 입력됨 — 다르면 아래에서 수정하세요
                  </p>
                ) : null}
              </div>
            ) : null}

            <div
              className="glass-card !p-6"
              style={{ border: "1px solid rgba(74, 144, 255, 0.2)" }}
            >
              <p
                className="text-sm"
                style={{ color: "var(--text-tertiary)" }}
              >
                온라인 최저 표시가
              </p>
              <p
                className="mt-1 text-4xl font-bold leading-none tracking-[-0.02em] sm:text-[56px]"
                style={{ color: "var(--text-primary)" }}
              >
                {lowestPrice != null ? `${formatWon(lowestPrice)}원` : "—"}
              </p>
              <p
                className="mt-3 text-xs leading-relaxed"
                style={{ color: "var(--text-tertiary)" }}
              >
                쇼핑몰 쿠폰·회원 혜택 적용 시 표시가보다 더 저렴할 수 있어요
              </p>
            </div>

            <div>
              <label
                htmlFor="store-price"
                className="mb-2 block text-sm font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                매장에서 본 가격
              </label>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                }}
              >
                <input
                  id="store-price"
                  type="text"
                  inputMode="numeric"
                  placeholder="숫자만 입력"
                  value={formatStorePriceInput(storePrice)}
                  onChange={(e) => {
                    const numericValue = e.target.value.replace(
                      /[^0-9]/g,
                      ""
                    );
                    setStorePrice(numericValue);
                  }}
                  style={{
                    width: "100%",
                    padding: "20px 60px 20px 24px",
                    fontSize: "24px",
                    fontWeight: 600,
                    background: "rgba(255, 255, 255, 0.8)",
                    border: "1.5px solid rgba(74, 144, 255, 0.15)",
                    borderRadius: "20px",
                    outline: "none",
                    transition: "all 0.2s",
                    color: "var(--text-primary)",
                  }}
                />
                {storePrice ? (
                  <span
                    style={{
                      position: "absolute",
                      right: "24px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      fontSize: "20px",
                      fontWeight: 600,
                      color: "var(--text-secondary, #6B7280)",
                      pointerEvents: "none",
                    }}
                  >
                    원
                  </span>
                ) : null}
              </div>
            </div>

            {savingsData ? (
              <div
                className="savings-card"
                style={{
                  position: "relative",
                  background: savingsData.bgGradient,
                  border: `1.5px solid ${savingsData.borderColor}`,
                  borderRadius: "28px",
                  padding: "32px 28px",
                  textAlign: "center",
                  overflow: "hidden",
                  boxShadow: `
        0 8px 32px ${savingsData.glowColor},
        inset 0 1px 0 rgba(255, 255, 255, 0.8)
      `,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    fontSize: "48px",
                    lineHeight: 1,
                    marginBottom: "16px",
                  }}
                  aria-hidden
                >
                  {savingsData.emoji}
                </div>
                <div
                  style={{
                    position: "relative",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: savingsData.mainColor,
                    letterSpacing: "0.02em",
                    marginBottom: "12px",
                    opacity: 0.85,
                  }}
                >
                  {savingsData.label}
                </div>
                <div
                  style={{
                    position: "relative",
                    fontSize: "44px",
                    fontWeight: 800,
                    color: savingsData.mainColor,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.1,
                    marginBottom: "8px",
                  }}
                >
                  {savingsData.mainValue}
                </div>
                <div
                  style={{
                    position: "relative",
                    fontSize: "18px",
                    fontWeight: 600,
                    color: savingsData.subColor,
                    marginBottom: "4px",
                  }}
                >
                  {savingsData.mainSuffix}
                </div>
                <div
                  style={{
                    position: "relative",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: savingsData.subColor,
                    opacity: 0.8,
                    marginBottom: "20px",
                  }}
                >
                  {savingsData.subMessage}
                </div>
                <div
                  style={{
                    position: "relative",
                    height: "1px",
                    background: savingsData.borderLineColor,
                    margin: "0 -8px 16px -8px",
                  }}
                />
                <div
                  style={{
                    position: "relative",
                    fontSize: "13px",
                    color: savingsData.mainColor,
                    opacity: 0.7,
                    fontWeight: 500,
                  }}
                >
                  {savingsData.bottomHint}
                </div>
              </div>
            ) : null}

            <div>
              <p
                className="mb-4 text-2xl font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                가격 비교
              </p>
              <ul className="flex flex-col gap-4">
                {sortedSearchResults.map((item, idx) => {
                  const linkRel = item.isCoupang
                    ? "noopener noreferrer sponsored"
                    : "noopener noreferrer";
                  return (
                    <li key={`${item.link}-${idx}`}>
                      <div
                        className="glass-card !p-5 transition duration-200 ease-out hover:[box-shadow:var(--glass-shadow-hover)]"
                      >
                        <a
                          href={item.link}
                          target="_blank"
                          rel={linkRel}
                          className="mb-3 flex w-full flex-col gap-1.5 text-left text-inherit no-underline"
                        >
                          <span
                            className="text-sm"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {item.mallName}
                          </span>
                          <span
                            className="line-clamp-2 text-base font-normal"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {item.title}
                          </span>
                          <div className="flex flex-wrap items-center gap-2 pt-2">
                            <span
                              className="text-2xl font-bold"
                              style={{ color: "var(--text-primary)" }}
                            >
                              {formatWon(item.lprice)}원
                            </span>
                          </div>
                        </a>
                        <div>
                          <p
                            className="mb-2 text-xs"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            💡 쿠폰·할인 적용 시 더 저렴할 수 있어요
                          </p>
                          <a
                            href={item.link}
                            target="_blank"
                            rel={linkRel}
                            className="block w-full text-right text-base font-medium no-underline transition hover:opacity-80"
                            style={{ color: "var(--accent-primary)" }}
                          >
                            → 쇼핑몰에서 확인하기
                          </a>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <a
                href={
                  extractResult
                    ? buildNaverShoppingSearchUrl(extractResult)
                    : `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(searchQuery)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#03C75A] text-base font-semibold text-white no-underline shadow-md transition duration-200 hover:opacity-95"
              >
                🔍 네이버 쇼핑에서 더 보기
              </a>
              <p
                className="mt-2 text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                💡 즉시할인 적용된 실제 결제가는 네이버 쇼핑에서 확인해보세요
              </p>

              <div className="glass-card mt-6 !p-6">
                <p
                  className="text-center text-base font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  쿠팡에서도 확인해보세요
                </p>
                <a
                  href={
                    extractResult
                      ? buildCoupangSearchUrl(extractResult)
                      : `https://www.coupang.com/np/search?q=${encodeURIComponent(searchQuery)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-coupang-pill mt-4"
                >
                  🛒 쿠팡에서 찾기
                </a>
                <p
                  className="mt-3 text-center text-xs"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  로켓배송 · 와우 멤버십 혜택
                </p>
              </div>
            </div>

            {extractResult ? (
              <button
                type="button"
                onClick={() => void handleShare()}
                className="btn-share-pill flex items-center justify-center gap-2"
              >
                <span className="text-2xl" aria-hidden>
                  📤
                </span>
                가족·친구에게 공유하기
              </button>
            ) : null}
          </section>
        ) : null}

        <footer
          className="mt-auto w-full pt-8 pb-8 text-center text-xs leading-relaxed"
          style={{ color: "var(--text-tertiary)" }}
        >
          BOGOSA는 쿠팡 파트너스 활동으로 수수료를 지급받을 수 있습니다
        </footer>
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
