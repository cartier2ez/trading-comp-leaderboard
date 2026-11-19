import { describe, expect, it } from "vitest";
import { encodeBoomerangGif, type Frame } from "../src/lib/gif";

function frame(seed: number, size = 32): Frame {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = (i * 7 + seed * 40) % 256;
    data[i * 4 + 1] = (i * 3 + seed * 10) % 256;
    data[i * 4 + 2] = (seed * 60) % 256;
    data[i * 4 + 3] = 255;
  }
  return { data, width: size, height: size };
}

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe("encodeBoomerangGif", () => {
  it("writes a forever-looping GIF89a", () => {
    const bytes = encodeBoomerangGif([0, 1, 2, 3, 4].map((s) => frame(s)), 100);
    expect(ascii(bytes.slice(0, 6))).toBe("GIF89a");
    expect(ascii(bytes)).toContain("NETSCAPE2.0");
    expect(bytes[bytes.length - 1]).toBe(0x3b); // trailer
    // Logical screen is 32x32 (little-endian at bytes 6-9).
    expect(bytes[6]! | (bytes[7]! << 8)).toBe(32);
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(32);
  });

  it("plays forward then backward: n frames become 2n-2", () => {
    const bytes = encodeBoomerangGif([0, 1, 2, 3, 4].map((s) => frame(s)), 100);
    // Each frame starts with an image descriptor (0x2C) right after its
    // 8-byte graphic control extension (0x21 0xF9 0x04 ... 0x00).
    let count = 0;
    for (let i = 0; i + 8 < bytes.length; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && bytes[i + 8] === 0x2c) count++;
    }
    expect(count).toBe(8);
  });

  it("refuses an empty clip", () => {
    expect(() => encodeBoomerangGif([], 100)).toThrow("No frames");
  });
});
