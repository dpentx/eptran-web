import type { APIRoute } from "astro";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { parseEpub, parseTxtChapter } from "@/lib/parseBook";
import crypto from "node:crypto";

export const prerender = false;

// Kapak resmi için üst sınır. Bot zaten ~400px'e küçültüp gönderiyor
// (birkaç on KB); bu sınır sadece yanlışlıkla dev bir dosya gelirse DB'yi
// şişirmesin diye.
const MAX_COVER_BYTES = 1_500_000;

/**
 * ononoki-dp botu, eptran'ın output/ klasörü değişince (GitHub Actions'tan)
 * buraya multipart/form-data POST atar:
 *
 *   sourceKey   : "kitap-adi" (output/kitap-adi klasör adı, novel eşleştirme anahtarı)
 *   title       : "Kitap Adı"
 *   author      : opsiyonel
 *   description : opsiyonel
 *   format      : "epub" | "txt"
 *   file        : epub ise tek .epub dosyası
 *   files[]     : txt ise 001_.., 002_.. şeklinde sıralı .txt dosyaları
 *   cover       : opsiyonel kapak resmi (image/*). Verilirse novels.cover_url'e
 *                 data URI olarak yazılır, /cover/<slug> route'u sunar.
 *
 * Auth: Authorization: Bearer <INGEST_SECRET>
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = import.meta.env.INGEST_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const form = await request.formData();
  const sourceKey = form.get("sourceKey")?.toString();
  const title = form.get("title")?.toString();
  const author = form.get("author")?.toString() ?? null;
  const description = form.get("description")?.toString() ?? null;
  const format = form.get("format")?.toString();

  if (!sourceKey || !title || (format !== "epub" && format !== "txt")) {
    return new Response(JSON.stringify({ error: "eksik veya hatalı alan" }), { status: 400 });
  }

  // opsiyonel kapak resmi
  let coverDataUri: string | null = null;
  const coverFile = form.get("cover");
  if (coverFile && typeof coverFile === "object" && coverFile.size > 0) {
    const type = coverFile.type || "image/jpeg";
    if (type.startsWith("image/") && coverFile.size <= MAX_COVER_BYTES) {
      const buf = Buffer.from(await coverFile.arrayBuffer());
      coverDataUri = `data:${type};base64,${buf.toString("base64")}`;
    }
  }

  // novel'ı bul ya da oluştur
  const existing = await db.query.novels.findFirst({
    where: eq(schema.novels.sourceKey, sourceKey),
  });

  const now = new Date();
  let novelId = existing?.id;

  if (!existing) {
    novelId = nanoid();
    await db.insert(schema.novels).values({
      id: novelId,
      slug: slugify(title),
      title,
      author,
      description,
      coverUrl: coverDataUri,
      sourceKey,
      status: "ongoing",
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(schema.novels)
      .set({
        title,
        author,
        description,
        // kapak sadece yeni bir tane geldiyse güncellenir; gelmediyse eskisi kalır
        ...(coverDataUri ? { coverUrl: coverDataUri } : {}),
        updatedAt: now,
      })
      .where(eq(schema.novels.id, existing.id));
  }

  let parsedChapters: { index: number; title: string; content: string }[] = [];

  if (format === "epub") {
    const file = form.get("file") as File | null;
    if (!file) return new Response(JSON.stringify({ error: "epub dosyası eksik" }), { status: 400 });
    parsedChapters = await parseEpub(await file.arrayBuffer());
  } else {
    const files = form.getAll("files[]") as File[];
    if (!files.length)
      return new Response(JSON.stringify({ error: "txt dosyaları eksik" }), { status: 400 });
    // dosya adına göre sırala: 001_..., 002_...
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    parsedChapters = await Promise.all(
      files.map(async (f, i) => parseTxtChapter(f.name, await f.text(), i))
    );
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

  return new Response(
    JSON.stringify({
      novelId,
      chaptersCreated: created,
      chaptersUpdated: updated,
      coverSaved: coverDataUri !== null,
    }),
    { status: 200 }
  );
};

function slugify(s: string) {
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
