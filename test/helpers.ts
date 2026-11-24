import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../db/schema";

/** Her test için yeni bir yerel libSQL dosyası; tablolar db/schema.ts ile aynı. */
export async function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eptran-web-test-"));
  const client = createClient({ url: `file:${path.join(dir, "t.db")}` });
  await client.executeMultiple(`
    CREATE TABLE novels (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, author TEXT,
      description TEXT, cover_url TEXT, source_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ongoing', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX novels_slug_idx ON novels(slug);
    CREATE UNIQUE INDEX novels_source_key_idx ON novels(source_key);
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      "index" INTEGER NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
      source_format TEXT NOT NULL, content_hash TEXT NOT NULL, view_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX chapters_novel_idx ON chapters(novel_id);
    CREATE UNIQUE INDEX chapters_novel_slug_idx ON chapters(novel_id, slug);
    CREATE UNIQUE INDEX chapters_novel_index_idx ON chapters(novel_id, "index");
    CREATE TABLE edit_suggestions (
      id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      selected_text TEXT NOT NULL, context_before TEXT DEFAULT '', context_after TEXT DEFAULT '',
      suggested_text TEXT NOT NULL, note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
      pr_url TEXT, submitter_id TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX edit_suggestions_chapter_idx ON edit_suggestions(chapter_id);
    CREATE INDEX edit_suggestions_status_idx ON edit_suggestions(status);
  `);
  return drizzle(client, { schema });
}

export { schema };
