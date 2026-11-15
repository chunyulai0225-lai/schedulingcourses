export function SiteFooter({ siteName }: { siteName: string }) {
  return (
    <footer className="relative z-10 mx-auto max-w-2xl px-6 pb-10 pt-6 text-center text-sm leading-relaxed text-paper-dim/80">
      <p className="text-balance">本網站提供線上求籤與模擬擲筊，結果僅供參考；醫療、法律、投資等重大決定，請諮詢相關專業人士。</p>
      <p className="mt-2 tracking-widest">{siteName}</p>
    </footer>
  );
}
