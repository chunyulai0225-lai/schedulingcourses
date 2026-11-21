/*
 * options.js — 購票偏好設定頁
 */
'use strict';

const C = window.TP_CONFIG;
const S = window.TPStorage;
const $ = (id) => document.getElementById(id);

let profiles = [];
let activeId = null;
let selectedId = null;

// ── 共用 ─────────────────────────────────────────────
function send(type, extra) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(Object.assign({ type }, extra || {}), (res) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(res || { ok: false });
    });
  });
}

let toastTimer = null;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 分頁切換 ──────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  if (name === 'logs') renderLogs();
  if (name === 'data') renderStats();
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ── 下拉選單選項 ────────────────────────────────────────
function fillSelects() {
  const f = $('profileForm');
  f.quantity.innerHTML = Array.from({ length: C.MAX_TICKETS }, (_, i) => `<option value="${i + 1}">${i + 1} 張</option>`).join('');
  f.remindMinutes.innerHTML = C.REMIND_CHOICES.map((m) => `<option value="${m}">${m === 0 ? '不提醒' : `開賣前 ${m} 分鐘`}</option>`).join('');
  f.refreshSec.innerHTML = C.REFRESH_CHOICES.map((s) => `<option value="${s}">每 ${s >= 60 ? s / 60 + ' 分鐘' : s + ' 秒'}</option>`).join('');
}

// ── 活動設定列表 ────────────────────────────────────────
async function loadProfiles() {
  profiles = await S.getProfiles();
  activeId = await S.getActiveProfileId();
  if (!selectedId || !profiles.some((p) => p.id === selectedId)) {
    selectedId = activeId && profiles.some((p) => p.id === activeId) ? activeId : profiles[0] ? profiles[0].id : null;
  }
  renderList();
  if (selectedId) fillForm(profiles.find((p) => p.id === selectedId));
  else fillForm(S.defaultProfile(), true);
}

function renderList() {
  const ul = $('profileList');
  if (!profiles.length) {
    ul.innerHTML = '<li class="hint" style="cursor:default">尚未建立任何設定</li>';
    return;
  }
  ul.innerHTML = profiles
    .map((p) => {
      const sale = p.saleDate ? `${p.saleDate} ${p.saleTime || ''}` : '未設定開賣時間';
      return `<li data-id="${p.id}" class="${p.id === selectedId ? 'selected' : ''}">
        <span class="nm">${esc(p.name)}</span>
        <span class="meta">${esc(sale)}｜${p.quantity} 張</span>
        ${p.id === activeId ? '<span class="star">⭐ 目前使用中</span>' : ''}
      </li>`;
    })
    .join('');
  ul.querySelectorAll('li[data-id]').forEach((li) =>
    li.addEventListener('click', () => {
      selectedId = li.dataset.id;
      renderList();
      fillForm(profiles.find((p) => p.id === selectedId));
    })
  );
}

function fillForm(p, isNew) {
  const f = $('profileForm');
  f.id.value = isNew ? '' : p.id;
  f.name.value = isNew ? '' : p.name;
  f.eventUrl.value = p.eventUrl;
  f.saleDate.value = p.saleDate;
  f.saleTime.value = p.saleTime;
  f.sessionKeyword.value = p.sessionKeyword;
  f.ticketTypesPrimary.value = p.ticketTypesPrimary.join(', ');
  f.ticketTypesBackup.value = p.ticketTypesBackup.join(', ');
  [0, 1, 2].forEach((i) => (f['area' + i].value = p.areas[i] || ''));
  f.quantity.value = String(p.quantity);
  f.allowOtherAreas.checked = p.allowOtherAreas;
  f.quickKey.checked = p.quickKey !== false;
  f.querySelector(`input[name=mode][value=${p.mode}]`).checked = true;
  f.notifyDesktop.checked = p.notify.desktop;
  f.notifySound.checked = p.notify.sound;
  f.notifyStatusChange.checked = p.notify.statusChange;
  f.remindMinutes.value = String(C.REMIND_CHOICES.includes(p.notify.remindMinutes) ? p.notify.remindMinutes : 5);
  f.refreshEnabled.checked = p.refresh.enabled;
  f.refreshSec.value = String(C.REFRESH_CHOICES.includes(p.refresh.intervalSec) ? p.refresh.intervalSec : 60);
  f.refreshAck.checked = p.refresh.acknowledged;
  $('formTitle').textContent = isNew ? '新增活動設定' : '編輯活動設定';
  $('activeBadge').hidden = isNew || p.id !== activeId;
  ['btnActivate', 'btnDuplicate', 'btnDelete'].forEach((id) => ($(id).disabled = !!isNew));
  $('btnActivate').disabled = isNew || p.id === activeId;
  $('formErrors').hidden = true;
}

function readForm() {
  const f = $('profileForm');
  return {
    id: f.id.value || undefined,
    name: f.name.value,
    eventUrl: f.eventUrl.value,
    saleDate: f.saleDate.value,
    saleTime: f.saleTime.value,
    sessionKeyword: f.sessionKeyword.value,
    ticketTypesPrimary: f.ticketTypesPrimary.value,
    ticketTypesBackup: f.ticketTypesBackup.value,
    areas: [f.area0.value, f.area1.value, f.area2.value].map((s) => s.trim()),
    quantity: f.quantity.value,
    allowOtherAreas: f.allowOtherAreas.checked,
    quickKey: f.quickKey.checked,
    mode: f.querySelector('input[name=mode]:checked').value,
    notify: {
      desktop: f.notifyDesktop.checked,
      sound: f.notifySound.checked,
      statusChange: f.notifyStatusChange.checked,
      remindMinutes: f.remindMinutes.value
    },
    refresh: {
      enabled: f.refreshEnabled.checked,
      intervalSec: f.refreshSec.value,
      acknowledged: f.refreshAck.checked
    }
  };
}

// toList 會把字串拆開；areas 需要保留空白位置（第一／二／三優先），所以另外處理
function normalizeAreas(input) {
  const a = input.areas.slice(0, 3);
  return Object.assign({}, input, { areas: a.map((s) => s || '') });
}

$('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = normalizeAreas(readForm());
  try {
    const existing = data.id ? profiles.find((p) => p.id === data.id) : null;
    if (existing) data.createdAt = existing.createdAt;
    const saved = await S.saveProfile(data);
    selectedId = saved.id;
    await send('profilesChanged');
    await loadProfiles();
    toast('✅ 已儲存「' + saved.name + '」');
  } catch (err) {
    $('formErrors').textContent = err.message;
    $('formErrors').hidden = false;
    toast('請修正設定中的問題', true);
  }
});

$('btnNew').addEventListener('click', () => {
  selectedId = null;
  renderList();
  fillForm(S.defaultProfile(), true);
  $('profileForm').name.focus();
});

$('btnActivate').addEventListener('click', async () => {
  const id = $('profileForm').id.value;
  if (!id) return;
  const res = await send('setActiveProfile', { id });
  if (!res.ok) return toast(res.error, true);
  await loadProfiles();
  toast('⭐ 已設為目前使用的活動設定');
});

$('btnDuplicate').addEventListener('click', async () => {
  const id = $('profileForm').id.value;
  const p = profiles.find((x) => x.id === id);
  if (!p) return;
  const copy = Object.assign({}, p, { id: undefined, name: (p.name + '（副本）').slice(0, 60), createdAt: undefined });
  try {
    const saved = await S.saveProfile(copy);
    selectedId = saved.id;
    await loadProfiles();
    toast('📄 已複製設定');
  } catch (err) {
    toast(err.message, true);
  }
});

$('btnDelete').addEventListener('click', async () => {
  const id = $('profileForm').id.value;
  const p = profiles.find((x) => x.id === id);
  if (!p || !confirm(`確定要刪除「${p.name}」嗎？此動作無法復原。`)) return;
  const monitor = await S.getMonitor();
  if (monitor.state !== 'idle' && monitor.profileId === id) await send('stop');
  await S.deleteProfile(id);
  selectedId = null;
  await send('profilesChanged');
  await loadProfiles();
  toast('已刪除設定');
});

$('btnTestNotify').addEventListener('click', async () => {
  const res = await send('testNotification');
  toast(res.ok ? '🔔 已送出測試通知（請確認電腦的通知權限已開啟）' : '測試失敗：' + res.error, !res.ok);
});

// 勾選自動刷新時提醒閱讀說明
$('profileForm').refreshEnabled.addEventListener('change', (e) => {
  if (e.target.checked && !$('profileForm').refreshAck.checked) {
    toast('請閱讀刷新說明，並勾選「我已了解並會遵守售票網站規範」');
  }
});

// ── 購票資料 ──────────────────────────────────────────
async function loadPersonal() {
  const p = await S.getPersonal();
  const f = $('personalForm');
  f.name.value = p.name;
  f.phone.value = p.phone;
  f.email.value = p.email;
  f.saveConsent.checked = p.saveConsent;
}

$('personalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = $('personalForm');
  const data = { name: f.name.value, phone: f.phone.value, email: f.email.value, saveConsent: f.saveConsent.checked };
  try {
    if (!data.saveConsent && (data.name || data.phone || data.email)) {
      if (!confirm('您沒有勾選同意儲存，資料將不會被保存。要繼續嗎？')) return;
    }
    await S.savePersonal(data);
    $('personalErrors').hidden = true;
    await loadPersonal();
    toast(data.saveConsent ? '✅ 購票資料已儲存在本機' : '已清除（未同意儲存）');
  } catch (err) {
    $('personalErrors').textContent = err.message;
    $('personalErrors').hidden = false;
  }
});

$('btnClearPersonal').addEventListener('click', async () => {
  if (!confirm('確定要清除已儲存的購票資料（姓名、手機、Email）嗎？')) return;
  await S.clearPersonal();
  await loadPersonal();
  toast('已清除購票資料');
});

// ── 監控紀錄 ──────────────────────────────────────────
const LEVEL_TEXT = { info: '資訊', success: '成功', warn: '警告', error: '錯誤', notify: '通知' };

async function renderLogs() {
  const filter = $('logFilter').value;
  const logs = (await S.getLogs()).filter((l) => !filter || l.level === filter).reverse();
  $('logBody').innerHTML = logs
    .map(
      (l) => `<tr>
      <td>${esc(new Date(l.t).toLocaleString('zh-TW', { hour12: false }))}</td>
      <td><span class="lv lv-${esc(l.level)}">${esc(LEVEL_TEXT[l.level] || l.level)}</span></td>
      <td>${esc(l.message)}</td>
      <td>${esc(l.detail)}</td></tr>`
    )
    .join('');
  $('logEmpty').hidden = logs.length > 0;
}
$('logFilter').addEventListener('change', renderLogs);
$('btnClearLogs').addEventListener('click', async () => {
  if (!confirm('確定要清除所有監控紀錄嗎？')) return;
  await S.clearLogs();
  renderLogs();
});

// ── 資料管理 ──────────────────────────────────────────
async function renderStats() {
  $('statProfiles').textContent = (await S.getProfiles()).length;
  const p = await S.getPersonal();
  $('statPersonal').textContent = p.saveConsent ? '已儲存' : '未儲存';
  $('statLogs').textContent = (await S.getLogs()).length;
}

$('btnClearAll').addEventListener('click', async () => {
  if (!confirm('確定要清除「所有」資料嗎？\n包含活動設定、購票資料、監控紀錄，且無法復原。')) return;
  const res = await send('clearAll');
  if (!res.ok) return toast(res.error, true);
  selectedId = null;
  await loadProfiles();
  await loadPersonal();
  await renderStats();
  toast('已清除所有資料');
  checkDisclaimer();
});

// ── 首次使用須知 ────────────────────────────────────────
async function checkDisclaimer() {
  const s = await S.getSettings();
  $('disclaimer').hidden = s.disclaimerAccepted;
}
$('dAgree').addEventListener('change', (e) => ($('dOk').disabled = !e.target.checked));
$('dOk').addEventListener('click', async () => {
  await S.saveSettings({ disclaimerAccepted: true });
  $('disclaimer').hidden = true;
});

// ── 即時更新 ──────────────────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes[C.STORAGE_KEYS.LOGS] && !$('tab-logs').hidden) renderLogs();
  if (changes[C.STORAGE_KEYS.ACTIVE_PROFILE_ID]) loadProfiles();
});

// ── 初始化 ───────────────────────────────────────────
(async function init() {
  fillSelects();
  await loadProfiles();
  await loadPersonal();
  await checkDisclaimer();
  const hash = location.hash.replace('#', '');
  showTab(['profiles', 'personal', 'logs', 'help', 'data'].includes(hash) ? hash : 'profiles');
})();
