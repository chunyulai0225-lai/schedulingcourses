'use strict';
// 執行全部測試：node tests/run-all.js
// 需要 Playwright（npm install -g playwright 後執行 npx playwright install chromium）。
// 注意：請不要在外掛資料夾內執行 npm install，node_modules 會讓 Chrome 無法載入外掛。
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('找不到 Playwright。請先執行：\n  npm install -g playwright\n  npx playwright install chromium\n然後以 NODE_PATH="$(npm root -g)" node tests/run-all.js 執行。');
  process.exit(2);
}
const lib = require('./lib');
const fs = require('fs');
const path = require('path');

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch();
  await require('./adapter.test').run(browser);
  await browser.close();
  await require('./extension.test').run();
  const { pass, fail, results } = lib.summary();
  const out = path.join(__dirname, 'last-run.json');
  fs.writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), pass, fail, results }, null, 2));
  console.log(`結果已寫入 ${out}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
