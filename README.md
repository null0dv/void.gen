# SD 生成面板

> 本地 Stable Diffusion 生成介面，基於 ComfyUI — 免費、無限制、完全在你的電腦上運行

## 使用此面板

**[https://null0dv.github.io/sd-panel/sd-dashboard.html](https://null0dv.github.io/sd-panel/sd-dashboard.html)**

> 此面板需要在你的電腦上安裝並啟動 ComfyUI 才能運作

---

## 快速安裝（Windows + NVIDIA GPU）

### 方法一：自動安裝腳本（推薦）

1. 下載 **[install.ps1](install.ps1)**
2. 右鍵 → **用 PowerShell 執行**
3. 等待安裝完成（首次約 5–10 分鐘，需下載 ~2GB）
4. 腳本結束後依照提示下載 AI 模型

### 方法二：手動安裝

<details>
<summary>展開手動安裝步驟</summary>

**步驟 1 — 下載 ComfyUI Windows Portable**

前往 [ComfyUI Releases](https://github.com/comfyanonymous/ComfyUI/releases/latest)，下載 `ComfyUI_windows_portable_nvidia_*.7z`，解壓到 `C:\ComfyUI_portable`

**步驟 2 — 設定啟動參數**

編輯 `run_nvidia_gpu.bat`，改成：
```bat
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --lowvram --enable-cors-header *
pause
```

**步驟 3 — 下載 AI 模型**

下載任一 Stable Diffusion 模型（`.safetensors`），放到：
```
C:\ComfyUI_portable\ComfyUI\models\checkpoints\
```

</details>

---

## 系統需求

| 項目 | 最低 | 推薦 |
|------|------|------|
| 作業系統 | Windows 10 | Windows 11 |
| 顯卡 | NVIDIA 4GB VRAM | NVIDIA 8GB+ VRAM |
| 記憶體 | 8GB RAM | 16GB RAM |
| 硬碟空間 | 15GB | 50GB+ |

> AMD 顯卡請改用 [ComfyUI DirectML 版本](https://github.com/comfyanonymous/ComfyUI/releases)

---

## 推薦 AI 模型

| 模型 | 大小 | 適合 | 下載 |
|------|------|------|------|
| Stable Diffusion XL Base 1.0 | 6.9GB | 高品質寫實、通用 | [HuggingFace](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors) |
| DreamShaper XL | 2.1GB | 動漫、藝術風格 | [CivitAI](https://civitai.com/models/112902) |
| RealVisXL | 3.9GB | 超寫實人像 | [CivitAI](https://civitai.com/models/139562) |

下載後放到 `ComfyUI\models\checkpoints\` 並重啟 ComfyUI。

---

## 解除瀏覽器限制（必要步驟）

此面板使用 HTTPS（GitHub Pages），但 ComfyUI 在本機用 HTTP，Chrome 預設會封鎖此連線。

**解法：**

1. 用 Chrome / Edge 開啟面板網址
2. 網址列左側點 **🔒 → 網站設定**
3. 找到「**不安全的內容**」→ 改為「**允許**」
4. 重新整理頁面

> 每台電腦只需做一次

---

## 安裝後使用流程

```
1. 雙擊桌面「ComfyUI 後端」啟動（等待出現 "To see the GUI go to: http://127.0.0.1:8188"）
2. 開啟 Chrome → https://null0dv.github.io/sd-panel/sd-dashboard.html
3. 點「🔌 檢查連線」→ 顯示綠色表示成功
4. 選擇模型 → 輸入提示詞 → ▶ 開始生成
```

---

## 功能一覽

- 基礎模型 + Refiner 雙模型管線
- 最多 6 個 LoRA 同時疊加
- Hi-res Fix + Upscaler 高清放大
- Seed 鎖定復現、批次生成
- 實時生成預覽（進度條旁）
- 提示詞快捷標籤（品質 / 風格 / 光線）
- 圖片 Gallery + metadata 顯示
- PWA 可安裝為桌面 APP
