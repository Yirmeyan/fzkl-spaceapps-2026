import type { CandidatesFile } from "../data/candidates";
import { candidateSentence, emptyCandidatesSentence } from "../data/candidates";

interface CandidatesPanelProps {
  data: CandidatesFile | null;
  waiting?: boolean;
  activeIndex: number | null;
  onPick: (index: number) => void;
  onStudy: (index: number) => void;
}

/** Rail panel: service-measured movers and changers (Tommy addition A). */
export function CandidatesPanel({
  data,
  waiting,
  activeIndex,
  onPick,
  onStudy,
}: CandidatesPanelProps) {
  if (waiting) {
    return (
      <section className="candidates-panel" aria-busy="true">
        <p className="candidates-kicker">What moved or changed here</p>
        <p className="candidates-empty">Measuring candidates…</p>
      </section>
    );
  }
  if (!data) return null;

  const list = data.candidates;

  return (
    <section className="candidates-panel" aria-label="What moved or changed here">
      <p className="candidates-kicker">What moved or changed here</p>
      <h3 className="candidates-title">Candidates from the service</h3>
      {list.length === 0 ? (
        <p className="candidates-empty">{emptyCandidatesSentence(data.limits)}</p>
      ) : (
        <ul className="candidates-list">
          {list.map((c, i) => (
            <li key={`${c.kind}-${c.ra}-${c.dec}-${i}`}>
              <button
                type="button"
                className={`candidates-item${activeIndex === i ? " active" : ""}`}
                onClick={() => onPick(i)}
              >
                <span className="candidates-kind">
                  {c.kind}
                  {c.is_target ? " · target" : ""}
                </span>
                <span className="candidates-sentence">{candidateSentence(c)}</span>
              </button>
              <button
                type="button"
                className="candidates-study"
                onClick={() => onStudy(i)}
                title="Load this place as the target so its spectrum can load"
              >
                Study this
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.saturated.length > 0 && (
        <p className="candidates-sat">
          {data.saturated.length} saturated star
          {data.saturated.length === 1 ? "" : "s"} listed (too bright to measure).
        </p>
      )}
    </section>
  );
}
