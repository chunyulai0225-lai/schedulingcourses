import { TOTAL_FORTUNES } from '../config/site';
import { fortuneImageUrl } from './images';
import { secureRandomInt } from './random';
import { supabase } from './supabase';

export interface DrawResult {
  number: number;
  /** null 表示此籤圖片尚未上傳。 */
  imageUrl: string | null;
}

/**
 * 抽一支籤。正式模式由資料庫函式 draw_fortune 產生亂數並原子性地把次數加 1，
 * 每呼叫一次只計一次；擲筊完全不經過這裡，因此不會增加次數。
 */
export async function drawFortune(): Promise<DrawResult> {
  if (!supabase) {
    const number = secureRandomInt(TOTAL_FORTUNES) + 1;
    return { number, imageUrl: fortuneImageUrl(number, null) };
  }
  const { data, error } = await supabase.rpc('draw_fortune');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('抽籤沒有回傳結果');
  return { number: row.drawn_number, imageUrl: fortuneImageUrl(row.drawn_number, row.image_updated_at) };
}
