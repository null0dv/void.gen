# Void.gen Full V3

## Canonical entry

- **Desktop:** `VOID.GEN FULL.lnk` → `VOID-GEN-FULL.cmd` or `啟動 VOID.GEN FULL.bat`
- **URL:** `http://localhost:8080/sd-dashboard.full.html`
- `sd-dashboard.full.v2.html` redirects to `sd-dashboard.full.html`

## V3 changes (from V2)

- VOID.RNG fully separated into standalone `void-rng/` project (port 8787)
- Full panel modes: TXT→IMG + IMG→TXT only (no embedded character PROMPT)
- PWA cache `sd-panel-v25`

## Architecture

| Module | Role |
|--------|------|
| `js/void-boot.js` | `file://` warning, early stubs |
| `js/void-gallery-db.js` | IndexedDB: gallery, lora thumbs, folder handle |
| `js/void-gen-flow.js` | Generation state on `body[data-void-gen-state]` |
| `js/void-jszip-loader.js` | On-demand JSZip for gallery ZIP export |
| `js/void-pwa.js` | Service worker registration |
| `sd-dashboard.full.html` | UI shell + ComfyUI + gallery UI |

## VOID.RNG（獨立專案）

見 **`void-rng/README.md`**。與 Full 分離，port **8787**。

## IndexedDB

- Database: `void-gen-db` v3
- Stores: `gallery`, `lora-thumbs`, `folder-handle`
- Gallery list uses buffered load + `IntersectionObserver` (`GALLERY_PAGE` = 40)

## PWA

- `sw.js` cache key `sd-panel-v25`
- ComfyUI API requests bypass cache (network-only)

## Deprecated

- `sd-dashboard.optimized.html` — experimental snapshot