import { useEffect, useState } from "react";
import { getProgress } from "@/lib/progress";

interface Chapter {
  id: string;
  slug: string;
  title: string;
  index: number;
  viewCount: number;
}

export default function ChapterListClient({
  novelSlug,
  chapters,
}: {
  novelSlug: string;
  chapters: Chapter[];
}) {
  const [lastReadSlug, setLastReadSlug] = useState<string | null>(null);

  useEffect(() => {
    const progress = getProgress(novelSlug);
    setLastReadSlug(progress?.chapterSlug ?? null);
  }, [novelSlug]);

  return (
    <ol className="chapters">
      {chapters.map((c) => {
        const isLast = c.slug === lastReadSlug;
        return (
          <li key={c.id} className={isLast ? "current" : ""}>
            <a href={`/novel/${novelSlug}/${c.slug}`}>
              <span className="idx">{String(c.index + 1).padStart(3, "0")}</span>
              <span className="title">{c.title}</span>
              <span className="views" title="okunma sayısı">
                {c.viewCount}×
              </span>
              {isLast && <span className="badge">kaldığın yer</span>}
            </a>
          </li>
        );
      })}
      <style>{`
        .chapters { list-style: none; padding: 0; margin: 1rem 0; }
        .chapters li a {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.6rem 0.4rem; text-decoration: none; color: inherit;
          border-bottom: 1px solid var(--border);
          font-family: var(--font-mono); font-size: 0.85rem;
        }
        .chapters li a:hover { background: var(--surface); }
        .idx { color: var(--text-dim); width: 2.5rem; }
        .title { flex: 1; color: var(--text); font-family: var(--font-body); font-size: 0.95rem; }
        .views { color: var(--text-dim); font-size: 0.75rem; }
        .current a { border-left: 2px solid var(--accent); padding-left: 0.6rem; }
        .badge {
          font-size: 0.65rem; color: var(--accent); border: 1px solid var(--accent);
          padding: 0.1rem 0.4rem; border-radius: 3px;
        }
      `}</style>
    </ol>
  );
}
