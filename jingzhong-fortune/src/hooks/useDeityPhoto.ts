import { useEffect, useState } from 'react';
import { loadDeityPhotoUrl } from '../lib/images';

export function useDeityPhoto() {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    loadDeityPhotoUrl().then((u) => {
      if (!alive) return;
      setUrl(u);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);
  return { url, loaded };
}
