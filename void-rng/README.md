# VOID.RNG V3

獨立 Prompt 生成器：風格 / 角色 / 飾品亂數組合，附 Grok 翻譯代理。

與 **VOID.GEN Full** 完全分離，必須在本目錄啟動。

## 開啟

1. 雙擊 **`VOID-RNG.cmd`**（或上一層 **`啟動 VOID.RNG.bat`**）
2. 等待視窗出現 `Press Ctrl+C to stop`
3. 瀏覽器開啟 **http://127.0.0.1:8787/**

## 需求

- Python 3（優先 ComfyUI embedded python，否則 `py` / `python`）
- Port **8787** 未被占用

## 架構

| 層級 | 說明 |
|------|------|
| 執行 / UI | `js/rng-engine.js` + `index.html` |
| 辭庫 | `data/*.json`（29 檔，啟動時自動套用） |
| 伺服器 | `grok-proxy.py`（8787 + `/chat` Grok 代理） |

已移除：RNG2 實驗版、VOID.GEN 嵌入、舊版啟動腳本。

## 目錄

```
void-rng/
  VOID-RNG.cmd      啟動入口
  grok-proxy.py     本機伺服器
  index.html        主頁
  data/             整合辭庫（manifest v3）
  js/               引擎與搜尋
  css/              樣式
  tools/            check-standalone.py
```

## 常見問題

| 症狀 | 處理 |
|------|------|
| 引擎載入失敗 | 確認 `http://127.0.0.1:8787/`，Ctrl+F5 |
| Port 8787 占用 | 關閉舊 VOID.RNG 視窗後重開 |
| Grok 翻譯失敗 | 搜尋面板填 xAI API Key |