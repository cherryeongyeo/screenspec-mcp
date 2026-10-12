import { PNG } from "pngjs";
import type { Rect } from "../spec/mockup.js";

/** Crop a PNG rendered at `scale` to `rect` (given in unscaled frame coordinates). */
export function cropPng(png: Buffer, rect: Rect, scale = 1): Buffer {
  const src = PNG.sync.read(png);
  const x = Math.max(0, Math.round(rect.x * scale));
  const y = Math.max(0, Math.round(rect.y * scale));
  const w = Math.max(1, Math.min(src.width - x, Math.round(rect.width * scale)));
  const h = Math.max(1, Math.min(src.height - y, Math.round(rect.height * scale)));
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(src, out, x, y, w, h, 0, 0);
  return PNG.sync.write(out);
}
