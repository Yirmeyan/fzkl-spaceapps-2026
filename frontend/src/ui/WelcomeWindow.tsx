import { useEffect, useRef } from "react";
import { TOP } from "./copy";
import "./welcome.css";

interface WelcomeWindowProps {
  onClose: () => void;
  onTour: () => void;
}

const STOPS = "button:not([disabled]), a[href]";

/**
 * What a newcomer needs before the first click: what SPHEREx is, what a visit is, and
 * three steps to start. Opens by itself once at each visit, on the sky map or in the
 * explorer, and from "How it works".
 * The text is the one of docs/ui-copy.md.
 */
export function WelcomeWindow({ onClose, onTour }: WelcomeWindowProps) {
  const card = useRef<HTMLDivElement>(null);
  // The page draws again at every image it receives: the listener below must not be
  // set again each time, or the focus would jump back to the first button.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The card itself takes the focus: a button would pull a phone down to the end of the text.
    card.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") {
        // The shortcuts of the page stay quiet behind the window.
        event.stopPropagation();
        return;
      }
      const stops = Array.from(card.current?.querySelectorAll<HTMLElement>(STOPS) ?? []);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const held = document.activeElement;
      const inside = card.current?.contains(held) ?? false;
      if (event.shiftKey && (held === first || held === card.current || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (held === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }

    // Capture: the window answers the keyboard before the page does.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      before?.focus();
    };
  }, []);

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <button
        type="button"
        className="welcome-veil"
        aria-label="Close the introduction"
        tabIndex={-1}
        onClick={onClose}
      />
      <div className="welcome-card" ref={card} tabIndex={-1}>
        <button type="button" className="welcome-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <p className="welcome-eyebrow">SPHEREx Explorer · How it works</p>
        <h2 id="welcome-title" className="welcome-title">
          Watch the sky change
        </h2>
        <p className="welcome-lead">
          SPHEREx is a NASA space telescope. Since 2025 it photographs the whole sky in infrared
          light, which our eyes cannot see.
        </p>
        <p>
          It comes back to each place about every six months. Each return is a{" "}
          <strong>visit</strong>, and each visit brings many images, one infrared color at a time.
        </p>
        <p>
          Compare the visits of one place and you see what changed: a star that moved, a star that
          grew brighter or fainter, perhaps a distant planet that nobody has found yet.
        </p>
        <h3>How to start</h3>
        <ol>
          <li>
            Click any place on the sky map, pick one of the examples, or type a star name or
            coordinates.
          </li>
          <li>
            Press <strong>Play</strong> to watch the images.
          </li>
          <li>
            Press <strong>Blink</strong> to flip between the first and the last visit. What jumps
            has moved.
          </li>
        </ol>
        <h3>Three words to know</h3>
        <dl>
          <dt>Visit</dt>
          <dd>
            One return of SPHEREx to this place. It comes back with each survey of the whole sky,
            about every six months.
          </dd>
          <dt>Detector</dt>
          <dd>
            SPHEREx has six, like six cameras behind one telescope. Each one sees a range of
            infrared colors.
          </dd>
          <dt>Infrared color</dt>
          <dd>A wavelength, counted in micrometers (µm). Cooler objects glow at larger numbers.</dd>
        </dl>
        <p className="welcome-foot">
          This window opens once at each visit. In the explorer, How it works reopens it.
        </p>
        <div className="welcome-actions">
          <button type="button" onClick={onClose}>
            Start exploring
          </button>
          <button type="button" title={TOP.guidedTour.hint} onClick={onTour}>
            Take the guided tour
          </button>
        </div>
      </div>
    </div>
  );
}
