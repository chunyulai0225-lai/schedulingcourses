'use strict';
// Adapter 單元測試：在真實 Chromium 中把 config.js + ticketplus-adapter.js 注入模擬頁面
const path = require('path');
const { chromium } = require('playwright');
const { start } = require('./server');
const { section, test, assert, eq } = require('./lib');

const EXT = path.join(__dirname, '..');

async function run(browser) {
  const server = await start();
  const base = `http://localhost:${server.address().port}`;
  const page = await browser.newPage();

  async function analyze(file, profile) {
    await page.goto(`${base}/${file}`);
    await page.addScriptTag({ path: path.join(EXT, 'config.js') });
    await page.addScriptTag({ path: path.join(EXT, 'ticketplus-adapter.js') });
    return page.evaluate((profile) => {
      const A = window.TicketPlusAdapter;
      const r = A.analyze(document, location.href);
      const out = {
        pageType: r.pageType, reasons: r.reasons, title: r.title, saleStatus: r.saleStatus, perOrderLimit: r.perOrderLimit,
        sessions: r.sessions.map((s) => ({ name: s.name, status: s.status })),
        tickets: r.tickets.map((t) => ({ name: t.name, context: t.context, price: t.price, remaining: t.remaining, status: t.status, control: t.control && t.control.kind, maxQty: t.maxQty })),
        orderInfo: r.orderInfo,
        form: r.formFields && { name: r.formFields.name.length, phone: r.formFields.phone.length, email: r.formFields.email.length, skipped: r.formFields.skipped.length }
      };
      if (profile) {
        out.sessionMatch = A.matchSessions(r.sessions, profile).map((s) => s.name);
        const m = A.matchTickets(r.tickets, profile, r.perOrderLimit);
        out.match = { matches: m.matches.map((x) => x.label), others: m.others.map((x) => x.label), unavailable: m.unavailable.map((x) => x.label), warnings: m.warnings };
      }
      return out;
    }, profile || null);
  }

  const profile = {
    sessionKeyword: '12/20',
    ticketTypesPrimary: ['全票'], ticketTypesBackup: ['身障票'],
    areas: ['VIP A區', 'A1區', ''], quantity: 2, allowOtherAreas: false
  };

  section('Adapter：頁面辨識（第五階段）');
  await test('尚未開賣的活動頁 → event / notOnSale', async () => {
    const r = await analyze('event-not-on-sale.html', profile);
    eq(r.pageType, 'event'); eq(r.saleStatus, 'notOnSale'); eq(r.sessions.length, 2);
    assert(r.title.includes('星光'), '應擷取活動名稱');
    eq(r.sessionMatch.length, 1, '場次關鍵字 12/20 應只符合 1 場');
  });
  await test('已開始販售的活動頁 → event / onSale，第二場售完', async () => {
    const r = await analyze('event-on-sale.html');
    eq(r.pageType, 'event'); eq(r.saleStatus, 'onSale');
    eq(r.sessions.map((s) => s.status), ['onSale', 'soldOut']);
  });
  await test('全部售完的活動頁 → soldOut', async () => {
    const r = await analyze('event-sold-out.html');
    eq(r.pageType, 'event'); eq(r.saleStatus, 'soldOut');
  });
  await test('購票頁（+/- 按鈕、價格群組）→ order，擷取 5 個票種', async () => {
    const r = await analyze('order.html', profile);
    eq(r.pageType, 'order', `原因：${r.reasons}`);
    eq(r.tickets.length, 5, JSON.stringify(r.tickets));
    const vipA = r.tickets.find((t) => t.name.includes('VIP A區'));
    eq(vipA.price, 6800, 'VIP 價格應由群組標題取得'); eq(vipA.remaining, 12); eq(vipA.status, 'onSale'); eq(vipA.control, 'buttons');
    eq(r.tickets.find((t) => t.name.includes('VIP B區')).status, 'soldOut');
    eq(r.perOrderLimit, 4);
  });
  await test('「付款逾時將自動取消」說明文字與步驟列不會被誤判為逾時／結帳', async () => {
    const r = await analyze('order.html');
    eq(r.pageType, 'order');
  });
  await test('符合指定票種與區域：VIP A區 全票排第一；A1區剩 2 張也符合 2 張', async () => {
    const r = await analyze('order.html', profile);
    eq(r.match.matches[0].includes('VIP A區'), true, JSON.stringify(r.match));
    assert(r.match.matches.some((l) => l.includes('A1區')), 'A1區 應符合');
    assert(!r.match.matches.some((l) => l.includes('B1區')), 'B1 未在偏好區域，不得列入');
    assert(!r.match.matches.some((l) => l.includes('身障票')), 'A2區身障票不在偏好區域，不得列入');
  });
  await test('剩餘數量不足時不列為符合', async () => {
    const r = await analyze('order.html', Object.assign({}, profile, { quantity: 3 }));
    assert(!r.match.matches.some((l) => l.includes('A1區')), 'A1區只剩 2 張，3 張時不應符合');
    assert(r.match.unavailable.some((l) => l.includes('A1區')));
  });
  await test('不符合指定票種：設定「學生票」→ 無任何符合', async () => {
    const r = await analyze('order.html', Object.assign({}, profile, { ticketTypesPrimary: ['學生票'], ticketTypesBackup: [] }));
    eq(r.match.matches.length, 0); eq(r.match.others.length, 0);
  });
  await test('備選票種：優先票種不在頁面時，使用備選票種（身障票）', async () => {
    const r = await analyze('order.html', Object.assign({}, profile, { ticketTypesPrimary: ['學生票'], ticketTypesBackup: ['身障票'], areas: ['A2區', '', ''] }));
    eq(r.match.matches.length, 1); assert(r.match.matches[0].includes('A2區'));
  });
  await test('允許其他區域：其他區域列在「需您確認」清單，不混入符合清單', async () => {
    const r = await analyze('order.html', Object.assign({}, profile, { areas: ['VIP B區', '', ''], allowOtherAreas: true }));
    eq(r.match.matches.length, 0);
    assert(r.match.others.length >= 1, '應列出其他區域');
  });
  await test('指定區域無票（表格 + 下拉選單版面）', async () => {
    const r = await analyze('order-area-soldout.html', profile);
    eq(r.pageType, 'order'); eq(r.tickets.length, 4, JSON.stringify(r.tickets));
    eq(r.match.matches.length, 0);
    const c1 = r.tickets.find((t) => t.name.includes('C1區'));
    eq(c1.control, 'select'); eq(c1.maxQty, 4); eq(c1.price, 2800);
  });
  await test('表格版面：指定 C1區 有票', async () => {
    const r = await analyze('order-area-soldout.html', Object.assign({}, profile, { areas: ['C1區', '', ''] }));
    eq(r.match.matches.length, 1);
  });
  await test('C2區只剩 1 張（下拉上限 1）→ 買 2 張不符合', async () => {
    const r = await analyze('order-area-soldout.html', Object.assign({}, profile, { areas: ['C2區', '', ''] }));
    eq(r.match.matches.length, 0); eq(r.match.unavailable.length, 1);
  });
  await test('購票頁全部售完 → soldOut', async () => {
    const r = await analyze('order-all-soldout.html');
    eq(r.saleStatus, 'soldOut', `pageType=${r.pageType}`);
  });
  await test('一般資料欄位：辨識姓名/手機/Email 各 1 個，身分證欄位被排除', async () => {
    const r = await analyze('order.html');
    eq(r.form, { name: 1, phone: 1, email: 1, skipped: 1 });
  });
  await test('驗證碼頁面 → captcha（優先於購票頁）', async () => {
    eq((await analyze('captcha.html')).pageType, 'captcha');
  });
  await test('簡訊驗證 → verification', async () => {
    eq((await analyze('sms.html')).pageType, 'verification');
  });
  await test('排隊頁面 → queue', async () => {
    eq((await analyze('queue.html')).pageType, 'queue');
  });
  await test('登入頁面 → login', async () => {
    eq((await analyze('login.html')).pageType, 'login');
  });
  await test('訂單確認頁 → checkout，擷取訂單資訊', async () => {
    const r = await analyze('checkout.html');
    eq(r.pageType, 'checkout');
    assert(r.orderInfo.some((l) => l.includes('張數')), JSON.stringify(r.orderInfo));
    assert(r.orderInfo.some((l) => l.includes('總計')));
  });
  await test('錯誤頁 → error', async () => {
    eq((await analyze('error.html')).pageType, 'error');
  });
  await test('逾時對話框 → timeout', async () => {
    eq((await analyze('timeout.html')).pageType, 'timeout');
  });
  await test('網站改版（結構無法辨識）→ unknown', async () => {
    eq((await analyze('changed.html')).pageType, 'unknown');
  });
  await test('載入中 → loading', async () => {
    eq((await analyze('loading.html')).pageType, 'loading');
  });
  await test('非官方、無測試標記的頁面 → unsupported', async () => {
    eq((await analyze('no-meta.html')).pageType, 'unsupported');
  });
  await test('官方網址判斷：只接受 https 的 ticketplus.com.tw', async () => {
    const r = await page.evaluate(() => [
      'https://ticketplus.com.tw/activity/abc', 'https://www.ticketplus.com.tw/x', 'http://ticketplus.com.tw/x',
      'https://ticketplus.com.tw.evil.com/x', 'https://evilticketplus.com.tw/x'
    ].map((u) => window.TicketPlusAdapter.isOfficialUrl(u)));
    eq(r, [true, true, false, false, false]);
  });

  await page.close();
  server.close();
}

module.exports = { run };
if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    await run(browser);
    await browser.close();
    const { fail } = require('./lib').summary();
    process.exit(fail ? 1 : 0);
  })();
}
