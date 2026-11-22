import { parseTxtChapter, type ParsedChapter } from "./parseBook";

/**
 * eptran-library'den (public GitHub reposu) bir cildi okur. Düzen ve bölüm
 * biçimi library README'sinde tanımlı: <seri>/index.json + <seri>/<cilt>/NNN.txt,
 * ana dalda YAYIN biçimi (ilk satır başlık, boş satır, paragraflar) — bu yüzden
 * burada başlık ayrıştırması için ayrı bir kural yok, parseTxtChapter yeter.
 */

export const DEFAULT_LIBRARY_REPO = "dpentx/eptran-library";

export interface LibraryEntry {
  slug: string;
  baslik?: string | null;
  yazar?: string | null;
  bolum_sayisi?: number;
  epub?: string | null;
}

export type FetchText = (url: string) => Promise<{ status: number; text: string }>;

const SAFE_PART = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const SAFE_REF = /^[A-Za-z0-9._\/-]{1,100}$/;

export class LibraryError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface LibraryBook {
  entry: LibraryEntry;
  chapters: ParsedChapter[];
}

export async function loadLibraryBook(opts: {
  repo: string;
  ref: string;
  series: string;
  slug: string;
  fetchText: FetchText;
  /** raw.githubusercontent.com ~5 dk önbellekler; sorgu dizesi bunu aşar. */
  cacheBust?: string;
  concurrency?: number;
}): Promise<LibraryBook> {
  const { repo, ref, series, slug, fetchText } = opts;
  if (!SAFE_PART.test(series) || !SAFE_PART.test(slug)) {
    throw new LibraryError("geçersiz series/slug", 400);
  }
  if (!SAFE_REF.test(ref) || ref.includes("..")) {
    throw new LibraryError("geçersiz ref", 400);
  }
  const base = `https://raw.githubusercontent.com/${repo}/${ref}`;
  const qs = opts.cacheBust ? `?t=${encodeURIComponent(opts.cacheBust)}` : "";

  const idx = await fetchText(`${base}/${series}/index.json${qs}`);
  if (idx.status !== 200) {
    throw new LibraryError(`index.json okunamadı (${series}): HTTP ${idx.status}`, 502);
  }
  let index: { ciltler?: LibraryEntry[] };
  try {
    index = JSON.parse(idx.text);
  } catch {
    throw new LibraryError(`index.json geçersiz JSON (${series})`, 502);
  }
  const entry = (index.ciltler ?? []).find((c) => c.slug === slug);
  if (!entry) throw new LibraryError(`'${slug}' index.json'da yok (${series})`, 404);

  const count = entry.bolum_sayisi ?? 0;
  if (!Number.isInteger(count) || count < 1) {
    throw new LibraryError(`'${slug}' için bolum_sayisi geçersiz`, 502);
  }

  const texts: string[] = new Array(count);
  const limit = Math.max(1, opts.concurrency ?? 6);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= count) return;
      const name = `${String(i + 1).padStart(3, "0")}.txt`;
      const res = await fetchText(`${base}/${series}/${slug}/${name}${qs}`);
      if (res.status !== 200) {
        throw new LibraryError(`${series}/${slug}/${name} okunamadı: HTTP ${res.status}`, 502);
      }
      texts[i] = res.text;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));

  const chapters = texts.map((t, i) =>
    parseTxtChapter(`${String(i + 1).padStart(3, "0")}.txt`, t, i)
  );
  return { entry, chapters };
}
