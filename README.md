# VOID FULL V4

VOID 是在 Windows 主機上使用 ComfyUI 的創作工作區。桌面與手機共用任務佇列及作品庫，獨立訪客帳號使用自己的圖庫。

- [Windows 安裝與首次啟動](docs/install-v4.md#安裝)
- [模型下載、放置位置與自訂節點](docs/models-v4.md)
- [桌面、手機與工作室使用說明](docs/install-v4.md#日常使用)
- [Tailscale 手機與獨立訪客設定](docs/install-v4.md#遠端連線)
- [備份與疑難排解](docs/install-v4.md#備份與排解)

安裝 ComfyUI Portable 及至少一個 SDXL checkpoint 後，執行 `VOID-GEN-FULL.cmd`。瀏覽器會開啟 [桌面工作區](http://127.0.0.1:8080/sd-dashboard.full.html)。本機也可從 [手機介面](http://127.0.0.1:8090/) 測試。

模型權重、ComfyUI 執行環境與本機作品資料需在自己的主機準備。

## 交給 Codex 安裝

把下面這段貼到安裝主機上的 Codex。安裝時可指定要用的功能，讓 Codex 依顯卡和磁碟空間逐組配置。

> 請在這台 Windows 電腦安裝 https://github.com/null0dv/void.gen 的 VOID FULL V4。先讀 README、docs/install-v4.md 和 docs/models-v4.md，確認顯卡、VRAM、剩餘空間和既有 ComfyUI。保留已有的模型、作品與設定。按模型表下載權重、安裝自訂節點，再用 VOID-GEN-FULL.cmd 啟動瀏覽器，建立桌面捷徑。先驗證 SDXL 文生圖及拖圖做圖生圖，再配置並各試跑一次 Klein 連續改圖、Florence-2 圖片辨識、Wan 圖轉影片。也請用本機手機介面確認能開啟作品並選擇相容模型。大型下載前先確認所需空間。如果遇到需要登入、授權或找不到確切版本的權重，列出檔名與來源，繼續完成其他可用功能。最後告訴我啟動方式、實際跑通的功能及缺項。
