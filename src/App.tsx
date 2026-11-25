import { useEffect, useRef, useState } from 'react'
import { MoreMenu, pillClass } from './components/MoreMenu'
import { applyMeta, t } from './i18n'
import { startAnalytics, track } from './analytics'
import { Hint } from './components/Hint'
import { stats } from './share'
import { startGame } from './game'

type Line = { text: string; mode: 'line' | 'mum'; id: number }

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [touched, setTouched] = useState(false)
  const [count, setCount] = useState<{ n: number; mum: boolean; bump: number }>({ n: 0, mum: false, bump: 0 })
  const [line, setLine] = useState<Line | null>(null)
  const [mum, setMum] = useState<Line | null>(null)
  const lineTimer = useRef<number | undefined>(undefined)
  const mumTimer = useRef<number | undefined>(undefined)
  const q = new URLSearchParams(location.search)
  const bare = import.meta.env.DEV && (q.has('shot') || q.has('bare'))

  useEffect(() => {
    applyMeta('peel')
    startAnalytics('peel')
    const g = startGame(ref.current!, {
      onFirst() {
        setTouched(true)
        track('play_start')
      },
      onCount(n, isMum) {
        stats.n = n
        setCount((c) => ({ n, mum: isMum, bump: c.bump + (n > c.n ? 1 : 0) }))
      },
      onLine(text, mode) {
        const l = { text, mode, id: Date.now() + Math.random() }
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
    return () => g.dispose()
  }, [])

  const label = count.mum ? t('peel_count_mum', { n: count.n }) : count.n === 1 ? t('peel_count_one') : t('peel_count', { n: count.n })

  return (
    <>
      <canvas ref={ref} />
      {!bare && count.n > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-10 flex justify-center select-none">
          <div key={count.bump} className={`${pillClass('peel')} peel-bump tabular-nums`}>
            {label}
          </div>
        </div>
      )}
      {!bare && mum && (
        <div key={mum.id} className="peel-mum pointer-events-none fixed inset-x-0 top-16 z-10 flex justify-center px-4 select-none">
          <div className="max-w-[340px] rounded-2xl rounded-tl-md bg-white/95 px-3.5 py-2 text-[15px] leading-snug text-[#2B2620] shadow-[0_6px_20px_rgba(60,45,30,.18)]">
            <div className="text-[12px] font-semibold text-[#3A8DDE]">{t('peel_mum')}</div>
            {mum.text}
          </div>
        </div>
      )}
      {!bare && line && (
        <div key={line.id} className="peel-line pointer-events-none fixed inset-x-0 bottom-[5.5rem] z-10 flex justify-center px-6 select-none">
          <span className="rounded-full bg-[#FFF9F0]/85 px-3.5 py-1.5 text-[16px] font-medium tracking-wide text-[#4A3A2C]/90 shadow-[0_4px_14px_rgba(74,58,44,.12)]">{line.text}</span>
        </div>
      )}
      {!bare && <Hint text={t('hint_peel')} hidden={touched} toy="peel" />}
      {!bare && <MoreMenu current="peel" />}
    </>
  )
}
