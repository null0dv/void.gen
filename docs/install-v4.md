# VOID FULL V4 安裝與使用

## 安裝

1. 安裝適合顯示卡的 Windows ComfyUI Portable，使用 Python 3.12 以上的版本。下載與解壓請參考 [ComfyUI 官方安裝說明](https://docs.comfy.org/installation/comfyui_portable_windows)。
2. 從 [GitHub 儲存庫](https://github.com/null0dv/void.gen) 下載 ZIP 並解壓成 `void.gen`，或執行 `git clone https://github.com/null0dv/void.gen.git`。兩個目錄放在同一層。

   ```text
   VOID/
   ├── void.gen/
   │   └── VOID-GEN-FULL.cmd
   └── ComfyUI_windows_portable/
       ├── ComfyUI/
       └── python_embeded/
   ```

3. 在上圖的 `VOID` 資料夾開啟 PowerShell，確認閘道所需的套件可匯入。若缺少套件再執行第二行。

   ```powershell
   .\ComfyUI_windows_portable\python_embeded\python.exe -c "import aiohttp, PIL"
   .\ComfyUI_windows_portable\python_embeded\python.exe -m pip install aiohttp Pillow
   ```

4. 將至少一個相容的 SDXL checkpoint 放進 `ComfyUI_windows_portable/ComfyUI/models/checkpoints/`。模型可先選擇 [SDXL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)。下載模型檔 `sd_xl_base_1.0.safetensors`。
5. 關閉自行開啟的 ComfyUI 服務後，雙擊 `void.gen/VOID-GEN-FULL.cmd`，讓腳本用所需的瀏覽器設定啟動三個本機服務。打開桌面介面後，選 **SD / SDXL**、選 checkpoint、輸入提示詞並按生成。
6. 如要建立桌面捷徑，在 `void.gen` 目錄執行下列命令。

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\create-void-full-shortcut.ps1
   ```

先用 SDXL 驗證基本生成，再按[模型下載表](models-v4.md)配置 Klein、Qwen、MOSS、Moody Moss、Wan 及圖片辨識。下載表列出對應檔名、模型目錄和自訂節點。手機模式的固定檔名可查閱[工作流設定](../mobile_workflows.py)。

## 日常使用

| 工作區 | 操作 |
| --- | --- |
| 創作 | 選文生圖、圖生圖或圖片辨識。圖生圖可拖入本機圖片，也能把作品卡拖進來源圖區。 |
| 編輯工作室 | 加入主圖與選用參考圖，輸入修改指令。可切換專案圖板、比較版本，或改成圖片轉影片。 |
| 作品庫 | 點縮圖查看原圖。卡片下方可套用設定、送去改圖、下載和評分。 |
| 任務 | 追蹤桌面與手機的共用佇列。支援預覽的生成工作流會在桌面顯示算圖過程。 |
| 回收區 | 先在作品庫移除項目，可在 VOID 回收區還原。按「清空回收區」並確認後，資料會移入 Windows 資源回收筒。 |

桌面 [8080 工作區](http://127.0.0.1:8080/sd-dashboard.full.html) 與 [8090 手機介面](http://127.0.0.1:8090/) 皆由主機執行。遠端手機依下節設定私人網址。

## 遠端連線

1. 在主機及手機安裝 [Tailscale](https://tailscale.com/download)，登入同一帳號。主機先啟動 VOID，再執行 `Connect-VOID-Tailscale.cmd`，依提示啟用 HTTPS，使用輸出的私人網址。參考 [Tailscale Serve 文件](https://tailscale.com/docs/features/tailscale-serve)。
2. 若要提供獨立帳號，在主機用 PowerShell 進入 `void.gen`，執行下列指令並替換 Email。需要讓對方的 Tailscale 帳號能連到這台主機的 8443，可依你的網路設定使用 [Tailscale 裝置共享](https://tailscale.com/docs/features/sharing)。

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-VOID-Guest.ps1 -Login 'guest@example.com'
   ```

3. 訪客以自己的 Tailscale 帳號開啟腳本輸出的 `:8443` 網址。首次使用從空圖庫開始，主帳號的舊圖片與原圖網址對該訪客無效。此腳本配置一個獨立訪客，重跑時使用相同 Email。
4. 主機須保持開機並執行 VOID。訪客在主機重開後需重新執行訪客啟動腳本。請使用私人 Serve，並保留 ComfyUI 與 VOID 後端在本機回環位址。

## 備份與排解

- 首次模型清單空白時，確認 checkpoint 放置路徑後重啟 ComfyUI，再按「更新模型」。
- 啟動卡住時，到同層 `VOID` 資料夾查看 `comfyui-error.log`、`void-panel-error.log`、`void-mobile-error.log`。使用中的連接埠為 ComfyUI 8188、桌面 8080、手機閘道 8090，訪客閘道 8091。
- 升級請先等任務完成，備份後執行 `git pull --ff-only`。重啟既有 VOID 服務，再按 Ctrl＋F5 載入前端。
- 在主機執行 `Backup-VOID-Full.cmd` 可匯出主帳號的共用任務資料、作品及回收區。執行環境、模型與訪客資料庫需另外備份。日常產生的檔案存於儲存庫外，包含 `void-data`、`void-guest-data` 及 ComfyUI 的輸入與輸出目錄。
