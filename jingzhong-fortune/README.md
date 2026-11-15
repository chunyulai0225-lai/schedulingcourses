# 臺南後壁旌忠廟藏頭籤詩數位抽籤系統

「忠義傳承・藏頭籤詩」：58 首籤詩（第 1～56 首藏頭籤、第 57 首大吉、第 58 首小喜）的數位抽籤、模擬擲筊與匿名統計系統。

技術規格：React、TypeScript、Vite、Tailwind CSS、Supabase、Vercel。

## 目前進度

| 階段 | 狀態 |
| --- | --- |
| 一、資料盤點 | 資料結構與檢查工具已完成；**等待論文與圖片**，見 [docs/STAGE1_REPORT.md](docs/STAGE1_REPORT.md) |
| 二～七 | 尚未開始 |

## 資料夾

```
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
