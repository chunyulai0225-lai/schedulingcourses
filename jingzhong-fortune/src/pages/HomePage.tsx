import { DEITY_NAME, SITE_NAME, SITE_SUBTITLE } from '../config/site';
import { useDeityPhoto } from '../hooks/useDeityPhoto';
import { CloudDivider } from '../components/decor/CloudDivider';
import { RiceEars } from '../components/decor/RiceEars';
import { DeityPortrait } from '../components/home/DeityPortrait';
import { PrayerGuidance } from '../components/home/PrayerGuidance';
import { SiteFooter } from '../components/layout/SiteFooter';

export function HomePage() {
  const photo = useDeityPhoto();

  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-[linear-gradient(180deg,var(--color-ink-800)_0%,var(--color-ink-900)_45%,var(--color-ink-950)_100%)]">
      <RiceEars />

      <main className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))]">
        <header className="text-center">
          <p className="whitespace-nowrap pl-[0.6em] text-base tracking-[0.6em] text-gold sm:text-lg">{SITE_NAME}</p>
          <h1 className="mt-3 whitespace-nowrap pl-[0.2em] text-[clamp(1.6rem,7.5vw,3rem)] font-bold tracking-[0.2em] text-paper">{SITE_SUBTITLE}</h1>
          <CloudDivider className="mt-5" />
        </header>

        <div className="mt-8 sm:mt-10">
          <DeityPortrait photoUrl={photo.url} deityName={DEITY_NAME} loaded={photo.loaded} />
        </div>

        <div className="mt-10 sm:mt-12">
          <PrayerGuidance />
        </div>
      </main>

      <div className="h-24 sm:h-32" />
      <SiteFooter siteName={SITE_NAME} />
    </div>
  );
}
