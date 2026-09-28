import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const prerender = false;

/**
 * Kapak resmini sunar. novels.cover_url iki biçimden birinde olabilir:
 *  - "data:image/jpeg;base64,..." : ingest'in yazdığı gömülü resim (bu route decode edip döner)
 *  - "https://..." : ileride harici bir URL konursa oraya yönlendirir
 *
 * Ana sayfa HTML'i data URI ile şişmesin diye sayfalar doğrudan cover_url
 * yerine /cover/<slug> kullanıyor; tarayıcı/CDN resmi ayrı isteyip cache'liyor.
 */
export const GET: APIRoute = async ({ params }) => {
  const novel = await db.query.novels.findFirst({
    where: eq(schema.novels.slug, params.slug!),
    columns: { coverUrl: true },
  });

  const cover = novel?.coverUrl;
  if (!cover) return new Response(null, { status: 404 });

  if (/^https?:\/\//.test(cover)) {
    return Response.redirect(cover, 302);
  }

  const m = cover.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) return new Response(null, { status: 404 });

  const bytes = new Uint8Array(Buffer.from(m[2], "base64"));
  return new Response(bytes, {
    headers: {
      "Content-Type": m[1],
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
};
