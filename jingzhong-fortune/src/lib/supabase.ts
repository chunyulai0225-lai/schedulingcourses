import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * 未設定 Supabase 時為 null，網站以「本機模式」運作：
 * 抽籤在瀏覽器內以安全亂數產生、不統計次數，圖片讀取 public/images/。
 */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export const IMAGE_BUCKET = 'images';
