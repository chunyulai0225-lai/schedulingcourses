/*
 * background.js — Service Worker（Manifest V3）
 *
 * 負責：
 *  - 監控狀態（開始／暫停／停止），只綁定「一個」分頁，不開多視窗、多工作階段。
 *  - 接收內容腳本回報的票況，判斷狀態變化並發送通知。
 *  - 開賣前提醒（chrome.alarms）。
 *  - 使用者同意後的低頻率自動刷新（僅在尚未開賣／售完時，排隊與驗證頁永不刷新）。
 *  - 外掛重新啟動、分頁關閉、離開官方網站等錯誤處理。
 *
 * 本檔案不會對售票網站發出任何網路請求，也不會讀取或修改 Cookie。
 */
'use strict';

importScripts('config.js', 'storage.js', 'notification.js');

const C = self.TP_CONFIG;
const L = self.TP_LABELS;
const S = self.TPStorage;
const N = self.TPNotify;
const MS = C.MONITOR_STATES;
const PT = C.PAGE_TYPES;

const ALARM_REMINDER = 'tp-reminder';
const ALARM_SALE_START = 'tp-sale-start';
const ALARM_REFRESH = 'tp-refresh';

// ── 工具 ─────────────────────────────────────────────
function isSupportedTabUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (u.protocol === 'https:' && C.OFFICIAL_HOSTS.some((x) => h === x || h.endsWith('.' + x))) return true;
    return C.MOCK_HOSTS.includes(h); // 模擬頁面另由內容腳本檢查 meta 標籤
  } catch (e) {
    return false;
  }
}

async function tabExists(tabId) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch (e) {
    return null;
  }
}

async function log(level, category, message, detail) {
  await S.addLog({ level, category, message, detail });
}

async function setBadge(kind) {
  const map = {
    idle: { text: '', color: '#1d63d6' },
    monitoring: { text: 'ON', color: '#1d63d6' },
    paused: { text: '||', color: '#7a869a' },
    attention: { text: '!', color: '#d93025' },
    match: { text: '票', color: '#188038' }
  };
  const b = map[kind] || map.idle;
  try {
    await chrome.action.setBadgeText({ text: b.text });
    await chrome.action.setBadgeBackgroundColor({ color: b.color });
  } catch (e) {
    /* 忽略 */
  }
}

async function sendToTab(tabId, msg) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    return null; // 內容腳本尚未載入或分頁不在支援的網址
  }
}

async function broadcastState() {
  const monitor = await S.getMonitor();
  const profile = await S.getActiveProfile();
  await sendToTab(monitor.tabId, { type: 'stateChanged', monitor, profile });
}

// ── 鬧鐘：開賣前提醒、開賣時間、自動刷新 ─────────────────────
async function scheduleReminders() {
  await chrome.alarms.clear(ALARM_REMINDER);
  await chrome.alarms.clear(ALARM_SALE_START);
  const profile = await S.getActiveProfile();
  const ts = S.saleTimestamp(profile);
  if (!ts) return;
  const now = Date.now();
  const remindAt = ts - (profile.notify.remindMinutes || 0) * 60000;
  if (profile.notify.remindMinutes > 0 && remindAt > now) {
    await chrome.alarms.create(ALARM_REMINDER, { when: remindAt });
  }
  if (ts > now) await chrome.alarms.create(ALARM_SALE_START, { when: ts });
}

async function scheduleRefresh() {
  await chrome.alarms.clear(ALARM_REFRESH);
  const monitor = await S.getMonitor();
  const profile = await S.getActiveProfile();
  if (monitor.state !== MS.MONITORING || !profile) return;
  const r = profile.refresh;
  if (!r.enabled || !r.acknowledged) return;
  const sec = Math.max(C.POLICY.MIN_REFRESH_SECONDS, Math.min(C.POLICY.MAX_REFRESH_SECONDS, r.intervalSec));
  await chrome.alarms.create(ALARM_REFRESH, { delayInMinutes: sec / 60, periodInMinutes: sec / 60 });
}

async function handleRefreshAlarm() {
  const monitor = await S.getMonitor();
  const profile = await S.getActiveProfile();
  if (monitor.state !== MS.MONITORING || !profile || !profile.refresh.enabled || !profile.refresh.acknowledged) {
    await chrome.alarms.clear(ALARM_REFRESH);
    return;
  }
  const tab = await tabExists(monitor.tabId);
  if (!tab) return;
  // 先詢問內容腳本：只有在「尚未開賣／售完」等安全狀態才允許刷新
  const answer = await sendToTab(monitor.tabId, { type: 'canRefresh' });
  if (!answer || !answer.ok) {
    await log('info', 'refresh', '略過本次自動刷新', (answer && answer.reason) || '無法確認頁面狀態，為安全起見不刷新');
    return;
  }
  await log('info', 'refresh', '自動刷新活動頁面', `間隔 ${profile.refresh.intervalSec} 秒`);
  await chrome.tabs.reload(monitor.tabId);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const profile = await S.getActiveProfile();
  if (alarm.name === ALARM_REMINDER && profile) {
    await N.notify('presaleReminder', {
      profile,
      message: `「${profile.name}」將於 ${profile.saleDate} ${profile.saleTime} 開賣（約 ${profile.notify.remindMinutes} 分鐘後），請開啟活動頁面並準備好。`,
      force: true
    });
  } else if (alarm.name === ALARM_SALE_START && profile) {
    await N.notify('saleStarted', {
      profile,
      title: '⏰ 開賣時間到了',
      message: `「${profile.name}」已到開賣時間，請查看活動頁面（外掛不會替您點擊購買）。`,
      force: true
    });
  } else if (alarm.name === ALARM_REFRESH) {
    await handleRefreshAlarm();
  }
});

// ── 監控控制 ──────────────────────────────────────────
async function findOrOpenEventTab(profile, preferredTabId, openIfMissing) {
  // 1) 使用者目前所在的分頁若是支援的頁面，優先綁定
  const preferred = await tabExists(preferredTabId);
  if (preferred && isSupportedTabUrl(preferred.url || '')) return { tab: preferred, opened: false };
  // 2) 已經開啟活動網址的分頁（只取一個，不開多個）
  if (profile.eventUrl) {
    const tabs = await chrome.tabs.query({});
    const base = profile.eventUrl.split('#')[0];
    const found = tabs.find((t) => t.url && t.url.split('#')[0].startsWith(base));
    if (found) return { tab: found, opened: false };
    if (openIfMissing) {
      const tab = await chrome.tabs.create({ url: profile.eventUrl, active: true });
      return { tab, opened: true };
    }
  }
  return { tab: null, opened: false };
}

async function startMonitoring(preferredTabId) {
  const profile = await S.getActiveProfile();
  if (!profile) throw new Error('請先建立並選擇一組活動設定。');
  const { tab, opened } = await findOrOpenEventTab(profile, preferredTabId, true);
  if (!tab) throw new Error('找不到活動頁面。請在設定中填寫 Ticket Plus 活動網址，或先開啟活動頁面再按「開始監控」。');
  await S.setMonitor({
    state: MS.MONITORING,
    profileId: profile.id,
    tabId: tab.id,
    pageType: null,
    saleStatus: null,
    summary: opened ? '已開啟活動頁面，等待載入…' : '開始監控，等待頁面回報…',
    matches: [],
    lastFingerprint: null,
    lastMatchKey: null,
    attention: null,
    startedAt: Date.now()
  });
  N.resetDedupe();
  await log('success', 'monitor', `開始監控「${profile.name}」`, `分頁 #${tab.id}${opened ? '（新開啟）' : ''}；模式：${profile.mode === 'assist' ? '輔助模式' : '純監控模式'}；自動刷新：${profile.refresh.enabled ? profile.refresh.intervalSec + ' 秒' : '關閉'}`);
  await setBadge('monitoring');
  await scheduleRefresh();
  await broadcastState();
  return S.getMonitor();
}

async function pauseMonitoring(reason) {
  const m = await S.getMonitor();
  if (m.state === MS.IDLE) return m;
  await S.setMonitor({ state: MS.PAUSED, summary: reason || '已暫停監控' });
  await chrome.alarms.clear(ALARM_REFRESH);
  await log('info', 'monitor', '暫停監控', reason || '使用者手動暫停');
  await setBadge('paused');
  await broadcastState();
  return S.getMonitor();
}

async function resumeMonitoring() {
  const m = await S.getMonitor();
  if (m.state !== MS.PAUSED) return m;
  if (!(await tabExists(m.tabId))) return startMonitoring(null);
  await S.setMonitor({ state: MS.MONITORING, summary: '已恢復監控' });
  await log('info', 'monitor', '恢復監控');
  await setBadge('monitoring');
  await scheduleRefresh();
  await broadcastState();
  return S.getMonitor();
}

async function stopMonitoring(reason) {
  const m = await S.getMonitor();
  const tabId = m.tabId;
  await S.setMonitor({ state: MS.IDLE, tabId: null, summary: reason || '已停止監控', matches: [], attention: null });
  await chrome.alarms.clear(ALARM_REFRESH);
  await log('info', 'monitor', '停止監控', reason || '使用者手動停止');
  await setBadge('idle');
  await sendToTab(tabId, { type: 'stateChanged', monitor: await S.getMonitor(), profile: await S.getActiveProfile() });
  return S.getMonitor();
}

async function openEventPage() {
  const profile = await S.getActiveProfile();
  if (!profile || !profile.eventUrl) throw new Error('目前的活動設定沒有活動網址。');
  const { tab } = await findOrOpenEventTab(profile, null, true);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  return tab && tab.id;
}

// 出現驗證碼時把監控分頁與視窗切到最前面，讓使用者可以立刻輸入
async function bringTabToFront(tabId, why) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab && tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
    await log('info', 'attention', '已將活動頁面切換到最前面', why || '請直接輸入驗證碼');
  } catch (e) {
    /* 分頁可能剛被關閉 */
  }
}

let alertRepeatCount = 0;

// ── 內容腳本回報處理（狀態轉換 → 通知） ────────────────────
async function handleReport(report, tabId) {
  const monitor = await S.getMonitor();
  if (monitor.tabId !== tabId || monitor.state === MS.IDLE) return { accepted: false };
  const profile = await S.getActiveProfile();
  const active = monitor.state === MS.MONITORING;
  const prevType = monitor.pageType;
  const prevStatus = monitor.saleStatus;
  const typeChanged = report.pageType !== prevType;

  const update = {
    pageType: report.pageType,
    saleStatus: report.saleStatus,
    title: report.title || monitor.title || '',
    url: report.url,
    summary: report.summary || '',
    matches: (report.matches || []).slice(0, 8),
    warnings: (report.warnings || []).slice(0, 5),
    lastDetectedAt: Date.now(),
    lastFingerprint: report.fingerprint,
    online: report.online !== false
  };

  if (typeChanged) {
    await log(
      ['captcha', 'verification', 'queue', 'error', 'timeout', 'unknown'].includes(report.pageType) ? 'warn' : 'info',
      'detect',
      `頁面狀態：${L.pageType[report.pageType] || report.pageType}`,
      (report.reasons || []).join('；')
    );
  }

  let badge = monitor.state === MS.PAUSED ? 'paused' : 'monitoring';
  const notifyIf = async (type, opts) => {
    if (active) await N.notify(type, Object.assign({ profile }, opts));
  };

  // 網路中斷
  if (report.online === false) {
    if (monitor.online !== false) {
      await log('error', 'network', '網路中斷', '監控暫停中，恢復連線後會自動重新偵測');
      await notifyIf('offline', {});
    }
    update.attention = 'offline';
    badge = 'attention';
  } else if (monitor.online === false) {
    await log('success', 'network', '網路已恢復連線');
  }

  switch (report.pageType) {
    case PT.CAPTCHA:
    case PT.VERIFICATION:
      if (typeChanged) {
        if (active) await bringTabToFront(tabId);
        await notifyIf(report.pageType, { dedupeKey: report.url });
      }
      update.attention = report.pageType;
      badge = 'attention';
      break;
    case PT.QUEUE:
      if (typeChanged) await notifyIf('queue', { dedupeKey: report.url });
      update.attention = 'queue';
      badge = 'attention';
      break;
    case PT.LOGIN:
      if (typeChanged) await notifyIf('info', { title: '🔑 請登入會員', message: '頁面要求登入，請親自輸入帳號密碼（外掛不會儲存或填寫密碼）。' });
      update.attention = 'login';
      badge = 'attention';
      break;
    case PT.CHECKOUT:
      if (typeChanged) {
        await notifyIf('manualConfirm', { force: true });
        await log('success', 'confirm', '已進入人工確認階段，外掛停止所有操作', (report.orderInfo || []).join('；'));
      }
      update.attention = 'checkout';
      update.orderInfo = (report.orderInfo || []).slice(0, 15);
      badge = 'attention';
      break;
    case PT.ERROR:
      if (typeChanged) await notifyIf('pageError', { message: `售票頁面出現錯誤（${(report.reasons || [])[0] || '未知'}），外掛已停止操作，請手動檢查。` });
      update.attention = 'error';
      badge = 'attention';
      break;
    case PT.TIMEOUT:
      if (typeChanged) await notifyIf('timeout', {});
      update.attention = 'timeout';
      badge = 'attention';
      break;
    case PT.UNKNOWN:
      if (typeChanged) await notifyIf('unrecognized', { dedupeKey: report.url });
      update.attention = 'unknown';
      break;
    case PT.EVENT:
    case PT.ORDER: {
      update.attention = null;
      const matchKey = (report.matches || []).map((m) => m.label).join('|');
      const hasMatch = !!matchKey;
      if (hasMatch && matchKey !== monitor.lastMatchKey) {
        const best = report.matches[0];
        if (active && profile && profile.quickKey !== false) await bringTabToFront(tabId, '偵測到符合的票券，按 Enter 即可操作');
        await notifyIf('ticketMatch', {
          dedupeKey: matchKey,
          message: `已偵測到符合設定的票券：${best.label}${best.reason ? '（' + best.reason + '）' : ''}，請立即查看瀏覽器並親自選購。`
        });
        await log('success', 'match', '偵測到符合條件的票券', report.matches.map((m) => m.label).join('、'));
      } else if (prevStatus && prevStatus !== report.saleStatus && report.saleStatus === C.SALE_STATUS.ON_SALE && !hasMatch) {
        await notifyIf('saleStarted', { message: `「${profile ? profile.name : '活動'}」已開始販售，但目前沒有符合您偏好的票券，請查看頁面。` });
      } else if (prevStatus && prevStatus !== report.saleStatus && report.saleStatus === C.SALE_STATUS.SOLD_OUT) {
        await notifyIf('soldOut', {});
      } else if (
        monitor.lastFingerprint && report.fingerprint && monitor.lastFingerprint !== report.fingerprint && !typeChanged
      ) {
        await notifyIf('statusChange', { dedupeKey: report.fingerprint, message: report.summary || '票況有變化，請查看頁面。' });
        await log('info', 'change', '票況變化', report.summary || '');
      }
      update.lastMatchKey = matchKey || null;
      if (hasMatch) badge = 'match';
      break;
    }
    default:
      break;
  }

  // 網路中斷的提示優先於頁面狀態
  if (report.online === false) {
    update.attention = 'offline';
    badge = 'attention';
  }
  if (monitor.state === MS.PAUSED) badge = 'paused';
  await S.setMonitor(update);
  await setBadge(badge);
  return { accepted: true };
}

// ── 訊息路由 ──────────────────────────────────────────
const handlers = {
  async hello(msg, sender) {
    const tabId = sender.tab && sender.tab.id;
    let monitor = await S.getMonitor();
    const profile = await S.getActiveProfile();
    // 監控中但尚未綁定分頁（或原分頁已不存在）時，綁定這個分頁
    if (monitor.state !== MS.IDLE && tabId != null && !(await tabExists(monitor.tabId))) {
      monitor = await S.setMonitor({ tabId });
      await log('info', 'monitor', `重新綁定監控分頁 #${tabId}`);
    }
    const isBound = monitor.state !== MS.IDLE && monitor.tabId === tabId;
    if (isBound && msg.reloaded) await log('info', 'page', '活動頁面已重新整理或換頁', msg.url || '');
    const personal = await S.getPersonal();
    return {
      monitor,
      profile,
      isBound,
      personalAvailable: !!(personal.saveConsent && (personal.name || personal.phone || personal.email))
    };
  },

  async report(msg, sender) {
    return handleReport(msg.report || {}, sender.tab && sender.tab.id);
  },

  async contentLog(msg, sender) {
    const m = await S.getMonitor();
    if (m.tabId !== (sender.tab && sender.tab.id)) return { ok: false };
    await log(msg.level || 'info', msg.category || 'assist', msg.message || '', msg.detail || '');
    return { ok: true };
  },

  // 驗證碼尚未輸入時重複提示音（由內容腳本在您開始操作後停止送出）
  async alertRepeat(msg, sender) {
    const m = await S.getMonitor();
    const profile = await S.getActiveProfile();
    if (!sender.tab || m.tabId !== sender.tab.id || m.state !== MS.MONITORING) return { played: false };
    if (!['captcha', 'verification'].includes(m.attention)) return { played: false };
    if (!profile || profile.notify.sound === false) return { played: false };
    alertRepeatCount++;
    return { played: await N.playSound('alert') };
  },

  async getPersonalForFill(msg, sender) {
    // 只提供給「目前監控中、且為輔助模式」的分頁，並且只在使用者按下填寫時才索取
    const m = await S.getMonitor();
    const profile = await S.getActiveProfile();
    if (!sender.tab || m.tabId !== sender.tab.id || m.state === MS.IDLE) return { ok: false, error: '此分頁未在監控中。' };
    if (!profile || profile.mode !== 'assist') return { ok: false, error: '目前為純監控模式，不提供自動填寫。' };
    const p = await S.getPersonal();
    if (!p.saveConsent) return { ok: false, error: '尚未儲存購票資料，請在設定頁「購票資料」中填寫並同意儲存。' };
    return { ok: true, personal: { name: p.name, phone: p.phone, email: p.email } };
  },

  async getStatus() {
    const [monitor, profile, profiles, logs] = await Promise.all([S.getMonitor(), S.getActiveProfile(), S.getProfiles(), S.getLogs()]);
    const tab = await tabExists(monitor.tabId);
    return { monitor, profile, profiles, tabAlive: !!tab, tabUrl: tab ? tab.url : null, recentLogs: logs.slice(-5) };
  },

  async start(msg) {
    return startMonitoring(msg.tabId);
  },
  async pause() {
    return pauseMonitoring();
  },
  async resume() {
    return resumeMonitoring();
  },
  async stop() {
    return stopMonitoring();
  },
  async openEvent() {
    return openEventPage();
  },
  async setActiveProfile(msg) {
    const m = await S.getMonitor();
    if (m.state !== MS.IDLE && m.profileId !== msg.id) await stopMonitoring('切換活動設定，已停止原本的監控');
    await S.setActiveProfile(msg.id);
    await scheduleReminders();
    return true;
  },
  async profilesChanged() {
    await scheduleReminders();
    await scheduleRefresh();
    await broadcastState();
    return true;
  },
  async testNotification() {
    const profile = await S.getActiveProfile();
    return N.notify('ticketMatch', { profile, force: true, title: '🎫 Ticket Plus 票況提醒！（測試）', message: '這是測試通知。若有聽到提示音並看到這則通知，代表通知功能正常。' });
  },
  async clearAll() {
    await chrome.alarms.clearAll();
    await S.clearAll();
    await setBadge('idle');
    return true;
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  const fn = handlers[msg.type];
  if (!fn) return false;
  Promise.resolve()
    .then(() => fn(msg, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
  return true; // 非同步回覆
});

// ── 分頁事件：關閉、離開官方網站 ───────────────────────────
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const m = await S.getMonitor();
  if (m.state === MS.IDLE || m.tabId !== tabId) return;
  await S.setMonitor({ state: MS.PAUSED, tabId: null, summary: '活動頁面已關閉，監控已暫停。按「開始監控」可重新開啟。', attention: 'tabClosed' });
  await chrome.alarms.clear(ALARM_REFRESH);
  await log('warn', 'page', '監控中的活動頁面已被關閉，監控已暫停');
  await N.notify('tabClosed', { profile: await S.getActiveProfile() });
  await setBadge('paused');
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const m = await S.getMonitor();
  if (m.state === MS.IDLE || m.tabId !== tabId) return;
  if (!isSupportedTabUrl(info.url)) {
    await S.setMonitor({ pageType: PT.UNSUPPORTED, summary: '目前頁面不在 Ticket Plus 官方網域（可能是官方的排隊、付款或其他網站），外掛不會在此頁面運作，請依頁面指示親自操作。', matches: [] });
    await log('warn', 'page', '監控分頁已離開 Ticket Plus 官方網站', info.url.slice(0, 200));
  }
});

// ── 安裝 / 重新啟動 ─────────────────────────────────────
async function recoverAfterRestart(reason) {
  const m = await S.getMonitor();
  if (m.state !== MS.IDLE) {
    const tab = await tabExists(m.tabId);
    if (!tab) {
      await S.setMonitor({ state: MS.PAUSED, tabId: null, summary: '外掛或瀏覽器重新啟動，找不到原本的活動頁面，監控已暫停。' });
      await log('warn', 'system', `${reason}：找不到原本的活動頁面，監控已暫停`);
      await setBadge('paused');
    } else {
      await log('info', 'system', `${reason}：已恢復監控狀態`);
      await setBadge(m.state === MS.MONITORING ? 'monitoring' : 'paused');
      await scheduleRefresh();
    }
  } else {
    await setBadge('idle');
  }
  await scheduleReminders();
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await recoverAfterRestart(details.reason === 'install' ? '安裝完成' : '外掛已更新／重新載入');
  if (details.reason === 'install') {
    await log('info', 'system', `Ticket Plus 購票小幫手 v${C.VERSION} 安裝完成`);
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => recoverAfterRestart('瀏覽器重新啟動'));

// 讓測試與除錯可以呼叫（不對外公開，只在 service worker 內有效）
self.__tp = { alertRepeats: () => alertRepeatCount, handlers, handleReport, recoverAfterRestart, startMonitoring, stopMonitoring, scheduleReminders, scheduleRefresh, handleRefreshAlarm };
