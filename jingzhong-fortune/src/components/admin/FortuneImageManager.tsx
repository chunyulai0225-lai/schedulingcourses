import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { TOTAL_FORTUNES } from '../../config/site';
import { fortuneNumberFromFileName, loadFortuneImageVersions, uploadFortuneImage, validateImageFile } from '../../lib/adminApi';
import { fortuneImageUrl, padNumber } from '../../lib/images';
import { Button, Card, Messages } from './ui';

const NUMBERS = Array.from({ length: TOTAL_FORTUNES }, (_, i) => i + 1);

export function FortuneImageManager() {
  const [versions, setVersions] = useState<Map<number, string | null>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const bulkInput = useRef<HTMLInputElement>(null);
  const singleInput = useRef<HTMLInputElement>(null);
  const target = useRef<number>(0);

  useEffect(() => {
    loadFortuneImageVersions().then(setVersions).catch((e) => setErrors([`讀取失敗：${e.message}`]));
  }, []);

  const uploaded = NUMBERS.filter((n) => versions.get(n)).length;

  const runUploads = async (items: { n: number; file: File }[], preErrors: string[]) => {
    const errs = [...preErrors];
    let ok = 0;
    for (const [i, { n, file }] of items.entries()) {
      setBusy(`上傳中 ${i + 1} / ${items.length}（第 ${n} 籤）`);
      try {
        const v = await uploadFortuneImage(n, file);
        setVersions((m) => new Map(m).set(n, v));
        ok += 1;
      } catch (e) {
        errs.push(`第 ${n} 籤：${(e as Error).message}`);
      }
    }
    setBusy(null);
    setErrors(errs);
    setNotices(ok ? [`已成功上傳 ${ok} 張圖片。`] : []);
  };

  const onBulk = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    const errs: string[] = [];
    const byNumber = new Map<number, File>();
    for (const f of files) {
      const n = fortuneNumberFromFileName(f.name);
      if (n === null) { errs.push(`${f.name}：檔名需為 001～058（例如 001.png），已略過`); continue; }
      if (byNumber.has(n)) { errs.push(`${f.name}：與 ${byNumber.get(n)!.name} 同為第 ${n} 籤，已略過`); continue; }
      const bad = validateImageFile(f);
      if (bad) { errs.push(`${bad}，已略過`); continue; }
      byNumber.set(n, f);
    }
    void runUploads([...byNumber].sort((a, b) => a[0] - b[0]).map(([n, file]) => ({ n, file })), errs);
  };

  const onSingle = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const n = target.current;
    if (versions.get(n) && !window.confirm(`確定要更換第 ${n} 籤的圖片嗎？`)) return;
    void runUploads([{ n, file }], []);
  };

  return (
    <Card
      title={`籤詩圖片（已上傳 ${uploaded} / ${TOTAL_FORTUNES}）`}
      actions={<Button onClick={() => bulkInput.current?.click()} disabled={!!busy}>批次上傳</Button>}
    >
      <p className="text-sm leading-relaxed text-ink-800/80">
        批次上傳請一次選取多張圖片，檔名需為 <code>001.png</code>～<code>058.png</code>（也接受 JPG、WebP）。點選單張圖片可個別上傳或更換。圖片會原樣保存，不做任何修改。
      </p>
      <input ref={bulkInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={onBulk} />
      <input ref={singleInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onSingle} />
      {busy && <p className="mt-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{busy}</p>}
      <Messages errors={errors} notices={notices} />

      <ul className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
        {NUMBERS.map((n) => {
          const url = fortuneImageUrl(n, versions.get(n) ?? null);
          return (
            <li key={n}>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => { target.current = n; singleInput.current?.click(); }}
                className="group flex w-full flex-col overflow-hidden rounded border border-ink-800/20 text-left hover:border-ink-800/60 disabled:opacity-60"
                title={url ? `更換第 ${n} 籤圖片` : `上傳第 ${n} 籤圖片`}
              >
                <span className="flex aspect-[3/4] items-center justify-center bg-ink-800/5">
                  {url
                    ? <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" />
                    : <span className="text-xs text-red-700">未上傳</span>}
                </span>
                <span className="flex justify-between px-2 py-1 text-xs text-ink-900">
                  <span>{padNumber(n)}</span>
                  <span className="text-ink-800/60 group-hover:text-ink-900">{url ? '更換' : '上傳'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
