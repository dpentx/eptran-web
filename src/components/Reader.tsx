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

/** Düzeltme önerisi verilecek metin: ya seçilen kısım ya da dokunulan paragraf. */
interface Target {
  text: string;
  before: string;
  after: string;
  source: "selection" | "paragraph";
}

type Note = "typo" | "baglam" | "diger";

const MAX_SUGGESTED = 4000;
const MAX_SELECTED = 2000;
const RATE_KEY = "eptran-suggest-times";
const RATE_MAX = 5; // 10 dakikada en fazla 5 öneri (sadece iyi niyetli kullanıcıyı korur; sunucu tarafında da sınır var)
const RATE_WINDOW_MS = 10 * 60 * 1000;
const BLOCK_SELECTOR = "p, h1, h2, h3, h4, blockquote, li";

function contextAround(full: string, text: string) {
  const idx = full.indexOf(text);
  return {
    before: idx > -1 ? full.slice(Math.max(0, idx - 40), idx) : "",
    after: idx > -1 ? full.slice(idx + text.length, idx + text.length + 40) : "",
  };
}

function recentSends(): number[] {
  try {
    const now = Date.now();
    const times: number[] = JSON.parse(localStorage.getItem(RATE_KEY) || "[]");
    return times.filter((t) => now - t < RATE_WINDOW_MS);
  } catch {
    return [];
  }
}

function noteSend() {
  try {
    localStorage.setItem(RATE_KEY, JSON.stringify([...recentSends(), Date.now()]));
  } catch {
    // localStorage kapalı olabilir
  }
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
  const activeBlockRef = useRef<HTMLElement | null>(null);

  // Seçili (henüz öneri formu açılmamış) metin adayı
  const [pending, setPending] = useState<Target | null>(null);
  // Açık düzeltme formunun hedefi
  const [target, setTarget] = useState<Target | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [suggestedText, setSuggestedText] = useState("");
  const [note, setNote] = useState<Note>("typo");
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

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

  // --- metin seçimi (masaüstü + MOBİL): eskiden sadece mouseup dinleniyordu,
  // dokunmatik ekranda hiç tetiklenmiyordu. selectionchange her ikisinde de çalışır.
  useEffect(() => {
    let clearTimer: ReturnType<typeof setTimeout> | undefined;

    function read() {
      const sel = window.getSelection();
      const root = contentRef.current;
      if (!sel || !root || sel.isCollapsed || sel.rangeCount === 0) {
        // Düğmeye dokunmak seçimi bozabilir; kısa bir süre aday olarak tut.
        clearTimeout(clearTimer);
        clearTimer = setTimeout(() => setPending(null), 1500);
        return;
      }
      const text = sel.toString().trim();
      if (!text || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return;
      clearTimeout(clearTimer);
      if (text.length > MAX_SELECTED) {
        setPending(null);
        return;
      }
      const { before, after } = contextAround(root.innerText, text);
      setPending({ text, before, after, source: "selection" });
    }

    const onChange = debounce(read, 250);
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      clearTimeout(clearTimer);
    };
  }, []);

  function clearActiveBlock() {
    activeBlockRef.current?.classList.remove("p-active");
    activeBlockRef.current = null;
  }

  function openSheet(t: Target, block?: HTMLElement) {
    clearActiveBlock();
    if (block) {
      block.classList.add("p-active");
      activeBlockRef.current = block;
    }
    setTarget(t);
    setSuggestedText(t.text);
    setNote("typo");
    setError("");
    setSent(false);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  function closeSheet() {
    clearActiveBlock();
    setTarget(null);
    setError("");
    setSent(false);
  }

  // Esc ile kapat
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target]);

  // Düzenleme modunda bir paragrafa dokununca tüm paragrafı düzeltme formuna al
  function onContentClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editMode) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // kullanıcı metin seçiyor
    const root = contentRef.current;
    const block = (e.target as HTMLElement).closest(BLOCK_SELECTOR) as HTMLElement | null;
    if (!root || !block || !root.contains(block)) return;
    const text = block.innerText.trim();
    if (!text || text.length > MAX_SELECTED) return;
    const { before, after } = contextAround(root.innerText, text);
    openSheet({ text, before, after, source: "paragraph" }, block);
  }

  async function submitSuggestion() {
    if (!target || busy) return;
    const suggested = suggestedText.trim();
    if (!suggested) {
      setError("Önerilen metin boş olamaz.");
      return;
    }
    if (suggested === target.text.trim()) {
      setError("Metinde henüz bir değişiklik yapmadın.");
      return;
    }
    if (suggested.length > MAX_SUGGESTED) {
      setError(`Öneri en fazla ${MAX_SUGGESTED} karakter olabilir.`);
      return;
    }
    if (recentSends().length >= RATE_MAX) {
      setError("Kısa sürede çok fazla öneri gönderdin, biraz sonra tekrar dene.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId,
          selectedText: target.text,
          contextBefore: target.before,
          contextAfter: target.after,
          suggestedText: suggested,
          note,
          website: honeypot, // bot tuzağı: gerçek kullanıcı bu alanı hiç görmez
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      noteSend();
      setSent(true);
      setTimeout(closeSheet, 1400);
    } catch (err) {
      // Eskiden hata yutulup yine de "gönderildi" gösteriliyordu.
      setError(err instanceof Error ? `Gönderilemedi: ${err.message}` : "Gönderilemedi, tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  const changed = target ? suggestedText.trim() !== target.text.trim() && suggestedText.trim() !== "" : false;

  return (
    <div className={"reader" + (editMode ? " edit-on" : "")}>
      <div className="topbar">
        <a href={novelHref} className="back">‹ {novelTitle}</a>
        <span className="topbar-right">
          <button
            type="button"
            className={"mode-btn" + (editMode ? " on" : "")}
            onClick={() => setEditMode((v) => !v)}
            aria-pressed={editMode}
          >
            ✎ {editMode ? "düzeltme modu açık" : "düzelt"}
          </button>
          <span className="idx">#{String(chapterIndex + 1).padStart(3, "0")}</span>
        </span>
      </div>

      {editMode && (
        <p className="edit-hint">
          Düzeltmek istediğin paragrafa dokun. Ya da bir kelime/cümle seçip "düzeltme öner"e bas.
        </p>
      )}

      <h1 className="title">{title}</h1>

      <div
        ref={contentRef}
        className="content"
        onClick={onContentClick}
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />

      <nav className="chapter-nav">
        {prev ? <a href={`${novelHref}/${prev.slug}`}>‹ {prev.title}</a> : <span />}
        {next ? <a href={`${novelHref}/${next.slug}`}>{next.title} ›</a> : <span />}
      </nav>

      {pending && !target && (
        <button
          type="button"
          className="fab"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openSheet(pending)}
        >
          ✎ düzeltme öner
        </button>
      )}

      {target && (
        <div
          className="backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSheet();
          }}
        >
          <div className="sheet" role="dialog" aria-label="düzeltme öner">
            {sent ? (
              <div className="sent">gönderildi ✓ teşekkürler</div>
            ) : (
              <>
                <div className="sheet-head">
                  <strong>düzeltme öner</strong>
                  <button type="button" className="ghost" onClick={closeSheet} aria-label="kapat">✕</button>
                </div>

                <label>{target.source === "paragraph" ? "paragraf" : "seçilen metin"}</label>
                <p className="selected-text">{target.text}</p>

                <label htmlFor="suggest-text">önerilen düzeltme</label>
                <textarea
                  id="suggest-text"
                  value={suggestedText}
                  onChange={(e) => setSuggestedText(e.target.value)}
                  rows={target.source === "paragraph" ? 7 : 4}
                  autoFocus
                />

                <div className="note-type">
                  {(
                    [
                      ["typo", "typo"],
                      ["baglam", "bağlam kayması"],
                      ["diger", "diğer"],
                    ] as [Note, string][]
                  ).map(([value, text]) => (
                    <label key={value}>
                      <input type="radio" name="note" checked={note === value} onChange={() => setNote(value)} />
                      {text}
                    </label>
                  ))}
                </div>

                {/* honeypot: ekran dışında, insanlar doldurmaz */}
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
                />

                {error && <div className="error">{error}</div>}

                <div className="actions">
                  <button type="button" onClick={submitSuggestion} disabled={busy || !changed}>
                    {busy ? "gönderiliyor…" : "gönder"}
                  </button>
                  <button type="button" className="ghost" onClick={closeSheet}>
                    vazgeç
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        .reader { padding-top: 1.5rem; }
        .topbar { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-dim); }
        .topbar-right { display: flex; align-items: center; gap: 0.7rem; }
        .back { text-decoration: none; color: var(--text-dim); }
        .mode-btn {
          background: none; border: 1px solid var(--border); color: var(--text-dim);
          padding: 0.35rem 0.65rem; border-radius: 6px; cursor: pointer;
          font-family: var(--font-mono); font-size: 0.75rem;
        }
        .mode-btn.on { color: var(--accent); border-color: var(--accent); }
        .edit-hint { font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent); margin: 0.8rem 0 0; }
        .title { margin: 0.8rem 0 2rem; }
        .content { font-size: 1.05rem; line-height: 1.85; }
        .content p { margin: 0 0 1.2rem; }
        .content img { max-width: 100%; }
        .edit-on .content p, .edit-on .content blockquote, .edit-on .content li, .edit-on .content h1, .edit-on .content h2, .edit-on .content h3, .edit-on .content h4 {
          cursor: pointer; border-radius: 4px;
        }
        .edit-on .content p:hover { background: rgba(159,208,161,0.07); }
        .content .p-active { background: rgba(159,208,161,0.14); outline: 1px solid var(--accent); }
        .chapter-nav {
          display: flex; justify-content: space-between; margin-top: 3rem;
          padding-top: 1.5rem; border-top: 1px solid var(--border);
          font-family: var(--font-mono); font-size: 0.85rem;
        }
        .chapter-nav a { text-decoration: none; }

        .fab {
          position: fixed; left: 50%; transform: translateX(-50%); z-index: 50;
          bottom: calc(1rem + env(safe-area-inset-bottom));
          background: var(--surface); color: var(--text); border: 1px solid var(--accent);
          border-radius: 999px; padding: 0.7rem 1.2rem; cursor: pointer;
          font-family: var(--font-mono); font-size: 0.85rem; box-shadow: 0 8px 24px rgba(0,0,0,0.45);
        }

        .backdrop {
          position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.55);
          display: flex; align-items: flex-end; justify-content: center;
        }
        .sheet {
          position: relative; width: 100%; max-width: 640px; max-height: 88vh; overflow-y: auto;
          background: var(--surface); border: 1px solid var(--border); border-bottom: none;
          border-radius: 14px 14px 0 0; padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
          display: flex; flex-direction: column; gap: 0.5rem;
        }
        .sheet-head { display: flex; justify-content: space-between; align-items: center; font-family: var(--font-mono); font-size: 0.85rem; }
        .sheet label { font-size: 0.7rem; color: var(--text-dim); font-family: var(--font-mono); }
        .selected-text {
          font-size: 0.9rem; color: var(--text-dim); margin: 0; font-style: italic;
          max-height: 7.5rem; overflow-y: auto; white-space: pre-wrap;
        }
        .sheet textarea {
          background: var(--bg); border: 1px solid var(--border); color: var(--text);
          border-radius: 6px; padding: 0.6rem; font-family: var(--font-body); resize: vertical;
          font-size: 16px; line-height: 1.6; width: 100%;
        }
        .note-type { display: flex; gap: 0.8rem; font-size: 0.8rem; color: var(--text-dim); flex-wrap: wrap; }
        .note-type label { display: flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; }
        .actions { display: flex; gap: 0.6rem; margin-top: 0.3rem; }
        .sheet button {
          background: none; border: 1px solid var(--border); color: var(--text);
          padding: 0.65rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; min-height: 42px;
        }
        .actions button:first-child { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; flex: 1; }
        .sheet button:disabled { opacity: 0.4; cursor: not-allowed; }
        .sheet button.ghost { border-color: transparent; color: var(--text-dim); }
        .error { color: #e67e80; font-family: var(--font-mono); font-size: 0.78rem; }
        .sent { color: var(--accent); font-family: var(--font-mono); font-size: 0.95rem; padding: 1.2rem 0.3rem; text-align: center; }
      `}</style>
    </div>
  );
}
