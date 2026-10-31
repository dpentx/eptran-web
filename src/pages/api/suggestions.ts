import type { APIRoute } from "astro";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const prerender = false;

const MAX_SELECTED = 2000;
const MAX_SUGGESTED = 4000;
const MAX_CONTEXT = 200;
const MAX_NOTE = 200;

// Anonim gönderimlerin kötüye kullanılmasını azaltan basit, en iyi çaba
// (best-effort) sınırlama: sunucusuz ortamda her örneğin kendi belleği var,
// yani kesin bir güvence DEĞİL; sadece sızıntıyı yavaşlatır.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Okuyucu metinde bir kısmı seçip (ya da bir paragrafa dokunup) düzeltme
 * önerdiğinde buraya düşer. Şimdilik anonim (submitterId: null).
 * Google/GitHub login eklendiğinde request'e eklenecek session'dan
 * submitterId doldurulacak.
 *
 * Bu tablo ononoki-dp botunun ayrıca (cron/webhook ile) taradığı, "pending"
 * durumundaki kayıtları alıp eptran reposuna PR açtığı, sonra status'u
 * "pr_open" + prUrl olarak güncellediği yer.
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "geçersiz istek" }, 400);

  // Bot tuzağı: gerçek kullanıcının görmediği alan doluysa sessizce "başarılı" dön.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return json({ ok: true }, 201);
  }

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return json({ error: "çok fazla istek, biraz sonra tekrar dene" }, 429);

  const { chapterId, selectedText, contextBefore, contextAfter, suggestedText, note } = body;

  if (
    typeof chapterId !== "string" || !chapterId ||
    typeof selectedText !== "string" || !selectedText.trim() ||
    typeof suggestedText !== "string" || !suggestedText.trim()
  ) {
    return json({ error: "eksik alan" }, 400);
  }
  if (selectedText.length > MAX_SELECTED) return json({ error: "seçilen metin çok uzun" }, 400);
  if (suggestedText.length > MAX_SUGGESTED) return json({ error: "öneri çok uzun" }, 400);
  if (selectedText.trim() === suggestedText.trim()) {
    return json({ error: "öneri orijinal metinle aynı" }, 400);
  }

  const chapter = await db.query.chapters.findFirst({ where: eq(schema.chapters.id, chapterId) });
  if (!chapter) return json({ error: "bölüm bulunamadı" }, 404);

  // Aynı bölüm + aynı metin + aynı öneri zaten bekliyorsa ikinci kayıt açma.
  const duplicate = await db.query.editSuggestions.findFirst({
    where: and(
      eq(schema.editSuggestions.chapterId, chapterId),
      eq(schema.editSuggestions.selectedText, selectedText),
      eq(schema.editSuggestions.suggestedText, suggestedText),
      eq(schema.editSuggestions.status, "pending"),
    ),
  });
  if (duplicate) return json({ ok: true, id: duplicate.id, duplicate: true }, 200);

  const id = nanoid();
  await db.insert(schema.editSuggestions).values({
    id,
    chapterId,
    selectedText,
    contextBefore: typeof contextBefore === "string" ? contextBefore.slice(0, MAX_CONTEXT) : "",
    contextAfter: typeof contextAfter === "string" ? contextAfter.slice(0, MAX_CONTEXT) : "",
    suggestedText,
    note: typeof note === "string" ? note.slice(0, MAX_NOTE) : "",
    status: "pending",
    submitterId: null,
    createdAt: new Date(),
  });

  return json({ ok: true, id }, 201);
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
