// Minimal types for gifenc (the package ships none).
declare module "gifenc" {
  export type Palette = number[][];
  type Format = "rgb565" | "rgb444" | "rgba4444";

  export interface FrameOptions {
    palette?: Palette;
    delay?: number; // ms
    repeat?: number; // -1 once, 0 forever
    transparent?: boolean;
    dispose?: number;
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: Format }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: Format): Uint8Array;
}
