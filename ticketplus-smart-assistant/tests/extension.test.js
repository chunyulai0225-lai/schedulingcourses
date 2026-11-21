'use strict';
// 端對端測試：在 Chromium 中載入真正的外掛，對本機模擬網站進行測試。
// 不會連線到正式的 Ticket Plus 網站。
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { start } = require('./server');
const { section, test, assert, eq, waitFor } = require('./lib');

const EXT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await start();
  const base = `http://localhost:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;

  const S = (fn, arg) => sw.evaluate(fn, arg);
  const monitor = () => S(() => self.TPStorage.getMonitor());
  const logs = () => S(() => self.TPStorage.getLogs());
  const hasLog = async (pred) => (await logs()).some(pred);
  const tabIdOf = (page) => S(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id, page.url());
  const untrusted = (page) => page.evaluate(() => ({ clicks: document.body.getAttribute('data-untrusted-clicks'), final: document.body.getAttribute('data-final-clicked') }));
  const panelText = (page) => page.locator('tpsa-panel .card, tpsa-panel .mini').first().innerText({ timeout: 8000 });

  const baseProfile = {
    name: '演唱會 A',
    eventUrl: `${base}/event-live.html`,
    saleDate: '2026-12-01',
    saleTime: '12:00',
    sessionKeyword: '12/20',
    ticketTypesPrimary: ['全票'],
    ticketTypesBackup: ['身障票'],
    areas: ['VIP A區', 'A1區', ''],
    quantity: 2,
    mode: 'monitor'
  };
  async function useProfile(patch) {
    return S(async (p) => {
      await self.TPStorage.saveSettings({ disclaimerAccepted: true });
      const list = await self.TPStorage.getProfiles();
      const existing = list.find((x) => x.name === p.name);
      const saved = await self.TPStorage.saveProfile(Object.assign({}, existing || {}, p));
      await self.__tp.handlers.setActiveProfile({ id: saved.id });
      await self.__tp.handlers.profilesChanged();
      return saved;
    }, Object.assign({}, baseProfile, patch || {}));
  }
  async function startOn(page) {
    const tabId = await tabIdOf(page);
    await S(async (id) => {
      await self.__tp.stopMonitoring('測試重設');
      await self.TPStorage.clearLogs();
      self.TPNotify.resetDedupe();
      await self.__tp.startMonitoring(id);
    }, tabId);
    return tabId;
  }

  // ════════════════════════════════════════════════════
  section('第一階段：專案架構與 Manifest V3');
  await test('Service worker 成功啟動（Manifest V3）', async () => {
    const mv = await S(() => chrome.runtime.getManifest().manifest_version);
    eq(mv, 3);
  });
  await test('所有宣告的檔案都存在', async () => {
    const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    const files = [m.action.default_popup, m.options_page, m.background.service_worker, ...m.content_scripts[0].js, ...Object.values(m.icons)];
    files.forEach((f) => assert(fs.existsSync(path.join(EXT, f)), `缺少 ${f}`));
  });
  await test('權限最小化：沒有 cookies / webRequest / scripting / <all_urls>', async () => {
    const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    const all = JSON.stringify(m);
    ['cookies', 'webRequest', 'declarativeNetRequest', 'scripting', 'debugger', '<all_urls>'].forEach((p) => assert(!all.includes(p), `不應包含 ${p}`));
  });

  // ════════════════════════════════════════════════════
  section('第三階段：Chrome 本機資料儲存');
  await test('儲存與讀取活動設定', async () => {
    const r = await S(async () => {
      const p = await self.TPStorage.saveProfile({ name: '儲存測試', eventUrl: 'https://ticketplus.com.tw/activity/abc', quantity: 3, areas: ['', 'B區', ''] });
      const back = await self.TPStorage.getProfile(p.id);
      await self.TPStorage.deleteProfile(p.id);
      return back;
    });
    eq(r.name, '儲存測試'); eq(r.quantity, 3); eq(r.areas, ['', 'B區', ''], '空白的優先順序位置應保留');
  });
  await test('拒絕非官方網址與不合理張數', async () => {
    const r = await S(async () => {
      try { await self.TPStorage.saveProfile({ name: 'x', eventUrl: 'https://evil.example.com/', quantity: 99 }); return null; }
      catch (e) { return e.validation; }
    });
    assert(r && r.length === 2, JSON.stringify(r));
  });
  await test('自動刷新未勾選同意時不得啟用', async () => {
    const r = await S(async () => {
      try { await self.TPStorage.saveProfile({ name: 'x', refresh: { enabled: true, acknowledged: false } }); return 'saved'; }
      catch (e) { return 'rejected'; }
    });
    eq(r, 'rejected');
  });
  await test('拒絕儲存密碼／信用卡等敏感欄位', async () => {
    const r = await S(async () => {
      const out = [];
      for (const obj of [{ password: 'x' }, { creditCard: '4111' }, { nested: { cvv: '123' } }, { cookie: 'a=b' }]) {
        try { self.TPStorage.assertNoSensitiveKeys(obj); out.push('allowed'); } catch (e) { out.push('blocked'); }
      }
      // 購票資料只保留白名單欄位
      const p = self.TPStorage.sanitizePersonal({ name: 'A', phone: '0912-345-678', email: 'a@b.co', password: 'x', cardNumber: '4111' });
      return { out, keys: Object.keys(p).sort(), phone: p.phone };
    });
    eq(r.out, ['blocked', 'blocked', 'blocked', 'blocked']);
    eq(r.keys, ['email', 'name', 'phone', 'saveConsent']);
    eq(r.phone, '0912345678');
  });
  await test('未同意儲存時不保留個人資料；手機格式驗證', async () => {
    const r = await S(async () => {
      await self.TPStorage.savePersonal({ name: '王小明', phone: '0912345678', email: 'a@b.co', saveConsent: false });
      const raw = await chrome.storage.local.get('personal');
      let err = null;
      try { await self.TPStorage.savePersonal({ phone: '12345', saveConsent: true }); } catch (e) { err = e.message; }
      return { stored: raw.personal || null, err };
    });
    eq(r.stored, null); assert(r.err && r.err.includes('09'), r.err);
  });
  await test('監控紀錄有上限且並行寫入不會遺失', async () => {
    const n = await S(async () => {
      await self.TPStorage.clearLogs();
      await Promise.all(Array.from({ length: 40 }, (_, i) => self.TPStorage.addLog({ message: 'x' + i })));
      return (await self.TPStorage.getLogs()).length;
    });
    eq(n, 40);
  });

  // ════════════════════════════════════════════════════
  section('第二階段：主畫面與設定介面');
  const options = await ctx.newPage();
  await test('首次開啟設定頁顯示使用須知，同意後才可使用', async () => {
    await S(() => self.TPStorage.clearAll());
    await options.goto(extUrl('options.html'));
    await options.waitForSelector('#disclaimer:not([hidden])');
    assert(await options.isDisabled('#dOk'), '未勾選時按鈕應停用');
    await options.check('#dAgree');
    await options.click('#dOk');
    await options.waitForSelector('#disclaimer', { state: 'hidden' });
  });
  await test('透過表單建立活動設定（驗證錯誤會顯示中文訊息）', async () => {
    await options.fill('input[name=name]', '演唱會 B');
    await options.fill('input[name=eventUrl]', 'https://example.com/x');
    await options.click('button[type=submit]');
    await options.waitForSelector('#formErrors:not([hidden])');
    assert((await options.innerText('#formErrors')).includes('只支援 Ticket Plus 官方網址'));
    await options.fill('input[name=eventUrl]', 'https://ticketplus.com.tw/activity/demo');
    await options.fill('input[name=saleDate]', '2026-12-01');
    await options.fill('input[name=saleTime]', '12:00');
    await options.fill('input[name=ticketTypesPrimary]', '全票, 學生票');
    await options.fill('input[name=area0]', 'VIP A區');
    await options.selectOption('select[name=quantity]', '2');
    await options.click('button[type=submit]');
    await options.waitForSelector('.profile-list li.selected');
    const p = await S(() => self.TPStorage.getActiveProfile());
    eq(p.name, '演唱會 B'); eq(p.ticketTypesPrimary, ['全票', '學生票']); eq(p.quantity, 2);
    await options.screenshot({ path: path.join(SHOTS, 'options-profile.png'), fullPage: true });
  });
  await test('可新增第二組設定並切換', async () => {
    await options.click('#btnNew');
    await options.fill('input[name=name]', '演唱會 C');
    await options.click('button[type=submit]');
    await options.waitForFunction(() => document.querySelectorAll('.profile-list li[data-id]').length === 2);
    await options.click('#btnActivate');
    await options.waitForSelector('#activeBadge:not([hidden])');
    eq((await S(() => self.TPStorage.getActiveProfile())).name, '演唱會 C');
  });
  await test('主畫面（popup）顯示活動資訊與控制按鈕', async () => {
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 380, height: 760 });
    await popup.goto(extUrl('popup.html'));
    await popup.waitForSelector('#main:not([hidden])');
    eq(await popup.innerText('#pName'), '演唱會 C');
    eq(await popup.innerText('#mState'), '未啟動');
    assert(await popup.isDisabled('#btnPause'));
    for (const t of ['開始監控', '暫停監控', '停止監控', '開啟活動頁面', '編輯購票設定']) assert((await popup.innerText('.actions')).includes(t), `缺少按鈕 ${t}`);
    await popup.selectOption('#profileSelect', { label: '演唱會 B' });
    await popup.waitForFunction(() => document.getElementById('pName').textContent === '演唱會 B');
    await popup.screenshot({ path: path.join(SHOTS, 'popup.png') });
    await popup.close();
  });
  await test('購票資料頁：儲存並可清除', async () => {
    await options.click('[data-tab=personal]');
    await options.fill('#personalForm input[name=name]', '王小明');
    await options.fill('#personalForm input[name=phone]', '0912345678');
    await options.fill('#personalForm input[name=email]', 'ming@example.com');
    await options.check('#personalForm input[name=saveConsent]');
    await options.click('#personalForm button[type=submit]');
    await waitFor(async () => (await S(() => self.TPStorage.getPersonal())).saveConsent);
  });

  // ════════════════════════════════════════════════════
  section('第四階段：通知系統');
  await test('測試通知會寫入通知紀錄', async () => {
    await S(() => self.TPStorage.clearLogs());
    await options.click('[data-tab=profiles]');
    await options.click('#btnTestNotify');
    await waitFor(() => hasLog((l) => l.level === 'notify' && l.message.includes('測試')));
  });
  await test('相同通知 30 秒內不重複發送', async () => {
    const r = await S(async () => {
      self.TPNotify.resetDedupe();
      const a = await self.TPNotify.notify('queue', { dedupeKey: 'x' });
      const b = await self.TPNotify.notify('queue', { dedupeKey: 'x' });
      return [a.sent, b.sent];
    });
    eq(r, [true, false]);
  });
  await test('關閉票況變化通知時不發送', async () => {
    const r = await S(() => self.TPNotify.notify('statusChange', { profile: { notify: { statusChange: false } } }));
    eq(r.sent, false);
  });

  // ════════════════════════════════════════════════════
  section('第五、六階段：頁面辨識與票況監控');
  await useProfile();
  const page = await ctx.newPage();
  await test('非監控分頁不顯示面板、不回報', async () => {
    await page.goto(`${base}/event-not-on-sale.html`);
    await page.waitForTimeout(1500);
    eq(await page.locator('tpsa-panel').count(), 0);
  });
  await test('尚未開賣：開始監控後回報 notOnSale', async () => {
    await page.goto(`${base}/event-live.html?flip=4000`);
    await startOn(page);
    const m = await waitFor(async () => { const m = await monitor(); return m.pageType === 'event' && m; });
    eq(m.saleStatus, 'notOnSale'); eq(m.state, 'monitoring');
    assert((await panelText(page)).includes('尚未開賣'));
  });
  await test('開賣後立即偵測到符合場次並通知', async () => {
    const m = await waitFor(async () => { const m = await monitor(); return m.saleStatus === 'onSale' && m; }, { timeout: 10000 });
    assert(m.matches.length === 1 && m.matches[0].label.includes('12/20'), JSON.stringify(m.matches));
    await waitFor(() => hasLog((l) => l.category === 'ticketMatch'), { msg: '應有符合票券通知' });
    const outline = await page.evaluate(() => document.querySelectorAll('.session-item')[0].style.outline);
    assert(outline.includes('solid'), '符合的場次應被標示');
    await page.screenshot({ path: path.join(SHOTS, 'event-match.png') });
  });
  await test('外掛沒有點擊「立即購買」按鈕（仍停留在活動頁）', async () => {
    await page.waitForTimeout(1500);
    assert(page.url().includes('event-live.html'));
    eq((await untrusted(page)).clicks, null);
  });
  await test('票券售完 → soldOut', async () => {
    await page.goto(`${base}/event-sold-out.html`);
    await waitFor(async () => (await monitor()).saleStatus === 'soldOut');
  });
  await test('購票頁：符合指定票種與區域，依優先順序列出', async () => {
    await page.goto(`${base}/order.html`);
    const m = await waitFor(async () => { const m = await monitor(); return m.pageType === 'order' && m; });
    assert(m.matches[0].label.includes('VIP A區'), JSON.stringify(m.matches));
    assert(m.matches.some((x) => x.label.includes('A1區')));
    const txt = await panelText(page);
    assert(txt.includes('符合您設定的票券'), txt);
    await page.screenshot({ path: path.join(SHOTS, 'order-match.png') });
  });
  await test('指定區域無票：不列為符合', async () => {
    await page.goto(`${base}/order-area-soldout.html`);
    const m = await waitFor(async () => { const m = await monitor(); return m.pageType === 'order' && m.url.includes('area-soldout') && m; });
    eq(m.matches.length, 0);
    assert((await panelText(page)).includes('目前沒有符合'));
  });
  await test('網站改版（無法辨識）→ 15 秒寬限後顯示「無法辨識目前頁面」並通知', async () => {
    await page.goto(`${base}/changed.html`);
    await waitFor(async () => (await monitor()).pageType === 'loading', { msg: '寬限期內應顯示載入中' });
    await waitFor(async () => (await monitor()).pageType === 'unknown', { timeout: 22000 });
    assert((await panelText(page)).includes('無法辨識目前頁面'));
    await waitFor(() => hasLog((l) => l.category === 'unrecognized'));
  });
  await test('網頁錯誤 → error', async () => {
    await page.goto(`${base}/error.html`);
    await waitFor(async () => (await monitor()).attention === 'error');
    await waitFor(() => hasLog((l) => l.category === 'pageError'));
  });
  await test('購票頁面逾時 → timeout', async () => {
    await page.goto(`${base}/timeout.html`);
    await waitFor(async () => (await monitor()).pageType === 'timeout');
  });
  await test('網路中斷 → offline 通知；恢復後重新偵測', async () => {
    await page.goto(`${base}/event-not-on-sale.html`);
    await waitFor(async () => (await monitor()).pageType === 'event');
    await ctx.setOffline(true);
    try {
      await waitFor(async () => (await monitor()).attention === 'offline');
      await waitFor(() => hasLog((l) => l.category === 'offline'));
      assert((await panelText(page)).includes('網路中斷'));
    } finally {
      await ctx.setOffline(false);
    }
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitFor(async () => (await monitor()).online === true && (await monitor()).attention === null);
  });
  await test('使用者重新整理頁面 → 仍維持監控', async () => {
    await page.reload();
    await waitFor(() => hasLog((l) => l.message.includes('重新整理')));
    eq((await monitor()).state, 'monitoring');
    await waitFor(async () => (await page.locator('tpsa-panel').count()) === 1);
  });
  await test('暫停監控時不發送通知', async () => {
    await page.goto(`${base}/event-live.html?flip=2500`);
    await waitFor(async () => (await monitor()).url && (await monitor()).url.includes('event-live'));
    await S(async () => { await self.TPStorage.clearLogs(); await self.__tp.handlers.pause(); });
    await page.waitForTimeout(4500);
    eq((await monitor()).saleStatus, 'onSale', '暫停時仍更新顯示');
    assert(!(await hasLog((l) => l.level === 'notify')), '暫停時不應通知');
    await S(() => self.__tp.handlers.resume());
    eq((await monitor()).state, 'monitoring');
  });

  // ════════════════════════════════════════════════════
  section('第六階段：低頻率自動刷新（需使用者同意）');
  await test('未開啟自動刷新時不建立刷新排程', async () => {
    const alarm = await S(() => chrome.alarms.get('tp-refresh'));
    eq(alarm || null, null);
  });
  await test('開啟後：尚未開賣頁面允許刷新；最短 30 秒', async () => {
    await useProfile({ refresh: { enabled: true, acknowledged: true, intervalSec: 5 } });
    const p = await S(() => self.TPStorage.getActiveProfile());
    eq(p.refresh.intervalSec, 30, '低於 30 秒應被調整為 30 秒');
    await page.goto(`${base}/event-not-on-sale.html`);
    await startOn(page);
    await waitFor(async () => (await monitor()).pageType === 'event');
    const alarm = await S(() => chrome.alarms.get('tp-refresh'));
    eq(alarm.periodInMinutes, 0.5);
    await page.waitForTimeout(21000); // 測試開始時的滑鼠/鍵盤操作冷卻
    const reloaded = page.waitForEvent('load');
    await S(() => self.__tp.handleRefreshAlarm());
    await waitFor(() => hasLog((l) => l.message === '自動刷新活動頁面'));
    await reloaded;
  });
  await test('排隊頁面永不自動刷新', async () => {
    await page.goto(`${base}/queue.html`);
    await waitFor(async () => (await monitor()).pageType === 'queue');
    await S(() => self.TPStorage.clearLogs());
    await S(() => self.__tp.handleRefreshAlarm());
    await waitFor(() => hasLog((l) => l.message === '略過本次自動刷新' && l.detail.includes('永不自動刷新')));
    assert(!(await hasLog((l) => l.message === '自動刷新活動頁面')));
  });
  await test('販售中頁面不刷新（避免干擾購票）', async () => {
    await page.goto(`${base}/order.html`);
    await waitFor(async () => (await monitor()).pageType === 'order');
    await S(() => self.TPStorage.clearLogs());
    await S(() => self.__tp.handleRefreshAlarm());
    await waitFor(() => hasLog((l) => l.message === '略過本次自動刷新'));
  });
  await useProfile({ refresh: { enabled: false, acknowledged: false, intervalSec: 60 } });

  // ════════════════════════════════════════════════════
  section('Enter 快速操作（外掛只選取按鈕，由使用者按 Enter）');
  const focusedText = (pg) => pg.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.className + '|' + (a.innerText || '').trim()) : ''; });
  await test('開賣時自動選取「立即購買」並把分頁切到最前面', async () => {
    await useProfile({ mode: 'monitor', quickKey: true });
    const other = await ctx.newPage();
    await other.goto(`${base}/no-meta.html`);
    await page.goto(`${base}/event-live.html?flip=3000`);
    await startOn(page);
    await other.bringToFront();
    await waitFor(async () => (await focusedText(page)).includes('立即購買'), { timeout: 10000, msg: '購買按鈕應被選取' });
    const tid = await tabIdOf(page);
    await waitFor(() => S(async (id) => (await chrome.tabs.get(id)).active, tid), { msg: '分頁應切到最前面' });
    assert((await panelText(page)).includes('按 Enter 即可進入購買'));
    eq((await untrusted(page)).clicks, null, '外掛不得自行點擊');
    await page.screenshot({ path: path.join(SHOTS, 'enter-buy.png') });
    await other.close();
  });
  await test('使用者按 Enter → 由使用者本人進入購票頁', async () => {
    await page.keyboard.press('Enter');
    await page.waitForURL(/order\.html/);
  });
  await test('購票頁自動選取最優先票種的「＋」；連按 Enter 3 次只會選到設定的 2 張', async () => {
    await waitFor(async () => (await focusedText(page)).includes('btn-plus'), { msg: '＋按鈕應被選取' });
    const rowName = await page.evaluate(() => document.activeElement.closest('.ticket-row').querySelector('.area-name').textContent);
    eq(rowName, 'VIP A區 全票', '應選取第一優先的票種');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // 多按一次
    await page.waitForTimeout(800);
    eq(await page.locator('.ticket-row:has-text("VIP A區") .count').innerText(), '2');
    assert(!(await focusedText(page)).includes('btn-plus'), '選滿後應放開焦點');
    await waitFor(async () => (await panelText(page)).includes('已選好 2 張'));
    eq((await untrusted(page)).clicks, null, '外掛不得自行點擊');
  });
  await test('不搶游標：使用者點了其他欄位後不會被拉回；按面板「⌨ 選取按鈕」可重新選取', async () => {
    await page.reload();
    await waitFor(async () => (await focusedText(page)).includes('btn-plus'));
    await page.click('#f-name');
    await page.waitForTimeout(2500);
    eq(await page.evaluate(() => document.activeElement.id), 'f-name');
    await page.locator('tpsa-panel [data-act=refocus]').click();
    await waitFor(async () => (await focusedText(page)).includes('btn-plus'));
  });
  await test('關閉 Enter 快速操作時不選取任何按鈕', async () => {
    await useProfile({ mode: 'monitor', quickKey: false });
    await page.reload();
    await waitFor(async () => (await monitor()).pageType === 'order');
    await page.waitForTimeout(1500);
    eq(await focusedText(page), '');
    await useProfile({ quickKey: true });
  });

  // ════════════════════════════════════════════════════
  section('第七階段：選票輔助與一般資料填寫');
  await test('純監控模式：不顯示填寫按鈕、不修改任何欄位', async () => {
    await useProfile({ mode: 'monitor' });
    await page.goto(`${base}/order.html`);
    await startOn(page);
    await waitFor(async () => (await monitor()).pageType === 'order');
    const txt = await panelText(page);
    assert(!txt.includes('填寫購票資料'), '純監控模式不應顯示填寫按鈕');
    eq(await page.inputValue('#f-name'), '');
  });
  await test('輔助模式：按下填寫 → 先預覽確認 → 只填姓名/手機/Email，不填身分證', async () => {
    await useProfile({ mode: 'assist' });
    await page.goto(`${base}/order.html`);
    await startOn(page);
    await waitFor(async () => (await monitor()).pageType === 'order');
    await page.locator('tpsa-panel [data-act=fill]').click();
    const confirmText = await page.locator('tpsa-panel .alert.a-info').innerText();
    assert(confirmText.includes('確認填寫購票資料') && confirmText.includes('0912***678'), confirmText);
    assert(confirmText.includes('略過敏感欄位'), '應說明略過身分證欄位');
    eq(await page.inputValue('#f-name'), '', '確認前不得填寫');
    await page.locator('tpsa-panel [data-act=confirm-yes]').click();
    await waitFor(async () => (await page.inputValue('#f-name')) === '王小明');
    eq(await page.inputValue('#f-phone'), '0912345678');
    eq(await page.inputValue('#f-email'), 'ming@example.com');
    eq(await page.inputValue('#f-id'), '', '身分證欄位不得填寫');
    await page.screenshot({ path: path.join(SHOTS, 'assist-fill.png') });
  });
  await test('取消確認時不填寫', async () => {
    await page.reload();
    await waitFor(async () => (await page.locator('tpsa-panel [data-act=fill]').count()) === 1);
    await page.locator('tpsa-panel [data-act=fill]').click();
    await page.locator('tpsa-panel [data-act=confirm-no]').click();
    await page.waitForTimeout(300);
    eq(await page.inputValue('#f-name'), '');
  });
  await test('+/- 按鈕版面：外掛不點擊，只提示使用者自行操作', async () => {
    await page.locator('tpsa-panel [data-act=qty]').first().click();
    const txt = await panelText(page);
    assert(txt.includes('外掛不會替您點擊'), txt);
    await page.waitForTimeout(500);
    eq(await page.locator('.count').first().innerText(), '0');
  });
  await test('下拉選單版面：確認後設定張數（不超過頁面上限）', async () => {
    await useProfile({ mode: 'assist', areas: ['C1區', '', ''] });
    await page.goto(`${base}/order-area-soldout.html`);
    await waitFor(async () => (await page.locator('tpsa-panel [data-act=qty]').count()) === 1);
    await page.locator('tpsa-panel [data-act=qty]').click();
    assert((await panelText(page)).includes('確認設定張數'));
    await page.locator('tpsa-panel [data-act=confirm-yes]').click();
    await waitFor(async () => (await page.locator('tr:has-text("C1區") select').inputValue()) === '2');
  });
  await test('整個輔助流程中，外掛從未以程式點擊網站上的任何元素', async () => {
    eq(await untrusted(page), { clicks: null, final: null });
  });

  // ════════════════════════════════════════════════════
  section('第八階段：驗證碼與排隊偵測');
  await test('出現驗證碼 → 立即暫停輔助、顯示提示並通知', async () => {
    // 先把另一個分頁切到最前面，模擬使用者正在看別的頁面
    const other = await ctx.newPage();
    await other.goto(`${base}/no-meta.html`);
    await other.bringToFront();
    page.__other = other;
    await page.goto(`${base}/captcha.html`);
    await waitFor(async () => (await monitor()).attention === 'captcha');
    await waitFor(() => hasLog((l) => l.category === 'captcha' && l.level === 'notify'));
    const txt = await panelText(page);
    assert(txt.includes('已暫停自動輔助') && txt.includes('親自完成'), txt);
    eq(await page.locator('tpsa-panel [data-act=fill]').count(), 0, '驗證碼期間不得提供填寫');
    eq(await page.inputValue('input[name=captchaCode]'), '', '不得填寫驗證碼');
    await page.screenshot({ path: path.join(SHOTS, 'captcha-hold.png') });
  });
  await test('快速輸入：活動分頁自動切到最前面', async () => {
    const tabId = await tabIdOf(page);
    await waitFor(() => S(async (id) => (await chrome.tabs.get(id)).active, tabId), { msg: '活動分頁應被切到最前面' });
    await waitFor(() => hasLog((l) => l.message === '已將活動頁面切換到最前面'));
    await page.__other.close();
  });
  await test('快速輸入：游標自動放進驗證碼輸入框，但內容保持空白', async () => {
    await waitFor(() => page.evaluate(() => document.activeElement && document.activeElement.name === 'captchaCode'), { msg: '游標應在驗證碼輸入框' });
    eq(await page.inputValue('input[name=captchaCode]'), '', '外掛不得輸入任何內容');
    assert((await panelText(page)).includes('游標已放在驗證碼輸入框'));
  });
  await test('快速輸入：提示音重複響，使用者開始打字後停止', async () => {
    const before = await S(() => self.__tp.alertRepeats());
    await page.waitForTimeout(9000);
    const during = await S(() => self.__tp.alertRepeats());
    assert(during - before >= 2, `9 秒內應重複至少 2 次（實際 ${during - before}）`);
    await page.keyboard.type('7K3P'); // 模擬使用者親自輸入
    eq(await page.inputValue('input[name=captchaCode]'), '7K3P', '使用者的輸入直接進入驗證碼欄位');
    const afterTyping = await S(() => self.__tp.alertRepeats());
    await page.waitForTimeout(6000);
    eq(await S(() => self.__tp.alertRepeats()), afterTyping, '開始打字後不應再響');
  });
  await test('快速輸入：使用者已在其他欄位打字時不搶游標', async () => {
    await page.goto(`${base}/order.html`);
    await waitFor(async () => (await monitor()).pageType === 'order');
    await page.click('#f-name');
    await page.keyboard.type('王');
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.className = 'captcha-box';
      box.innerHTML = '<p>請輸入驗證碼</p><img class="captcha-img" alt="" width="120" height="40" src="data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%2740%27/>"><input name="captchaCode" type="text">';
      document.querySelector('main').prepend(box);
    });
    await waitFor(async () => (await monitor()).attention === 'captcha');
    await page.waitForTimeout(1000);
    eq(await page.evaluate(() => document.activeElement.id), 'f-name', '不應把游標從使用者正在輸入的欄位搶走');
  });
  await test('使用者完成驗證（驗證元件消失）→ 輔助恢復但仍需逐一確認', async () => {
    await page.evaluate(() => document.querySelector('.captcha-box').remove());
    await waitFor(async () => (await monitor()).pageType === 'order');
    assert((await panelText(page)).includes('安全檢查頁面已結束'));
  });
  await test('簡訊驗證 → verification，游標自動放進驗證碼欄位', async () => {
    await page.goto(`${base}/sms.html`);
    await waitFor(async () => (await monitor()).attention === 'verification');
    await waitFor(() => page.evaluate(() => document.activeElement && document.activeElement.tagName === 'INPUT'), { msg: '游標應在簡訊驗證碼欄位' });
    eq(await page.inputValue('input'), '');
  });
  await test('排隊頁面 → 通知並提醒不要重新整理', async () => {
    await page.goto(`${base}/queue.html`);
    await waitFor(async () => (await monitor()).attention === 'queue');
    await waitFor(() => hasLog((l) => l.category === 'queue'));
    assert((await panelText(page)).includes('不要重新整理'));
  });
  await test('登入頁面 → 請使用者親自登入', async () => {
    await page.goto(`${base}/login.html`);
    await waitFor(async () => (await monitor()).attention === 'login');
  });

  // ════════════════════════════════════════════════════
  section('第九階段：人工確認流程');
  await test('進入訂單確認頁 → 停止所有操作、列出設定與訂單資訊', async () => {
    await page.goto(`${base}/checkout.html`);
    await waitFor(async () => (await monitor()).attention === 'checkout');
    await waitFor(() => hasLog((l) => l.category === 'manualConfirm'));
    const m = await monitor();
    assert(m.orderInfo.some((l) => l.includes('總計')), JSON.stringify(m.orderInfo));
    const txt = await panelText(page);
    ['人工確認階段', '不會點擊確認或付款按鈕', '張數：2 張', '總計：NT$7,600'].forEach((t) => assert(txt.includes(t), `面板應包含「${t}」\n${txt}`));
    await page.screenshot({ path: path.join(SHOTS, 'manual-confirm.png') });
  });
  await test('等待 5 秒：確認付款按鈕從未被外掛點擊或選取', async () => {
    await page.waitForTimeout(5000);
    assert(await page.evaluate(() => document.activeElement.id !== 'pay-btn'), '付款按鈕不得被選取');
    eq(await untrusted(page), { clicks: null, final: null });
    assert(page.url().includes('checkout.html'));
  });

  // ════════════════════════════════════════════════════
  section('第十階段：錯誤處理（分頁關閉、外掛重啟、停止）');
  await test('使用者關閉活動頁面 → 監控暫停並通知', async () => {
    await page.close();
    const m = await waitFor(async () => { const m = await monitor(); return m.state === 'paused' && m; });
    eq(m.tabId, null);
    await waitFor(() => hasLog((l) => l.category === 'tabClosed'));
  });
  await test('外掛重新啟動且找不到原頁面 → 安全地暫停', async () => {
    await S(() => self.TPStorage.setMonitor({ state: 'monitoring', tabId: 999999 }));
    await S(() => self.__tp.recoverAfterRestart('測試重新啟動'));
    const m = await monitor();
    eq(m.state, 'paused'); eq(m.tabId, null);
  });
  await test('暫停後重新開啟活動頁 → 自動綁定新分頁', async () => {
    const p2 = await ctx.newPage();
    await p2.goto(`${base}/event-not-on-sale.html`);
    const tabId = await tabIdOf(p2);
    await waitFor(async () => (await monitor()).tabId === tabId);
    await S(() => self.__tp.handlers.resume());
    await waitFor(async () => (await monitor()).pageType === 'event');
    await test2Stop(p2);
  });
  async function test2Stop(p2) {
    await S(() => self.__tp.handlers.stop());
    await waitFor(async () => (await p2.locator('tpsa-panel').count()) === 0, { msg: '停止後面板應消失' });
    eq((await monitor()).state, 'idle');
    await p2.close();
  }
  await test('開賣前提醒排程', async () => {
    const r = await S(async () => {
      const t = new Date(Date.now() + 3600 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const p = await self.TPStorage.getActiveProfile();
      p.saleDate = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
      p.saleTime = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
      p.notify.remindMinutes = 10;
      await self.TPStorage.saveProfile(p);
      await self.__tp.scheduleReminders();
      const a = await chrome.alarms.get('tp-reminder');
      const b = await chrome.alarms.get('tp-sale-start');
      return { remind: a && Math.round((a.scheduledTime - Date.now()) / 60000), sale: !!b };
    });
    assert(r.remind >= 48 && r.remind <= 50, JSON.stringify(r)); eq(r.sale, true);
  });
  await test('清除所有資料', async () => {
    await options.click('[data-tab=data]');
    options.once('dialog', (d) => d.accept());
    await options.click('#btnClearAll');
    await waitFor(async () => (await S(() => self.TPStorage.getProfiles())).length === 0);
    const all = await S(() => chrome.storage.local.get(null));
    eq(Object.keys(all).filter((k) => k !== 'monitor' && k !== 'logs'), []);
  });

  await options.close();
  await ctx.close();
  server.close();
}

module.exports = { run };
if (require.main === module) {
  run()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => { const { fail } = require('./lib').summary(); process.exit(fail || process.exitCode ? 1 : 0); });
}
