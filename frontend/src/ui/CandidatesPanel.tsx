import type { CandidatesFile } from "../data/candidates";
import { candidateSentence, emptyCandidatesSentence } from "../data/candidates";

interface CandidatesPanelProps {
  data: CandidatesFile | null;
  waiting?: boolean;
  activeIndex: number | null;
  /** Active detector filter; warn when a candidate is invisible here. */
  detector?: number | null;
  onPick: (index: number) => void;
  onStudy: (index: number) => void;
}

/** Rail panel: service-measured movers and changers (Tommy addition A). */
export function CandidatesPanel({
  data,
  waiting,
  activeIndex,
  detector = null,
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
        <p className="candidates-empty">{emptyCandidatesSentence(data.limits, data.sources)}</p>
      ) : (
        <ul className="candidates-list">
          {list.map((c, i) => {
            const hidden =
              detector != null && c.detectors.length > 0 && !c.detectors.includes(detector);
            return (
              <li key={`${c.kind}-${c.ra}-${c.dec}-${i}`}>
                <button
                  type="button"
                  className={`candidates-item${activeIndex === i ? " active" : ""}`}
                  onClick={() => onPick(i)}
                >
                  <span className="candidates-kind">
                    {c.kind}
                    {c.is_target ? " · you asked for this" : " · other object"}
                  </span>
                  <span className="candidates-sentence">{candidateSentence(c)}</span>
                  {hidden && (
                    <span className="candidates-det-warn">
                      Seen in detectors {c.detectors.join(", ")} — not this camera.
                    </span>
                  )}
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
            );
          })}
        </ul>
      )}
      {data.saturated.length > 0 && (
        <p className="candidates-sat">
          Too bright for SPHEREx to measure here ({data.saturated.length} saturated
          {data.saturated.length === 1 ? " star" : " stars"}).
        </p>
      )}
    </section>
  );
}
