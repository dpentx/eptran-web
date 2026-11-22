import type { APIRoute } from "astro";
import { db, schema } from "@/lib/db";
import { upsertNovelAndChapters } from "@/lib/ingestCore";
import { DEFAULT_LIBRARY_REPO, LibraryError, loadLibraryBook } from "@/lib/library";

export const prerender = false;

/**
 * Bir cildi eptran-library'den (public GitHub reposu) okuyup veritabanına yazar.
 * /api/ingest'in aksine dosya GÖVDEYE konmaz: bot sadece hangi cildi okuyacağımızı
 * söyler, metni site kendisi çeker. Gövde sınırı ve dosya taşıma sırrı gerekmez,
 * library'deki bir düzeltme sonrası aynı çağrı yeniden ingest işi görür.
 *
 *   POST application/json
 *   {
 *     "series": "kusuriya",      // library'deki seri klasörü
 *     "slug":   "knh-11",        // cilt klasörü (= eptran kitap slug'ı)
 *     "sourceKey": "knh-11",     // opsiyonel; verilmezse slug kullanılır
 *     "ref": "main"              // opsiyonel; dal/etiket/commit (varsayılan main)
 *   }
 *
 * Başlık/yazar library'deki index.json'dan gelir. Novel zaten varsa başlık, yazar
 * ve kapak DEĞİŞTİRİLMEZ (metadata orada zayıf olabilir); yalnızca bölümler
 * eklenir/güncellenir (/api/ingest ile aynı hash kuralı).
 *
 * Auth: Authorization: Bearer <INGEST_SECRET>   (/api/ingest ile aynı sır)
 * Ortam: LIBRARY_REPO (opsiyonel, varsayılan dpentx/eptran-library)
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = import.meta.env.INGEST_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { series?: unknown; slug?: unknown; sourceKey?: unknown; ref?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "geçersiz JSON" }, 400);
  }
  const series = typeof body.series === "string" ? body.series : "";
  const slug = typeof body.slug === "string" ? body.slug : "";
  const sourceKey = typeof body.sourceKey === "string" && body.sourceKey ? body.sourceKey : slug;
  const ref = typeof body.ref === "string" && body.ref ? body.ref : "main";
  if (!series || !slug) return json({ error: "series ve slug gerekli" }, 400);

  try {
    const { entry, chapters } = await loadLibraryBook({
      repo: import.meta.env.LIBRARY_REPO || DEFAULT_LIBRARY_REPO,
      ref,
      series,
      slug,
      cacheBust: String(Date.now()),
      fetchText: async (url) => {
        const res = await fetch(url);
        return { status: res.status, text: res.status === 200 ? await res.text() : "" };
      },
    });

    const result = await upsertNovelAndChapters(
      db,
      schema,
      {
        sourceKey,
        title: entry.baslik || slug,
        author: entry.yazar ?? null,
        description: null,
        preserveExisting: true,
      },
      "txt",
      chapters
    );
    return json({ ...result, chaptersTotal: chapters.length }, 200);
  } catch (e) {
    if (e instanceof LibraryError) return json({ error: e.message }, e.status);
    throw e;
  }
};

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), { status });
}
