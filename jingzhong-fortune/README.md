# 臺南後壁旌忠廟藏頭籤詩數位抽籤系統

「忠義傳承・藏頭籤詩」：58 首籤詩（第 1～56 首藏頭籤、第 57 首大吉、第 58 首小喜）的數位抽籤、模擬擲筊與匿名統計系統。

技術規格：React、TypeScript、Vite、Tailwind CSS、Supabase、Vercel。

## 目前進度

| 階段 | 狀態 |
| --- | --- |
| 一、資料盤點 | 資料結構與檢查工具已完成；**等待論文與圖片**，見 [docs/STAGE1_REPORT.md](docs/STAGE1_REPORT.md) |
| 二、前端介面 | 首頁（主神照片與默念祈求）已完成；搖籤、擲筊、籤詩頁尚未開始 |
| 三～七 | 尚未開始 |

## 本機開發

```bash
npm install
npm run dev
```

正式建置：`npm run build`（輸出到 `dist/`）。部署到 Vercel 時，Root Directory 設為 `jingzhong-fortune`；`vercel.json` 已處理前端路由。

## 首頁與主神照片

首頁流程：觀看主神照片並默念 → 點「開始求籤」→ 搖籤 → 模擬擲筊 → 顯示抽中籤詩的原始圖片。
不倒數、不限時，也不要求輸入姓名、生日或求籤內容。

- 主神照片只使用廟方提供的正式照片，原樣顯示（不裁切、不加濾鏡），不以 AI 生成或其他圖片替代。
- 放置方式：見 `public/images/deity/README.md`。尚未提供時，首頁只顯示「待廟方提供正式照片」的文字框。
- 網站名稱、副標、主神照片網址、主神稱號、首頁公告目前在 `public/site-settings.json` 設定；第三、四階段改由 Supabase `site_settings` 表提供，並可在後台上傳更換照片。

> 原始需求「不要直接放置神明肖像」已依廟方新指示調整為：**只可使用廟方提供的正式照片**，仍禁止 AI 生成或自行替換的神像。
> 「誠心祈求」原本規劃在 /draw 第一階段，現已移到首頁；/draw 將直接從搖籤開始。

## 資料夾

```
src/                          前端程式（pages、components、config、hooks）
public/site-settings.json     網站設定（第三階段改接 Supabase）
public/images/deity/          主神正式照片
data/fortunes.template.json   58 首空白資料範本（依論文填入後另存為 data/fortunes.json）
data/images/                  001.png～058.png、back.png
scripts/inventory.mjs         資料與圖片檢查工具
reports/                      檢查工具產生的報告
docs/                         各階段報告
```

## 資料檢查

需要 Node.js 18 以上，不需安裝其他套件。

```bash
node scripts/inventory.mjs
```

原詩經人工逐首確認後，建立防改動校驗基準：

```bash
node scripts/inventory.mjs --lock
```

## 資料原則
- 原詩只依論文逐字輸入，不得修改、潤飾或改成簡體。
- 原詩與代表人物、故事分開記錄；不同版本的代表人物不混用。
- 不確定的典故標示「待確認」。
- 解說須經人工確認（`review_status = approved`）才公開。
