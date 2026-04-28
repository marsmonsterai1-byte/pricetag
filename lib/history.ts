const STORAGE_KEY = "bogosa_search_history";

export type HistoryItem = {
  keyword: string;
  timestamp: number;
};

function isClient(): boolean {
  return typeof window !== "undefined";
}

export function getHistory(): HistoryItem[] {
  if (!isClient()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is HistoryItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).keyword === "string" &&
        typeof (item as Record<string, unknown>).timestamp === "number"
    );
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]): void {
  if (!isClient()) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage 용량 초과 / private mode 등 — 조용히 무시
  }
}

export function addHistory(keyword: string): void {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return;
  }
  const current = getHistory();
  const filtered = current.filter((item) => item.keyword !== trimmed);
  const next: HistoryItem[] = [
    { keyword: trimmed, timestamp: Date.now() },
    ...filtered,
  ];
  saveHistory(next);
}

export function removeHistory(keyword: string): void {
  const current = getHistory();
  const next = current.filter((item) => item.keyword !== keyword);
  saveHistory(next);
}

export function clearHistory(): void {
  if (!isClient()) {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
