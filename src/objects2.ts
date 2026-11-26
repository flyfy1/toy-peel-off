// The newer things to peel (peel-more.md section 3): camera island, smartwatch, car centre screen, microwave
// panel. Loaded after the first peel (or before the first frame when a link names one); their text rides along.
import { type Bubble, type Layout, drawNoise, objectPath, rrPath } from './kit'
import type { Poly, V } from './geom'
import { type Bakes, filmMatrix } from './scene'
import { type FilmState, halfPlane } from './render'
import { type ObjDef, register, uses24h } from './objects'
import { type Locale, addStrings, locale, tx } from './i18n'

const TAU = Math.PI * 2

// ------------------------------------- text -------------------------------------

const STR: Record<Locale, Record<string, string>> = {
  en: {
    peel_name_cam: 'the camera', peel_name_watch: 'the watch', peel_name_car: 'the car screen', peel_name_micro: 'the microwave',
    peel_cam_after: 'So it was never your shaky hands.',
    peel_watch_after: 'The film said 10:09. It is not 10:09.',
    peel_watch_1009: 'The film said 10:09. So does the watch. For once.',
    peel_dealer: 'Dealer', peel_dealer_warn: 'That film is factory-fitted. Leave it on.', peel_dealer_good: 'Wise choice.',
    peel_car_after: 'Clean for 0.8 seconds.',
    peel_micro_stall: 'It goes under the trim.', peel_micro_after: 'The bit under the trim stays. For good.',
    peel_micro_l0: 'Popcorn', peel_micro_l1: 'Defrost', peel_micro_l2: '+30 s', peel_micro_l3: 'Drinks', peel_micro_l4: 'Reheat', peel_micro_l5: 'Clock',
    peel_tag_cam: 'Someone left you the film on their camera. A year of blurry photos.',
    peel_tag_watch: 'Someone left you the film on a new watch. It has said 10:09 all along.',
    peel_tag_car: 'Someone left you the film on their car screen. The dealer says it is factory-fitted.',
    peel_tag_micro: 'Someone left you the film on a microwave. They gave up on the edge.',
  },
  'zh-CN': {
    peel_name_cam: '摄像头', peel_name_watch: '手表', peel_name_car: '车机', peel_name_micro: '微波炉',
    peel_cam_after: '原来之前的照片不是你手抖。',
    peel_watch_after: '膜上是 10:09。现在不是。',
    peel_watch_1009: '膜上是 10:09。现在也是。难得。',
    peel_dealer: '4S 店', peel_dealer_warn: '这膜是原厂的，别撕。', peel_dealer_good: '这就对了。',
    peel_car_after: '干净了 0.8 秒。',
    peel_micro_stall: '卡在缝里了。', peel_micro_after: '缝里那一圈，就这样吧。',
    peel_micro_l0: '爆米花', peel_micro_l1: '解冻', peel_micro_l2: '+30 秒', peel_micro_l3: '饮品', peel_micro_l4: '复热', peel_micro_l5: '时钟',
    peel_tag_cam: '有人把摄像头的膜留给你撕。TA 拍了一年糊照片。',
    peel_tag_watch: '有人把手表的膜留给你撕。上面一直是 10:09。',
    peel_tag_car: '有人把车机的膜留给你撕。4S 店说是原厂的。',
    peel_tag_micro: '有人把微波炉的膜留给你撕。缝里那圈 TA 放弃了。',
  },
  es: {
    peel_name_cam: 'la cámara', peel_name_watch: 'el reloj', peel_name_car: 'la pantalla del coche', peel_name_micro: 'el microondas',
    peel_cam_after: 'Así que no era tu pulso.',
    peel_watch_after: 'El plástico decía 10:09. No son las 10:09.',
    peel_watch_1009: 'El plástico decía 10:09. El reloj también. Por una vez.',
    peel_dealer: 'Concesionario', peel_dealer_warn: 'Ese plástico viene de fábrica. No lo quite.', peel_dealer_good: 'Buena decisión.',
    peel_car_after: 'Limpia durante 0,8 segundos.',
    peel_micro_stall: 'Se mete por debajo del marco.', peel_micro_after: 'Lo de debajo del marco se queda. Para siempre.',
    peel_micro_l0: 'Palomitas', peel_micro_l1: 'Descongelar', peel_micro_l2: '+30 s', peel_micro_l3: 'Bebidas', peel_micro_l4: 'Recalentar', peel_micro_l5: 'Reloj',
    peel_tag_cam: 'Alguien te ha dejado el plástico de la cámara. Un año de fotos borrosas.',
    peel_tag_watch: 'Alguien te ha dejado el plástico de un reloj nuevo. Siempre ha marcado las 10:09.',
    peel_tag_car: 'Alguien te ha dejado el plástico de la pantalla del coche. En el concesionario dicen que viene de fábrica.',
    peel_tag_micro: 'Alguien te ha dejado el plástico de un microondas. Con el borde se rindió.',
  },
  fr: {
    peel_name_cam: "l'appareil photo", peel_name_watch: 'la montre', peel_name_car: "l'écran de la voiture", peel_name_micro: 'le micro-ondes',
    peel_cam_after: "Ce n'était donc pas vous qui trembliez.",
    peel_watch_after: "Le film disait 10 h 09. Il n'est pas 10 h 09.",
    peel_watch_1009: 'Le film disait 10 h 09. La montre aussi. Pour une fois.',
    peel_dealer: 'Concessionnaire', peel_dealer_warn: "Ce film est d'origine. Laissez-le.", peel_dealer_good: 'Sage décision.',
    peel_car_after: 'Propre pendant 0,8 seconde.',
    peel_micro_stall: 'Il passe sous la baguette.', peel_micro_after: 'Le bout sous la baguette reste. Pour toujours.',
    peel_micro_l0: 'Pop-corn', peel_micro_l1: 'Décongeler', peel_micro_l2: '+30 s', peel_micro_l3: 'Boissons', peel_micro_l4: 'Réchauffer', peel_micro_l5: 'Horloge',
    peel_tag_cam: "Quelqu'un vous a laissé le film de l'appareil photo. Un an de photos floues.",
    peel_tag_watch: "Quelqu'un vous a laissé le film d'une montre neuve. Il a toujours indiqué 10 h 09.",
    peel_tag_car: "Quelqu'un vous a laissé le film de l'écran de sa voiture. Le concessionnaire dit qu'il est d'origine.",
    peel_tag_micro: "Quelqu'un vous a laissé le film d'un micro-ondes. Pour le bord, il a renoncé.",
  },
  ja: {
    peel_name_cam: 'カメラ', peel_name_watch: '腕時計', peel_name_car: '車のモニター', peel_name_micro: '電子レンジ',
    peel_cam_after: '手ブレじゃなかったんだ。',
    peel_watch_after: 'フィルムは 10:09。今は 10:09 じゃない。',
    peel_watch_1009: 'フィルムは 10:09。時計も 10:09。めずらしい。',
    peel_dealer: 'ディーラー', peel_dealer_warn: 'そのフィルムは純正です。はがさないでください。', peel_dealer_good: '賢明です。',
    peel_car_after: 'きれいだったのは 0.8 秒。',
    peel_micro_stall: 'ふちの下に入り込んでいる。', peel_micro_after: 'ふちの下のぶんは、もうそのままで。',
    peel_micro_l0: 'ポップコーン', peel_micro_l1: '解凍', peel_micro_l2: '+30 秒', peel_micro_l3: '飲み物', peel_micro_l4: 'あたため', peel_micro_l5: '時計',
    peel_tag_cam: 'カメラのフィルムを残してくれた人がいます。写真は1年ずっとぼやけていました。',
    peel_tag_watch: '新しい腕時計のフィルムを残してくれた人がいます。ずっと 10:09 のままです。',
    peel_tag_car: '車のモニターのフィルムを残してくれた人がいます。ディーラーは純正だと言っています。',
    peel_tag_micro: '電子レンジのフィルムを残してくれた人がいます。ふちはあきらめたそうです。',
  },
}

// ------------------------------------- shared bits -------------------------------------

const metal = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0, '#8E949C')
  g.addColorStop(0.3, '#E6E9ED')
  g.addColorStop(0.62, '#6E747C')
  g.addColorStop(1, '#C9CED4')
  return g
}

/** A light from the upper left over the whole ground. */
function groundLight(ctx: CanvasRenderingContext2D, L: Layout, a0: number, a1: number) {
  const { w, h } = L
  const lg = ctx.createRadialGradient(w * 0.18, h * 0.12, 0, w * 0.18, h * 0.12, Math.hypot(w, h) * 0.95)
  lg.addColorStop(0, `rgba(255,253,248,${a0})`)
  lg.addColorStop(0.55, 'rgba(255,253,248,0)')
  lg.addColorStop(1, `rgba(20,16,12,${a1})`)
  ctx.fillStyle = lg
  ctx.fillRect(0, 0, w, h)
}

/** Standard factory bubbles, but with the given count and size range, placed by a function. */
function bubblesAt(L: Layout, rnd: () => number, n: number, s0: number, s1: number, at: (i: number) => V): Bubble[] {
  const out: Bubble[] = []
  for (let i = 0; i < n; i++) {
    const s = (s0 + rnd() * (s1 - s0)) * L.F
    const p = at(i)
    out.push({ p, rx: s * 0.5, ry: s * (0.32 + rnd() * 0.15), a: rnd() * Math.PI, big: false })
  }
  return out
}

/** Film-local point inside the film rect, away from the edges by e (in F). */
const inside = (L: Layout, rnd: () => number, e = 0.1): V => [L.sx0 + e * L.F + rnd() * (L.fw - L.sx0 - 2 * e * L.F), e * L.F + rnd() * (L.fh - 2 * e * L.F)]

function clockText(d: Date) {
  const h = d.getHours()
  return `${uses24h() ? String(h).padStart(2, '0') : String(h % 12 || 12)}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ------------------------------------- cam: the camera island -------------------------------------

const lensAt = (IW: number): V[] => [
  [-0.215 * IW, -0.215 * IW],
  [-0.215 * IW, 0.215 * IW],
  [0.2 * IW, 0],
]

function camGround(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) {
  const { w, h } = L
  // the phone's frosted back in sage, a fine vertical satin
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, '#B6C4B3')
  g.addColorStop(0.5, '#A9B8A6')
  g.addColorStop(1, '#98A795')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(60,72,58,0.05)'
    ctx.fillRect(rnd() * w, 0, (0.5 + rnd() * 1.5) / L.dpr, h)
  }
  drawNoise(ctx, 0, 0, w, h, 4, rnd, '255,255,255', 0.06)
  drawNoise(ctx, 0, 0, w, h, 60, rnd, '70,80,68', 0.06)
  groundLight(ctx, L, 0.35, 0.16)
}

function camBake(ctx: CanvasRenderingContext2D, L: Layout) {
  const IW = L.ow
  ctx.save()
  ctx.translate(L.cx, L.cy)
  // polished chamfer, then the island glass
  ctx.beginPath()
  objectPath(ctx, L)
  ctx.fillStyle = metal(ctx, -IW / 2, -IW / 2, IW / 2, IW / 2)
  ctx.fill()
  const ri = 0.012 * IW
  ctx.beginPath()
  rrPath(ctx, -IW / 2 + ri, -IW / 2 + ri, IW - 2 * ri, IW - 2 * ri, L.orad - ri)
  const gg = ctx.createLinearGradient(-IW / 2, -IW / 2, IW / 2, IW / 2)
  gg.addColorStop(0, '#1A1C21')
  gg.addColorStop(0.5, '#0E0F12')
  gg.addColorStop(1, '#0A0B0D')
  ctx.fillStyle = gg
  ctx.fill()
  for (const [x, y] of lensAt(IW)) lens(ctx, x, y, 0.17 * IW)
  // flash: warm disc with a faceted fresnel
  const fx = 0.215 * IW
  const fy = -0.3 * IW
  const fr = 0.06 * IW
  const fg = ctx.createRadialGradient(fx - fr * 0.3, fy - fr * 0.3, 0, fx, fy, fr)
  fg.addColorStop(0, '#FFF8E6')
  fg.addColorStop(1, '#D9C79A')
  ctx.fillStyle = fg
  ctx.beginPath()
  ctx.arc(fx, fy, fr, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = 'rgba(120,100,60,0.35)'
  ctx.lineWidth = 0.7
  for (let k = 1; k < 4; k++) {
    ctx.beginPath()
    ctx.arc(fx, fy, (fr * k) / 4, 0, TAU)
    ctx.stroke()
  }
  for (let k = 0; k < 8; k++) {
    ctx.beginPath()
    ctx.moveTo(fx, fy)
    ctx.lineTo(fx + Math.cos((k * TAU) / 8) * fr, fy + Math.sin((k * TAU) / 8) * fr)
    ctx.stroke()
  }
  ctx.strokeStyle = '#2A2C31'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(fx, fy, fr + 1, 0, TAU)
  ctx.stroke()
  // microphone pinhole
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(0.3 * IW, 0.3 * IW, 0.011 * IW, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 0.8
  ctx.stroke()
  // the island glass's own reflection
  ctx.save()
  ctx.beginPath()
  rrPath(ctx, -IW / 2 + ri, -IW / 2 + ri, IW - 2 * ri, IW - 2 * ri, L.orad - ri)
  ctx.clip()
  const rg = ctx.createLinearGradient(-IW * 0.5, -IW * 0.5, -IW * 0.1, -IW * 0.1)
  rg.addColorStop(0, 'rgba(255,255,255,0.10)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = rg
  ctx.fillRect(-IW / 2, -IW / 2, IW, IW)
  ctx.restore()
  ctx.restore()
}

function lens(ctx: CanvasRenderingContext2D, x: number, y: number, R: number) {
  // shadow of the raised ring on the glass
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.beginPath()
  ctx.arc(x + 0.04 * R, y + 0.06 * R, R * 1.02, 0, TAU)
  ctx.fill()
  // knurled ring
  ctx.fillStyle = metal(ctx, x - R, y - R, x + R, y + R)
  ctx.beginPath()
  ctx.arc(x, y, R, 0, TAU)
  ctx.fill()
  ctx.lineWidth = Math.max(0.6, 0.02 * R)
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU
    ctx.strokeStyle = i % 2 ? 'rgba(40,44,50,0.45)' : 'rgba(255,255,255,0.35)'
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * R * 0.86, y + Math.sin(a) * R * 0.86)
    ctx.lineTo(x + Math.cos(a) * R * 0.98, y + Math.sin(a) * R * 0.98)
    ctx.stroke()
  }
  ctx.fillStyle = '#121317'
  ctx.beginPath()
  ctx.arc(x, y, R * 0.82, 0, TAU)
  ctx.fill()
  // black glass, a little deeper toward the middle
  const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.74)
  g.addColorStop(0, '#020306')
  g.addColorStop(0.7, '#0A0C12')
  g.addColorStop(1, '#1C1F28')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, R * 0.74, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 0.8
  ctx.stroke()
  // aperture
  ctx.fillStyle = '#05060A'
  ctx.beginPath()
  ctx.arc(x, y, R * 0.17, 0, TAU)
  ctx.fill()
  // a soft window-shaped reflection, upper left
  ctx.save()
  ctx.translate(x - 0.3 * R, y - 0.3 * R)
  ctx.rotate(-0.6)
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  ctx.beginPath()
  rrPath(ctx, -0.18 * R, -0.12 * R, 0.36 * R, 0.24 * R, 0.04 * R)
  ctx.fill()
  ctx.restore()
  // one hard specular dot
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.beginPath()
  ctx.arc(x - 0.4 * R, y - 0.4 * R, 0.045 * R, 0, TAU)
  ctx.fill()
}

/** The lens coatings, drifting a pixel: green, violet and amber reflections deep in the glass. */
function camLive(ctx: CanvasRenderingContext2D, L: Layout, s: { ms: number; on: boolean; gleam: number }) {
  const IW = L.ow
  const R = 0.17 * IW
  const d = Math.sin((s.ms / 6000) * TAU)
  const k = s.on ? 0.12 : 1
  ctx.save()
  ctx.translate(L.cx, L.cy)
  ctx.lineCap = 'round'
  for (const [x, y] of lensAt(IW)) {
    const arcs: [number, number, number, number, number, string, number][] = [
      [-0.1, -0.06, 0.5, 3.6, 4.9, '59,227,160', 0.5],
      [0.08, 0.06, 0.42, 0.2, 1.5, '138,108,246', 0.45],
      [-0.04, 0.1, 0.3, 1.9, 3.1, '255,184,107', 0.3],
    ]
    for (const [ox, oy, r, a0, a1, c, a] of arcs) {
      const cx = x + ox * R + d
      const cy = y + oy * R - d * 0.5
      ctx.strokeStyle = `rgba(${c},${a * k * 0.35})`
      ctx.lineWidth = 0.16 * R
      ctx.beginPath()
      ctx.arc(cx, cy, r * R, a0, a1)
      ctx.stroke()
      ctx.strokeStyle = `rgba(${c},${a * k})`
      ctx.lineWidth = 0.05 * R
      ctx.stroke()
    }
    // after the film is off, each lens catches a second, brighter specular for 400 ms
    if (s.gleam >= 0.12 && s.gleam < 0.52) {
      const e = Math.sin(((s.gleam - 0.12) / 0.4) * Math.PI)
      const sg = ctx.createRadialGradient(x - 0.28 * R, y - 0.34 * R, 0, x - 0.28 * R, y - 0.34 * R, 0.16 * R)
      sg.addColorStop(0, `rgba(255,255,255,${0.95 * e})`)
      sg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = sg
      ctx.beginPath()
      ctx.arc(x - 0.28 * R, y - 0.34 * R, 0.16 * R, 0, TAU)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** "②" and an arrow beside the tab (the screen film was ①). */
function printNumber(ctx: CanvasRenderingContext2D, L: Layout, n: string) {
  const { fw, fh, F } = L
  ctx.strokeStyle = ctx.fillStyle = 'rgba(92,96,104,0.8)'
  ctx.lineWidth = Math.max(0.9, 0.0045 * F)
  ctx.lineCap = 'round'
  const tx = fw - 0.34 * F
  const ty = fh - 0.08 * F
  ctx.beginPath()
  ctx.arc(tx, ty, 0.035 * F, 0, TAU)
  ctx.stroke()
  ctx.font = `600 ${0.045 * F}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(n, tx, ty + 0.002 * F)
  ctx.beginPath()
  ctx.moveTo(tx + 0.06 * F, ty)
  ctx.lineTo(tx + 0.15 * F, ty)
  ctx.moveTo(tx + 0.12 * F, ty - 0.025 * F)
  ctx.lineTo(tx + 0.15 * F, ty)
  ctx.lineTo(tx + 0.12 * F, ty + 0.025 * F)
  ctx.stroke()
}

// ------------------------------------- watch -------------------------------------

function watchGround(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) {
  const { w, h, cx, cy } = L
  const WC = L.ow
  ctx.fillStyle = '#E3E0DA'
  ctx.fillRect(0, 0, w, h)
  drawNoise(ctx, 0, 0, w, h, 50, rnd, '140,132,120', 0.06)
  drawNoise(ctx, 0, 0, w, h, 3, rnd, '255,255,255', 0.08)
  // the moulded pillow: a soft oval dip around the watch
  const pg = ctx.createRadialGradient(cx + 0.05 * WC, cy + 0.08 * WC, 0.2 * WC, cx, cy, 1.05 * WC)
  pg.addColorStop(0, 'rgba(110,100,88,0.20)')
  pg.addColorStop(0.7, 'rgba(110,100,88,0.06)')
  pg.addColorStop(1, 'rgba(110,100,88,0)')
  ctx.fillStyle = pg
  ctx.beginPath()
  ctx.ellipse(cx, cy, 0.95 * WC, 1.35 * WC, 0, 0, TAU)
  ctx.fill()
  groundLight(ctx, L, 0.4, 0.1)
  // the strap runs off the top and the bottom of the screen
  const sw = 0.5 * WC
  const strap = (y0: number, y1: number, holes: boolean) => {
    ctx.save()
    ctx.fillStyle = 'rgba(30,25,20,0.25)'
    ctx.fillRect(cx - sw / 2 + 0.02 * WC, y0, sw, y1 - y0)
    const g = ctx.createLinearGradient(cx - sw / 2, 0, cx + sw / 2, 0)
    g.addColorStop(0, '#202227')
    g.addColorStop(0.18, '#34373E')
    g.addColorStop(0.5, '#2B2D33')
    g.addColorStop(0.85, '#232529')
    g.addColorStop(1, '#17181C')
    ctx.fillStyle = g
    ctx.fillRect(cx - sw / 2, y0, sw, y1 - y0)
    drawNoise(ctx, cx - sw / 2, y0, sw, y1 - y0, 3, rnd, '255,255,255', 0.04)
    if (holes) {
      for (let y = y0 + 0.12 * WC; y < y1; y += 0.1 * WC) {
        ctx.fillStyle = '#0E0F12'
        ctx.beginPath()
        rrPath(ctx, cx - 0.018 * WC, y, 0.036 * WC, 0.05 * WC, 0.018 * WC)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(cx - 0.016 * WC, y + 0.052 * WC)
        ctx.lineTo(cx + 0.016 * WC, y + 0.052 * WC)
        ctx.stroke()
      }
    }
    ctx.restore()
  }
  strap(-10, cy - 0.3 * WC, false)
  strap(cy + 0.3 * WC, h + 10, true)
}

function watchBake(ctx: CanvasRenderingContext2D, L: Layout) {
  const WC = L.ow
  const R = WC / 2
  ctx.save()
  ctx.translate(L.cx, L.cy)
  // crown and a flat button on the right edge
  ctx.fillStyle = metal(ctx, R, -0.2 * WC, R + 0.07 * WC, -0.05 * WC)
  ctx.beginPath()
  rrPath(ctx, R - 0.03 * WC, -0.2 * WC, 0.09 * WC, 0.13 * WC, 0.025 * WC)
  ctx.fill()
  ctx.strokeStyle = 'rgba(40,44,50,0.4)'
  ctx.lineWidth = 0.7
  for (let k = 1; k < 7; k++) {
    const y = -0.2 * WC + (k * 0.13 * WC) / 7
    ctx.beginPath()
    ctx.moveTo(R + 0.02 * WC, y)
    ctx.lineTo(R + 0.058 * WC, y)
    ctx.stroke()
  }
  ctx.fillStyle = metal(ctx, R, 0.05 * WC, R + 0.04 * WC, 0.25 * WC)
  ctx.beginPath()
  rrPath(ctx, R - 0.03 * WC, 0.06 * WC, 0.055 * WC, 0.17 * WC, 0.02 * WC)
  ctx.fill()
  // polished case
  ctx.fillStyle = metal(ctx, -R, -R, R, R)
  ctx.beginPath()
  ctx.arc(0, 0, R, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#0B0C0F'
  ctx.beginPath()
  ctx.arc(0, 0, 0.465 * WC, 0, TAU)
  ctx.fill()
  // black glass with a domed edge
  const gr = 0.45 * WC
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr)
  g.addColorStop(0, '#030406')
  g.addColorStop(0.9, '#06070A')
  g.addColorStop(1, '#1B1E25')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, gr, 0, TAU)
  ctx.fill()
  // twelve ticks, the date window frame, one complication ring
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU
    const r0 = i % 3 ? 0.37 * WC : 0.34 * WC
    ctx.strokeStyle = i % 3 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.92)'
    ctx.lineWidth = i % 3 ? 1.2 : 2.4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0)
    ctx.lineTo(Math.sin(a) * 0.41 * WC, -Math.cos(a) * 0.41 * WC)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(53,208,186,0.25)'
  ctx.lineWidth = 0.022 * WC
  ctx.beginPath()
  ctx.arc(0, 0.19 * WC, 0.07 * WC, 0, TAU)
  ctx.stroke()
  ctx.strokeStyle = '#35D0BA'
  ctx.beginPath()
  ctx.arc(0, 0.19 * WC, 0.07 * WC, -Math.PI / 2, -Math.PI / 2 + 0.72 * TAU)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  rrPath(ctx, 0.2 * WC, -0.035 * WC, 0.1 * WC, 0.07 * WC, 0.012 * WC)
  ctx.stroke()
  // the dome's bright rim line, upper left
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.arc(0, 0, gr - 1.5, 1.05 * Math.PI, 1.55 * Math.PI)
  ctx.stroke()
  const dg = ctx.createRadialGradient(-0.18 * WC, -0.2 * WC, 0, -0.18 * WC, -0.2 * WC, 0.3 * WC)
  dg.addColorStop(0, 'rgba(255,255,255,0.07)')
  dg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = dg
  ctx.beginPath()
  ctx.arc(0, 0, gr, 0, TAU)
  ctx.fill()
  ctx.restore()
}

function hand(ctx: CanvasRenderingContext2D, a: number, len: number, tail: number, wdt: number, col: string) {
  ctx.strokeStyle = col
  ctx.lineWidth = wdt
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-Math.sin(a) * tail, Math.cos(a) * tail)
  ctx.lineTo(Math.sin(a) * len, -Math.cos(a) * len)
  ctx.stroke()
}

/** The real local time: hands, a moving second hand and the date. */
function watchLive(ctx: CanvasRenderingContext2D, L: Layout, s: { date: Date; on: boolean }) {
  const WC = L.ow
  const d = s.date
  const sec = d.getSeconds()
  const min = d.getMinutes() + sec / 60
  const hr = (d.getHours() % 12) + min / 60
  ctx.save()
  ctx.translate(L.cx, L.cy)
  // under the film the screen is in its dim always-on mode; the printed 10:09 is what you read
  if (s.on) ctx.globalAlpha = 0.3
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = `600 ${0.045 * WC}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(d.getDate()), 0.25 * WC, 0.002 * WC)
  hand(ctx, (hr / 12) * TAU, 0.22 * WC, 0.03 * WC, 0.028 * WC, '#F2F3F5')
  hand(ctx, (min / 60) * TAU, 0.34 * WC, 0.03 * WC, 0.02 * WC, '#F2F3F5')
  hand(ctx, (sec / 60) * TAU, 0.38 * WC, 0.06 * WC, 0.007 * WC, '#FF7A45')
  ctx.fillStyle = '#FF7A45'
  ctx.beginPath()
  ctx.arc(0, 0, 0.018 * WC, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** The film's printed watch face: flat grey ink, hands at 10:09, a little off-centre. */
function watchPrint(ctx: CanvasRenderingContext2D, L: Layout) {
  const { fw, fh, F } = L
  const ink = 'rgba(178,182,190,0.92)'
  ctx.save()
  ctx.translate(fw / 2 + 0.018 * F, fh / 2 - 0.012 * F)
  ctx.strokeStyle = ink
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU
    ctx.lineWidth = i % 3 ? 1.2 : 2.6
    ctx.beginPath()
    ctx.moveTo(Math.sin(a) * 0.38 * F, -Math.cos(a) * 0.38 * F)
    ctx.lineTo(Math.sin(a) * 0.44 * F, -Math.cos(a) * 0.44 * F)
    ctx.stroke()
  }
  hand(ctx, ((10 + 9 / 60) / 12) * TAU, 0.25 * F, 0.04 * F, 0.045 * F, ink)
  hand(ctx, (9 / 60) * TAU, 0.38 * F, 0.04 * F, 0.03 * F, ink)
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.arc(0, 0, 0.02 * F, 0, TAU)
  ctx.fill()
  ctx.restore()
}

// ------------------------------------- car: the centre screen -------------------------------------

function carGround(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) {
  const { w, h, cx, cy } = L
  const SW = L.ow
  const SH = L.oh
  ctx.fillStyle = '#2A2C30'
  ctx.fillRect(0, 0, w, h)
  drawNoise(ctx, 0, 0, w, h, 2, rnd, '255,255,255', 0.035)
  drawNoise(ctx, 0, 0, w, h, 80, rnd, '0,0,0', 0.12)
  // the leather upper with its stitched seam
  const sy = cy - SH / 2 - 0.2 * SW
  const lg = ctx.createLinearGradient(0, 0, 0, sy)
  lg.addColorStop(0, '#2E2B29')
  lg.addColorStop(1, '#25231F')
  ctx.fillStyle = lg
  ctx.fillRect(0, 0, w, sy)
  drawNoise(ctx, 0, 0, w, sy, 5, rnd, '0,0,0', 0.12)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(0, sy - 1, w, 2)
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(0, sy + 1, w, 1)
  ctx.strokeStyle = 'rgba(190,170,140,0.55)'
  ctx.lineWidth = 1.1
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(0, sy - 6)
  ctx.lineTo(w, sy - 6)
  ctx.stroke()
  ctx.setLineDash([])
  // two air vents below the screen with a hazard button between them
  const vy = cy + SH / 2 + 0.16 * SW
  const vw = 0.4 * SW
  const vh = 0.16 * SW
  for (const sx of [-1, 1]) {
    const vx = cx + sx * 0.27 * SW - vw / 2
    ctx.fillStyle = '#121316'
    ctx.beginPath()
    rrPath(ctx, vx, vy, vw, vh, 0.03 * SW)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    ctx.stroke()
    for (let k = 1; k < 5; k++) {
      const y = vy + (k * vh) / 5
      ctx.fillStyle = '#26282D'
      ctx.fillRect(vx + 4, y - 1.6, vw - 8, 3.2)
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.fillRect(vx + 4, y - 1.6, vw - 8, 0.8)
    }
    // chrome thumbwheel
    const tw = 0.03 * SW
    ctx.fillStyle = metal(ctx, vx + vw / 2 - tw, vy, vx + vw / 2 + tw, vy + vh)
    ctx.beginPath()
    rrPath(ctx, vx + vw / 2 - tw / 2, vy + vh * 0.15, tw, vh * 0.7, tw / 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(30,30,30,0.35)'
    ctx.lineWidth = 0.6
    for (let k = 1; k < 8; k++) {
      const y = vy + vh * 0.15 + (k * vh * 0.7) / 8
      ctx.beginPath()
      ctx.moveTo(vx + vw / 2 - tw / 2 + 1, y)
      ctx.lineTo(vx + vw / 2 + tw / 2 - 1, y)
      ctx.stroke()
    }
  }
  const hb = 0.075 * SW
  const hx = cx - hb / 2
  const hy = vy + vh / 2 - hb / 2
  ctx.fillStyle = '#1A1B1F'
  ctx.beginPath()
  rrPath(ctx, hx, hy, hb, hb, 0.015 * SW)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.stroke()
  ctx.strokeStyle = '#D0352E'
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, hy + hb * 0.22)
  ctx.lineTo(cx + hb * 0.3, hy + hb * 0.74)
  ctx.lineTo(cx - hb * 0.3, hy + hb * 0.74)
  ctx.closePath()
  ctx.stroke()
  groundLight(ctx, L, 0.1, 0.25)
}

const carScreen = (L: Layout) => {
  const b = 0.04 * L.ow
  return { x: -L.ow / 2 + b, y: -L.oh / 2 + b, w: L.ow - 2 * b, h: L.oh - 2 * b }
}

function carBake(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) {
  const SW = L.ow
  ctx.save()
  ctx.translate(L.cx, L.cy)
  // piano-black bezel with a long soft reflection
  ctx.beginPath()
  objectPath(ctx, L)
  ctx.fillStyle = '#060708'
  ctx.fill()
  ctx.save()
  ctx.clip()
  const rg = ctx.createLinearGradient(-SW / 2, -L.oh / 2, -SW / 2 + 0.3 * SW, L.oh / 2)
  rg.addColorStop(0, 'rgba(255,255,255,0.16)')
  rg.addColorStop(0.5, 'rgba(255,255,255,0.04)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = rg
  ctx.fillRect(-SW / 2, -L.oh / 2, SW, L.oh)
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  objectPath(ctx, L, -0.5)
  ctx.stroke()
  // the screen: a dark map
  const S = carScreen(L)
  ctx.save()
  ctx.beginPath()
  rrPath(ctx, S.x, S.y, S.w, S.h, 0.012 * SW)
  ctx.clip()
  ctx.fillStyle = '#121820'
  ctx.fillRect(S.x, S.y, S.w, S.h)
  ctx.strokeStyle = '#1B232E'
  ctx.lineWidth = 1
  for (let i = 0; i < 18; i++) {
    ctx.beginPath()
    const x = S.x + rnd() * S.w
    ctx.moveTo(x, S.y)
    ctx.lineTo(x + (rnd() - 0.5) * 60, S.y + S.h)
    ctx.stroke()
  }
  ctx.strokeStyle = '#3A4A5C'
  ctx.lineCap = 'round'
  const road = (pts: number[], wdt: number) => {
    ctx.lineWidth = wdt
    ctx.beginPath()
    for (let i = 0; i < pts.length; i += 2) {
      const x = S.x + pts[i] * S.w
      const y = S.y + pts[i + 1] * S.h
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.stroke()
  }
  road([0, 0.62, 0.3, 0.58, 0.55, 0.66, 1, 0.6], 5)
  road([0.42, 0, 0.45, 0.35, 0.5, 1], 4)
  road([0.15, 0, 0.2, 0.5, 0.12, 1], 2.5)
  road([0.7, 0, 0.75, 0.4, 0.95, 1], 2.5)
  road([0, 0.25, 0.5, 0.22, 1, 0.3], 2.5)
  ctx.strokeStyle = '#4DA3FF'
  ctx.lineJoin = 'round'
  road([0.3, 0.58, 0.45, 0.35, 0.72, 0.28, 0.75, 0.1], 5)
  // location arrow
  const ax = S.x + 0.3 * S.w
  const ay = S.y + 0.58 * S.h
  ctx.fillStyle = 'rgba(77,163,255,0.25)'
  ctx.beginPath()
  ctx.arc(ax, ay, 0.05 * SW, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.beginPath()
  ctx.moveTo(ax + 0.022 * SW, ay - 0.022 * SW)
  ctx.lineTo(ax - 0.02 * SW, ay - 0.005 * SW)
  ctx.lineTo(ax - 0.002 * SW, ay)
  ctx.lineTo(ax + 0.005 * SW, ay + 0.02 * SW)
  ctx.closePath()
  ctx.fill()
  // temperature and a dock of five generic glyphs
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = `500 ${0.04 * SW}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText('22.5°', S.x + 0.03 * S.w, S.y + 0.05 * S.h)
  const dh = 0.2 * S.h
  ctx.fillStyle = 'rgba(10,12,16,0.78)'
  ctx.fillRect(S.x, S.y + S.h - dh, S.w, dh)
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 1.4
  const gs = 0.3 * dh
  for (let i = 0; i < 5; i++) {
    const gx = S.x + ((i + 0.5) / 5) * S.w
    const gy = S.y + S.h - dh / 2
    ctx.beginPath()
    if (i === 0) {
      ctx.moveTo(gx - gs, gy)
      ctx.lineTo(gx, gy - gs)
      ctx.lineTo(gx + gs, gy)
      ctx.moveTo(gx - gs * 0.7, gy - gs * 0.3)
      ctx.lineTo(gx - gs * 0.7, gy + gs)
      ctx.lineTo(gx + gs * 0.7, gy + gs)
      ctx.lineTo(gx + gs * 0.7, gy - gs * 0.3)
    } else if (i === 1) {
      ctx.arc(gx - gs * 0.4, gy + gs * 0.6, gs * 0.3, 0, TAU)
      ctx.moveTo(gx - gs * 0.1, gy + gs * 0.6)
      ctx.lineTo(gx - gs * 0.1, gy - gs)
      ctx.lineTo(gx + gs * 0.7, gy - gs * 0.7)
    } else if (i === 2) {
      ctx.arc(gx, gy, gs, 0, TAU)
      ctx.moveTo(gx + gs * 0.3, gy)
      ctx.arc(gx, gy, gs * 0.3, 0, TAU)
    } else if (i === 3) {
      for (let k = 0; k < 3; k++) {
        ctx.moveTo(gx, gy)
        ctx.ellipse(gx + Math.cos((k * TAU) / 3) * gs * 0.5, gy + Math.sin((k * TAU) / 3) * gs * 0.5, gs * 0.5, gs * 0.22, (k * TAU) / 3, 0, TAU)
      }
    } else {
      for (let k = 0; k < 4; k++) ctx.rect(gx - gs + (k % 2) * gs * 1.1, gy - gs + Math.floor(k / 2) * gs * 1.1, gs * 0.85, gs * 0.85)
    }
    ctx.stroke()
  }
  ctx.restore()
  ctx.restore()
}

function carLive(ctx: CanvasRenderingContext2D, L: Layout, s: { date: Date; frozen: boolean }) {
  const S = carScreen(L)
  ctx.save()
  ctx.translate(L.cx, L.cy)
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.font = `600 ${0.04 * L.ow}px system-ui, sans-serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  const h = s.date.getHours()
  const tt = s.frozen ? `${String(h).padStart(2, '0')}:${String(s.date.getMinutes()).padStart(2, '0')}` : clockText(s.date)
  ctx.fillText(tt, S.x + S.w - 0.03 * S.w, S.y + 0.05 * S.h)
  ctx.restore()
}

/** The dealer's work: 20 dust specks, one hair, and the squeegee's three faint arcs. */
function carPrint(ctx: CanvasRenderingContext2D, L: Layout) {
  const { fw, fh, F } = L
  let a = 977
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647)
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 2.5
  for (let k = 0; k < 3; k++) {
    ctx.beginPath()
    ctx.arc(fw * 0.42, fh * 2.1 + k * 7, fh * 1.75, 1.32 * Math.PI, 1.66 * Math.PI)
    ctx.stroke()
  }
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.45 + 0.4 * r()})`
    ctx.beginPath()
    ctx.arc(r() * fw, r() * fh, 0.5 + r() * 0.9, 0, TAU)
    ctx.fill()
  }
  // one hair
  const hx = fw * 0.62
  const hy = fh * 0.3
  const hl = 0.12 * F
  ctx.strokeStyle = 'rgba(40,30,20,0.5)'
  ctx.lineWidth = 0.7
  ctx.beginPath()
  ctx.moveTo(hx, hy)
  ctx.bezierCurveTo(hx + hl * 0.4, hy - hl * 0.35, hx + hl * 0.6, hy + hl * 0.3, hx + hl, hy + hl * 0.05)
  ctx.stroke()
}

// ------------------------------------- micro: the microwave panel -------------------------------------

function microGround(ctx: CanvasRenderingContext2D, L: Layout, rnd: () => number) {
  const { w, h, cx } = L
  const MW = L.ow
  const x0 = cx - MW / 2
  const x1 = cx + MW / 2
  // the microwave's dark front around the panel
  const fg = ctx.createLinearGradient(0, 0, 0, h)
  fg.addColorStop(0, '#2A2B2F')
  fg.addColorStop(1, '#18191C')
  ctx.fillStyle = fg
  ctx.fillRect(0, 0, w, h)
  drawNoise(ctx, x0, 0, MW, h, 3, rnd, '255,255,255', 0.04)
  // the door: frame, then the dark mesh window
  ctx.fillStyle = '#26272B'
  ctx.fillRect(0, 0, x0, h)
  ctx.fillStyle = '#0F1012'
  ctx.fillRect(0, 0.07 * h, x0 - 0.06 * MW, 0.86 * h)
  ctx.fillStyle = '#1A1B1E'
  for (let y = 0.07 * h + 3; y < 0.93 * h; y += 5) for (let x = (y / 5) % 2 ? 2.5 : 0; x < x0 - 0.06 * MW; x += 5) {
    ctx.beginPath()
    ctx.arc(x, y, 1.4, 0, TAU)
    ctx.fill()
  }
  const wg = ctx.createLinearGradient(0, 0, x0, h)
  wg.addColorStop(0, 'rgba(255,255,255,0.08)')
  wg.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.fillStyle = wg
  ctx.fillRect(0, 0, x0, h)
  // brushed steel body edge to the right
  const sg = ctx.createLinearGradient(x1, 0, w, 0)
  sg.addColorStop(0, '#9EA3AA')
  sg.addColorStop(0.3, '#C3C7CC')
  sg.addColorStop(1, '#A7ACB3')
  ctx.fillStyle = sg
  ctx.fillRect(x1, 0, w - x1, h)
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(90,96,104,0.12)'
    ctx.fillRect(x1 + rnd() * (w - x1), rnd() * h, 10 + rnd() * 60, 1 / L.dpr)
  }
  groundLight(ctx, L, 0.2, 0.2)
}

function microBake(ctx: CanvasRenderingContext2D, L: Layout) {
  const MW = L.ow
  const MH = L.oh
  ctx.save()
  ctx.translate(L.cx, L.cy)
  ctx.beginPath()
  objectPath(ctx, L)
  const g = ctx.createLinearGradient(-MW / 2, -MH / 2, MW / 2, MH / 2)
  g.addColorStop(0, '#16181B')
  g.addColorStop(0.4, '#0C0D0F')
  g.addColorStop(1, '#08090A')
  ctx.fillStyle = g
  ctx.fill()
  ctx.save()
  ctx.clip()
  const rg = ctx.createLinearGradient(-MW / 2, -MH / 2, MW / 2, -MH / 2 + MW)
  rg.addColorStop(0, 'rgba(255,255,255,0.09)')
  rg.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.fillStyle = rg
  ctx.fillRect(-MW / 2, -MH / 2, MW, MH)
  ctx.restore()
  const x0 = -MW / 2 + 0.035 * MW // right of the trim
  const iw = MW / 2 - x0
  const mx = x0 + iw / 2
  // display "0:00", white seven-segment, colon steady
  const dy = -MH / 2 + 0.07 * MH
  const dh = 0.11 * MH
  ctx.fillStyle = '#050607'
  ctx.beginPath()
  rrPath(ctx, x0 + 0.1 * iw, dy, 0.8 * iw, dh, 0.03 * MW)
  ctx.fill()
  seg7(ctx, '0:00', mx, dy + dh / 2, 0.5 * dh)
  // the keys: 2 rows of functions (icon + label), 2 rows of numbers, then STOP and START
  const lab = [0, 1, 2, 3, 4, 5].map((i) => tx(`peel_micro_l${i}`))
  const kw = 0.24 * iw
  const kh = 0.075 * MH
  const gx = 0.3 * iw
  const ky0 = -MH / 2 + 0.25 * MH
  const gy = 0.115 * MH
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < 12; i++) {
    const x = mx + ((i % 3) - 1) * gx
    const y = ky0 + Math.floor(i / 3) * gy
    ctx.beginPath()
    rrPath(ctx, x - kw / 2, y - kh / 2, kw, kh, kh / 2)
    ctx.stroke()
    if (i < 6) {
      microIcon(ctx, i, x, y - 0.012 * MH, 0.016 * MH)
      ctx.font = `500 ${Math.min(0.022 * MH, (1.25 * kw) / Math.max(4, lab[i].length))}px system-ui, sans-serif`
      ctx.fillText(lab[i], x, y + kh / 2 + 0.018 * MH)
    } else {
      ctx.font = `500 ${0.03 * MH}px system-ui, sans-serif`
      ctx.fillText(String(i - 5), x, y)
    }
  }
  const by = ky0 + 4 * gy + 0.01 * MH
  const bw = 0.8 * iw
  for (const [txt, col, y] of [['STOP', '#FF453A', by], ['START', '#4CD964', by + 0.1 * MH]] as const) {
    ctx.strokeStyle = col
    ctx.lineWidth = 1.4
    ctx.beginPath()
    rrPath(ctx, mx - bw / 2, y - kh / 2, bw, kh, kh / 2)
    ctx.stroke()
    ctx.fillStyle = col
    ctx.font = `700 ${0.026 * MH}px system-ui, sans-serif`
    ctx.fillText(txt, mx, y)
  }
  // the door release: a wide brushed button at the bottom
  const dy2 = MH / 2 - 0.12 * MH
  ctx.fillStyle = metal(ctx, mx - bw / 2, dy2, mx + bw / 2, dy2 + 0.08 * MH)
  ctx.beginPath()
  rrPath(ctx, mx - bw / 2, dy2, bw, 0.075 * MH, 0.012 * MH)
  ctx.fill()
  ctx.strokeStyle = 'rgba(40,44,50,0.7)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(mx - 0.06 * iw, dy2 + 0.045 * MH)
  ctx.lineTo(mx, dy2 + 0.028 * MH)
  ctx.lineTo(mx + 0.06 * iw, dy2 + 0.045 * MH)
  ctx.stroke()
  ctx.restore()
}

function microIcon(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, s: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (i === 0) {
    // popcorn bucket
    ctx.moveTo(-0.7 * s, -0.3 * s)
    ctx.lineTo(-0.45 * s, s)
    ctx.lineTo(0.45 * s, s)
    ctx.lineTo(0.7 * s, -0.3 * s)
    ctx.moveTo(-0.35 * s, -0.4 * s)
    ctx.arc(-0.35 * s, -0.55 * s, 0.3 * s, 0.5 * Math.PI, 2.2 * Math.PI)
    ctx.arc(0.25 * s, -0.6 * s, 0.32 * s, 1 * Math.PI, 2.6 * Math.PI)
  } else if (i === 1) {
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3
      ctx.moveTo(Math.cos(a) * s, Math.sin(a) * s)
      ctx.lineTo(-Math.cos(a) * s, -Math.sin(a) * s)
    }
  } else if (i === 2) {
    ctx.arc(0, 0, s, -0.5 * Math.PI, Math.PI)
    ctx.moveTo(0, -0.55 * s)
    ctx.lineTo(0, 0)
    ctx.lineTo(0.4 * s, 0.25 * s)
  } else if (i === 3) {
    ctx.moveTo(-0.6 * s, -0.6 * s)
    ctx.lineTo(-0.45 * s, s)
    ctx.lineTo(0.45 * s, s)
    ctx.lineTo(0.6 * s, -0.6 * s)
    ctx.moveTo(0.6 * s, -0.2 * s)
    ctx.arc(0.75 * s, 0.15 * s, 0.32 * s, -0.5 * Math.PI, 0.5 * Math.PI)
  } else if (i === 4) {
    ctx.ellipse(0, 0.3 * s, s, 0.35 * s, 0, 0, TAU)
    ctx.moveTo(-0.3 * s, -0.3 * s)
    ctx.quadraticCurveTo(-0.5 * s, -0.7 * s, -0.25 * s, -s)
    ctx.moveTo(0.2 * s, -0.3 * s)
    ctx.quadraticCurveTo(0, -0.7 * s, 0.25 * s, -s)
  } else {
    ctx.arc(0, 0, s, 0, TAU)
    ctx.moveTo(0, -0.6 * s)
    ctx.lineTo(0, 0)
    ctx.lineTo(0.45 * s, 0)
  }
  ctx.stroke()
  ctx.restore()
}

/** White seven-segment digits (and a steady colon), centred at (x, y), digit height h. */
function seg7(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, h: number) {
  const SEG: Record<string, number[]> = { '0': [0, 1, 2, 3, 4, 5] }
  const dw = 0.52 * h
  const th = 0.12 * h
  const gap = 0.42 * dw
  const total = 3 * dw + 2 * gap + 1.6 * gap
  let ox = x - total / 2
  const top = y - h / 2
  ctx.save()
  ctx.shadowColor = 'rgba(255,255,255,0.5)'
  ctx.shadowBlur = 4
  ctx.strokeStyle = ctx.fillStyle = '#F4F6F8'
  ctx.lineWidth = th
  ctx.lineCap = 'round'
  for (const ch of s) {
    if (ch === ':') {
      for (const fy of [0.3, 0.7]) {
        ctx.beginPath()
        ctx.arc(ox + gap * 0.3, top + fy * h, th * 0.55, 0, TAU)
        ctx.fill()
      }
      ox += 1.6 * gap
      continue
    }
    const pts: [number, number, number, number][] = [
      [0, 0, dw, 0],
      [dw, 0, dw, h / 2],
      [dw, h / 2, dw, h],
      [0, h, dw, h],
      [0, h / 2, 0, h],
      [0, 0, 0, h / 2],
    ]
    for (const k of SEG[ch] ?? []) {
      const [x1, y1, x2, y2] = pts[k]
      const sk = th * 0.5
      ctx.beginPath()
      ctx.moveTo(ox + x1 + (x1 === x2 ? 0 : sk) - (y1 / h) * th * 0.6, top + y1 + (y1 === y2 ? 0 : sk))
      ctx.lineTo(ox + x2 - (x1 === x2 ? 0 : sk) - (y2 / h) * th * 0.6, top + y2 - (y1 === y2 ? 0 : sk))
      ctx.stroke()
    }
    ox += dw + gap
  }
  ctx.restore()
}

/** The vertical chrome trim down the panel's left edge, drawn above the film and the flap. */
function microTrim(ctx: CanvasRenderingContext2D, L: Layout) {
  const MW = L.ow
  const MH = L.oh
  const tw = 0.035 * MW
  ctx.save()
  ctx.translate(L.cx, L.cy)
  const x = -MW / 2
  // its shadow on the film beside it
  const sg = ctx.createLinearGradient(x + tw, 0, x + tw + 4, 0)
  sg.addColorStop(0, 'rgba(0,0,0,0.35)')
  sg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sg
  ctx.fillRect(x + tw, -MH / 2, 4, MH)
  const g = ctx.createLinearGradient(x, 0, x + tw, 0)
  g.addColorStop(0, '#6E747C')
  g.addColorStop(0.35, '#F2F4F6')
  g.addColorStop(0.7, '#9AA0A8')
  g.addColorStop(1, '#5A6068')
  ctx.fillStyle = g
  ctx.beginPath()
  rrPath(ctx, x - 1, -MH / 2 - 2, tw + 1, MH + 4, 1.5)
  ctx.fill()
  ctx.restore()
}

function microPrint(ctx: CanvasRenderingContext2D, L: Layout) {
  const { fw, fh, F } = L
  ctx.save()
  ctx.translate(fw - 0.07 * F, fh * 0.62)
  ctx.rotate(Math.PI / 2)
  ctx.fillStyle = 'rgba(150,156,166,0.8)'
  ctx.font = `600 ${0.04 * F}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(tx('peel_remove'), 0, 0)
  ctx.restore()
}

// ------------------------------------- what is left after the peel -------------------------------------

/** The microwave's torn edge along the trim: a noisy line at sx0 (0.006 F), with the corner triangle once it tore. */
function tornEdge(L: Layout, torn: boolean): Poly {
  const { sx0, fh, F } = L
  const n = (y: number) => 0.006 * F * (Math.sin(y * 0.21) * 0.5 + Math.sin(y * 0.53 + 1) * 0.3 + Math.sin(y * 1.37 + 2) * 0.2)
  const t = torn ? 0.05 * F : 0
  const pts: Poly = []
  for (let y = -2; y < fh - t; y += 2) pts.push([sx0 + n(y), y])
  if (torn) for (let k = 0; k <= 6; k++) pts.push([sx0 + (k / 6) * t + n(k * 7) * 0.8, fh - t + (k / 6) * t])
  pts.push([sx0 + t + n(fh), fh + 2])
  return pts
}

/** The sliver of film left under the trim: drawn wherever the fold has passed (or all of it once the film is off). */
function drawSliver(ctx: CanvasRenderingContext2D, L: Layout, B: Bakes, st: FilmState, all: boolean) {
  const M = filmMatrix(L)
  const d = L.dpr
  ctx.save()
  ctx.setTransform(M[0] * d, M[1] * d, M[2] * d, M[3] * d, M[4] * d + (st.flick ? d : 0), M[5] * d)
  ctx.beginPath()
  rrPath(ctx, -1.5, -1.5, L.fw + 3, L.fh + 3, L.frad + 1.5)
  ctx.clip()
  if (!all) {
    ctx.beginPath()
    halfPlane(ctx, st.peel.A, st.peel.u, st.peel.m, true)
    ctx.clip()
  }
  const edge = tornEdge(L, st.torn)
  ctx.beginPath()
  ctx.moveTo(-4, -4)
  for (const p of edge) ctx.lineTo(p[0], p[1])
  ctx.lineTo(-4, L.fh + 4)
  ctx.closePath()
  ctx.save()
  ctx.clip()
  const tex = B.film
  ctx.drawImage(tex.front, -tex.pad, -tex.pad, L.fw + 2 * tex.pad, L.fh + 2 * tex.pad)
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.fill()
  ctx.restore()
  ctx.beginPath()
  edge.forEach((p, i) => (i ? ctx.lineTo(p[0] + 0.7, p[1] + 0.6) : ctx.moveTo(p[0] + 0.7, p[1] + 0.6)))
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'
  ctx.lineWidth = 0.8
  ctx.stroke()
  ctx.beginPath()
  edge.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 0.9
  ctx.stroke()
  ctx.restore()
}

/** The watch's film off: a small stiff disc, slightly dished, its clear tab with the red dot. */
function drawDisc(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number, alpha: number) {
  const R = (size * 1.1) / 1.3 / 2
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  ctx.fillStyle = 'rgba(15,18,25,0.12)'
  ctx.beginPath()
  ctx.ellipse(0.18 * R, 0.24 * R, R, R * 0.9, rot, 0, Math.PI * 2)
  ctx.fill()
  ctx.rotate(rot)
  ctx.scale(1, 0.9)
  const g = ctx.createRadialGradient(-0.3 * R, -0.35 * R, 0, 0, 0, R)
  g.addColorStop(0, 'rgba(255,255,255,0.45)')
  g.addColorStop(0.6, 'rgba(235,240,250,0.22)')
  g.addColorStop(1, 'rgba(200,210,225,0.4)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 0.9
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.beginPath()
  ctx.arc(0, 0, R * 0.8, 1.1 * Math.PI, 1.5 * Math.PI)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  rrPath(ctx, R * 0.62, R * 0.45, R * 0.5, R * 0.32, R * 0.1)
  ctx.fill()
  ctx.fillStyle = '#E5342B'
  ctx.beginPath()
  ctx.arc(R * 0.87, R * 0.61, R * 0.07, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** One fingerprint (the car screen's first touch): a faint whorl, css px. */
function drawPrint(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const rr = size / 2
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-0.4)
  ctx.scale(1, 0.78)
  ctx.lineWidth = 1.1
  ctx.strokeStyle = 'rgba(255,250,235,0.10)'
  for (let k = 2; k < 9; k++) {
    ctx.beginPath()
    ctx.ellipse(0, 0, (rr * k) / 9, (rr * k) / 9.6, 0, 0.3 + k * 0.07, Math.PI * 2 - 0.5 + k * 0.05)
    ctx.stroke()
  }
  ctx.restore()
}

// ------------------------------------- the table entries -------------------------------------

const CAM: ObjDef = {
  ix: 3,
  salt: 41,
  size(w, h) {
    const IW = Math.min(0.7 * w, 0.44 * h, 400)
    return { ow: IW, oh: IW, orad: 0.24 * IW, rot: 0, cy: 0.46 * h }
  },
  film(ow) {
    const i = 0.02 * ow
    return { fw: ow - 2 * i, fh: ow - 2 * i, frad: 0.22 * ow }
  },
  corner: 'br',
  tab: 'yellow',
  tMin: 0,
  tint: 'rgba(255,255,255,0.14)',
  flapTint: 'rgba(225,232,245,0.22)',
  wadTint: '235,240,250',
  wadA: 0.3,
  haze: 0.1,
  glare: 'bands2',
  scratches: 24,
  print: (ctx, L) => printNumber(ctx, L, '2'),
  bubbles: (L, rnd) => {
    const n = 2 + Math.floor(rnd() * 3)
    const lp = lensAt(L.ow)[1]
    return bubblesAt(L, rnd, n, 0.02, 0.04, (i) => (i ? inside(L, rnd, 0.15) : [L.fw / 2 + lp[0] + 0.04 * L.F, L.fh / 2 + lp[1] - 0.03 * L.F]))
  },
  rim: ['0,0,0', 0.16],
  adhesion: 1.1,
  curl: 1,
  sound: { pitch: 1.15, gain: 1, crinkle: 0, rateCap: 120 },
  ground: camGround,
  well: false,
  bakeBase: camBake,
  live: camLive,
  afterLine: () => 'peel_cam_after',
  afterOnce: true,
}

const WATCH: ObjDef = {
  ix: 4,
  salt: 43,
  size(w, h) {
    const WC = Math.min(0.66 * w, 0.4 * h, 380)
    return { ow: WC, oh: WC, orad: WC / 2, rot: 0 }
  },
  film(ow) {
    const d = 0.8 * ow
    return { fw: d, fh: d, frad: d / 2 }
  },
  corner: 'br',
  tab: 'clear',
  tMin: 30,
  round: true,
  tint: 'rgba(255,255,255,0.10)',
  flapTint: 'rgba(225,232,245,0.24)',
  wadTint: '235,240,250',
  wadA: 0.35,
  haze: 0.04,
  glare: 'band1',
  scratches: 10,
  print: watchPrint,
  bubbles: [1, 2, 0.02, 0.01],
  rim: ['0,0,0', 0.16],
  adhesion: 0.6,
  curl: 1.8,
  sound: { pitch: 1.5, gain: 0.8, crinkle: 0, rateCap: 60 },
  ground: watchGround,
  well: false,
  bakeBase: watchBake,
  live: watchLive,
  wad: drawDisc,
  zip: [0.55, 0.1],
  afterLine: (d) => (d.getHours() % 12 === 10 && d.getMinutes() === 9 ? 'peel_watch_1009' : 'peel_watch_after'),
}

const CAR: ObjDef = {
  ix: 5,
  salt: 47,
  size(w, h) {
    const SW = Math.min(0.92 * w, ((0.6 * h) * 16) / 9, 620)
    return { ow: SW, oh: (SW * 9) / 16, orad: 0.03 * SW, rot: 0, cy: 0.42 * h }
  },
  film(ow, oh, orad) {
    const i = 0.01 * ow
    return { fw: ow - 2 * i, fh: oh - 2 * i, frad: orad - i }
  },
  corner: 'br',
  tab: 'white-arrow',
  tMin: 30,
  tint: 'rgba(255,255,255,0.16)',
  flapTint: 'rgba(225,232,245,0.22)',
  wadTint: '235,240,250',
  wadA: 0.3,
  haze: 0.07,
  // wider and flatter than the phone's two bands
  glare: (_ctx, L, band) => {
    band(-0.1 * L.fh, 0.9 * L.fw, 0.12)
    band(0.7 * L.fh, 0.6 * L.fw, 0.07)
  },
  scratches: 30,
  print: carPrint,
  // the dealer's 14 to 18 bubbles, in two clusters
  bubbles: (L, rnd) => {
    const n = 14 + Math.floor(rnd() * 5)
    const C: V[] = [
      [0.3 * L.fw, 0.38 * L.fh],
      [0.7 * L.fw, 0.66 * L.fh],
    ]
    return bubblesAt(L, rnd, n, 0.015, 0.07, (i) => {
      const c = C[i % 2]
      const a = rnd() * TAU
      const d = (0.03 + rnd() * 0.14) * L.F
      return [Math.min(L.fw - 8, Math.max(8, c[0] + Math.cos(a) * d * 1.6)), Math.min(L.fh - 8, Math.max(8, c[1] + Math.sin(a) * d))]
    })
  },
  rim: ['0,0,0', 0.18],
  adhesion: 1,
  curl: 1,
  sound: { pitch: 0.95, gain: 1, crinkle: 0, rateCap: 120 },
  ground: carGround,
  well: false,
  bakeBase: carBake,
  live: carLive,
  chat: { who: 'peel_dealer', warn: 'peel_dealer_warn', good: 'peel_dealer_good', ga: 'dealer' },
  touch: drawPrint,
}

const MICRO: ObjDef = {
  ix: 6,
  salt: 53,
  size(w, h) {
    const MW = Math.min(0.52 * w, (0.74 * h) / 2.4, 300)
    return { ow: MW, oh: 2.4 * MW, orad: 0.03 * MW, rot: 0 }
  },
  film(ow, oh) {
    // tucked 0.03 F under the trim on the left; 0.02 MW in from the other three edges
    const vis = ow - 0.035 * ow - 0.02 * ow
    const fw = vis / 0.97
    const F = fw
    const left = -ow / 2 + 0.035 * ow - 0.03 * F
    const right = ow / 2 - 0.02 * ow
    return { fw, fh: oh - 0.04 * ow, frad: 0.012 * ow, fx: (left + right) / 2, sx0: 0.052 * F }
  },
  corner: 'tr',
  tab: 'yellow',
  tMin: 30,
  tint: 'rgba(255,255,255,0.12)',
  flapTint: 'rgba(225,232,245,0.22)',
  wadTint: '235,240,250',
  wadA: 0.3,
  haze: 0.05,
  glare: 'band1',
  scratches: 24,
  print: microPrint,
  bubbles: [3, 5, 0.02, 0.03],
  rim: ['0,0,0', 0.16],
  adhesion: 1,
  curl: 1,
  sound: { pitch: 1, gain: 1, crinkle: 0, rateCap: 120 },
  stall: { at: 0.9, ms: 260, stretch: 1.25, sliver: 0.022 },
  ground: microGround,
  well: false,
  bakeBase: microBake,
  over: microTrim,
  sliver: drawSliver,
  afterLine: () => 'peel_micro_after',
  afterOnce: true,
}

/** Registers the four objects and their text. */
export function install() {
  addStrings(STR[locale])
  register({ cam: CAM, watch: WATCH, car: CAR, micro: MICRO })
}
