import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { DrawPage } from './pages/DrawPage';

// 後台只有管理者使用，分開載入，不影響一般民眾的開啟速度。
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/draw" element={<DrawPage />} />
        <Route
          path="/admin"
          element={
            <Suspense fallback={<div className="min-h-dvh bg-ink-900" />}>
              <AdminPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
