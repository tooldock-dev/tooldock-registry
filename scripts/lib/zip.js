'use strict';
/**
 * 極簡 zip 讀取器（不需安裝套件）：只用來從 .tbx 讀出 package.json 與圖示。
 * 支援 stored / deflate；不支援 zip64 與加密。
 */
const zlib = require('zlib');

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

function openZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到中央目錄）');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('不支援 zip64');
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 中央目錄損毀');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
    entries.set(name, { name, flags, method, csize, usize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    size: (name) => (entries.get(name) || {}).usize,
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.flags & 1) throw new Error(`${name} 已加密`);
      if (e.usize > MAX_ENTRY_BYTES) throw new Error(`${name} 過大`);
      const lo = e.localOffset;
      if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error(`${name} 本機標頭損毀`);
      const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      throw new Error(`${name} 使用不支援的壓縮方式 ${e.method}`);
    },
  };
}

/** package.json 可在根目錄，或在唯一一層子資料夾內（與 ToolDock 安裝規則相同）；回傳 { pkg, base } */
function readTbxManifest(buf) {
  const zip = openZip(buf);
  const names = zip.names();
  const name = names.find((n) => n === 'package.json') || names.find((n) => /^[^/]+\/package\.json$/.test(n));
  if (!name) throw new Error('套件內找不到 package.json');
  const pkg = JSON.parse(zip.read(name).toString('utf8'));
  return { zip, pkg, base: name.slice(0, -'package.json'.length) };
}

module.exports = { openZip, readTbxManifest };
