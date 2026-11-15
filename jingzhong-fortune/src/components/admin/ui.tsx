import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-md border border-ink-800/15 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink-900">{title}</h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const styles = variant === 'primary'
    ? 'bg-ink-800 text-paper hover:bg-ink-900'
    : 'border border-ink-800/30 text-ink-900 hover:bg-ink-800/5';
  return <button type="button" className={`min-h-10 rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${styles} ${className}`} {...props} />;
}

export function Messages({ errors, notices }: { errors: string[]; notices?: string[] }) {
  if (!errors.length && !notices?.length) return null;
  return (
    <div className="mt-4 space-y-2 text-sm" aria-live="polite">
      {notices?.map((m, i) => <p key={`n${i}`} className="rounded bg-emerald-50 px-3 py-2 text-emerald-800">{m}</p>)}
      {errors.map((m, i) => <p key={`e${i}`} className="rounded bg-red-50 px-3 py-2 text-red-800">{m}</p>)}
    </div>
  );
}
