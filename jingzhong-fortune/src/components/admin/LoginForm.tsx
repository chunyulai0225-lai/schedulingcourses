import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from './ui';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) setError('登入失敗，請確認電子郵件與密碼。');
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-16 w-full max-w-sm rounded-md border border-ink-800/15 bg-white p-6 shadow-sm">
      <h1 className="text-center text-2xl font-semibold text-ink-900">管理者登入</h1>
      <label className="mt-6 block text-sm text-ink-900">
        電子郵件
        <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border border-ink-800/30 px-3 py-2 text-base" />
      </label>
      <label className="mt-4 block text-sm text-ink-900">
        密碼
        <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded border border-ink-800/30 px-3 py-2 text-base" />
      </label>
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={busy} className="mt-6 w-full">{busy ? '登入中…' : '登入'}</Button>
    </form>
  );
}
