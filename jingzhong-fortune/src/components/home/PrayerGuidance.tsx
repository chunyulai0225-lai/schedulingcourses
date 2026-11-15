import { Link } from 'react-router-dom';

/** 默念祈求區塊：不倒數、不限時、不要求輸入任何資料，由使用者自行決定何時開始。 */
export function PrayerGuidance() {
  return (
    <section aria-labelledby="prayer-heading" className="mx-auto flex max-w-xl flex-col items-center px-2 text-center">
      <h2 id="prayer-heading" className="pl-[0.35em] text-2xl font-semibold tracking-[0.35em] text-gold-soft sm:text-3xl">
        請先靜心默念
      </h2>
      <p className="mt-5 text-lg leading-loose text-paper/90 sm:text-xl">
        請向神明稟告姓名及欲祈求之事，<br />
        心中默念求籤內容，誠心祈求指引。
      </p>
      <Link
        to="/draw"
        className="mt-9 inline-flex min-h-14 items-center justify-center rounded-sm border border-gold/70 bg-vermilion py-4 pl-[calc(3.5rem+0.5em)] pr-14 text-xl font-semibold tracking-[0.5em] text-paper shadow-[0_6px_24px_-8px_rgba(163,52,44,0.7)] transition-colors hover:bg-[#b23b32] active:bg-[#8e2c25] sm:text-2xl"
      >
        開始求籤
      </Link>
    </section>
  );
}
