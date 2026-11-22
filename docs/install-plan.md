# VOID GEN + Pocket 完整安裝計畫

這是 `install-pack` 分支：只有 **VOID GEN 桌面工作區＋Pocket 手機端**，不含 AI 工作台的東西（Nana 劇情、Telegram 大廳、換裝模組）。Pocket 後台（`void_mobile.py` 等）已經放在 `void.gen` 資料夾裡，下載這個 repo 就是完整一套。

一鍵安裝會做這些事：
1. 下載 ComfyUI Portable。
2. 裝 VOID 需要的 Python 套件和自訂節點。
3. 照[模型下載表](models-v4.md)下載模型，每個檔都驗大小和 SHA-256。
4. 建桌面捷徑，然後啟動。

## 1. 需要什麼

| 項目 | 需求 |
|---|---|
| 系統 | Windows 10／11 64 位元 |
| 顯卡 | NVIDIA，8 GB VRAM 起跳，12 GB 以上建議；RTX 5060 Ti 16 GB 實測全部引擎可跑 |
| 記憶體 | 32 GB 建議（Klein、Qwen、Wan 的文字編碼器會吃系統記憶體） |
| 網路 | 只裝 SDXL 約 9 GB，全部約 90 GB |
| 其他 | 不用另外裝 Python、Git、7-Zip。用的是 ComfyUI 內附的 Python，解壓縮用 Windows 內建的 `tar` |

### 各引擎下載量

| 引擎 | 參數名 | 大小 | 用途 |
|---|---|---|---|
| SDXL | `sdxl` | 6.5 GB | 文生圖、圖生圖，驗證安裝用（預設） |
| FLUX.2 Klein 9B | `klein` | 12.1 GB | 連續改圖、轉寫實 |
| Qwen Image 2.1 | `qwen` | 13.6 GB | 生圖與改圖 |
| MOSS Image | `moss` | 25.3 GB | 生圖與改圖 |
| Wan 2.2 | `wan` | 17.3 GB | 圖片轉影片（Pocket「動態」） |
| Florence-2 | `florence` | 1.4 GB | 圖片轉文字 |
| Moody Moss | `moody` | 6.8 GB | 只有文字編碼器，主權重要手動取得 |

ComfyUI 本體另約 6 GB。隨時可以用 `python tools\void_setup.py --list` 看最新數字。

## 2. 安裝後的資料夾

```text
VOID\                           ← 你選的安裝位置
├── void.gen\                   ← 這個 repo（介面、Pocket 後台、安裝程式）
├── ComfyUI_windows_portable\   ← 安裝程式下載
│   └── ComfyUI\models\         ← 模型
│   └── ComfyUI\output\         ← 作品
├── void-data\                  ← Pocket 圖庫資料庫、縮圖、回收區（第一次啟動自動建立）
└── *.log                       ← 服務紀錄
```

作品、資料庫、模型都在 `void.gen` 外面，所以更新程式不會動到它們。

## 3. 安裝步驟

### A. 一鍵安裝（新電腦）

1. 建一個資料夾，例如 `D:\VOID`，路徑不要有中文或空格。
2. 下載這個分支：
   ```powershell
   git clone -b install-pack https://github.com/null0dv/void.gen.git D:\VOID\void.gen
   ```
   沒有 Git 就到 GitHub 切到 `install-pack` 分支下載 ZIP，解壓後把資料夾改名成 `void.gen`，放進 `D:\VOID`。
3. 雙擊 `void.gen\Install-VOID.cmd`，確認磁碟空間後輸入 `Y`。預設只裝 SDXL。
4. 裝完會自動開瀏覽器。在桌面工作區選 **SD / SDXL**、選 `sd_xl_base_1.0`，生一張圖，確認可以用。

要一次裝多個引擎，在 `void.gen` 開 PowerShell：

```powershell
.\Install-VOID.cmd -Engines sdxl,klein,wan,florence
```

`-Engines all` 會裝全部。中途斷線就再跑一次同一行，已完成的檔案會留著，沒下載完的會接著下載。

### B. 已經有 ComfyUI Portable

把現有的 `ComfyUI_windows_portable` 搬進或放在 `VOID` 資料夾裡，跟 `void.gen` 同一層，再跑一鍵安裝。安裝程式看到它就不會重新下載，已有的模型和節點也會跳過。

### C. 交給 Codex／Claude Code 安裝

把下面這段貼給 AI：

> 請在這台 Windows 電腦安裝 https://github.com/null0dv/void.gen 的 `install-pack` 分支（VOID GEN + Pocket）。先讀 `docs/install-plan.md`，確認顯卡、VRAM、剩餘空間和既有的 ComfyUI，告訴我要裝哪些引擎、需要多少空間，等我同意再下載。用 `Install-VOID.cmd -Engines <清單>` 安裝，保留已有的模型和作品。裝完照「4. 驗收清單」逐項試跑，最後告訴我啟動方式、跑通的功能和缺少的東西。

### 安裝程式參數

| 參數 | 作用 |
|---|---|
| `-Engines sdxl,klein` | 要裝的引擎，逗號分隔；`all` 全部 |
| `-SkipModels` | 只裝 ComfyUI、套件和節點，不下載模型 |
| `-NoShortcut` | 不建桌面捷徑 |
| `-NoStart` | 裝完不啟動 |
| `-Yes` | 不問確認（給 AI 或腳本用） |

只想檢查缺什麼、不下載任何東西：

```powershell
..\ComfyUI_windows_portable\python_embeded\python.exe -s tools\void_setup.py --check --profiles sdxl,klein
```

## 4. 驗收清單

| # | 測試 | 怎麼做 | 通過條件 |
|---|---|---|---|
| 1 | 服務 | 雙擊桌面「VOID GEN FULL」 | 瀏覽器開到 `http://127.0.0.1:8080/sd-dashboard.full.html` |
| 2 | SDXL 文生圖 | 選 SD／SDXL，輸入提示詞，生成 | 出圖，作品庫看得到 |
| 3 | 圖生圖 | 把作品卡拖進來源圖區 | 出圖 |
| 4 | Pocket | 電腦開 `http://127.0.0.1:8090/` | 看得到同一個作品庫，能打星、收藏 |
| 5 | Klein | 選 Klein，送一張圖去改圖 | 出圖（有裝 `klein`） |
| 6 | Wan | Pocket「動態」選一張圖，3 秒 | 出影片（有裝 `wan`） |
| 7 | Florence | 「圖片辨識」丟一張圖 | 出描述文字（有裝 `florence`） |

模型清單是空的時候：先重啟 ComfyUI（關掉 VOID 再開），再按「更新模型」。

## 5. 每天使用

- **啟動**：桌面捷徑「VOID GEN FULL」，或 `void.gen\VOID-GEN-FULL.cmd`。會啟動三個本機服務：ComfyUI `8188`、桌面 `8080`、Pocket `8090`，都只聽本機。
- **作品**：桌面和 Pocket 共用同一個作品庫。星等、收藏、標籤、相簿存在 `void-data\mobile.sqlite3`。
- **加引擎**：`.\Install-VOID.cmd -Engines qwen`，裝完重開 VOID，按「更新模型」。

## 6. 手機遠端（Pocket）

1. 電腦和手機都裝 [Tailscale](https://tailscale.com/download)，登入同一個帳號。
2. 電腦先啟動 VOID，再雙擊 `void.gen\Connect-VOID-Tailscale.cmd`，照提示開 HTTPS，記下它給的私人網址。
3. 手機用瀏覽器開那個網址，加到主畫面就能當 App 用。

給朋友用獨立帳號（他有自己的圖庫，看不到你的私人圖）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-VOID-Guest.ps1 -Login 'friend@example.com'
```

訪客連 `:8443`。電腦重開後要重跑這行。

## 7. 選用功能

| 功能 | 需要 | 沒裝時 |
|---|---|---|
| 提示詞轉自然語言／轉寫實 | [Ollama](https://ollama.com) 和模型（預設 `heretic9b`，可用環境變數 `VOID_ADAPT_MODEL` 換） | 照原本的提示詞生成 |
| Moody Moss 主權重 | 自己從原發布者取得，放 `diffusion_models\` | Moody 引擎不能用 |
| Nova Anime XL、DesireX、個人 LoRA | 見[模型下載表](models-v4.md)「其他選用資源」 | 不影響其他功能 |
| Nana 劇情分頁 | AI 工作台的 Telegram 大廳（不在這個包裡） | Pocket 自動隱藏「劇情」分頁 |
| 雲端算圖 | Google Colab，見 [VOID GEN CLOUD (COLAB)](colab.md) | 只用本機 |

## 8. 更新、備份、移除

- **更新**：等任務做完，在 `void.gen` 執行 `git pull --ff-only`，重開 VOID，瀏覽器按 Ctrl＋F5。
- **備份**：`Backup-VOID-Full.cmd` 會匯出圖庫資料庫、作品和回收區。模型可以重新下載，不用備份。
- **移除**：關掉 VOID，刪掉整個 `VOID` 資料夾。作品在 `ComfyUI_windows_portable\ComfyUI\output`，刪之前先搬走。

## 9. 疑難排解

| 狀況 | 處理 |
|---|---|
| 安裝中斷、下載失敗 | 再跑一次 `Install-VOID.cmd`，會從中斷處接著下載 |
| `SHA-256 mismatch` | 壞檔已自動刪掉，再跑一次 |
| Windows `tar` 解不開 ComfyUI | 安裝 [7-Zip](https://7-zip.org) 後再跑，安裝程式會改用 7-Zip |
| 啟動逾時 | 看 `VOID` 資料夾的 `comfyui-error.log`、`void-mobile-error.log` |
| 連接埠被占用 | 已經有另一個 ComfyUI 在 8188 跑，先關掉它 |
| 模型清單空白 | 檔名要和下載表一致；重開 VOID 後按「更新模型」 |
| 手機連不上 | 電腦要開著 VOID 和 Tailscale；手機和電腦要登入同一個 Tailscale 帳號 |

## 10. 這個分支和工作台版的差別

| | 工作台版（作者自用） | 這個安裝包 |
|---|---|---|
| Pocket 後台位置 | 上一層資料夾（工作台根目錄） | `void.gen` 裡面 |
| Nana 劇情、換裝模組 | 有 | 沒有（劇情分頁自動隱藏；放回模組就會出現） |
| 安裝 | 手動 | `Install-VOID.cmd` 一鍵、模型驗 SHA-256 |

後台用 `APP`（`void.gen` 資料夾）找介面和 RNG 資料，用 `ROOT`（上一層，或環境變數 `VOID_ROOT`）找 ComfyUI 和 `void-data`。
