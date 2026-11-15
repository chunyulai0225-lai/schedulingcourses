import { useEffect, useState } from 'react';
import { DEFAULT_SITE_SETTINGS, loadSiteSettings, type SiteSettings } from '../config/siteSettings';

export function useSiteSettings() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSiteSettings().then((s) => {
      if (!alive) return;
      setSettings(s);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  return { settings, loaded };
}
