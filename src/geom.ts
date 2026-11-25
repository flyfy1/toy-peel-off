// Peel geometry (spec section 3.5). Pure functions, film-local coordinates (css px, origin at the
// film rect's top-left). Everything that draws the peeled film goes through `liftPoint`, so the
// flap, the tab, the corner Q, the shadow and the pointer mapping can never disagree.

export type V = [number, number]
export type Poly = V[]

/** Foreshortening of the lifted flap along u (do not change without rerunning sim/peel_fraction.py). */
export const K_FLAP = 0.5

export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1]
export const len = (a: V) => Math.hypot(a[0], a[1])
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

/** Rounded rectangle as a polygon (perCorner points on each arc, ends included). */
export function rrPoly(x: number, y: number, w: number, h: number, r: number, perCorner: number): Poly {
  const out: Poly = []
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (i / perCorner) * (Math.PI / 2)
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  arc(x + w - r, y + r, -Math.PI / 2)
  arc(x + w - r, y + h - r, 0)
  arc(x + r, y + h - r, Math.PI / 2)
  arc(x + r, y + r, Math.PI)
  return out
}

export function area(p: Poly): number {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1])
  return Math.abs(a) / 2
}

/** Sutherland–Hodgman against one half-plane: keep points with (p - A)·u < m (less = true) or > m. */
export function clipHalf(poly: Poly, A: V, u: V, m: number, less: boolean): Poly {
  const f = (p: V) => {
    const x = (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1] - m
    return less ? -x : x
  }
  const out: Poly = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const fp = f(p)
    const fq = f(q)
    if (fp >= 0) out.push(p)
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq)
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  }
  return out
}

/** Where the line x = m (x along u from A) crosses the polygon: [vMin, vMax] along v, or null. */
export function chord(poly: Poly, A: V, u: V, m: number): [number, number] | null {
  const v: V = [-u[1], u[0]]
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const xp = (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1] - m
    const xq = (q[0] - A[0]) * u[0] + (q[1] - A[1]) * u[1] - m
    if ((xp >= 0) === (xq >= 0)) continue
    const t = xp / (xp - xq)
    const px = p[0] + (q[0] - p[0]) * t - A[0]
    const py = p[1] + (q[1] - p[1]) * t - A[1]
    const y = px * v[0] + py * v[1]
    if (y < lo) lo = y
    if (y > hi) hi = y
  }
  return lo <= hi ? [lo, hi] : null
}

export interface Peel {
  /** Grab corner (the film rect's tab corner), film-local. */
  A: V
  /** Unit pull direction (into the film). */
  u: V
  /** Fold distance from A along u. */
  m: number
  /** Curl radius. */
  r: number
  /** Stretch of the flat flap along u (1 + 0.5 tension), phase 2. */
  stretch: number
}

/**
 * Forward map of a film point that sits s behind the fold line (s = m - x when flat):
 * x position seen from above (along u, from A) and height above the surface.
 *   s <= 0        : still stuck, x = m - s
 *   0 < s <= πr   : on the roll, x = m - r sin(s/r), h = r (1 - cos(s/r))
 *   s > πr        : the flap, back face up, rising: x = m + k (s - πr), h = 2r + 0.87 (s - πr)
 */
export function liftS(s: number, pe: Peel): { x: number; h: number } {
  const { m, r } = pe
  if (s <= 0) return { x: m - s, h: 0 }
  if (s <= Math.PI * r) return { x: m - r * Math.sin(s / r), h: r * (1 - Math.cos(s / r)) }
  const t = s - Math.PI * r
  return { x: m + K_FLAP * pe.stretch * t, h: 2 * r + 0.87 * t }
}

/** Film-local point -> where it is drawn (film-local, top-down) and its height. */
export function liftPoint(p: V, pe: Peel): { p: V; h: number; s: number } {
  const x = (p[0] - pe.A[0]) * pe.u[0] + (p[1] - pe.A[1]) * pe.u[1]
  const s = pe.m - x
  const l = liftS(s, pe)
  const d = l.x - x
  return { p: [p[0] + pe.u[0] * d, p[1] + pe.u[1] * d], h: l.h, s }
}

/** Fold distance that puts the grab corner (s = m) under a pointer at distance P along u. */
export const mStar = (P: number, r: number) => (P + K_FLAP * Math.PI * r) / (1 + K_FLAP)

/** Peeled fraction of the film polygon at fold distance m. */
export function peeledFraction(poly: Poly, filmArea: number, A: V, u: V, m: number): number {
  if (m <= 0) return 0
  return area(clipHalf(poly, A, u, m, true)) / filmArea
}

/** Fold distance at which the peeled fraction reaches f (bisection; fraction is monotonic in m). */
export function mForFraction(poly: Poly, filmArea: number, A: V, u: V, f: number): number {
  let lo = 0
  let hi = 0
  for (const p of poly) hi = Math.max(hi, (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1])
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (peeledFraction(poly, filmArea, A, u, mid) < f) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Largest x along u of any film point: the fold has run off the far corner past this. */
export function farX(poly: Poly, A: V, u: V): number {
  let hi = 0
  for (const p of poly) hi = Math.max(hi, (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1])
  return hi
}

/** Unit vector at angle a. */
export const dir = (a: number): V => [Math.cos(a), Math.sin(a)]
