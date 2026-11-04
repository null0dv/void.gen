# Void.gen

> 本地 Stable Diffusion 生成介面，基於 ComfyUI — 免費、無限制、完全在你的電腦上運行

## 開啟面板

### Void.gen Full V3（本機完整版 · 推薦）

雙擊 **`VOID-GEN-FULL.cmd`** 或 **`啟動 VOID.GEN FULL.bat`** → 瀏覽器開啟  
**http://localhost:8080/sd-dashboard.full.html**（TXT→IMG、IMG→IMG、IMG→TXT、圖庫）

### VOID.RNG V3（獨立專案）

Prompt 亂數生成器已與 Full 分離，請到 **`void-rng/`** 目錄啟動：

雙擊 **`void-rng/VOID-RNG.cmd`** 或根目錄 **`啟動 VOID.RNG.bat`** → **http://127.0.0.1:8787/**

辭庫整合於 `void-rng/data/`（manifest v3），已移除 RNG2 實驗版。

架構說明見 **[docs/void-full-v3.md](docs/void-full-v3.md)**。

### 線上精簡面板

**[https://null0dv.github.io/void.gen/sd-dashboard.html](https://null0dv.github.io/void.gen/sd-dashboard.html)**

> 需要在本機安裝並啟動 ComfyUI 才能運作

---

## 快速安裝（Windows + NVIDIA GPU）

### 方法一：自動安裝腳本（推薦）

1. 下載 **[install.ps1](install.ps1)**
2. 右鍵 → **用 PowerShell 執行**
3. 等待完成（首次約 5–10 分鐘，需下載約 2GB）
4. 完成後依照提示下載 AI 模型

### 方法二：手動安裝

<details>
<summary>展開手動安裝步驟</summary>

**步驟 1 — 下載 ComfyUI Windows Portable**

前往 [ComfyUI Releases](https://github.com/comfyanonymous/ComfyUI/releases/latest)，下載 `ComfyUI_windows_portable_nvidia_*.7z`。目前桌面版使用的安裝位置是 `C:\ComfyUI_windows_portable`。

**步驟 2 — 設定啟動參數**

編輯 `run_nvidia_gpu.bat`，改成：
```bat
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --normalvram --enable-cors-header *
pause
```

**步驟 3 — 下載 AI 模型**

下載任一 `.safetensors` 模型，放到 `C:\ComfyUI_windows_portable\ComfyUI\models\checkpoints\`

</details>

---

## 系統需求

| 項目 | 最低 | 推薦 |
|------|------|------|
| 作業系統 | Windows 10 | Windows 11 |
| 顯卡 | NVIDIA 4GB VRAM（需改 `--lowvram`） | NVIDIA 8GB+ VRAM |
| 記憶體 | 8GB RAM | 16GB RAM |
| 硬碟空間 | 15GB | 50GB+ |

> AMD 顯卡請改用 [ComfyUI DirectML 版本](https://github.com/comfyanonymous/ComfyUI/releases)

---

## 推薦設置（動漫 / 插畫風格）

> 以下是目前桌面 `VOID.GEN FULL` 實際使用並已確認存在的模型組合，適合動漫、插畫、二次元風格生成。模型檔案不存放在 GitHub，請由原始模型頁面下載。

### 下載清單

| 用途 | 模型檔案 | 下載 |
|------|----------|------|
| 主模型 (Checkpoint) | `novaAnimeXL_ilV180.safetensors` | [CivitAI](https://civitai.com/models/376130/nova-anime-xl) |
| Refiner | `JANKUTrainedChenkinNoobai_v777.safetensors` | [CivitAI](https://civitai.com/models/1277670/janku-trained-chenkin-and-noobai-rouwei-illustrious-xl) |

### 本機已安裝的 Checkpoint 推薦清單

以下清單依 `C:\ComfyUI_windows_portable\ComfyUI\models\checkpoints\` 在 2026-10-30 的實際內容整理。連結已用本機檔案 SHA-256 或檔案 metadata 核對；模型檔不存放於本專案。

| 本機檔名 | 系列／用途 | 推薦使用方式 | 下載頁面 |
|----------|------------|--------------|----------|
| `anikawaxl_v4.safetensors` | Illustrious 動漫 | 可愛角色、賽璐璐動畫風；建議 25–30 steps | [CivitAI · AniKawaXL V4](https://civitai.com/models/1282887?modelVersionId=2870022) |
| `dreamshaper_8.safetensors` | SD 1.5 通用模型 | 插畫、寫實混合；請使用 SD 1.5 解析度與工作流，不能搭配 SDXL Refiner | [CivitAI · DreamShaper 8](https://civitai.com/models/4384?modelVersionId=128713) · [Hugging Face 直載](https://huggingface.co/Yntec/Dreamshaper8/resolve/main/dreamshaper_8.safetensors) |
| `H-D2A2b.fp16.safetensors` | Illustrious 動漫 | Aüngir H-D2A2b；適合動漫人物與細節表現 | [CivitAI · H-D2A2b](https://civitai.com/models/1052681?modelVersionId=2635428) |
| `JANKUTrainedChenkinNoobai_v777.safetensors` | Illustrious 動漫 | 目前 VOID FULL Refiner 選項；也可獨立作主模型 | [CivitAI · v7.77](https://civitai.com/models/1277670?modelVersionId=2786084) · [Hugging Face 直載](https://huggingface.co/LillyCherry/JANKUTrainedChenkinNoobai_v777/resolve/main/JANKUTrainedChenkinNoobai_v777.safetensors) |
| `Kodo's Test models-OH-A3a.fp16.safetensors` | SDXL／PixAI 動漫 | Kodo 實驗模型 OH-A3a；使用 PixAI 模型頁取得模型 | [PixAI · Kodo's Test models／OH-A3a](https://pixai.art/ja/model/1815523442272197668/1849021327714996355) |
| `novaAnimeXL_ilV180.safetensors` | Illustrious 動漫 | 目前 VOID FULL 預設主模型，適合動漫與插畫 | [CivitAI · Nova Anime XL IL v18.0](https://civitai.com/models/376130?modelVersionId=2837020) |
| `sd_xl_base_1.0.safetensors` | 官方 SDXL Base | 通用基礎模型、測試相容性 | [Hugging Face 官方直載](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors) |
| `sd_xl_refiner_1.0.safetensors` | 官方 SDXL Refiner | 搭配 SDXL Base，在生成後段細化 | [Hugging Face 官方直載](https://huggingface.co/stabilityai/stable-diffusion-xl-refiner-1.0/resolve/main/sd_xl_refiner_1.0.safetensors) |
| `ZILv35-hy8-s2_00001_.safetensors` | 本機自製 SDXL checkpoint | 由 `ZILv35-CKNB-DS-mix2` 加入 `Hyper-SDXL-8steps-lora` 後於 ComfyUI 儲存；目前沒有可驗證的公開成品載點 | 無公開成品下載；[Hyper-SDXL 官方來源](https://huggingface.co/ByteDance/Hyper-SD) |

> CivitAI 或 PixAI 可能要求登入並接受模型授權條款。`ZILv35-hy8-s2_00001_` 是本機衍生成品，不應冒用其他相似模型的下載連結。


兩個檔案都放到目前使用中的 ComfyUI：
```
C:\ComfyUI_windows_portable\ComfyUI\models\checkpoints\
```

目前低顯存啟動參數（RTX 3050 4GB）：
```bat
.\python_embeded\python.exe -s run_comfyui_pna.py --windows-standalone-build --lowvram --listen 0.0.0.0 --enable-cors-header * --fast --fp8_e4m3fn-unet --preview-method taesd
```

### 面板設定

| 項目 | 設定值 |
|------|--------|
| MODEL | novaAnimeXL_ilV180 |
| REFINER | JANKUTrainedChenkinNoobai_v777 |
| BASE % | 75 |
| Steps | 25–35 |
| CFG | 6–7.5 |
| Size | 1024 × 1024 或 832 × 1216（直式） |

> **BASE % 75** 表示前 75% 步數由主模型生成構圖，後 25% 交給 Refiner 細化線條與細節

---

## 模型安裝指南

所有模型檔案都放到 ComfyUI 對應資料夾後，**重啟 ComfyUI**，再按面板右上角 **CHECK** 重新讀取清單。

---

### Checkpoint（主模型）

放到：
```
C:\ComfyUI_windows_portable\ComfyUI\models\checkpoints\
```

| 模型 | 大小 | 適合 | 下載 |
|------|------|------|------|
| **novaAnimeXL ilV180** ⭐ | ~6GB | 動漫、插畫（推薦） | [CivitAI](https://civitai.com/models/376130/nova-anime-xl) |
| Stable Diffusion XL Base 1.0 | 6.9GB | 高品質寫實、通用 | [HuggingFace](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors) |
| DreamShaper XL | 2.1GB | 動漫、藝術風格 | [CivitAI](https://civitai.com/models/112902) |
| RealVisXL V4 | 3.9GB | 超寫實人像 | [CivitAI](https://civitai.com/models/139562) |
| Juggernaut XL | 6.9GB | 寫實人像、商業攝影 | [CivitAI](https://civitai.com/models/133005) |

下載頁面通常在 **Files** 分頁，點 `.safetensors` 旁邊的下載箭頭。

---

### Refiner 模型（可選）

Refiner 用於二階段生成，先用主模型跑大部分步數，再由 Refiner 細化細節，適合 SDXL 流程。

放到：
```
C:\ComfyUI_windows_portable\ComfyUI\models\checkpoints\
```

> 和主模型放同一個資料夾

| 模型 | 大小 | 說明 | 下載 |
|------|------|------|------|
| **JANKUTrainedChenkinNoobai v777** ⭐ | ~6GB | 動漫 Refiner（推薦，搭配 novaAnimeXL） | [CivitAI](https://civitai.com/models/1277670/janku-trained-chenkin-and-noobai-rouwei-illustrious-xl) |
| SDXL Refiner 1.0 | 6.1GB | 官方 Refiner，搭配 SDXL Base 使用 | [HuggingFace](https://huggingface.co/stabilityai/stable-diffusion-xl-refiner-1.0/resolve/main/sd_xl_refiner_1.0.safetensors) |

**使用方式：**
1. 在面板左側展開 **REFINER**
2. 選擇 Refiner 模型
3. 調整 **BASE %**（建議 70–80%，代表主模型跑完這個比例後交給 Refiner）

---

### LoRA

LoRA 是附加風格 / 人物 / 畫風的小型模型，可同時疊加最多 6 個。

放到：
```
C:\ComfyUI_windows_portable\ComfyUI\models\loras\
```

| 推薦來源 | 說明 |
|----------|------|
| [CivitAI LoRA](https://civitai.com/models?type=LORA) | 最大社群，分類齊全 |
| [HuggingFace](https://huggingface.co/models?library=diffusers&other=lora) | 官方 / 研究向 |

**使用方式：**
1. 下載 `.safetensors` 格式的 LoRA 檔案
2. 放到 `models/loras/` 後重啟 ComfyUI
3. 面板左側 **LORA** 區塊選取，強度建議 0.5–0.9
4. 可同時開啟多個 LoRA，強度會相加，不要全部設 1.0

> 注意：LoRA 必須與主模型版本相符（SD 1.5 的 LoRA 不能用在 SDXL 上）

---

### VAE（可選）

VAE 影響圖片色彩和銳利度，大部分現代模型已內建良好的 VAE，不一定需要額外下載。

放到：
```
C:\ComfyUI_windows_portable\ComfyUI\models\vae\
```

| 模型 | 適用 | 下載 |
|------|------|------|
| sdxl_vae.safetensors | SDXL 系列 | [HuggingFace](https://huggingface.co/stabilityai/sdxl-vae/resolve/main/sdxl_vae.safetensors) |
| vae-ft-mse-840000 | SD 1.5 系列 | [HuggingFace](https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors) |

**使用方式：** 面板左側展開 **VAE** → 選擇模型（選 `BUILT-IN` 則使用 Checkpoint 內建）

---

### Upscale 模型（可選）

用於 Pipeline → Upscaler，將生成結果放大 2–4 倍。

放到：
```
C:\ComfyUI_windows_portable\ComfyUI\models\upscale_models\
```

| 模型 | 適合 | 下載 |
|------|------|------|
| RealESRGAN_x4plus.pth | 通用寫實 4× | [GitHub](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth) |
| RealESRGAN_x4plus_anime_6B.pth | 動漫 4× | [GitHub](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth) |
| 4x-UltraSharp.pth | 超銳利通用 4× | [CivitAI](https://civitai.com/models/116225) |

---

## 解除瀏覽器限制（必要步驟）

面板使用 HTTPS（GitHub Pages），但 ComfyUI 在本機用 HTTP，Chrome / Edge 預設會封鎖此連線。

1. 用 Chrome / Edge 開啟面板網址
2. 網址列左側點 **🔒 → 網站設定**
3. 找到「**不安全的內容**」→ 改為「**允許**」
4. 重新整理頁面

> 每台電腦只需做一次

---

## 使用流程

```
1. 雙擊桌面「ComfyUI 後端」（等待出現 http://127.0.0.1:8188）
2. 開啟 Chrome → https://null0dv.github.io/void.gen/sd-dashboard.html
3. 右上角按 CHECK → 狀態點變綠色
4. 左側選模型 → 輸入 Prompt → 按 GENERATE
```

---

## 功能一覽

- TXT→IMG 生成 + IMG→IMG（圖生圖）+ IMG→TXT（WD14 反推標籤）
- 角色 Prompt 請用獨立專案 **VOID.RNG**（`void-rng/`），複製結果到 Full 左側 PROMPT
- 主模型 + Refiner 雙模型管線
- 最多 6 個 LoRA 同時疊加（可調強度）
- Hi-res Fix 潛空間放大 + Upscaler 像素放大
- Seed 鎖定復現、批次生成（×1 / ×2 / ×4 / ×8）
- WebSocket 即時生成預覽
- 提示詞快捷標籤（品質 / 風格 / 光線）
- Gallery 圖片 + metadata hover 顯示
- 全螢幕進度條
- PWA 可安裝為桌面 APP

## RTX 3050 動漫整合版

雙擊 `Start-Anime.cmd` 開啟 FULL，在工具列按 RNG 即可把抽詞追加或寫入草稿。WD14 辨識結果也能送回 RNG。預設讀取與本倉庫同層的 ComfyUI Windows Portable。若安裝在其他路徑，使用 `Start-Anime.cmd -ComfyRoot "C:\ComfyUI_windows_portable"`。請在 Portable 安裝 Nova Anime XL、ComfyUI-WD14-Tagger 及其模型，並確保內建 Python 可載入 aiohttp 與 Pillow。

本版使用本機 8081、8091、8190。輸入、輸出、圖庫與 ComfyUI 設定在第一次啟動時於本倉庫內建立。按啟動視窗的 Enter 可關閉本次服務。
