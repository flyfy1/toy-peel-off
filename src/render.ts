// Per-frame film drawing (spec 3.4 to 3.7): stuck film, bubbles, peel front, flap shadow, roll, flap, tab.
import { type Peel, type Poly, type V, K_FLAP, chord, clipHalf, liftPoint, liftS } from './geom'
import { type Bakes, type Bubble, type Layout, filmMatrix, rng, rrPath } from './scene'
import { def } from './objects'

/** One light, upper left and above (screen space, z toward the viewer). */
const LIGHT3 = (() => {
  const v = [-0.5, -0.62, 0.62]
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
})()

export interface Wrinkle {
  a: V
  b: V
}

export interface FilmState {
  peel: Peel
  /** Film is on (false after detach). */
  on: boolean
  bubbles: Bubble[]
  wrinkles: Wrinkle[]
  /** Re-seeded on each stick-slip step: front shimmer and stress marks. */
  frontSeed: number
  /** Tab idle lift 0..1. */
  tabLift: number
  /** Steel adhesive bloom 0..1 (fades over 200 ms after a step). */
  bloom: number
  /** Stress marks and front shimmer show only while the front is being worked. */
  stress: boolean
  /** The microwave: the last corner tore off with the sliver (after the stall), and the sliver is flicking. */
  torn: boolean
  flick: boolean
}

const P = (A: V, u: V, X: number, Y: number): V => [A[0] + u[0] * X - u[1] * Y, A[1] + u[1] * X + u[0] * Y]

/** Tab outline (film-local, before lifting): a rounded rect T x 0.6T on the outward corner diagonal. */
export function tabPoly(L: Layout): Poly {
  const { A, e1, e2, frad, T, out } = L
  const C: V = [A[0] + (e1[0] + e2[0]) * frad, A[1] + (e1[1] + e2[1]) * frad]
  const apex: V = [C[0] + out[0] * frad, C[1] + out[1] * frad]
  const c: V = [apex[0] + out[0] * 0.3 * T, apex[1] + out[1] * 0.3 * T]
  const lw = T
  const lh = 0.6 * T
  const rr = 0.2 * T
  const pts: Poly = []
  const n = 6
  const corners: [number, number, number][] = [
    [lw / 2 - rr, -lh / 2 + rr, -Math.PI / 2],
    [lw / 2 - rr, lh / 2 - rr, 0],
    [-lw / 2 + rr, lh / 2 - rr, Math.PI / 2],
    [-lw / 2 + rr, -lh / 2 + rr, Math.PI],
  ]
  for (const [x, y, a0] of corners)
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2)
      const lx = x + rr * Math.cos(a)
      const ly = y + rr * Math.sin(a)
      // local x along out, local y across
      pts.push([c[0] + out[0] * lx - out[1] * ly, c[1] + out[1] * lx + out[0] * ly])
    }
  return pts
}

function pathPoly(ctx: CanvasRenderingContext2D, poly: Poly) {
  ctx.moveTo(poly[0][0], poly[0][1])
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
  ctx.closePath()
}

/** Half-plane x < m (less) or x > m along u, as a big quad in film-local coordinates. */
export function halfPlane(ctx: CanvasRenderingContext2D, A: V, u: V, m: number, less: boolean) {
  const B = 1e4
  const x0 = less ? m - B : m
  const x1 = less ? m : m + B
  const q = [P(A, u, x0, -B), P(A, u, x1, -B), P(A, u, x1, B), P(A, u, x0, B)]
  ctx.moveTo(q[0][0], q[0][1])
  for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1])
  ctx.closePath()
}

/** Screen-space offset vector -> film-local (undo the object's rotation). */
function toFilmVec(L: Layout, x: number, y: number): V {
  const c = Math.cos(-L.rot)
  const s = Math.sin(-L.rot)
  return [c * x - s * y, s * x + c * y]
}

/** The light in the peel frame: component along u and up. */
function lightInPeel(L: Layout, u: V) {
  const lf = toFilmVec(L, LIGHT3[0], LIGHT3[1])
  return { lu: lf[0] * u[0] + lf[1] * u[1], lz: LIGHT3[2] }
}

/** The roll as seen from above: the curl strips' footprints as quads (same winding, so a nonzero fill is their union), and its two edge traces. */
function curlFootprint(L: Layout, pe: Peel): { quads: Poly[]; lo: Poly; hi: Poly; ys: number[] } | null {
  const { A, u, m, r } = pe
  const N = 18
  const lo: Poly = []
  const hi: Poly = []
  const ys: number[] = []
  const pts: { X: number; c: [number, number]; i: number }[] = []
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * Math.PI * r
    if (s > m + 1e-6) break
    const c = chord(L.polyDense, A, u, m - s)
    if (!c) continue
    const X = m - r * Math.sin(s / r)
    pts.push({ X, c, i })
    lo.push(P(A, u, X, c[0]))
    hi.push(P(A, u, X, c[1]))
    ys.push(i)
  }
  if (pts.length < 2) return null
  // outline: walk the outer half (X decreasing) on the lo side, back on the hi side; at each X take the
  // wider of the two strips that land there (s and pi r - s), so the polygon is simple and seam-free
  const half = Math.floor(N / 2)
  const byI = new Map(pts.map((q) => [q.i, q]))
  const loS: Poly = []
  const hiS: Poly = []
  for (let i = 0; i <= half; i++) {
    const a = byI.get(i)
    const b = byI.get(N - i)
    if (!a && !b) continue
    const X = (a ?? b)!.X
    const l = Math.min(a ? a.c[0] : Infinity, b ? b.c[0] : Infinity)
    const h = Math.max(a ? a.c[1] : -Infinity, b ? b.c[1] : -Infinity)
    loS.push(P(A, u, i === 0 ? X + 0.4 : X, l))
    hiS.push(P(A, u, i === 0 ? X + 0.4 : X, h))
  }
  const quads: Poly[] = loS.length >= 2 ? [[...loS, ...hiS.reverse()]] : []
  return { quads, lo, hi, ys }
}

/** Flat flap outline (mapped), with the pulled corner lifted 6% toward the viewer. Returns also which edges are free (cut) edges. */
function flapOutline(L: Layout, pe: Peel): { poly: Poly; free: boolean[]; heights: number[]; Q: V } | null {
  const { A, u, m, r } = pe
  const cut = m - Math.PI * r
  const Q = liftPoint(A, pe).p
  if (cut <= 0) return { poly: [], free: [], heights: [], Q }
  const src = clipHalf(L.polyDense, A, u, cut, true)
  if (src.length < 3) return { poly: [], free: [], heights: [], Q }
  const poly: Poly = []
  const heights: number[] = []
  const onCut: boolean[] = []
  const R = 1.2 * L.T
  for (const p of src) {
    const x = (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1]
    onCut.push(Math.abs(x - cut) < 1e-4)
    const l = liftPoint(p, pe)
    let q = l.p
    const d = Math.hypot(q[0] - Q[0], q[1] - Q[1])
    if (d < R) {
      const f = 1 + 0.06 * (1 - d / R) ** 2
      q = [Q[0] + (q[0] - Q[0]) * f, Q[1] + (q[1] - Q[1]) * f]
    }
    poly.push(q)
    heights.push(l.h)
  }
  const free = poly.map((_, i) => !(onCut[i] && onCut[(i + 1) % poly.length]))
  return { poly, free, heights, Q }
}

export function drawFilm(ctx: CanvasRenderingContext2D, L: Layout, B: Bakes, st: FilmState, shadowCv: HTMLCanvasElement) {
  if (!st.on) {
    def(L.kind).sliver?.(ctx, L, B, st, true)
    return
  }
  const pe = st.peel
  const { A, u, m, r } = pe
  const dpr = L.dpr
  const M = filmMatrix(L)
  const setFilm = (c: CanvasRenderingContext2D, scale = dpr) => c.setTransform(M[0] * scale, M[1] * scale, M[2] * scale, M[3] * scale, M[4] * scale, M[5] * scale)
  const peeled = m > 0.01
  const tex = B.film

  // ---------- L3 stuck film ----------
  setFilm(ctx)
  ctx.save()
  ctx.beginPath()
  rrPath(ctx, -1.5, -1.5, L.fw + 3, L.fh + 3, L.frad + 1.5)
  ctx.clip()
  if (peeled) {
    ctx.beginPath()
    halfPlane(ctx, A, u, m, false)
    ctx.clip()
  }
  ctx.drawImage(tex.front, -tex.pad, -tex.pad, L.fw + 2 * tex.pad, L.fh + 2 * tex.pad)

  // ---------- L4 bubbles and wrinkles under the stuck film ----------
  for (const b of st.bubbles) {
    const x = (b.p[0] - A[0]) * u[0] + (b.p[1] - A[1]) * u[1]
    if (peeled && x < m + Math.max(b.rx, b.ry)) continue
    drawBubble(ctx, L, b)
  }
  for (const w of st.wrinkles) {
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(w.a[0] + 0.7, w.a[1] + 0.9)
    ctx.quadraticCurveTo((w.a[0] + w.b[0]) / 2 + 3.5, (w.a[1] + w.b[1]) / 2 - 1.5, w.b[0] + 0.7, w.b[1] + 0.9)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 2.6
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.moveTo(w.a[0], w.a[1])
    ctx.quadraticCurveTo((w.a[0] + w.b[0]) / 2 + 3, (w.a[1] + w.b[1]) / 2 - 2, w.b[0], w.b[1])
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.moveTo(w.a[0], w.a[1])
    ctx.quadraticCurveTo((w.a[0] + w.b[0]) / 2 + 3, (w.a[1] + w.b[1]) / 2 - 2, w.b[0], w.b[1])
    ctx.stroke()
  }
  ctx.restore()
  if (L.sx0 && peeled) {
    def(L.kind).sliver?.(ctx, L, B, st, false)
    setFilm(ctx)
  }

  const curl = peeled ? curlFootprint(L, pe) : null
  const flap = peeled ? flapOutline(L, pe) : null
  const tab = def(L.kind).tab === 'dogear' ? null : tabPoly(L)
  const tabMapped = tab ? tab.map((p) => liftPoint(p, pe)) : null

  // ---------- L5 peel front ----------
  if (peeled) {
    const c = chord(L.polyDense, A, u, m)
    if (c) {
      ctx.save()
      ctx.beginPath()
      rrPath(ctx, 0, 0, L.fw, L.fh, L.frad)
      ctx.clip()
      const rnd = rng(st.frontSeed)
      if (def(L.kind).bloom) {
        // adhesive bloom on the metal just uncovered
        // a milky, faintly iridescent haze with a darker wet line where the glue just let go
        const b = st.bloom
        const a0 = P(A, u, m - r - 0.11 * L.F, 0)
        const a1 = P(A, u, m - r, 0)
        const g = ctx.createLinearGradient(a0[0], a0[1], a1[0], a1[1])
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(0.45, `rgba(200,225,255,${(0.18 * b).toFixed(3)})`)
        g.addColorStop(0.75, `rgba(255,236,246,${(0.38 * b).toFixed(3)})`)
        g.addColorStop(0.93, `rgba(255,255,255,${(0.6 * b).toFixed(3)})`)
        g.addColorStop(1, `rgba(90,96,110,${(0.35 * b).toFixed(3)})`)
        ctx.fillStyle = g
        ctx.beginPath()
        halfPlane(ctx, A, u, m - r, true)
        ctx.fill()
      }
      // fine bright line, displaced +/- 1 px by noise
      ctx.beginPath()
      const step = 2
      const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28]
      const fq = [0.11 + rnd() * 0.05, 0.27 + rnd() * 0.1, 0.6 + rnd() * 0.2]
      for (let y = c[0]; y <= c[1] + step; y += step) {
        const yy = Math.min(y, c[1])
        const n = 0.35 * Math.sin(yy * fq[0] + ph[0]) + 0.2 * Math.sin(yy * fq[1] + ph[1]) + 0.1 * Math.sin(yy * fq[2] + ph[2])
        const q = P(A, u, m + 0.5 + n, yy)
        if (y === c[0]) ctx.moveTo(q[0], q[1])
        else ctx.lineTo(q[0], q[1])
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'
      ctx.lineWidth = 0.9
      ctx.stroke()
      if (L.sx0 && Math.abs(u[1]) > 1e-6) {
        // a bright nick where the front tears along the trim
        const y = A[1] + (m - (L.sx0 - A[0]) * u[0]) / u[1]
        if (y > 0 && y < L.fh) {
          ctx.strokeStyle = 'rgba(255,255,255,0.95)'
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.moveTo(L.sx0 - 0.5, y - 1.5)
          ctx.lineTo(L.sx0 + 1, y + 1.5)
          ctx.stroke()
        }
      }
      // stress marks: adhesive legs letting go
      const n = !st.stress ? 0 : Math.round((20 + rnd() * 10) * Math.min(1, (c[1] - c[0]) / L.F))
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 0.55
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const y = c[0] + rnd() * (c[1] - c[0])
        const l = (0.01 + rnd() * 0.025) * L.F
        const a = P(A, u, m + 0.5, y)
        const b = P(A, u, m + l, y + (rnd() - 0.5) * 1.2)
        ctx.moveTo(a[0], a[1])
        ctx.lineTo(b[0], b[1])
      }
      ctx.stroke()
      ctx.restore()
    }
  }

  // ---------- L6 flap shadow (low-res layer: the upscale is the blur) ----------
  const lift = st.tabLift
  if (peeled || (tabMapped && lift > 0) || tabMapped) {
    const sc = shadowCv.getContext('2d')!
    const sScale = shadowCv.width / L.w
    sc.setTransform(1, 0, 0, 1, 0, 0)
    sc.clearRect(0, 0, shadowCv.width, shadowCv.height)
    setFilm(sc, sScale)
    sc.fillStyle = 'rgb(15,18,25)'
    const dirS = toFilmVec(L, 0.5, 0.6)
    const off = (h: number, X: number) => Math.min(h, 2 * r) + 0.4 * Math.min(Math.max(0, X - m), 0.3 * L.F)
    const fillShadow = (pts: { p: V; o: number }[], k: number, a: number) => {
      sc.globalAlpha = a
      sc.beginPath()
      pts.forEach((q, i) => {
        const x = q.p[0] + dirS[0] * q.o * k
        const y = q.p[1] + dirS[1] * q.o * k
        if (i) sc.lineTo(x, y)
        else sc.moveTo(x, y)
      })
      sc.closePath()
      sc.fill()
    }
    const sets: { p: V; o: number }[][] = []
    if (curl) {
      // roll: outline offset by height (outer edge at r, the top at 2r)
      const n = curl.lo.length
      const pts: { p: V; o: number }[] = []
      for (let k = 0; k < n; k++) pts.push({ p: curl.lo[k], o: liftS((curl.ys[k] / 18) * Math.PI * r, pe).h })
      for (let k = n - 1; k >= 0; k--) pts.push({ p: curl.hi[k], o: liftS((curl.ys[k] / 18) * Math.PI * r, pe).h })
      sets.push(pts)
    }
    if (flap && flap.poly.length) {
      sets.push(
        flap.poly.map((p) => {
          const X = (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1]
          return { p, o: off(2 * r, X) }
        }),
      )
    }
    if (tabMapped) {
      sets.push(
        tabMapped.map((q) => {
          const X = (q.p[0] - A[0]) * u[0] + (q.p[1] - A[1]) * u[1]
          const base = q.s > 0 ? off(q.h, X) : 0
          return { p: q.p, o: base + 0.9 + lift * 0.12 * L.T }
        }),
      )
    }
    for (const pts of sets) for (let i = 0; i < 9; i++) fillShadow(pts, 0.4 + (i / 8) * 1.2, 0.042)
    sc.globalAlpha = 1
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(shadowCv, 0, 0, L.w * dpr, L.h * dpr)
    ctx.restore()
    setFilm(ctx)
  }

  const lt = lightInPeel(L, u)

  // ---------- L7a the roll ----------
  if (curl) {
    ctx.save()
    ctx.beginPath()
    for (const q of curl.quads) pathPoly(ctx, q)
    ctx.clip()
    // film body: the back face of the rolled film, a little denser than flat (seen at an angle)
    ctx.fillStyle = def(L.kind).flapTint
    ctx.fill()
    const g0 = P(A, u, m - r, 0)
    const g1 = P(A, u, m, 0)
    const gw = ctx.createLinearGradient(g0[0], g0[1], g1[0], g1[1])
    const gd = ctx.createLinearGradient(g0[0], g0[1], g1[0], g1[1])
    // facing: +1 when the fold line faces the light (peeling away from it), -1 when it faces away
    const l2 = Math.hypot(lt.lu, 1e-9) > 1e-6 ? lt.lu / Math.hypot(LIGHT3[0], LIGHT3[1]) : 0
    const facing = -l2
    // one tight highlight on the visible half of the roll, a dark core between it and the silhouette
    const thHl = (132 - 14 * facing) * (Math.PI / 180)
    const thDk = (104 - 6 * facing) * (Math.PI / 180)
    const NS = 32
    for (let i = 0; i <= NS; i++) {
      const tt = i / NS
      // X = m - r + tt r on the visible (upper) half: sin(theta) = 1 - tt, theta in [90, 180] deg
      const th = Math.PI - Math.asin(Math.min(1, 1 - tt))
      const nz = -Math.cos(th)
      const c = Math.max(0, Math.cos(th - thHl))
      const spec = 0.85 * c ** 60 + 0.14 * c ** 6
      const fres = 0.5 * (1 - nz) ** 8
      const core = Math.max(0, Math.cos((th - thDk) * 3.2)) ** 2
      const white = Math.min(0.95, 0.07 + spec + fres + 0.05 * nz)
      const dark = 0.24 * core * (0.7 + 0.3 * Math.max(0, -facing))
      gw.addColorStop(tt, `rgba(255,255,255,${white.toFixed(3)})`)
      gd.addColorStop(tt, `rgba(16,20,30,${dark.toFixed(3)})`)
    }
    ctx.fillStyle = gd
    ctx.fill()
    ctx.fillStyle = gw
    ctx.fill()
    ctx.restore()
    // the rolled film's cut edges at both ends of the roll
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 0.8
    for (const tr of [curl.lo, curl.hi]) {
      ctx.beginPath()
      tr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])))
      ctx.stroke()
    }
  }

  // ---------- L7b the flat flap (back face up, mirrored, foreshortened by k) ----------
  if (flap && flap.poly.length) {
    const cut = m - Math.PI * r
    const q = 1 + K_FLAP * pe.stretch
    const c = m + K_FLAP * pe.stretch * (m - Math.PI * r)
    const ua = u[0] * A[0] + u[1] * A[1]
    const t0 = c + q * ua
    ctx.save()
    // clip to the mapped outline (it carries the corner lift)
    ctx.beginPath()
    pathPoly(ctx, flap.poly)
    ctx.clip()
    ctx.save()
    ctx.transform(1 - q * u[0] * u[0], -q * u[0] * u[1], -q * u[0] * u[1], 1 - q * u[1] * u[1], u[0] * t0, u[1] * t0)
    ctx.beginPath()
    halfPlane(ctx, A, u, cut + 2, true)
    ctx.clip()
    ctx.globalAlpha = 0.85
    ctx.drawImage(tex.back, -tex.pad, -tex.pad, L.fw + 2 * tex.pad, L.fh + 2 * tex.pad)
    ctx.globalAlpha = 1
    ctx.restore()
    // lighting of the tilted flat part: normal (-0.87 u, 0.5)
    const diff = -0.87 * lt.lu + 0.5 * lt.lz
    ctx.fillStyle = diff > 0 ? `rgba(255,255,255,${(0.1 * diff).toFixed(3)})` : `rgba(16,20,30,${(-0.12 * diff).toFixed(3)})`
    ctx.fill()
    // more light near the roll, fading over 0.3 F
    const f0 = P(A, u, m, 0)
    const f1 = P(A, u, m + 0.3 * L.F, 0)
    const gg = ctx.createLinearGradient(f0[0], f0[1], f1[0], f1[1])
    gg.addColorStop(0, 'rgba(255,255,255,0.22)')
    gg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gg
    ctx.fill()
    // the lifted end is nearer the light
    const Xq = (flap.Q[0] - A[0]) * u[0] + (flap.Q[1] - A[1]) * u[1]
    const e0 = P(A, u, Xq - 0.1 * L.F, 0)
    const e1 = P(A, u, Xq, 0)
    const ge = ctx.createLinearGradient(e0[0], e0[1], e1[0], e1[1])
    ge.addColorStop(0, 'rgba(255,255,255,0)')
    ge.addColorStop(1, 'rgba(255,255,255,0.10)')
    ctx.fillStyle = ge
    ctx.fill()
    {
      // the band lies across the screen's upper-left to lower-right diagonal through a fixed point
      const sd = toFilmVec(L, 0.6, -0.8)
      const sp: V = [L.fw * 0.45, L.fh * 0.42]
      const wdt = 0.42 * L.F
      const s0: V = [sp[0] - sd[0] * wdt, sp[1] - sd[1] * wdt]
      const s1: V = [sp[0] + sd[0] * wdt, sp[1] + sd[1] * wdt]
      const sg = ctx.createLinearGradient(s0[0], s0[1], s1[0], s1[1])
      sg.addColorStop(0, 'rgba(255,255,255,0)')
      sg.addColorStop(0.42, 'rgba(255,255,255,0.13)')
      sg.addColorStop(0.5, 'rgba(255,255,255,0.2)')
      sg.addColorStop(0.58, 'rgba(255,255,255,0.13)')
      sg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = sg
      ctx.fill()
    }
    const rq = ctx.createRadialGradient(flap.Q[0], flap.Q[1], 0, flap.Q[0], flap.Q[1], 1.2 * L.T)
    rq.addColorStop(0, 'rgba(255,255,255,0.12)')
    rq.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = rq
    ctx.fill()
    ctx.restore()
    // free (cut) edges catch the light
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const strokeFree = (style: string, w: number, ox: number, oy: number) => {
      ctx.strokeStyle = style
      ctx.lineWidth = w
      ctx.beginPath()
      const n = flap.poly.length
      let pen = false
      for (let i = 0; i < n; i++) {
        const a = flap.poly[i]
        const b = flap.poly[(i + 1) % n]
        if (!flap.free[i]) {
          pen = false
          continue
        }
        if (!pen) ctx.moveTo(a[0] + ox, a[1] + oy)
        ctx.lineTo(b[0] + ox, b[1] + oy)
        pen = true
      }
      ctx.stroke()
    }
    const so = toFilmVec(L, 0.45, 0.55)
    strokeFree('rgba(0,0,0,0.16)', 0.9, so[0], so[1])
    strokeFree('rgba(255,255,255,0.7)', 0.8, 0, 0)
  }

  // ---------- tab ----------
  if (tabMapped && tab) {
    let pts = tabMapped.map((q) => q.p)
    if (lift > 0) {
      let cx = 0
      let cy = 0
      for (const p of pts) {
        cx += p[0] / pts.length
        cy += p[1] / pts.length
      }
      const k = 1 + 0.07 * lift
      pts = pts.map((p) => [cx + (p[0] - cx) * k - lift * 0.4, cy + (p[1] - cy) * k - lift * 0.5] as V)
    }
    drawTab(ctx, L, pts, tabMapped.some((q) => q.s > Math.PI * r))
  }
}

function drawBubble(ctx: CanvasRenderingContext2D, L: Layout, b: Bubble) {
  const rim = def(L.kind).rim
  const k = b.big ? 1.25 : 1
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(b.p[0], b.p[1], b.rx, b.ry, b.a, 0, Math.PI * 2)
  // body: the air gap scatters light, so the pocket is a little milkier than the film around it
  const g = ctx.createRadialGradient(b.p[0] - b.rx * 0.3, b.p[1] - b.ry * 0.3, 0, b.p[0], b.p[1], Math.max(b.rx, b.ry) * 1.05)
  g.addColorStop(0, `rgba(255,255,255,${0.05 * k})`)
  g.addColorStop(0.75, `rgba(255,255,255,${0.1 * k})`)
  g.addColorStop(1, `rgba(255,255,255,${0.2 * k})`)
  ctx.fillStyle = g
  ctx.fill()
  ctx.clip()
  // rims in screen orientation: light upper-left inside edge, dark lower-right
  const lw = Math.max(0.9, 0.16 * Math.min(b.rx, b.ry))
  ctx.lineWidth = lw
  ctx.strokeStyle = `rgba(${rim[0]},${rim[1] * k})`
  ctx.beginPath()
  ctx.ellipse(b.p[0] - lw * 0.7, b.p[1] - lw * 0.8, b.rx, b.ry, b.a, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = `rgba(255,255,255,${0.55 * k})`
  ctx.beginPath()
  ctx.ellipse(b.p[0] + lw * 0.8, b.p[1] + lw * 0.9, b.rx, b.ry, b.a, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.ellipse(b.p[0] - b.rx * 0.38, b.p[1] - b.ry * 0.42, Math.max(0.7, 0.18 * b.rx), Math.max(0.5, 0.12 * b.ry), -0.6, 0, Math.PI * 2)
  ctx.fill()
}

function drawTab(ctx: CanvasRenderingContext2D, L: Layout, pts: Poly, flipped: boolean) {
  const style = def(L.kind).tab
  const steel = style === 'white-arrow'
  const clear = L.layer2 || style === 'clear'
  ctx.save()
  ctx.beginPath()
  pathPoly(ctx, pts)
  // body
  let cx = 0
  let cy = 0
  for (const p of pts) {
    cx += p[0]
    cy += p[1]
  }
  cx /= pts.length
  cy /= pts.length
  const g = ctx.createLinearGradient(cx - L.T * 0.5, cy - L.T * 0.5, cx + L.T * 0.5, cy + L.T * 0.5)
  if (clear) {
    g.addColorStop(0, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(225,235,245,0.4)')
  } else if (steel) {
    g.addColorStop(0, '#FFFFFF')
    g.addColorStop(1, '#E4E9EF')
  } else {
    g.addColorStop(0, flipped ? '#F0B406' : '#FFC81A')
    g.addColorStop(1, flipped ? '#D79D00' : '#E8A800')
  }
  ctx.fillStyle = g
  ctx.fill()
  ctx.save()
  ctx.clip()
  // gloss on the upper-left edge
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 1.4
  ctx.translate(0.6, 0.6)
  ctx.stroke()
  ctx.restore()
  ctx.strokeStyle = clear ? 'rgba(255,255,255,0.7)' : steel ? 'rgba(60,80,110,0.35)' : 'rgba(150,100,0,0.55)'
  ctx.lineWidth = 0.7
  ctx.stroke()
  // printed arrow pointing along the pull (into the film)
  const out = L.out
  const ax = cx + out[0] * 0.12 * L.T
  const ay = cy + out[1] * 0.12 * L.T
  if (style === 'clear' && !L.layer2) {
    ctx.fillStyle = '#E5342B'
    ctx.beginPath()
    ctx.arc(cx, cy, 0.12 * L.T, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  ctx.strokeStyle = clear ? 'rgba(255,255,255,0.8)' : steel ? '#1F5FA8' : 'rgba(110,70,0,0.75)'
  ctx.lineWidth = Math.max(1, 0.07 * L.T)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const s = 0.2 * L.T
  const tip: V = [ax - out[0] * s, ay - out[1] * s]
  ctx.beginPath()
  ctx.moveTo(ax + out[0] * s, ay + out[1] * s)
  ctx.lineTo(tip[0], tip[1])
  const n: V = [-out[1], out[0]]
  ctx.moveTo(tip[0] + out[0] * s * 0.6 + n[0] * s * 0.5, tip[1] + out[1] * s * 0.6 + n[1] * s * 0.5)
  ctx.lineTo(tip[0], tip[1])
  ctx.lineTo(tip[0] + out[0] * s * 0.6 - n[0] * s * 0.5, tip[1] + out[1] * s * 0.6 - n[1] * s * 0.5)
  ctx.stroke()
  ctx.restore()
}

/** Crumpled clear film (spec 3.7): a soft irregular wad, translucent, with soft folds and a few highlights. css px, screen space. */
export function drawWad(ctx: CanvasRenderingContext2D, L: Layout, x: number, y: number, size: number, rot: number, seed: number, alpha = 1) {
  const own = def(L.kind).wad
  if (own) return own(ctx, x, y, size, rot, alpha)
  const rnd = rng(seed)
  const n = 9
  const pts: V[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.45
    const rr = size * 0.5 * (0.74 + rnd() * 0.32)
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr])
  }
  const outline = new Path2D()
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n]
    const q = pts[(i + 1) % n]
    const mx = (p[0] + q[0]) / 2
    const my = (p[1] + q[1]) / 2
    if (i === 0) outline.moveTo(mx, my)
    else outline.quadraticCurveTo(p[0], p[1], mx, my)
  }
  outline.closePath()
  const D = def(L.kind)
  const steel = D.tab === 'white-arrow' && !L.layer2
  const tint = L.layer2 ? '235,240,250' : D.wadTint
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  // soft shadow to the lower right
  for (const [k, a, o] of [[1.15, 0.05, 0.22], [1.0, 0.07, 0.17], [0.85, 0.08, 0.12]] as const) {
    ctx.save()
    ctx.translate(size * o * 0.8, size * o)
    ctx.rotate(rot)
    ctx.scale(k, k)
    ctx.fillStyle = `rgba(15,18,25,${a})`
    ctx.fill(outline)
    ctx.restore()
  }
  ctx.rotate(rot)
  ctx.fillStyle = `rgba(${tint},${L.layer2 ? 0.3 : D.wadA})`
  ctx.fill(outline)
  ctx.save()
  ctx.clip(outline)
  // overall form: lit from the upper left
  const lg = ctx.createRadialGradient(-size * 0.2, -size * 0.22, 0, 0, 0, size * 0.62)
  lg.addColorStop(0, 'rgba(255,255,255,0.32)')
  lg.addColorStop(0.6, 'rgba(255,255,255,0.08)')
  lg.addColorStop(1, 'rgba(20,25,40,0.14)')
  ctx.fillStyle = lg
  ctx.fill(outline)
  // soft folds: wide faint shade beside a thin soft bright ridge
  ctx.lineCap = 'round'
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2
    const d = rnd() * size * 0.18
    const sx = Math.cos(a) * d
    const sy = Math.sin(a) * d
    const b = a + Math.PI * (0.5 + rnd())
    const l = size * (0.3 + rnd() * 0.3)
    const ex = sx + Math.cos(b) * l
    const ey = sy + Math.sin(b) * l
    const cx = (sx + ex) / 2 + (rnd() - 0.5) * size * 0.25
    const cy = (sy + ey) / 2 + (rnd() - 0.5) * size * 0.25
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.quadraticCurveTo(cx, cy, ex, ey)
    ctx.strokeStyle = 'rgba(20,25,40,0.08)'
    ctx.lineWidth = size * 0.09
    ctx.stroke()
    ctx.save()
    ctx.translate(-size * 0.025, -size * 0.03)
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = size * 0.06
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 0.8
    ctx.stroke()
    ctx.restore()
  }
  // a few highlights
  for (let i = 0; i < 3; i++) {
    const hx = (rnd() - 0.65) * size * 0.45
    const hy = (rnd() - 0.65) * size * 0.45
    ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.25 * rnd()})`
    ctx.beginPath()
    ctx.ellipse(hx, hy, size * (0.05 + rnd() * 0.04), size * 0.014, -0.7 + (rnd() - 0.5) * 0.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 0.8
  ctx.stroke(outline)
  // the tab sticks out of the wad
  if (D.tab !== 'dogear') {
    const p = pts[2]
    ctx.save()
    ctx.translate(p[0] * 0.92, p[1] * 0.92)
    ctx.rotate(Math.atan2(p[1], p[0]))
    ctx.beginPath()
    rrPath(ctx, -0.05 * size, -0.13 * size, 0.42 * size, 0.26 * size, 0.08 * size)
    const clear = L.layer2 || D.tab === 'clear'
    ctx.fillStyle = clear ? 'rgba(255,255,255,0.5)' : steel ? '#F4F7FA' : '#F2B705'
    ctx.fill()
    ctx.strokeStyle = clear ? 'rgba(255,255,255,0.8)' : steel ? 'rgba(60,80,110,0.4)' : 'rgba(120,80,0,0.45)'
    ctx.lineWidth = 0.7
    ctx.stroke()
    ctx.restore()
  }
  ctx.restore()
}
