# 臺南後壁旌忠廟藏頭籤詩線上求籤

線上抽籤＋籤詩圖片展示。第 1～58 籤全部可抽，抽出後直接顯示廟方提供的原始籤詩圖片，可另行模擬擲筊。
**不提供**任何籤詩文字、解說、典故、人物、吉凶或卦象。

技術：React、TypeScript、Vite、Tailwind CSS、Supabase、Vercel。

## 網站內容

| 網址 | 內容 |
| --- | --- |
| `/` | 主神照片、默念提示、「開始求籤」 |
| `/draw` | 自動搖籤 → 抽出 → 籤詩原始圖片 → 模擬擲筊（選用）→ 重新抽籤／返回首頁 |
| `/admin` | 管理者登入：上傳／更換籤詩圖片、更換主神照片、匿名抽籤統計（含 CSV 匯出） |

使用者操作只需一步：在首頁按「開始求籤」，即自動搖籤並顯示結果。

## 運作規則

- **抽籤**：由資料庫函式 `draw_fortune` 以安全亂數從 58 支中均勻抽出一支，並在同一個資料庫動作中把該籤次數加 1。每次抽籤都是獨立的，抽過的籤下次仍可能抽到。
- **防重複計數**：畫面同一時間只允許一個抽籤請求，連點不會重複計數。
- **模擬擲筊**：完全在瀏覽器內進行，兩個筊杯各自隨機落地（聖筊：一平一凸；笑筊：兩平；陰筊：兩凸）。不改變籤號、不連線、不增加抽籤次數。畫面標示「模擬」與「僅供參考」。
- **匿名統計**：資料庫只有每支籤的累計次數；不保存姓名、電話、生日、LINE、IP 或任何個別抽籤／擲筊紀錄。次數只有管理者看得到，且連管理者也無法直接修改。
- **圖片**：原樣保存與顯示，不裁切、不修改。尚未上傳的籤只顯示「此籤圖片尚未上傳」，不會出現破圖或錯誤圖片。

## 資料庫（Supabase）

只有三個資料表，見 `supabase/migrations/0001_init.sql`：

| 資料表 | 內容 |
| --- | --- |
| `fortunes` | 58 筆：籤號、累計抽出次數、圖片最後上傳時間 |
| `site_settings` | 1 筆：主神照片最後上傳時間 |
| `admin_users` | 管理者帳號名單 |

圖片放在 Storage 的 `images` 空間：`fortunes/001`～`fortunes/058`、`site/deity`。

## 上線步驟

### 1. 建立 Supabase 專案
1. 到 [supabase.com](https://supabase.com) 建立免費專案（地區建議選 Tokyo 或 Singapore）。
2. 左側「SQL Editor」→ 貼上 `supabase/migrations/0001_init.sql` 全部內容 → Run。
3. 「Authentication → Sign In / Providers」：**關閉「Allow new users to sign up」**，避免外人自行註冊。

### 2. 建立管理者帳號
1. 「Authentication → Users → Add user」，輸入管理者的電子郵件與密碼。
2. 到「SQL Editor」執行（把電子郵件換成剛建立的帳號）：

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = '管理者的電子郵件';
```

要移除管理者時，刪除 `admin_users` 中對應的那一筆即可。

### 3. 部署到 Vercel
1. 到 [vercel.com](https://vercel.com) 用 GitHub 帳號登入 → Add New Project → 選這個儲存庫。
2. **Root Directory 設為 `jingzhong-fortune`**。
3. Environment Variables 加入兩項（Supabase「Project Settings → API」可找到）：
   - `VITE_SUPABASE_URL`：Project URL
   - `VITE_SUPABASE_ANON_KEY`：anon / publishable key
   - **不可**填入 service_role 金鑰。
4. Deploy。完成後到 `/admin` 登入，上傳 58 張籤詩圖片與主神照片。

### 4. QR Code
把 Vercel 提供的正式網址（或廟方自訂網域）用任何 QR Code 產生器製成圖片即可，例如 Chrome 網址列右側的「分享 → 建立 QR 圖碼」。

## 圖片規格
- 籤詩圖片：建議命名 `001.png`～`058.png`；後台「批次上傳」可一次選取多張，依檔名自動對應籤號。也接受 JPG、WebP，單張 10 MB 以內。
- 主神照片：廟方提供的正式照片，建議直式、長邊至少 1600 像素。
- 更換圖片後，網址會自動更新；少數瀏覽器可能要約 10 分鐘才看到新圖。

## 本機開發

```bash
npm install
npm run dev
```

未設定 `.env` 時為「本機模式」：抽籤在瀏覽器內產生、不統計次數，圖片讀取 `public/images/fortunes/001.png` 等檔案，後台無法使用。
要連接 Supabase，複製 `.env.example` 為 `.env` 並填入兩個值。

正式建置：`npm run build`。

## 程式結構

```
src/pages/HomePage.tsx            首頁
src/pages/DrawPage.tsx            抽籤流程
src/pages/admin/AdminPage.tsx     後台
src/components/home/              主神照片、默念提示
src/components/draw/              籤筒、籤詩圖片、筊杯、模擬擲筊
src/components/admin/             圖片管理、主神照片、統計
src/lib/drawFortune.ts            抽籤（呼叫資料庫）
src/lib/divination.ts             模擬擲筊（獨立亂數）
src/lib/adminApi.ts               後台上傳與統計
src/config/site.ts                網站名稱、主神稱號
supabase/migrations/              資料庫結構
```
