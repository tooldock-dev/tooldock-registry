# 上架擴充

ToolDock 的擴充後端擁有完整的 Node.js 權限，平台**沒有沙箱**。索引是使用者決定「信任誰」的依據，所以每一筆收錄都要經過人工審核。

## 發佈者：上架步驟

1. **產生簽章金鑰**（只需一次）：在擴充專案執行 `npx tooldock-ext keygen`。
   - 私鑰存成擴充 repo 的 Actions secret，**絕對不要 commit**。
   - 公鑰字串（SPKI DER 的 base64）稍後填進 `extensions.json`。
2. **發佈第一個 Release**：用擴充範本內建的發佈 workflow 推 tag `v<version>`。Release 附件必須齊全：
   - `<id>-<version>.tbx`
   - `<id>-<version>.tbx.sha256`：一行小寫 hex
   - `<id>-<version>.tbx.sig`：對 .tbx 原始位元組的 Ed25519 簽章，base64
3. **開 PR**，在 `extensions.json` 加入一筆：

   ```json
   {
     "id": "my-tool",
     "repo": "your-name/tooldock-my-tool",
     "publisher": "你的名字或組織",
     "publicKey": "MCowBQYDK2VwAyEA…",
     "verified": false
   }
   ```

   `verified` 請填 `false`，由審核者決定是否改成 `true`。
4. 合併後，下一次排程（最多約一小時）就會出現在商店。之後發佈新版**不需要再開 PR**，推新的 tag 即可。

## 審核清單

審核者在合併前逐項確認。任何一項不符就請發佈者修正，或關閉 PR。

### 格式（CI 會自動檢查，仍要看結果）

- [ ] 「檢查上架 PR」job 通過：`extensions.json` 格式正確，`publicKey` 能載入為 Ed25519 公鑰。
- [ ] job summary 中，新擴充有被收錄（表示已有附件齊全、SHA-256 與簽章驗證都通過的正式 Release）。
- [ ] `id` 沒有與既有擴充、ToolDock 官方擴充（1.10.0 以前的內建擴充 `data-converter`、`site-monitor`、`table-report`）或知名工具名稱混淆。

### 身分

- [ ] PR 作者就是 `repo` 的擁有者，或該組織的成員（看 PR 作者的 GitHub 帳號與 repo 的擁有者）。
- [ ] `publisher` 名稱與 repo 擁有者一致，沒有冒用其他人或公司的名稱。
- [ ] `verified: true` 只給已確認身分的發佈者，例如 repo 屬於已驗證網域的 GitHub 組織，或審核者能以其他管道確認本人。不確定就維持 `false`。
- [ ] 公鑰是新產生的，沒有與其他發佈者共用（同一把公鑰出現在不同發佈者的項目中，代表私鑰外流或冒用）。

### 程式碼與套件

- [ ] repo 是公開的，原始碼與 Release 中的 `.tbx` 內容相符：下載 `.tbx` 解壓縮後與該 tag 的原始碼比對，特別注意 minified、混淆過的檔案，或原始碼中沒有的二進位檔。
- [ ] `package.json` 的 `tooldock.id` 與登記的 `id` 相同，`engine` 範圍合理。
- [ ] 沒有 `postinstall` 之類的安裝腳本；`node_modules` 只包含正式相依套件。
- [ ] 後端沒有明顯可疑的行為：下載並執行遠端程式碼（`eval`、`new Function`、動態 `require` 遠端檔案）、讀取與功能無關的檔案（瀏覽器資料、SSH 金鑰、其他擴充的資料）、把資料傳到 README 沒說明的位址。
- [ ] README 清楚寫出擴充會讀寫哪些檔案、連到哪些網路位址、會執行哪些外部程式。
- [ ] 有授權條款（LICENSE）。

### 異動既有項目

- [ ] **更換 `publicKey`**：要求發佈者在原 repo 的 issue 或 Release 說明中公告金鑰輪替，並由原 repo 擁有者開 PR。已安裝的使用者更新時，商店會因為金鑰不同而要求重新確認。
- [ ] **更換 `repo`**：視同重新上架，整份清單重新審核。
- [ ] **下架**：直接刪除該筆。已安裝的使用者不受影響，但商店不再提供更新。若是因為惡意行為下架，請另外在本 repo 開 issue 公告。

## 注意

- 「已驗證」只代表發佈者身分經過確認，**不代表程式碼經過安全稽核**。ToolDock 的商店畫面也會這樣告知使用者。
- 簽章能證明套件「出自登記的發佈者」且「下載過程沒有被竄改」。如果發佈者本身是惡意的，或私鑰外流，簽章無法提供保護。發現私鑰外流時，請立即開 PR 移除或更換公鑰。
