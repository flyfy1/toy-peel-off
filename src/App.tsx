import { useEffect, useRef, useState } from 'react'
import { MoreMenu } from './components/MoreMenu'
import { applyMeta, t } from './i18n'
import { startAnalytics, track } from './analytics'
import { Hint } from './components/Hint'
import { startGame } from './game'

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [touched, setTouched] = useState(false)
  const bare = import.meta.env.DEV && (new URLSearchParams(location.search).has('shot') || new URLSearchParams(location.search).has('bare'))

  useEffect(() => {
    applyMeta('peel')
    startAnalytics('peel')
    const g = startGame(ref.current!, {
      onFirst() {
        setTouched(true)
        track('play_start')
      },
    })
    return () => g.dispose()
  }, [])

  return (
    <>
      <canvas ref={ref} />
      {!bare && <Hint text={t('hint_peel')} hidden={touched} toy="peel" />}
      {!bare && <MoreMenu current="peel" />}
    </>
  )
}
