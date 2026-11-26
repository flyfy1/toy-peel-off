import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { MoreMenu, pillClass } from './components/MoreMenu'
import { applyMeta, t, tx } from './i18n'
import { startAnalytics, track } from './analytics'
import { Hint } from './components/Hint'
import { landing, peakEvery, stats, trackLanding } from './share'
import { Tag } from './components/Tag'
import { type GameApi, startGame } from './game'

const Picker = lazy(() => import('./Picker'))

type Line = { text: string; mode: 'line' | 'mum'; id: number; from?: string }

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const api = useRef<GameApi | null>(null)
  const [touched, setTouched] = useState(false)
  const [count, setCount] = useState<{ n: number; mum: boolean; d: number; total: number; bump: number }>({ n: 0, mum: false, d: 0, total: 3, bump: 0 })
  const [line, setLine] = useState<Line | null>(null)
  const [mum, setMum] = useState<Line | null>(null)
  const [picker, setPicker] = useState(false)
  const [, setObjs] = useState(0)
  const lineTimer = useRef<number | undefined>(undefined)
  const mumTimer = useRef<number | undefined>(undefined)
  const q = new URLSearchParams(location.search)
  const bare = import.meta.env.DEV && (q.has('shot') || q.has('bare'))

  useEffect(() => {
    applyMeta('peel')
    startAnalytics('peel')
    trackLanding()
    const g = startGame(ref.current!, {
      onFirst() {
        setTouched(true)
        track('play_start')
      },
      onPeel(n, data) {
        peakEvery('peel', n, { snap: null, data })
      },
      onCount(n, isMum, d, total) {
        stats.n = n
        setCount((c) => ({ n, mum: isMum, d, total, bump: c.bump + (n > c.n ? 1 : 0) }))
      },
      onObjects() {
        setObjs((v) => v + 1)
      },
      onLine(text, mode, from) {
        const l = { text, mode, from, id: Date.now() + Math.random() }
        if (mode === 'mum') {
          setMum(l)
          window.clearTimeout(mumTimer.current)
          mumTimer.current = window.setTimeout(() => setMum(null), 3400)
        } else {
          setLine(l)
          window.clearTimeout(lineTimer.current)
          lineTimer.current = window.setTimeout(() => setLine(null), 2600)
        }
      },
    })
    api.current = g
    return () => g.dispose()
  }, [])

  const base = count.mum ? t('peel_count_mum', { n: count.n }) : count.n === 1 ? t('peel_count_one') : t('peel_count', { n: count.n })
  const label = count.mum ? base : `${base} · ${t('peel_kinds', { d: count.d, t: count.total })}`
  const obj = q.get('obj')
  const tag = landing.recipient && obj && obj !== 'phone' && obj !== 'steel' ? tx(`peel_tag_${obj}`) : ''

  return (
    <>
      <canvas ref={ref} />
      {!bare && count.n > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-10 flex justify-center select-none">
          <button
            key={count.bump}
            className={`${pillClass('peel')} peel-bump pointer-events-auto tabular-nums`}
            onClick={() => {
              void api.current?.load().then(() => setObjs((v) => v + 1))
              setPicker((p) => !p)
            }}
          >
            {label}
          </button>
        </div>
      )}
      {picker && api.current && (
        <Suspense fallback={null}>
          <Picker api={api.current} onClose={() => setPicker(false)} />
        </Suspense>
      )}
      {!bare && mum && (
        <div key={mum.id} className="peel-mum pointer-events-none fixed inset-x-0 top-16 z-10 flex justify-center px-4 select-none">
          <div className="max-w-[340px] rounded-2xl rounded-tl-md bg-white/95 px-3.5 py-2 text-[15px] leading-snug text-[#2B2620] shadow-[0_6px_20px_rgba(60,45,30,.18)]">
            <div className="text-[12px] font-semibold text-[#3A8DDE]">{mum.from || t('peel_mum')}</div>
            {mum.text}
          </div>
        </div>
      )}
      {!bare && line && (
        <div key={line.id} className="peel-line pointer-events-none fixed inset-x-0 bottom-[5.5rem] z-10 flex justify-center px-6 select-none">
          <span className="rounded-full bg-[#FFF9F0]/85 px-3.5 py-1.5 text-center text-[16px] font-medium tracking-wide text-[#4A3A2C]/90 shadow-[0_4px_14px_rgba(74,58,44,.12)]">{line.text}</span>
        </div>
      )}
      {!bare && <Hint text={t('hint_peel')} hidden={touched} toy="peel" />}
      {tag && <Tag text={tag} className="top-14" paper="bg-white text-[#26302A] font-medium" />}
      {!bare && <MoreMenu current="peel" />}
    </>
  )
}
