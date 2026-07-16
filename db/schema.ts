import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// novels: ononoki-dp botu tarafından /api/ingest üzerinden dolduruluyor.
// ---------------------------------------------------------------------------
export const novels = sqliteTable(
  "novels",
  {
    id: text("id").primaryKey(), // nanoid
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    description: text("description"),
    coverUrl: text("cover_url"),
    // eptran repo'sundaki output/<kitap-adi> klasör adı - re-ingest'te eşleştirmek için
    sourceKey: text("source_key").notNull(),
    status: text("status", { enum: ["ongoing", "completed"] })
      .notNull()
      .default("ongoing"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("novels_slug_idx").on(t.slug),
    sourceKeyIdx: uniqueIndex("novels_source_key_idx").on(t.sourceKey),
  })
);

// ---------------------------------------------------------------------------
// chapters: epub varsa spine sırasına göre, yoksa 001_kitap-adi.txt sırasına
// göre böünmüş içerik. content HTML olarak saklanıyor (epub -> XHTML zaten
// öyle geliyor; txt -> basit <p> sarmalama yapıyoruz).
// ---------------------------------------------------------------------------
export const chapters = sqliteTable(
  "chapters",
  {
    id: text("id").primaryKey(), // nanoid
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    index: integer("index").notNull(), // okuma sırası, 0'dan başlar
    slug: text("slug").notNull(), // /novel/[novelSlug]/[chapterSlug]
    title: text("title").notNull(),
    content: text("content").notNull(), // sanitized HTML
    sourceFormat: text("source_format", { enum: ["epub", "txt"] }).notNull(),
    // ingest sırasında içerik hash'i - aynı bölüm tekrar mı geldi kontrolü için
    contentHash: text("content_hash").notNull(),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    novelIdx: index("chapters_novel_idx").on(t.novelId),
    novelSlugIdx: uniqueIndex("chapters_novel_slug_idx").on(t.novelId, t.slug),
    novelIndexIdx: uniqueIndex("chapters_novel_index_idx").on(t.novelId, t.index),
  })
);

// ---------------------------------------------------------------------------
// edit_suggestions: okuyucunun seçtiği metin + önerdiği düzeltme.
// status "pending" -> ononoki-dp bunları toplayıp eptran reposuna PR açacak,
// PR açılınca "pr_open" + prUrl set edilir, merge/reddedilince güncellenir.
// submitterId şimdilik null (anonim); google/github login eklenince dolacak.
// ---------------------------------------------------------------------------
export const editSuggestions = sqliteTable(
  "edit_suggestions",
  {
    id: text("id").primaryKey(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    // orijinal metinde konumu bulmak için basit bir bağlam: seçilen kesin
    // metin + öncesinden/sonrasından birkaç kelime (fuzzy relocate için)
    selectedText: text("selected_text").notNull(),
    contextBefore: text("context_before").default(""),
    contextAfter: text("context_after").default(""),
    suggestedText: text("suggested_text").notNull(),
    note: text("note").default(""), // "typo" | "bağlam kayması" | serbest metin
    status: text("status", {
      enum: ["pending", "pr_open", "merged", "rejected"],
    })
      .notNull()
      .default("pending"),
    prUrl: text("pr_url"),
    submitterId: text("submitter_id"), // ileride google/github login user id
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    chapterIdx: index("edit_suggestions_chapter_idx").on(t.chapterId),
    statusIdx: index("edit_suggestions_status_idx").on(t.status),
  })
);

// ---------------------------------------------------------------------------
// relations - db.query.*.findMany({ with: {...} }) için
// ---------------------------------------------------------------------------
export const novelsRelations = relations(novels, ({ many }) => ({
  chapters: many(chapters),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  novel: one(novels, { fields: [chapters.novelId], references: [novels.id] }),
  suggestions: many(editSuggestions),
}));

export const editSuggestionsRelations = relations(editSuggestions, ({ one }) => ({
  chapter: one(chapters, { fields: [editSuggestions.chapterId], references: [chapters.id] }),
}));
