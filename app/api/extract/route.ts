import { NextRequest, NextResponse } from "next/server";

const KIE_MESSAGES_PATH = "/claude/v1/messages";

const EXTRACTION_PROMPT = `당신은 상품 사진에서 검색에 필요한 정보만 추출하는 시스템입니다.
사진은 의류 태그, 식품·생활용품 라벨, 화장품 패키지, 전자제품 박스, 가전 본체 등 어떤 카테고리든 올 수 있습니다.

다음 6가지 정보를 JSON으로 추출하세요:

1. brand — 브랜드명
   - 라벨에 영문이면 영문 그대로, 한글이면 한글 그대로. 번역하지 말 것.
   - ⚠️ brand 에는 카테고리 단어 (양말, 슬랙스, 섬유유연제, 라면 등) 절대 포함하지 말 것.
     ❌ 잘못된 예: "Nike 양말" / "농심 라면" / "스너글 섬유유연제"
     ✅ 올바른 예: brand="Nike" + productType="양말"
                  brand="농심" + productType="라면"
                  brand="스너글" + productType="섬유유연제"
   - 라벨에 "Nike 양말" 같이 한 줄로 붙어있어도 → brand 는 "Nike" 만, "양말" 은 productType 으로 분리.
   - 예: "Nike" / "나이키" / "Snuggle" / "스너글" / "Apple" / "Dyson" / "에스티 로더" / "농심"

2. modelName — 모델명 / 제품명
   우선순위로 판단:
   - 1순위: 검색창에 입력하면 해당 상품이 나오는, 사람이 부르는 이름 (예: "Blue Sparkle Plus", "에어 포스 1")
   - 2순위: brand 다음으로 큰 글씨로 적힌 라인·시리즈 이름.
     브랜드명 자체는 절대 modelName 에 넣지 말 것 — 예: 스너글 라벨에서 "스너글" 은 brand 이고 "Blue Sparkle Plus" 가 modelName.
   - 3순위: 그래도 모호하면 빈 문자열.
   - 예: "에어 포스 1"(신발) / "덩크 로우"(신발) / "Blue Sparkle Plus"(생활) / "진라면 매운맛"(식품) / "Advanced Night Repair"(화장품) / "iPhone 15 Pro 256GB"(전자) / "V11 Absolute"(가전)

3. productCode — 제품 코드 / 스타일 코드 / 모델 번호
   - 영문+숫자 조합 SKU. 의류·전자제품엔 흔하고, 식품·생활용품·화장품엔 거의 없음.
   - 예: "NWSLPK0400" / "FD1886-010" / "A2891" / "EY145AKO"
   - 없거나 안 보이면 빈 문자열.

4. productType — 상품 카테고리
   - 1~2 단어로 표현되는 일반 카테고리.
   - 예: "슬랙스"(의류) / "섬유유연제"(생활) / "라면"(식품) / "세럼"(화장품) / "스마트폰"(전자) / "무선청소기"(가전) / "에어프라이어"(가전)

5. price — 가격
   - 라벨에 적힌 가격. 숫자만 (쉼표·"원" 제거).
   - 여러 개면 가장 큰 숫자(정가) 선택.
   - 안 보이면 빈 문자열.

6. barcode — 바코드 숫자 (EAN-13 또는 UPC-12)
   - 바코드 막대 아래에 적힌 12자리 또는 13자리 숫자.
   - 예: "8801619944349" / "041234567890"
   - 한국 상품은 보통 13자리이며 880 또는 88 로 시작.
   - 안 보이거나 불완전하면 빈 문자열.
   - ⚠️ barcode 는 brand / modelName / productCode 와 별개 필드. 같은 숫자를 productCode 에 넣지 말 것.

⚠️ 무시할 것 (사진에 있어도 추출하지 마세요):
- 사용법, 사용 방법, How to use
- 주의사항, 경고, 보관 방법, 세탁 방법
- 성분, 원재료, 영양정보, 알레르기 정보
- 광고 카피 ("프리미엄", "최고의", "신상품", "한정")
- 제조원, 판매원, 수입원, 주소, 전화번호
- KC 인증, 정격전압, 소비전력, 안전기준 표시
- 사진 배경의 잡지·포스터·다른 상품 정보

⚠️ 가전 본체 라벨 케이스:
- 가전 본체 사진의 라벨에서 모델명을 못 찾으면 modelName 은 빈 문자열.
- 정격전압 / 소비전력 / 제조번호 / 시리얼 번호를 modelName 에 넣지 말 것.

⚠️ 코드/번호 OCR 시 혼동문자 주의:
- 알파벳 'O'(오) ↔ 숫자 '0'(영) — 영문 SKU 끝글자가 'O'인 경우가 많음
- 알파벳 'Y' ↔ 'V'
- 알파벳 'I'(아이) ↔ 숫자 '1'(일)
- 알파벳 'B' ↔ 숫자 '8'
- 알파벳 'S' ↔ 숫자 '5'

⚠️ 추측 금지:
- 글자가 흐리거나 잘려서 확실하지 않으면 빈 문자열
- 라벨에 없는 정보를 "이런 상품엔 보통 이런 게 있다"는 식으로 추측하지 말 것
- 부분만 보이는 코드는 빈 문자열 (잘못된 코드는 빈 결과보다 나쁨)

⚠️ 출력 형식:
- markdown 코드 블록 (\`\`\`) 으로 감싸지 말 것
- 다른 설명·인사·코멘트 금지
- 아래 JSON 객체 그대로만 응답

{
  "brand": "",
  "modelName": "",
  "productCode": "",
  "productType": "",
  "price": "",
  "barcode": ""
}`;

function normalizePrice(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "string") {
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) {
      return null;
    }
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeProductCode(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, "").toUpperCase();
}

function normalizeLabelField(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

/**
 * 후처리 안전망: KIE 가 brand 에 카테고리 단어를 같이 박아넣은 케이스 분리.
 * 예: brand="Nike 양말", productType="" → brand="Nike", productType="양말"
 * 토큰 기반이라 브랜드명 중간 단어가 우연히 카테고리어와 같아도 오분리 X.
 */
const KNOWN_CATEGORIES: string[] = [
  // 의류/잡화
  "양말", "슬랙스", "바지", "셔츠", "티셔츠", "원피스", "자켓", "코트", "신발", "운동화",
  "구두", "샌들", "스니커즈", "속옷", "잠옷",
  "가방", "지갑", "시계", "선글라스", "안경", "모자",
  // 생활용품
  "섬유유연제", "세제", "샴푸", "린스", "비누",
  "휴지", "수건", "칫솔", "치약",
  // 식품/건강
  "라면", "과자", "빵", "음료", "커피", "차",
  "비타민", "영양제", "건강식품", "우유", "요거트",
  // 화장품
  "세럼", "크림", "로션", "미스트", "에센스", "토너",
  "립스틱", "선크림", "쿠션", "파운데이션",
  // 전자/가전
  "스마트폰", "노트북", "태블릿", "이어폰", "헤드폰",
  "청소기", "에어프라이어", "전기밥솥", "공기청정기",
  "선풍기", "히터", "전기장판", "전자레인지", "정수기",
  // 의료 (5060 핵심)
  "혈압계", "체온계", "무릎보호대", "보청기",
];

function splitBrandFromCategory(
  rawBrand: string,
  rawProductType: string
): { brand: string; productType: string } {
  const trimmed = rawBrand.trim();

  if (rawProductType && rawProductType.trim()) {
    return { brand: trimmed, productType: rawProductType };
  }

  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 2) {
    return { brand: trimmed, productType: "" };
  }

  const lastToken = tokens[tokens.length - 1];
  if (KNOWN_CATEGORIES.includes(lastToken)) {
    return {
      brand: tokens.slice(0, -1).join(" "),
      productType: lastToken,
    };
  }

  const firstToken = tokens[0];
  if (KNOWN_CATEGORIES.includes(firstToken)) {
    return {
      brand: tokens.slice(1).join(" "),
      productType: firstToken,
    };
  }

  return { brand: trimmed, productType: "" };
}

/** 바코드 숫자만 남기고 12 또는 13자리만 통과. 그 외는 잘못 인식한 것으로 간주. */
function normalizeBarcode(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  const digits = String(value).replace(/[^\d]/g, "");
  if (digits.length === 12 || digits.length === 13) {
    return digits;
  }
  return "";
}

/**
 * Claude 응답 텍스트에서 JSON 블록 파싱.
 * 실패 시 기존 brand/code 형식이면 품번·브랜드만 폴백.
 */
function parseExtractFromContent(content: string): {
  productCode: string;
  brand: string;
  modelName: string;
  productType: string;
  price: number | null;
  barcode: string;
} {
  const empty = {
    productCode: "",
    brand: "",
    modelName: "",
    productType: "",
    price: null,
    barcode: "",
  };
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    return empty;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return empty;
  }

  if ("productCode" in parsed) {
    const raw =
      typeof parsed.productCode === "string"
        ? parsed.productCode
        : parsed.productCode != null
          ? String(parsed.productCode)
          : "";
    const productCode = normalizeProductCode(raw);
    const price = normalizePrice(parsed.price);
    const rawBrand = normalizeLabelField(parsed.brand);
    const modelName = normalizeLabelField(parsed.modelName);
    const rawProductType = normalizeLabelField(parsed.productType);
    const barcode = normalizeBarcode(parsed.barcode);

    const split = splitBrandFromCategory(rawBrand, rawProductType);
    if (
      split.brand !== rawBrand ||
      split.productType !== rawProductType
    ) {
      console.log("[brand split]", {
        before: { brand: rawBrand, productType: rawProductType },
        after: { brand: split.brand, productType: split.productType },
      });
    }

    return {
      productCode,
      brand: split.brand,
      modelName,
      productType: split.productType,
      price,
      barcode,
    };
  }

  if ("brand" in parsed || "code" in parsed) {
    const brand =
      typeof parsed.brand === "string" ? parsed.brand.trim() : "";
    const codeRaw = parsed.code;
    let code = "";
    if (typeof codeRaw === "string") {
      code = codeRaw.replace(/\s+/g, "").toUpperCase();
    }
    return {
      productCode: code,
      brand,
      modelName: "",
      productType: "",
      price: null,
      barcode: "",
    };
  }

  return empty;
}

function extractAssistantText(data: {
  content?: Array<{ type?: string; text?: string }>;
}): string {
  if (!Array.isArray(data.content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of data.content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.KIE_API_KEY?.trim();
    const visionModel = process.env.KIE_VISION_MODEL?.trim();
    const kieBaseUrl = (
      process.env.KIE_API_BASE_URL?.trim() || "https://api.kie.ai"
    ).replace(/\/$/, "");

    if (!apiKey || !visionModel) {
      return NextResponse.json(
        { error: "KIE API 설정이 없습니다" },
        { status: 500 }
      );
    }

    const messagesUrl = `${kieBaseUrl}${KIE_MESSAGES_PATH}`;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "잘못된 JSON 요청" },
        { status: 400 }
      );
    }

    const { imageBase64, mimeType } = body as {
      imageBase64?: string;
      mimeType?: string;
    };

    if (
      typeof imageBase64 !== "string" ||
      typeof mimeType !== "string" ||
      !imageBase64 ||
      !mimeType
    ) {
      return NextResponse.json(
        { error: "이미지 데이터가 필요합니다" },
        { status: 400 }
      );
    }

    const upstream = await fetch(messagesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: visionModel,
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: imageBase64,
                },
              },
              {
                type: "text",
                text: EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      console.error("KIE.AI API error:", upstream.status, errBody);
      return NextResponse.json(
        { error: "AI 분석 실패" },
        { status: 500 }
      );
    }

    const data = (await upstream.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };

    const assistantText = extractAssistantText(data);
    const { productCode, brand, modelName, productType, price, barcode } =
      parseExtractFromContent(assistantText);
    return NextResponse.json({
      productCode,
      brand,
      modelName,
      productType,
      price,
      barcode,
    });
  } catch (e) {
    console.error("extract route:", e);
    return NextResponse.json(
      { error: "일시적 오류" },
      { status: 500 }
    );
  }
}
