---
name: void-gen-cloud
description: 把 VOID GEN（ComfyUI 生圖工作區）或 MiniMax H3 圖轉影片放到 Google Colab GPU 上跑：安裝 colab CLI、登入、選機器、開機安裝、加裝引擎、開介面、把圖拉回本機或 Drive、關機。使用者提到「VOID GEN CLOUD」「VOID 雲端」「Colab 跑 VOID」「雲端算圖」「雲端生影片」「H3」「開 L4／A100／G4」「把雲端的圖拿回來」，或要規劃、優化、交接這套雲端流程時使用。
---

# VOID GEN CLOUD (COLAB)

本機（Windows）下指令，Colab 只負責 GPU 運算。2026-11-11 實際跑通 SDXL、Klein 9B、H3；2026-11-22 新版 `start`／`add`／`fetch`／`stop` 在 L4 上整套實測通過（0.53 單元），同日 `motion` 用 Wan 2.2 把 3 張動漫圖做成 10 秒影片（1.18 單元）。

給人看的使用摘要在 [docs/colab.md](../../../docs/colab.md)；這份是給 Agent 的完整操作手冊。

工具都在 repo 根目錄（`colab_cli.py` 本機總控、`colab_vm.py` 雲端安裝、`colab_motion.py` 圖轉影片；SSH 備援在 `cloud/`）。以下路徑都從 void.gen 資料夾起算。架構、待辦、實測數字在 [references/](references/)。

## 紅線（一定要守）

1. **登入只能使用者本人做。** Agent 開好終端機、說明步驟，絕不代填帳密或授權碼。
2. **colab 指令要在使用者真正的終端機跑**（`run_in_terminal` 開分頁）。Agent 的 shell 若在沙盒，裝好的 CLI 和登入憑證使用者看不到，會出現 `uv trampoline failed`。
3. **開機就計費。** 開機前告訴使用者會用哪台、每小時多少單元。用完一定 `stop`，最後用 `colab usage` 確認 `Usage rate: 0.00/hr`。
4. **關機前先拉圖。** 不掛 Drive 時，作品只在 VM 上，關機就消失。`colab_cli.py stop` 會先 fetch，拉不回來就不關機。不要用 `colab stop` 直接關。
5. **不上傳超過 60MB 的檔案**（colab upload/download 約 90MB 以上會被中斷）。模型一律讓雲端從網路下載；作品用 `fetch` 分包拉回。
6. **ps1 腳本只寫英文 ASCII。** Windows PowerShell 5.1 會把沒有 BOM 的中文讀成亂碼，造成語法錯誤。
7. **void.gen 的規則照舊：** 本機有 `_system/` 時先讀 `_system/AI-rules.md`、`status.md`；Python 用 `..\ComfyUI_windows_portable\python_embeded\python.exe -s`；不 commit、不還原別人的修改；做完寫 `status.md` 和 `activity.md`。
8. **H3 授權：** MiniMax H3 排除美國、歐盟、英國、南韓（含產出）。Colab 常分到美國或荷蘭。開機前告訴使用者，由使用者決定。
9. **`colab exec` 約 60 秒沒回應就放棄**（`TimeoutError: Timeout waiting for reply`），雲端程式其實還在跑。超過一分鐘的事一律在 VM 上 `nohup ... &` 背景跑、寫日誌，再輪詢（`colab_cli.py` 的 `poll`）。
10. **VOID 後台可能放在 void.gen 的上一層**（作者本機 2026-11-22 起如此，`void.gen/void_mobile.py` 是轉接檔；直接 clone 的人則用 void.gen 內的版本）。上傳包把 `void.gen/` 和上一層的 `void_mobile.py`、`mobile_workflows.py`、`prompt_adapt.py`、`engine-profiles.json`、`mobile_motion_graph.json` 一起解到 VM 的 `/content`（`colab_cli.py` 的 `GATEWAY_FILES`）。後台多讀了新檔案就要加進這個清單。

## 一次性設定

以下 `$PY` = ComfyUI Portable 內附的 Python，例如 `..\ComfyUI_windows_portable\python_embeded\python.exe`（任何 Python 3.12 以上都可以）。

```powershell
winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements
uv tool install --python "$PY" google-colab-cli      # 一定要指定 --python，uv 自己下載的 Python 會壞
& "$env:USERPROFILE\.local\bin\colab.exe" version    # 0.7.5 以上；Windows 不需要 termios 修補
```

**登入（使用者本人）：** 用 `run_in_terminal` 開「一個」分頁跑 `& "$env:USERPROFILE\.local\bin\colab.exe" usage`，讀出網址給使用者，請他：
1. 用瀏覽器開網址，選有運算單元的 Google 帳號，按同意。
2. 複製授權碼，**回到同一個分頁**，確認最後一行是 `Enter the authorization code:` 再貼上、按 Enter。
3. 看到 `Current balance: ...` 就成功。授權碼只能用一次；貼錯分頁就重開一次 `colab usage`。

登入期間把其他終端機分頁關掉，避免貼錯。

## 日常流程（生圖）

在 `void.gen` 資料夾、使用者的終端機裡：

```powershell
& $PY -s colab_cli.py check                                  # 餘額、有沒有機器在跑
& $PY -s colab_cli.py start --profiles sdxl                  # 預設依序試 L4 → A100 → T4，每台等 2 分鐘
& $PY -s colab_cli.py open                                   # 轉發到 http://127.0.0.1:7860/（這個分頁要開著）
& $PY -s colab_cli.py add klein                              # 加裝引擎，不必重開機
& $PY -s colab_cli.py fetch                                  # 新圖拉回本機 ComfyUI output\VOID-Cloud\<日期>
& $PY -s colab_cli.py motion jobs.json                       # 批次圖轉影片（Wan 2.2），完成後自動 fetch
& $PY -s colab_cli.py stop                                   # 拉圖 → 停服務 → 關機
```

**圖轉影片（Wan 2.2）：** `start --profiles wan`（或 `add wan`）後跑 `motion`。`jobs.json` 範例：
`[{"image": "a.png", "prompt": "Anime style. ...", "seconds": 10, "size": "square"}]`。`size` 只能 `square`（512×512）、`portrait`（384×640）、`landscape`（640×384），`seconds` 為 3／5／10，跟 VOID 介面同一套工作流。實測 L4 每支 10 秒片 224–281 秒。
- **選圖：** 使用者說「普遍級」時，從 VOID 圖庫（`../void-data/mobile.sqlite3` 的 `gallery`，唯讀開）挑，先用 prompt 過濾掉性暗示、身體描寫、年幼角色相關字眼，再**逐張打開看**確認衣著完整、沒有性暗示，有疑慮就排除。不要只靠 prompt 判斷。

- `start` 約 7.5 分鐘（SDXL 6.5GB）。模型下載和套件安裝同時進行，下載完用 `models.lock.json` 驗 SHA-256。
- `add klein` 約 1.5 分鐘（4 個檔、12GB，3 條平行下載），不重啟。
- `stop` 先 fetch、再背景停服務、最後關機；拉不回圖就不關。
- `open` 用 `colab ssh --proxy-mode` 當 SSH ProxyCommand，不需要公開網址。分頁開著會每 5 分鐘戳一次 VM 防閒置回收。可以用內建瀏覽器開 `http://127.0.0.1:7860/` 讓使用者操作。
- `fetch` 拉回的圖放在本機 ComfyUI `output\VOID-Cloud\<日期>`，本機 VOID 圖庫看得到。要放到 Drive：使用者裝了 Google 雲端硬碟電腦版就 `--dest` 指到同步資料夾；沒裝就用 Drive 連接器上傳（`create_file`，`base64Content` 填 `sha256:<hash>:<絕對路徑>`）。
- 要掛 Drive 才加 `start --drive`，會要使用者在瀏覽器按允許、回終端機按 Enter（不用貼碼）。這步使用者曾經卡住，預設不掛。
- 引擎：`sdxl`、`klein`、`qwen`、`moss`、`wan`、`florence`、`wd14`。

## 選哪台機器

| 用途 | 建議 | 每小時單元 | 實測 |
|---|---|---|---|
| 生圖（SDXL、Klein、Qwen） | **L4**（預設第一順位） | 1.54 | SDXL 1024² 25 步 10.6 秒/張 |
| 大量批次生圖 | A100 | 5.30 | — |
| H3 影片 | G4，沒貨換 A100（`--instances 1`） | 8.90 / 5.30 | A100：10 秒片約 6 分鐘 |
| 不要用 | T4 跑 H3、L4 跑 H3 | — | 記憶體不夠／慢 7.5 倍 |

G4 常回 `Service Unavailable`。`colab_cli.py` 每台最多等 `--wait` 秒（預設 120）就換下一台，並清掉半開的 session。

## 模型管理

- **唯一清單：** `void.gen/docs/models-v4.md`。改模型只改這裡。
- **驗證檔：** `void.gen/models.lock.json` 只存每個網址的大小與 SHA-256。改完清單跑 `& $PY -s tools\build_models_lock.py`。
- 新增模型：在對應引擎的表格加一列 `| [檔名](https://huggingface.co/.../resolve/...) | \`資料夾/\` |`，重跑 lock。
- 連結失效（HTTP 404）時：用本機同名檔的 SHA-256 去 HuggingFace 找同一個檔案（API：`/api/models/<repo>/tree/main?recursive=true` 的 `lfs.oid`），雜湊相同才換連結。2026-11-22 的 Qwen Image 2.1 就是這樣換到 `KasugaiSakura/...-Abenzerps-GGUF`。
- 本機有、網路找不到的檔案：先找來源；真的找不到才用 `colab_upload_big.py` 分塊上傳（20MB 一塊，會驗 SHA-256）。

## 影片（H3）

用 [shanshiba-workflow-colab](https://github.com/mathruffian-dot/shanshiba-workflow-colab)（不在這個 repo；作者本機的操作筆記是 `../COLAB-H3-操作流程.md`）。重點：

- 包一個 ps1：`colab_h3.py start --h3-only --gpu A100 --instances 1` → `batch <spec.json>` → `stop`（作者本機是 `../h3-run.ps1`）。
- **`spec.json` 的描述必須照 `first.png` 實際畫面寫**，不然影片會混成兩張圖。複製圖之後先打開 `first.png` 看。
- 先 `tools\h3_shot.py <spec> --out <dir> --dry-run` 檢查格式（0 errors）再上雲端。
- 10 秒片：`"duration": 10`、`"draft": true`、size 比例同首幀。

## 疑難排解

| 狀況 | 處理 |
|---|---|
| `colab` 找不到 | 不在 PATH；`colab_cli.py` 會自己找 `%USERPROFILE%\.local\bin\colab.exe` |
| `uv trampoline failed to canonicalize script path` | CLI 裝在沙盒；到使用者終端機 `uv tool install --force --python "$PY" google-colab-cli` |
| `Missing expected target directory`（uv 安裝） | 加 `--python <現有 python.exe>` |
| 指令卡住不動 | 多半沒登入，正在等授權碼；先單獨跑 `colab usage` |
| `G4: Service Unavailable` | 沒貨；用 `--gpu A100` 或預設順序 |
| `Session not found` | 閒置約 20 分鐘被收回；重新 `start`（不掛 Drive 時雲端作品已消失） |
| 介面顯示缺 UnetLoaderGGUF／模型 | `colab_cli.py add <引擎>`，完成後在 VOID 按「更新模型」或 CHECK |
| 上傳 `ConnectionAbortedError 10053` | 檔案太大；改讓雲端下載，或 `colab_upload_big.py` |
| ps1 出現「字串遺漏結尾字元」 | 腳本裡有中文，改成 ASCII |
| `colab exec -f x.py` 讀到奇怪參數 | 它在 Jupyter kernel 裡跑，`sys.argv` 不是你的；用環境變數或寫死 |
| `TimeoutError: Timeout waiting for reply` | `colab exec` 超過約 60 秒；雲端多半還在跑。改成 nohup 背景跑再輪詢日誌 |
| `RuntimeError: Connection was lost.`（`colab exec` 連不上，`colab status` 卻是 IDLE） | 機器其實正常（Wan 跑圖時遇過，十幾分鐘後自己恢復）。改走 SSH：`cloud\void-ssh.ps1 "tail /content/void-motion.log"` 看進度、`cloud\void-scp.ps1 "<遠端路徑>" "<本機資料夾>"` 拉檔、`colab stop -s void` 關機（關機不需要 kernel） |
| 開機後第一個上傳或指令卡好幾分鐘 | 新機器的 kernel 還在暖機，正常；等它跑完，不要重開 |
| 雲端 VOID 啟動失敗、`ImportError` 或缺檔 | 根目錄後台多讀了新檔，加進 `colab_cli.py` 的 `GATEWAY_FILES` |
| `A new version of Colab CLI is available` | 只是提示，不影響；要關就在 `~/.config/colab-cli/settings.json` 設 `"enable_update_check": false`（改使用者設定前先問） |
| H3 影片「兩張圖錯亂」 | 描述和 `first.png` 不一致，照圖重寫 |

## 交代結果

做完告訴使用者：開了哪台、哪個機房、花了多少單元（`colab usage` 前後差）、圖在哪（本機路徑或 Drive 連結）、機器已關（`Usage rate: 0.00/hr`）。沒驗證到的部分照實說。
