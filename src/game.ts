// Peel Off: game loop, input, peel model (stick-slip, zip, fall-back), detach, static cling,
// object rotation, the 梗 layer, GA events and the dev harness.
import { type Peel, type V, chord, dir, farX, liftPoint, mForFraction, mStar, mStar0, peeledFraction } from './geom'
import { type Bakes, type Bubble, type Kind, type Layout, bake, bakeFilm, filmMatrix, layoutFor, rng, rrPath } from './scene'
import { OBJ, def, isKind } from './objects'
import { KINDS } from './kit'
import { type FilmState, drawFilm, drawWad, tabPoly } from './render'
import { haptic, setupCanvas } from './engine/juice'
import { sfx } from './sfx'
import { act, track } from './analytics'
import { t, tx } from './i18n'

export interface GameEvents {
  onFirst: () => void
  /** Films peeled today, whether the pill shows the remote's "Mum informed: no" variant, kinds peeled on this device of those there are. */
  onCount: (n: number, mum: boolean, d: number, total: number) => void
  /** The newer objects have loaded (the picker and the tags can show them). */
  onObjects?: () => void
  /** A deadpan line under the object, or a chat bubble from Mum. */
  onLine: (text: string, mode: 'line' | 'mum', from?: string) => void
  /** A film came fully off: numbers for the share card (today, one-pulls this visit, the remote peeled). */
  onPeel?: (n: number, data: Record<string, number>) => void
}

export interface GameApi {
  dispose: () => void
  /** The objects there are, the kinds peeled on this device (bitmask over KINDS), the current one. */
  info: () => { avail: Kind[]; mask: number; cur: Kind }
  /** The picker: the current object slides out, this one slides in. */
  pick: (k: Kind) => void
  /** Loads the newer objects (the picker asks when it opens). */
  load: () => Promise<boolean>
}

const DEV = import.meta.env.DEV
const Q = new URLSearchParams(location.search)
const SEED = Number(Q.get('seed')) || 7

// Dev only (frame sheets): ?seed=<n> makes every random choice repeatable.
if (DEV && Q.has('seed')) {
  let a = SEED >>> 0 || 1
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let q = a
    q = Math.imul(q ^ (q >>> 15), q | 1)
    q ^= q + Math.imul(q ^ (q >>> 7), q | 61)
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296
  }
}

/** GA events (numbers or fixed ids only). In dev they are also logged to window.__ga for the playtest. */
function ga(e: string, p: Record<string, number | string> = {}) {
  track(e, p)
  if (DEV) ((window as unknown as { __ga?: unknown[] }).__ga ??= []).push([e, p])
}

const ang = (v: V) => Math.atan2(v[1], v[0])
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const DEG = Math.PI / 180
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const easeInCubic = (x: number) => x * x * x
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3
/** The first lap is today's rotation; then a bag of the newer objects, then bags of everything. */
const LAP1: Kind[] = ['phone', 'steel', 'remote']
/** The objects built so far (fridge, laptop and cabinet are in the spec for later). */
const BUILT = KINDS.slice(0, 7) as readonly Kind[]
const popc = (x: number) => {
  let n = 0
  for (; x; x >>>= 1) n += x & 1
  return n
}

/** Allowed pull directions: within 55 degrees of the film diagonal and at least 10 degrees inside the corner's quadrant. */
function uRange(L: Layout) {
  const far: V = [L.fw - 2 * L.A[0], L.fh - 2 * L.A[1]]
  const diag = ang(far)
  const d1 = wrap(ang(L.e1) - diag)
  const d2 = wrap(ang(L.e2) - diag)
  const lo = Math.max(-55 * DEG, Math.min(d1, d2) + 10 * DEG)
  const hi = Math.min(55 * DEG, Math.max(d1, d2) - 10 * DEG)
  return { diag, lo, hi, D: Math.hypot(far[0], far[1]) }
}

/** Smooth value noise in about 0..1 (adhesion map). */
function vnoise(x: number, y: number) {
  const h = (i: number, j: number) => {
    let n = (i * 374761393 + j * 668265263 + SEED * 1442695) | 0
    n = Math.imul(n ^ (n >>> 13), 1274126177)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296
  }
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * sx
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * sx
  return a + (b - a) * sy
}

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode */
  }
}
const dayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

interface Wad {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  side: number
  since: number
  stuckAgain: boolean
  off: { t: number; x0: number; y0: number; how: 'shake' | 'tap' | 'auto' } | null
  L: Layout
}

export function startGame(canvas: HTMLCanvasElement, ev: GameEvents): GameApi {
  const q0 = Q.get('obj')
  let kind: Kind = isKind(q0) && BUILT.includes(q0) ? q0 : 'phone'
  let queue: Kind[] = LAP1.includes(kind) ? LAP1.slice(LAP1.indexOf(kind) + 1) : []
  let bags = 0
  let bagRnd: (() => number) | null = null
  let forced: Kind | null = null
  let loading: Promise<boolean> | null = null
  let failed = false
  /** Kinds there are: the built ones, or the first three if the newer objects could not load. */
  const total = () => (failed ? LAP1.length : BUILT.length)
  let mask = Number(lsGet('peel.kinds')) || 0
  const seenVisit = new Set<Kind>()
  const afterShown = new Set<Kind>()
  let stall: { t: number; m: number; pulse: number } | null = null
  let stallDone = false
  let afterAt = -1
  let printAt: V | null = null
  let printDone = false
  let flickT = -1
  let L!: Layout
  let B!: Bakes
  let objL!: Layout // the object's own (first-film) layout; the second layer only swaps L
  let shadowCv!: HTMLCanvasElement
  const film: FilmState = {
    peel: { A: [0, 0], u: [0, -1], m: 0, r: 0, stretch: 1 },
    on: true,
    bubbles: [],
    wrinkles: [],
    frontSeed: 1,
    tabLift: 0,
    bloom: 0,
    stress: true,
    torn: false,
    flick: false,
  }
  let restM = 0
  let marker: V | null = null
  const showMarker = DEV && Q.has('marker')
  let started = false
  const { stage, dispose: disposeCanvas } = setupCanvas(canvas, () => started && (relayout(true), draw()))
  const ctx = stage.ctx

  // ---------- game clock (seconds; advance() steps it in the harness) ----------
  let T = 0
  let shotDate: Date | null = null

  // ---------- per-film and per-session state ----------
  let grabbed = false
  let pid = -1
  let ptr: V = [0, 0] // film-local
  let ptrS: V = [stage.w / 2, stage.h / 2] // screen
  let ptrDown = false
  let uTarget: V = [0, -1]
  let fall: { t: number; m0: number } | null = null
  let zip: { t: number; m0: number; m1: number; acc: number } | null = null
  let frontSpeed = 0
  let tickTimes: number[] = []
  let hapticN = 0
  let lastHaptic = 0
  let filmT0 = -1
  let relaidN = 0
  let mumWarned = false
  let detachT = -1
  let crumple: { x: number; y: number; rot: number } | null = null
  let gleamT = -1
  let nextAt = -1
  let layer2At = -1
  let layer2Timeout = -1
  let tabAnim: { t: number; dur: number } | null = null
  let nextIdle = 5
  let wad: Wad | null = null
  let staticShown = false
  const moves: { t: number; x: number; y: number }[] = []
  let trans: { t: number; prev: { L: Layout; B: Bakes }; baked: boolean } | null = null
  // session
  let sessionN = 0
  let onePulls = 0
  let remoteDone = 0
  let phones = 0
  let secondShown = 0
  let today = (() => {
    try {
      const d = JSON.parse(lsGet('peel.day') || '{}')
      return d.k === dayKey() ? Number(d.n) || 0 : 0
    } catch {
      return 0
    }
  })()
  let lifetime = Number(lsGet('peel.total')) || 0
  let first = true
  let inputToDrawMs = 0
  let pendingStamp = 0
  let lastDraw = 0
  let busyUntil = 0

  function setupFilm(newL: Layout, bubbles: Bubble[]) {
    L = newL
    const R = uRange(L)
    film.peel = { A: L.A, u: dir(R.diag), m: 0, r: 0.035 * L.F, stretch: 1 }
    film.bubbles = bubbles.slice()
    film.wrinkles = []
    film.on = true
    film.stress = true
    film.bloom = 0
    restM = def(L.kind).tab === 'dogear' ? liftM(film.peel.u) : 0 // the remote's wrap has a dog-eared corner
    film.peel.m = restM
    uTarget = film.peel.u
    filmT0 = -1
    relaidN = 0
    mumWarned = false
    fall = null
    zip = null
    stall = null
    stallDone = false
    film.torn = false
    afterAt = -1
    printAt = null
    printDone = false
  }

  function relayout(resize = false) {
    objL = layoutFor(kind, stage.w, stage.h, stage.dpr)
    B = bake(objL, SEED + def(kind).ix)
    shadowCv = document.createElement('canvas')
    shadowCv.width = Math.ceil((stage.w * stage.dpr) / 6)
    shadowCv.height = Math.ceil((stage.h * stage.dpr) / 6)
    const wasOn = film.on
    setupFilm(objL, B.bubbles)
    if (resize && !wasOn) film.on = false // a resize re-lays the film; a peeled object stays peeled
  }

  // ---------- coordinates ----------
  const toFilm = (x: number, y: number): V => {
    const M = filmMatrix(L)
    const det = M[0] * M[3] - M[1] * M[2]
    const dx = x - M[4]
    const dy = y - M[5]
    return [(M[3] * dx - M[2] * dy) / det, (-M[1] * dx + M[0] * dy) / det]
  }
  const toScreen = (p: V, LL = L): V => {
    const M = filmMatrix(LL)
    return [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]
  }
  /** Where the film actually starts along u: the apex of the rounded tab corner (x from A). */
  function apexX(u: V) {
    const C: V = [L.A[0] + (L.e1[0] + L.e2[0]) * L.frad, L.A[1] + (L.e1[1] + L.e2[1]) * L.frad]
    const ap: V = [C[0] + L.out[0] * L.frad, C[1] + L.out[1] * L.frad]
    return (ap[0] - L.A[0]) * u[0] + (ap[1] - L.A[1]) * u[1]
  }
  /** Grab lift: 0.5 T of film off the surface, measured from the rounded corner's apex. */
  function liftM(u: V) {
    return apexX(u) + 0.5 * L.T
  }
  /** The thing to take hold of: the tab's centre, or the remote's dog-eared corner. */
  function grabPoint(): V {
    if (def(L.kind).tab === 'dogear') return liftPoint(L.A, film.peel).p
    const tp = tabPoly(L)
    let x = 0
    let y = 0
    for (const p of tp) {
      x += p[0] / tp.length
      y += p[1] / tp.length
    }
    return [x, y]
  }
  /** Object-local hit test (screen point inside the object outline). */
  function onObject(x: number, y: number, LL = objL) {
    const c = Math.cos(-LL.rot)
    const s = Math.sin(-LL.rot)
    const dx = x - LL.cx
    const dy = y - LL.cy
    const lx = Math.abs(c * dx - s * dy)
    const ly = Math.abs(s * dx + c * dy)
    const hf = def(LL.kind).hitFilm
    const hw = hf ? LL.fw / 2 : LL.ow / 2
    const hh = hf ? LL.fh / 2 : LL.oh / 2
    return lx < hw + 4 && ly < hh + 4
  }
  const frac = () => peeledFraction(L.poly40, L.filmArea, L.A, film.peel.u, film.peel.m)
  const item = () => (L.layer2 ? 'phone2' : L.kind)
  const variant = () => def(L.kind).sound

  // ---------- sound + haptics helpers ----------
  function tickAt(at: number, k: number) {
    const now = T
    tickTimes = tickTimes.filter((x) => now - x < 1)
    if (tickTimes.length >= variant().rateCap) return
    tickTimes.push(now)
    sfx.peelTick(at, k, variant(), L.layer2 ? 0.6 : 1)
    hapticN++
    const ms = performance.now()
    if (hapticN % 3 === 0 && ms - lastHaptic > 35) {
      lastHaptic = ms
      haptic(4)
    }
  }

  // ---------- input: one pointer ----------
  function aim(p: V) {
    const R = uRange(L)
    const d: V = [p[0] - L.A[0], p[1] - L.A[1]]
    let a = R.diag
    if (Math.hypot(d[0], d[1]) > 0.5 * L.T) a = R.diag + clamp(wrap(ang(d) - R.diag), R.lo, R.hi)
    uTarget = dir(a)
  }
  function targetM(pe: Peel) {
    const P = (ptr[0] - L.A[0]) * pe.u[0] + (ptr[1] - L.A[1]) * pe.u[1]
    return Math.max(liftM(pe.u), L.round ? mStar0(P, pe.r, L.m0) : mStar(P, pe.r))
  }
  const busy = (s = 0.6) => (busyUntil = Math.max(busyUntil, T + s))

  const onDown = (e: PointerEvent) => {
    if (!started) return
    sfx.unlock()
    if (first) {
      first = false
      ev.onFirst()
    }
    if (grabbed) return // one pointer only
    ptrS = [e.clientX, e.clientY]
    ptrDown = true
    busy()
    if (showMarker) marker = [e.clientX, e.clientY]
    if (trans) return
    if (wad && !wad.off) {
      // the wad jumps back to the finger; a tap on the tray beside the object lets it go
      if (!onObject(e.clientX, e.clientY)) {
        wadOff('tap')
        if (!film.on) goNext()
        return
      }
    }
    const p = toFilm(e.clientX, e.clientY)
    if (!film.on) {
      const D = def(L.kind)
      // the extras on a clean object: the car takes one fingerprint, the microwave's sliver flicks
      if (D.touch && !printDone && gleamT >= 0 && T - gleamT > 0.82 && onObject(e.clientX, e.clientY)) {
        printDone = true
        printAt = [e.clientX - objL.cx, e.clientY - objL.cy]
        ev.onLine(tx('peel_car_after'), 'line')
        ga('extra_tap', { what: 'fingerprint' })
        nextAt = Math.max(nextAt, T + 1.6)
        draw()
        return
      }
      if (L.sx0 && p[0] > -12 && p[0] < L.sx0 + 12 && p[1] > -6 && p[1] < L.fh + 6) {
        flickT = T
        ev.onLine(tx('peel_micro_after'), 'line')
        ga('extra_tap', { what: 'sliver' })
        nextAt = Math.max(nextAt, T + 1.6)
        busy()
        return
      }
      if (nextAt >= 0 && layer2At < 0) goNext()
      return
    }
    const g = grabPoint()
    const R = Math.max(2.2 * L.T, 32)
    const near = Math.hypot(p[0] - g[0], p[1] - g[1]) < R || Math.hypot(p[0] - L.A[0], p[1] - L.A[1]) < R
    if (!near) {
      // every touch answers: the tab flicks
      tabAnim = { t: 0, dur: 0.12 }
      sfx.flick()
      draw()
      return
    }
    // your hand is needed for the next film: the old wad finally lets go
    if (wad && !wad.off) wadOff('auto')
    grabbed = true
    act('peel_start')
    pid = e.pointerId
    canvas.setPointerCapture?.(e.pointerId)
    ptr = p
    fall = null
    aim(p)
    film.peel.u = uTarget
    if (filmT0 < 0) filmT0 = T
    // in the same frame: the corner lifts to a small curl, one tick, 8 ms
    film.peel.m = Math.max(film.peel.m, liftM(film.peel.u))
    film.frontSeed = (film.frontSeed * 1103515245 + 12345) >>> 0
    sfx.peelTick(sfx.now, frac(), variant(), L.layer2 ? 0.6 : 1)
    haptic(8)
    pendingStamp = performance.now()
    draw()
  }
  const onMove = (e: PointerEvent) => {
    if (!started) return
    if (e.pointerType === 'mouse' || ptrDown) {
      ptrS = [e.clientX, e.clientY]
      moves.push({ t: performance.now() / 1000, x: e.clientX, y: e.clientY })
      while (moves.length && moves[0].t < performance.now() / 1000 - 0.6) moves.shift()
      if (wad) busy()
    }
    if (showMarker && (grabbed || e.buttons)) marker = [e.clientX, e.clientY]
    if (!grabbed || e.pointerId !== pid) return
    ptr = toFilm(e.clientX, e.clientY)
    aim(ptr)
  }
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === pid || !grabbed) ptrDown = false
    if (!grabbed || e.pointerId !== pid) return
    grabbed = false
    pid = -1
    busy(1)
    if (zip || stall) return
    const f = frac()
    if (f >= 0.7) startZip()
    else fallBack(f)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  // ---------- peel model ----------
  function startZip() {
    const pe = film.peel
    zip = { t: 0, m0: pe.m, m1: farX(L.poly40, L.A, pe.u) + 1, acc: 0 }
  }

  /** The microwave: the last corner is tucked under the trim on two sides, so the front stops there. */
  function checkStall() {
    const S = def(L.kind).stall
    if (!S || stallDone || stall || frac() < S.at) return
    stall = { t: 0, m: film.peel.m, pulse: T }
    zip = null
    ev.onLine(tx('peel_micro_stall'), 'line')
    ga('stall', { item: item(), ms: Math.round((T - (filmT0 < 0 ? T : filmT0)) * 1000) })
  }

  /** Film-local y where the fold line meets the sliver's edge (the trim side), or -1. */
  function trimY(): number {
    const pe = film.peel
    if (!L.sx0 || Math.abs(pe.u[1]) < 1e-6) return -1
    const y = L.A[1] + (pe.m - (L.sx0 - L.A[0]) * pe.u[0]) / pe.u[1]
    return y >= 0 && y <= L.fh ? y : -1
  }

  function fallBack(f: number) {
    fall = { t: 0, m0: film.peel.m }
    relaidN++
    act('relaid')
    ga('relaid', { item: item(), pct: clamp(Math.floor(f * 100), 0, 69) })
    // 2 to 4 new trapped bubbles and one diagonal wrinkle in the area that was peeled and re-laid
    const pe = film.peel
    const mRe = Math.max(pe.m - 0.02 * L.F, 1)
    const v: V = [-pe.u[1], pe.u[0]]
    const pick = (): V | null => {
      for (let k = 0; k < 20; k++) {
        const X = (0.15 + 0.8 * Math.random()) * mRe
        const c = chord(L.polyDense, L.A, pe.u, X)
        if (!c) continue
        const Y = c[0] + (0.15 + 0.7 * Math.random()) * (c[1] - c[0])
        return [L.A[0] + pe.u[0] * X + v[0] * Y, L.A[1] + pe.u[1] * X + v[1] * Y]
      }
      return null
    }
    const nb = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < nb; i++) {
      const p = pick()
      const s = (0.03 + Math.random() * 0.05) * L.F
      if (p) film.bubbles.push({ p, rx: s * 0.5, ry: s * (0.3 + Math.random() * 0.15), a: Math.random() * Math.PI, big: true })
    }
    const c = pick()
    if (c) {
      const wl = 0.3 * L.F
      const wa = ang(pe.u) + Math.PI / 2 + (Math.random() - 0.5)
      film.wrinkles.push({ a: [c[0] - (Math.cos(wa) * wl) / 2, c[1] - (Math.sin(wa) * wl) / 2], b: [c[0] + (Math.cos(wa) * wl) / 2, c[1] + (Math.sin(wa) * wl) / 2] })
    }
    const ch = def(L.kind).chat
    if (ch) {
      ev.onLine(tx(ch.good), 'mum', tx(ch.who))
      ga(ch.ga, { stage: 'relaid' })
    }
  }

  function detach(tear = false) {
    const pe = film.peel
    const Qs = toScreen(liftPoint(L.A, pe).p)
    const c = toScreen(liftPoint([L.fw / 2, L.fh / 2], pe).p)
    film.on = false
    zip = null
    grabbed = false
    pid = -1
    detachT = T
    gleamT = T
    sfx.thwip()
    if (tear) sfx.thwip(0.7, 2)
    haptic(tear ? 22 : 18)
    const wasLayer2 = L.layer2
    const it = item()
    sessionN++
    act('peel_done')
    today++
    lifetime++
    if (relaidN === 0) onePulls++
    lsSet('peel.day', JSON.stringify({ k: dayKey(), n: today }))
    lsSet('peel.total', String(lifetime))
    ga('peel_done', { n: sessionN, item: it, ms: Math.round((T - (filmT0 < 0 ? T : filmT0)) * 1000), one_pull: relaidN === 0 ? 1 : 0, relaid: relaidN })
    mask |= 1 << KINDS.indexOf(L.kind)
    lsSet('peel.kinds', String(mask))
    seenVisit.add(L.kind)
    ev.onCount(today, L.kind === 'remote', popc(mask), total())
    if (L.kind === 'remote') remoteDone = 1
    ev.onPeel?.(sessionN, { n: today, k: onePulls, remote: remoteDone, it: KINDS.indexOf(L.kind), d: popc(mask), left: leftFor() })
    void loadMore()
    const ch = def(L.kind).chat
    if (ch?.done) {
      ev.onLine(tx(ch.done), 'mum', tx(ch.who))
      ga(ch.ga, { stage: 'done' })
    }
    // the old wad lets go; the new one is born at the pointer
    if (wad && !wad.off) wadOff('auto')
    const at: V = ptrDown ? ptrS : Qs
    crumple = { x: c[0], y: c[1], rot: 0 }
    wad = { x: at[0], y: at[1], vx: 0, vy: 0, rot: 0, side: 1, since: T, stuckAgain: false, off: null, L }
    ptrS = at
    // the second layer: second phone of a session, then 1 phone in 3
    layer2At = -1
    if (L.kind === 'phone' && !wasLayer2) {
      phones++
      if (phones === 2 || (phones > 2 && Math.random() < 1 / 3)) layer2At = T + 0.82
    }
    if (wasLayer2) ev.onLine(t('peel_layer_last'), 'line')
    const D = def(L.kind)
    if (D.afterLine && !(D.afterOnce && afterShown.has(L.kind))) afterAt = T + 0.82
    nextAt = layer2At >= 0 ? -1 : T + (D.afterLine || D.touch ? 2.6 : 1.4)
    busy(2)
  }

  function startLayer2() {
    layer2At = -1
    const L2 = layoutFor('phone', stage.w, stage.h, stage.dpr, true)
    const fb = bakeFilm(L2, SEED + 101)
    B = { base: B.base, film: fb.film, bubbles: [] }
    setupFilm(L2, [])
    secondShown++
    ga('second_layer', { n: secondShown })
    ev.onLine(t('peel_layer'), 'line')
    layer2Timeout = T + 6
    tabAnim = { t: 0, dur: 0.3 }
  }

  function goNext() {
    if (trans) return
    nextAt = -1
    layer2At = -1
    layer2Timeout = -1
    trans = { t: 0, prev: { L: objL, B }, baked: false }
    film.on = false
    sfx.flick()
    busy(1)
  }

  function finishBakeNext() {
    kind = forced ?? nextKind()
    forced = null
    relayout()
    film.on = true
  }

  // ---------- rotation: the first lap, then shuffled bags; never the same object twice in a row ----------
  const avail = () => KINDS.filter((k) => OBJ[k])
  function refill() {
    const all = avail()
    if (all.length <= LAP1.length) {
      queue = LAP1.slice() // the newer objects are not here (yet): today's cycle
      return
    }
    const pool = bags++ === 0 ? all.filter((k) => !LAP1.includes(k)) : all
    bagRnd ??= rng((Math.random() * 4294967296) >>> 0)
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(bagRnd() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    if (pool[0] === kind && pool.length > 1) [pool[0], pool[1]] = [pool[1], pool[0]]
    queue = pool
  }
  function nextKind(): Kind {
    if (!queue.length) refill()
    let k = queue.shift()!
    if (k === kind) {
      if (!queue.length) refill()
      queue.push(k)
      k = queue.shift()!
    }
    return k
  }
  /** The object left for a recipient: the next one coming that this device has not peeled (never phone or steel), else the remote. */
  function leftFor(): number {
    const c = [...queue, ...avail()].find((k) => k !== 'phone' && k !== 'steel' && !((mask >> KINDS.indexOf(k)) & 1))
    return KINDS.indexOf(c ?? 'remote')
  }
  function loadMore(): Promise<boolean> {
    return (loading ??= import('./objects2').then(
      (m) => {
        m.install()
        ev.onObjects?.()
        if (started) ev.onCount(today, false, popc(mask), total())
        return true
      },
      () => {
        failed = true
        if (started) ev.onCount(today, false, popc(mask), total())
        return false
      },
    ))
  }

  // ---------- the wad ----------
  function wadOff(how: 'shake' | 'tap' | 'auto') {
    if (!wad || wad.off) return
    wad.off = { t: 0, x0: wad.x, y0: wad.y, how }
    if (how !== 'auto') act(how === 'shake' ? 'cling_shake' : 'cling_tap')
    ga('cling_off', { how, ms: Math.round((T - wad.since) * 1000), stuck_again: wad.stuckAgain ? 1 : 0 })
    if (how !== 'auto') {
      sfx.thwip(0.5)
      haptic(10)
    }
  }
  function isShake(): boolean {
    if (moves.length < 4) return false
    let maxV = 0
    let rev = 0
    let lastSx = 0
    let lastSy = 0
    for (let i = 1; i < moves.length; i++) {
      const dt = Math.max(1e-3, moves[i].t - moves[i - 1].t)
      const vx = (moves[i].x - moves[i - 1].x) / dt
      const vy = (moves[i].y - moves[i - 1].y) / dt
      maxV = Math.max(maxV, Math.hypot(vx, vy))
      const sx = Math.abs(vx) > 400 ? Math.sign(vx) : 0
      const sy = Math.abs(vy) > 400 ? Math.sign(vy) : 0
      if (sx && lastSx && sx !== lastSx) rev++
      else if (sy && lastSy && sy !== lastSy) rev++
      if (sx) lastSx = sx
      if (sy) lastSy = sy
    }
    return maxV > 1800 && rev >= 2
  }
  function stepWad(dt: number) {
    if (!wad) return
    const W = wad
    const TT = W.L.T
    if (W.off) {
      W.off.t += dt
      const k = W.off.t / 0.5
      W.y = W.off.y0 + (stage.h + 2 * TT - W.off.y0) * k * k
      W.x = W.off.x0 + Math.sin(W.off.t * Math.PI * 2 * 3) * 0.3 * TT
      W.rot += dt * 3
      if (k >= 1) wad = null
      return
    }
    const tx = ptrS[0] + W.side * 0.55 * TT
    const ty = ptrS[1] + 0.45 * TT
    W.vx += (120 * (tx - W.x) - 9 * W.vx) * dt
    W.vy += (120 * (ty - W.y) - 9 * W.vy) * dt
    W.x += W.vx * dt
    W.y += W.vy * dt
    W.rot = W.rot * 0.92 + 0.08 * clamp(W.vx / 900, -0.8, 0.8)
    const speed = Math.hypot(W.vx, W.vy)
    sfxRustle = speed > 200 ? clamp(speed / 1500, 0, 1) : 0
    if (!staticShown && T - W.since > 1.2) {
      staticShown = true
      ev.onLine(t('peel_static'), 'line')
    }
    if (T - W.since > 8) {
      wadOff('auto')
      return
    }
    if (isShake()) {
      moves.length = 0
      if (!W.stuckAgain && Math.random() < 0.25) {
        // it jumps to the other side of the pointer instead, and stays
        W.stuckAgain = true
        W.side = -W.side
        ev.onLine(t('peel_still'), 'line')
        haptic(10)
      } else wadOff('shake')
    }
  }
  let sfxRustle = 0

  // ---------- update ----------
  function step(dt: number) {
    T += dt
    const pe = film.peel
    let hiss = 0
    let stretch = 0
    let pitch = 0
    sfxRustle = 0
    if (film.bloom > 0) film.bloom = Math.max(0, film.bloom - dt / 0.2)
    if (tabAnim) {
      tabAnim.t += dt
      film.tabLift = Math.sin((Math.PI * clamp(tabAnim.t / tabAnim.dur, 0, 1)))
      if (tabAnim.t >= tabAnim.dur) {
        tabAnim = null
        film.tabLift = 0
      }
    }
    if (film.on && !grabbed && !fall && !zip && T > nextIdle) {
      nextIdle = T + 5
      tabAnim = { t: 0, dur: 0.3 }
    }
    if (stall) {
      // the stall: the flap stretches from the tucked corner, the stretch rises 700 to 1,400 Hz, then it tears free
      const S = def(L.kind).stall!
      stall.t += dt
      const k = clamp(stall.t / (S.ms / 1000), 0, 1)
      pe.m = stall.m
      pe.stretch = 1 + (S.stretch - 1) * Math.min(1, k * 2.5)
      stretch = 1
      pitch = (700 * k) / 300
      if (T >= stall.pulse) {
        haptic(6)
        stall.pulse = T + 0.06
      }
      if (k >= 1) {
        stall = null
        stallDone = true
        film.torn = true
        detach(true)
      }
      busy()
    } else if (film.on && grabbed && !zip) {
      const k = 1 - Math.exp(-dt / 0.08)
      const ux = pe.u[0] + (uTarget[0] - pe.u[0]) * k
      const uy = pe.u[1] + (uTarget[1] - pe.u[1]) * k
      const l = Math.hypot(ux, uy)
      pe.u = [ux / l, uy / l]
      const mt = Math.min(targetM(pe), farX(L.poly40, L.A, pe.u) + Math.PI * pe.r)
      const m0 = pe.m
      // stick-slip: the front only moves when the tension beats the local adhesion
      const F = L.F
      const adh = () => {
        const c = chord(L.polyDense, L.A, pe.u, pe.m)
        const mid = c ? (c[0] + c[1]) / 2 : 0
        const px = L.A[0] + pe.u[0] * pe.m - pe.u[1] * mid
        const py = L.A[1] + pe.u[1] * pe.m + pe.u[0] * mid
        let g = 0.7 + 0.6 * vnoise(px / 90, py / 90)
        if (farX(L.poly40, L.A, pe.u) - pe.m < 0.08 * F) g += 0.4
        return g
      }
      let tau = Math.max(0, (mt - pe.m) / F)
      let steps = 0
      const start = sfx.now
      const adhesion = def(L.kind).adhesion
      while (tau > 0.012 * adh() * adhesion && steps < 12) {
        pe.m += Math.min(Math.max(0.006 * F, 0.55 * tau * F), mt - pe.m)
        steps++
        tau = Math.max(0, (mt - pe.m) / F)
      }
      if (steps) {
        const f = frac()
        for (let i = 0; i < steps; i++) tickAt(start + (i / steps) * dt, f)
        // the microwave: each step along the trim tears the film there (a higher, softer tick)
        if (L.sx0 && trimY() >= 0) {
          const v = variant()
          for (let i = 0; i < steps; i++) sfx.peelTick(start + ((i + 0.5) / steps) * dt, f, { ...v, pitch: 2 * v.pitch, gain: 0.5 * v.gain }, 1)
        }
        film.frontSeed = (film.frontSeed * 1103515245 + 12345) >>> 0
        if (def(L.kind).bloom) film.bloom = 1
        popBubbles()
      } else if (tau > 0.006) {
        stretch = clamp(tau / 0.02, 0, 1)
        pitch = stretch
      }
      pe.stretch = 1 + 0.5 * tau
      frontSpeed = frontSpeed * 0.8 + 0.2 * ((pe.m - m0) / Math.max(dt, 1e-3))
      pe.r = (0.035 * F + 0.03 * F * clamp(frontSpeed / (3 * F), 0, 1)) * def(L.kind).curl
      hiss = clamp(frontSpeed / (3 * F), 0, 1)
      const f = frac()
      const ch = def(L.kind).chat
      if (ch && !mumWarned && f >= 0.15) {
        mumWarned = true
        ev.onLine(tx(ch.warn), 'mum', tx(ch.who))
        ga(ch.ga, { stage: 'warn' })
      }
      // zip: far enough and past the edge, or most of it off
      const d = Math.hypot(Math.max(0, -ptr[0], ptr[0] - L.fw), Math.max(0, -ptr[1], ptr[1] - L.fh))
      checkStall()
      if (!stall && ((f >= 0.7 && d > 0.3 * L.T) || f >= (def(L.kind).zip?.[0] ?? 0.8))) startZip()
      busy()
    } else if (zip) {
      zip.t += dt
      const k = clamp(zip.t / (def(L.kind).zip?.[1] ?? 0.16), 0, 1)
      const prev = pe.m
      pe.m = zip.m0 + (zip.m1 - zip.m0) * k * k
      pe.stretch = 1
      pe.r = 0.065 * L.F * def(L.kind).curl
      zip.acc += dt * 120
      const start = sfx.now
      let i = 0
      while (zip.acc >= 1) {
        zip.acc -= 1
        tickAt(start + i++ * (1 / 120), clamp(0.7 + 0.3 * k, 0, 1))
      }
      if (pe.m !== prev) film.frontSeed = (film.frontSeed * 1103515245 + 12345) >>> 0
      popBubbles()
      hiss = 1
      if (grabbed) aim(ptr)
      checkStall()
      if (!stall && k >= 1) detach()
      busy()
    } else if (fall) {
      fall.t += dt
      const k = Math.min(1, fall.t / 0.38)
      pe.m = restM + (fall.m0 - restM) * (1 - k * k)
      pe.stretch = 1
      if (k >= 1) {
        fall = null
        sfx.pat()
        haptic(12)
      }
      busy()
    } else {
      frontSpeed *= 0.8
    }
    stepWad(dt)
    film.flick = flickT >= 0 && T - flickT < 0.08
    if (afterAt >= 0 && T >= afterAt) {
      afterAt = -1
      const D = def(L.kind)
      afterShown.add(L.kind)
      if (D.afterLine) ev.onLine(tx(D.afterLine(shotDate ?? new Date())), 'line')
    }
    sfx.beds(hiss, stretch, pitch, sfxRustle)
    if (layer2At >= 0 && T >= layer2At) startLayer2()
    if (layer2Timeout >= 0 && T >= layer2Timeout && film.on && L.layer2) {
      layer2Timeout = -1
      goNext()
    }
    if (nextAt >= 0 && T >= nextAt && !trans) goNext()
    if (trans) {
      trans.t += dt
      if (!trans.baked && trans.t >= 0.3) {
        trans.baked = true
        finishBakeNext()
      }
      if (trans.t >= 0.52) trans = null
      busy()
    }
    if (crumple && T - detachT > 0.22) crumple = null
  }

  function popBubbles() {
    const pe = film.peel
    const keep: Bubble[] = []
    for (const b of film.bubbles) {
      const x = (b.p[0] - pe.A[0]) * pe.u[0] + (b.p[1] - pe.A[1]) * pe.u[1]
      if (x < pe.m) {
        sfx.bubblePop(sfx.now, variant())
        haptic(5)
      } else keep.push(b)
    }
    film.bubbles = keep
  }

  // ---------- draw ----------
  function drawObject(LL: Layout, BB: Bakes, ox: number, withFilm: boolean) {
    ctx.setTransform(1, 0, 0, 1, ox * stage.dpr, 0)
    ctx.drawImage(BB.base, 0, 0)
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, ox * stage.dpr, 0)
    const now = shotDate ?? new Date()
    def(LL.kind).live?.(ctx, LL, { date: now, frozen: !!shotDate, gleam: gleamT >= 0 ? T - gleamT : -1, on: film.on, ms: performance.now() })
    if (withFilm) {
      // gleam: a diagonal band sweeps the clean surface 120 to 820 ms after detach
      if (gleamT >= 0 && T - gleamT > 0.12 && T - gleamT < 0.82) drawGleam(LL, (T - gleamT - 0.12) / 0.7)
      if (gleamT >= 0 && T - gleamT >= 0.12 && T - gleamT - dtLast < 0.12) sfx.bell()
      drawFilm(ctx, L, BB, film, shadowCv)
    }
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, ox * stage.dpr, 0)
    if (printAt) def(LL.kind).touch?.(ctx, LL.cx + printAt[0], LL.cy + printAt[1], 0.09 * LL.F)
    def(LL.kind).over?.(ctx, LL)
  }
  let dtLast = 1 / 60

  function drawGleam(LL: Layout, k: number) {
    const e = 0.5 - 0.5 * Math.cos(Math.PI * k)
    ctx.save()
    ctx.translate(LL.cx, LL.cy)
    ctx.rotate(LL.rot)
    ctx.beginPath()
    rrPath(ctx, -LL.ow / 2, -LL.oh / 2, LL.ow, LL.oh, LL.orad)
    ctx.clip()
    const span = LL.ow + LL.oh
    const c = -span / 2 + e * span
    const w = 0.3 * LL.F
    const g = ctx.createLinearGradient((c - w) * 0.6, (c - w) * 0.8, (c + w) * 0.6, (c + w) * 0.8)
    const a = 0.38 * Math.sin(Math.PI * k)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(3)})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(-LL.ow, -LL.oh, LL.ow * 2, LL.oh * 2)
    ctx.restore()
  }

  function drawLid(x: number) {
    const w = stage.w
    const h = stage.h
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0)
    ctx.save()
    ctx.translate(x, 0)
    // soft edge shadow on its leading side
    const sg = ctx.createLinearGradient(-24, 0, 0, 0)
    sg.addColorStop(0, 'rgba(60,45,30,0)')
    sg.addColorStop(1, 'rgba(60,45,30,0.25)')
    ctx.fillStyle = sg
    ctx.fillRect(-24, 0, 24, h)
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, '#F4F1EC')
    g.addColorStop(1, '#E3DDD3')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w + 24, h)
    // a debossed rounded-rectangle on the lid
    ctx.strokeStyle = 'rgba(120,105,85,0.18)'
    ctx.lineWidth = 2
    ctx.beginPath()
    rrPath(ctx, w * 0.3, h * 0.38, w * 0.4, h * 0.24, 18)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    rrPath(ctx, w * 0.3 + 1, h * 0.38 + 1, w * 0.4, h * 0.24, 18)
    ctx.stroke()
    ctx.restore()
  }

  function draw() {
    lastDraw = performance.now()
    if (trans) {
      const k = trans.t
      if (k < 0.3) {
        const e = easeInCubic(k / 0.3)
        drawObject(trans.prev.L, trans.prev.B, -e * stage.w, false)
        drawLid(stage.w * (1 - e))
      } else {
        drawObject(objL, B, 0, true)
        drawLid(-stage.w * easeOutCubic(Math.min(1, (k - 0.3) / 0.22)) - 24)
      }
    } else drawObject(objL, B, 0, true)
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0)
    if (crumple && wad) {
      // the sheet swings behind the pointer and crumples into a wad (ease-in cubic, 220 ms)
      const k = easeInCubic(clamp((T - detachT) / 0.22, 0, 1))
      const x = crumple.x + (wad.x - crumple.x) * k
      const y = crumple.y + (wad.y - crumple.y) * k
      const s = 1 + ((1.3 * wad.L.T) / Math.max(wad.L.fw, wad.L.fh) - 1) * k
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(wad.L.rot + k * 1.4)
      ctx.scale(s * (1 - 0.3 * Math.sin(k * Math.PI)), s)
      ctx.globalAlpha = 0.85 * (1 - k)
      const tex = B.film
      // the film texture of the film that just came off is still referenced by the wad's layout
      ctx.drawImage(tex.back, -wad.L.fw / 2 - tex.pad, -wad.L.fh / 2 - tex.pad, wad.L.fw + 2 * tex.pad, wad.L.fh + 2 * tex.pad)
      ctx.restore()
      drawWad(ctx, wad.L, wad.x, wad.y, 1.3 * wad.L.T, wad.rot, SEED + sessionN, k)
    } else if (wad) drawWad(ctx, wad.L, wad.x, wad.y, 1.3 * wad.L.T, wad.rot, SEED + sessionN)
    if (marker) drawMarker(ctx, marker[0], marker[1], L.T)
    if (pendingStamp) {
      inputToDrawMs = performance.now() - pendingStamp
      pendingStamp = 0
    }
  }

  // ---------- loop: 60 fps while anything moves, 20 fps at rest, paused when hidden ----------
  let frozen: number | null = null
  let last = performance.now()
  let raf = 0
  function frame(dt: number) {
    if (!started) {
      if (stage.w) drawLid(0)
      return
    }
    dtLast = dt
    step(dt)
    draw()
  }
  const tick = (now: number) => {
    const dt = Math.min(0.033, (now - last) / 1000)
    last = now
    if (frozen === null) {
      const idle = T > busyUntil && !grabbed && !wad && !trans
      if (!idle || now - lastDraw >= 49) frame(idle ? Math.min(0.06, dt + (now - lastDraw) / 1000 - dt) : dt)
    }
    raf = requestAnimationFrame(tick)
  }
  // session summary: sent when the page is hidden (before gtag flushes on pagehide), once per new count
  let sentN = 0
  const sendSession = () => {
    if (sessionN > sentN) {
      sentN = sessionN
      ga('session_peels', { n: sessionN, one_pulls: onePulls, kinds: seenVisit.size })
    }
  }
  const onVis = () => {
    cancelAnimationFrame(raf)
    if (document.hidden) sendSession()
    else {
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
  }
  document.addEventListener('visibilitychange', onVis)
  const onHide = () => {
    sendSession()
    if (wad && !wad.off) wadOff('auto')
  }
  window.addEventListener('pagehide', onHide)

  function begin() {
    relayout()
    started = true
    ev.onCount(today, false, popc(mask), total())
  }
  // a link naming a newer object: load them first (the closed box lid shows meanwhile); if that fails, the remote
  if (OBJ[kind]) begin()
  else
    void loadMore().then((ok) => {
      if (!ok) kind = 'remote'
      begin()
    })

  // ---------- dev: ?shot=<name> sets m, u and r directly and freezes ----------
  function setFraction(f: number, offDeg = 0, rr = 0.035) {
    const R = uRange(L)
    const a = R.diag + clamp(offDeg * DEG, R.lo, R.hi)
    const pe = film.peel
    pe.u = dir(a)
    pe.r = rr * L.F * def(L.kind).curl
    pe.m = f >= 1 ? farX(L.poly40, L.A, pe.u) : mForFraction(L.poly40, L.filmArea, L.A, pe.u, f)
  }
  function shot(name: string): void | Promise<void> {
    shotDate = new Date(2026, 10, 25, 10, 24)
    const dash = name.indexOf('-')
    const pre = name.slice(0, dash)
    const want: Kind = dash > 0 && isKind(pre) ? pre : name.startsWith('steel') ? 'steel' : name.startsWith('remote') ? 'remote' : isKind(q0) ? q0 : 'phone'
    if (!OBJ[want]) return loadMore().then(() => shot(name))
    if (dash > 0 && isKind(pre)) name = name.slice(dash + 1)
    kind = want
    relayout()
    film.stress = name !== 'remote0'
    wad = null
    const pe = film.peel
    if (name === 'clean') film.on = false
    else if (name === 'grab') pe.m = liftM(pe.u)
    else if (name === 'p35' || name === 'steel35') {
      setFraction(0.35)
      film.bloom = name === 'steel35' ? 1 : 0
    } else if (name === 'og') {
      // the 1200 x 630 card: the phone sits right of the title
      objL.cx = stage.w * 0.72
      B = bake(objL, SEED + def(kind).ix)
      setupFilm(objL, B.bubbles)
      setFraction(0.4, -30)
    } else if (name === 'stall') {
      // the microwave at its stall: 90% peeled, the flap stretched from the tucked corner
      setFraction(0.9)
      pe.stretch = 1.25
    } else if (name === 'sliver') {
      film.on = false
      film.torn = true
    } else if (name === 'p70') setFraction(0.7, -30)
    else if (name === 'p70b') setFraction(0.7, -30, 0.065)
    else if (name === 'pull') setFraction(Number(Q.get('f')) || 0)
    else if (name === 'layer2') {
      film.on = false
      startLayer2()
      setFraction(0.3)
    } else if (name === 'wad') {
      film.on = false
      const p = toScreen([L.fw * 0.78, L.fh * 0.62])
      marker = [p[0] + 0.5 * L.T, p[1] + 0.6 * L.T]
      wad = { x: p[0] - 0.25 * L.T, y: p[1] - 0.2 * L.T, vx: 0, vy: 0, rot: 0.4, side: 1, since: 0, stuckAgain: false, off: null, L }
    }
    draw()
    if (name === 'og') drawOgText()
  }
  function drawOgText() {
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0)
    ctx.fillStyle = '#3A3128'
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.font = '700 64px system-ui, sans-serif'
    ctx.fillText('Peel Off', 70, 270)
    ctx.font = '600 44px system-ui, "PingFang SC", sans-serif'
    ctx.fillStyle = '#6B5E50'
    ctx.fillText('撕膜', 70, 335)
    ctx.font = '400 26px system-ui, sans-serif'
    ctx.fillText('Peel the film off a brand-new phone.', 70, 395)
    ctx.fillText('Then try to put the film down.', 70, 430)
    ctx.textAlign = 'right'
    ctx.font = '600 24px system-ui, sans-serif'
    ctx.fillStyle = '#8A7C6C'
    ctx.fillText('peel.integ.life', stage.w - 60, stage.h - 50)
  }

  const shotName = DEV ? Q.get('shot') : null
  if (DEV && Q.has('bare')) shotDate = new Date(2026, 10, 25, 10, 24)
  if (shotName) {
    frozen = performance.now()
    shot(shotName)
  }
  raf = requestAnimationFrame(tick)

  if (DEV) {
    const advance = (ms: number) => {
      for (let left = ms; left > 1e-6; left -= 1000 / 60) frame(Math.min(1000 / 60, left) / 1000)
    }
    ;(window as unknown as Record<string, unknown>).__toy = {
      freeze: () => (frozen = performance.now()),
      unfreeze: () => (frozen = null),
      advance,
      seed: SEED,
      get inputToDrawMs() {
        return inputToDrawMs
      },
      shot,
      layout: () => ({ F: L.F, T: L.T, fw: L.fw, fh: L.fh, A: L.A, rot: L.rot, kind: L.kind, layer2: L.layer2, diag: uRange(L), tab: toScreen(grabPoint()), Ascreen: toScreen(L.A), farScreen: toScreen([L.fw - L.A[0], L.fh - L.A[1]]) }),
      state: () => ({
        m: film.peel.m,
        u: film.peel.u,
        r: film.peel.r,
        on: film.on,
        frac: frac(),
        grabbed,
        zip: !!zip,
        fall: !!fall,
        wad: wad ? { x: wad.x, y: wad.y, off: !!wad.off } : null,
        trans: !!trans,
        kind: L.kind,
        layer2: L.layer2,
        sessionN,
        today,
        nan: !Number.isFinite(film.peel.m) || !Number.isFinite(film.peel.u[0]),
      }),
      setMarker: (x: number, y: number) => {
        marker = [x, y]
        draw()
      },
      next: goNext,
      get ready() {
        return started
      },
    }
  }

  function pick(k: Kind) {
    if (!OBJ[k] || trans || !started || grabbed || (k === kind && film.on)) return
    ga('pick', { item: k, seen: (mask >> KINDS.indexOf(k)) & 1 })
    forced = k
    if (wad && !wad.off) wadOff('auto')
    goNext()
  }
  if (DEV)
    Object.assign((window as unknown as { __toy: object }).__toy, {
      pick,
      load: loadMore,
      info: () => ({ mask, queue, kind }),
      // peel-more 3.8: peeled fraction with the finger on the far corner's apex (diagonal pull, r = 0.05 F x curl)
      reach: () => {
        const u = dir(uRange(L).diag)
        const P = farX(L.poly40, L.A, u)
        const r = 0.05 * L.F * def(L.kind).curl
        const m = L.round ? mStar0(P, r, L.m0) : mStar(P, r)
        return { kind: L.kind, fw: L.fw, fh: L.fh, F: L.F, T: L.T, frac: peeledFraction(L.poly40, L.filmArea, L.A, u, m) }
      },
    })

  return {
    info: () => ({ avail: avail(), mask, cur: kind }),
    pick,
    load: loadMore,
    dispose() {
      cancelAnimationFrame(raf)
      disposeCanvas()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    },
  }
}

/** Dev-only fingertip marker for the stills. */
function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, T: number) {
  ctx.save()
  const r = 0.55 * T
  ctx.fillStyle = 'rgba(214,160,130,0.35)'
  ctx.strokeStyle = 'rgba(120,70,50,0.7)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.ellipse(x, y, r * 0.8, r, -0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
