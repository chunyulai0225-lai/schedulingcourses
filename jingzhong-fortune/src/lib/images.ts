import { IMAGE_BUCKET, supabase } from './supabase';

export const padNumber = (n: number) => String(n).padStart(3, '0');
export const fortuneImagePath = (n: number) => `fortunes/${padNumber(n)}`;
export const DEITY_PHOTO_PATH = 'site/deity';

function storageUrl(path: string, version: string) {
  const { data } = supabase!.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${encodeURIComponent(version)}`;
}

/**
 * 籤詩圖片網址。回傳 null 代表確定尚未上傳（不去請求，直接顯示提示）。
 * version 為圖片最後上傳時間，換圖後網址改變，避免看到舊圖。
 */
export function fortuneImageUrl(n: number, version: string | null): string | null {
  if (supabase) return version ? storageUrl(fortuneImagePath(n), version) : null;
  return `/images/fortunes/${padNumber(n)}.png`;
}

export function deityPhotoUrl(version: string | null): string | null {
  if (supabase) return version ? storageUrl(DEITY_PHOTO_PATH, version) : null;
  return '/images/deity/main-deity.jpg';
}

/** 讀取主神照片版本（本機模式不需要）。 */
export async function loadDeityPhotoUrl(): Promise<string | null> {
  if (!supabase) return deityPhotoUrl(null);
  const { data, error } = await supabase.from('site_settings').select('deity_photo_updated_at').eq('id', 1).maybeSingle();
  if (error) return null;
  return deityPhotoUrl(data?.deity_photo_updated_at ?? null);
}
