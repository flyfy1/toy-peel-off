// Peel Off: game loop, input and dev harness. Phase 1: rendering, fold geometry and the
// pointer -> fold mapping (no stick-slip, sound or detach yet).
import { type Peel, type V, chord, dir, farX, mForFraction, mStar, peeledFraction } from './geom'
import { type Bakes, type Kind, type Layout, bake, drawPhoneLive, drawSteelLive, filmMatrix, layoutFor } from './scene'
import { type FilmState, drawFilm, drawWad, tabPoly } from './render'
import { haptic, setupCanvas } from './engine/juice'

export interface GameEvents {
  onFirst: () => void
}

export interface GameApi {
  dispose: () => void
}

const DEV = import.meta.env.DEV
const Q = new URLSearchParams(location.search)
const SEED = Number(Q.get('seed')) || 7

// Dev only (frame sheets): ?seed=<n> makes every random choice repeatable.
if (DEV && Q.has('seed')) {
  let a = SEED >>> 0 || 1
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ang = (v: V) => Math.atan2(v[1], v[0])
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const DEG = Math.PI / 180

/** Allowed pull directions: within 55 degrees of the film diagonal and at least 10 degrees inside the corner's quadrant. */
function uRange(L: Layout) {
  // vector from A to the opposite corner (fw - A, fh - A) - A
  const far: V = [L.fw - 2 * L.A[0], L.fh - 2 * L.A[1]]
  const diag = ang(far)
  const d1 = wrap(ang(L.e1) - diag)
  const d2 = wrap(ang(L.e2) - diag)
  const lo = Math.max(-55 * DEG, Math.min(d1, d2) + 10 * DEG)
  const hi = Math.min(55 * DEG, Math.max(d1, d2) - 10 * DEG)
  return { diag, lo, hi, D: Math.hypot(far[0], far[1]) }
}

export function startGame(canvas: HTMLCanvasElement, ev: GameEvents): GameApi {
  let kind: Kind = (Q.get('obj') as Kind) || 'phone'
  let L!: Layout
  let B!: Bakes
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
  }
  let restM = 0
  let wad: { x: number; y: number } | null = null
  let marker: V | null = null
  const showMarker = DEV && Q.has('marker')
  let started = false
  const { stage, dispose: disposeCanvas } = setupCanvas(canvas, () => started && (relayout(), draw()))
  const ctx = stage.ctx

  function relayout() {
    L = layoutFor(kind, stage.w, stage.h, stage.dpr)
    B = bake(L, SEED)
    shadowCv = document.createElement('canvas')
    shadowCv.width = Math.ceil((stage.w * stage.dpr) / 6)
    shadowCv.height = Math.ceil((stage.h * stage.dpr) / 6)
    const R = uRange(L)
    film.peel = { A: L.A, u: dir(R.diag), m: 0, r: 0.035 * L.F, stretch: 1 }
    film.bubbles = B.bubbles.slice()
    film.wrinkles = []
    film.on = true
    restM = kind === 'remote' ? liftM(film.peel.u) : 0 // the remote's wrap has a dog-eared corner
    film.peel.m = restM
  }

  // ---------- coordinates ----------
  const toFilm = (x: number, y: number): V => {
    const M = filmMatrix(L)
    const det = M[0] * M[3] - M[1] * M[2]
    const dx = x - M[4]
    const dy = y - M[5]
    return [(M[3] * dx - M[2] * dy) / det, (-M[1] * dx + M[0] * dy) / det]
  }
  const toScreen = (p: V): V => {
    const M = filmMatrix(L)
    return [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]
  }
  /** Where the film actually starts along u: the apex of the rounded tab corner (x from A). */
  const apexX = (u: V) => {
    const C: V = [L.A[0] + (L.e1[0] + L.e2[0]) * L.frad, L.A[1] + (L.e1[1] + L.e2[1]) * L.frad]
    const ap: V = [C[0] + L.out[0] * L.frad, C[1] + L.out[1] * L.frad]
    return (ap[0] - L.A[0]) * u[0] + (ap[1] - L.A[1]) * u[1]
  }
  /** Grab lift: 0.5 T of film off the surface, measured from the rounded corner's apex. */
  const liftM = (u: V) => apexX(u) + 0.5 * L.T
  const tabCentre = (): V => {
    const t = tabPoly(L)
    let x = 0
    let y = 0
    for (const p of t) {
      x += p[0]
      y += p[1]
    }
    return [x / t.length, y / t.length]
  }

  // ---------- input: one pointer ----------
  let grabbed = false
  let pid = -1
  let ptr: V = [0, 0] // film-local
  let uTarget: V = film.peel.u
  let fall: { t: number; m0: number } | null = null
  let first = true
  let downStamp = 0
  let inputToDrawMs = 0
  let pendingStamp = 0

  /** Pointer -> u -> m*: the live mapping (spec 3.5 and 5, without stick-slip). */
  function aim(p: V) {
    const R = uRange(L)
    const d: V = [p[0] - L.A[0], p[1] - L.A[1]]
    let a = R.diag
    if (Math.hypot(d[0], d[1]) > 0.5 * L.T) a = R.diag + Math.max(R.lo, Math.min(R.hi, wrap(ang(d) - R.diag)))
    uTarget = dir(a)
  }
  function targetM(pe: Peel) {
    const P = (ptr[0] - L.A[0]) * pe.u[0] + (ptr[1] - L.A[1]) * pe.u[1]
    return Math.max(liftM(pe.u), mStar(P, pe.r))
  }

  const onDown = (e: PointerEvent) => {
    if (grabbed) return
    if (first) {
      first = false
      ev.onFirst()
    }
    const p = toFilm(e.clientX, e.clientY)
    if (showMarker) marker = [e.clientX, e.clientY]
    const tc = tabCentre()
    const near = Math.hypot(p[0] - tc[0], p[1] - tc[1]) < 2.2 * L.T || Math.hypot(p[0] - L.A[0], p[1] - L.A[1]) < 2.2 * L.T
    if (!film.on || !near) return
    grabbed = true
    pid = e.pointerId
    canvas.setPointerCapture?.(e.pointerId)
    ptr = p
    fall = null
    aim(p)
    film.peel.u = uTarget
    // in the same frame: the corner lifts to a small curl
    film.peel.m = Math.max(film.peel.m, liftM(film.peel.u))
    film.frontSeed = (film.frontSeed * 1103515245 + 12345) >>> 0
    haptic(8)
    downStamp = performance.now()
    pendingStamp = downStamp
    draw()
  }
  const onMove = (e: PointerEvent) => {
    if (showMarker && (grabbed || e.buttons)) marker = [e.clientX, e.clientY]
    if (!grabbed || e.pointerId !== pid) return
    ptr = toFilm(e.clientX, e.clientY)
    aim(ptr)
  }
  const onUp = (e: PointerEvent) => {
    if (!grabbed || e.pointerId !== pid) return
    grabbed = false
    pid = -1
    fall = { t: 0, m0: film.peel.m }
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  // ---------- update and draw ----------
  function step(dt: number) {
    const pe = film.peel
    if (grabbed) {
      const k = 1 - Math.exp(-dt / 0.08)
      const ux = pe.u[0] + (uTarget[0] - pe.u[0]) * k
      const uy = pe.u[1] + (uTarget[1] - pe.u[1]) * k
      const l = Math.hypot(ux, uy)
      pe.u = [ux / l, uy / l]
      const mt = Math.min(targetM(pe), farX(L.poly40, L.A, pe.u) + Math.PI * pe.r)
      if (Math.abs(mt - pe.m) > 0.05) film.frontSeed = (film.frontSeed * 1103515245 + 12345) >>> 0
      pe.m = mt
    } else if (fall) {
      fall.t += dt
      const t = Math.min(1, fall.t / 0.38)
      pe.m = restM + (fall.m0 - restM) * (1 - t * t)
      if (t >= 1) fall = null
    }
  }

  let shotDate: Date | null = null
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(B.base, 0, 0)
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0)
    const now = shotDate ?? new Date()
    if (kind === 'phone') drawPhoneLive(ctx, L, now, shotDate ? true : uses24h())
    else if (kind === 'steel') drawSteelLive(ctx, L, shotDate ? true : Math.floor(performance.now() / 500) % 2 === 0)
    drawFilm(ctx, L, B, film, shadowCv)
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0)
    if (wad) drawWad(ctx, L, wad.x, wad.y, 1.3 * L.T, 0.4, SEED)
    if (marker) drawMarker(ctx, marker[0], marker[1], L.T)
    if (pendingStamp) {
      inputToDrawMs = performance.now() - pendingStamp
      pendingStamp = 0
    }
  }

  let frozen: number | null = null
  let last = performance.now()
  let raf = 0
  function frame(dt: number) {
    step(dt)
    draw()
  }
  const tick = (t: number) => {
    const dt = Math.min(0.033, (t - last) / 1000)
    last = t
    if (frozen === null) frame(dt)
    raf = requestAnimationFrame(tick)
  }

  relayout()
  started = true

  // ---------- dev: ?shot=<name> sets m, u and r directly and freezes ----------
  function setFraction(f: number, offDeg = 0, rr = 0.035) {
    const R = uRange(L)
    const a = R.diag + Math.max(R.lo, Math.min(R.hi, offDeg * DEG))
    const pe = film.peel
    pe.u = dir(a)
    pe.r = rr * L.F
    pe.m = f >= 1 ? farX(L.poly40, L.A, pe.u) : mForFraction(L.poly40, L.filmArea, L.A, pe.u, f)
  }
  function shot(name: string) {
    shotDate = new Date(2026, 10, 25, 10, 24)
    const want: Kind = name.startsWith('steel') ? 'steel' : name.startsWith('remote') ? 'remote' : (Q.get('obj') as Kind) || 'phone'
    if (want !== kind) {
      kind = want
      relayout()
    }
    film.on = true
    film.stress = name !== 'remote0'
    wad = null
    film.wrinkles = []
    film.bubbles = B.bubbles.slice()
    const pe = film.peel
    pe.r = 0.035 * L.F
    pe.u = dir(uRange(L).diag)
    pe.m = restM
    if (name === 'clean') film.on = false
    else if (name === 'grab') pe.m = liftM(pe.u)
    else if (name === 'p35' || name === 'steel35') {
      setFraction(0.35)
      film.bloom = name === 'steel35' ? 1 : 0
    }
    else if (name === 'p70') setFraction(0.7, -30)
    else if (name === 'p70b') setFraction(0.7, -30, 0.065)
    else if (name === 'pull') setFraction(Number(Q.get('f')) || 0)
    else if (name === 'turn') setFraction(0.5, Number(Q.get('a')) || 0)
    else if (name === 'relaid') relaid()
    else if (name === 'wad') {
      film.on = false
      const p = toScreen([L.fw * 0.78, L.fh * 0.62])
      marker = [p[0] + 0.5 * L.T, p[1] + 0.6 * L.T]
      wad = { x: p[0] - 0.25 * L.T, y: p[1] - 0.2 * L.T }
    }
    if (name === 'pull' && Number(Q.get('f')) === 0) pe.m = 0
    draw()
  }
  function relaid() {
    // a fall-back from about 45%: 3 new trapped bubbles and one diagonal wrinkle in the re-laid area
    const pe = film.peel
    const mRe = mForFraction(L.poly40, L.filmArea, L.A, pe.u, 0.45)
    const rnd = (() => {
      let a = SEED * 977 + 3
      return () => {
        a = (a * 16807) % 2147483647
        return a / 2147483647
      }
    })()
    const v: V = [-pe.u[1], pe.u[0]]
    const pick = () => {
      for (;;) {
        const X = rnd() * mRe
        const c = chord(L.polyDense, L.A, pe.u, X)
        if (!c) continue
        const Y = c[0] + (0.15 + 0.7 * rnd()) * (c[1] - c[0])
        return [L.A[0] + pe.u[0] * X + v[0] * Y, L.A[1] + pe.u[1] * X + v[1] * Y] as V
      }
    }
    for (let i = 0; i < 3; i++) {
      const s = (0.03 + rnd() * 0.05) * L.F
      film.bubbles.push({ p: pick(), rx: s * 0.5, ry: s * (0.3 + rnd() * 0.15), a: rnd() * Math.PI, big: true })
    }
    // the wrinkle runs across the middle of the re-laid area
    const wX = 0.55 * mRe
    const wc = chord(L.polyDense, L.A, pe.u, wX)!
    const wY = wc[0] + 0.45 * (wc[1] - wc[0])
    const c: V = [L.A[0] + pe.u[0] * wX + v[0] * wY, L.A[1] + pe.u[1] * wX + v[1] * wY]
    const wl = 0.3 * L.F
    const wa = Math.atan2(pe.u[1], pe.u[0]) + Math.PI / 2 + 0.5
    film.wrinkles.push({ a: [c[0] - (Math.cos(wa) * wl) / 2, c[1] - (Math.sin(wa) * wl) / 2], b: [c[0] + (Math.cos(wa) * wl) / 2, c[1] + (Math.sin(wa) * wl) / 2] })
    pe.m = 0
  }

  if (DEV && Q.has('bare')) shotDate = new Date(2026, 10, 25, 10, 24)
  const shotName = DEV ? Q.get('shot') : null
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
      layout: () => ({ F: L.F, T: L.T, fw: L.fw, fh: L.fh, A: L.A, rot: L.rot, diag: uRange(L), tab: toScreen(tabCentre()), Ascreen: toScreen(L.A), farScreen: toScreen([L.fw - L.A[0], L.fh - L.A[1]]), toScreen: (x: number, y: number) => toScreen([x, y]) }),
      state: () => ({
        m: film.peel.m,
        u: film.peel.u,
        r: film.peel.r,
        frac: peeledFraction(L.poly40, L.filmArea, L.A, film.peel.u, film.peel.m),
        grabbed,
        marker,
        bubblesStuck: film.on ? film.bubbles.filter((b) => (b.p[0] - L.A[0]) * film.peel.u[0] + (b.p[1] - L.A[1]) * film.peel.u[1] > film.peel.m + b.rx).length : 0,
        bubbles: film.bubbles.length,
      }),
      setMarker: (x: number, y: number) => {
        marker = [x, y]
        draw()
      },
      ready: true,
    }
  }

  return {
    dispose() {
      cancelAnimationFrame(raf)
      disposeCanvas()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    },
  }
}

function uses24h(): boolean {
  try {
    const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle
    return hc === 'h23' || hc === 'h24'
  } catch {
    return true
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
  ctx.fillStyle = 'rgba(120,70,50,0.9)'
  ctx.beginPath()
  ctx.arc(x, y, 1.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
