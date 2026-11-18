# ToolDock 擴充索引

ToolDock 擴充商店的索引 repo。這裡只登記「哪些擴充可以上架」，以及每個擴充的信任來源（GitHub repo 與 Ed25519 公鑰）。版本資訊由 GitHub Actions 從各擴充 repo 的 Release 讀取，產生靜態的 `index.json` 並發佈到 GitHub Pages。

```
extensions.json          人工審核後收錄的清單（PR 修改）
schema/                  extensions.json 與 index.json 的 JSON Schema
scripts/validate.js      檢查 extensions.json（PR 時自動執行）
scripts/build-index.js   讀取各 repo 的 Release、驗證 SHA-256 與簽章，產生 index.json
.github/workflows/       每小時、push、手動或 repository_dispatch 時重建並發佈
```

- 上架方式見 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 本機試建：`GITHUB_TOKEN=$(gh auth token) node scripts/build-index.js --out dist/index.json`，再到 ToolDock 商店「來源設定」加入 `file:///<路徑>/dist/index.json`。
- 只需要 Node.js 20 以上，不必 `npm install`。
- 公司內部商店：fork 本 repo，把 `extensions.json` 換成內部擴充，`GITHUB_API_URL` 指向 GitHub Enterprise Server，再把產出的 `index.json` 網址加到 ToolDock 的商店來源即可。完整說明見 ToolDock 的 `docs/STORE.md`。
