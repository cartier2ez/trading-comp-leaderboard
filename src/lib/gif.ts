import { GIFEncoder, applyPalette, quantize } from "gifenc";

/** RGBA pixels of one frame. `ImageData` fits this shape. */
export interface Frame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Encode frames as a forever-looping GIF that plays forward then backward
 * ("boomerang"), so the loop has no jump cut.
 */
export function encodeBoomerangGif(frames: Frame[], frameDelayMs: number): Uint8Array<ArrayBuffer> {
  const first = frames[0];
  if (!first) throw new Error("No frames to encode");
  const { width, height } = first;
  const size = width * height * 4;

  // One shared palette sampled from ~5 frames: smaller file, no color flicker.
  const step = Math.max(1, Math.floor(frames.length / 5));
  const sample = frames.filter((_, i) => i % step === 0);
  const pooled = new Uint8ClampedArray(sample.length * size);
  sample.forEach((f, i) => pooled.set(f.data, i * size));
  const palette = quantize(pooled, 256);

  const sequence = [...frames, ...frames.slice(1, -1).reverse()];
  const gif = GIFEncoder();
  sequence.forEach((f, i) => {
    const index = applyPalette(f.data, palette);
    gif.writeFrame(index, width, height, i === 0 ? { palette, delay: frameDelayMs, repeat: 0 } : { delay: frameDelayMs });
  });
  gif.finish();
  return gif.bytes();
}
