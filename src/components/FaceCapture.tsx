import { useEffect, useRef, useState } from "react";
import { MOOD_PROMPT } from "../config";
import { encodeBoomerangGif, type Frame } from "../lib/gif";
import type { Mood } from "../lib/types";

const OUT_PX = 180; // saved GIF is OUT_PX x OUT_PX
const FPS = 10;
const SECONDS = 2;
const GUIDE = 0.9; // circle guide diameter as a share of the viewport; also the crop

type Phase = "starting" | "ready" | "countdown" | "recording" | "encoding" | "preview" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "Camera blocked. Allow camera access (icon in the address bar) and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and try again.";
  return `Couldn't start the camera${e instanceof Error ? `: ${e.message}` : ""}.`;
}

export function FaceCapture({
  mood,
  onUse,
  onClose,
}: {
  mood: Mood;
  onUse: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("this page needs https (or localhost) to use the camera");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      if (cancelled || !video.current) {
        // Closed while the permission prompt was open: release the camera.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play();
      setPhase("ready");
    })().catch((e: unknown) => {
      if (cancelled) return;
      setError(cameraError(e));
      setPhase("error");
    });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview.url) : undefined), [preview]);

  const record = async () => {
    const v = video.current;
    if (!v) return;
    setPhase("countdown");
    for (let n = 3; n >= 1; n--) {
      setCount(n);
      await sleep(800);
    }
    setPhase("recording");

    // Crop: the visible square (object-fit: cover) shrunk to the circle guide, mirrored like the preview.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = OUT_PX;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const side = Math.min(v.videoWidth, v.videoHeight) * GUIDE;
    const sx = (v.videoWidth - side) / 2;
    const sy = (v.videoHeight - side) / 2;
    ctx.setTransform(-1, 0, 0, 1, OUT_PX, 0);

    const frames: Frame[] = [];
    const total = FPS * SECONDS;
    for (let i = 0; i < total; i++) {
      ctx.drawImage(v, sx, sy, side, side, 0, 0, OUT_PX, OUT_PX);
      frames.push(ctx.getImageData(0, 0, OUT_PX, OUT_PX));
      setProgress((i + 1) / total);
      await sleep(1000 / FPS);
    }

    setPhase("encoding");
    await sleep(30); // let "Making your GIF…" paint before the CPU-heavy part
    const blob = new Blob([encodeBoomerangGif(frames, 1000 / FPS)], { type: "image/gif" });
    setPreview({ blob, url: URL.createObjectURL(blob) });
    setPhase("preview");
  };

  const retake = () => {
    setPreview(null);
    setProgress(0);
    setPhase("ready");
  };

  const use = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await onUse(preview.blob);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Take your face">
      <div className="modal-card">
        <h3>{MOOD_PROMPT[mood]}</h3>

        <div className="cam">
          <video ref={video} playsInline muted className={phase === "preview" ? "hidden" : ""} />
          {preview && phase === "preview" && <img src={preview.url} alt="Your new face" />}
          <div className="cam-guide" style={{ inset: `${((1 - GUIDE) / 2) * 100}%` }} />
          {phase === "countdown" && <div className="cam-count">{count}</div>}
          {phase === "recording" && <div className="cam-rec">● REC</div>}
          {phase === "encoding" && <div className="cam-count small">Making your GIF…</div>}
          {phase === "starting" && <div className="cam-count small">Starting camera…</div>}
        </div>

        {phase === "recording" && (
          <div className="bar">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {phase === "preview" && preview && (
          <p className="muted small-print">{Math.round(preview.blob.size / 1024)} KB · loops forever</p>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {phase === "ready" && (
            <button className="primary" onClick={() => void record()}>
              Record 2 seconds
            </button>
          )}
          {phase === "preview" && (
            <>
              <button onClick={retake} disabled={saving}>
                Retake
              </button>
              <button className="primary" onClick={() => void use()} disabled={saving}>
                {saving ? "Saving…" : "Use this"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
