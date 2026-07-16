import type { APIRoute } from "astro";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const prerender = false;

/**
 * Okuyucu bölüme girip birkaç saniye kaldığında (client tarafında debounce
 * edilmiş şekilde) çağrılır. Basit bir sunucu taraflı sayaç - kullanıcı
 * bazlı tekilleştirme yok, "kaç kez okundu" gösterimi için yeterli.
 */
export const POST: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return new Response(JSON.stringify({ error: "eksik id" }), { status: 400 });

  await db
    .update(schema.chapters)
    .set({ viewCount: sql`${schema.chapters.viewCount} + 1` })
    .where(eq(schema.chapters.id, id));

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
