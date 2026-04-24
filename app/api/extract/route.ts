import { NextRequest, NextResponse } from "next/server";

const KIE_MESSAGES_PATH = "/claude/v1/messages";

const EXTRACTION_PROMPT = `이 상품 태그 사진에서 다음 정보를 정확히 추출해주세요:
1. 품번/모델번호 (예: EY145AKO, NWSLPK0400, AB-1234)
2. 브랜드명 (예: 테팔, 나이키, 삼성, LG)
3. 제품 종류 (예: 에어프라이어, 운동화, TV, 청소기, 슬랙스)
4. 가격 (원화, 숫자만)

⚠️ 품번 추출 시 매우 중요한 주의사항:
- 알파벳 'O'(오)와 숫자 '0'(영)을 정확히 구분하세요. 일반적으로 영문 모델번호의 끝글자가 'O'인 경우가 많습니다.
- 알파벳 'Y'와 'V'를 정확히 구분하세요. 둘은 비슷해 보이지만 다른 글자입니다.
- 알파벳 'I'(아이)와 숫자 '1'(일)을 구분하세요.
- 알파벳 'B'와 숫자 '8'을 구분하세요.
- 알파벳 'S'와 숫자 '5'를 구분하세요.
- 바코드 아래의 긴 숫자(보통 13자리)는 품번이 아닙니다. 품번은 보통 알파벳+숫자 조합입니다.
- 품번이 명확하지 않으면 가장 가능성 높은 것 하나만 선택하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 절대 금지:
{
  "productCode": "품번 (없으면 빈 문자열)",
  "brand": "브랜드명 (없으면 빈 문자열)",
  "productType": "제품 종류 (없으면 빈 문자열)",
  "price": 숫자 또는 null
}

규칙:
- 가격이 여러 개면 가장 큰 숫자 선택 (정가 우선)
- 가격에서 쉼표, '원' 제거하고 숫자만 반환
- 가격이 안 보이거나 불확실하면 null`;

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
 * Claude 응답 텍스트에서 JSON 블록 파싱.
 * 실패 시 기존 brand/code 형식이면 품번·브랜드만 폴백.
 */
function parseExtractFromContent(content: string): {
  productCode: string;
  brand: string;
  productType: string;
  price: number | null;
} {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    return { productCode: "", brand: "", productType: "", price: null };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { productCode: "", brand: "", productType: "", price: null };
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
    const brand = normalizeLabelField(parsed.brand);
    const productType = normalizeLabelField(parsed.productType);
    return { productCode, brand, productType, price };
  }

  if ("brand" in parsed || "code" in parsed) {
    const brand =
      typeof parsed.brand === "string" ? parsed.brand.trim() : "";
    const codeRaw = parsed.code;
    let code = "";
    if (typeof codeRaw === "string") {
      code = codeRaw.replace(/\s+/g, "").toUpperCase();
    }
    return { productCode: code, brand, productType: "", price: null };
  }

  return { productCode: "", brand: "", productType: "", price: null };
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
    const { productCode, brand, productType, price } =
      parseExtractFromContent(assistantText);
    return NextResponse.json({ productCode, brand, productType, price });
  } catch (e) {
    console.error("extract route:", e);
    return NextResponse.json(
      { error: "일시적 오류" },
      { status: 500 }
    );
  }
}
