// 籤筒：靜態 SVG，以 CSS 動畫搖動；抽出階段一支籤緩緩升起。
const STICKS = [
  { x: 72, top: 52, tilt: -7 }, { x: 80, top: 40, tilt: -4 }, { x: 88, top: 58, tilt: -3 },
  { x: 95, top: 34, tilt: -1 }, { x: 108, top: 46, tilt: 2 }, { x: 115, top: 30, tilt: 3 },
  { x: 122, top: 54, tilt: 4 }, { x: 129, top: 42, tilt: 6 }, { x: 84, top: 64, tilt: -5 },
  { x: 118, top: 62, tilt: 5 }, { x: 101, top: 60, tilt: 0 },
];

export function FortuneTube({ phase }: { phase: 'shaking' | 'rising' }) {
  return (
    <svg viewBox="0 0 200 300" className="h-auto w-56 sm:w-64" role="img" aria-label={phase === 'shaking' ? '籤筒搖動中' : '抽出一支籤'}>
      <defs>
        <linearGradient id="tube-body" x1="0" x2="1">
          <stop offset="0" stopColor="#4a1c17" />
          <stop offset="0.35" stopColor="#7e2c23" />
          <stop offset="0.6" stopColor="#6a241d" />
          <stop offset="1" stopColor="#3a1512" />
        </linearGradient>
        <linearGradient id="stick" x1="0" x2="1">
          <stop offset="0" stopColor="#c9a46a" />
          <stop offset="0.5" stopColor="#ecd6a4" />
          <stop offset="1" stopColor="#b8925a" />
        </linearGradient>
      </defs>

      <g className={phase === 'shaking' ? 'tube-shaking' : ''}>
        {/* 筒口內側 */}
        <ellipse cx="100" cy="112" rx="50" ry="13" fill="#1d0b09" />

        {/* 籤枝 */}
        {STICKS.map((s, i) => (
          <g key={i} transform={`rotate(${s.tilt} ${s.x} 200)`}>
            <g className={phase === 'shaking' ? 'stick-jiggle' : ''} style={{ animationDelay: `${(i * 37) % 200}ms` }}>
              <rect x={s.x - 3} y={s.top} width="6" height={200 - s.top} rx="2" fill="url(#stick)" />
              <rect x={s.x - 3} y={s.top} width="6" height="10" rx="2" fill="#a3342c" />
            </g>
          </g>
        ))}

        {/* 被抽出的籤 */}
        {phase === 'rising' && (
          <g className="stick-rise">
            <rect x="97" y="38" width="7" height="160" rx="2" fill="url(#stick)" stroke="#e2c789" strokeWidth="0.6" />
            <rect x="97" y="38" width="7" height="12" rx="2" fill="#a3342c" />
          </g>
        )}

        {/* 筒身 */}
        <path d="M50 112 L56 282 Q100 296 144 282 L150 112 Q100 126 50 112 Z" fill="url(#tube-body)" />
        <path d="M50 112 Q100 126 150 112" fill="none" stroke="#c9a24f" strokeWidth="3" />
        <path d="M52 140 Q100 153 148 140" fill="none" stroke="#c9a24f" strokeWidth="1.5" opacity="0.8" />
        <path d="M55 258 Q100 271 145 258" fill="none" stroke="#c9a24f" strokeWidth="1.5" opacity="0.8" />
        <text x="100" y="212" textAnchor="middle" fontSize="38" fill="#e2c789" fontFamily="var(--font-serif)" fontWeight="700">籤</text>
      </g>
    </svg>
  );
}
