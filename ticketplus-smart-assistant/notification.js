/*
 * notification.js — 通知系統（在 service worker 中執行）
 *  - Chrome 桌面通知
 *  - 通知音效（透過 offscreen document 播放，因為 service worker 無法直接播放聲音）
 *  - 同類通知在短時間內不重複發送，避免洗版
 *  - 每次通知都寫入監控紀錄
 */
(function (root) {
  'use strict';

  const C = root.TP_CONFIG;

  // 通知範本
  const TEMPLATES = Object.freeze({
    ticketMatch: { title: '🎫 Ticket Plus 票況提醒！', message: '已偵測到符合設定的票券，請立即查看瀏覽器。', sound: 'alert', priority: 2, requireInteraction: true },
    saleStarted: { title: '🎫 已開始販售', message: '您監控的活動已開始販售，請立即查看瀏覽器。', sound: 'alert', priority: 2, requireInteraction: true },
    presaleReminder: { title: '⏰ 開賣前提醒', message: '活動即將開賣，請準備好並開啟活動頁面。', sound: 'chime', priority: 2, requireInteraction: true },
    captcha: { title: '🔐 需要您完成驗證碼', message: '頁面出現驗證碼，外掛已暫停。請親自完成驗證。', sound: 'alert', priority: 2, requireInteraction: true },
    verification: { title: '🔐 需要您完成身分驗證', message: '頁面要求身分／簡訊驗證，外掛已暫停。請親自完成。', sound: 'alert', priority: 2, requireInteraction: true },
    queue: { title: '⏳ 已進入排隊頁面', message: '請保持頁面開啟、不要重新整理，等待官方排隊流程。', sound: 'chime', priority: 1, requireInteraction: false },
    manualConfirm: { title: '✅ 請親自確認訂單', message: '已進入訂單確認頁，外掛已停止所有操作。請自行檢查並完成付款。', sound: 'alert', priority: 2, requireInteraction: true },
    statusChange: { title: 'ℹ️ 票況變化', message: '監控中的票況有變化。', sound: 'chime', priority: 1, requireInteraction: false },
    soldOut: { title: '😢 票券已售完', message: '目前偵測到票券已售完。', sound: null, priority: 0, requireInteraction: false },
    pageError: { title: '⚠️ 網頁錯誤', message: '售票頁面出現錯誤，外掛已停止操作，請手動檢查。', sound: 'chime', priority: 1, requireInteraction: false },
    timeout: { title: '⌛ 購票頁面逾時', message: '頁面顯示逾時，請依官方指示手動重新操作。', sound: 'chime', priority: 1, requireInteraction: false },
    unrecognized: { title: '❓ 無法辨識目前頁面', message: '可能是網站改版或頁面尚未載入，外掛不會進行任何操作。', sound: null, priority: 0, requireInteraction: false },
    offline: { title: '📡 網路中斷', message: '偵測到網路中斷，監控暫停，恢復連線後請確認頁面狀態。', sound: 'chime', priority: 1, requireInteraction: false },
    tabClosed: { title: '📄 活動頁面已關閉', message: '監控中的活動頁面已被關閉，監控已暫停。', sound: null, priority: 0, requireInteraction: false },
    info: { title: 'Ticket Plus 購票小幫手', message: '', sound: null, priority: 0, requireInteraction: false }
  });

  const lastSent = new Map(); // dedupeKey -> timestamp

  // ── 音效（offscreen document） ────────────────────────
  let creatingOffscreen = null;
  async function ensureOffscreen() {
    if (!root.chrome.offscreen) return false;
    try {
      if (root.chrome.runtime.getContexts) {
        const ctx = await root.chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        if (ctx.length) return true;
      }
      if (!creatingOffscreen) {
        creatingOffscreen = root.chrome.offscreen
          .createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: '播放購票提醒音效'
          })
          .catch((e) => {
            // 已存在時 Chrome 會丟出錯誤，視為成功
            if (!/single offscreen/i.test(String(e && e.message))) throw e;
          })
          .finally(() => {
            creatingOffscreen = null;
          });
      }
      await creatingOffscreen;
      return true;
    } catch (e) {
      return false;
    }
  }

  async function playSound(kind) {
    if (!kind) return false;
    const ok = await ensureOffscreen();
    if (!ok) return false;
    try {
      await root.chrome.runtime.sendMessage({ target: 'offscreen', type: 'playSound', kind });
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── 主要函式 ─────────────────────────────────────────
  /**
   * @param {string} type     TEMPLATES 的鍵
   * @param {object} opts     { message, title, profile, dedupeKey, force }
   * @returns {Promise<{sent:boolean, reason?:string}>}
   */
  async function notify(type, opts = {}) {
    const tpl = TEMPLATES[type] || TEMPLATES.info;
    const profile = opts.profile || null;
    const notifyCfg = (profile && profile.notify) || { desktop: true, sound: true, statusChange: true };
    const title = opts.title || tpl.title;
    const message = (opts.message || tpl.message || '').slice(0, 250);

    if (type === 'statusChange' && notifyCfg.statusChange === false) {
      return { sent: false, reason: 'statusChange disabled' };
    }

    const key = `${type}:${opts.dedupeKey || ''}`;
    const now = Date.now();
    if (!opts.force && lastSent.has(key) && now - lastSent.get(key) < C.NOTIFY_DEDUPE_MS) {
      return { sent: false, reason: 'deduped' };
    }
    lastSent.set(key, now);

    let desktopOk = false;
    if (notifyCfg.desktop !== false) {
      try {
        await root.chrome.notifications.create(`tp-${type}-${now}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title,
          message: message || ' ',
          priority: tpl.priority,
          requireInteraction: !!tpl.requireInteraction
        });
        desktopOk = true;
      } catch (e) {
        desktopOk = false;
      }
    }

    let soundOk = false;
    if (notifyCfg.sound !== false && tpl.sound) soundOk = await playSound(tpl.sound);

    if (root.TPStorage) {
      await root.TPStorage.addLog({
        level: 'notify',
        category: type,
        message: `${title}｜${message}`,
        detail: `桌面通知：${notifyCfg.desktop === false ? '已關閉' : desktopOk ? '已發送' : '發送失敗'}；音效：${
          notifyCfg.sound === false || !tpl.sound ? '無' : soundOk ? '已播放' : '播放失敗'
        }`
      });
    }
    return { sent: true, desktopOk, soundOk };
  }

  function resetDedupe() {
    lastSent.clear();
  }

  root.TPNotify = { notify, playSound, resetDedupe, TEMPLATES };
})(typeof globalThis !== 'undefined' ? globalThis : self);
