/*
 * config.js — 共用設定與安全政策
 * 會被 content script、service worker、popup、options 共同載入。
 * 只定義常數，不含任何副作用。
 */
(function (root) {
  'use strict';

  const TP_CONFIG = Object.freeze({
    VERSION: '1.0.0',

    // ── 支援的官方網域 ────────────────────────────────
    OFFICIAL_HOSTS: Object.freeze(['ticketplus.com.tw']),
    // 本機模擬網站（只在頁面帶有下列 meta 標籤時才會啟用，用於測試）
    MOCK_HOSTS: Object.freeze(['localhost', '127.0.0.1']),
    MOCK_META_NAME: 'tpsa-mock-site',

    // ── 安全政策（最高原則，程式各處都會檢查） ────────────
    POLICY: Object.freeze({
      // 外掛永遠不會自動點擊網站上的任何按鈕（購買、下一步、付款、送出…）
      AUTO_CLICK_SITE_BUTTONS: false,
      // 永遠不自動送出訂單或付款
      AUTO_SUBMIT_ORDER: false,
      // 自動刷新預設關閉，需使用者閱讀說明並同意後才能開啟
      AUTO_REFRESH_DEFAULT: false,
      // 自動刷新最短間隔（秒），避免造成伺服器負擔
      MIN_REFRESH_SECONDS: 30,
      MAX_REFRESH_SECONDS: 600,
      // 偵測到驗證碼／排隊／身分驗證時，一律暫停所有輔助操作
      PAUSE_ON_SECURITY_CHECK: true
    }),

    REFRESH_CHOICES: Object.freeze([30, 60, 120, 300, 600]),
    REMIND_CHOICES: Object.freeze([0, 1, 3, 5, 10, 15, 30, 60]),

    MAX_TICKETS: 10, // 介面上限；實際以官方頁面顯示的限制為準
    MAX_LOG_ENTRIES: 300,
    MAX_PROFILES: 30,

    // 內容腳本重新評估頁面的節流時間（毫秒）— 只讀取已載入的頁面，不發出網路請求
    EVALUATE_DEBOUNCE_MS: 400,
    EVALUATE_INTERVAL_MS: 2000,
    // 同一種通知在多久內不重複發送（毫秒）
    NOTIFY_DEDUPE_MS: 30000,

    STORAGE_KEYS: Object.freeze({
      PROFILES: 'profiles',
      ACTIVE_PROFILE_ID: 'activeProfileId',
      PERSONAL: 'personal',
      SETTINGS: 'settings',
      MONITOR: 'monitor',
      LOGS: 'logs'
    }),

    // 監控狀態
    MONITOR_STATES: Object.freeze({
      IDLE: 'idle',
      MONITORING: 'monitoring',
      PAUSED: 'paused'
    }),

    // 頁面偵測結果（Adapter 會回傳其中之一）
    PAGE_TYPES: Object.freeze({
      UNSUPPORTED: 'unsupported',
      CAPTCHA: 'captcha',
      QUEUE: 'queue',
      VERIFICATION: 'verification',
      LOGIN: 'login',
      ERROR: 'error',
      TIMEOUT: 'timeout',
      CHECKOUT: 'checkout',
      ORDER: 'order',
      EVENT: 'event',
      LOADING: 'loading',
      UNKNOWN: 'unknown'
    }),

    // 票況
    SALE_STATUS: Object.freeze({
      NOT_ON_SALE: 'notOnSale',
      ON_SALE: 'onSale',
      SOLD_OUT: 'soldOut',
      PAUSED: 'paused',
      UNKNOWN: 'unknown'
    })
  });

  const LABELS = Object.freeze({
    pageType: {
      unsupported: '非支援頁面',
      captcha: '驗證碼（請親自完成）',
      queue: '排隊等待中（請勿關閉頁面）',
      verification: '身分／簡訊驗證（請親自完成）',
      login: '登入頁面（請親自登入）',
      error: '網頁錯誤',
      timeout: '購票頁面逾時',
      checkout: '訂單確認（請親自檢查與付款）',
      order: '選擇票種／區域',
      event: '活動頁面',
      loading: '頁面載入中',
      unknown: '無法辨識目前頁面'
    },
    saleStatus: {
      notOnSale: '尚未開賣',
      onSale: '販售中',
      soldOut: '已售完',
      paused: '暫停販售',
      unknown: '未知'
    },
    monitorState: {
      idle: '未啟動',
      monitoring: '監控中',
      paused: '已暫停'
    }
  });

  root.TP_CONFIG = TP_CONFIG;
  root.TP_LABELS = LABELS;
})(typeof globalThis !== 'undefined' ? globalThis : self);
