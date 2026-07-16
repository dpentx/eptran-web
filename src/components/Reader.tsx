import { useEffect, useRef, useState } from "react";
import { debounce, getProgress, setProgress } from "@/lib/progress";

interface ChapterLink {
  slug: string;
  title: string;
  index: number;
}

interface Props {
  novelSlug: string;
  chapterId: string;
  chapterSlug: string;
  chapterIndex: number;
  title: string;
  novelTitle: string;
  contentHtml: string;
  prev: ChapterLink | null;
  next: ChapterLink | null;
  novelHref: string;
}

export default function Reader({
  novelSlug,
  chapterId,
  chapterSlug,
  chapterIndex,
  title,
  novelTitle,
  contentHtml,
  prev,
  next,
  novelHref,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    text: string;
    before: string;
    after: string;
    rect: DOMRect;
  } | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestedText, setSuggestedText] = useState("");
  const [note, setNote] = useState<"typo" | "baglam" | "diger">("typo");
  const [sent, setSent] = useState(false);

  // --- bölüme girince: view count ping + kaldığı yerden devam için scroll restore
  useEffect(() => {
    fetch(`/api/chapters/${chapterId}/view`, { method: "POST" }).catch(() => {});

    const saved = getProgress(novelSlug);
    if (saved?.chapterSlug === chapterSlug && saved.scrollRatio > 0) {
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * saved.scrollRatio });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  // --- scroll konumunu localStorage'a debounce'lu yaz
  useEffect(() => {
    const onScroll = debounce(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? window.scrollY / max : 0;
      setProgress(novelSlug, {
        chapterSlug,
        chapterIndex,
        scrollRatio: Math.min(1, Math.max(0, ratio)),
        updatedAt: Date.now(),
      });
    }, 400);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [novelSlug, chapterSlug, chapterIndex]);

  // --- metin seçimi: typo/bağlam önerisi popup'ı için
  useEffect(() => {
    function onMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !contentRef.current) {
        setSelection(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text || !contentRef.current.contains(sel.anchorNode)) {
        setSelection(null);
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // basit bağlam: seçilen node'un tüm metninden önce/sonra birkaç kelime
      const fullText = contentRef.current.innerText;
      const idx = fullText.indexOf(text);
      const before = idx > -1 ? fullText.slice(Math.max(0, idx - 40), idx) : "";
      const after = idx > -1 ? fullText.slice(idx + text.length, idx + text.length + 40) : "";

      setSelection({ text, before, after, rect });
      setSuggestedText(text);
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, []);

  async function submitSuggestion() {
    if (!selection) return;
    await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapterId,
        selectedText: selection.text,
        contextBefore: selection.before,
        contextAfter: selection.after,
        suggestedText,
        note,
      }),
    }).catch(() => {});
    setSent(true);
    setTimeout(() => {
      setSuggestOpen(false);
      setSelection(null);
      setSent(false);
    }, 1200);
  }

  return (
    <div className="reader">
      <div className="topbar">
        <a href={novelHref} className="back">‹ {novelTitle}</a>
        <span className="idx">#{String(chapterIndex + 1).padStart(3, "0")}</span>
      </div>

      <h1 className="title">{title}</h1>

      <div
        ref={contentRef}
        className="content"
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />

      <nav className="chapter-nav">
        {prev ? <a href={`${novelHref}/${prev.slug}`}>‹ {prev.title}</a> : <span />}
        {next ? <a href={`${novelHref}/${next.slug}`}>{next.title} ›</a> : <span />}
      </nav>

      {selection && (
        <div
          className="selection-popover"
          style={{
            position: "fixed",
            top: selection.rect.bottom + 8,
            left: Math.min(selection.rect.left, window.innerWidth - 280),
          }}
        >
          {!suggestOpen ? (
            <button onClick={() => setSuggestOpen(true)}>✎ düzeltme öner</button>
          ) : sent ? (
            <div className="sent">gönderildi ✓</div>
          ) : (
            <div className="suggest-box">
              <label>seçilen metin</label>
              <p className="selected-text">"{selection.text}"</p>
              <label>önerilen düzeltme</label>
              <textarea
                value={suggestedText}
                onChange={(e) => setSuggestedText(e.target.value)}
                rows={3}
              />
              <div className="note-type">
                <label>
                  <input
                    type="radio"
                    checked={note === "typo"}
                    onChange={() => setNote("typo")}
                  />
                  typo
                </label>
                <label>
                  <input
                    type="radio"
                    checked={note === "baglam"}
                    onChange={() => setNote("baglam")}
                  />
                  bağlam kayması
                </label>
                <label>
                  <input
                    type="radio"
                    checked={note === "diger"}
                    onChange={() => setNote("diger")}
                  />
                  diğer
                </label>
              </div>
              <div className="actions">
                <button onClick={submitSuggestion} disabled={!suggestedText.trim()}>
                  gönder
                </button>
                <button className="ghost" onClick={() => { setSuggestOpen(false); setSelection(null); }}>
                  vazgeç
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        .reader { padding-top: 1.5rem; }
        .topbar { display: flex; justify-content: space-between; align-items: center; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-dim); }
        .back { text-decoration: none; color: var(--text-dim); }
        .title { margin: 0.8rem 0 2rem; }
        .content { font-size: 1.05rem; line-height: 1.85; }
        .content :global(p) { margin: 0 0 1.2rem; }
        .content :global(img) { max-width: 100%; }
        .chapter-nav {
          display: flex; justify-content: space-between; margin-top: 3rem;
          padding-top: 1.5rem; border-top: 1px solid var(--border);
          font-family: var(--font-mono); font-size: 0.85rem;
        }
        .chapter-nav a { text-decoration: none; }

        .selection-popover {
          z-index: 50; background: var(--surface); border: 1px solid var(--border);
          border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); padding: 0.5rem;
        }
        .selection-popover button {
          background: none; border: 1px solid var(--border); color: var(--text);
          padding: 0.4rem 0.7rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem;
        }
        .suggest-box { width: 260px; display: flex; flex-direction: column; gap: 0.4rem; }
        .suggest-box label { font-size: 0.7rem; color: var(--text-dim); font-family: var(--font-mono); }
        .selected-text { font-size: 0.85rem; color: var(--text-dim); margin: 0; font-style: italic; }
        .suggest-box textarea {
          background: var(--bg); border: 1px solid var(--border); color: var(--text);
          border-radius: 4px; padding: 0.4rem; font-family: var(--font-body); resize: vertical;
        }
        .note-type { display: flex; gap: 0.6rem; font-size: 0.75rem; color: var(--text-dim); flex-wrap: wrap; }
        .note-type label { display: flex; align-items: center; gap: 0.2rem; }
        .actions { display: flex; gap: 0.5rem; margin-top: 0.2rem; }
        .actions button.ghost { border-color: transparent; color: var(--text-dim); }
        .sent { color: var(--accent); font-family: var(--font-mono); font-size: 0.85rem; padding: 0.3rem; }
      `}</style>
    </div>
  );
}
