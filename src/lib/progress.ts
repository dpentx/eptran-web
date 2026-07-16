export interface ChapterProgress {
  chapterSlug: string;
  chapterIndex: number;
  scrollRatio: number; // 0..1, sayfa içindeki konum
  updatedAt: number;
}

const KEY_PREFIX = "novel-progress:";

/** novelSlug bazlı - her novel için ayrı, sadece bu cihazda saklanır. */
export function getProgress(novelSlug: string): ChapterProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + novelSlug);
    return raw ? (JSON.parse(raw) as ChapterProgress) : null;
  } catch {
    return null;
  }
}

export function setProgress(novelSlug: string, progress: ChapterProgress) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY_PREFIX + novelSlug, JSON.stringify(progress));
  } catch {
    // localStorage dolu/kapalı olabilir, sessizce yut
  }
}

/** Bölüm sayfasında scroll takibi için basit debounce yardımcı. */
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
