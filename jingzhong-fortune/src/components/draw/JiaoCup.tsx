import type { CupFace } from '../../lib/divination';

/** 單一筊杯（新月形）。平面朝上為淺木色平塗；凸面朝上為朱紅並帶立體光澤。 */
export function JiaoCup({ face, mirrored = false }: { face: CupFace; mirrored?: boolean }) {
  const id = `cup-${face}-${mirrored ? 'r' : 'l'}`;
  return (
    <svg viewBox="0 0 120 70" className={`h-auto w-28 sm:w-32 ${mirrored ? '-scale-x-100' : ''}`} aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="0.45" cy="0.3" r="0.8">
          {face === 'round' ? (
            <>
              <stop offset="0" stopColor="#d4664f" />
              <stop offset="0.55" stopColor="#9a2e24" />
              <stop offset="1" stopColor="#5e1913" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#e4c08e" />
              <stop offset="1" stopColor="#c99a62" />
            </>
          )}
        </radialGradient>
      </defs>
      <path d="M8 52 C18 6 102 6 112 52 C92 34 28 34 8 52 Z" fill={`url(#${id})`} stroke="#3a120e" strokeWidth="1.5" />
      {face === 'round' ? (
        <path d="M26 30 C44 16 76 16 94 30" fill="none" stroke="#f3b9a5" strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
      ) : (
        <path d="M8 52 C18 6 102 6 112 52" fill="none" stroke="#a3342c" strokeWidth="3" />
      )}
    </svg>
  );
}
