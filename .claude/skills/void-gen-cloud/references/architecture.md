# VOID GEN 雲端版：架構與路線圖

要改雲端流程、做下一階段時讀這份。日常操作看 SKILL.md。

## 目標

- 設定好之後完全不用碰終端機：介面上登入、選機器、開機、關機。
- 作品和圖庫永遠在本機，關機也不會遺失；Drive 只是同步。
- 冷開機 5 分鐘內可生圖；忘了關機最多浪費 15 分鐘。

## 核心問題

VOID 後台（`void_mobile.py` 的 `Gateway`）**直接掃描 `output` 資料夾**當圖庫（`self.output.rglob`），上傳圖**直接寫進 ComfyUI 的 `input` 資料夾**。所以 VOID 和 ComfyUI 必須在同一台機器。現在的雲端版只好把整個 VOID 搬上 VM，造成：圖在雲端、關機就消失、要手動搬、要掛 Drive 才能保存。

## 目標架構：本機介面＋雲端算力

```
┌──────────── 本機 ────────────────┐          ┌──── Colab（L4 / A100 / G4）────┐
│ VOID 介面（網頁 / VoidFull.exe）   │          │                                 │
│ VOID 後台 void_mobile.py           │  SSH 通道 │  ComfyUI :8188（只做運算）       │
│   ├ 圖庫資料庫（本機，永久）        │◄────────►│  colab_vm.py：平行裝套件＋下載    │
│   ├ 雲端管家：開機/登入/計費/關機   │          │  models.lock.json 驗 SHA-256     │
│   └ 鏡像同步：新圖拉回 output       │          │  閒置偵測 → 自動關機              │
│ output → Drive 電腦版同步（選用）   │          └─────────────────────────────────┘
└───────────────────────────────────┘
```

- 雲端 ComfyUI 轉到本機 `127.0.0.1:8188`（或 8189，避開本機 ComfyUI）。前端本來就直連 ComfyUI，看不出差別。
- **鏡像同步**取代檔案耦合：輪詢 ComfyUI `/history`，用 `/view` 把新圖下載進本機 `output`（同 subfolder、同檔名）；後台寫進 `input` 的上傳圖，用 `/upload/image` 推到雲端。
- 開關：設定裡選「本機／雲端」，後台的 `comfy=` 網址跟著換。

## 進度

### P1 雲端算力核心

| 項目 | 狀態 |
|---|---|
| 依序換機器、每台限時、清掉半開 session（`colab_cli.py start --gpu L4,A100,T4 --wait 120`） | ✅ 2026-11-22 實測（L4 第一台就開到；換機器的分支未觸發） |
| 模型清單單一來源 `models-v4.md` ＋ `models.lock.json`（大小、SHA-256） | ✅ 27 個檔案，2026-11-22 產生 |
| 下載與套件安裝平行、下載後驗證（`colab_vm.py`） | ✅ 2026-11-22 實測，SHA-256 全部通過 |
| 加裝引擎不重開機（`colab_cli.py add`；GGUF 節點開機就裝） | ✅ 2026-11-22 實測：Klein 84 秒、不重啟 |
| 關機前自動拉圖、分包 ≤60MB、只拉新檔（`fetch`、`stop`） | ✅ 2026-11-22 實測（5 張、1 包、5 秒；重複 fetch 回報沒有新圖） |
| 狀態檔遺失時用連接埠停服務（`fuser -k`） | ✅ 已寫，未實測（這次狀態檔正常） |
| `stop` 改成背景停服務再輪詢（避開 exec 60 秒上限） | ✅ 已寫，未實測（實測時舊寫法花了 5 分鐘） |
| 上傳包含 PRO 根目錄的 VOID 後台正本（`GATEWAY_FILES`） | ✅ 2026-11-22 實測，VOID_READY |
| 本機介面＋雲端 ComfyUI＋鏡像同步 | ⬜ 未做（要改 `void_mobile.py`） |
| 雲端閒置自動關機（VM 上 watchdog：N 分鐘沒任務就 `colab stop` 自己） | ⬜ 未做 |
| `colab exec` 連不上時自動改走 SSH（`vm()` 失敗改用 `colab ssh --proxy-mode`；`fetch` 改用 scp） | ⬜ 未做；目前用 `PROoid-ssh.ps1`、`void-scp.ps1` 手動接手 |
| 批次圖轉影片 `colab_cli.py motion`（Wan 2.2） | ✅ 2026-11-22 實測 3 支 10 秒片 |

### P2 介面與安裝

| 項目 | 狀態 |
|---|---|
| VOID「雲端」面板：登入（網址＋授權碼輸入框）、選機器、開關機、計費表、引擎下載按鈕 | ⬜ |
| 一鍵安裝：uv、colab CLI、SSH 金鑰全部進 `%LOCALAPPDATA%\VOID` | ⬜ |
| `VoidFull.exe`（VOID-Native，WebView2）加本機／雲端切換，關窗詢問關機 | ⬜ |

### P3 影片與 Drive

| 項目 | 狀態 |
|---|---|
| H3（shanshiba）、Wan 2.2 當「影片」引擎，用另一台 VM | 🟡 Wan 已能用 `colab_cli.py motion` 批次跑（2026-11-22 實測）；H3 仍用 `h3-run.ps1` 手動跑；兩者都還沒接進介面 |
| Drive 同步：建議裝 Google 雲端硬碟電腦版，`fetch --dest` 指到同步資料夾 | ⬜ 使用者尚未安裝 |

## 設計決定

- **不在 VM 掛 Drive 存模型。** Colab 從 HuggingFace 下載很快（shanshiba 實測 55GB 約 3 分鐘），每次重抓比讀 Drive 快，也省掉授權步驟。
- **不上傳模型。** colab upload 約 90MB 以上不穩；模型一律雲端自己抓，找不到來源才分塊上傳。
- **GGUF 節點開機就裝。** 它很小，裝了之後加 Klein／Qwen／Wan 不必重啟 ComfyUI。MOSS、Florence 節點相依套件較重，仍用到才裝（會重啟）。
- **介面不重寫成原生。** 維持網頁 UI，原生只做 WebView2 外殼；兩套介面維護成本太高。
