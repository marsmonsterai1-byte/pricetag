export type ExtractErrorKind =
  | "maintenance"
  | "network"
  | "client_error"
  | "too_large"
  | "unknown";

export const USER_MESSAGE_BY_KIND: Record<ExtractErrorKind, string> = {
  maintenance: "OCR 서버 점검 중이에요. 잠시 후 다시 시도해주세요.",
  network: "네트워크가 불안정해요. 잠시 후 다시 시도해주세요.",
  too_large: "사진 용량이 너무 커요. 다른 사진으로 시도해주세요.",
  client_error: "사진을 인식할 수 없어요. 다른 각도로 다시 찍어주세요.",
  unknown: "일시적 오류가 발생했어요. 잠시 후 다시 시도해주세요.",
};
