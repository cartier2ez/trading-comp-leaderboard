import { useEffect, useRef, useState, type PointerEvent } from "react";

const VIEW = 280; // viewport size in CSS px
const GUIDE = 0.9; // circle guide = crop area, as a share of the viewport
const OUT_PX = 400;

/** Drag + zoom a still photo inside the circle, export the circle's square as JPEG. */
export function ImageCropper({
  file,
  onUse,
  onClose,
}: {
  file: File;
  onUse: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setError("Couldn't read that image.");
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1;
  const scale = base * zoom; // CSS px per image px
  const w = img ? img.naturalWidth * scale : 0;
  const h = img ? img.naturalHeight * scale : 0;

  // Keep the image covering the whole viewport.
  const clamp = (o: { x: number; y: number }) => ({
    x: Math.min(Math.max(o.x, (VIEW - w) / 2), (w - VIEW) / 2),
    y: Math.min(Math.max(o.y, (VIEW - h) / 2), (h - VIEW) / 2),
  });
  const pos = clamp(offset);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setOffset(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
  };

  const use = async () => {
    if (!img) return;
    setSaving(true);
    const left = (VIEW - w) / 2 + pos.x;
    const top = (VIEW - h) / 2 + pos.y;
    const crop = VIEW * GUIDE;
    const c0 = (VIEW - crop) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = OUT_PX;
    canvas
      .getContext("2d")!
      .drawImage(img, (c0 - left) / scale, (c0 - top) / scale, crop / scale, crop / scale, 0, 0, OUT_PX, OUT_PX);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    try {
      if (!blob) throw new Error("Couldn't export the image.");
      await onUse(blob);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Crop your photo">
      <div className="modal-card">
        <h3>Drag and zoom to fit the circle</h3>
        <div
          className="cam cropper"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.002)))}
        >
          {img && (
            <img
              src={img.src}
              alt=""
              draggable={false}
              style={{ width: w, height: h, left: (VIEW - w) / 2 + pos.x, top: (VIEW - h) / 2 + pos.y }}
            />
          )}
          <div className="cam-guide" style={{ inset: `${((1 - GUIDE) / 2) * 100}%` }} />
        </div>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
        />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary" onClick={() => void use()} disabled={!img || saving}>
            {saving ? "Saving…" : "Use this"}
          </button>
        </div>
      </div>
    </div>
  );
}
