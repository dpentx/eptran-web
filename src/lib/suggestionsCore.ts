import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type * as Schema from "../../db/schema";

/**
 * Okuyucu önerilerinin bot tarafı: bekleyenleri listele, durumunu güncelle.
 * API ince tutuldu (src/pages/api/suggestions.ts) ve test edilebilsin diye
 * mantık burada.
 */

export const SUGGESTION_STATUSES = ["pending", "pr_open", "merged", "rejected"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** Bot'un ihtiyacı olan alanlar. Bölüm içeriği bilerek YOK (çok büyük). */
export interface BotSuggestion {
  id: string;
  status: SuggestionStatus;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  suggestedText: string;
  note: string;
  prUrl: string | null;
  createdAt: string;
  chapterId: string;
  /** 0 tabanlı; library'deki dosya numarası = chapterIndex + 1 (001.txt …) */
  chapterIndex: number;
  chapterTitle: string;
  /** eptran kitap slug'ı = library cilt klasörü */
  sourceKey: string;
  novelSlug: string;
}

export async function listSuggestionsForBot(
  db: LibSQLDatabase<typeof Schema>,
  schema: typeof Schema,
  status: SuggestionStatus
): Promise<BotSuggestion[]> {
  const rows = await db.query.editSuggestions.findMany({
    where: eq(schema.editSuggestions.status, status),
    with: { chapter: { with: { novel: true } } },
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    selectedText: r.selectedText,
    contextBefore: r.contextBefore ?? "",
    contextAfter: r.contextAfter ?? "",
    suggestedText: r.suggestedText,
    note: r.note ?? "",
    prUrl: r.prUrl ?? null,
    createdAt: r.createdAt.toISOString(),
    chapterId: r.chapterId,
    chapterIndex: r.chapter.index,
    chapterTitle: r.chapter.title,
    sourceKey: r.chapter.novel.sourceKey,
    novelSlug: r.chapter.novel.slug,
  }));
}

// Geçerli durum geçişleri. merged/rejected son durumdur.
const ALLOWED: Record<SuggestionStatus, SuggestionStatus[]> = {
  pending: ["pr_open", "rejected"],
  pr_open: ["merged", "rejected"],
  merged: [],
  rejected: [],
};

const PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/\d+$/;

export type UpdateResult =
  | { ok: true; status: SuggestionStatus }
  | { ok: false; code: "not_found" | "invalid"; message: string };

export async function updateSuggestionStatus(
  db: LibSQLDatabase<typeof Schema>,
  schema: typeof Schema,
  input: { id: unknown; status: unknown; prUrl?: unknown }
): Promise<UpdateResult> {
  if (typeof input.id !== "string" || !input.id) {
    return { ok: false, code: "invalid", message: "id gerekli" };
  }
  const next = input.status as SuggestionStatus;
  if (!SUGGESTION_STATUSES.includes(next)) {
    return { ok: false, code: "invalid", message: "geçersiz status" };
  }
  let prUrl: string | null | undefined = undefined;
  if (input.prUrl !== undefined && input.prUrl !== null) {
    if (typeof input.prUrl !== "string" || !PR_URL.test(input.prUrl)) {
      return { ok: false, code: "invalid", message: "geçersiz prUrl" };
    }
    prUrl = input.prUrl;
  }

  const current = await db.query.editSuggestions.findFirst({
    where: eq(schema.editSuggestions.id, input.id),
  });
  if (!current) return { ok: false, code: "not_found", message: "öneri bulunamadı" };

  if (!ALLOWED[current.status].includes(next)) {
    return { ok: false, code: "invalid", message: `${current.status} -> ${next} geçişi yok` };
  }
  if (next === "pr_open" && !(prUrl ?? current.prUrl)) {
    return { ok: false, code: "invalid", message: "pr_open için prUrl gerekli" };
  }

  await db
    .update(schema.editSuggestions)
    .set({ status: next, ...(prUrl ? { prUrl } : {}) })
    .where(eq(schema.editSuggestions.id, current.id));
  return { ok: true, status: next };
}
