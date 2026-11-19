import { useEffect } from "react";
import { OVERTAKE_LINES } from "../config";
import type { Overtake } from "../lib/overtakes";

const SHOW_MS = 6000;

export function overtakeText(o: Overtake): string {
  const line = OVERTAKE_LINES[Math.floor(Math.random() * OVERTAKE_LINES.length)] ?? OVERTAKE_LINES[0]!;
  return line.replace("{passer}", o.passer).replace("{passed}", o.passed);
}

export function OvertakeBanner({
  items,
  onDone,
}: {
  items: { id: string; text: string }[];
  onDone: (id: string) => void;
}) {
  const current = items[0];
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => onDone(current.id), SHOW_MS);
    return () => clearTimeout(t);
  }, [current, onDone]);

  return (
    <div className="banner-slot" aria-live="polite">
      {current && (
        <div className="banner" key={current.id} onClick={() => onDone(current.id)}>
          {current.text}
        </div>
      )}
    </div>
  );
}
