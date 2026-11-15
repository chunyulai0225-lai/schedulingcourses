import { TOTAL_FORTUNES } from '../config/site';
import { DEITY_PHOTO_PATH, fortuneImagePath } from './images';
import { IMAGE_BUCKET, supabase } from './supabase';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

function client() {
  if (!supabase) throw new Error('尚未設定 Supabase');
  return supabase;
}

/** 檢查圖片格式與大小，有問題回傳錯誤訊息。 */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return `${file.name}：只接受 PNG、JPG、WebP 圖片`;
  if (file.size > MAX_BYTES) return `${file.name}：檔案超過 10 MB`;
  return null;
}

/** 由檔名取得籤號，例如 001.png → 1；不符合 001～058 則回傳 null。 */
export function fortuneNumberFromFileName(name: string): number | null {
  const m = /^(\d{1,3})\.(png|jpe?g|webp)$/i.exec(name.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= TOTAL_FORTUNES ? n : null;
}

async function upload(path: string, file: File) {
  const err = validateImageFile(file);
  if (err) throw new Error(err);
  const { error } = await client().storage.from(IMAGE_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: '600',
  });
  if (error) throw new Error(`上傳失敗：${error.message}`);
}

export async function uploadFortuneImage(n: number, file: File): Promise<string> {
  await upload(fortuneImagePath(n), file);
  const version = new Date().toISOString();
  const { error } = await client().from('fortunes').update({ image_updated_at: version }).eq('fortune_number', n);
  if (error) throw new Error(`圖片已上傳，但更新紀錄失敗：${error.message}`);
  return version;
}

export async function uploadDeityPhoto(file: File): Promise<string> {
  await upload(DEITY_PHOTO_PATH, file);
  const version = new Date().toISOString();
  const { error } = await client().from('site_settings').update({ deity_photo_updated_at: version, updated_at: version }).eq('id', 1);
  if (error) throw new Error(`照片已上傳，但更新紀錄失敗：${error.message}`);
  return version;
}

/** 各籤圖片版本（null 表示未上傳）。 */
export async function loadFortuneImageVersions(): Promise<Map<number, string | null>> {
  const { data, error } = await client().from('fortunes').select('fortune_number, image_updated_at').order('fortune_number');
  if (error) throw new Error(error.message);
  return new Map(data.map((r) => [r.fortune_number as number, r.image_updated_at as string | null]));
}

export async function loadDeityPhotoVersion(): Promise<string | null> {
  const { data, error } = await client().from('site_settings').select('deity_photo_updated_at').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.deity_photo_updated_at ?? null;
}

export interface DrawStat { fortune_number: number; draw_count: number }

export async function loadStatistics(): Promise<DrawStat[]> {
  const { data, error } = await client().rpc('get_draw_statistics');
  if (error) throw new Error(error.message);
  return (data as DrawStat[]).map((r) => ({ fortune_number: Number(r.fortune_number), draw_count: Number(r.draw_count) }));
}

export async function checkIsAdmin(): Promise<boolean> {
  const { data, error } = await client().rpc('is_admin');
  return !error && data === true;
}
