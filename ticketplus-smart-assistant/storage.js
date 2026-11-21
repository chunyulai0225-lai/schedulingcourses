/*
 * storage.js — chrome.storage.local 封裝
 *
 * 資料保護原則：
 *  - 只儲存白名單欄位（活動設定、票種／區域偏好、張數、通知設定、使用者同意儲存的一般資料）。
 *  - 絕不儲存：密碼、信用卡號、安全碼、驗證碼、Cookie、Session、身分驗證憑證。
 *  - 所有資料只存在本機（chrome.storage.local），不會上傳到任何伺服器。
 */
(function (root) {
  'use strict';

  const C = root.TP_CONFIG;
  const K = C.STORAGE_KEYS;

  // ── 小工具 ──────────────────────────────────────────
  const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
  const clampInt = (v, min, max, d) => {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return d;
    return Math.min(max, Math.max(min, n));
  };
  const toList = (v) => {
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，、\n]/) : [];
    return arr.map((s) => str(s, 60)).filter(Boolean).slice(0, 10);
  };
  const newId = () =>
    'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  // 這些字樣若出現在欄位名稱，代表是敏感資料，一律拒絕儲存（第二道防線）
  const FORBIDDEN_KEY_RE = /(pass(word)?|pwd|card|cvv|cvc|credit|otp|captcha|cookie|token|auth|secret|身分證|密碼|卡號|安全碼)/i;

  function assertNoSensitiveKeys(obj, path = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEY_RE.test(key)) {
        throw new Error(`拒絕儲存敏感欄位：${path}${key}`);
      }
      assertNoSensitiveKeys(obj[key], `${path}${key}.`);
    }
  }

  // ── 網址驗證 ─────────────────────────────────────────
  function parseEventUrl(url) {
    const u = str(url, 500);
    if (!u) return { ok: true, value: '' };
    let parsed;
    try {
      parsed = new URL(u);
    } catch (e) {
      return { ok: false, error: '網址格式不正確，請貼上完整網址（以 https:// 開頭）。' };
    }
    const host = parsed.hostname.toLowerCase();
    const official = C.OFFICIAL_HOSTS.some((h) => host === h || host.endsWith('.' + h));
    const mock = C.MOCK_HOSTS.includes(host);
    if (official && parsed.protocol === 'https:') return { ok: true, value: parsed.href };
    if (mock) return { ok: true, value: parsed.href, mock: true };
    return { ok: false, error: '只支援 Ticket Plus 官方網址（https://ticketplus.com.tw/…）。' };
  }

  // ── 活動設定（Profile） ───────────────────────────────
  function defaultProfile() {
    return {
      id: newId(),
      name: '新的活動設定',
      eventUrl: '',
      saleDate: '',
      saleTime: '',
      sessionKeyword: '',
      ticketTypesPrimary: [],
      ticketTypesBackup: [],
      areas: ['', '', ''],
      quantity: 1,
      allowOtherAreas: false,
      quickKey: true, // 偵測到符合的票券時選取按鈕，由使用者按 Enter
      mode: 'monitor', // 'monitor' 純監控（預設） | 'assist' 輔助模式（每個動作都需您按下確認）
      notify: {
        desktop: true,
        sound: true,
        statusChange: true,
        remindMinutes: 5
      },
      refresh: {
        enabled: C.POLICY.AUTO_REFRESH_DEFAULT,
        intervalSec: 60,
        acknowledged: false
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function sanitizeProfile(input) {
    const d = defaultProfile();
    const p = input && typeof input === 'object' ? input : {};
    const urlCheck = parseEventUrl(p.eventUrl);
    // 區域保留「第一／二／三優先」的位置，空白也保留
    const rawAreas = Array.isArray(p.areas) ? p.areas : toList(p.areas);
    const areas = [0, 1, 2].map((i) => str(rawAreas[i], 60));
    const n = p.notify || {};
    const r = p.refresh || {};
    const refreshEnabled = bool(r.enabled, false) && bool(r.acknowledged, false);
    return {
      id: typeof p.id === 'string' && /^p_[\w]+$/.test(p.id) ? p.id : d.id,
      name: str(p.name, 60) || d.name,
      eventUrl: urlCheck.ok ? urlCheck.value : '',
      saleDate: /^\d{4}-\d{2}-\d{2}$/.test(p.saleDate || '') ? p.saleDate : '',
      saleTime: /^\d{2}:\d{2}$/.test(p.saleTime || '') ? p.saleTime : '',
      sessionKeyword: str(p.sessionKeyword, 80),
      ticketTypesPrimary: toList(p.ticketTypesPrimary),
      ticketTypesBackup: toList(p.ticketTypesBackup),
      areas,
      quantity: clampInt(p.quantity, 1, C.MAX_TICKETS, 1),
      allowOtherAreas: bool(p.allowOtherAreas, false),
      quickKey: bool(p.quickKey, true),
      mode: p.mode === 'assist' ? 'assist' : 'monitor',
      notify: {
        desktop: bool(n.desktop, true),
        sound: bool(n.sound, true),
        statusChange: bool(n.statusChange, true),
        remindMinutes: clampInt(n.remindMinutes, 0, 120, 5)
      },
      refresh: {
        enabled: refreshEnabled,
        intervalSec: clampInt(
          r.intervalSec,
          C.POLICY.MIN_REFRESH_SECONDS,
          C.POLICY.MAX_REFRESH_SECONDS,
          60
        ),
        acknowledged: bool(r.acknowledged, false)
      },
      createdAt: Number.isFinite(p.createdAt) ? p.createdAt : d.createdAt,
      updatedAt: Date.now()
    };
  }

  function validateProfile(p) {
    const errors = [];
    if (!str(p.name)) errors.push('請輸入活動名稱。');
    const u = parseEventUrl(p.eventUrl);
    if (!u.ok) errors.push(u.error);
    if (p.saleDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.saleDate)) errors.push('開賣日期格式不正確。');
    if (p.saleTime && !/^\d{2}:\d{2}$/.test(p.saleTime)) errors.push('開賣時間格式不正確。');
    if (p.saleTime && !p.saleDate) errors.push('設定開賣時間時，也請設定開賣日期。');
    const q = parseInt(p.quantity, 10);
    if (!(q >= 1 && q <= C.MAX_TICKETS)) errors.push(`購買張數需介於 1 到 ${C.MAX_TICKETS} 張。`);
    if (p.refresh && p.refresh.enabled && !p.refresh.acknowledged) {
      errors.push('開啟自動刷新前，請先勾選「我已了解並遵守售票網站規範」。');
    }
    return errors;
  }

  function saleTimestamp(p) {
    if (!p || !p.saleDate || !p.saleTime) return null;
    // 以使用者電腦的當地時間解讀（台灣使用者即為台灣時間）
    const t = new Date(`${p.saleDate}T${p.saleTime}:00`).getTime();
    return Number.isFinite(t) ? t : null;
  }

  // ── 一般購票資料 ─────────────────────────────────────
  function normalizePhone(v) {
    return str(v, 30).replace(/[\s-]/g, '');
  }

  function validatePersonal(p) {
    const errors = [];
    if (p.phone && !/^09\d{8}$/.test(normalizePhone(p.phone))) {
      errors.push('手機號碼格式應為 09 開頭的 10 碼數字，例如 0912345678。');
    }
    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(p.email))) {
      errors.push('電子郵件格式不正確。');
    }
    return errors;
  }

  function sanitizePersonal(p) {
    p = p || {};
    return {
      saveConsent: bool(p.saveConsent, false),
      name: str(p.name, 40),
      phone: normalizePhone(p.phone),
      email: str(p.email, 120)
    };
  }

  // ── chrome.storage 基礎操作 ───────────────────────────
  const area = () => root.chrome.storage.local;
  const get = async (key, fallback) => {
    const res = await area().get(key);
    return res[key] === undefined ? fallback : res[key];
  };
  // 同一個執行環境內，把「讀取→修改→寫入」排成序列，避免同時寫入造成資料遺失
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  const set = (obj) => {
    assertNoSensitiveKeys(obj);
    return area().set(obj);
  };

  // ── 公開 API ─────────────────────────────────────────
  const TPStorage = {
    defaultProfile,
    sanitizeProfile,
    validateProfile,
    sanitizePersonal,
    validatePersonal,
    parseEventUrl,
    saleTimestamp,
    assertNoSensitiveKeys,

    async getProfiles() {
      const list = await get(K.PROFILES, []);
      return Array.isArray(list) ? list : [];
    },

    async getProfile(id) {
      return (await this.getProfiles()).find((p) => p.id === id) || null;
    },

    async saveProfile(input) {
      const errors = validateProfile(input || {});
      if (errors.length) {
        const err = new Error(errors.join('\n'));
        err.validation = errors;
        throw err;
      }
      const profile = sanitizeProfile(input);
      const list = await this.getProfiles();
      const idx = list.findIndex((p) => p.id === profile.id);
      if (idx >= 0) {
        profile.createdAt = list[idx].createdAt || profile.createdAt;
        list[idx] = profile;
      } else {
        if (list.length >= C.MAX_PROFILES) throw new Error(`最多只能保存 ${C.MAX_PROFILES} 組活動設定。`);
        list.push(profile);
      }
      await set({ [K.PROFILES]: list });
      const active = await get(K.ACTIVE_PROFILE_ID, null);
      if (!active) await set({ [K.ACTIVE_PROFILE_ID]: profile.id });
      return profile;
    },

    async deleteProfile(id) {
      const list = (await this.getProfiles()).filter((p) => p.id !== id);
      const updates = { [K.PROFILES]: list };
      const active = await get(K.ACTIVE_PROFILE_ID, null);
      if (active === id) updates[K.ACTIVE_PROFILE_ID] = list.length ? list[0].id : null;
      await set(updates);
      return list;
    },

    async getActiveProfileId() {
      return get(K.ACTIVE_PROFILE_ID, null);
    },

    async setActiveProfile(id) {
      const p = await this.getProfile(id);
      if (!p) throw new Error('找不到這組活動設定。');
      await set({ [K.ACTIVE_PROFILE_ID]: id });
      return p;
    },

    async getActiveProfile() {
      const id = await this.getActiveProfileId();
      const list = await this.getProfiles();
      return list.find((p) => p.id === id) || list[0] || null;
    },

    async getPersonal() {
      return sanitizePersonal(await get(K.PERSONAL, {}));
    },

    async savePersonal(input) {
      const p = sanitizePersonal(input);
      const errors = validatePersonal(p);
      if (errors.length) {
        const err = new Error(errors.join('\n'));
        err.validation = errors;
        throw err;
      }
      if (!p.saveConsent) {
        // 使用者未同意儲存 → 不保留任何個人資料
        await area().remove(K.PERSONAL);
        return sanitizePersonal({});
      }
      await set({ [K.PERSONAL]: p });
      return p;
    },

    async clearPersonal() {
      await area().remove(K.PERSONAL);
    },

    async getSettings() {
      const s = await get(K.SETTINGS, {});
      return { disclaimerAccepted: bool(s.disclaimerAccepted, false) };
    },

    async saveSettings(partial) {
      const cur = await this.getSettings();
      const next = { disclaimerAccepted: bool(partial && partial.disclaimerAccepted, cur.disclaimerAccepted) };
      await set({ [K.SETTINGS]: next });
      return next;
    },

    async getMonitor() {
      const m = await get(K.MONITOR, {});
      return Object.assign(
        {
          state: C.MONITOR_STATES.IDLE,
          profileId: null,
          tabId: null,
          pageType: null,
          saleStatus: null,
          summary: '',
          matches: [],
          lastDetectedAt: null,
          updatedAt: null
        },
        m
      );
    },

    setMonitor(partial) {
      return serial(async () => {
        const cur = await this.getMonitor();
        const next = Object.assign(cur, partial, { updatedAt: Date.now() });
        await set({ [K.MONITOR]: next });
        return next;
      });
    },

    async getLogs() {
      const logs = await get(K.LOGS, []);
      return Array.isArray(logs) ? logs : [];
    },

    addLog(entry) {
      return serial(() => this._appendLog(entry || {}));
    },

    async _appendLog(entry) {
      const logs = await this.getLogs();
      logs.push({
        t: Date.now(),
        level: ['info', 'success', 'warn', 'error', 'notify'].includes(entry.level) ? entry.level : 'info',
        category: str(entry.category, 30) || 'system',
        message: str(entry.message, 300),
        detail: str(entry.detail, 500)
      });
      while (logs.length > C.MAX_LOG_ENTRIES) logs.shift();
      await set({ [K.LOGS]: logs });
    },

    async clearLogs() {
      await area().remove(K.LOGS);
    },

    // 清除所有資料（活動設定、個人資料、紀錄、狀態）
    async clearAll() {
      await area().clear();
    }
  };

  root.TPStorage = TPStorage;
})(typeof globalThis !== 'undefined' ? globalThis : self);
