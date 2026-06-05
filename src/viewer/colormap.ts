/**
 * Depth colour map. Caving convention is to colour by elevation; we use the
 * classic full-spectrum ramp (deep = blue, high = red) that cavers expect from
 * tools like Aven. `t` is the normalized height in [0, 1] (0 = lowest point).
 */

export type RGB = readonly [number, number, number];

function hslToRgb(h: number, s: number, l: number): RGB {
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

/** Map normalized height t in [0,1] to an RGB triple in [0,1]. */
export function depthColor(t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  // Hue 240° (blue, low) -> 0° (red, high).
  return hslToRgb(240 * (1 - clamped), 0.85, 0.5);
}

/** CSS `rgb(...)` string for a normalized height, for DOM legends. */
export function depthColorCss(t: number): string {
  const [r, g, b] = depthColor(t);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
