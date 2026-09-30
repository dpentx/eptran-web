import type { APIRoute } from "astro";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const prerender = false;

/**
 * Admin aracı: novel'ları (ve bağlı bölümleri + okuyucu önerilerini) siler.
 *
 * Auth: Authorization: Bearer <INGEST_SECRET>  (ingest ile aynı sır)
 *
 * Body (JSON) — ikisinden biri ZORUNLU, boş gövde hiçbir şey silmez:
 *   { "sourceKeys": ["knh-10", "knh-11"] }  -> sadece bu kitaplar
 *   { "all": true }                         -> TÜM novel'lar
 *
 * Silme sırası çocuktan ebeveyne: edit_suggestions -> chapters -> novels.
 * (Şemada onDelete cascade tanımlı ama SQLite'ta cascade'in çalışması
 * foreign_keys pragma'sına bağlı; ona güvenmemek için açıkça sıralıyoruz.)
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = import.meta.env.INGEST_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "geçersiz JSON" }, 400);
  }

  const all = body?.all === true;
  const sourceKeys: string[] = Array.isArray(body?.sourceKeys)
    ? body.sourceKeys.filter((k: unknown): k is string => typeof k === "string" && k.length > 0)
    : [];

  if (!all && sourceKeys.length === 0) {
    return json({ error: "ya { all: true } ya da boş olmayan bir sourceKeys listesi gerekli" }, 400);
  }

  const novelRows = all
    ? await db.select({ id: schema.novels.id, sourceKey: schema.novels.sourceKey }).from(schema.novels)
    : await db
        .select({ id: schema.novels.id, sourceKey: schema.novels.sourceKey })
        .from(schema.novels)
        .where(inArray(schema.novels.sourceKey, sourceKeys));

  const novelIds = novelRows.map((n) => n.id);
  if (novelIds.length === 0) {
    return json({ deleted: { novels: 0, chapters: 0, suggestions: 0 }, sourceKeys: [] });
  }

  const chapterRows = await db
    .select({ id: schema.chapters.id })
    .from(schema.chapters)
    .where(inArray(schema.chapters.novelId, novelIds));
  const chapterIds = chapterRows.map((c) => c.id);

  let suggestionCount = 0;
  if (chapterIds.length > 0) {
    const sugRows = await db
      .select({ id: schema.editSuggestions.id })
      .from(schema.editSuggestions)
      .where(inArray(schema.editSuggestions.chapterId, chapterIds));
    suggestionCount = sugRows.length;
    if (suggestionCount > 0) {
      await db
        .delete(schema.editSuggestions)
        .where(inArray(schema.editSuggestions.chapterId, chapterIds));
    }
    await db.delete(schema.chapters).where(inArray(schema.chapters.novelId, novelIds));
  }
  await db.delete(schema.novels).where(inArray(schema.novels.id, novelIds));

  return json({
    deleted: { novels: novelIds.length, chapters: chapterIds.length, suggestions: suggestionCount },
    sourceKeys: novelRows.map((n) => n.sourceKey),
  });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
