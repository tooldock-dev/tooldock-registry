#!/usr/bin/env node
'use strict';
/** 檢查 extensions.json：node scripts/validate.js [檔案]（PR 審核時由 workflow 執行） */
const fs = require('fs');
const path = require('path');
const { validateRegistry } = require('./lib/registry');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'extensions.json'));
let list;
try {
  list = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`✘ 無法讀取 ${file}：${err.message}`);
  process.exit(1);
}
const { errors, warnings } = validateRegistry(list);
warnings.forEach((w) => console.warn(`⚠ ${w}`));
if (errors.length) {
  errors.forEach((e) => console.error(`✘ ${e}`));
  console.error(`\n${errors.length} 個錯誤`);
  process.exit(1);
}
console.log(`✔ ${path.basename(file)} 格式正確（${list.length} 個擴充）`);
