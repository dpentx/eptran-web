import type { APIRoute } from "astro";
import { db, schema } from "@/lib/db";
import { parseEpub, parseTxtChapter } from "@/lib/parseBook";
import { upsertNovelAndChapters } from "@/lib/ingestCore";

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

  // Önce dosyaları ayrıştır, sonra yaz: eksik/bozuk dosya yüzünden yarım kalmış
  // (bölümsüz) bir novel kaydı oluşmasın.
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

  // novel'ı bul/oluştur + bölümleri yaz: /api/ingest-library ile ortak mantık.
  const { novelId, chaptersCreated, chaptersUpdated } = await upsertNovelAndChapters(
    db,
    schema,
    { sourceKey, title, author, description, coverDataUri },
    format,
    parsedChapters
  );

  return new Response(
    JSON.stringify({
      novelId,
      chaptersCreated,
      chaptersUpdated,
      coverSaved: coverDataUri !== null,
    }),
    { status: 200 }
  );
};
