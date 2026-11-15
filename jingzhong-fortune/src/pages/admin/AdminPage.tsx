import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { checkIsAdmin } from '../../lib/adminApi';
import { LoginForm } from '../../components/admin/LoginForm';
import { FortuneImageManager } from '../../components/admin/FortuneImageManager';
import { DeityPhotoManager } from '../../components/admin/DeityPhotoManager';
import { StatisticsPanel } from '../../components/admin/StatisticsPanel';
import { Button } from '../../components/admin/ui';

const TABS = [
  { id: 'images', label: '籤詩圖片' },
  { id: 'deity', label: '主神照片' },
  { id: 'stats', label: '抽籤統計' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function Shell({ children, onSignOut }: { children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <div className="min-h-dvh bg-paper text-ink-900">
      <header className="bg-ink-900 text-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <span className="font-semibold tracking-widest">旌忠廟抽籤管理</span>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/" className="text-gold-soft hover:text-paper">回到網站</Link>
            {onSignOut && <button type="button" onClick={onSignOut} className="text-gold-soft hover:text-paper">登出</button>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<TabId>('images');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    if (!session) { setIsAdmin(false); setChecking(false); return; }
    setChecking(true);
    // 權限由資料庫判斷；即使畫面被竄改，資料庫的權限規則仍會拒絕非管理者的修改。
    checkIsAdmin().then((ok) => { setIsAdmin(ok); setChecking(false); });
  }, [session]);

  if (!supabase) {
    return (
      <Shell>
        <p className="rounded bg-amber-50 p-4 leading-relaxed text-amber-900">
          尚未設定 Supabase，後台無法使用。請依 README 建立 Supabase 專案，並設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。
        </p>
      </Shell>
    );
  }

  const signOut = () => void supabase!.auth.signOut();

  if (!session) return <Shell><LoginForm /></Shell>;
  if (checking) return <Shell onSignOut={signOut}><p>確認權限中…</p></Shell>;
  if (!isAdmin) {
    return (
      <Shell onSignOut={signOut}>
        <p className="rounded bg-red-50 p-4 text-red-800">此帳號沒有管理權限。請聯絡系統管理者。</p>
        <Button variant="secondary" className="mt-4" onClick={signOut}>登出</Button>
      </Shell>
    );
  }

  return (
    <Shell onSignOut={signOut}>
      <nav className="mb-6 flex gap-2 overflow-x-auto" aria-label="管理功能">
        {TABS.map((t) => (
          <Button key={t.id} variant={tab === t.id ? 'primary' : 'secondary'} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            {t.label}
          </Button>
        ))}
      </nav>
      {tab === 'images' && <FortuneImageManager />}
      {tab === 'deity' && <DeityPhotoManager />}
      {tab === 'stats' && <StatisticsPanel />}
    </Shell>
  );
}
