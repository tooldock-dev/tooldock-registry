#!/usr/bin/env node
'use strict';
/**
 * 產生 ToolDock 商店的靜態索引 index.json。
 *
 *   node scripts/build-index.js [--out dist/index.json] [--previous <網址或檔案>] [--name "索引名稱"] [--strict]
 *
 * 環境變數：
 *   GITHUB_TOKEN    建議設定，避免未驗證請求每小時 60 次的 API 限制（Actions 內自動提供）
 *   GITHUB_API_URL  GitHub Enterprise Server 的 API 位址（預設 https://api.github.com；Actions 內自動提供）
 *
 * 對 extensions.json 的每一筆：
 *   1. 讀取 repo 的 Releases（略過 draft / prerelease），由新到舊找第一個「附件齊全」的版本：
 *      tag v<version>，附件 <id>-<version>.tbx、.tbx.sha256、.tbx.sig
 *   2. 下載並驗證：SHA-256 與 .sha256 相符、Ed25519 簽章以 extensions.json 登記的公鑰驗證通過、
 *      套件 package.json 的 id / version 與索引一致。驗證失敗的版本不收錄，改看更舊的版本。
 *   3. 從套件讀出 engine、displayName、description、icon 寫進 latest。
 * 連線失敗（非驗證失敗）且有 --previous 時，沿用上一版索引中該擴充的資料，避免暫時性錯誤讓擴充從商店消失。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateRegistry, loadPublicKey } = require('./lib/registry');
const { readTbxManifest } = require('./lib/zip');

const ROOT = path.join(__dirname, '..');
const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const MAX_TBX = 200 * 1024 * 1024;
const MAX_CANDIDATES = 5; // 每個擴充最多往回驗證幾個附件齊全的版本
const CONCURRENCY = 4;

function parseArgs(argv) {
  const a = { out: path.join(ROOT, 'dist', 'index.json'), previous: null, name: 'ToolDock 擴充索引', strict: false, registry: path.join(ROOT, 'extensions.json') };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = path.resolve(argv[++i]);
    else if (k === '--previous') a.previous = argv[++i];
    else if (k === '--name') a.name = argv[++i];
    else if (k === '--registry') a.registry = path.resolve(argv[++i]);
    else if (k === '--strict') a.strict = true;
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 22).join('\n')); process.exit(0); }
    else throw new Error(`未知的參數 ${k}`);
  }
  return a;
}

/** 連線類錯誤（可沿用上一版）與驗證類錯誤（不可沿用）分開 */
class FetchError extends Error {}

async function request(url, { accept = 'application/vnd.github+json', maxBytes = 5 * 1024 * 1024, auth = true } = {}) {
  const headers = { Accept: accept, 'User-Agent': 'tooldock-registry-build', 'X-GitHub-Api-Version': '2022-11-28' };
  if (TOKEN && auth) headers.Authorization = `Bearer ${TOKEN}`;
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(120000) });
  } catch (err) {
    throw new FetchError(`連線失敗 ${url}：${err.cause ? err.cause.message : err.message}`);
  }
  if (!res.ok) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const hint = res.status === 403 && remaining === '0' ? '（API 次數已用完，請設定 GITHUB_TOKEN）' : '';
    const err = new FetchError(`HTTP ${res.status} ${url}${hint}`);
    err.status = res.status;
    throw err;
  }
  const len = Number(res.headers.get('content-length')) || 0;
  if (len > maxBytes) throw new Error(`檔案過大（${len} bytes）：${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`檔案過大（${buf.length} bytes）：${url}`);
  return buf;
}

const getJson = async (url) => JSON.parse((await request(url)).toString('utf8'));
/** 以 API 下載 Release 附件（私有 repo 也可用 token 讀取；轉址到儲存空間時 fetch 會自動去掉 Authorization） */
const downloadAsset = (asset, maxBytes) => request(asset.url, { accept: 'application/octet-stream', maxBytes });

function iconFrom(zip, base, icon) {
  if (!icon) return null;
  const s = String(icon);
  if (!/[./\\]/.test(s) && s.length <= 8) return s; // emoji
  const rel = `${base}${s.replace(/^\.?\/+/, '')}`;
  const types = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  const type = types[path.extname(rel).toLowerCase()];
  if (!type || !zip.has(rel) || zip.size(rel) > 32 * 1024) return null;
  return `data:${type};base64,${zip.read(rel).toString('base64')}`;
}

/** 驗證單一版本；失敗丟出 Error（驗證類）或 FetchError（連線類） */
async function verifyRelease(entry, release, assets, key) {
  const version = release.tag_name.slice(1);
  const tbx = await downloadAsset(assets.tbx, MAX_TBX);
  const shaText = (await downloadAsset(assets.sha256, 4096)).toString('utf8').trim();
  const sigText = (await downloadAsset(assets.sig, 4096)).toString('utf8').trim();

  const expected = shaText.split(/\s+/)[0].toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('.sha256 內容不是 64 字元的 hex');
  const actual = crypto.createHash('sha256').update(tbx).digest('hex');
  if (actual !== expected) throw new Error(`SHA-256 不符（附件 ${expected.slice(0, 12)}…，實際 ${actual.slice(0, 12)}…）`);

  const sig = Buffer.from(sigText, 'base64');
  if (sig.length !== 64 || !crypto.verify(null, tbx, key, sig)) throw new Error('簽章驗證失敗：不是由 extensions.json 登記的公鑰簽署');

  const { zip, pkg, base } = readTbxManifest(tbx);
  const td = pkg.tooldock || {};
  const pkgId = String(td.id || pkg.name || '').toLowerCase();
  if (pkgId !== entry.id) throw new Error(`套件 id 為「${pkgId}」，與登記的「${entry.id}」不符`);
  if (String(pkg.version) !== version) throw new Error(`套件版本 ${pkg.version} 與 tag ${release.tag_name} 不符`);

  return {
    version,
    tbxUrl: assets.tbx.browser_download_url,
    sha256Url: assets.sha256.browser_download_url,
    sigUrl: assets.sig.browser_download_url,
    sha256: actual,
    publishedAt: release.published_at || release.created_at,
    engine: td.engine || '*',
    displayName: td.displayName || pkg.displayName || entry.id,
    description: td.description || pkg.description || '',
    icon: iconFrom(zip, base, td.icon),
    size: tbx.length,
  };
}

async function buildEntry(entry, prev, log) {
  const key = loadPublicKey(entry.publicKey);
  // 公鑰換了就不能沿用：舊版本是用舊金鑰簽的，商店安裝時會驗證失敗
  const previous = prev && prev.publicKey === entry.publicKey && prev.repo === entry.repo ? prev : null;
  let releases;
  try {
    releases = await getJson(`${API}/repos/${entry.repo}/releases?per_page=30`);
  } catch (err) {
    // 404（repo 被刪除或改名）不沿用，讓擴充從商店下架
    if (err instanceof FetchError && err.status !== 404 && previous) {
      log.warn(`${entry.id}：${err.message}，沿用上一版索引的 v${previous.latest.version}`);
      return { ...previous, ...entry };
    }
    throw err;
  }
  const candidates = releases
    .filter((r) => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+/.test(r.tag_name || ''))
    .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
  let tried = 0;
  let hadFetchError = false;
  for (const release of candidates) {
    const version = release.tag_name.slice(1);
    const name = `${entry.id}-${version}.tbx`;
    const find = (n) => (release.assets || []).find((x) => x.name === n && x.state !== 'starter');
    const assets = { tbx: find(name), sha256: find(`${name}.sha256`), sig: find(`${name}.sig`) };
    const missing = Object.entries(assets).filter(([, v]) => !v).map(([k]) => (k === 'tbx' ? name : `${name}.${k}`));
    if (missing.length) {
      log.info(`${entry.id}：${release.tag_name} 附件不齊全（缺 ${missing.join('、')}），略過`);
      continue;
    }
    if (++tried > MAX_CANDIDATES) break;
    try {
      const latest = await verifyRelease(entry, release, assets, key);
      log.info(`${entry.id}：收錄 v${latest.version}（${release.tag_name}，驗證通過）`);
      return { ...entry, latest };
    } catch (err) {
      if (err instanceof FetchError) hadFetchError = true;
      log.problem(`${entry.id}：${release.tag_name} 未收錄 — ${err.message}`);
    }
  }
  if (hadFetchError && previous) {
    log.warn(`${entry.id}：下載附件時發生連線錯誤，沿用上一版索引的 v${previous.latest.version}`);
    return { ...previous, ...entry };
  }
  log.problem(`${entry.id}：${entry.repo} 沒有附件齊全且驗證通過的正式 Release，本次不收錄`);
  return null;
}

async function loadPrevious(src) {
  if (!src) return new Map();
  try {
    const text = /^https?:\/\//.test(src) ? (await request(src, { accept: 'application/json', auth: false })).toString('utf8') : fs.readFileSync(src, 'utf8');
    const json = JSON.parse(text);
    return new Map((json.extensions || []).filter((e) => e && e.latest).map((e) => [e.id, e]));
  } catch (err) {
    console.warn(`⚠ 無法讀取上一版索引（${src}）：${err.message}，本次不做沿用`);
    return new Map();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const list = JSON.parse(fs.readFileSync(args.registry, 'utf8'));
  const { errors, warnings } = validateRegistry(list);
  warnings.forEach((w) => console.warn(`⚠ ${w}`));
  if (errors.length) {
    errors.forEach((e) => console.error(`✘ ${e}`));
    process.exit(1);
  }
  if (!TOKEN) console.warn('⚠ 未設定 GITHUB_TOKEN：未驗證的 API 請求每小時只有 60 次');

  const previous = await loadPrevious(args.previous);
  const problems = [];
  const log = {
    info: (m) => console.log(`  ${m}`),
    warn: (m) => { console.warn(`⚠ ${m}`); problems.push(m); },
    problem: (m) => { console.warn(`✘ ${m}`); problems.push(m); },
  };

  const results = new Array(list.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      try {
        results[i] = await buildEntry(list[i], previous.get(list[i].id), log);
      } catch (err) {
        log.problem(`${list[i].id}：${err.message}`);
      }
    }
  }));

  const extensions = results.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  const index = { schemaVersion: 1, name: args.name, generatedAt: new Date().toISOString(), extensions };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`\n已產生 ${args.out}：收錄 ${extensions.length}/${list.length} 個擴充${problems.length ? `，${problems.length} 個問題` : ''}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = extensions.map((e) => `| \`${e.id}\` | ${e.latest.version} | ${e.publisher}${e.verified ? ' ✔' : ''} | ${e.repo} |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `## 索引：收錄 ${extensions.length}/${list.length} 個擴充`, '',
      '| id | 版本 | 發佈者 | repo |', '|---|---|---|---|', ...rows, '',
      ...(problems.length ? ['### 問題', '', ...problems.map((p) => `- ${p}`), ''] : []),
    ].join('\n'));
  }
  if (args.strict && problems.length) process.exit(1);
}

main().catch((err) => {
  console.error(`✘ ${err.stack || err.message}`);
  process.exit(1);
});
