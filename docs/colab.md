# VOID GEN 在 Google Colab

將 `VOID-Colab.ipynb` 上傳至 Colab，選 GPU 執行階段，依順序執行。第一次掛載 Drive 後，Notebook 會要求上傳 `VOID-Colab-Source.zip`。安裝格預設只下載 SDXL。可從 `PROFILES` 啟用其他引擎，完整清單見 Notebook 和[模型下載表](models-v4.md)。

啟動格會顯示 VOID 桌面版與手機版的 Colab 網址。圖片與影片存放在 Drive 的 `VOID-Colab/output`。模型放在 `VOID-Colab/models`，回收資料放在 `VOID-Colab/trash`。圖庫資料庫定期備份到 `VOID-Colab/library.sqlite3`。使用完畢請執行停止格，保存最後一次變更。

## 從本機用 colab CLI 執行

參考 [shanshiba-workflow-colab](https://github.com/mathruffian-dot/shanshiba-workflow-colab) 的做法，不必開 Notebook。本機的 `colab_cli.py` 會透過 Google 的 `colab` CLI 建立 GPU 機器並掛載 Drive。它也會上傳原始碼，再以背景程序執行 `colab_vm.py` 安裝與啟動。最後用 SSH 把 VOID 轉發到本機。

```
uv tool install google-colab-cli
colab usage
python colab_cli.py check
python colab_cli.py start --gpu L4 --profiles sdxl
python colab_cli.py open
python colab_cli.py stop
```

`open` 會轉發到 `http://127.0.0.1:7860/`，手機介面在 `/mobile/`。它每 5 分鐘戳一次 VM，避免閒置約 20 分鐘後被收回。如果 SSH 轉發失敗，就照畫面提示改用 Colab 的 proxyPort 網址。`colab` CLI 官方只支援 Linux 和 macOS。Windows 需要先套用 shanshiba 的 `cloud/colab_cli_windows_patch.py`。用完一定要執行 `stop`，讓圖庫資料庫備份到 Drive，並關機停止計費。`logs` 可以查看安裝與服務日誌。

Colab 版使用單人工作區。訪客登入、Windows 資源回收筒及 Windows 主機訪客圖庫是獨立功能。Colab 執行階段結束後，需重新啟動才能使用工作區。
