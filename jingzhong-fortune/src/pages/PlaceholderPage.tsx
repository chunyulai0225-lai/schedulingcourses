import { Link } from 'react-router-dom';

/** 尚未建置的頁面。只顯示建置中，不放任何臨時或虛構內容。 */
export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-ink-900 px-6 text-center">
      <h1 className="text-3xl tracking-[0.3em] text-gold-soft">{title}</h1>
      <p className="max-w-md leading-relaxed text-paper-dim">{note}</p>
      <Link to="/" className="mt-4 border-b border-gold/50 pb-1 tracking-widest text-paper hover:text-gold-soft">返回首頁</Link>
    </main>
  );
}
