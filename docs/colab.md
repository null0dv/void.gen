# VOID GEN CLOUD (COLAB)

在自己的 Windows 電腦下指令，用 Google Colab 的 GPU 跑 VOID：生圖、加裝引擎、圖轉影片，做完把成品拉回本機，再關機停止計費。詳細步驟、紅線與疑難排解在 [void-gen-cloud skill](../.claude/skills/void-gen-cloud/SKILL.md)；模型清單以[模型下載表](models-v4.md)為準。

## 使用摘要

**準備（一次）**

1. 有 Colab 運算單元（Google AI Pro 方案或 Colab 隨用隨付）。
2. 安裝 uv 與 colab CLI：`uv tool install --python <Python 3.12 以上的 python.exe> google-colab-cli`。
3. 登入：終端機執行 `colab usage`，用瀏覽器開它給的網址、按同意，把授權碼貼回**同一個**終端機。看到餘額就完成。

**每次使用**（在 void.gen 資料夾，`python` 用 ComfyUI 內附的 `..\ComfyUI_windows_portable\python_embeded\python.exe -s`）

| 步驟 | 指令 | 約多久 |
|---|---|---|
| 查餘額 | `python colab_cli.py check` | 幾秒 |
| 開機 | `python colab_cli.py start --profiles sdxl`（依序試 L4 → A100 → T4） | 7–8 分鐘 |
| 開介面 | `python colab_cli.py open`，瀏覽器開 `http://127.0.0.1:7860/`（這個視窗要開著） | 幾秒 |
| 加引擎 | `python colab_cli.py add klein`（也可 `qwen`、`wan`、`florence`…，不用重開） | 1–2 分鐘 |
| 圖轉影片 | `python colab_cli.py motion jobs.json`（Wan 2.2，完成後自動拉回） | 每支 10 秒片約 4–5 分鐘 |
| 拉回作品 | `python colab_cli.py fetch` → 本機 ComfyUI `output/VOID-Cloud/<日期>` | 幾秒 |
| 關機 | `python colab_cli.py stop`（先拉圖、再關機；拉不回來就不關） | 1–5 分鐘 |

`jobs.json` 範例：`[{"image": "a.png", "prompt": "Anime style. ...", "seconds": 10, "size": "square"}]`，`size` 為 `square`／`portrait`／`landscape`，`seconds` 為 3／5／10。

**費用（2026-11 實測）**

- 生圖、Wan 影片用 L4，約 1.54 單元／小時。SDXL 1024² 約 11 秒一張。
- 一次「開機＋生幾張圖＋關機」約 0.5 單元；開機做 3 支 10 秒影片約 1.2 單元。
- 開著就計費。用完一定 `stop`，再用 `colab usage` 確認 `Usage rate: 0.00/hr`。

**常見狀況**

- 指令卡住沒反應：多半還沒登入，先單獨跑 `colab usage`。
- `colab exec` 連不上（`Connection was lost`）：機器通常還在跑，用 `cloud/void-ssh.ps1` 看進度、`cloud/void-scp.ps1` 拉檔，`colab stop -s void` 關機。
- 介面說缺節點或模型：`python colab_cli.py add <引擎>`，再按「更新模型」。

## 另一種用法：Colab Notebook

將 `VOID-Colab.ipynb` 上傳至 Colab，選 GPU 執行階段，依順序執行。第一次掛載 Drive 後，Notebook 會要求上傳 `VOID-Colab-Source.zip`。安裝格預設只下載 SDXL，可從 `PROFILES` 啟用其他引擎。

啟動格會顯示 VOID 桌面版與手機版的 Colab 網址。圖片與影片存放在 Drive 的 `VOID-Colab/output`，模型在 `VOID-Colab/models`，回收資料在 `VOID-Colab/trash`，圖庫資料庫定期備份到 `VOID-Colab/library.sqlite3`。使用完畢請執行停止格，保存最後一次變更。

Colab 版使用單人工作區。訪客登入、Windows 資源回收筒及 Windows 主機訪客圖庫是獨立功能。Colab 執行階段結束後，需重新啟動才能使用工作區。
