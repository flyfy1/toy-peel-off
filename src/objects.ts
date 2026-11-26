// The object table (peel-more.md section 2): everything that differs between the things to peel lives in one
// ObjDef per object. The three built-in objects are here; the newer ones arrive in objects2.ts (loaded after
// the first peel) and register themselves with `register`.
import { type Bubble, type Kind, type Layout, KINDS, drawNoise, objectPath, rrPath } from './kit'
import { list, locale, t } from './i18n'

export type Corner = 'br' | 'tr' | 'bl' | 'tl'
/** yellow: printed pull tab; white-arrow: white tab, blue arrow; dogear: no tab, a lifted corner; clear: clear tab with a red dot. */
export type TabStyle = 'yellow' | 'white-arrow' | 'dogear' | 'clear'
export type Glare = 'bands2' | 'band1' | 'crinkle' | ((ctx: CanvasRenderingContext2D, L: Layout, band: (c: number, w: number, a: number) => void) => void)

export interface Sound {
  /** Pitch multiplier on the stick-slip tick, gain multiplier, crinkle (the remote's second high burst), ticks per second at most. */
  pitch: number
  gain: number
  crinkle: number
  rateCap: number
}

export interface Stall {
  /** Peeled fraction where the front stops, how long it holds, the flap stretch, the sliver width (in F). */
  at: number
  ms: number
  stretch: number
  sliver: number
}

/** What a live layer gets each frame. */
export interface LiveState {
  date: Date
  /** A dev still: no blinking, 24 h clock. */
  frozen: boolean
  /** Seconds since the gleam began (-1 before the film is off). */
  gleam: number
  /** The film is still on. */
  on: boolean
  /** performance.now() in ms. */
  ms: number
}

export interface ObjDef {
  /** Index in KINDS: seeds the bake (the old rotation index for the first three). */
  ix: number
  /** RNG salt for the bake. */
  salt: number
  size(w: number, h: number): { ow: number; oh: number; orad: number; rot: number; cy?: number }
  film(ow: number, oh: number, orad: number): { fw: number; fh: number; frad: number; fx?: number; fy?: number; sx0?: number }
  corner: Corner
  tab: TabStyle
  /** Floor for T in css px. */
  tMin: number
  round?: boolean
  /** Film tint, the rolled film's tint, the wad's tint (rgb) and alpha. */
  tint: string
  flapTint: string
  wadTint: string
  wadA: number
  haze: number
  /** The remote's yellowed wrap: a yellow cast and a blotchy yellow noise. */
  aged?: boolean
  glare: Glare
  scratches: number
  /** Greasy fingerprints on the film (the remote). */
  smudge?: boolean
  /** A welded seam in the margin (the remote's wrap). */
  seam?: boolean
  print?: (ctx: CanvasRenderingContext2D, L: Layout) => void
  /** Factory bubbles: [min, max, size min, size span] in F, or a function placing them. */
  bubbles: [number, number, number, number] | ((L: Layout, rnd: () => number) => Bubble[])
  /** Bubble rim (rgb) and its alpha. */
  rim: [string, number]
  adhesion: number
  curl: number
  sound: Sound
  /** Adhesive bloom on the uncovered side (steel). */
  bloom?: boolean
  stall?: Stall
  /** Ground under the object; `well` adds the recessed tray well (with finger notches). */
  ground: 'tray' | 'sofa' | ((ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) => void)
  well: boolean
  /** Hit-test against the film rect instead of the object (the remote's wrap is larger). */
  hitFilm?: boolean
  bakeBase(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number): void
  /** Animated parts of the clean object (clock, display), drawn each frame under the film. */
  live?(ctx: CanvasRenderingContext2D, L: Layout, s: LiveState): void
  /** Drawn above the film and the flap (the microwave's trim). */
  over?(ctx: CanvasRenderingContext2D, L: Layout): void
  /** A chat bubble from someone with opinions about the film: sender, at 15%, on fall-back, when off; GA event name. */
  chat?: { who: string; warn: string; good: string; done?: string; ga: string }
  /** The detached film stays a small stiff disc instead of a wad (the watch). */
  disc?: boolean
}

export const OBJ: Partial<Record<Kind, ObjDef>> = {}
export const register = (defs: Partial<Record<Kind, ObjDef>>) => Object.assign(OBJ, defs)
export const def = (k: Kind) => OBJ[k]!
export const isKind = (s: string | null): s is Kind => !!s && (KINDS as readonly string[]).includes(s)

export function uses24h(): boolean {
  try {
    const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle
    return hc === 'h23' || hc === 'h24'
  } catch {
    return true
  }
}

const STD: Sound = { pitch: 1, gain: 1, crinkle: 0, rateCap: 120 }

register({
  phone: {
    ix: 0,
    salt: 11,
    size(w, h) {
      const PW = Math.min(0.74 * w, (0.74 * h * 9) / 19.5, 420)
      return { ow: PW, oh: (PW * 19.5) / 9, orad: 0.12 * PW, rot: 0 }
    },
    film(ow, oh) {
      const PW = ow
      const ins = 0.012 * PW
      return { fw: ow - 2 * ins, fh: oh - 2 * ins, frad: 0.11 * PW }
    },
    corner: 'br',
    tab: 'yellow',
    tMin: 0,
    tint: 'rgba(255,255,255,0.10)',
    flapTint: 'rgba(225,232,245,0.20)',
    wadTint: '235,240,250',
    wadA: 0.3,
    haze: 0.06,
    glare: 'bands2',
    scratches: 30,
    print: (ctx, L) => !L.layer2 && printPhone(ctx, L),
    bubbles: [5, 9, 0.02, 0.04],
    rim: ['0,0,0', 0.16],
    adhesion: 1,
    curl: 1,
    sound: STD,
    ground: 'tray',
    well: true,
    bakeBase: bakePhone,
    live: (ctx, L, s) => drawPhoneLive(ctx, L, s.date, s.frozen ? true : uses24h()),
  },
  steel: {
    ix: 1,
    salt: 23,
    size(w, h) {
      const SW = Math.min(0.86 * w, 0.62 * h * 0.8, 520)
      return { ow: SW, oh: SW * 1.25, orad: 0.06 * SW, rot: 0 }
    },
    film(ow, oh, orad) {
      const ins = 0.02 * ow
      return { fw: ow - 2 * ins, fh: oh - 2 * ins, frad: orad - ins }
    },
    corner: 'tr',
    tab: 'white-arrow',
    tMin: 0,
    tint: 'rgba(58,141,222,0.30)',
    flapTint: 'rgba(58,141,222,0.42)',
    wadTint: '58,141,222',
    wadA: 0.5,
    haze: 0.06,
    glare: 'band1',
    scratches: 20,
    print: printSteel,
    bubbles: [5, 9, 0.02, 0.04],
    rim: ['20,40,70', 0.2],
    adhesion: 1,
    curl: 1,
    sound: { pitch: 0.8, gain: 1.3, crinkle: 0, rateCap: 120 },
    bloom: true,
    ground: 'tray',
    well: true,
    bakeBase: bakeSteel,
    live: (ctx, L, s) => drawSteelLive(ctx, L, s.frozen ? true : Math.floor(s.ms / 500) % 2 === 0),
  },
  remote: {
    ix: 2,
    salt: 37,
    size(w, h) {
      const RW = Math.min(0.3 * w, 0.72 * h * 0.24, 170)
      return { ow: RW, oh: RW / 0.24, orad: 0.2 * RW, rot: (12 * Math.PI) / 180 }
    },
    film(ow, oh, orad) {
      const mar = 0.06 * ow
      return { fw: ow + 2 * mar, fh: oh + 2 * mar, frad: orad + mar }
    },
    corner: 'bl',
    tab: 'dogear',
    tMin: 0,
    tint: 'rgba(255,255,255,0.16)',
    flapTint: 'rgba(235,228,200,0.30)',
    wadTint: '245,236,205',
    wadA: 0.3,
    haze: 0.06,
    aged: true,
    glare: 'crinkle',
    scratches: 60,
    smudge: true,
    seam: true,
    bubbles: [5, 9, 0.02, 0.04],
    rim: ['0,0,0', 0.16],
    adhesion: 1,
    curl: 1,
    sound: { pitch: 1, gain: 1, crinkle: 1, rateCap: 120 },
    ground: 'sofa',
    well: false,
    hitFilm: true,
    bakeBase: (ctx, L) => bakeRemote(ctx, L),
    chat: { who: 'peel_mum', warn: 'peel_mum_warn', good: 'peel_mum_good', done: 'peel_mum_done', ga: 'mum' },
  },
})

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
function drawPhoneLive(ctx: CanvasRenderingContext2D, L: Layout, date: Date, h24: boolean) {
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
  const labels = list('peel_steel_labels')
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
function drawSteelLive(ctx: CanvasRenderingContext2D, L: Layout, colonOn: boolean) {
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
