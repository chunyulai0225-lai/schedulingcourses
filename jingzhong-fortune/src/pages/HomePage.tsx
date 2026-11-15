import { Link } from 'react-router-dom';
import { useSiteSettings } from '../hooks/useSiteSettings';
import { CloudDivider } from '../components/decor/CloudDivider';
import { RiceEars } from '../components/decor/RiceEars';
import { DeityPortrait } from '../components/home/DeityPortrait';
import { PrayerGuidance } from '../components/home/PrayerGuidance';
import { SiteFooter } from '../components/layout/SiteFooter';

export function HomePage() {
  const { settings, loaded } = useSiteSettings();

  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-[linear-gradient(180deg,var(--color-ink-800)_0%,var(--color-ink-900)_45%,var(--color-ink-950)_100%)]">
      <RiceEars />

      <main className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))]">
        <header className="text-center">
          <p className="whitespace-nowrap pl-[0.6em] text-base tracking-[0.6em] text-gold sm:text-lg">{settings.site_name}</p>
          <h1 className="mt-3 whitespace-nowrap pl-[0.2em] text-[clamp(1.6rem,7.5vw,3rem)] font-bold tracking-[0.2em] text-paper">{settings.site_subtitle}</h1>
          <CloudDivider className="mt-5" />
        </header>

        <div className="mt-8 sm:mt-10">
          <DeityPortrait photoUrl={settings.deity_photo_url} deityName={settings.deity_name} settingsLoaded={loaded} />
        </div>

        {settings.homepage_announcement && (
          <p className="mt-8 max-w-xl border-y border-gold/30 px-4 py-3 text-center leading-relaxed text-paper/85">
            {settings.homepage_announcement}
          </p>
        )}

        <div className="mt-10 sm:mt-12">
          <PrayerGuidance />
        </div>

        <nav aria-label="其他內容" className="mt-12 flex gap-8 text-base tracking-widest text-gold-soft/90">
          <Link to="/about" className="border-b border-gold/40 pb-1 hover:text-paper">認識藏頭籤詩</Link>
          <Link to="/fortunes" className="border-b border-gold/40 pb-1 hover:text-paper">籤詩查詢</Link>
        </nav>
      </main>

      <div className="h-24 sm:h-32" />
      <SiteFooter siteName={settings.site_name} />
    </div>
  );
}
