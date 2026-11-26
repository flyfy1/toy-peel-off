// Drawing kit shared by the scene, the object table and the lazily loaded objects: types, seeded RNG,
// rounded rects, value noise. No object-specific code here.
import type { Poly, V } from './geom'

/** The ten object ids, in the order the share document indexes them (cards.ts PEEL_ITEMS). */
export const KINDS = ['phone', 'steel', 'remote', 'cam', 'watch', 'car', 'micro', 'fridge', 'laptop', 'cabinet'] as const
export type Kind = (typeof KINDS)[number]

/** Seeded RNG (mulberry32) so every bake is identical on every load. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let q = a
    q = Math.imul(q ^ (q >>> 15), q | 1)
    q ^= q + Math.imul(q ^ (q >>> 7), q | 61)
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296
  }
}

export interface Bubble {
  p: V
  rx: number
  ry: number
  a: number
  big: boolean
}

export interface Layout {
  kind: Kind
  /** The second, completely clear film under the printed one (phone only). Its tab is top left. */
  layer2: boolean
  w: number
  h: number
  dpr: number
  /** Object centre (css px) and rotation. */
  cx: number
  cy: number
  rot: number
  /** Object outer size and corner radius. */
  ow: number
  oh: number
  orad: number
  /** Film rect (film-local origin = its top-left), its corner radius and its centre's offset from the object centre. */
  fw: number
  fh: number
  frad: number
  fx: number
  fy: number
  /** Film-local x where the peelable film starts (the microwave's sliver under the trim lies left of it); 0 otherwise. */
  sx0: number
  /** Round film: the corner arc's apex lies m0 along the diagonal from A, and the pointer mapping accounts for it. */
  round: boolean
  m0: number
  /** Unit F (film's shorter side) and tab size T. */
  F: number
  T: number
  /** Grab corner A (film-local), and the two edge directions leaving A (unit). */
  A: V
  e1: V
  e2: V
  /** Outward diagonal at the corner (unit, away from the film). */
  out: V
  /** Film polygon (40-gon) for area and clipping, and a dense one for outlines (the peelable part). */
  poly40: Poly
  polyDense: Poly
  filmArea: number
  /** Texture padding (css px) around the film rect inside the film textures. */
  pad: number
}

export function rrPath(ctx: CanvasRenderingContext2D | Path2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function canvas(wpx: number, hpx: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(wpx))
  c.height = Math.max(1, Math.ceil(hpx))
  return c
}

/** Smooth value noise: a small random grid drawn up with bilinear smoothing. Alpha carries the value. */
function noiseLayer(w: number, h: number, cell: number, rnd: () => number, rgb: string, aMax: number): HTMLCanvasElement {
  const gw = Math.max(2, Math.ceil(w / cell) + 2)
  const gh = Math.max(2, Math.ceil(h / cell) + 2)
  const g = canvas(gw, gh)
  const gx = g.getContext('2d')!
  const img = gx.createImageData(gw, gh)
  const [r, gg, b] = rgb.split(',').map(Number)
  for (let i = 0; i < gw * gh; i++) {
    img.data[i * 4] = r
    img.data[i * 4 + 1] = gg
    img.data[i * 4 + 2] = b
    img.data[i * 4 + 3] = Math.round(255 * aMax * rnd())
  }
  gx.putImageData(img, 0, 0)
  return g
}

export function drawNoise(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell: number, rnd: () => number, rgb: string, aMax: number) {
  const g = noiseLayer(w, h, cell, rnd, rgb, aMax)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // offset by half a cell so the grid's edge rows (which fade) stay outside
  ctx.drawImage(g, 0.5, 0.5, g.width - 1, g.height - 1, x - cell * 0.5, y - cell * 0.5, (g.width - 1) * cell, (g.height - 1) * cell)
  ctx.restore()
}

export function objectPath(ctx: CanvasRenderingContext2D | Path2D, L: Layout, grow = 0) {
  rrPath(ctx, -L.ow / 2 - grow, -L.oh / 2 - grow, L.ow + 2 * grow, L.oh + 2 * grow, L.orad + grow)
}
