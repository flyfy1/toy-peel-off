// The picker (peel-more.md section 4): a tray of boxes, one per object; peeled ones show a small drawing,
// the others a sealed carton. Loaded on the first tap on the counter.
import { tx } from './i18n'
import type { GameApi } from './game'
import { KINDS, type Kind } from './kit'

/** Small drawings for the picker's boxes (objects already peeled on this device). */
const GLYPH: Partial<Record<Kind, string>> = {
  phone: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
  steel: 'M5 5h14v14H5zM8 9h8M9 14a1 1 0 1 0 0 .1M15 14a1 1 0 1 0 0 .1',
  remote: 'M10 2h4a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 6v.1M12 10a1.5 1.5 0 1 0 0 .1',
  cam: 'M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4zM9 6.7a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6M9 12.7a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6M15.5 9.7a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6',
  watch: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M9.5 7.6V2h5v5.6M9.5 16.4V22h5v-5.6M12 9.5V12l1.6 1',
  car: 'M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM6 14l4-3 3 1 4-3',
  micro: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM9.5 4.5h5v3h-5zM10 11v.1M14 11v.1M10 14v.1M14 14v.1M9.5 18h5',
  fridge: 'M7 2h10a1 1 0 0 1 1 1v19M6 22V3a1 1 0 0 1 1-1M6 13h12M15.5 5v5M15.5 15.5v4M8.5 16h2.5v3h-2.5z',
  laptop: 'M6 3h12a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 6 3zM6.5 3v18M13 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
  cabinet: 'M5 3h14v18H5zM7.5 13.5v5M5 3l4 0l-4 4zM19 21l-3.5 0l3.5-3.5',
}

export default function Picker({ api, onClose }: { api: GameApi; onClose: () => void }) {
  const { avail, mask, cur } = api.info()
  return (
    <div className="fixed inset-0 z-20" onPointerDown={onClose}>
      <div className="peel-tray absolute inset-x-0 top-16 mx-auto grid w-[min(92vw,360px)] grid-cols-5 gap-x-2 gap-y-3 rounded-2xl bg-[#FFF9F0]/95 p-3 shadow-[0_10px_30px_rgba(60,45,30,.25)]" onPointerDown={(e) => e.stopPropagation()}>
        {avail.map((k) => {
          const seen = (mask >> KINDS.indexOf(k)) & 1
          return (
            <button
              key={k}
              className={`flex flex-col items-center gap-1 rounded-lg p-0.5 active:scale-95 ${k === cur ? 'bg-[#E8DCC8]' : ''}`}
              onClick={() => {
                api.pick(k)
                onClose()
              }}
            >
              <svg viewBox="0 0 24 24" className="h-12 w-12 rounded-md" aria-hidden>
                {seen ? (
                  <>
                    <rect x="0.5" y="0.5" width="23" height="23" rx="3" fill="#F4F1EC" stroke="#D9D0C2" />
                    <path d={GLYPH[k]} fill="none" stroke="#4A3A2C" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" transform="translate(2.4 2.4) scale(0.8)" />
                  </>
                ) : (
                  <>
                    <rect x="0.5" y="0.5" width="23" height="23" rx="3" fill="#CDB08A" stroke="#B0916A" />
                    <path d="M0.5 9h23" stroke="#B0916A" strokeWidth="0.8" />
                    <rect x="9" y="0.5" width="6" height="23" fill="#E9DFC9" opacity="0.85" />
                    <path d="M9 0.5v23M15 0.5v23" stroke="#C9B996" strokeWidth="0.5" />
                  </>
                )}
              </svg>
              <span className="line-clamp-2 w-full text-center text-[10px] leading-tight break-words text-[#4A3A2C]/80">{tx(`peel_name_${k}`)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

