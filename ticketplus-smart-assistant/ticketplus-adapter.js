/*
 * ticketplus-adapter.js — Ticket Plus 頁面辨識模組（Adapter）
 *
 * 設計原則：
 *  1. 不假設網站 DOM 結構固定：以「畫面上看得到的文字」與「重複出現的列表結構」辨識，
 *     而不是寫死 CSS class。網站改版時，只需要更新本檔案中的 KEYWORDS / HINTS。
 *  2. 只「讀取」使用者畫面上正常顯示的資訊，不呼叫任何 API、不讀取隱藏資料。
 *  3. 安全優先：驗證碼 / 排隊 / 身分驗證 / 登入 / 錯誤 / 結帳頁面的判斷順序最先。
 *  4. 不確定時回傳 UNKNOWN，呼叫端看到 UNKNOWN 就停止任何輔助操作。
 *  5. 本模組不包含任何點擊網站按鈕的程式碼。
 */
(function (root) {
  'use strict';

  const C = root.TP_CONFIG;
  const PT = C.PAGE_TYPES;
  const SS = C.SALE_STATUS;

  const ADAPTER_VERSION = '2026.11-1';

  // ── 關鍵字（網站改版時優先調整這裡） ─────────────────────
  const KEYWORDS = {
    soldOut: ['已售完', '售完', '完售', '已額滿', '額滿', '無剩餘', 'sold out', 'soldout'],
    paused: ['暫停販售', '暫停售票', '停止販售', '停止售票', '售票結束', '已結束販售', '銷售結束', '已截止'],
    notOnSale: ['尚未開賣', '即將開賣', '未開賣', '尚未開放', '開賣倒數', '敬請期待', 'coming soon'],
    onSale: ['立即購買', '立即訂購', '立即購票', '前往購票', '購買', '選購', '熱賣中', '販售中', '可購買', '尚有座位', 'buy now'],
    queue: ['排隊中', '排隊等候', '正在排隊', '目前排隊', '您前面還有', '前方還有', '等候人數', '排隊人數', '等候室', '請耐心等候', '請勿重新整理', 'waiting room', 'you are in line', 'queue'],
    captchaText: ['我不是機器人', '圖形驗證', '驗證碼', '請輸入圖片中的文字', '請輸入下方文字', 'captcha'],
    verification: ['簡訊驗證', '手機驗證', '身分驗證', '身份驗證', '實名驗證', '實名制', 'otp', '一次性密碼', '驗證碼已發送', '已傳送驗證碼', '輸入簡訊', '安全性檢查', '安全檢查'],
    error: ['404', '500 internal', '502 bad gateway', '503 service', '頁面不存在', '找不到頁面', '找不到網頁', '系統發生錯誤', '發生錯誤', '系統忙碌', '伺服器錯誤', '伺服器忙碌', '請稍後再試', 'service unavailable', 'bad gateway', 'something went wrong'],
    timeout: ['逾時', '操作時間已到', '已超過購票時間', '購票時間已到', '已超過時間', '連線已過期', '工作階段已過期', 'session expired', '請重新選購'],
    // 強烈訊號：幾乎只會出現在付款／結帳頁
    checkoutStrong: ['選擇付款方式', '付款方式', '確認付款', '前往付款', '信用卡付款', '付款資訊', '訂單付款', '完成付款'],
    // 較弱訊號：也可能出現在步驟列，例如「1.選票 2.填資料 3.結帳」
    checkoutWeak: ['訂單確認', '確認訂單', '結帳', '訂單明細'],
    login: ['會員登入', '登入會員', '請先登入', '帳號登入'],
    loading: ['載入中', '讀取中', 'loading']
  };

  // 網址的輔助判斷（只作為加分，不作為唯一依據）
  const URL_HINTS = {
    event: /\/activity\//i,
    order: /\/order\//i,
    checkout: /\/(checkout|payment|confirm|pay)\b/i,
    queue: /\/(queue|waiting)\b/i
  };

  const RE = {
    date: /(\d{4}\s*[\/\-.年]\s*\d{1,2}\s*[\/\-.月]\s*\d{1,2})|(\d{1,2}\s*\/\s*\d{1,2}\s*[（(]\s*[一二三四五六日週]\s*[)）])/,
    time: /\b([01]?\d|2[0-3])\s*[:：]\s*[0-5]\d\b/,
    price: /(?:NT\$|NTD|TWD|\$|＄)\s*([\d,]{2,})|([\d,]{3,})\s*元/i,
    remaining: /(?:剩餘|尚餘|剩下|剩)\s*(?:座位|票數|張數)?\s*[:：]?\s*(\d+)\s*(?:張|席|位)?/,
    perOrderLimit: /(?:每(?:人|筆|次|筆訂單|個帳號)?|單筆)?\s*(?:限購|最多(?:可)?購買?|購買上限|上限)\s*(\d{1,2})\s*張/,
    plusText: /^\s*[+＋]\s*$/,
    minusText: /^\s*[-－−–]\s*$/,
    plusClass: /(plus|increase|increment|add\b)/i,
    minusClass: /(minus|decrease|decrement|remove\b|subtract)/i
  };

  // 絕不填寫的欄位（付款、密碼、驗證碼、身分證…）
  const SENSITIVE_FIELD_RE = /(password|passwd|pwd|密碼|card|卡號|信用卡|cvv|cvc|安全碼|有效期|expir|驗證碼|captcha|otp|身分證|身份證|national|id\s*no|生日|birth)/i;

  // ── 基礎工具 ─────────────────────────────────────────
  function norm(s) {
    return String(s || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s　]+/g, '')
      .replace(/[\/\-.年月]/g, '/')
      .replace(/日(?=[\s(（]|$)/g, '');
  }

  function includesAny(text, words) {
    const t = String(text || '').toLowerCase();
    return words.some((w) => t.includes(w.toLowerCase()));
  }

  function firstMatch(text, words) {
    const t = String(text || '').toLowerCase();
    return words.find((w) => t.includes(w.toLowerCase())) || null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.getClientRects().length === 0) return false;
    const win = el.ownerDocument.defaultView;
    const st = win.getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return false;
    return true;
  }

  function textOf(el) {
    return (el && (el.innerText || el.textContent) || '').replace(/[ \t　]+/g, ' ').trim();
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    return /(^|[\s_-])disabled?($|[\s_-])/i.test(cls);
  }

  function signature(el) {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => !/active|selected|disabled|hover|focus|odd|even|first|last/i.test(c)).sort().join('.') : '';
    return `${el.tagName}|${cls}`;
  }

  // ── URL 支援判斷 ──────────────────────────────────────
  function isOfficialUrl(url) {
    try {
      const u = new URL(url);
      const h = u.hostname.toLowerCase();
      return u.protocol === 'https:' && C.OFFICIAL_HOSTS.some((x) => h === x || h.endsWith('.' + x));
    } catch (e) {
      return false;
    }
  }

  function isMockPage(url, doc) {
    try {
      const u = new URL(url);
      if (!C.MOCK_HOSTS.includes(u.hostname)) return false;
      return !!(doc && doc.querySelector(`meta[name="${C.MOCK_META_NAME}"]`));
    } catch (e) {
      return false;
    }
  }

  function isSupportedUrl(url, doc) {
    return isOfficialUrl(url) || isMockPage(url, doc);
  }

  // ── 驗證碼 / 安全檢查偵測 ───────────────────────────────
  function detectCaptcha(doc, bodyText) {
    const selectors = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      'iframe[src*="turnstile"]',
      'iframe[title*="reCAPTCHA" i]',
      '.g-recaptcha',
      '.h-captcha',
      '.cf-turnstile',
      '[class*="captcha" i]',
      '[id*="captcha" i]',
      'img[src*="captcha" i]',
      'input[name*="captcha" i]',
      'canvas[class*="verify" i]'
    ];
    for (const sel of selectors) {
      const el = Array.from(doc.querySelectorAll(sel)).find(isVisible);
      if (el) return { found: true, strong: true, reason: `偵測到驗證元件（${sel}）` };
    }
    const word = firstMatch(bodyText, KEYWORDS.captchaText);
    if (word) {
      // 有驗證碼字樣 + 有可輸入的欄位或圖片 → 判定為驗證碼
      const hasInput = Array.from(doc.querySelectorAll('input[type="text"], input:not([type]), img, canvas')).some(isVisible);
      if (hasInput) return { found: true, reason: `頁面出現「${word}」` };
    }
    return { found: false };
  }

  function detectVerification(bodyText) {
    const w = firstMatch(bodyText, KEYWORDS.verification);
    return w ? { found: true, reason: `頁面出現「${w}」` } : { found: false };
  }

  function detectQueue(doc, bodyText, url) {
    const w = firstMatch(bodyText, KEYWORDS.queue);
    if (w) return { found: true, reason: `頁面出現「${w}」` };
    if (URL_HINTS.queue.test(url)) return { found: true, reason: '網址顯示為排隊頁面' };
    return { found: false };
  }

  function detectLogin(doc, bodyText) {
    const pwd = Array.from(doc.querySelectorAll('input[type="password"]')).find(isVisible);
    if (pwd) return { found: true, reason: '頁面要求輸入密碼（登入）' };
    const w = firstMatch(bodyText, KEYWORDS.login);
    return w ? { found: true, reason: `頁面出現「${w}」` } : { found: false };
  }

  // ── 數量控制（下拉選單 / 數字欄位 / +- 按鈕） ──────────────
  function findQtyControls(scope) {
    const out = [];
    scope.querySelectorAll('select').forEach((sel) => {
      if (!isVisible(sel)) return;
      const nums = Array.from(sel.options).map((o) => parseInt(o.value || o.textContent, 10)).filter((n) => !Number.isNaN(n));
      if (nums.length >= 2 && nums.every((n) => n >= 0 && n <= 20)) {
        out.push({ kind: 'select', el: sel, max: Math.max(...nums), disabled: isDisabled(sel) });
      }
    });
    scope.querySelectorAll('input[type="number"]').forEach((inp) => {
      if (!isVisible(inp)) return;
      const max = parseInt(inp.max, 10);
      out.push({ kind: 'number', el: inp, max: Number.isNaN(max) ? null : max, disabled: isDisabled(inp) || inp.readOnly });
    });
    // +/- 按鈕：找出同一個父元素下同時有「加」與「減」按鈕的組合
    const buttons = Array.from(scope.querySelectorAll('button, [role="button"]')).filter(isVisible);
    const isPlus = (b) => RE.plusText.test(textOf(b)) || RE.plusClass.test(b.className + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.innerHTML.match(/class="[^"]*"/g) || []).join(' ')) || /增加|加一/.test(b.getAttribute('aria-label') || '');
    const isMinus = (b) => RE.minusText.test(textOf(b)) || RE.minusClass.test(b.className + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.innerHTML.match(/class="[^"]*"/g) || []).join(' ')) || /減少|減一/.test(b.getAttribute('aria-label') || '');
    const seen = new Set();
    buttons.filter(isPlus).forEach((plus) => {
      let p = plus.parentElement;
      for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        const minus = Array.from(p.querySelectorAll('button, [role="button"]')).find((b) => b !== plus && isMinus(b));
        if (minus) {
          if (!seen.has(p)) {
            seen.add(p);
            const valueEl = Array.from(p.querySelectorAll('input, span, div')).find((e) => /^\d{1,2}$/.test((e.value !== undefined && e.tagName === 'INPUT' ? e.value : textOf(e)) || ''));
            out.push({ kind: 'buttons', el: p, plus, minus, valueEl: valueEl || null, max: null, disabled: isDisabled(plus) });
          }
          break;
        }
      }
    });
    return out;
  }

  // ── 列表列（row）擷取：與 class 名稱無關的通用演算法 ──────────
  function collectMarkers(doc, wordsList) {
    const markers = [];
    const all = doc.body ? doc.body.querySelectorAll('button, a, span, div, p, td, li, label, strong, em, small, b, i') : [];
    for (const el of all) {
      const tc = (el.textContent || '').trim();
      if (!tc || tc.length > 24) continue;
      // 只取「最內層」符合的元素
      if (Array.from(el.children).some((c) => {
        const ct = (c.textContent || '').trim();
        return ct && includesAny(ct, wordsList);
      })) continue;
      if (!includesAny(tc, wordsList) && !RE.remaining.test(tc)) continue;
      if (!isVisible(el)) continue;
      markers.push(el);
    }
    return markers;
  }

  function residualName(text) {
    let t = text;
    const all = [].concat(KEYWORDS.soldOut, KEYWORDS.paused, KEYWORDS.notOnSale, KEYWORDS.onSale);
    all.sort((a, b) => b.length - a.length).forEach((w) => {
      t = t.split(w).join(' ');
    });
    t = t
      .replace(new RegExp(RE.remaining.source, 'g'), ' ')
      .replace(new RegExp(RE.price.source, 'gi'), ' ')
      .replace(/[+＋\-－−–]/g, ' ')
      .replace(/(^|\s)\d{1,2}(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return t;
  }

  function climbToRow(marker, markerSet, stopAt) {
    let cur = marker;
    let fallback = null;
    for (let depth = 0; depth < 12 && cur && cur !== stopAt && cur.parentElement; depth++) {
      const parent = cur.parentElement;
      const hasName = residualName(textOf(cur)).replace(/[^\p{L}\p{N}]/gu, '').length >= 1;
      if (hasName && !fallback) fallback = cur;
      if (hasName) {
        const sig = signature(cur);
        const similarSiblings = Array.from(parent.children).filter((c) => c !== cur && signature(c) === sig && markerSet.some((m) => c.contains(m)));
        if (similarSiblings.length >= 1) return cur;
      }
      if (parent === stopAt) break;
      cur = parent;
    }
    return fallback;
  }

  function groupContext(row, stopAt) {
    // 往上找「群組標題」，例如價格區塊標題「VIP區 NT$6,800」
    let branch = row;
    for (let i = 0; i < 5 && branch && branch.parentElement && branch !== stopAt; i++) {
      const parent = branch.parentElement;
      let sib = branch.previousElementSibling;
      while (sib) {
        const t = textOf(sib);
        if (t && t.length <= 80 && isVisible(sib) && !includesAny(t, KEYWORDS.soldOut.concat(KEYWORDS.onSale, KEYWORDS.notOnSale)) && !findQtyControls(sib).length) {
          // 只採用與列結構不同的元素（標題），避免把上一列當成標題
          if (signature(sib) !== signature(branch)) return t;
        }
        sib = sib.previousElementSibling;
      }
      branch = parent;
    }
    return '';
  }

  function statusFromText(text, control) {
    if (includesAny(text, KEYWORDS.soldOut)) return SS.SOLD_OUT;
    const rem = text.match(RE.remaining);
    if (rem && parseInt(rem[1], 10) === 0) return SS.SOLD_OUT;
    if (includesAny(text, KEYWORDS.paused)) return SS.PAUSED;
    if (includesAny(text, KEYWORDS.notOnSale)) return SS.NOT_ON_SALE;
    if (control) return control.disabled ? SS.UNKNOWN : SS.ON_SALE;
    if (rem && parseInt(rem[1], 10) > 0) return SS.ON_SALE;
    if (includesAny(text, KEYWORDS.onSale)) return SS.ON_SALE;
    return SS.UNKNOWN;
  }

  function parsePrice(text) {
    const m = text.match(RE.price);
    if (!m) return null;
    const n = parseInt((m[1] || m[2] || '').replace(/,/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  }

  function uniqueRows(rows) {
    // 移除包含其他列的外層元素
    const set = Array.from(new Set(rows.filter(Boolean)));
    return set.filter((r) => !set.some((o) => o !== r && r.contains(o)));
  }

  // 場次列表（活動頁）
  function extractSessions(doc) {
    const words = [].concat(KEYWORDS.soldOut, KEYWORDS.paused, KEYWORDS.notOnSale, KEYWORDS.onSale);
    const markers = collectMarkers(doc, words);
    const rows = uniqueRows(markers.map((m) => climbToRow(m, markers, doc.body))).filter((r) => RE.date.test(textOf(r)));
    return rows.map((row, i) => {
      const text = textOf(row);
      const actionEl = Array.from(row.querySelectorAll('button, a, [role="button"]')).find(isVisible) || null;
      let status = statusFromText(text, null);
      if (status === SS.ON_SALE && actionEl && isDisabled(actionEl)) status = SS.UNKNOWN;
      return {
        index: i,
        name: residualName(text).slice(0, 120),
        text: text.slice(0, 200),
        status,
        row
      };
    });
  }

  // 票種 / 區域列表（購票頁）
  function extractTickets(doc) {
    const words = [].concat(KEYWORDS.soldOut, KEYWORDS.paused, KEYWORDS.notOnSale, ['熱賣中', '販售中', '可購買', '尚有座位']);
    const statusMarkers = collectMarkers(doc, words);
    const controls = doc.body ? findQtyControls(doc.body) : [];
    const controlEls = controls.map((c) => c.el);
    const markerSet = statusMarkers.concat(controlEls);
    const rows = uniqueRows(markerSet.map((m) => climbToRow(m, markerSet, doc.body)));
    return rows
      .map((row, i) => {
        const text = textOf(row);
        const control = controls.find((c) => row.contains(c.el)) || null;
        const context = groupContext(row, doc.body);
        const remMatch = text.match(RE.remaining);
        const remaining = remMatch ? parseInt(remMatch[1], 10) : null;
        return {
          index: i,
          name: residualName(text).slice(0, 120),
          context: residualName(context).slice(0, 120),
          price: parsePrice(text) || parsePrice(context),
          remaining,
          status: statusFromText(text, control),
          control,
          maxQty: control && control.max ? control.max : null,
          row
        };
      })
      .filter((t) => t.name || t.context);
  }

  // ── 一般資料欄位（姓名／手機／Email） ──────────────────────
  function labelFor(input) {
    const parts = [];
    const doc = input.ownerDocument;
    if (input.id) {
      const lab = doc.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lab) parts.push(textOf(lab));
    }
    const wrap = input.closest('label');
    if (wrap) parts.push(textOf(wrap));
    if (input.getAttribute('aria-label')) parts.push(input.getAttribute('aria-label'));
    const lb = input.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach((id) => { const e = doc.getElementById(id); if (e) parts.push(textOf(e)); });
    if (input.placeholder) parts.push(input.placeholder);
    // 往上找最近的文字標籤（例如 Vuetify 的 .v-label）
    let p = input.parentElement;
    for (let i = 0; i < 3 && p && !parts.length; i++, p = p.parentElement) {
      const t = textOf(p);
      if (t && t.length <= 30) parts.push(t);
    }
    return parts.join(' ').slice(0, 120);
  }

  function extractFormFields(doc) {
    const inputs = Array.from(doc.querySelectorAll('input')).filter((i) => {
      const type = (i.type || 'text').toLowerCase();
      return ['text', 'tel', 'email', ''].includes(type) && isVisible(i) && !i.disabled && !i.readOnly;
    });
    const result = { name: [], phone: [], email: [], skipped: [] };
    inputs.forEach((input) => {
      const label = labelFor(input);
      const meta = `${label} ${input.name || ''} ${input.id || ''} ${input.autocomplete || ''}`;
      if (SENSITIVE_FIELD_RE.test(meta)) {
        result.skipped.push({ label, reason: '敏感欄位，永不填寫' });
        return;
      }
      let kind = null;
      if (input.type === 'email' || /e-?mail|電子郵件|電子信箱|信箱/i.test(meta)) kind = 'email';
      else if (input.type === 'tel' || /手機|行動電話|電話|mobile|phone|\btel\b/i.test(meta)) kind = 'phone';
      else if (/姓名|名字|聯絡人|購票人|取票人|收件人|\bname\b|full.?name/i.test(meta) && !/帳號|暱稱|user.?name|nick/i.test(meta)) kind = 'name';
      if (kind) result[kind].push({ el: input, label: label || input.name || kind });
    });
    return result;
  }

  // ── 訂單資訊（結帳頁） ─────────────────────────────────
  function extractOrderInfo(doc) {
    const lines = textOf(doc.body).split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const keys = /(活動|場次|日期|時間|票種|票區|區域|座位|張數|數量|單價|金額|總計|合計|小計|手續費)/;
    const out = [];
    for (let i = 0; i < lines.length && out.length < 15; i++) {
      if (keys.test(lines[i]) && lines[i].length <= 80) {
        // 若標籤與值分在兩行，合併成一行
        const next = lines[i + 1] || '';
        out.push(lines[i].length <= 6 && next && !keys.test(next) ? `${lines[i]} ${next}` : lines[i]);
      }
    }
    return out;
  }

  function extractEventTitle(doc) {
    const h = Array.from(doc.querySelectorAll('h1, h2, [class*="title" i]')).find((e) => isVisible(e) && textOf(e).length >= 2 && textOf(e).length <= 100);
    if (h) return textOf(h);
    return (doc.title || '').replace(/\s*[|｜-]\s*(Ticket\s*Plus|遠大).*$/i, '').trim();
  }

  function perOrderLimit(bodyText) {
    const m = bodyText.match(RE.perOrderLimit);
    return m ? parseInt(m[1], 10) : null;
  }

  // ── 主分析函式 ─────────────────────────────────────────
  /**
   * 分析目前頁面。只讀取，不修改頁面、不點擊。
   * @returns {object} { pageType, reasons[], title, sessions[], tickets[], formFields, orderInfo[], perOrderLimit, saleStatus, fingerprint }
   */
  function analyze(doc, url) {
    const res = {
      adapterVersion: ADAPTER_VERSION,
      url,
      pageType: PT.UNKNOWN,
      reasons: [],
      title: '',
      sessions: [],
      tickets: [],
      formFields: null,
      orderInfo: [],
      perOrderLimit: null,
      saleStatus: SS.UNKNOWN,
      fingerprint: ''
    };

    if (!isSupportedUrl(url, doc)) {
      res.pageType = PT.UNSUPPORTED;
      res.reasons.push('不是 Ticket Plus 官方網址');
      return res;
    }
    if (!doc.body) {
      res.pageType = PT.LOADING;
      return res;
    }

    const bodyText = textOf(doc.body);
    res.title = extractEventTitle(doc);
    const lower = bodyText.toLowerCase();

    // 1) 安全檢查最優先：驗證元件 → 簡訊/身分驗證 → 驗證碼文字 → 排隊 → 登入
    const cap = detectCaptcha(doc, lower);
    const ver = detectVerification(lower);
    if (cap.found && cap.strong) return finish(res, PT.CAPTCHA, cap.reason);
    if (ver.found) return finish(res, PT.VERIFICATION, ver.reason);
    if (cap.found) return finish(res, PT.CAPTCHA, cap.reason);
    const q = detectQueue(doc, lower, url);
    if (q.found) return finish(res, PT.QUEUE, q.reason);
    const login = detectLogin(doc, lower);
    if (login.found) return finish(res, PT.LOGIN, login.reason);

    // 2) 逾時 / 錯誤：長頁面只看標題、警示框、對話框，避免「逾時將取消訂單」之類的說明文字誤判
    const prominent = Array.from(doc.querySelectorAll('h1, h2, h3, [role="alert"], [role="dialog"], .error, [class*="error" i], [class*="dialog" i], [class*="alert" i], [class*="modal" i]'))
      .filter(isVisible).map(textOf).join(' ').toLowerCase();
    // 很短的頁面（例如 502 錯誤頁）才看全文
    const scope = bodyText.length < 200 ? lower + ' ' + prominent : prominent;
    const to = firstMatch(scope, KEYWORDS.timeout);
    if (to) return finish(res, PT.TIMEOUT, `頁面出現「${to}」`);
    const err = firstMatch(scope, KEYWORDS.error);
    if (err) return finish(res, PT.ERROR, `頁面出現「${err}」`);

    // 3) 擷取票種與場次
    res.perOrderLimit = perOrderLimit(bodyText);
    const tickets = extractTickets(doc);
    const withControls = tickets.filter((t) => t.control);
    const sessions = extractSessions(doc);

    // 4) 結帳／訂單確認頁（外掛在此停止一切操作）
    //    有可操作的張數控制時，代表仍在選票階段，不判定為結帳頁。
    const strong = firstMatch(lower, KEYWORDS.checkoutStrong);
    const weak = firstMatch(lower, KEYWORDS.checkoutWeak);
    const urlCheckout = URL_HINTS.checkout.test(url);
    if (!withControls.length && (strong || urlCheckout || (weak && !tickets.length && !sessions.length))) {
      res.orderInfo = extractOrderInfo(doc);
      const why = strong || weak;
      return finish(res, PT.CHECKOUT, why ? `頁面出現「${why}」` : '網址顯示為結帳頁');
    }

    // 5) 購票頁（票種 / 區域）與活動頁（場次）
    const pricedTickets = tickets.filter((t) => t.price);
    const orderLike = withControls.length > 0 || (pricedTickets.length > 0 && (URL_HINTS.order.test(url) || pricedTickets.length > sessions.length));
    if (orderLike && (withControls.length >= sessions.length || pricedTickets.length > sessions.length || URL_HINTS.order.test(url))) {
      res.tickets = tickets;
      res.formFields = extractFormFields(doc);
      res.saleStatus = aggregateStatus(tickets.map((t) => t.status));
      res.fingerprint = 'T|' + tickets.map((t) => `${t.context}/${t.name}:${t.status}:${t.remaining}`).join('|');
      return finish(res, PT.ORDER, `辨識到 ${tickets.length} 個票種／區域`);
    }
    if (sessions.length) {
      res.sessions = sessions;
      res.saleStatus = aggregateStatus(sessions.map((s) => s.status));
      res.fingerprint = 'S|' + sessions.map((s) => `${s.name}:${s.status}`).join('|');
      return finish(res, PT.EVENT, `辨識到 ${sessions.length} 個場次`);
    }
    if (tickets.length && URL_HINTS.order.test(url)) {
      res.tickets = tickets;
      res.saleStatus = aggregateStatus(tickets.map((t) => t.status));
      res.fingerprint = 'T|' + tickets.map((t) => `${t.context}/${t.name}:${t.status}`).join('|');
      return finish(res, PT.ORDER, `辨識到 ${tickets.length} 個票種／區域（無可選張數）`);
    }

    // 5) 載入中 / 無法辨識
    const spinner = Array.from(doc.querySelectorAll('[class*="loading" i], [class*="spinner" i], [class*="progress" i], [aria-busy="true"]')).some(isVisible);
    if (spinner || bodyText.length < 30 || firstMatch(lower, KEYWORDS.loading)) {
      return finish(res, PT.LOADING, '頁面內容尚未載入完成');
    }
    return finish(res, PT.UNKNOWN, '找不到可辨識的場次或票種資訊（網站可能已改版）');
  }

  function finish(res, type, reason) {
    res.pageType = type;
    if (reason) res.reasons.push(reason);
    if (!res.fingerprint) res.fingerprint = type;
    return res;
  }

  function aggregateStatus(list) {
    if (!list.length) return SS.UNKNOWN;
    if (list.includes(SS.ON_SALE)) return SS.ON_SALE;
    if (list.every((s) => s === SS.SOLD_OUT)) return SS.SOLD_OUT;
    if (list.includes(SS.NOT_ON_SALE)) return SS.NOT_ON_SALE;
    if (list.includes(SS.PAUSED)) return SS.PAUSED;
    if (list.includes(SS.SOLD_OUT) && list.every((s) => s === SS.SOLD_OUT || s === SS.UNKNOWN)) return SS.SOLD_OUT;
    return SS.UNKNOWN;
  }

  // ── 與使用者偏好比對 ─────────────────────────────────────
  function rankIn(text, list) {
    const t = norm(text);
    for (let i = 0; i < list.length; i++) {
      if (list[i] && t.includes(norm(list[i]))) return i;
    }
    return -1;
  }

  function matchSessions(sessions, profile) {
    const kw = profile && profile.sessionKeyword;
    if (!kw) return sessions.slice();
    const parts = String(kw).split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    return sessions.filter((s) => parts.some((p) => norm(s.text).includes(norm(p))));
  }

  /**
   * 依使用者設定為票種排序。絕不把使用者沒同意的票種列為「符合」。
   * @returns {{ matches: Array, others: Array, unavailable: Array, warnings: string[] }}
   */
  function matchTickets(tickets, profile, perOrderLimitValue) {
    const primary = (profile && profile.ticketTypesPrimary) || [];
    const backup = (profile && profile.ticketTypesBackup) || [];
    const areas = ((profile && profile.areas) || []).filter(Boolean);
    const qty = (profile && profile.quantity) || 1;
    const noTypePref = !primary.length && !backup.length;
    const noAreaPref = !areas.length;

    const matches = [];
    const others = [];
    const unavailable = [];
    const warnings = [];

    tickets.forEach((t) => {
      const full = `${t.context} ${t.name}`;
      let typeRank = rankIn(full, primary);
      let typeLabel = typeRank >= 0 ? `優先票種「${primary[typeRank]}」` : '';
      if (typeRank < 0) {
        const b = rankIn(full, backup);
        if (b >= 0) {
          typeRank = 100 + b;
          typeLabel = `備選票種「${backup[b]}」`;
        }
      }
      if (typeRank < 0 && noTypePref) {
        typeRank = 0;
        typeLabel = '任何票種';
      }
      let areaRank = rankIn(full, areas);
      let areaLabel = areaRank >= 0 ? `第 ${areaRank + 1} 優先區域「${areas[areaRank]}」` : '';
      if (areaRank < 0 && noAreaPref) {
        areaRank = 0;
        areaLabel = '任何區域';
      }

      const effectiveMax = [t.maxQty, t.remaining, perOrderLimitValue].filter((n) => Number.isFinite(n) && n > 0);
      const maxAllowed = effectiveMax.length ? Math.min(...effectiveMax) : null;
      const enough = t.status === SS.ON_SALE && (t.remaining === null || t.remaining >= qty) && (maxAllowed === null || maxAllowed >= qty);

      const item = {
        index: t.index,
        label: [t.context, t.name].filter(Boolean).join(' ／ '),
        price: t.price,
        remaining: t.remaining,
        status: t.status,
        maxAllowed,
        typeRank,
        areaRank,
        reason: [typeLabel, areaLabel].filter(Boolean).join('、')
      };

      if (typeRank < 0) return; // 未經使用者同意的票種，不列入
      if (areaRank < 0) {
        if (profile && profile.allowOtherAreas && enough) {
          item.reason = `${typeLabel}、其他區域（需您自行確認）`;
          item.areaRank = 999;
          others.push(item);
        }
        return;
      }
      if (enough) matches.push(item);
      else {
        item.reason += t.status !== SS.ON_SALE ? `（${labelOf(t.status)}）` : `（剩餘或可購張數不足 ${qty} 張）`;
        unavailable.push(item);
      }
    });

    const sorter = (a, b) => a.typeRank - b.typeRank || a.areaRank - b.areaRank || (a.price || 0) - (b.price || 0);
    matches.sort(sorter);
    others.sort(sorter);
    if (perOrderLimitValue && qty > perOrderLimitValue) {
      warnings.push(`官方頁面顯示每筆限購 ${perOrderLimitValue} 張，您設定的 ${qty} 張超過上限，請調整。`);
    }
    if (!matches.length && unavailable.length) warnings.push('符合偏好的票種目前無法購買或剩餘數量不足。');
    return { matches, others, unavailable, warnings };
  }

  function labelOf(status) {
    return (root.TP_LABELS && root.TP_LABELS.saleStatus[status]) || status;
  }

  root.TicketPlusAdapter = {
    ADAPTER_VERSION,
    KEYWORDS,
    isSupportedUrl,
    isOfficialUrl,
    analyze,
    matchSessions,
    matchTickets,
    findQtyControls,
    extractFormFields,
    isVisible,
    norm,
    SENSITIVE_FIELD_RE
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
