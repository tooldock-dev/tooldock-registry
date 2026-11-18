'use strict';
/** extensions.json 的驗證規則（與 schema/extensions.schema.json 一致，另外實際載入公鑰確認是 Ed25519） */
const crypto = require('crypto');

const ID_RE = /^[a-z0-9][a-z0-9.-]{0,62}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const KEYS = ['id', 'repo', 'publisher', 'publicKey', 'verified'];

function loadPublicKey(b64) {
  const key = crypto.createPublicKey({ key: Buffer.from(String(b64), 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`不是 Ed25519 公鑰（${key.asymmetricKeyType}）`);
  return key;
}

function validateRegistry(list) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(list)) return { errors: ['extensions.json 必須是陣列'], warnings };
  const ids = new Map();
  const repos = new Map();
  list.forEach((e, i) => {
    const where = `第 ${i + 1} 筆${e && e.id ? `（${e.id}）` : ''}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`${where}：必須是物件`); return; }
    for (const k of Object.keys(e)) if (!KEYS.includes(k)) errors.push(`${where}：不允許的欄位「${k}」`);
    for (const k of KEYS) if (e[k] === undefined) errors.push(`${where}：缺少「${k}」`);
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) errors.push(`${where}：id 只能是小寫英數、點與連字號，且以英數開頭（最長 63 字）`);
    else if (ids.has(e.id)) errors.push(`${where}：id 與第 ${ids.get(e.id) + 1} 筆重複`);
    else ids.set(e.id, i);
    if (typeof e.repo !== 'string' || !REPO_RE.test(e.repo)) errors.push(`${where}：repo 格式應為 owner/name`);
    else if (repos.has(e.repo.toLowerCase())) warnings.push(`${where}：repo 與第 ${repos.get(e.repo.toLowerCase()) + 1} 筆相同（同一個 repo 發佈多個擴充時，Release 附件名稱會以 id 區分）`);
    else repos.set(e.repo.toLowerCase(), i);
    if (typeof e.publisher !== 'string' || !e.publisher.trim() || e.publisher.length > 100) errors.push(`${where}：publisher 必須是 1–100 字的字串`);
    if (typeof e.verified !== 'boolean') errors.push(`${where}：verified 必須是 true 或 false`);
    if (typeof e.publicKey !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.publicKey)) {
      errors.push(`${where}：publicKey 必須是 base64 字串`);
    } else {
      try { loadPublicKey(e.publicKey); } catch (err) { errors.push(`${where}：publicKey 無法載入為 Ed25519 SPKI 公鑰：${err.message}`); }
    }
  });
  return { errors, warnings };
}

module.exports = { ID_RE, REPO_RE, loadPublicKey, validateRegistry };
