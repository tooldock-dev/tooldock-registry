## 上架 / 異動擴充

- 擴充 id：
- repo：
- 異動類型：新上架 / 更換公鑰 / 更改發佈者名稱 / 下架

### 發佈者自我檢查（送出前）

- [ ] repo 已有正式 Release（tag `v<version>`），附件 `<id>-<version>.tbx`、`.tbx.sha256`、`.tbx.sig` 齊全
- [ ] `publicKey` 是 `tooldock-ext keygen` 產生的公鑰；私鑰只存在 repo 的 Actions secret，沒有 commit 進任何地方
- [ ] 套件 `package.json` 的 `tooldock.id` 與這裡的 `id` 相同
- [ ] README 說明擴充會存取哪些檔案、網路位址或外部程式
- [ ] 已閱讀 CONTRIBUTING.md

審核者請依 CONTRIBUTING.md 的「審核清單」逐項確認。
