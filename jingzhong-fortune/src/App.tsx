import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { PlaceholderPage } from './pages/PlaceholderPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/draw" element={<PlaceholderPage title="搖籤求籤" note="搖籤筒與模擬擲筊流程建置中。" />} />
        <Route path="/about" element={<PlaceholderPage title="認識藏頭籤詩" note="文化介紹將依論文內容整理，資料整理中。" />} />
        <Route path="/fortunes" element={<PlaceholderPage title="籤詩查詢" note="58 首籤詩資料整理中。" />} />
        <Route path="*" element={<PlaceholderPage title="找不到頁面" note="您要前往的頁面不存在。" />} />
      </Routes>
    </BrowserRouter>
  );
}
