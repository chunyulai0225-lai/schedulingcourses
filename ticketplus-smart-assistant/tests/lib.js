'use strict';
// 極簡測試框架（不需要安裝任何套件）
const results = [];
let current = '';
function section(name) { current = name; console.log(`\n■ ${name}`); }
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ section: current, name, ok: true, ms: Date.now() - t0 }); console.log(`  ✔ ${name}`); }
  catch (e) { results.push({ section: current, name, ok: false, error: e.message, ms: Date.now() - t0 }); console.log(`  ✘ ${name}\n      → ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} 預期 ${JSON.stringify(b)}，實際 ${JSON.stringify(a)}`); }
async function waitFor(fn, { timeout = 8000, interval = 100, msg = '等待逾時' } = {}) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, interval)); }
  throw new Error(`${msg}（最後結果：${last instanceof Error ? last.message : JSON.stringify(last)}）`);
}
function summary() {
  const pass = results.filter((r) => r.ok).length; const fail = results.length - pass;
  console.log(`\n共 ${results.length} 項，通過 ${pass}，失敗 ${fail}`);
  return { pass, fail, results };
}
module.exports = { section, test, assert, eq, waitFor, summary, results };
