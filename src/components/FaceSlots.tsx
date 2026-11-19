import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { MOOD_EMOJI } from "../config";
import type { FaceStore } from "../lib/faceStore";
import type { Mood } from "../lib/types";
import { FaceCapture } from "./FaceCapture";
import { ImageCropper } from "./ImageCropper";

const SLOTS: { mood: Mood; label: string }[] = [
  { mood: "first", label: "1st place · smiling" },
  { mood: "second", label: "2nd place · straight face" },
  { mood: "third", label: "3rd place · crying" },
];

const MAX_BYTES = 8 * 1024 * 1024;

export function FaceSlots({ store, note, onMessage }: { store: FaceStore; note?: string; onMessage: (m: string) => void }) {
  const [faces, setFaces] = useState<Partial<Record<Mood, string>>>({});
  const [capturing, setCapturing] = useState<Mood | null>(null);
  const [cropping, setCropping] = useState<{ mood: Mood; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputs = useRef(new Map<Mood, HTMLInputElement>());

  const refresh = useCallback(() => store.load().then(setFaces), [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (mood: Mood, blob: Blob, ext: string) => {
    await store.save(mood, blob, ext);
    await refresh();
    onMessage("Face saved ✔");
  };

  const pick = async (mood: Mood, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      onMessage("That file is over 8 MB. Try a smaller one.");
      return;
    }
    if (file.type === "image/gif") {
      // Animated GIFs are used as-is (shown center-cropped in the circle).
      setBusy(true);
      try {
        await save(mood, file, "gif");
      } catch (err) {
        onMessage(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    setCropping({ mood, file });
  };

  return (
    <section className="panel">
      <h3>Your rank faces</h3>
      <p className="muted">
        Record a 2-second clip with your camera, or upload a photo or GIF. {note ?? "Everyone in the race sees these."}
      </p>
      <div className="slots">
        {SLOTS.map((s) => (
          <div key={s.mood} className="slot">
            <div className="face small">
              {faces[s.mood] ? <img src={faces[s.mood]} alt={s.label} /> : <span>{MOOD_EMOJI[s.mood]}</span>}
            </div>
            <span className="slot-label">{s.label}</span>
            <div className="slot-actions">
              <button className="primary" onClick={() => setCapturing(s.mood)} disabled={busy}>
                📸 Take it
              </button>
              <button onClick={() => fileInputs.current.get(s.mood)?.click()} disabled={busy}>
                Upload
              </button>
            </div>
            <input
              ref={(el) => {
                if (el) fileInputs.current.set(s.mood, el);
              }}
              type="file"
              hidden
              accept="image/gif,image/png,image/jpeg,image/webp"
              onChange={(e) => void pick(s.mood, e)}
            />
          </div>
        ))}
      </div>

      {capturing && (
        <FaceCapture mood={capturing} onUse={(blob) => save(capturing, blob, "gif")} onClose={() => setCapturing(null)} />
      )}
      {cropping && (
        <ImageCropper
          file={cropping.file}
          onUse={(blob) => save(cropping.mood, blob, "jpg")}
          onClose={() => setCropping(null)}
        />
      )}
    </section>
  );
}
