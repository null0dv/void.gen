# VOID GEN 在 Google Colab

將 `VOID-Colab.ipynb` 上傳至 Colab，選 GPU 執行階段，依順序執行。第一次掛載 Drive 後，Notebook 會要求上傳 `VOID-Colab-Source.zip`。安裝格預設只下載 SDXL。可從 `PROFILES` 啟用其他引擎，完整清單見 Notebook 和[模型下載表](models-v4.md)。

啟動格會顯示 VOID 桌面版與手機版的 Colab 網址。圖片與影片存放在 Drive 的 `VOID-Colab/output`。模型放在 `VOID-Colab/models`，回收資料放在 `VOID-Colab/trash`。圖庫資料庫定期備份到 `VOID-Colab/library.sqlite3`。使用完畢請執行停止格，保存最後一次變更。

## 從本機用 colab CLI 執行

不開 Notebook，從本機終端機控制 Colab：`colab_cli.py` 開機（L4 → A100 → T4 依序試）、上傳原始碼，`colab_vm.py` 在雲端安裝並啟動，`open` 用 SSH 轉發到 `http://127.0.0.1:7860/`。預設不掛 Drive，`fetch`／`stop` 會把新圖拉回本機 ComfyUI 的 `output/VOID-Cloud/<日期>`。

安裝、登入、指令、選機器和疑難排解寫在 [void-gen-cloud skill](../../.claude/skills/void-gen-cloud/SKILL.md)。模型清單仍以[模型下載表](models-v4.md)為準，`models.lock.json` 記錄每個檔案的大小與 SHA-256（改表後跑 `tools/build_models_lock.py`）。

Colab 版使用單人工作區。訪客登入、Windows 資源回收筒及 Windows 主機訪客圖庫是獨立功能。Colab 執行階段結束後，需重新啟動才能使用工作區。
