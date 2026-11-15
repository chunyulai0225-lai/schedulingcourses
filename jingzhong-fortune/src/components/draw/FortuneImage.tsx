import { useEffect, useState } from 'react';
import { toChineseNumber } from '../../lib/chineseNumber';

/** 籤詩原始圖片：原樣、完整顯示；尚未上傳或讀取失敗時顯示文字提示，絕不顯示錯誤圖片。 */
export function FortuneImage({ number, imageUrl }: { number: number; imageUrl: string | null }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>(imageUrl ? 'loading' : 'missing');

  useEffect(() => setStatus(imageUrl ? 'loading' : 'missing'), [imageUrl]);

  return (
    <div className="w-full">
      <div className="relative mx-auto w-full max-w-xl border border-gold/50 bg-ink-900 p-1.5">
        {imageUrl && status !== 'missing' && (
          <img
            src={imageUrl}
            alt={`第${toChineseNumber(number)}籤 籤詩圖片`}
            className={`block h-auto w-full transition-opacity duration-500 ${status === 'ready' ? 'opacity-100' : 'min-h-80 opacity-0'}`}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('missing')}
          />
        )}
        {status === 'loading' && (
          <p className="absolute inset-0 flex items-center justify-center text-paper-dim">圖片載入中…</p>
        )}
        {status === 'missing' && (
          <div className="flex min-h-64 w-full items-center justify-center px-6 text-center">
            <span className="text-lg leading-relaxed text-paper-dim">此籤圖片尚未上傳</span>
          </div>
        )}
      </div>
      {status === 'ready' && imageUrl && (
        <p className="mt-3 text-center">
          <a href={imageUrl} target="_blank" rel="noopener" className="border-b border-gold/40 pb-0.5 text-sm tracking-widest text-gold-soft hover:text-paper">
            檢視原圖
          </a>
        </p>
      )}
    </div>
  );
}
