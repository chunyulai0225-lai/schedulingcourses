import { useEffect, useRef, useState } from 'react';
import { REQUIRED_SHENG } from '../../config/site';
import { DIVINATION_INFO, throwCups, type CupFace, type DivinationResult } from '../../lib/divination';
import { JiaoCup } from './JiaoCup';

const TOSS_MS = 1000;

function CupLabel({ face }: { face: CupFace }) {
  return <p className="mt-1 text-sm text-paper-dim">{face === 'flat' ? '平面' : '凸面'}</p>;
}

type Status = 'pending' | 'confirmed' | 'rejected';

/**
 * 模擬擲筊確認：需連續 REQUIRED_SHENG 個聖筊才確認此籤；
 * 中途出現笑筊或陰筊即未獲確認，停止擲筊並請使用者重新抽籤。
 * 完全在瀏覽器內進行：不會改變籤號、不呼叫後端、不增加抽籤次數。
 */
export function DivinationPanel({ onRedraw }: { onRedraw: () => void }) {
  const [cups, setCups] = useState<[CupFace, CupFace]>(['flat', 'round']);
  const [history, setHistory] = useState<DivinationResult[]>([]);
  const [tossing, setTossing] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const last = history[history.length - 1];
  const status: Status = last && last !== 'sheng' ? 'rejected' : history.length >= REQUIRED_SHENG ? 'confirmed' : 'pending';

  const toss = () => {
    if (tossing || status !== 'pending') return;
    const outcome = throwCups();
    setTossing(true);
    timer.current = window.setTimeout(() => {
      setCups(outcome.cups);
      setHistory((h) => [...h, outcome.result]);
      setTossing(false);
    }, TOSS_MS);
  };

  return (
    <section id="divination" aria-labelledby="divination-heading" className="w-full max-w-xl scroll-mt-6 border-y border-gold/30 py-8 text-center">
      <h2 id="divination-heading" className="pl-[0.3em] text-2xl font-semibold tracking-[0.3em] text-gold-soft">擲筊確認</h2>
      <p className="mt-2 text-paper/90">需連續擲得 {REQUIRED_SHENG} 個聖筊，方確認為神明所賜之籤。</p>
      <p className="mt-1 text-sm text-paper-dim">此為線上模擬擲筊，結果僅供參考；擲筊不會改變籤號。</p>

      {/* 進度：每一筊的結果 */}
      <ol className="mt-6 flex justify-center gap-3" aria-label="擲筊進度">
        {Array.from({ length: REQUIRED_SHENG }, (_, i) => {
          const r = history[i];
          const style = !r ? 'border-gold/40 text-paper-dim/60'
            : r === 'sheng' ? 'border-gold bg-gold/20 text-gold-soft'
            : 'border-vermilion bg-vermilion/25 text-paper';
          return (
            <li key={i} className={`flex h-16 w-16 flex-col items-center justify-center rounded-full border text-sm sm:h-[4.5rem] sm:w-[4.5rem] ${style}`}>
              <span className="text-xs opacity-80">第{i + 1}筊</span>
              <span className="font-semibold">{r ? DIVINATION_INFO[r].label : '—'}</span>
            </li>
          );
        })}
      </ol>

      <div className="mt-10 flex h-32 items-end justify-center gap-6 sm:gap-10">
        <div key={`l-${history.length}-${tossing}`} className={tossing ? 'cup-toss-left' : ''}>
          <JiaoCup face={tossing ? 'round' : cups[0]} />
          {!tossing && history.length > 0 && <CupLabel face={cups[0]} />}
        </div>
        <div key={`r-${history.length}-${tossing}`} className={tossing ? 'cup-toss-right' : ''}>
          <JiaoCup face={tossing ? 'flat' : cups[1]} mirrored />
          {!tossing && history.length > 0 && <CupLabel face={cups[1]} />}
        </div>
      </div>

      <div className="mt-4 min-h-16" aria-live="polite">
        {last && !tossing && (
          <div key={history.length} className="fade-up">
            <p className="text-3xl font-bold tracking-[0.3em] text-paper">{DIVINATION_INFO[last].label}</p>
            <p className="mt-1 text-paper-dim">{DIVINATION_INFO[last].description}</p>
          </div>
        )}
      </div>

      {status === 'pending' && (
        <button
          type="button"
          onClick={toss}
          disabled={tossing}
          className="mt-2 min-h-12 rounded-sm border border-gold/70 px-10 py-3 text-lg tracking-[0.3em] text-gold-soft transition-colors hover:bg-gold/10 disabled:opacity-50"
        >
          {tossing ? '擲筊中…' : `擲第${['一', '二', '三', '四', '五'][history.length] ?? history.length + 1}筊`}
        </button>
      )}

      {status === 'confirmed' && !tossing && (
        <div className="fade-up mt-4 border border-gold/60 bg-gold/10 px-4 py-5">
          <p className="text-2xl font-bold tracking-[0.2em] text-gold-soft">連得{REQUIRED_SHENG}個聖筊</p>
          <p className="mt-2 text-lg text-paper">此籤確認，請依籤詩所示，誠心參悟。</p>
        </div>
      )}

      {status === 'rejected' && !tossing && (
        <div className="fade-up mt-4 border border-vermilion/70 bg-vermilion/15 px-4 py-5">
          <p className="text-xl font-semibold text-paper">未得連續{REQUIRED_SHENG}個聖筊，此籤未獲確認</p>
          <p className="mt-2 text-paper-dim">請再次靜心默念所求之事，重新抽籤。</p>
          <button
            type="button"
            onClick={onRedraw}
            className="mt-5 min-h-12 rounded-sm border border-gold/70 bg-vermilion px-10 py-3 text-lg tracking-[0.3em] text-paper hover:bg-[#b23b32]"
          >
            重新抽籤
          </button>
        </div>
      )}
    </section>
  );
}
