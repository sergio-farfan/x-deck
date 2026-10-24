// Accent colour helpers (WCAG 2 relative luminance and contrast), so a light accent
// such as yellow still gives readable button text and readable accent-coloured text.

function parse(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

export function luminance(hex) {
  const rgb = parse(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text colour for a button or badge filled with the accent: black or white, whichever reads better.
export function onAccent(accent) {
  return contrast(accent, '#000000') >= contrast(accent, '#ffffff') ? '#000000' : '#ffffff';
}

// The accent adjusted (toward white on dark backgrounds, toward black on light ones)
// until it reaches `min` contrast against the background; unchanged when it already does.
export function readableOn(accent, background, min = 3) {
  const a = parse(accent);
  if (!a || !parse(background)) return accent;
  if (contrast(accent, background) >= min) return accent;
  const target = luminance(background) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const mixed = toHex(a.map((v, i) => v + (target[i] - v) * t));
    if (contrast(mixed, background) >= min) return mixed;
  }
  return toHex(target);
}

export const THEME_BACKGROUNDS = { dark: '#000000', dim: '#15202b', light: '#ffffff' };
