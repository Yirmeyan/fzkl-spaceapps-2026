import type { JournalShareCategory } from "../data/client";

const CATEGORIES: { value: JournalShareCategory; label: string }[] = [
  { value: "moved", label: "It moves" },
  { value: "changed", label: "It changes brightness" },
  { value: "appears-once", label: "It appears once" },
  { value: "other", label: "Something else" },
];

interface ShareFindingProps {
  armed: boolean;
  open: boolean;
  hasMark: boolean;
  category: JournalShareCategory;
  status: string | null;
  busy: boolean;
  onToggleArm: () => void;
  onCategory: (c: JournalShareCategory) => void;
  onShare: () => void;
  onClear: () => void;
}

/** Compact share strip: arm click-to-frame, pick a category, post the mark. */
export function ShareFinding({
  armed,
  open,
  hasMark,
  category,
  status,
  busy,
  onToggleArm,
  onCategory,
  onShare,
  onClear,
}: ShareFindingProps) {
  if (!open) return null;

  return (
    <section className="share-finding" aria-labelledby="share-finding-kicker">
      <p className="share-finding-kicker" id="share-finding-kicker">
        Share a place · no text
      </p>
      <div className="share-finding-row">
        <button
          type="button"
          className={armed ? "active" : "ghost"}
          onClick={onToggleArm}
          title="Click the sky to drop a small frame on what caught your eye"
        >
          {armed ? "Click the sky…" : "Frame a point"}
        </button>
        <label className="share-finding-cat">
          <span className="sr-only">Category</span>
          <select
            value={category}
            onChange={(e) => onCategory(e.target.value as JournalShareCategory)}
            disabled={!hasMark}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primary" disabled={!hasMark || busy} onClick={onShare}>
          {busy ? "Sharing…" : "Share this finding"}
        </button>
        {hasMark && (
          <button type="button" className="ghost" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {status && <p className="share-finding-status">{status}</p>}
    </section>
  );
}
