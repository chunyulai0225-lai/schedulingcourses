import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { loadDeityPhotoVersion, uploadDeityPhoto } from '../../lib/adminApi';
import { deityPhotoUrl } from '../../lib/images';
import { Button, Card, Messages } from './ui';

export function DeityPhotoManager() {
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDeityPhotoVersion().then(setVersion).catch((e) => setErrors([`讀取失敗：${e.message}`]));
  }, []);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (version && !window.confirm('確定要更換首頁的主神照片嗎？')) return;
    setBusy(true);
    setErrors([]);
    setNotices([]);
    try {
      setVersion(await uploadDeityPhoto(file));
      setNotices(['主神照片已更新。']);
    } catch (err) {
      setErrors([(err as Error).message]);
    }
    setBusy(false);
  };

  const url = deityPhotoUrl(version);
  return (
    <Card title="首頁主神照片" actions={<Button onClick={() => input.current?.click()} disabled={busy}>{busy ? '上傳中…' : url ? '更換照片' : '上傳照片'}</Button>}>
      <p className="text-sm leading-relaxed text-ink-800/80">請上傳廟方提供的正式照片。網站會原樣完整顯示，不裁切、不調色。建議直式、長邊至少 1600 像素。</p>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
      <Messages errors={errors} notices={notices} />
      <div className="mt-5 flex aspect-[3/4] w-48 items-center justify-center rounded border border-ink-800/20 bg-ink-800/5">
        {url ? <img src={url} alt="目前的主神照片" className="h-full w-full object-contain" /> : <span className="text-sm text-red-700">尚未上傳</span>}
      </div>
    </Card>
  );
}
