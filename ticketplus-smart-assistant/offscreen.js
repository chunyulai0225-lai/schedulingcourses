/*
 * offscreen.js — 只負責播放提示音（以 Web Audio 合成，不需要音效檔）。
 */
'use strict';

let ctx = null;

function tone(freq, start, duration, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

function play(kind) {
  if (!ctx) ctx = new AudioContext();
  if (kind === 'alert') {
    // 三連音：較緊急
    [0, 0.22, 0.44].forEach((t) => tone(1046, t, 0.18, 0.35));
    tone(1318, 0.66, 0.4, 0.35);
  } else {
    // 雙音：一般提醒
    tone(880, 0, 0.25, 0.25);
    tone(1175, 0.25, 0.35, 0.25);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  if (msg.type === 'playSound') {
    try {
      play(msg.kind);
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  }
  return false;
});
