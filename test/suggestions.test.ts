/**
 * Bot tarafı öneri akışı (src/lib/suggestionsCore.ts) için testler. Çalıştır: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { freshDb, schema } from "./helpers";
import { listSuggestionsForBot, updateSuggestionStatus } from "../src/lib/suggestionsCore";
import { upsertNovelAndChapters } from "../src/lib/ingestCore";
import { parseTxtChapter } from "../src/lib/parseBook";

async function seed() {
  const db = await freshDb();
  await upsertNovelAndChapters(db, schema,
    { sourceKey: "demo-kitap", title: "Demo Kitap", author: null, description: null }, "txt",
    [parseTxtChapter("001.txt", "Bölüm 1: Giriş\n\nBirinci paragraf.\n", 0),
     parseTxtChapter("002.txt", "Bölüm 2: Sis\n\nSis çöktü.\n", 1)]);
  const ch = await db.query.chapters.findMany();
  const second = ch.find((c) => c.index === 1)!;
  const mk = async (id: string, extra: Record<string, unknown> = {}, when = 1) =>
    db.insert(schema.editSuggestions).values({
      id, chapterId: second.id, selectedText: "çöktü", contextBefore: "Sis ", contextAfter: ".",
      suggestedText: "indi", note: "typo", status: "pending", submitterId: null,
      createdAt: new Date(when * 1000), ...extra,
    } as any);
  return { db, second, mk };
}

test("bot listesi ince: sourceKey + chapterIndex var, bölüm içeriği yok, eskiden yeniye sıralı", async () => {
  const { db, mk } = await seed();
  await mk("b", {}, 20);
  await mk("a", {}, 10);
  const list = await listSuggestionsForBot(db, schema, "pending");
  assert.deepEqual(list.map((s) => s.id), ["a", "b"]);
  const s = list[0];
  assert.equal(s.sourceKey, "demo-kitap");
  assert.equal(s.chapterIndex, 1);
  assert.equal(s.chapterTitle, "Bölüm 2: Sis");
  assert.equal(s.selectedText, "çöktü");
  assert.equal(s.prUrl, null);
  assert.ok(!("content" in s) && !("chapter" in s));
});

test("status filtresi sadece o durumdakileri döndürür", async () => {
  const { db, mk } = await seed();
  await mk("p1");
  await mk("o1", { status: "pr_open", prUrl: "https://github.com/o/r/pull/3" });
  assert.deepEqual((await listSuggestionsForBot(db, schema, "pr_open")).map((s) => s.id), ["o1"]);
  assert.deepEqual((await listSuggestionsForBot(db, schema, "merged")), []);
});

test("geçerli geçişler: pending -> pr_open (prUrl ile) -> merged", async () => {
  const { db, mk } = await seed();
  await mk("x");
  const url = "https://github.com/dpentx/eptran-library/pull/7";
  assert.deepEqual(await updateSuggestionStatus(db, schema, { id: "x", status: "pr_open", prUrl: url }),
    { ok: true, status: "pr_open" });
  const row = await db.query.editSuggestions.findFirst({ where: eq(schema.editSuggestions.id, "x") });
  assert.equal(row?.status, "pr_open");
  assert.equal(row?.prUrl, url);
  assert.deepEqual(await updateSuggestionStatus(db, schema, { id: "x", status: "merged" }),
    { ok: true, status: "merged" });
});

test("geçersiz geçişler ve girdiler reddedilir; son durumlar değişmez", async () => {
  const { db, mk } = await seed();
  await mk("y");
  const bad = async (input: any) => (await updateSuggestionStatus(db, schema, input));
  assert.equal((await bad({ id: "y", status: "merged" })).ok, false);            // pending -> merged yok
  assert.equal((await bad({ id: "y", status: "pr_open" })).ok, false);           // prUrl yok
  assert.equal((await bad({ id: "y", status: "pr_open", prUrl: "http://evil.example/x" })).ok, false);
  assert.equal((await bad({ id: "y", status: "pr_open", prUrl: "https://github.com/o/r/issues/1" })).ok, false);
  assert.equal((await bad({ id: "y", status: "bilinmeyen" })).ok, false);
  assert.equal((await bad({ status: "rejected" })).ok, false);
  const nf: any = await bad({ id: "yok", status: "rejected" });
  assert.equal(nf.code, "not_found");
  assert.equal((await bad({ id: "y", status: "rejected" })).ok, true);
  assert.equal((await bad({ id: "y", status: "pending" })).ok, false);           // rejected son durum
});
