import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { REQUIRED_SHENG, SITE_NAME } from '../config/site';
import { drawFortune, type DrawResult } from '../lib/drawFortune';
import { toChineseNumber } from '../lib/chineseNumber';
import { FortuneTube } from '../components/draw/FortuneTube';
import { FortuneImage } from '../components/draw/FortuneImage';
import { DivinationPanel } from '../components/draw/DivinationPanel';
import { SiteFooter } from '../components/layout/SiteFooter';

const SHAKE_MS = 2800;
const RISE_MS = 950;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Phase =
  | { kind: 'shaking' }
  | { kind: 'rising' }
  | { kind: 'result'; draw: DrawResult; drawId: number }
  | { kind: 'error' };

/**
 * 抽籤流程：進入頁面即開始搖籤 → 抽出 → 顯示籤詩圖片 → 可模擬擲筊。
 * 同一時間只會有一個抽籤請求，避免連點造成重複計數。
 */
export function DrawPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'shaking' });
  const busy = useRef(false);
  const drawCount = useRef(0);
  const alive = useRef(true);

  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ kind: 'shaking' });
    window.scrollTo({ top: 0 });
    try {
      const [draw] = await Promise.all([drawFortune(), wait(SHAKE_MS)]);
      if (!alive.current) return;
      setPhase({ kind: 'rising' });
      await wait(RISE_MS);
      if (!alive.current) return;
      drawCount.current += 1;
      setPhase({ kind: 'result', draw, drawId: drawCount.current });
    } catch {
      if (alive.current) setPhase({ kind: 'error' });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void start();
    return () => { alive.current = false; };
  }, [start]);

  return (
    <div className="min-h-dvh bg-[linear-gradient(180deg,var(--color-ink-800)_0%,var(--color-ink-900)_40%,var(--color-ink-950)_100%)]">
      <main className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <Link to="/" className="whitespace-nowrap pl-[0.5em] text-sm tracking-[0.5em] text-gold">{SITE_NAME}</Link>

        {(phase.kind === 'shaking' || phase.kind === 'rising') && (
          <div className="flex min-h-[78dvh] flex-col items-center justify-center gap-8">
            <FortuneTube phase={phase.kind} />
            <p className="pl-[0.3em] text-xl tracking-[0.3em] text-paper/90" aria-live="polite">
              {phase.kind === 'shaking' ? '搖籤中…' : '籤已抽出'}
            </p>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-6 text-center">
            <p className="text-lg text-paper">抽籤時連線發生問題，請再試一次。</p>
            <button type="button" onClick={start} className="rounded-sm border border-gold/70 bg-vermilion px-10 py-3 text-lg tracking-[0.3em] text-paper">重新抽籤</button>
            <Link to="/" className="border-b border-gold/40 pb-1 tracking-widest text-gold-soft">返回首頁</Link>
          </div>
        )}

        {phase.kind === 'result' && (
          <div key={phase.drawId} className="fade-up mt-6 flex w-full flex-col items-center gap-10">
            <h1 className="pl-[0.3em] text-4xl font-bold tracking-[0.3em] text-paper sm:text-5xl">
              第{toChineseNumber(phase.draw.number)}籤
            </h1>
            <a href="#divination" className="-mt-6 border-b border-gold/40 pb-0.5 text-gold-soft hover:text-paper">
              請擲筊確認：需連續{REQUIRED_SHENG}個聖筊
            </a>
            <FortuneImage number={phase.draw.number} imageUrl={phase.draw.imageUrl} />
            <DivinationPanel onRedraw={start} />
            <div className="flex w-full max-w-xl flex-col gap-4 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={start}
                className="min-h-14 rounded-sm border border-gold/70 bg-vermilion px-10 text-xl tracking-[0.4em] text-paper hover:bg-[#b23b32]"
              >
                重新抽籤
              </button>
              <Link
                to="/"
                className="flex min-h-14 items-center justify-center rounded-sm border border-gold/50 px-10 text-xl tracking-[0.4em] text-gold-soft hover:bg-gold/10"
              >
                返回首頁
              </Link>
            </div>
          </div>
        )}
      </main>
      <div className="h-12" />
      <SiteFooter siteName={SITE_NAME} />
    </div>
  );
}
