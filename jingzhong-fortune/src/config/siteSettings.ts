// 網站設定。目前由 public/site-settings.json 提供；第三階段改由 Supabase site_settings 表讀取，
// 後台上傳的主神照片網址也會存在這裡，元件不需修改。

export interface SiteSettings {
  site_name: string;
  site_subtitle: string;
  /** 廟方提供的主神正式照片網址。空字串表示尚未提供。 */
  deity_photo_url: string;
  /** 主神稱號，由廟方填寫；空字串時不顯示。 */
  deity_name: string;
  /** 首頁公告；空字串時不顯示。 */
  homepage_announcement: string;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  site_name: '臺南後壁旌忠廟',
  site_subtitle: '藏頭籤詩線上求籤',
  deity_photo_url: '',
  deity_name: '',
  homepage_announcement: '',
};

export async function loadSiteSettings(): Promise<SiteSettings> {
  try {
    const res = await fetch('/site-settings.json', { cache: 'no-cache' });
    if (!res.ok) return DEFAULT_SITE_SETTINGS;
    const data = (await res.json()) as Partial<SiteSettings>;
    return { ...DEFAULT_SITE_SETTINGS, ...data };
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}
