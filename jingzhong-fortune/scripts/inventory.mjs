#!/usr/bin/env node
// 第一階段資料盤點工具：檢查籤詩資料檔與圖片檔，輸出錯誤／警告清單。
// 用法：node scripts/inventory.mjs [資料檔] [圖片資料夾]
//   預設：data/fortunes.json（不存在時改用 data/fortunes.template.json）、data/images
// 有錯誤時結束碼為 1，不會靜默略過任何問題。

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOTAL = 58;
const ACROSTIC_COUNT = 56;
const pad = (n) => String(n).padStart(3, '0');

const dataPath = process.argv[2]
  ?? (existsSync(join(ROOT, 'data/fortunes.json')) ? join(ROOT, 'data/fortunes.json') : join(ROOT, 'data/fortunes.template.json'));
const imageDir = process.argv[3] ?? join(ROOT, 'data/images');
const checksumPath = join(ROOT, 'data/poem_checksums.json');

const REQUIRED_FIELDS = [
  'fortune_number', 'title', 'acrostic_character',
  'poem_line_1', 'poem_line_2', 'poem_line_3', 'poem_line_4',
  'representative_person', 'story_title', 'story_background',
  'line_explanation_1', 'line_explanation_2', 'line_explanation_3', 'line_explanation_4',
  'full_interpretation', 'fortune_grade', 'yijing_hexagram',
  'source_reference', 'editorial_note', 'front_image_url', 'is_active', 'is_drawable',
];
const POEM_KEYS = ['poem_line_1', 'poem_line_2', 'poem_line_3', 'poem_line_4'];

// 常見「僅簡體」字（繁體中不會出現）。只作為警示，最終以人工比對論文為準。
const SIMPLIFIED_ONLY = new Set([...'们这为说时来对会过还么发经问进长门马龙东车书见观关开无与处应战义乐乡买卖卫师归岁华亲认让记许论话语读谁调财贵转运远选钱铁银错阳阴阵际难顺须风飞饭鸟鱼黄齐广庙学宝实宁兴传业丰临丽举乌习乱争亚产亩亿仅从仓优伟伤伦伪侠侣俭债倾偿储兑党兰养兽内冈写军农冯冻击凿刘则刚创删别刮制刹剂剑剧劝办务动励劲劳势勋匀协单卢却厅历厉压厌厕厢厦县参双变叙叠叹吓吗启吴呐员呜咏响哑唤啸喷团园围图圆圣场坏块坚坛坟坠垄垒垦垫埘']);

const errors = [];
const warnings = [];
const infos = [];
const err = (n, msg) => errors.push(n ? `第 ${n} 首：${msg}` : msg);
const warn = (n, msg) => warnings.push(n ? `第 ${n} 首：${msg}` : msg);

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const poemHash = (f) => createHash('sha256').update(POEM_KEYS.map((k) => f[k] ?? '').join('\n'), 'utf8').digest('hex');

// ---------- 1. 資料檔 ----------
let fortunes = [];
if (!existsSync(dataPath)) {
  err(null, `找不到資料檔：${dataPath}`);
} else {
  try {
    fortunes = JSON.parse(readFileSync(dataPath, 'utf8'));
    if (!Array.isArray(fortunes)) throw new Error('最外層必須是陣列');
  } catch (e) {
    err(null, `資料檔無法解析：${e.message}`);
    fortunes = [];
  }
}
infos.push(`資料檔：${dataPath}（${fortunes.length} 筆）`);

const seen = new Map();
for (const f of fortunes) {
  const n = f.fortune_number;
  if (!Number.isInteger(n) || n < 1 || n > TOTAL) {
    err(null, `籤號不合法：${JSON.stringify(n)}（必須是 1～${TOTAL} 的整數）`);
    continue;
  }
  if (seen.has(n)) err(n, '籤號重複');
  seen.set(n, f);
}
for (let n = 1; n <= TOTAL; n++) if (!seen.has(n)) err(n, '缺少此籤資料');
if (fortunes.length !== TOTAL) err(null, `資料筆數為 ${fortunes.length}，應為 ${TOTAL}`);

let checksums = null;
if (existsSync(checksumPath)) checksums = JSON.parse(readFileSync(checksumPath, 'utf8'));
else infos.push('尚未建立原詩校驗基準（data/poem_checksums.json）；原詩經人工確認後執行 --lock 建立。');

const missingCounts = {};
const bump = (k) => (missingCounts[k] = (missingCounts[k] ?? 0) + 1);

for (const [n, f] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
  const special = n > ACROSTIC_COUNT;
  for (const k of REQUIRED_FIELDS) if (!(k in f)) err(n, `缺少欄位 ${k}`);

  // 原詩缺句（第 57、58 首行數尚待廟方確認，先列為警告）
  POEM_KEYS.forEach((k, i) => {
    if (isBlank(f[k])) {
      bump('原詩（句數）');
      (special ? warn : err)(n, `原詩第 ${i + 1} 句空白${special ? '（特殊籤行數待確認）' : ''}`);
    }
  });
  if (isBlank(f.representative_person)) { bump('代表人物'); (special ? warn : err)(n, '代表人物缺漏'); }
  if (isBlank(f.title)) { bump('籤名'); warn(n, '籤名空白'); }
  for (const [k, label] of [['story_title', '卦頭故事'], ['story_background', '故事背景'], ['full_interpretation', '完整籤意'], ['fortune_grade', '吉凶籤別'], ['yijing_hexagram', '易經卦象'], ['source_reference', '參考資料']]) {
    if (isBlank(f[k])) bump(label);
  }
  [1, 2, 3, 4].forEach((i) => isBlank(f[`line_explanation_${i}`]) && bump('逐句解釋'));

  // 藏頭字應與第一句首字一致（規則待確認，先列警告）
  if (!special && !isBlank(f.acrostic_character) && !isBlank(f.poem_line_1)
      && [...f.poem_line_1.trim()][0] !== f.acrostic_character.trim()) {
    warn(n, `藏頭字「${f.acrostic_character}」與第一句首字「${[...f.poem_line_1.trim()][0]}」不同，請確認`);
  }
  if (!special && isBlank(f.acrostic_character)) bump('藏頭字');

  // 簡體字警示
  const text = POEM_KEYS.map((k) => f[k] ?? '').join('');
  const simp = [...new Set([...text].filter((c) => SIMPLIFIED_ONLY.has(c)))];
  if (simp.length) warn(n, `原詩疑似含簡體字：${simp.join('、')}`);

  // 原詩是否被改動
  if (checksums && checksums[n] && checksums[n] !== poemHash(f)) err(n, '原詩文字與已確認版本不一致（可能遭修改）');

  if (f.is_drawable === false) warn(n, '未納入抽籤池（is_drawable = false）；預設應 58 首全部可抽');
  if (f.is_active === false) warn(n, '已停用（is_active = false）');
  if (/待確認/.test(JSON.stringify(f))) infos.push(`第 ${n} 首：含「待確認」標記`);
  if (f.review_status && f.review_status !== 'approved' && !isBlank(f.full_interpretation)) {
    warn(n, `解說尚未經人工確認（review_status = ${f.review_status}），不可公開`);
  }
}

// ---------- 2. 圖片 ----------
const pngSize = (buf) => {
  const sig = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== sig) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};
const expected = [...Array.from({ length: TOTAL }, (_, i) => `${pad(i + 1)}.png`), 'back.png'];
const imageReport = [];
if (!existsSync(imageDir)) {
  err(null, `找不到圖片資料夾：${imageDir}`);
} else {
  const files = readdirSync(imageDir).filter((f) => !f.startsWith('.') && f !== 'README.md');
  const sizes = new Map();
  for (const name of expected) {
    if (!files.includes(name)) {
      // 大小寫不同也提示
      const ci = files.find((f) => f.toLowerCase() === name);
      if (ci) warn(null, `圖片檔名大小寫不符：${ci}（應為 ${name}）`);
      else (name === 'back.png' ? err : warn)(null, `缺少圖片 ${name}`);
      imageReport.push([name, '缺少']);
      continue;
    }
    const size = pngSize(readFileSync(join(imageDir, name)));
    if (!size) { err(null, `${name} 不是有效的 PNG 檔`); imageReport.push([name, '格式錯誤']); continue; }
    const key = `${size.w}×${size.h}`;
    if (name !== 'back.png') sizes.set(key, [...(sizes.get(key) ?? []), name]);
    imageReport.push([name, key]);
  }
  if (sizes.size > 1) warn(null, `正面圖片尺寸不一致：${[...sizes].map(([k, v]) => `${k}（${v.length} 張）`).join('；')}`);
  const extras = files.filter((f) => !expected.includes(f));
  if (extras.length) warn(null, `圖片資料夾中有未對應的檔案：${extras.join('、')}`);
}
const presentImages = imageReport.filter(([, s]) => s !== '缺少').length;
infos.push(`圖片：${presentImages} / ${expected.length} 個檔案存在（${imageDir}）`);

// ---------- 3. 選項：鎖定原詩校驗基準 ----------
if (process.argv.includes('--lock')) {
  if (errors.length) {
    console.error('仍有錯誤，拒絕建立原詩校驗基準。');
  } else {
    const out = Object.fromEntries([...seen].map(([n, f]) => [n, poemHash(f)]));
    writeFileSync(checksumPath, JSON.stringify(out, null, 2) + '\n');
    infos.push(`已建立原詩校驗基準：${checksumPath}`);
  }
}

// ---------- 輸出 ----------
const lines = [
  `# 資料盤點報告`,
  ``,
  `產生時間：${new Date().toISOString()}`,
  ``,
  `## 摘要`,
  ...infos.map((s) => `- ${s}`),
  `- 錯誤：${errors.length} 項；警告：${warnings.length} 項`,
  ``,
  `## 欄位缺漏統計（58 首中空白的筆數）`,
  ...(Object.keys(missingCounts).length ? Object.entries(missingCounts).map(([k, v]) => `- ${k}：${v}`) : ['- 無']),
  ``,
  `## 錯誤（必須修正）`,
  ...(errors.length ? errors.map((s) => `- ${s}`) : ['- 無']),
  ``,
  `## 警告（需人工確認）`,
  ...(warnings.length ? warnings.map((s) => `- ${s}`) : ['- 無']),
  ``,
  `## 圖片清單`,
  `| 檔名 | 狀態 |`,
  `| --- | --- |`,
  ...imageReport.map(([n, s]) => `| ${n} | ${s} |`),
  ``,
];
mkdirSync(join(ROOT, 'reports'), { recursive: true });
const reportPath = join(ROOT, 'reports/inventory-latest.md');
writeFileSync(reportPath, lines.join('\n'));
console.log(lines.slice(0, 14).join('\n'));
console.log(`\n完整報告：${reportPath}`);
process.exit(errors.length ? 1 : 0);
