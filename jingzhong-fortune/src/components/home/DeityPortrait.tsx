import { useEffect, useState } from 'react';

interface DeityPortraitProps {
  photoUrl: string;
  deityName: string;
  /** 設定是否已讀取完成；未完成前不顯示「待提供」以免閃爍。 */
  settingsLoaded: boolean;
}

/**
 * 主神照片。照片以原始比例完整呈現（object-contain），
 * 不裁切、不加濾鏡；尚未提供或讀取失敗時只顯示文字提示，不以任何圖像替代神像。
 */
export function DeityPortrait({ photoUrl, deityName, settingsLoaded }: DeityPortraitProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    if (!settingsLoaded) return;
    setStatus(photoUrl ? 'loading' : 'missing');
  }, [photoUrl, settingsLoaded]);

  const alt = deityName ? `${deityName}正式照片` : '旌忠廟主神正式照片';

  return (
    <figure className="relative mx-auto flex flex-col items-center">
      {/* 照片後方的靜態光暈 */}
      <div className="pointer-events-none absolute left-1/2 top-[42%] -z-0 h-[120%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(201,162,79,0.22),transparent)]" aria-hidden="true" />

      <div className="relative w-[min(86vw,30rem,max(56dvh,16rem))] border border-gold/60 p-2 sm:p-2.5">
        <Corners />
        <div className="relative aspect-[3/4] w-full overflow-hidden border border-gold/25 bg-ink-900">
          {photoUrl && status !== 'missing' && (
            <img
              src={photoUrl}
              alt={alt}
              className={`h-full w-full object-contain transition-opacity duration-700 ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setStatus('ready')}
              onError={() => setStatus('missing')}
              decoding="async"
              fetchPriority="high"
            />
          )}
          {status === 'missing' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="text-lg tracking-[0.3em] text-gold-soft">主神照片</span>
              <span className="text-sm leading-relaxed text-paper-dim">待廟方提供正式照片</span>
            </div>
          )}
        </div>
      </div>

      {deityName && (
        <figcaption className="relative mt-4 text-lg tracking-[0.4em] text-gold-soft">{deityName}</figcaption>
      )}
    </figure>
  );
}

function Corners() {
  const base = 'pointer-events-none absolute h-5 w-5 border-gold';
  return (
    <>
      <span className={`${base} -left-1 -top-1 border-l-2 border-t-2`} aria-hidden="true" />
      <span className={`${base} -right-1 -top-1 border-r-2 border-t-2`} aria-hidden="true" />
      <span className={`${base} -bottom-1 -left-1 border-b-2 border-l-2`} aria-hidden="true" />
      <span className={`${base} -bottom-1 -right-1 border-b-2 border-r-2`} aria-hidden="true" />
    </>
  );
}
