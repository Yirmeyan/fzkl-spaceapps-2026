import { type JournalEntry, journalStatusLabel, sortJournalEntries } from "../data/journal";

interface JournalPanelProps {
  open: boolean;
  onClose: () => void;
  teamEntries: JournalEntry[];
  visitorEntries?: JournalEntry[];
  measuringId?: string | null;
  onOpen: (entry: JournalEntry) => void;
}

function EntryRow({
  entry,
  measuring,
  onOpen,
}: {
  entry: JournalEntry;
  measuring: boolean;
  onOpen: () => void;
}) {
  const visitor = entry.source === "visitor";
  const found = visitor
    ? "Shared by a visitor, not measured yet"
    : (entry.found ?? "Finding listed without a measured sentence.");
  const known = visitor ? null : entry.known;

  return (
    <li>
      <button
        type="button"
        className={`journal-row journal-row--${entry.status}${measuring ? " is-measuring" : ""}`}
        onClick={onOpen}
      >
        <span className="journal-row-head">
          <span className="journal-row-name">{entry.name}</span>
          <span className={`journal-badge journal-badge--${entry.status}`}>
            {entry.status === "synthetic" ? "SYNTHETIC" : entry.status}
          </span>
        </span>
        {entry.status === "unconfirmed" && !visitor && (
          <span className="journal-invite">{journalStatusLabel("unconfirmed")}</span>
        )}
        <span className="journal-found">{found}</span>
        {known && <span className="journal-known">{known}</span>}
        {measuring && <span className="journal-measuring">Measuring this field…</span>}
      </button>
    </li>
  );
}

/** Findings journal: team checks from journal.json (+ optional visitor marks). */
export function JournalPanel({
  open,
  onClose,
  teamEntries,
  visitorEntries = [],
  measuringId = null,
  onOpen,
}: JournalPanelProps) {
  if (!open) return null;
  const team = sortJournalEntries(teamEntries);

  return (
    <div className="journal-overlay" role="dialog" aria-modal="true" aria-label="Journal">
      <div className="journal-panel">
        <header className="journal-panel-head">
          <div>
            <p className="journal-kicker">Journal</p>
            <h2 className="journal-title">What the search found</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="journal-lede">
          What the search found in the fields we checked it on. Every number is measured by the
          service.
        </p>

        {visitorEntries.length > 0 && (
          <section className="journal-section" aria-label="Shared by visitors">
            <h3 className="journal-section-title">Shared by visitors</h3>
            <ul className="journal-list">
              {visitorEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  measuring={measuringId === entry.id}
                  onOpen={() => onOpen(entry)}
                />
              ))}
            </ul>
          </section>
        )}

        <section className="journal-section" aria-label="Our checks">
          <h3 className="journal-section-title">Our checks</h3>
          <ul className="journal-list">
            {team.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                measuring={measuringId === entry.id}
                onOpen={() => onOpen(entry)}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
