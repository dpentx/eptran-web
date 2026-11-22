import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import crypto from "node:crypto";
import type * as Schema from "../../db/schema";
import type { ParsedChapter } from "./parseBook";

/**
 * /api/ingest (bot push) ve /api/ingest-library (library'den çekme) AYNI
 * novel + bölüm yazma mantığını kullanır; böylece iki yoldan gelen aynı metin
 * aynı hash'i üretir ve birbirini bozmaz.
 */

export interface NovelInput {
  sourceKey: string;
  title: string;
  author: string | null;
  description: string | null;
  /** data: URI; verilmezse mevcut kapak korunur. */
  coverDataUri?: string | null;
  /**
   * true ise novel zaten varsa başlık/yazar/açıklama DEĞİŞTİRİLMEZ (sadece
   * updatedAt). library'den gelen metadata zayıf olabilir (ör. başlık yerine slug),
   * mevcut güzel başlığı ezmemesi için.
   */
  preserveExisting?: boolean;
}

export interface IngestResult {
  novelId: string;
  chaptersCreated: number;
  chaptersUpdated: number;
}

export async function upsertNovelAndChapters(
  db: LibSQLDatabase<typeof Schema>,
  schema: typeof Schema,
  novel: NovelInput,
  format: "epub" | "txt",
  parsedChapters: ParsedChapter[]
): Promise<IngestResult> {
  const existing = await db.query.novels.findFirst({
    where: eq(schema.novels.sourceKey, novel.sourceKey),
  });

  const now = new Date();
  let novelId = existing?.id;

  if (!existing) {
    novelId = nanoid();
    await db.insert(schema.novels).values({
      id: novelId,
      slug: slugify(novel.title),
      title: novel.title,
      author: novel.author,
      description: novel.description,
      coverUrl: novel.coverDataUri ?? null,
      sourceKey: novel.sourceKey,
      status: "ongoing",
      createdAt: now,
      updatedAt: now,
    });
  } else if (novel.preserveExisting) {
    await db
      .update(schema.novels)
      .set({ updatedAt: now })
      .where(eq(schema.novels.id, existing.id));
  } else {
    await db
      .update(schema.novels)
      .set({
        title: novel.title,
        author: novel.author,
        description: novel.description,
        // kapak sadece yeni bir tane geldiyse güncellenir; gelmediyse eskisi kalır
        ...(novel.coverDataUri ? { coverUrl: novel.coverDataUri } : {}),
        updatedAt: now,
      })
      .where(eq(schema.novels.id, existing.id));
  }

  let created = 0;
  let updated = 0;

  for (const ch of parsedChapters) {
    const contentHash = crypto.createHash("sha256").update(ch.content).digest("hex");
    const chapterSlug = slugify(ch.title) || `bolum-${ch.index + 1}`;

    const existingChapter = await db.query.chapters.findFirst({
      where: and(eq(schema.chapters.novelId, novelId!), eq(schema.chapters.index, ch.index)),
    });

    if (!existingChapter) {
      await db.insert(schema.chapters).values({
        id: nanoid(),
        novelId: novelId!,
        index: ch.index,
        slug: chapterSlug,
        title: ch.title,
        content: ch.content,
        sourceFormat: format,
        contentHash,
        viewCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      created++;
    } else if (existingChapter.contentHash !== contentHash) {
      // eptran aynı bölümü tekrar çevirip düzeltmiş olabilir (ör. devam eden
      // çeviri veya kabul edilen bir öneri sonrası) - içeriği güncelle,
      // view_count'u koru.
      await db
        .update(schema.chapters)
        .set({ title: ch.title, content: ch.content, contentHash, updatedAt: now })
        .where(eq(schema.chapters.id, existingChapter.id));
      updated++;
    }
  }

  return { novelId: novelId!, chaptersCreated: created, chaptersUpdated: updated };
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}
