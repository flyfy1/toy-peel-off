// Objects, layout and the per-object bakes (spec 3.1, 3.3, 3.4): tray, clean surface, film textures.
import { type Poly, type V, rrPoly } from './geom'
import { locale, peelSteelLabels, t } from './i18n'

export type Kind = 'phone' | 'steel' | 'remote'

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
  /** Film rect (film-local origin = its top-left), its corner radius and position relative to the object centre. */
  fw: number
  fh: number
  frad: number
  /** Unit F (film's shorter side) and tab size T. */
  F: number
  T: number
  /** Grab corner A (film-local), and the two edge directions leaving A (unit). */
  A: V
  e1: V
  e2: V
  /** Outward diagonal at the corner (unit, away from the film). */
  out: V
  /** Film polygon (40-gon) for area and clipping, and a dense one for outlines. */
  poly40: Poly
  polyDense: Poly
  filmArea: number
  /** Texture padding (css px) around the film rect inside the film textures. */
  pad: number
}

export function layoutFor(kind: Kind, w: number, h: number, dpr: number): Layout {
  let ow: number, oh: number, orad: number, fw: number, fh: number, frad: number
  let rot = 0
  if (kind === 'phone') {
    const PW = Math.min(0.74 * w, (0.74 * h * 9) / 19.5, 420)
    ow = PW
    oh = (PW * 19.5) / 9
    orad = 0.12 * PW
    const ins = 0.012 * PW
    fw = ow - 2 * ins
    fh = oh - 2 * ins
    frad = 0.11 * PW
  } else if (kind === 'steel') {
    const SW = Math.min(0.86 * w, 0.62 * h * 0.8, 520)
    ow = SW
    oh = SW * 1.25
    orad = 0.06 * SW
    const ins = 0.02 * SW
    fw = ow - 2 * ins
    fh = oh - 2 * ins
    frad = orad - ins
  } else {
    const RW = Math.min(0.3 * w, 0.72 * h * 0.24, 170)
    ow = RW
    oh = RW / 0.24
    orad = 0.2 * RW
    const mar = 0.06 * RW
    fw = ow + 2 * mar
    fh = oh + 2 * mar
    frad = orad + mar
    rot = (12 * Math.PI) / 180
  }
  const F = Math.min(fw, fh)
  const T = 0.11 * F
  // Tab corner: phone bottom right, steel top right, remote bottom left.
  let A: V, e1: V, e2: V
  if (kind === 'phone') {
    A = [fw, fh]
    e1 = [0, -1]
    e2 = [-1, 0]
  } else if (kind === 'steel') {
    A = [fw, 0]
    e1 = [0, 1]
    e2 = [-1, 0]
  } else {
    A = [0, fh]
    e1 = [0, -1]
    e2 = [1, 0]
  }
  const ox = -(e1[0] + e2[0])
  const oy = -(e1[1] + e2[1])
  const ol = Math.hypot(ox, oy)
  const poly40 = rrPoly(0, 0, fw, fh, frad, 9) // 4 corners x 10 points = 40-gon
  const polyDense = rrPoly(0, 0, fw, fh, frad, 24)
  let filmArea = 0
  {
    let a = 0
    for (let i = 0, j = poly40.length - 1; i < poly40.length; j = i++) a += (poly40[j][0] + poly40[i][0]) * (poly40[j][1] - poly40[i][1])
    filmArea = Math.abs(a) / 2
  }
  return {
    kind,
    w,
    h,
    dpr,
    cx: w / 2,
    cy: 0.5 * h,
    rot,
    ow,
    oh,
    orad,
    fw,
    fh,
    frad,
    F,
    T,
    A,
    e1,
    e2,
    out: [ox / ol, oy / ol],
    poly40,
    polyDense,
    filmArea,
    pad: Math.ceil(1.4 * T),
  }
}

/** Film-local -> css px transform as [a, b, c, d, e, f]. */
export function filmMatrix(L: Layout): [number, number, number, number, number, number] {
  const c = Math.cos(L.rot)
  const s = Math.sin(L.rot)
  const tx = -L.fw / 2
  const ty = -L.fh / 2
  return [c, s, -s, c, L.cx + c * tx - s * ty, L.cy + s * tx + c * ty]
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

function canvas(wpx: number, hpx: number): HTMLCanvasElement {
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

function drawNoise(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell: number, rnd: () => number, rgb: string, aMax: number) {
  const g = noiseLayer(w, h, cell, rnd, rgb, aMax)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // offset by half a cell so the grid's edge rows (which fade) stay outside
  ctx.drawImage(g, 0.5, 0.5, g.width - 1, g.height - 1, x - cell * 0.5, y - cell * 0.5, (g.width - 1) * cell, (g.height - 1) * cell)
  ctx.restore()
}

// ---------------------------------------------------------------------------------------------
// Base layer: tray (L0) and the object with its clean surface (L1), full screen at device pixels.
// ---------------------------------------------------------------------------------------------

function objectPath(ctx: CanvasRenderingContext2D | Path2D, L: Layout, grow = 0) {
  rrPath(ctx, -L.ow / 2 - grow, -L.oh / 2 - grow, L.ow + 2 * grow, L.oh + 2 * grow, L.orad + grow)
}

/** The recessed well: object shape plus 0.03 F, with two finger notches on the long sides (phone and steel). */
function wellPath(L: Layout): Path2D {
  const p = new Path2D()
  const g = 0.03 * L.F
  objectPath(p, L, g)
  if (L.kind !== 'remote') {
    const nr = 0.085 * L.F
    const x = L.ow / 2 + g
    p.moveTo(-x + nr, 0)
    p.arc(-x, 0, nr, 0, Math.PI * 2)
    p.moveTo(x + nr, 0)
    p.arc(x, 0, nr, 0, Math.PI * 2)
  }
  return p
}

function bakeTray(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) {
  const { w, h, dpr } = L
  // Pulp: warm base, a broad light from the upper left, fibres.
  ctx.fillStyle = '#ECE7DF'
  ctx.fillRect(0, 0, w, h)
  const lg = ctx.createRadialGradient(w * 0.18, h * 0.12, 0, w * 0.18, h * 0.12, Math.hypot(w, h) * 0.95)
  lg.addColorStop(0, 'rgba(255,253,248,0.55)')
  lg.addColorStop(0.55, 'rgba(255,253,248,0)')
  lg.addColorStop(1, 'rgba(120,100,80,0.10)')
  ctx.fillStyle = lg
  ctx.fillRect(0, 0, w, h)
  drawNoise(ctx, 0, 0, w, h, 70, rnd, '150,135,115', 0.07)
  drawNoise(ctx, 0, 0, w, h, 18, rnd, '255,255,255', 0.1)
  const fibres = Math.round(((w * h * dpr * dpr) / 1e6) * 6000)
  ctx.lineCap = 'round'
  for (let i = 0; i < fibres; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const l = (3 + rnd() * 6) / dpr
    const a = rnd() * Math.PI
    ctx.strokeStyle = rnd() < 0.5 ? 'rgba(217,210,198,0.35)' : 'rgba(247,244,238,0.35)'
    ctx.lineWidth = (0.6 + rnd() * 0.6) / dpr
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * l * 0.4, y + Math.sin(a) * l * 0.5 + (rnd() - 0.5) * l * 0.4, x + Math.cos(a) * l, y + Math.sin(a) * l)
    ctx.stroke()
  }
}

function bakeSofa(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) {
  const { w, h } = L
  ctx.fillStyle = '#AE9E89'
  ctx.fillRect(0, 0, w, h)
  // Weave: alternating 3 px threads in two directions.
  const s = 3
  for (let y = 0; y < h; y += s) {
    ctx.fillStyle = (y / s) % 2 ? 'rgba(185,169,148,0.55)' : 'rgba(163,147,128,0.55)'
    ctx.fillRect(0, y, w, s * 0.55)
  }
  for (let x = 0; x < w; x += s) {
    ctx.fillStyle = (x / s) % 2 ? 'rgba(163,147,128,0.35)' : 'rgba(185,169,148,0.35)'
    ctx.fillRect(x, 0, s * 0.5, h)
  }
  drawNoise(ctx, 0, 0, w, h, 40, rnd, '90,75,60', 0.12)
  drawNoise(ctx, 0, 0, w, h, 9, rnd, '255,250,240', 0.08)
  // The cushion dips where the remote lies, and a light from the upper left.
  const g = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, Math.max(w, h) * 0.7)
  g.addColorStop(0, 'rgba(70,55,40,0.12)')
  g.addColorStop(1, 'rgba(70,55,40,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const lg = ctx.createLinearGradient(0, 0, w, h)
  lg.addColorStop(0, 'rgba(255,248,235,0.22)')
  lg.addColorStop(1, 'rgba(40,30,20,0.18)')
  ctx.fillStyle = lg
  ctx.fillRect(0, 0, w, h)
}

function bakeWell(ctx: CanvasRenderingContext2D, L: Layout) {
  const F = L.F
  ctx.save()
  ctx.translate(L.cx, L.cy)
  ctx.rotate(L.rot)
  const well = wellPath(L)
  // Floor of the well: a touch darker than the tray surface.
  ctx.fillStyle = 'rgba(120,100,80,0.07)'
  ctx.fill(well)
  // Light lip on the lower-right edge (outside the well).
  ctx.save()
  ctx.translate(0.8, 0.9)
  ctx.strokeStyle = '#FAF7F2'
  ctx.lineWidth = 2
  ctx.stroke(well)
  ctx.restore()
  // Inner shadow along the upper-left edge.
  ctx.save()
  ctx.clip(well)
  // the tray minus the well (union of rect and notches), as an image whose alpha casts the inner shadow
  const inv = document.createElement('canvas')
  inv.width = Math.ceil(L.w * L.dpr)
  inv.height = Math.ceil(L.h * L.dpr)
  const ix = inv.getContext('2d')!
  ix.fillStyle = '#000'
  ix.fillRect(0, 0, inv.width, inv.height)
  ix.setTransform(L.dpr, 0, 0, L.dpr, 0, 0)
  ix.translate(L.cx, L.cy)
  ix.rotate(L.rot)
  ix.globalCompositeOperation = 'destination-out'
  ix.fill(well)
  ctx.shadowColor = 'rgba(90,75,60,0.28)'
  ctx.shadowBlur = 0.04 * F * L.dpr
  ctx.shadowOffsetX = 0.012 * F * L.dpr
  ctx.shadowOffsetY = 0.016 * F * L.dpr
  ctx.save()
  ctx.rotate(-L.rot)
  ctx.translate(-L.cx, -L.cy)
  ctx.drawImage(inv, 0, 0, L.w, L.h)
  ctx.restore()
  ctx.restore()
  // A thin dark crease on the upper-left inside edge.
  ctx.save()
  ctx.clip(well)
  ctx.translate(0.6, 0.7)
  ctx.strokeStyle = 'rgba(90,75,60,0.16)'
  ctx.lineWidth = 1.2
  ctx.stroke(well)
  ctx.restore()
  ctx.restore()
}

/** Object drop shadow: contact core plus a soft cast to the lower right. */
function bakeObjectShadow(ctx: CanvasRenderingContext2D, L: Layout) {
  const F = L.F
  ctx.save()
  ctx.translate(L.cx, L.cy)
  ctx.rotate(L.rot)
  const p = new Path2D()
  objectPath(p, L, -1)
  ctx.fillStyle = '#000'
  for (const [blur, ox, oy, a] of [
    [0.06 * F, 0.02 * F, 0.03 * F, 0.22],
    [0.012 * F, 0.004 * F, 0.006 * F, 0.35],
  ]) {
    ctx.save()
    ctx.shadowColor = `rgba(40,30,20,${a})`
    ctx.shadowBlur = blur * L.dpr
    // shadow offsets ignore the transform: they are screen-space device px (light is upper left)
    ctx.shadowOffsetX = ox * L.dpr
    ctx.shadowOffsetY = oy * L.dpr
    ctx.fill(p) // the object itself is painted over this fill
    ctx.restore()
  }
  ctx.restore()
}

// ------------------------------------- phone -------------------------------------

function phoneScreenRect(L: Layout) {
  const ins = 0.03 * L.ow
  return { x: -L.ow / 2 + ins, y: -L.oh / 2 + ins, w: L.ow - 2 * ins, h: L.oh - 2 * ins, r: 0.09 * L.ow }
}

function bakePhone(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) {
  const PW = L.ow
  ctx.save()
  ctx.translate(L.cx, L.cy)
  // Polished rim.
  const rim = ctx.createLinearGradient(-L.ow / 2, -L.oh / 2, L.ow / 2, L.oh / 2)
  rim.addColorStop(0, '#8E949C')
  rim.addColorStop(0.3, '#E6E9ED')
  rim.addColorStop(0.62, '#6E747C')
  rim.addColorStop(1, '#C9CED4')
  ctx.beginPath()
  objectPath(ctx, L)
  ctx.fillStyle = rim
  ctx.fill()
  // Body / bezel.
  const ri = 0.012 * PW
  ctx.beginPath()
  rrPath(ctx, -L.ow / 2 + ri, -L.oh / 2 + ri, L.ow - 2 * ri, L.oh - 2 * ri, L.orad - ri)
  ctx.fillStyle = '#1B1C20'
  ctx.fill()
  // Earpiece slit in the top bezel.
  ctx.fillStyle = '#2C2E35'
  ctx.beginPath()
  rrPath(ctx, -0.07 * PW, -L.oh / 2 + ri + 0.004 * PW, 0.14 * PW, 0.006 * PW, 0.003 * PW)
  ctx.fill()
  // Screen: lock-screen wallpaper.
  const S = phoneScreenRect(L)
  ctx.save()
  ctx.beginPath()
  rrPath(ctx, S.x, S.y, S.w, S.h, S.r)
  ctx.clip()
  const wg = ctx.createLinearGradient(0, S.y, 0, S.y + S.h)
  wg.addColorStop(0, '#0E1B3D')
  wg.addColorStop(0.52, '#3B1F5E')
  wg.addColorStop(1, '#E0567A')
  ctx.fillStyle = wg
  ctx.fillRect(S.x, S.y, S.w, S.h)
  const blob = (fx: number, fy: number, rr: number, col: string, a: number) => {
    const x = S.x + fx * S.w
    const y = S.y + fy * S.h
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr)
    g.addColorStop(0, `rgba(${col},${a})`)
    g.addColorStop(0.45, `rgba(${col},${a * 0.55})`)
    g.addColorStop(1, `rgba(${col},0)`)
    ctx.fillStyle = g
    ctx.fillRect(S.x, S.y, S.w, S.h)
  }
  ctx.globalCompositeOperation = 'screen'
  blob(0.18, 0.4, 0.5 * PW, '53,208,186', 0.5)
  blob(0.85, 0.56, 0.5 * PW, '123,108,246', 0.45)
  blob(0.36, 0.86, 0.5 * PW, '255,184,107', 0.4)
  blob(0.7, 0.22, 0.36 * PW, '53,208,186', 0.18)
  ctx.globalCompositeOperation = 'source-over'
  // Faint vertical aurora curtains.
  for (let i = 0; i < 14; i++) {
    const x = S.x + (0.05 + 0.9 * rnd()) * S.w
    const y0 = S.y + (0.25 + 0.2 * rnd()) * S.h
    const hh = (0.15 + 0.25 * rnd()) * S.h
    const g = ctx.createLinearGradient(0, y0, 0, y0 + hh)
    g.addColorStop(0, 'rgba(120,240,210,0)')
    g.addColorStop(0.5, `rgba(140,230,220,${0.05 + 0.05 * rnd()})`)
    g.addColorStop(1, 'rgba(120,240,210,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, y0, (0.01 + 0.03 * rnd()) * S.w, hh)
  }
  // Fine dither so the gradient does not band.
  drawNoise(ctx, S.x, S.y, S.w, S.h, 3, rnd, '255,255,255', 0.025)
  ctx.restore()
  // Punch-hole camera.
  const cy = S.y + 0.026 * S.h
  const cr = 0.016 * PW
  ctx.fillStyle = '#050507'
  ctx.beginPath()
  ctx.arc(0, cy, cr, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#2A2C33'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.strokeStyle = 'rgba(140,120,255,0.8)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(0, cy, cr * 0.45, Math.PI * 1.05, Math.PI * 1.45)
  ctx.stroke()
  // Glass reflections over the whole front.
  ctx.save()
  ctx.beginPath()
  rrPath(ctx, -L.ow / 2 + ri, -L.oh / 2 + ri, L.ow - 2 * ri, L.oh - 2 * ri, L.orad - ri)
  ctx.clip()
  const band = (off: number, width: number, a: number) => {
    // band perpendicular to the upper-left -> lower-right diagonal direction (-1, 1) rotated
    const dx = 0.62
    const dy = 0.78
    const c0 = -L.oh * 0.32 + off
    const g = ctx.createLinearGradient(c0 * dx, c0 * dy, (c0 + width) * dx, (c0 + width) * dy)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.3, `rgba(255,255,255,${a})`)
    g.addColorStop(0.7, `rgba(255,255,255,${a})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(-L.ow, -L.oh, L.ow * 2, L.oh * 2)
  }
  band(0, 0.35 * PW, 0.07)
  band(0.5 * PW, 0.12 * PW, 0.04)
  ctx.restore()
  ctx.restore()
}

/** Live parts of the phone screen (clock, date), drawn each frame between L1 and L3. */
export function drawPhoneLive(ctx: CanvasRenderingContext2D, L: Layout, date: Date, h24: boolean) {
  const S = phoneScreenRect(L)
  ctx.save()
  ctx.translate(L.cx, L.cy)
  const hh = date.getHours()
  const mm = String(date.getMinutes()).padStart(2, '0')
  const hs = h24 ? String(hh).padStart(2, '0') : String(hh % 12 || 12)
  const time = `${hs}:${mm}`
  let fs = 0.3 * L.ow
  ctx.font = `200 ${fs}px "SF Pro Display", "Helvetica Neue", system-ui, sans-serif`
  const wmax = 0.78 * S.w
  const tw = ctx.measureText(time).width
  if (tw > wmax) {
    fs *= wmax / tw
    ctx.font = `200 ${fs}px "SF Pro Display", "Helvetica Neue", system-ui, sans-serif`
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  const base = S.y + 0.22 * S.h + 0.36 * fs
  ctx.fillText(time, 0, base)
  const dfs = 0.05 * L.ow
  ctx.font = `400 ${dfs}px system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  const ds = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(date)
  ctx.fillText(ds, 0, base + 0.16 * fs + dfs)
  ctx.restore()
}

// ------------------------------------- steel -------------------------------------

function bakeSteel(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) {
  const SW = L.ow
  const SH = L.oh
  ctx.save()
  ctx.translate(L.cx, L.cy)
  ctx.save()
  ctx.beginPath()
  objectPath(ctx, L)
  ctx.clip()
  const base = ctx.createLinearGradient(0, -SH / 2, 0, SH / 2)
  base.addColorStop(0, '#C9CDD2')
  base.addColorStop(1, '#AEB3BA')
  ctx.fillStyle = base
  ctx.fillRect(-SW / 2, -SH / 2, SW, SH)
  // Brushed hairlines.
  const n = Math.round(((SW * SH * L.dpr * L.dpr) / 1e6) * 2200)
  for (let i = 0; i < n; i++) {
    const y = -SH / 2 + rnd() * SH
    const x = -SW / 2 + rnd() * SW - 40
    const l = 20 + rnd() * 180
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(124,130,138,0.10)'
    ctx.fillRect(x, y, l, 1 / L.dpr)
  }
  // Streaky density variation along x (brushing is never even).
  for (let i = 0; i < 60; i++) {
    const y = -SH / 2 + rnd() * SH
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(90,96,104,0.05)'
    ctx.fillRect(-SW / 2, y, SW, (0.5 + rnd() * 2.5) / L.dpr)
  }
  // Anisotropic highlight: a horizontal band at 30% height.
  const hy = -SH / 2 + 0.3 * SH
  const hb = ctx.createLinearGradient(0, hy - 0.125 * SH, 0, hy + 0.125 * SH)
  hb.addColorStop(0, 'rgba(255,255,255,0)')
  hb.addColorStop(0.5, 'rgba(255,255,255,0.28)')
  hb.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hb
  ctx.fillRect(-SW / 2, hy - 0.125 * SH, SW, 0.25 * SH)
  const hx = ctx.createLinearGradient(-SW / 2, 0, SW / 2, 0)
  hx.addColorStop(0, 'rgba(255,255,255,0.08)')
  hx.addColorStop(0.5, 'rgba(255,255,255,0)')
  hx.addColorStop(1, 'rgba(60,66,74,0.08)')
  ctx.fillStyle = hx
  ctx.fillRect(-SW / 2, -SH / 2, SW, SH)
  ctx.restore()
  // Bevelled edge.
  ctx.beginPath()
  objectPath(ctx, L, -0.5)
  const eg = ctx.createLinearGradient(-SW / 2, -SH / 2, SW / 2, SH / 2)
  eg.addColorStop(0, 'rgba(255,255,255,0.85)')
  eg.addColorStop(0.5, 'rgba(255,255,255,0.15)')
  eg.addColorStop(1, 'rgba(70,76,84,0.6)')
  ctx.strokeStyle = eg
  ctx.lineWidth = 1.5
  ctx.stroke()
  // Display window.
  const dw = 0.5 * SW
  const dh = 0.16 * SW
  const dy = -SH / 2 + 0.11 * SH
  ctx.beginPath()
  rrPath(ctx, -dw / 2, dy, dw, dh, 0.02 * SW)
  const dg = ctx.createLinearGradient(0, dy, 0, dy + dh)
  dg.addColorStop(0, '#0B0C0E')
  dg.addColorStop(1, '#16181C')
  ctx.fillStyle = dg
  ctx.fill()
  ctx.strokeStyle = 'rgba(40,42,46,0.9)'
  ctx.lineWidth = 1
  ctx.stroke()
  // Glass glint on the display.
  ctx.save()
  ctx.clip()
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.beginPath()
  ctx.moveTo(-dw / 2, dy)
  ctx.lineTo(-dw / 2 + dw * 0.45, dy)
  ctx.lineTo(-dw / 2 + dw * 0.25, dy + dh)
  ctx.lineTo(-dw / 2, dy + dh)
  ctx.fill()
  ctx.restore()
  // Buttons: 2 x 3 printed rings with icons and labels.
  const labels = peelSteelLabels()
  const bd = 0.09 * SW
  const gx = 0.26 * SW
  const y0 = -SH / 2 + 0.42 * SH
  const gy = 0.22 * SH
  for (let i = 0; i < 6; i++) {
    const cx = (i % 3 - 1) * gx
    const cy = y0 + Math.floor(i / 3) * gy
    ctx.strokeStyle = '#3A3D42'
    ctx.lineWidth = Math.max(1, 0.006 * SW)
    ctx.beginPath()
    ctx.arc(cx, cy, bd / 2, 0, Math.PI * 2)
    ctx.stroke()
    steelIcon(ctx, i, cx, cy, bd * 0.24)
    ctx.fillStyle = '#3A3D42'
    ctx.font = `500 ${0.034 * SW}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(labels[i] ?? '', cx, cy + bd / 2 + 0.022 * SW)
  }
  ctx.restore()
}

function steelIcon(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, s: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = '#3A3D42'
  ctx.lineWidth = Math.max(1, s * 0.16)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (i === 0) {
    // rice bowl
    ctx.moveTo(-s, -0.1 * s)
    ctx.lineTo(s, -0.1 * s)
    ctx.arc(0, -0.1 * s, s, 0, Math.PI)
    ctx.moveTo(-0.4 * s, 0.95 * s)
    ctx.lineTo(0.4 * s, 0.95 * s)
    ctx.moveTo(-0.55 * s, -0.1 * s)
    ctx.arc(0, -0.1 * s, 0.55 * s, Math.PI, 0)
  } else if (i === 1) {
    // steam: three waves
    for (const dx of [-0.6, 0, 0.6]) {
      ctx.moveTo(dx * s, s)
      ctx.bezierCurveTo((dx - 0.35) * s, 0.4 * s, (dx + 0.35) * s, -0.2 * s, dx * s, -s)
    }
  } else if (i === 2) {
    ctx.arc(0, 0, s, 0, Math.PI * 2)
    ctx.moveTo(0, -0.6 * s)
    ctx.lineTo(0, 0)
    ctx.lineTo(0.45 * s, 0.3 * s)
  } else if (i === 3) {
    ctx.moveTo(-0.8 * s, 0)
    ctx.lineTo(0.8 * s, 0)
    ctx.moveTo(0, -0.8 * s)
    ctx.lineTo(0, 0.8 * s)
  } else if (i === 4) {
    ctx.moveTo(-0.8 * s, 0)
    ctx.lineTo(0.8 * s, 0)
  } else {
    ctx.arc(0, 0.1 * s, 0.85 * s, -Math.PI * 0.32, Math.PI * 1.32)
    ctx.moveTo(0, -s)
    ctx.lineTo(0, 0)
  }
  ctx.stroke()
  ctx.restore()
}

/** Seven-segment "12:00", blinking colon (drawn each frame). */
export function drawSteelLive(ctx: CanvasRenderingContext2D, L: Layout, colonOn: boolean) {
  const SW = L.ow
  const SH = L.oh
  const dh = 0.16 * SW
  const dy = -SH / 2 + 0.11 * SH
  ctx.save()
  ctx.translate(L.cx, L.cy)
  const dh2 = dh * 0.56
  const dwid = dh2 * 0.52
  const th = dh2 * 0.12
  const gap = dwid * 0.42
  const total = 4 * dwid + 3 * gap + gap * 0.6
  let x = -total / 2
  const top = dy + (dh - dh2) / 2
  const SEG: Record<string, number[]> = { '1': [1, 2], '2': [0, 1, 6, 4, 3], '0': [0, 1, 2, 3, 4, 5] }
  const seg = (k: number, on: boolean, ox: number) => {
    const w2 = dwid
    const h2 = dh2 / 2
    const sk = th * 0.5
    const pts: [number, number, number, number][] = [
      [sk, 0, w2 - sk, 0], // a
      [w2, sk, w2, h2 - sk], // b
      [w2, h2 + sk, w2, dh2 - sk], // c
      [sk, dh2, w2 - sk, dh2], // d
      [0, h2 + sk, 0, dh2 - sk], // e
      [0, sk, 0, h2 - sk], // f
      [sk, h2, w2 - sk, h2], // g
    ]
    const [x1, y1, x2, y2] = pts[k]
    ctx.strokeStyle = on ? '#FFB23E' : 'rgba(255,178,62,0.07)'
    ctx.lineWidth = th
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(ox + x1 - (y1 / dh2) * th * 0.6, top + y1)
    ctx.lineTo(ox + x2 - (y2 / dh2) * th * 0.6, top + y2)
    ctx.stroke()
  }
  ctx.save()
  ctx.shadowColor = 'rgba(255,160,40,0.55)'
  ctx.shadowBlur = 0.25 * th * L.dpr
  for (const [i, ch] of ['1', '2', ':', '0', '0'].entries()) {
    if (ch === ':') {
      ctx.fillStyle = colonOn ? '#FFB23E' : 'rgba(255,178,62,0.07)'
      for (const fy of [0.3, 0.7]) {
        ctx.beginPath()
        ctx.arc(x + gap * 0.3, top + fy * dh2, th * 0.55, 0, Math.PI * 2)
        ctx.fill()
      }
      x += gap * 0.6 + gap
      continue
    }
    for (let k = 0; k < 7; k++) seg(k, SEG[ch].includes(k), x)
    x += dwid + (i < 4 ? gap : 0)
  }
  ctx.restore()
  ctx.restore()
}

// ------------------------------------- remote -------------------------------------

function bakeRemote(ctx: CanvasRenderingContext2D, L: Layout) {
  const RW = L.ow
  const RH = L.oh
  ctx.save()
  ctx.translate(L.cx, L.cy)
  ctx.rotate(L.rot)
  ctx.beginPath()
  objectPath(ctx, L)
  ctx.fillStyle = '#22242A'
  ctx.fill()
  // Soft bevel: light upper-left edge, dark lower-right edge.
  ctx.save()
  ctx.clip()
  ctx.lineWidth = 0.08 * RW
  ctx.strokeStyle = '#34373F'
  ctx.translate(-0.02 * RW, -0.02 * RW)
  ctx.beginPath()
  objectPath(ctx, L)
  ctx.stroke()
  ctx.translate(0.04 * RW, 0.04 * RW)
  ctx.strokeStyle = '#14151A'
  ctx.beginPath()
  objectPath(ctx, L)
  ctx.stroke()
  ctx.restore()
  ctx.beginPath()
  rrPath(ctx, -RW / 2 + 0.045 * RW, -RH / 2 + 0.045 * RW, RW - 0.09 * RW, RH - 0.09 * RW, L.orad * 0.8)
  ctx.fillStyle = '#22242A'
  ctx.fill()
  const btn = (x: number, y: number, w: number, h: number, r: number, col: string) => {
    ctx.beginPath()
    rrPath(ctx, x - w / 2, y - h / 2, w, h, r)
    ctx.fillStyle = col
    ctx.fill()
    const g = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2)
    g.addColorStop(0, 'rgba(255,255,255,0.22)')
    g.addColorStop(0.5, 'rgba(255,255,255,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.25)')
    ctx.fillStyle = g
    ctx.fill()
  }
  let y = -RH / 2 + 0.12 * RH
  btn(0.22 * RW, y - 0.03 * RH, 0.2 * RW, 0.2 * RW, 0.1 * RW, '#C8352E') // power
  // d-pad
  y = -RH / 2 + 0.33 * RH
  ctx.beginPath()
  ctx.arc(0, y, 0.34 * RW, 0, Math.PI * 2)
  ctx.fillStyle = '#3A3D45'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, y, 0.34 * RW, Math.PI * 0.9, Math.PI * 1.6)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1.2
  ctx.stroke()
  btn(0, y, 0.24 * RW, 0.24 * RW, 0.12 * RW, '#2B2D34')
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  for (const a of [0, 1, 2, 3]) {
    const ang = (a * Math.PI) / 2
    const px = Math.cos(ang) * 0.25 * RW
    const py = y + Math.sin(ang) * 0.25 * RW
    ctx.beginPath()
    ctx.moveTo(px + Math.cos(ang) * 0.04 * RW, py + Math.sin(ang) * 0.04 * RW)
    ctx.lineTo(px + Math.cos(ang + 2.3) * 0.03 * RW, py + Math.sin(ang + 2.3) * 0.03 * RW)
    ctx.lineTo(px + Math.cos(ang - 2.3) * 0.03 * RW, py + Math.sin(ang - 2.3) * 0.03 * RW)
    ctx.fill()
  }
  // rockers
  y = -RH / 2 + 0.52 * RH
  for (const sx of [-1, 1]) {
    btn(sx * 0.24 * RW, y, 0.2 * RW, 0.13 * RH, 0.1 * RW, '#3A3D45')
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.font = `600 ${0.11 * RW}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('+', sx * 0.24 * RW, y - 0.04 * RH)
    ctx.fillText('−', sx * 0.24 * RW, y + 0.04 * RH)
  }
  ctx.font = `600 ${0.07 * RW}px system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillText('VOL', -0.24 * RW, y + 0.085 * RH)
  ctx.fillText('CH', 0.24 * RW, y + 0.085 * RH)
  // 3 x 4 number pad
  const y0 = -RH / 2 + 0.66 * RH
  for (let i = 0; i < 12; i++) {
    const bx = ((i % 3) - 1) * 0.26 * RW
    const by = y0 + Math.floor(i / 3) * 0.075 * RH
    btn(bx, by, 0.2 * RW, 0.12 * RW, 0.06 * RW, '#3A3D45')
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = `600 ${0.075 * RW}px system-ui, sans-serif`
    ctx.fillText(['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', ''][i], bx, by + 0.004 * RW)
  }
  ctx.restore()
}

// ------------------------------------- film textures -------------------------------------

export interface FilmTex {
  front: HTMLCanvasElement
  back: HTMLCanvasElement
  /** css px per texture px is 1 / dpr; film-local (0, 0) sits at (pad, pad) css px. */
  pad: number
}

function filmBase(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number, back: boolean) {
  const { fw, fh, frad, F, kind } = L
  ctx.save()
  ctx.beginPath()
  rrPath(ctx, 0, 0, fw, fh, frad)
  ctx.clip()
  // Tint.
  ctx.fillStyle = kind === 'steel' ? 'rgba(58,141,222,0.30)' : kind === 'remote' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.10)'
  ctx.fillRect(0, 0, fw, fh)
  // Haze.
  drawNoise(ctx, 0, 0, fw, fh, 90, rnd, '255,255,255', 0.06)
  drawNoise(ctx, 0, 0, fw, fh, 26, rnd, '255,255,255', 0.025)
  if (kind === 'remote') {
    ctx.fillStyle = 'rgba(217,194,122,0.10)'
    ctx.fillRect(0, 0, fw, fh)
    drawNoise(ctx, 0, 0, fw, fh, 50, rnd, '200,170,90', 0.08)
  }
  // Glare (front only: on the lifted flap the reflections are its own).
  if (!back) {
    const band = (c: number, wdt: number, a: number) => {
      const dx = 0.55
      const dy = 0.83
      const g = ctx.createLinearGradient(c * dx, c * dy, (c + wdt) * dx, (c + wdt) * dy)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.5, `rgba(255,255,255,${a})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, fw, fh)
    }
    if (kind === 'phone') {
      band(0.05 * fh, 0.42 * fw, 0.16)
      band(0.52 * fh, 0.3 * fw, 0.1)
    } else if (kind === 'steel') {
      band(0.12 * fh, 0.5 * fw, 0.2)
    } else {
      // crinkle glare: short bright creases of loose wrap
      ctx.lineCap = 'round'
      for (let i = 0; i < 40; i++) {
        const x = rnd() * fw
        const y = rnd() * fh
        const l = 10 + rnd() * 30
        const a = rnd() * Math.PI
        // a soft sheen beside a bright, slightly curved crease, fading at both ends
        const ex = x + Math.cos(a) * l
        const ey = y + Math.sin(a) * l
        const g = ctx.createLinearGradient(x, y, ex, ey)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(0.5, 'rgba(255,255,255,0.35)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * 5, y + Math.sin(a) * l * 0.5 + (rnd() - 0.5) * 5, ex, ey)
        ctx.strokeStyle = g
        ctx.lineWidth = 0.8
        ctx.stroke()
        ctx.globalAlpha = 0.18
        ctx.lineWidth = 3.5
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
  }
  // Micro-scratches.
  const ns = kind === 'phone' ? 30 : kind === 'steel' ? 20 : 60
  ctx.lineCap = 'round'
  for (let i = 0; i < ns; i++) {
    const x = rnd() * fw
    const y = rnd() * fh
    const l = 6 + rnd() * 0.12 * F
    const a = rnd() * Math.PI
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a + 0.2) * l * 0.5, y + Math.sin(a + 0.2) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l)
    ctx.stroke()
  }
  if (kind === 'remote') {
    // greasy fingerprints: radial whorls
    for (let i = 0; i < 8; i++) {
      const x = (0.15 + 0.7 * rnd()) * fw
      const y = (0.1 + 0.8 * rnd()) * fh
      const rr = 0.09 * F + rnd() * 0.05 * F
      const a = rnd() * Math.PI
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(a)
      ctx.scale(1, 0.75)
      for (let k = 2; k < 9; k++) {
        ctx.strokeStyle = `rgba(255,250,230,${0.07})`
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.ellipse(0, 0, (rr * k) / 9, (rr * k) / 9.6, 0, rnd() * 0.6, Math.PI * 2 - rnd() * 0.8)
        ctx.stroke()
      }
      ctx.restore()
    }
  }
  // Dust under the film.
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.arc(rnd() * fw, rnd() * fh, 0.5 + rnd() * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }
  // Print.
  ctx.globalAlpha = back ? 0.6 : 1
  if (kind === 'phone') printPhone(ctx, L)
  else if (kind === 'steel') printSteel(ctx, L)
  ctx.globalAlpha = 1
  ctx.restore()
  // Edges.
  ctx.save()
  ctx.beginPath()
  rrPath(ctx, 0.5, 0.5, fw - 1, fh - 1, frad - 0.5)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()
  if (kind === 'remote') {
    // welded seam in the margin beyond the object
    const m = 0.06 * L.ow
    ctx.beginPath()
    rrPath(ctx, m * 0.45, m * 0.45, fw - m * 0.9, fh - m * 0.9, frad - m * 0.45)
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 2
    ctx.setLineDash([3, 1.5])
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (!back) {
    // 1 px dark line just outside, on the lower-right sides
    ctx.beginPath()
    rrPath(ctx, -0.5, -0.5, fw + 1, fh + 1, frad + 0.5)
    ctx.save()
    ctx.clip(rectHalf(fw, fh))
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }
  ctx.restore()
}

/** Region below/right of the anti-diagonal through the film's centre: the "lower-right sides". */
function rectHalf(fw: number, fh: number): Path2D {
  const p = new Path2D()
  p.moveTo(fw + 10, -10)
  p.lineTo(fw + 10, fh + 10)
  p.lineTo(-10, fh + 10)
  p.closePath()
  return p
}

function printPhone(ctx: CanvasRenderingContext2D, L: Layout) {
  const { fw, fh, F } = L
  const ink = 'rgba(92,96,104,0.75)'
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = Math.max(0.9, 0.0045 * F)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const ins = 0.03 * L.ow - 0.012 * L.ow
  const sy = ins // screen top in film-local
  const sh = fh - 2 * ins
  // Camera callout: icon to the left, leader line to the punch hole.
  const camY = sy + 0.026 * sh
  const ix = fw / 2 - 0.26 * F
  const iy = sy + 0.075 * sh
  const s = 0.045 * F
  ctx.beginPath()
  rrPath(ctx, ix - s, iy - s * 0.7, 2 * s, 1.4 * s, s * 0.3)
  ctx.moveTo(ix + s * 0.42, iy)
  ctx.arc(ix, iy, s * 0.42, 0, Math.PI * 2)
  ctx.moveTo(ix - s * 0.4, iy - s * 0.7)
  ctx.lineTo(ix - s * 0.2, iy - s * 0.95)
  ctx.lineTo(ix + s * 0.2, iy - s * 0.95)
  ctx.lineTo(ix + s * 0.4, iy - s * 0.7)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(ix + s * 1.2, iy)
  ctx.lineTo(fw / 2 - 0.06 * F, iy)
  ctx.lineTo(fw / 2 - 0.022 * F, camY + 0.012 * F)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(fw / 2, camY, 0.03 * F, 0, Math.PI * 2)
  ctx.setLineDash([2, 2])
  ctx.stroke()
  ctx.setLineDash([])
  // Fingerprint ring at 78% height with a whorl and a leader to a label block.
  const fy = sy + 0.78 * sh
  const fr = 0.075 * F
  ctx.beginPath()
  ctx.arc(fw / 2, fy, fr, 0, Math.PI * 2)
  ctx.setLineDash([3, 2.5])
  ctx.stroke()
  ctx.setLineDash([])
  for (let k = 1; k <= 4; k++) {
    ctx.beginPath()
    ctx.ellipse(fw / 2, fy + fr * 0.1, fr * 0.16 * k, fr * 0.2 * k, 0, Math.PI * (1.08 + k * 0.03), Math.PI * (1.92 - k * 0.02) + (k > 2 ? 0.9 : 0.4))
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(fw / 2 + fr * 1.05, fy)
  ctx.lineTo(fw / 2 + 0.24 * F, fy)
  ctx.lineTo(fw / 2 + 0.27 * F, fy - 0.03 * F)
  ctx.stroke()
  // a small circled-touch glyph at the end of the leader
  ctx.beginPath()
  ctx.arc(fw / 2 + 0.3 * F, fy - 0.03 * F, 0.025 * F, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(fw / 2 + 0.3 * F, fy - 0.03 * F, 0.009 * F, 0, Math.PI * 2)
  ctx.fill()
  // Charging symbol at the bottom edge with a leader down to the port.
  const cy = fh - 0.07 * F
  const b = 0.03 * F
  ctx.beginPath()
  ctx.moveTo(fw / 2 + b * 0.2, cy - b * 1.2)
  ctx.lineTo(fw / 2 - b * 0.55, cy + b * 0.1)
  ctx.lineTo(fw / 2 + b * 0.05, cy + b * 0.1)
  ctx.lineTo(fw / 2 - b * 0.2, cy + b * 1.2)
  ctx.lineTo(fw / 2 + b * 0.55, cy - b * 0.1)
  ctx.lineTo(fw / 2 - b * 0.05, cy - b * 0.1)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  rrPath(ctx, fw / 2 - b * 1.4, cy - b * 1.7, b * 2.8, b * 3.4, b * 0.6)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(fw / 2, cy + b * 1.7)
  ctx.lineTo(fw / 2, fh - 0.006 * F)
  ctx.stroke()
  // "① →" beside the tab (bottom right).
  ctx.font = `600 ${0.06 * F}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const tx = fw - 0.3 * F
  const ty = fh - 0.1 * F
  ctx.beginPath()
  ctx.arc(tx, ty, 0.035 * F, 0, Math.PI * 2)
  ctx.stroke()
  ctx.font = `600 ${0.045 * F}px system-ui, sans-serif`
  ctx.fillText('1', tx, ty + 0.002 * F)
  ctx.beginPath()
  ctx.moveTo(tx + 0.06 * F, ty)
  ctx.lineTo(tx + 0.15 * F, ty)
  ctx.moveTo(tx + 0.12 * F, ty - 0.025 * F)
  ctx.lineTo(tx + 0.15 * F, ty)
  ctx.lineTo(tx + 0.12 * F, ty + 0.025 * F)
  ctx.stroke()
  // Thin guide bars (instruction rows, language-free) near the camera callout.
  for (let i = 0; i < 2; i++) {
    ctx.fillRect(ix - s, iy + s * 1.3 + i * 0.022 * F, (i ? 0.1 : 0.16) * F, 0.006 * F)
  }
}

function printSteel(ctx: CanvasRenderingContext2D, L: Layout) {
  const { fw, fh, F } = L
  const ink = 'rgba(31,95,168,0.8)'
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.save()
  ctx.translate(fw / 2, fh / 2)
  ctx.rotate(-Math.PI / 6)
  const txt = t('peel_remove')
  const fs = 0.04 * F
  ctx.font = `700 ${fs}px system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const unit = ctx.measureText(txt).width + 0.12 * F
  const rowH = 0.11 * F
  const span = Math.hypot(fw, fh)
  let row = 0
  for (let y = -span / 2; y < span / 2; y += rowH, row++) {
    const off = (row % 2) * unit * 0.5
    for (let x = -span / 2 - unit + off; x < span / 2; x += unit) {
      if (row % 2 === 0) {
        ctx.fillText(txt, x, y)
      } else {
        // small arrows row
        for (let k = 0; k < 5; k++) {
          const ax = x + k * (unit / 5)
          ctx.lineWidth = Math.max(1, 0.006 * F)
          ctx.beginPath()
          ctx.moveTo(ax, y)
          ctx.lineTo(ax + 0.05 * F, y)
          ctx.moveTo(ax + 0.032 * F, y - 0.016 * F)
          ctx.lineTo(ax + 0.05 * F, y)
          ctx.lineTo(ax + 0.032 * F, y + 0.016 * F)
          ctx.stroke()
        }
      }
    }
  }
  ctx.restore()
}

export interface Bakes {
  base: HTMLCanvasElement
  film: FilmTex
  bubbles: Bubble[]
}

export function bake(L: Layout, seed: number): Bakes {
  const rnd = rng(seed * 7919 + (L.kind === 'phone' ? 11 : L.kind === 'steel' ? 23 : 37))
  const { w, h, dpr } = L
  const base = canvas(w * dpr, h * dpr)
  const bx = base.getContext('2d')!
  bx.scale(dpr, dpr)
  if (L.kind === 'remote') bakeSofa(bx, L, rnd)
  else bakeTray(bx, L, rnd)
  if (L.kind !== 'remote') bakeWell(bx, L)
  bakeObjectShadow(bx, L)
  if (L.kind === 'phone') bakePhone(bx, L, rnd)
  else if (L.kind === 'steel') bakeSteel(bx, L, rnd)
  else bakeRemote(bx, L)

  const pad = L.pad
  const mk = (back: boolean) => {
    const c = canvas((L.fw + 2 * pad) * dpr, (L.fh + 2 * pad) * dpr)
    const x = c.getContext('2d')!
    x.scale(dpr, dpr)
    x.translate(pad, pad)
    filmBase(x, L, rng(seed * 31 + 5), back)
    return c
  }
  const film = { front: mk(false), back: mk(true), pad }

  // Factory bubbles: 5 to 9, stratified along the pull so a few always sit in the far part.
  const bubbles: Bubble[] = []
  const nb = 5 + Math.floor(rnd() * 5)
  for (let i = 0; i < nb; i++) {
    // place along the diagonal from the tab corner (0) to the far corner (1)
    const along = i < 2 ? 0.8 + rnd() * 0.12 : 0.12 + rnd() * 0.66
    const side = (rnd() - 0.5) * 0.7
    const far: V = [L.fw - L.A[0], L.fh - L.A[1]]
    const px = L.A[0] + (far[0] - L.A[0]) * along
    const py = L.A[1] + (far[1] - L.A[1]) * along
    const nx = -(far[1] - L.A[1])
    const ny = far[0] - L.A[0]
    const nl = Math.hypot(nx, ny)
    const reach = Math.min(L.fw, L.fh) * 0.5
    const s = 0.02 * L.F + rnd() * 0.04 * L.F
    bubbles.push({
      p: [clampN(px + (nx / nl) * side * reach, 0.08 * L.F, L.fw - 0.08 * L.F), clampN(py + (ny / nl) * side * reach, 0.08 * L.F, L.fh - 0.08 * L.F)],
      rx: s * 0.5,
      ry: s * (0.32 + rnd() * 0.15),
      a: rnd() * Math.PI,
      big: false,
    })
  }
  return { base, film, bubbles }
}

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
