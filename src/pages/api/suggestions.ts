import type { APIRoute } from "astro";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const prerender = false;

/**
 * Okuyucu metinde bir kısmı seçip düzeltme önerdiğinde buraya düşer.
 * Şimdilik anonim (submitterId: null). Google/GitHub login eklendiğinde
 * request'e eklenecek session'dan submitterId doldurulacak.
 *
 * Bu tablo ononoki-dp botunun ayrıca (cron/webhook ile) taradığı, "pending"
 * durumundaki kayıtları alıp eptran reposuna PR açtığı, sonra status'u
 * "pr_open" + prUrl olarak güncellediği yer.
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) return new Response(JSON.stringify({ error: "geçersiz istek" }), { status: 400 });

  const { chapterId, selectedText, contextBefore, contextAfter, suggestedText, note } = body;

  if (!chapterId || !selectedText || !suggestedText) {
    return new Response(JSON.stringify({ error: "eksik alan" }), { status: 400 });
  }

  const chapter = await db.query.chapters.findFirst({ where: eq(schema.chapters.id, chapterId) });
  if (!chapter) return new Response(JSON.stringify({ error: "bölüm bulunamadı" }), { status: 404 });

  const id = nanoid();
  await db.insert(schema.editSuggestions).values({
    id,
    chapterId,
    selectedText,
    contextBefore: contextBefore ?? "",
    contextAfter: contextAfter ?? "",
    suggestedText,
    note: note ?? "",
    status: "pending",
    submitterId: null,
    createdAt: new Date(),
  });

  return new Response(JSON.stringify({ ok: true, id }), { status: 201 });
};

/**
 * ononoki-dp botunun pending önerileri çekmesi için (Bearer INGEST_SECRET).
 */
export const GET: APIRoute = async ({ request, url }) => {
  const secret = import.meta.env.INGEST_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const status = url.searchParams.get("status") ?? "pending";
  const pending = await db.query.editSuggestions.findMany({
    where: eq(schema.editSuggestions.status, status as any),
    with: { chapter: true },
  });

  return new Response(JSON.stringify(pending), { status: 200 });
};
