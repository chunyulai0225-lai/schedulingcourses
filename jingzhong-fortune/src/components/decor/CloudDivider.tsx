// 祥雲分隔線：靜態、低調的裝飾。
export function CloudDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 text-gold/70 ${className}`} aria-hidden="true">
      <span className="h-px w-12 bg-gradient-to-r from-transparent to-gold/60 sm:w-20" />
      <svg viewBox="0 0 64 24" className="h-5 w-14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M8 16c-4 0-5-6 0-7 1-4 7-4 8 0 2-3 7-2 7 2 0 3-3 5-6 5H8z" />
        <path d="M56 16c4 0 5-6 0-7-1-4-7-4-8 0-2-3-7-2-7 2 0 3 3 5 6 5h9z" />
        <circle cx="32" cy="12" r="2.2" fill="currentColor" stroke="none" />
      </svg>
      <span className="h-px w-12 bg-gradient-to-l from-transparent to-gold/60 sm:w-20" />
    </div>
  );
}
