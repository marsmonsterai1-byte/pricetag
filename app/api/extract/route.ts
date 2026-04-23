import { NextRequest, NextResponse } from "next/server";

const KIE_MESSAGES_PATH = "/claude/v1/messages";

const EXTRACTION_PROMPT = `이 상품 태그 사진에서 두 가지 정보를 추출해주세요:
1. 품번/모델번호 (예: NWSLPK0400, AB-1234 등)
2. 가격 (원화, 숫자만)

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 절대 금지:
{"productCode": "추출한 품번", "price": 숫자 또는 null}

규칙:
- 품번이 여러 개면 가장 긴 것 선택
- 가격이 여러 개면 가장 큰 숫자 선택 (할인가 말고 정가 우선)
- 가격에서 쉼표, '원' 제거하고 숫자만 반환
- 가격이 안 보이거나 불확실하면 null
- 품번이 없으면 productCode는 빈 문자열`;

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

/**
 * Claude 응답 텍스트에서 JSON 블록 파싱.
 * 실패 시 기존 brand/code 형식이면 품번만 폴백.
 */
function parseExtractFromContent(content: string): {
  productCode: string;
  price: number | null;
} {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    return { productCode: "", price: null };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { productCode: "", price: null };
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
    return { productCode, price };
  }

  if ("brand" in parsed || "code" in parsed) {
    const brand =
      typeof parsed.brand === "string"
        ? parsed.brand.trim()
        : parsed.brand === null
          ? ""
          : "";
    const codeRaw = parsed.code;
    let code = "";
    if (typeof codeRaw === "string") {
      code = codeRaw.replace(/\s+/g, "").toUpperCase();
    }
    const productCode = [brand, code].filter(Boolean).join(" ").trim();
    return { productCode, price: null };
  }

  return { productCode: "", price: null };
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
        max_tokens: 400,
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
    const { productCode, price } = parseExtractFromContent(assistantText);
    return NextResponse.json({ productCode, price });
  } catch (e) {
    console.error("extract route:", e);
    return NextResponse.json(
      { error: "일시적 오류" },
      { status: 500 }
    );
  }
}
