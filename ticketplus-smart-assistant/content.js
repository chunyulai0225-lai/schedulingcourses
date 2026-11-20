/*
 * content.js — 內容腳本（在 Ticket Plus 官方頁面中執行）
 *
 * 只做「使用者看得到、使用者自己也能做」的事：
 *  ✔ 讀取畫面上的票況、標示符合偏好的票種、捲動到該位置
 *  ✔ 使用者按下按鈕並確認後，填寫姓名／手機／Email、設定下拉選單張數
 *  ✘ 永不點擊網站的按鈕（購買、+/-、下一步、確認、付款…）
 *  ✘ 永不送出表單、永不填寫付款資訊、永不操作驗證碼
 *  ✘ 不發出任何網路請求；頁面刷新由使用者同意後由 service worker 以一般重新整理執行
 */
(function () {
  'use strict';

  if (window.__tpsaLoaded) return; // 避免重複注入
  window.__tpsaLoaded = true;

  const C = window.TP_CONFIG;
  const L = window.TP_LABELS;
  const A = window.TicketPlusAdapter;
  if (!C || !A) return;
  if (!A.isSupportedUrl(location.href, document)) return; // 非官方頁面：完全不啟用

  const PT = C.PAGE_TYPES;
  const SS = C.SALE_STATUS;
  const HOLD_TYPES = [PT.CAPTCHA, PT.VERIFICATION, PT.QUEUE, PT.LOGIN];
  const STOP_TYPES = [PT.CHECKOUT, PT.ERROR, PT.TIMEOUT, PT.UNKNOWN, PT.UNSUPPORTED];
  const UNKNOWN_GRACE_MS = 15000; // 頁面載入後給 15 秒等待內容出現，才判定「無法辨識」

  const state = {
    monitor: null,
    profile: null,
    isBound: false,
    analysis: null,
    evaluation: null,
    lastReportKey: '',
    lastReportAt: 0,
    pendingSince: Date.now(),
    lastUserActivity: 0,
    hadHold: false,
    collapsed: false,
    highlighted: new Set(),
    confirmAction: null,
    flash: ''
  };

  // ── 與 service worker 溝通 ─────────────────────────────
  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res && res.ok ? res.data : null);
        });
      } catch (e) {
        // 外掛被重新載入後，舊的內容腳本會失去連線
        resolve(null);
      }
    });
  }

  function contentLog(level, message, detail) {
    return send({ type: 'contentLog', level, category: 'assist', message, detail });
  }

  function isActive() {
    return state.isBound && state.monitor && state.monitor.state === C.MONITOR_STATES.MONITORING;
  }

  function isAssistMode() {
    return state.profile && state.profile.mode === 'assist';
  }

  // ── 評估目前頁面（只讀取） ──────────────────────────────
  function evaluate() {
    if (!state.isBound) {
      removeHighlights();
      renderPanel();
      return;
    }
    let analysis;
    try {
      analysis = A.analyze(document, location.href);
    } catch (e) {
      analysis = { pageType: PT.UNKNOWN, reasons: ['頁面分析發生錯誤：' + e.message], sessions: [], tickets: [], saleStatus: SS.UNKNOWN, fingerprint: 'error' };
    }

    // 載入寬限期：剛載入的 SPA 頁面可能還沒有內容
    let pageType = analysis.pageType;
    const waited = Date.now() - state.pendingSince;
    if ((pageType === PT.UNKNOWN || pageType === PT.LOADING) && waited < UNKNOWN_GRACE_MS) {
      pageType = PT.LOADING;
    } else if (pageType === PT.LOADING && waited >= UNKNOWN_GRACE_MS) {
      pageType = PT.UNKNOWN;
      analysis.reasons.push(`等待 ${UNKNOWN_GRACE_MS / 1000} 秒後仍無法取得場次或票種資訊`);
    }
    analysis.pageType = pageType;
    if (![PT.LOADING, PT.UNKNOWN].includes(pageType)) state.pendingSince = Date.now();

    const ev = buildEvaluation(analysis);
    state.analysis = analysis;
    state.evaluation = ev;

    // 安全檢查（驗證碼／排隊／登入）：立即暫停所有輔助操作
    const hold = HOLD_TYPES.includes(pageType);
    if (hold) {
      state.confirmAction = null;
      removeHighlights();
    } else {
      applyHighlights(ev);
    }
    if (state.hadHold && !hold) {
      state.flash = '安全檢查頁面已結束。輔助功能可再次使用，但每個動作仍需您親自按下確認。';
      contentLog('info', '安全檢查頁面已結束', `目前頁面：${L.pageType[pageType]}`);
    }
    state.hadHold = hold;

    report(analysis, ev);
    renderPanel();
  }

  function buildEvaluation(analysis) {
    const ev = { matches: [], others: [], unavailable: [], warnings: [], sessionMatches: [], summary: '' };
    const p = state.profile || {};
    if (analysis.pageType === PT.EVENT) {
      const matched = A.matchSessions(analysis.sessions, p);
      ev.sessionMatches = matched;
      ev.matches = matched
        .filter((s) => s.status === SS.ON_SALE)
        .map((s) => ({ kind: 'session', index: s.index, label: s.name || s.text, reason: p.sessionKeyword ? `符合場次「${p.sessionKeyword}」` : '可購買場次', status: s.status }));
      if (p.sessionKeyword && !matched.length) ev.warnings.push(`頁面上找不到符合「${p.sessionKeyword}」的場次，請確認場次設定。`);
      const counts = countBy(analysis.sessions.map((s) => s.status));
      ev.summary = `共 ${analysis.sessions.length} 個場次：${fmtCounts(counts)}${matched.length ? `；符合設定 ${matched.length} 場` : ''}`;
    } else if (analysis.pageType === PT.ORDER) {
      const m = A.matchTickets(analysis.tickets, p, analysis.perOrderLimit);
      ev.matches = m.matches.map((x) => Object.assign({ kind: 'ticket' }, x));
      ev.others = m.others.map((x) => Object.assign({ kind: 'ticket' }, x));
      ev.unavailable = m.unavailable;
      ev.warnings = m.warnings;
      const counts = countBy(analysis.tickets.map((t) => t.status));
      ev.summary = `共 ${analysis.tickets.length} 個票種／區域：${fmtCounts(counts)}；符合設定 ${m.matches.length} 個`;
    } else {
      ev.summary = L.pageType[analysis.pageType] || analysis.pageType;
    }
    return ev;
  }

  function countBy(list) {
    return list.reduce((o, k) => ((o[k] = (o[k] || 0) + 1), o), {});
  }
  function fmtCounts(counts) {
    return Object.keys(counts).map((k) => `${L.saleStatus[k] || k} ${counts[k]}`).join('、') || '無';
  }

  function report(analysis, ev) {
    const key = [analysis.pageType, analysis.fingerprint, ev.matches.map((m) => m.label).join('|'), navigator.onLine].join('#');
    const now = Date.now();
    // 有變化立即回報；沒有變化時每 10 秒回報一次（更新偵測時間）
    if (key === state.lastReportKey && now - state.lastReportAt < 10000) return;
    state.lastReportKey = key;
    state.lastReportAt = now;
    send({
      type: 'report',
      report: {
        url: location.href,
        pageType: analysis.pageType,
        saleStatus: analysis.saleStatus,
        title: analysis.title,
        reasons: analysis.reasons,
        fingerprint: analysis.fingerprint,
        summary: ev.summary,
        matches: ev.matches.map((m) => ({ label: m.label, reason: m.reason, price: m.price || null, remaining: m.remaining == null ? null : m.remaining })),
        warnings: ev.warnings,
        orderInfo: analysis.orderInfo || [],
        online: navigator.onLine
      }
    });
  }

  // ── 視覺標示（只改外框樣式，不改變網站功能） ─────────────────
  function rowFor(match) {
    const a = state.analysis;
    if (!a) return null;
    const list = match.kind === 'session' ? a.sessions : a.tickets;
    const item = list.find((x) => x.index === match.index);
    return item ? item.row : null;
  }

  function applyHighlights(ev) {
    const want = new Set();
    ev.matches.forEach((m) => {
      const row = rowFor(m);
      if (row) want.add(row);
    });
    state.highlighted.forEach((el) => {
      if (!want.has(el)) unmark(el);
    });
    want.forEach((el) => {
      if (!state.highlighted.has(el)) {
        el.dataset.tpsaPrevOutline = el.style.outline || '';
        el.dataset.tpsaPrevBg = el.style.backgroundColor || '';
      }
      el.style.outline = '3px solid #1d63d6';
      el.style.backgroundColor = 'rgba(29,99,214,0.08)';
    });
    state.highlighted = want;
  }

  function unmark(el) {
    el.style.outline = el.dataset.tpsaPrevOutline || '';
    el.style.backgroundColor = el.dataset.tpsaPrevBg || '';
    delete el.dataset.tpsaPrevOutline;
    delete el.dataset.tpsaPrevBg;
  }

  function removeHighlights() {
    state.highlighted.forEach(unmark);
    state.highlighted = new Set();
  }

  // ── 使用者觸發的輔助動作 ──────────────────────────────────
  function canAssist() {
    const t = state.analysis && state.analysis.pageType;
    if (!isActive()) return { ok: false, reason: '監控未啟動或已暫停。' };
    if (HOLD_TYPES.includes(t)) return { ok: false, reason: '安全檢查進行中，請先親自完成。' };
    if (STOP_TYPES.includes(t) || t === PT.LOADING) return { ok: false, reason: '目前頁面不提供輔助操作。' };
    return { ok: true };
  }

  function locate(match) {
    const row = rowFor(match);
    if (!row || !row.isConnected) {
      state.flash = '找不到該項目，頁面可能已更新，請稍候再試。';
      return renderPanel();
    }
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prev = row.style.boxShadow;
    row.style.boxShadow = '0 0 0 6px rgba(29,99,214,.45)';
    setTimeout(() => (row.style.boxShadow = prev), 1600);
    contentLog('info', '定位到票券位置', match.label);
  }

  // 設定張數：只支援原生下拉選單／數字欄位；+/- 按鈕一律請使用者自己按
  function prepareQuantity(match) {
    const ok = canAssist();
    if (!ok.ok) return setFlash(ok.reason);
    if (!isAssistMode()) return setFlash('目前為純監控模式，請自行選擇張數。');
    const ticket = state.analysis.tickets.find((t) => t.index === match.index);
    if (!ticket || !ticket.row.isConnected) return setFlash('找不到這個票種，頁面可能已更新。');
    const qty = state.profile.quantity;
    const limits = [ticket.maxQty, ticket.remaining, state.analysis.perOrderLimit].filter((n) => Number.isFinite(n) && n > 0);
    const max = limits.length ? Math.min(...limits) : null;
    if (max !== null && qty > max) return setFlash(`頁面顯示最多只能選 ${max} 張，少於您設定的 ${qty} 張，請自行調整。`);
    const ctrl = ticket.control;
    if (!ctrl || ctrl.disabled) return setFlash('這個票種目前無法選擇張數。');
    if (ctrl.kind === 'buttons') {
      locate(match);
      return setFlash(`此頁面使用「＋／－」按鈕，為遵守網站規範，外掛不會替您點擊。請自行按「＋」選到 ${qty} 張。`);
    }
    state.confirmAction = {
      title: '確認設定張數',
      lines: [`票種／區域：${match.label}`, `張數：${qty} 張`, max ? `頁面可選上限：${max} 張` : '頁面未顯示上限'],
      run: () => applyQuantity(ticket, qty)
    };
    renderPanel();
  }

  function applyQuantity(ticket, qty) {
    const el = ticket.control.el;
    if (!el.isConnected || el.disabled) return setFlash('欄位已改變，未進行設定。');
    if (el.tagName === 'SELECT') {
      const opt = Array.from(el.options).find((o) => parseInt(o.value || o.textContent, 10) === qty);
      if (!opt) return setFlash(`下拉選單中沒有 ${qty} 張的選項，未進行設定。`);
      setNativeValue(el, opt.value);
    } else {
      const max = parseInt(el.max, 10);
      if (!Number.isNaN(max) && qty > max) return setFlash('超過欄位上限，未進行設定。');
      setNativeValue(el, String(qty));
    }
    const okSet = parseInt(el.value, 10) === qty;
    contentLog(okSet ? 'success' : 'warn', okSet ? `已設定張數 ${qty} 張` : '張數設定未成功', ticket.name);
    setFlash(okSet ? `已將張數設為 ${qty} 張。請自行確認後，親自按下網站上的下一步按鈕。` : '設定未成功，請自行選擇張數。');
  }

  // 填寫一般資料：先預覽、再由使用者確認
  async function prepareFill() {
    const ok = canAssist();
    if (!ok.ok) return setFlash(ok.reason);
    if (!isAssistMode()) return setFlash('目前為純監控模式，不提供自動填寫。');
    const res = await send({ type: 'getPersonalForFill' });
    if (!res || !res.ok) return setFlash((res && res.error) || '無法取得購票資料。');
    const personal = res.personal;
    const fields = A.extractFormFields(document);
    const plan = [];
    const issues = [];
    const NAMES = { name: '姓名', phone: '手機', email: '電子郵件' };
    ['name', 'phone', 'email'].forEach((kind) => {
      const value = personal[kind];
      const cands = fields[kind];
      if (!value) return;
      if (cands.length === 0) issues.push(`找不到「${NAMES[kind]}」欄位`);
      else if (cands.length > 1) issues.push(`找到 ${cands.length} 個疑似「${NAMES[kind]}」欄位，為避免填錯，請自行填寫`);
      else if (cands[0].el.value && cands[0].el.value.trim()) issues.push(`「${cands[0].label}」已有內容，不覆寫`);
      else plan.push({ kind, el: cands[0].el, label: cands[0].label, value });
    });
    fields.skipped.forEach((s) => issues.push(`略過敏感欄位「${s.label}」（${s.reason}）`));
    if (!plan.length) return setFlash(['沒有可以安全填寫的欄位。'].concat(issues).join('\n'));
    state.confirmAction = {
      title: '確認填寫購票資料',
      lines: plan.map((p) => `「${p.label}」← ${NAMES[p.kind]}：${mask(p.kind, p.value)}`).concat(issues.map((i) => '⚠ ' + i)),
      run: () => applyFill(plan)
    };
    renderPanel();
  }

  function mask(kind, v) {
    if (kind === 'phone') return v.replace(/^(\d{4})\d+(\d{3})$/, '$1***$2');
    if (kind === 'email') return v.replace(/^(.).*(@.*)$/, '$1***$2');
    return v;
  }

  function applyFill(plan) {
    const done = [];
    const failed = [];
    plan.forEach((p) => {
      // 填寫前再檢查一次欄位仍存在、可見、仍屬於同一類別
      if (!p.el.isConnected || !A.isVisible(p.el) || p.el.disabled || p.el.readOnly || A.SENSITIVE_FIELD_RE.test(p.label)) {
        failed.push(p.label);
        return;
      }
      setNativeValue(p.el, p.value);
      (p.el.value === p.value ? done : failed).push(p.label);
    });
    contentLog(failed.length ? 'warn' : 'success', `填寫購票資料：成功 ${done.length} 欄${failed.length ? `，失敗 ${failed.length} 欄` : ''}`, done.concat(failed).join('、'));
    setFlash(`已填寫：${done.join('、') || '無'}${failed.length ? `\n未填寫：${failed.join('、')}` : ''}\n請親自檢查內容是否正確。外掛不會送出表單。`);
  }

  // 以原生 setter 設定值並觸發 input/change，讓 Vue/React 等框架也能正確接收
  function setNativeValue(el, value) {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setFlash(msg) {
    state.flash = msg;
    state.confirmAction = null;
    renderPanel();
  }

  // ── 自動刷新的安全確認（由 service worker 詢問） ───────────────
  function canRefresh() {
    const a = state.analysis;
    if (!isActive()) return { ok: false, reason: '監控未啟動' };
    if (!navigator.onLine) return { ok: false, reason: '網路中斷' };
    if (!a) return { ok: false, reason: '尚未完成頁面辨識' };
    if (HOLD_TYPES.includes(a.pageType)) return { ok: false, reason: '驗證／排隊／登入頁面，永不自動刷新' };
    if (Date.now() - state.lastUserActivity < 20000) return { ok: false, reason: '您正在操作頁面，暫不刷新' };
    const okStatus = [SS.NOT_ON_SALE, SS.SOLD_OUT, SS.PAUSED];
    if (a.pageType === PT.EVENT && okStatus.includes(a.saleStatus)) return { ok: true };
    if (a.pageType === PT.ORDER && a.saleStatus === SS.SOLD_OUT) return { ok: true };
    return { ok: false, reason: `目前為「${L.pageType[a.pageType]}／${L.saleStatus[a.saleStatus] || '—'}」，不需要或不適合刷新` };
  }

  // ── 浮動面板（Shadow DOM，不影響網站樣式） ──────────────────
  let host = null;
  let shadow = null;
  let lastHtml = '';

  function ensurePanel() {
    if (host && host.isConnected) return;
    host = document.createElement('tpsa-panel');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; right: 16px; bottom: 16px;';
    shadow = host.attachShadow({ mode: 'open' });
    // 掛在 <html> 底下（不在 <body> 內），確保頁面辨識永遠不會讀到面板自己的文字
    document.documentElement.appendChild(host);
    lastHtml = '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const STYLE = `
    :host{all:initial}
    *{box-sizing:border-box;font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}
    .card{width:340px;max-height:72vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(15,40,90,.25);border:1px solid #d6e2f5;color:#1f2a3d;font-size:13px}
    .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1d63d6;color:#fff;border-radius:14px 14px 0 0;position:sticky;top:0}
    .hd b{flex:1;font-size:14px}
    .hd button{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}
    .bd{padding:10px 12px}
    .row{display:flex;justify-content:space-between;gap:8px;margin:4px 0}
    .row span:first-child{color:#5b6b85}
    .chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600}
    .c-ok{background:#e6f4ea;color:#188038}.c-warn{background:#fef7e0;color:#a05a00}.c-bad{background:#fce8e6;color:#c5221f}.c-info{background:#e8f0fe;color:#1d63d6}.c-mute{background:#eef1f5;color:#5b6b85}
    .alert{border-radius:10px;padding:10px;margin:8px 0;line-height:1.55;white-space:pre-line}
    .a-bad{background:#fce8e6;border:1px solid #f4b8b2;color:#8c1d18}
    .a-warn{background:#fef7e0;border:1px solid #f6d58b;color:#7a4500}
    .a-info{background:#e8f0fe;border:1px solid #b9cef7;color:#123d84}
    .a-ok{background:#e6f4ea;border:1px solid #a8dab5;color:#0d5323}
    h4{margin:10px 0 6px;font-size:13px;color:#123d84}
    ul{margin:0;padding-left:18px} li{margin:3px 0}
    .m{border:1px solid #d6e2f5;border-radius:10px;padding:8px;margin:6px 0;background:#f7faff}
    .m .t{font-weight:600}
    .m .r{color:#5b6b85;font-size:12px;margin-top:2px}
    .btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
    .btn{border:1px solid #1d63d6;background:#fff;color:#1d63d6;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600}
    .btn.primary{background:#1d63d6;color:#fff}
    .btn:disabled{opacity:.45;cursor:not-allowed}
    .muted{color:#7a869a;font-size:12px}
    .mini{display:flex;align-items:center;gap:8px;background:#1d63d6;color:#fff;border-radius:999px;padding:8px 14px;box-shadow:0 6px 20px rgba(15,40,90,.3);cursor:pointer;font-size:13px;font-weight:600;border:0}
    .dot{width:9px;height:9px;border-radius:50%;background:#fff}
    .dot.bad{background:#ff8a80}.dot.ok{background:#8ef0a7}
  `;

  function chipFor(pageType, saleStatus) {
    if (HOLD_TYPES.includes(pageType)) return ['c-bad', L.pageType[pageType]];
    if (pageType === PT.CHECKOUT) return ['c-warn', '請親自確認訂單'];
    if ([PT.ERROR, PT.TIMEOUT, PT.UNKNOWN].includes(pageType)) return ['c-bad', L.pageType[pageType]];
    if (pageType === PT.LOADING) return ['c-mute', '頁面載入中'];
    const cls = { onSale: 'c-ok', notOnSale: 'c-info', soldOut: 'c-bad', paused: 'c-warn' }[saleStatus] || 'c-mute';
    return [cls, L.saleStatus[saleStatus] || '未知'];
  }

  function renderPanel() {
    if (!state.isBound) {
      if (host) host.remove();
      host = null;
      return;
    }
    ensurePanel();
    const a = state.analysis || { pageType: PT.LOADING, saleStatus: SS.UNKNOWN, reasons: [] };
    const ev = state.evaluation || { matches: [], others: [], unavailable: [], warnings: [], summary: '' };
    const p = state.profile || {};
    const monitorState = state.monitor ? state.monitor.state : 'idle';
    const [chipCls, chipText] = chipFor(a.pageType, a.saleStatus);
    const attention = HOLD_TYPES.includes(a.pageType) || a.pageType === PT.CHECKOUT || ev.matches.length > 0;

    if (state.collapsed) {
      const mini = `<style>${STYLE}</style><button class="mini" data-act="expand"><span class="dot ${attention ? (ev.matches.length ? 'ok' : 'bad') : ''}"></span>購票小幫手｜${esc(chipText)}</button>`;
      if (mini !== lastHtml) {
        shadow.innerHTML = mini;
        lastHtml = mini;
        bindEvents();
      }
      return;
    }

    const assistAllowed = canAssist().ok && isAssistMode();
    let html = `<style>${STYLE}</style><div class="card" role="region" aria-label="Ticket Plus 購票小幫手">
      <div class="hd"><b>🎫 購票小幫手</b><span class="chip ${monitorState === 'monitoring' ? 'c-ok' : 'c-mute'}" style="background:#fff">${esc(L.monitorState[monitorState])}</span><button data-act="collapse" title="縮小">－</button></div>
      <div class="bd">
        <div class="row"><span>活動設定</span><span>${esc(p.name || '—')}</span></div>
        <div class="row"><span>目前頁面</span><span>${esc(L.pageType[a.pageType] || a.pageType)}</span></div>
        <div class="row"><span>票況</span><span class="chip ${chipCls}">${esc(chipText)}</span></div>
        <div class="row"><span>偵測時間</span><span id="tpsa-time"></span></div>
        <div class="row"><span>模式</span><span>${isAssistMode() ? '輔助模式' : '純監控模式'}</span></div>`;

    if (monitorState === 'paused') html += `<div class="alert a-warn">監控已暫停：不會發送通知，也不會刷新頁面。</div>`;

    // 安全檢查：驗證碼／排隊／身分驗證／登入
    if (HOLD_TYPES.includes(a.pageType)) {
      const msg = {
        captcha: '頁面出現驗證碼。外掛已暫停所有輔助操作，請您親自完成驗證。外掛不會辨識、填寫或繞過驗證碼。',
        verification: '頁面要求簡訊／身分驗證。外掛已暫停，請您親自完成驗證。',
        queue: '您正在官方排隊流程中。請保持此頁面開啟、不要重新整理，外掛不會刷新頁面或改變排隊順序。',
        login: '頁面要求登入。請您親自輸入帳號密碼，外掛不會儲存或填寫密碼。'
      }[a.pageType];
      html += `<div class="alert a-bad"><b>⛔ 已暫停自動輔助</b>\n${esc(msg)}</div>`;
    }

    // 人工確認（結帳頁）
    if (a.pageType === PT.CHECKOUT) {
      html += `<div class="alert a-warn"><b>✅ 人工確認階段</b>\n外掛已停止所有操作，不會點擊確認或付款按鈕。請逐項檢查以下資訊後，由您親自完成訂單確認與付款。</div>
        <h4>您的購票設定</h4><ul>
          <li>場次：${esc(p.sessionKeyword || '未指定')}</li>
          <li>票種：${esc((p.ticketTypesPrimary || []).join('、') || '未指定')}${(p.ticketTypesBackup || []).length ? `（備選：${esc(p.ticketTypesBackup.join('、'))}）` : ''}</li>
          <li>區域：${esc((p.areas || []).filter(Boolean).join(' > ') || '未指定')}</li>
          <li>張數：${esc(p.quantity)} 張</li></ul>
        <h4>網站顯示的訂單資訊</h4>
        ${(a.orderInfo || []).length ? `<ul>${a.orderInfo.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted">未能擷取訂單資訊，請直接查看網頁內容。</p>'}
        <h4>請自行確認</h4><ul><li>場次、日期、時間是否正確</li><li>票種、區域、張數是否正確</li><li>總金額與付款方式</li><li>購票人資料是否正確</li></ul>`;
    }

    if ([PT.ERROR, PT.TIMEOUT, PT.UNKNOWN].includes(a.pageType)) {
      const msg = {
        error: '售票頁面出現錯誤。外掛已停止操作，請依網站指示手動處理。',
        timeout: '購票頁面已逾時。請依網站指示手動重新操作，外掛不會自動重建工作階段。',
        unknown: '無法辨識目前頁面（可能是網站改版或內容尚未載入）。外掛不會進行任何操作，請手動操作。'
      }[a.pageType];
      html += `<div class="alert a-bad">${esc(msg)}${a.reasons && a.reasons.length ? `\n<span class="muted">${esc(a.reasons.join('；'))}</span>` : ''}</div>`;
    }

    if (!navigator.onLine) html += `<div class="alert a-bad">📡 網路中斷，恢復連線後會自動重新偵測。</div>`;

    if ([PT.EVENT, PT.ORDER].includes(a.pageType)) {
      html += `<div class="muted" style="margin-top:6px">${esc(ev.summary)}</div>`;
      if (ev.matches.length) {
        html += `<h4>✅ 符合您設定的${a.pageType === PT.EVENT ? '場次' : '票券'}（依優先順序）</h4>`;
        ev.matches.slice(0, 6).forEach((m, i) => {
          html += `<div class="m"><div class="t">${i + 1}. ${esc(m.label)}</div><div class="r">${esc(m.reason || '')}${m.price ? `｜NT$${m.price.toLocaleString()}` : ''}${m.remaining != null ? `｜剩餘 ${m.remaining}` : ''}</div>
            <div class="btns"><button class="btn" data-act="locate" data-i="${i}">📍 定位</button>${
              m.kind === 'ticket' && isAssistMode() ? `<button class="btn" data-act="qty" data-i="${i}" ${assistAllowed ? '' : 'disabled'}>設定張數（${esc(p.quantity)} 張）</button>` : ''
            }</div></div>`;
        });
        html += `<p class="muted">${a.pageType === PT.EVENT ? '請親自點擊網站上的購買按鈕進入選票。' : '請親自在網站上選擇並按下一步。'}外掛不會替您點擊網站按鈕。</p>`;
      } else {
        html += `<div class="alert a-info">目前沒有符合您設定且可購買的${a.pageType === PT.EVENT ? '場次' : '票券'}。</div>`;
      }
      if (ev.others.length) {
        html += `<h4>其他區域（需您自行判斷，外掛不會替您選擇）</h4><ul>${ev.others.slice(0, 5).map((m) => `<li>${esc(m.label)}</li>`).join('')}</ul>`;
      }
      if (ev.unavailable.length) {
        html += `<h4>符合偏好但目前無法購買</h4><ul>${ev.unavailable.slice(0, 5).map((m) => `<li>${esc(m.label)} <span class="muted">${esc(m.reason)}</span></li>`).join('')}</ul>`;
      }
      ev.warnings.forEach((w) => (html += `<div class="alert a-warn">${esc(w)}</div>`));
      if (a.pageType === PT.ORDER && isAssistMode()) {
        html += `<div class="btns"><button class="btn primary" data-act="fill" ${assistAllowed ? '' : 'disabled'}>✍ 填寫購票資料</button></div>
          <p class="muted">按下後會先顯示將填寫的內容，經您確認才會填入；只填姓名、手機、Email，不會送出表單。</p>`;
      }
      if (!isAssistMode()) html += `<p class="muted">純監控模式：外掛只讀取與通知，不會修改頁面上的任何欄位。</p>`;
    }

    if (state.confirmAction) {
      html += `<div class="alert a-info"><b>${esc(state.confirmAction.title)}</b>\n${state.confirmAction.lines.map(esc).join('\n')}
        <div class="btns"><button class="btn primary" data-act="confirm-yes">確認執行</button><button class="btn" data-act="confirm-no">取消</button></div></div>`;
    }
    if (state.flash) html += `<div class="alert a-ok">${esc(state.flash)}<div class="btns"><button class="btn" data-act="flash-close">知道了</button></div></div>`;

    html += `</div></div>`;
    // 內容沒變時不重繪，避免使用者正要按的按鈕被替換掉
    if (html !== lastHtml) {
      shadow.innerHTML = html;
      lastHtml = html;
      bindEvents();
    }
    const t = shadow.getElementById('tpsa-time');
    if (t) t.textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  }

  function bindEvents() {
    shadow.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = el.getAttribute('data-act');
        const i = parseInt(el.getAttribute('data-i'), 10);
        const m = state.evaluation && state.evaluation.matches[i];
        if (act === 'collapse') state.collapsed = true;
        else if (act === 'expand') state.collapsed = false;
        else if (act === 'locate' && m) return locate(m);
        else if (act === 'qty' && m) return prepareQuantity(m);
        else if (act === 'fill') return prepareFill();
        else if (act === 'confirm-yes' && state.confirmAction) {
          const run = state.confirmAction.run;
          state.confirmAction = null;
          // 執行前再次確認目前頁面仍允許輔助
          const ok = canAssist();
          if (!ok.ok) return setFlash('頁面狀態已改變，已取消操作：' + ok.reason);
          return run();
        } else if (act === 'confirm-no') {
          state.confirmAction = null;
        } else if (act === 'flash-close') state.flash = '';
        renderPanel();
      });
    });
  }

  // ── 事件監聽 ──────────────────────────────────────────
  let debounceTimer = null;
  function scheduleEvaluate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(evaluate, C.EVALUATE_DEBOUNCE_MS);
  }

  const observer = new MutationObserver((mutations) => {
    // 忽略外掛自己的面板與標示造成的變化
    if (mutations.every((m) => host && (m.target === host || host.contains(m.target)))) return;
    scheduleEvaluate();
  });

  ['keydown', 'mousedown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, (e) => {
      if (host && e.composedPath && e.composedPath().includes(host)) return;
      state.lastUserActivity = Date.now();
    }, true)
  );
  window.addEventListener('online', scheduleEvaluate);
  window.addEventListener('offline', () => {
    state.lastReportKey = '';
    evaluate();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === 'stateChanged') {
      applyState(msg.monitor, msg.profile);
      sendResponse({ ok: true });
    } else if (msg.type === 'canRefresh') {
      sendResponse(canRefresh());
    } else if (msg.type === 'ping') {
      sendResponse({ ok: true, pageType: state.analysis && state.analysis.pageType });
    }
    return false;
  });

  function applyState(monitor, profile) {
    state.monitor = monitor;
    state.profile = profile;
    state.isBound = !!(monitor && monitor.state !== C.MONITOR_STATES.IDLE);
    state.lastReportKey = ''; // 狀態改變後立即重新回報
    if (!state.isBound) {
      state.confirmAction = null;
      state.flash = '';
    }
    evaluate();
  }

  async function init() {
    const navEntry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    const res = await send({ type: 'hello', url: location.href, reloaded: !!(navEntry && navEntry.type === 'reload') });
    if (!res) return; // 無法連線到外掛（例如外掛被停用）
    state.monitor = res.monitor;
    state.profile = res.profile;
    state.isBound = res.isBound;
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(() => {
      if (state.isBound) evaluate();
    }, C.EVALUATE_INTERVAL_MS);
    evaluate();
  }

  init();
})();
