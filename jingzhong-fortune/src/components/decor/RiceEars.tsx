// 稻穗：頁面底部的淡色背景裝飾，不影響閱讀與點擊。
function Ear({ flip = false }: { flip?: boolean }) {
  const grains = Array.from({ length: 9 }, (_, i) => i);
  return (
    <svg viewBox="0 0 120 220" className={`h-48 w-auto sm:h-64 ${flip ? '-scale-x-100' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M20 218C30 150 50 90 96 22" />
      <path d="M34 218C40 170 52 130 70 100" />
      {grains.map((i) => {
        const t = i / 9;
        const x = 20 + 76 * t + 6 * Math.sin(t * 3);
        const y = 200 - 178 * t;
        return (
          <g key={i}>
            <ellipse cx={x + 9} cy={y - 2} rx="7" ry="3.2" transform={`rotate(-35 ${x + 9} ${y - 2})`} />
            <ellipse cx={x - 6} cy={y - 8} rx="7" ry="3.2" transform={`rotate(-80 ${x - 6} ${y - 8})`} />
          </g>
        );
      })}
    </svg>
  );
}

export function RiceEars() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between text-gold opacity-[0.12]" aria-hidden="true">
      <Ear />
      <Ear flip />
    </div>
  );
}
