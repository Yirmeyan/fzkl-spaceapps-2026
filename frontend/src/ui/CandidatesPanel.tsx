import type { CandidatesFile } from "../data/candidates";
import {
  candidateKindLabel,
  candidateLines,
  emptyCandidatesSentence,
  noSwingSentence,
} from "../data/candidates";
import type { CatalogSlice } from "../data/catalog";
import { FOUND } from "./copy";

interface CandidatesPanelProps {
  data: CandidatesFile | null;
  waiting?: boolean;
  activeIndex: number | null;
  /** Active detector filter; warn when a candidate is invisible here. */
  detector?: number | null;
  /** Catalog proper motion of the loaded target (mas/yr), legacy fallback. */
  catalogPmRa?: number | null;
  catalogPmDec?: number | null;
  /** Gaia slice of the view catalog (Tommy 19:00 knownAs lines). */
  gaiaCatalog?: CatalogSlice | null;
  /** Tommy 19:40: show synthetic detection check (WISE 0855 / slide 6). */
  showDetectionTrust?: boolean;
  /** Extra cold-object limit sentence (WISE 0855). */
  coldDetectionNote?: boolean;
  onPick: (index: number) => void;
  onStudy: (index: number) => void;
}

/** Rail panel: service-measured movers and changers (Tommy addition A). */
export function CandidatesPanel({
  data,
  waiting,
  activeIndex,
  detector = null,
  catalogPmRa = null,
  catalogPmDec = null,
  gaiaCatalog = null,
  showDetectionTrust = false,
  coldDetectionNote = false,
  onPick,
  onStudy,
}: CandidatesPanelProps) {
  if (waiting) {
    return (
      <section className="candidates-panel" aria-busy="true">
        <p className="candidates-kicker">What moved or changed here</p>
        <p className="candidates-empty">
          The service reads every image of this field, about half a minute.
        </p>
      </section>
    );
  }
  if (!data) return null;

  const list = data.candidates;

  return (
    <section className="candidates-panel" aria-label="What moved or changed here">
      <p className="candidates-kicker">What moved or changed here</p>
      <h3 className="candidates-title">Candidates from the service</h3>
      {data.synthetic?.note && (
        <p className="candidates-synthetic" role="note">
          SYNTHETIC · {data.synthetic.note}
        </p>
      )}
      {list.length === 0 ? (
        <p className="candidates-empty">{emptyCandidatesSentence(data.limits, data.sources)}</p>
      ) : (
        <ul className="candidates-list">
          {list.map((c, i) => {
            const hidden =
              detector != null && c.detectors.length > 0 && !c.detectors.includes(detector);
            const lines = candidateLines(c, catalogPmRa, catalogPmDec, gaiaCatalog);
            return (
              <li key={`${c.kind}-${c.ra}-${c.dec}-${i}`}>
                <button
                  type="button"
                  className={`candidates-item${activeIndex === i ? " active" : ""}`}
                  onClick={() => onPick(i)}
                >
                  <span className="candidates-kind">
                    {candidateKindLabel(c.kind)}
                    {c.is_target ? " · target" : ""}
                  </span>
                  <span className="candidates-line">{lines.what}</span>
                  {lines.howMeasured && (
                    <span className="candidates-line candidates-line-halo">
                      {lines.howMeasured}
                    </span>
                  )}
                  {lines.howFar && <span className="candidates-line">{lines.howFar}</span>}
                  <span className="candidates-line candidates-line-sure">{lines.sure}</span>
                  {lines.catalog && (
                    <span className="candidates-line candidates-line-catalog">{lines.catalog}</span>
                  )}
                  {hidden && (
                    <span className="candidates-det-warn">
                      Seen by cameras {c.detectors.join(", ")}, not by this one.
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="candidates-study"
                  onClick={() => onStudy(i)}
                  title={FOUND.open.hint}
                >
                  {FOUND.open.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data.saturated.length > 0 && (
        <p className="candidates-sat">
          Too bright for SPHEREx to give a flux here ({data.saturated.length} saturated
          {data.saturated.length === 1 ? " star" : " stars"}).
        </p>
      )}
      {(() => {
        const swingLine = noSwingSentence(data.limits);
        const hasSwung = list.some((c) => c.kind === "swung");
        if (!swingLine || hasSwung) return null;
        return <p className="candidates-no-swing">{swingLine}</p>;
      })()}
      {showDetectionTrust && (
        <aside className="detection-trust" aria-label="How detection was checked">
          <p className="detection-trust-kicker">How it was checked · synthetic</p>
          <p className="detection-trust-line">
            Tested on 2,560 synthetic stars added to real frames. A 0.3 mJy star moving 3″ per year
            is found nine times in ten. No star that stood still was ever claimed.
          </p>
          {coldDetectionNote && (
            <p className="detection-trust-cold">
              Cold objects at 4–5 µm: limit about 0.5–1 mJy. WISE 0855 sits near 0.5 mJy — among the
              faintest cold finds this tool can make.
            </p>
          )}
        </aside>
      )}
    </section>
  );
}
