import { useEffect, useRef, useState } from 'react';
import { DIVINATION_INFO, throwCups, type CupFace, type DivinationResult } from '../../lib/divination';
import { JiaoCup } from './JiaoCup';

const TOSS_MS = 1000;

function CupLabel({ face }: { face: CupFace }) {
  return <p className="mt-1 text-sm text-paper-dim">{face === 'flat' ? '平面' : '凸面'}</p>;
}

/**
 * 模擬擲筊。完全在瀏覽器內進行，與已抽出的籤號無關：
 * 不會改變籤號、不呼叫後端、不增加抽籤次數。
 */
export function DivinationPanel() {
  const [cups, setCups] = useState<[CupFace, CupFace]>(['flat', 'round']);
  const [result, setResult] = useState<DivinationResult | null>(null);
  const [tossing, setTossing] = useState(false);
  const [tally, setTally] = useState({ sheng: 0, xiao: 0, yin: 0 });
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toss = () => {
    if (tossing) return;
    const outcome = throwCups();
    setTossing(true);
    setResult(null);
    timer.current = window.setTimeout(() => {
      setCups(outcome.cups);
      setResult(outcome.result);
      setTally((t) => ({ ...t, [outcome.result]: t[outcome.result] + 1 }));
      setTossing(false);
    }, TOSS_MS);
  };

  const total = tally.sheng + tally.xiao + tally.yin;

  return (
    <section aria-labelledby="divination-heading" className="w-full max-w-xl border-y border-gold/30 py-8 text-center">
      <h2 id="divination-heading" className="pl-[0.3em] text-2xl font-semibold tracking-[0.3em] text-gold-soft">模擬擲筊</h2>
      <p className="mt-2 text-sm text-paper-dim">此為線上模擬，結果僅供參考；擲筊不會改變籤號。</p>

      <div className="mt-10 flex h-32 items-end justify-center gap-6 sm:gap-10">
        <div key={`l-${total}-${tossing}`} className={tossing ? 'cup-toss-left' : ''}>
          <JiaoCup face={tossing ? 'round' : cups[0]} />
          {!tossing && <CupLabel face={cups[0]} />}
        </div>
        <div key={`r-${total}-${tossing}`} className={tossing ? 'cup-toss-right' : ''}>
          <JiaoCup face={tossing ? 'flat' : cups[1]} mirrored />
          {!tossing && <CupLabel face={cups[1]} />}
        </div>
      </div>

      <div className="mt-4 min-h-20" aria-live="polite">
        {result && !tossing && (
          <div className="fade-up">
            <p className="text-3xl font-bold tracking-[0.3em] text-paper">{DIVINATION_INFO[result].label}</p>
            <p className="mt-1 text-paper-dim">{DIVINATION_INFO[result].description}</p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={toss}
        disabled={tossing}
        className="mt-2 min-h-12 rounded-sm border border-gold/70 px-10 py-3 text-lg tracking-[0.3em] text-gold-soft transition-colors hover:bg-gold/10 disabled:opacity-50"
      >
        {tossing ? '擲筊中…' : total === 0 ? '擲筊' : '再擲一次'}
      </button>

      {total > 0 && (
        <p className="mt-4 text-sm text-paper-dim">
          已擲 {total} 次：聖筊 {tally.sheng}、笑筊 {tally.xiao}、陰筊 {tally.yin}
        </p>
      )}
    </section>
  );
}
