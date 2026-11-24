/**
 * /api/ingest-library çekirdeği için testler: yerel libSQL dosyası + sahte fetch.
 * Çalıştır:  npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { freshDb, schema } from "./helpers";
import { upsertNovelAndChapters } from "../src/lib/ingestCore";
import { parseTxtChapter } from "../src/lib/parseBook";
import { LibraryError, loadLibraryBook, type FetchText } from "../src/lib/library";

const CH1 = "Bölüm 1: Fener Bekçisi\n\nFener bekçisi merdivenleri tırmandı.\n\n\"Yine sakin bir gece,\" dedi.\n";
const CH2 = "Bölüm 2: Sis\n\nSis çöktü.\n";

function fakeLibrary(files: Record<string, string>, log: string[] = []): FetchText {
  return async (url) => {
    log.push(url);
    const m = url.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/([^?]+)/);
    const key = m ? m[1] : "";
    return key in files ? { status: 200, text: files[key] } : { status: 404, text: "" };
  };
}

const INDEX = JSON.stringify({
  seri: "demo-seri", ad: "Demo",
  ciltler: [{ slug: "demo", baslik: "Demo Kitap", yazar: "Yazar", bolum_sayisi: 2, epub: null }],
});

const FILES = {
  "demo-seri/index.json": INDEX,
  "demo-seri/demo/001.txt": CH1,
  "demo-seri/demo/002.txt": CH2,
};

test("library'den okur, novel ve bölümleri oluşturur", async () => {
  const db = await freshDb();
  const { entry, chapters } = await loadLibraryBook({
    repo: "o/r", ref: "main", series: "demo-seri", slug: "demo", fetchText: fakeLibrary(FILES),
  });
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, "Bölüm 1: Fener Bekçisi");
  const res = await upsertNovelAndChapters(db, schema,
    { sourceKey: "demo", title: entry.baslik!, author: entry.yazar ?? null, description: null, preserveExisting: true },
    "txt", chapters);
  assert.equal(res.chaptersCreated, 2);
  const novel = await db.query.novels.findFirst({ where: eq(schema.novels.sourceKey, "demo") });
  assert.equal(novel?.title, "Demo Kitap");
  assert.equal(novel?.slug, "demo-kitap");
});

test("tekrar çalıştırmak idempotent; düzeltme sadece değişen bölümü günceller", async () => {
  const db = await freshDb();
  const run = async (files: Record<string, string>) => {
    const { entry, chapters } = await loadLibraryBook({
      repo: "o/r", ref: "main", series: "demo-seri", slug: "demo", fetchText: fakeLibrary(files),
    });
    return upsertNovelAndChapters(db, schema,
      { sourceKey: "demo", title: entry.baslik!, author: null, description: null, preserveExisting: true },
      "txt", chapters);
  };
  await run(FILES);
  const again = await run(FILES);
  assert.deepEqual([again.chaptersCreated, again.chaptersUpdated], [0, 0]);
  const fixed = await run({ ...FILES, "demo-seri/demo/002.txt": CH2.replace("çöktü", "indi") });
  assert.deepEqual([fixed.chaptersCreated, fixed.chaptersUpdated], [0, 1]);
});

test("var olan novel'ın başlığı/kapağı library metadata'sıyla ezilmez", async () => {
  const db = await freshDb();
  await upsertNovelAndChapters(db, schema,
    { sourceKey: "demo", title: "Güzel Başlık", author: "Yazar", description: "Açıklama", coverDataUri: "data:image/png;base64,AAA" },
    "txt", [parseTxtChapter("001.txt", CH1, 0)]);
  const { chapters } = await loadLibraryBook({
    repo: "o/r", ref: "main", series: "demo-seri", slug: "demo", fetchText: fakeLibrary(FILES),
  });
  const res = await upsertNovelAndChapters(db, schema,
    { sourceKey: "demo", title: "demo", author: null, description: null, preserveExisting: true },
    "txt", chapters);
  const novel = await db.query.novels.findFirst({ where: eq(schema.novels.sourceKey, "demo") });
  assert.equal(novel?.title, "Güzel Başlık");
  assert.equal(novel?.coverUrl, "data:image/png;base64,AAA");
  assert.equal(novel?.description, "Açıklama");
  assert.equal(res.chaptersCreated, 1); // 001 zaten vardı, 002 yeni
});

test("bot'un push'u ile library'den çekme aynı içerik hash'ini üretir (çift yazım olmaz)", async () => {
  const db = await freshDb();
  // Bot, load_txt_chapters çıktısını "{başlık}\n\n{gövde}" olarak gönderir.
  const pushed = [CH1, CH2].map((t, i) => parseTxtChapter(`00${i + 1}_demo.txt`, t.trimEnd(), i));
  await upsertNovelAndChapters(db, schema,
    { sourceKey: "demo", title: "Demo Kitap", author: null, description: null }, "txt", pushed);
  const { chapters } = await loadLibraryBook({
    repo: "o/r", ref: "main", series: "demo-seri", slug: "demo", fetchText: fakeLibrary(FILES),
  });
  const res = await upsertNovelAndChapters(db, schema,
    { sourceKey: "demo", title: "Demo Kitap", author: null, description: null, preserveExisting: true },
    "txt", chapters);
  assert.deepEqual([res.chaptersCreated, res.chaptersUpdated], [0, 0]);
});

test("hatalar: yok olan cilt, eksik dosya, güvensiz yol/ref", async () => {
  const f = fakeLibrary(FILES);
  await assert.rejects(loadLibraryBook({ repo: "o/r", ref: "main", series: "demo-seri", slug: "yok", fetchText: f }),
    (e: any) => e instanceof LibraryError && e.status === 404);
  // index 2 bölüm diyor ama 002.txt yok -> 502
  const missing = fakeLibrary({ "demo-seri/index.json": INDEX, "demo-seri/demo/001.txt": CH1 });
  await assert.rejects(loadLibraryBook({ repo: "o/r", ref: "main", series: "demo-seri", slug: "demo", fetchText: missing }),
    (e: any) => e instanceof LibraryError && e.status === 502);
  await assert.rejects(loadLibraryBook({ repo: "o/r", ref: "main", series: "../x", slug: "demo", fetchText: f }),
    (e: any) => e instanceof LibraryError && e.status === 400);
  await assert.rejects(loadLibraryBook({ repo: "o/r", ref: "main/../x", series: "demo-seri", slug: "demo", fetchText: f }),
    (e: any) => e instanceof LibraryError && e.status === 400);
});

test("istekler önbellek aşan sorgu dizesi taşır ve doğru ref'i kullanır", async () => {
  const log: string[] = [];
  await loadLibraryBook({ repo: "o/r", ref: "abc123", series: "demo-seri", slug: "demo",
    fetchText: fakeLibrary(FILES, log), cacheBust: "42" });
  assert.ok(log.every((u) => u.endsWith("?t=42")));
  assert.ok(log.every((u) => u.includes("/o/r/abc123/")));
});
