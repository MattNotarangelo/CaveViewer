/**
 * Depth colour map. We colour by elevation with a full-spectrum ramp where the
 * deepest point is red and the highest is blue (red at the bottom of the
 * scale). `t` is the normalized height in [0, 1] (0 = lowest point).
 */

export type RGB = readonly [number, number, number];

export function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

// Depth ramp control points, low (0) -> high (1). A hand-picked red -> yellow ->
// green -> cyan -> blue ramp (deep = red, high = blue), interpolated in RGB so it
// stays perceptually smooth and never strays into the violet/purple the raw HSL
// hue wheel produces near pure blue.
const DEPTH_RAMP: ReadonlyArray<RGB> = [
  [0.88, 0.20, 0.16], // red (deepest)
  [0.95, 0.83, 0.20], // yellow
  [0.27, 0.78, 0.30], // green
  [0.13, 0.72, 0.95], // cyan
  [0.16, 0.32, 0.92], // blue (highest)
];

/** Map normalized height t in [0,1] to an RGB triple in [0,1]. */
export function depthColor(t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  const n = DEPTH_RAMP.length - 1;
  const x = clamped * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  const a = DEPTH_RAMP[i];
  const b = DEPTH_RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** CSS `rgb(...)` string for a normalized height, for DOM legends. */
export function depthColorCss(t: number): string {
  const [r, g, b] = depthColor(t);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
