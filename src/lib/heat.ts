/**
 * Sequential aqua ramp for the availability heatmap (dark surface, so magnitude
 * anchors bright: 0 → near-surface navy, 1 → luminous aqua). Monotone lightness.
 */
const STOPS: [number, [number, number, number]][] = [
  [0.0, [17, 44, 71]], //   #112c47
  [0.25, [13, 78, 118]], // #0d4e76
  [0.5, [10, 122, 168]], // #0a7aa8
  [0.75, [30, 180, 215]], // #1eb4d7
  [1.0, [132, 242, 255]], // #84f2ff
]

function heatRGB(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i - 1]
    const [t2, c2] = STOPS[i]
    if (x <= t2) {
      const f = t2 === t1 ? 0 : (x - t1) / (t2 - t1)
      return [
        Math.round(c1[0] + (c2[0] - c1[0]) * f),
        Math.round(c1[1] + (c2[1] - c1[1]) * f),
        Math.round(c1[2] + (c2[2] - c1[2]) * f),
      ]
    }
  }
  return [132, 242, 255]
}

export function heatColor(t: number): string {
  const [r, g, b] = heatRGB(t)
  return `rgb(${r}, ${g}, ${b})`
}

function channelLin(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

/**
 * Ink for count labels on heatColor(t). Switching at the luminance where black
 * and white text have equal WCAG contrast (~4.58:1) keeps every count ≥ AA;
 * softer inks dip below 4.5:1 exactly at the mid-ramp crossover.
 */
export function heatInk(t: number): string {
  const [r, g, b] = heatRGB(t)
  const lum = 0.2126 * channelLin(r) + 0.7152 * channelLin(g) + 0.0722 * channelLin(b)
  return lum >= 0.179 ? '#000000' : '#ffffff'
}

export function heatGradientCSS(): string {
  return `linear-gradient(90deg, ${STOPS.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`).join(', ')})`
}

/**
 * Stable per-person colour for the claims grid (exclusive/schedule modes),
 * keyed by the reply's index. Golden-angle hue steps keep neighbours distinct
 * for any headcount; lightness is fixed so the shared dark ink stays readable.
 */
export function personColor(index: number): string {
  const hue = (index * 137.508 + 200) % 360
  return `hsl(${hue.toFixed(1)}, 70%, 66%)`
}

/** Ink for text on any personColor() background. */
export const PERSON_INK = '#06263f'

