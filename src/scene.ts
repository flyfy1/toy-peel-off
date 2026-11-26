// Layout and the per-object bakes (spec 3.1, 3.3, 3.4): tray, clean surface, film textures. What differs per
// object comes from its ObjDef (objects.ts); this file holds the generic parts.
import { type V, rrPoly } from './geom'
import { type Bubble, type Kind, type Layout, canvas, drawNoise, objectPath, rng, rrPath } from './kit'
import { def } from './objects'

export { rng, rrPath }
export type { Bubble, Kind, Layout }

const CORNERS = {
  br: { A: (fw: number, fh: number): V => [fw, fh], e1: [0, -1] as V, e2: [-1, 0] as V },
  tr: { A: (fw: number): V => [fw, 0], e1: [0, 1] as V, e2: [-1, 0] as V },
  bl: { A: (_fw: number, fh: number): V => [0, fh], e1: [0, -1] as V, e2: [1, 0] as V },
  tl: { A: (): V => [0, 0], e1: [0, 1] as V, e2: [1, 0] as V },
}

export function layoutFor(kind: Kind, w: number, h: number, dpr: number, layer2 = false): Layout {
  const D = def(kind)
  const { ow, oh, orad, rot, cy } = D.size(w, h)
  const f = D.film(ow, oh, orad)
  const { fw, fh, frad } = f
  const sx0 = f.sx0 ?? 0
  const F = Math.min(fw, fh)
  const T = D.tMin ? Math.max(0.11 * F, D.tMin) : 0.11 * F
  // Tab corner from the table; the phone's second layer has its tab top left.
  const C = CORNERS[layer2 ? 'tl' : D.corner]
  const A = C.A(fw, fh)
  const e1 = C.e1
  const e2 = C.e2
  const ox = -(e1[0] + e2[0])
  const oy = -(e1[1] + e2[1])
  const ol = Math.hypot(ox, oy)
  const poly40 = rrPoly(sx0, 0, fw - sx0, fh, frad, 9) // 4 corners x 10 points = 40-gon
  const polyDense = rrPoly(sx0, 0, fw - sx0, fh, frad, 24)
  let filmArea = 0
  {
    let a = 0
    for (let i = 0, j = poly40.length - 1; i < poly40.length; j = i++) a += (poly40[j][0] + poly40[i][0]) * (poly40[j][1] - poly40[i][1])
    filmArea = Math.abs(a) / 2
  }
  const round = !!D.round
  return {
    kind,
    layer2,
    w,
    h,
    dpr,
    cx: w / 2,
    cy: cy ?? 0.5 * h,
    rot,
    ow,
    oh,
    orad,
    fw,
    fh,
    frad,
    fx: f.fx ?? 0,
    fy: f.fy ?? 0,
    sx0,
    round,
    m0: round ? frad * (Math.SQRT2 - 1) : 0,
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
  const tx = L.fx - L.fw / 2
  const ty = L.fy - L.fh / 2
  return [c, s, -s, c, L.cx + c * tx - s * ty, L.cy + s * tx + c * ty]
}

/** The recessed well: object shape plus 0.03 F, with two finger notches on the long sides (phone and steel). */
function wellPath(L: Layout): Path2D {
  const p = new Path2D()
  const g = 0.03 * L.F
  objectPath(p, L, g)
  {
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

// ------------------------------------- film textures -------------------------------------

export interface FilmTex {
  front: HTMLCanvasElement
  back: HTMLCanvasElement
  /** css px per texture px is 1 / dpr; film-local (0, 0) sits at (pad, pad) css px. */
  pad: number
}

function filmBase(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number, back: boolean) {
  const { fw, fh, frad, F } = L
  const D = def(L.kind)
  ctx.save()
  ctx.beginPath()
  rrPath(ctx, 0, 0, fw, fh, frad)
  ctx.clip()
  // Tint.
  ctx.fillStyle = L.layer2 ? 'rgba(255,255,255,0.05)' : D.tint
  ctx.fillRect(0, 0, fw, fh)
  // Haze.
  drawNoise(ctx, 0, 0, fw, fh, 90, rnd, '255,255,255', L.layer2 ? 0.03 : D.haze)
  if (!L.layer2) drawNoise(ctx, 0, 0, fw, fh, 26, rnd, '255,255,255', 0.025)
  if (D.aged) {
    ctx.fillStyle = D.aged === true ? 'rgba(217,194,122,0.10)' : `rgba(217,194,122,${D.aged})`
    ctx.fillRect(0, 0, fw, fh)
    drawNoise(ctx, 0, 0, fw, fh, 50, rnd, '200,170,90', 0.08)
  }
  // Glare (front only: on the lifted flap the reflections are its own).
  if (!back && !L.layer2) {
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
    if (typeof D.glare === 'function') D.glare(ctx, L, band)
    else if (D.glare === 'bands2') {
      band(0.05 * fh, 0.42 * fw, 0.16)
      band(0.52 * fh, 0.3 * fw, 0.1)
    } else if (D.glare === 'band1') {
      band(0.12 * fh, 0.5 * fw, 0.2)
    } else {
      // crinkle glare: short bright creases of loose wrap
      ctx.lineCap = 'round'
      for (let i = 0, n = D.crinkles ?? 40; i < n; i++) {
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
  const ns = L.layer2 ? 8 : D.scratches
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
  if (D.smudge) {
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
  D.print?.(ctx, L)
  ctx.globalAlpha = 1
  ctx.restore()
  // Edges.
  ctx.save()
  ctx.beginPath()
  rrPath(ctx, 0.5, 0.5, fw - 1, fh - 1, frad - 0.5)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()
  if (D.seam) {
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

export interface Bakes {
  base: HTMLCanvasElement
  film: FilmTex
  bubbles: Bubble[]
}

export function bake(L: Layout, seed: number): Bakes {
  const rnd = rng(seed * 7919 + def(L.kind).salt)
  const base = bakeBase(L, rnd)
  return { base, ...bakeFilm(L, seed, rnd) }
}

function bakeBase(L: Layout, rnd: () => number): HTMLCanvasElement {
  const { w, h, dpr } = L
  const base = canvas(w * dpr, h * dpr)
  const bx = base.getContext('2d')!
  bx.scale(dpr, dpr)
  const D = def(L.kind)
  if (D.ground === 'sofa') bakeSofa(bx, L, rnd)
  else if (D.ground === 'tray') bakeTray(bx, L, rnd)
  else D.ground(bx, L, rnd)
  if (D.well) bakeWell(bx, L)
  bakeObjectShadow(bx, L)
  D.bakeBase(bx, L, rnd)
  return base
}

/** Film textures and factory bubbles only (the second layer reuses the object's base). */
export function bakeFilm(L: Layout, seed: number, rnd = rng(seed * 104729 + 7)): { film: FilmTex; bubbles: Bubble[] } {
  const dpr = L.dpr
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
  if (L.layer2) return { film, bubbles: [] }

  // Factory bubbles (5 to 9 on the first three), stratified along the pull so a few always sit in the far part.
  const bb = def(L.kind).bubbles
  if (typeof bb === 'function') return { film, bubbles: bb(L, rnd) }
  const bubbles: Bubble[] = []
  const nb = bb[0] + Math.floor(rnd() * (bb[1] - bb[0] + 1))
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
    const s = bb[2] * L.F + rnd() * bb[3] * L.F
    bubbles.push({
      p: [clampN(px + (nx / nl) * side * reach, 0.08 * L.F, L.fw - 0.08 * L.F), clampN(py + (ny / nl) * side * reach, 0.08 * L.F, L.fh - 0.08 * L.F)],
      rx: s * 0.5,
      ry: s * (0.32 + rnd() * 0.15),
      a: rnd() * Math.PI,
      big: false,
    })
  }
  return { film, bubbles }
}

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
