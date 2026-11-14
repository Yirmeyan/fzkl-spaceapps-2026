import { useEffect, useState } from "react";
import { ApiError, fetchHealth } from "../data/client";

type Status = "checking" | "ok" | "down";

export function HealthBadge() {
  const [status, setStatus] = useState<Status>("checking");
  const [detail, setDetail] = useState("Checking service…");

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    async function tick() {
      try {
        const h = await fetchHealth(ac.signal);
        if (cancelled) return;
        setStatus("ok");
        setDetail(`Service ${h.status} · v${h.version}`);
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setStatus("down");
        if (err instanceof ApiError) {
          setDetail(`Service unreachable (${err.code})`);
        } else {
          setDetail("Service offline — static samples still work");
        }
      }
    }

    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    return () => {
      cancelled = true;
      ac.abort();
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className={`health health-${status}`} title={detail}>
      <span className="health-dot" aria-hidden />
      <span>{detail}</span>
    </div>
  );
}
