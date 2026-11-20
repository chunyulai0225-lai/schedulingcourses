/*
 * popup.js — 外掛主畫面
 * 只負責顯示狀態與送出指令；所有實際動作都由 background.js 執行。
 */
'use strict';

const C = window.TP_CONFIG;
const L = window.TP_LABELS;
const $ = (id) => document.getElementById(id);

function send(type, extra) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(Object.assign({ type }, extra || {}), (res) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(res || { ok: false, error: '沒有回應' });
    });
  });
}

function showMsg(text, kind) {
  const el = $('msg');
  el.textContent = text || '';
  el.className = 'msg ' + (kind || '');
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-TW', { hour12: false });
}

function countdown(profile) {
  const ts = window.TPStorage.saleTimestamp(profile);
  if (!ts) return '未設定';
  const diff = ts - Date.now();
  const base = `${profile.saleDate} ${profile.saleTime}`;
  if (diff <= 0) return `${base}（已開賣）`;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${base}（倒數 ${d ? d + ' 天 ' : ''}${h} 時 ${m} 分 ${s} 秒）`;
}

const ATTENTION_TEXT = {
  captcha: ['bad', '🔐 頁面出現驗證碼，請親自完成驗證。'],
  verification: ['bad', '🔐 頁面要求身分／簡訊驗證，請親自完成。'],
  queue: ['warn', '⏳ 排隊中：請保持頁面開啟、不要重新整理。'],
  login: ['warn', '🔑 請在頁面上親自登入會員。'],
  checkout: ['ok', '✅ 已進入訂單確認頁：請親自檢查並完成付款。外掛已停止所有操作。'],
  error: ['bad', '⚠️ 網頁錯誤，外掛已停止操作，請手動檢查。'],
  timeout: ['bad', '⌛ 購票頁面逾時，請依官方指示重新操作。'],
  unknown: ['bad', '❓ 無法辨識目前頁面，外掛不會進行任何操作。'],
  offline: ['bad', '📡 網路中斷，恢復後會自動重新偵測。'],
  tabClosed: ['warn', '📄 活動頁面已關閉，監控已暫停。']
};

let current = null;

function render(data) {
  current = data;
  const { monitor, profile, profiles } = data;
  $('empty').hidden = !!profiles.length;
  $('main').hidden = !profiles.length;
  if (!profiles.length) return;

  // 設定切換
  const sel = $('profileSelect');
  const opts = profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if (sel.dataset.html !== opts) {
    sel.innerHTML = opts;
    sel.dataset.html = opts;
  }
  if (profile) sel.value = profile.id;

  if (profile) {
    $('pName').textContent = profile.name;
    $('pUrl').textContent = profile.eventUrl || '尚未設定（請到設定頁填寫）';
    $('pSale').textContent = countdown(profile);
    $('pSession').textContent = profile.sessionKeyword || '不指定（任何場次）';
    const types = profile.ticketTypesPrimary.join('、') || '不指定';
    $('pTypes').textContent = profile.ticketTypesBackup.length ? `${types}（備選：${profile.ticketTypesBackup.join('、')}）` : types;
    const areas = profile.areas.filter(Boolean);
    $('pAreas').textContent = (areas.length ? areas.join(' ＞ ') : '不指定') + (profile.allowOtherAreas ? '（可提示其他區域）' : '');
    $('pQty').textContent = `${profile.quantity} 張`;
    $('pMode').textContent = profile.mode === 'assist' ? '輔助模式（每個動作需您確認）' : '純監控模式（只讀取與通知）';
  }

  // 監控狀態
  const st = monitor.state;
  const chip = $('mState');
  chip.textContent = L.monitorState[st] || st;
  chip.className = 'chip ' + (st === 'monitoring' ? 'ok' : st === 'paused' ? 'warn' : 'mute');

  const att = monitor.state !== 'idle' && monitor.attention && ATTENTION_TEXT[monitor.attention];
  $('attention').hidden = !att;
  if (att) {
    $('attention').className = 'alert ' + att[0];
    $('attention').textContent = att[1];
  }
  $('mPage').textContent = monitor.pageType ? L.pageType[monitor.pageType] || monitor.pageType : '—';
  $('mSale').textContent = monitor.saleStatus ? L.saleStatus[monitor.saleStatus] || monitor.saleStatus : '—';
  $('mTime').textContent = fmtTime(monitor.lastDetectedAt);
  $('mSummary').textContent = monitor.summary || '';
  const ul = $('mMatches');
  ul.innerHTML = '';
  if (monitor.state !== 'idle') {
    (monitor.matches || []).slice(0, 5).forEach((m) => {
      const li = document.createElement('li');
      li.textContent = `✔ ${m.label}${m.reason ? '（' + m.reason + '）' : ''}`;
      ul.appendChild(li);
    });
  }

  // 按鈕狀態
  $('btnStart').textContent = st === 'paused' ? '▶ 繼續監控' : '▶ 開始監控';
  $('btnStart').disabled = st === 'monitoring';
  $('btnPause').disabled = st !== 'monitoring';
  $('btnStop').disabled = st === 'idle';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function refresh() {
  const res = await send('getStatus');
  if (res.ok) render(res.data);
  else showMsg(res.error, 'err');
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

async function onAction(act) {
  showMsg('');
  let res;
  switch (act) {
    case 'start': {
      const settings = await window.TPStorage.getSettings();
      if (!settings.disclaimerAccepted) {
        showMsg('請先在設定頁閱讀並同意使用須知。', 'err');
        chrome.runtime.openOptionsPage();
        return;
      }
      res = current && current.monitor.state === 'paused' ? await send('resume') : await send('start', { tabId: await activeTabId() });
      if (res.ok) showMsg('已開始監控。外掛會在活動頁面右下角顯示狀態面板。', 'ok');
      break;
    }
    case 'pause':
      res = await send('pause');
      if (res.ok) showMsg('已暫停監控。', 'ok');
      break;
    case 'stop':
      res = await send('stop');
      if (res.ok) showMsg('已停止監控。', 'ok');
      break;
    case 'openEvent':
      res = await send('openEvent');
      break;
    case 'options':
      chrome.runtime.openOptionsPage();
      return;
    case 'logs':
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html#logs') });
      return;
    default:
      return;
  }
  if (res && !res.ok) showMsg(res.error, 'err');
  refresh();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn && !btn.disabled) onAction(btn.getAttribute('data-act'));
});

$('profileSelect').addEventListener('change', async (e) => {
  const res = await send('setActiveProfile', { id: e.target.value });
  if (!res.ok) showMsg(res.error, 'err');
  refresh();
});

chrome.storage.onChanged.addListener(() => refresh());
setInterval(() => current && current.profile && ($('pSale').textContent = countdown(current.profile)), 1000);
refresh();
