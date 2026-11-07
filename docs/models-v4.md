# VOID FULL V4 模型下載

路徑以 `ComfyUI_windows_portable/ComfyUI/models/` 為起點。下載後保留表列檔名。自訂節點放到 `ComfyUI/custom_nodes/`，用 Portable 內建的 `python_embeded/python.exe` 安裝各節點文件指定的相依套件。完成後重啟 ComfyUI，在 VOID 按「更新模型」。

先裝 SDXL 跑一張圖，再依需要裝 Klein、Florence-2、Wan 及其他引擎。各組權重可分開安裝。下載前請確認顯卡、磁碟空間與模型授權。

## SDXL · 文生圖、圖生圖

ComfyUI 內建。SDXL Base 可用來驗證安裝。

| 下載檔案 | 放入 models 下的資料夾 |
| --- | --- |
| [sd_xl_base_1.0.safetensors](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors) | `checkpoints/` |

## FLUX.2 Klein 9B · 連續改圖

需要 [ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF)。

| 下載檔案 | 放入 models 下的資料夾 |
| --- | --- |
| [flux-2-klein-9b-Q4_K_M.gguf](https://huggingface.co/unsloth/FLUX.2-klein-9B-GGUF/resolve/main/flux-2-klein-9b-Q4_K_M.gguf) | `diffusion_models/` |
| [qwen_3_8b_fp4mixed.safetensors](https://huggingface.co/Comfy-Org/Flux-2-Klein-9B/resolve/main/split_files/text_encoders/qwen_3_8b_fp4mixed.safetensors) | `text_encoders/` |
| [flux2-vae.safetensors](https://huggingface.co/Comfy-Org/Flux-2-Klein-9B/resolve/main/split_files/vae/flux2-vae.safetensors) | `vae/` |

## Qwen Image 2.1 · 生圖與改圖

需要 ComfyUI-GGUF 及新版 ComfyUI 的 Qwen 編輯節點。

| 下載檔案 | 放入 models 下的資料夾 |
| --- | --- |
| [qwen-image-2.1-UC-Q4_K_M.gguf](https://huggingface.co/abenzerps/Qwen-Image-2.1-Uncensored-Quantized/resolve/main/qwen-image-2.1-UC-Q4_K_M.gguf) | `diffusion_models/` |
| [qwen3vl_8b_int8_convrot.safetensors](https://huggingface.co/abenzerps/Qwen-Image-2.1-Uncensored-Quantized/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | `text_encoders/` |
| [qwen_image_2.1_vae_bf16.safetensors](https://huggingface.co/abenzerps/Qwen-Image-2.1-Uncensored-Quantized/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors) | `vae/` |

## MOSS Image · 生圖與改圖

需要 [Comfyui-Moss-Image-T8](https://github.com/T8mars/Comfyui-Moss-Image-T8/tree/c045ac07e48b202d8f9df76992b8446c0cea663b)。

| 下載檔案 | 放入 models 下的資料夾 |
| --- | --- |
| [moss-image-sft-bf16.safetensors](https://huggingface.co/t8star/Moss-Image-Comfy/resolve/f915fc11d561db1a01201ceeee555783f47adb5d/diffusion_models/moss-image-sft-bf16.safetensors) | `diffusion_models/` |
| [moss-image-qwen35-bf16.safetensors](https://huggingface.co/t8star/Moss-Image-Comfy/resolve/f915fc11d561db1a01201ceeee555783f47adb5d/text_encoders/moss-image-qwen35-bf16.safetensors) | `text_encoders/` |
| [moss-image-vae.safetensors](https://huggingface.co/t8star/Moss-Image-Comfy/resolve/f915fc11d561db1a01201ceeee555783f47adb5d/vae/moss-image-vae.safetensors) | `vae/` |

## Wan 2.2 · 圖片轉影片

需要 ComfyUI-GGUF。依照 [VOID 影片工作流](../mobile_motion_graph.json) 安裝其餘缺少的節點。

| 下載檔案 | 放入 models 下的資料夾 |
| --- | --- |
| [wan2.2_i2v_high_noise_14B_Q3_K_S.gguf](https://huggingface.co/bullerwins/Wan2.2-I2V-A14B-GGUF/resolve/main/wan2.2_i2v_high_noise_14B_Q3_K_S.gguf) | `diffusion_models/` |
| [wan2.2_i2v_low_noise_14B_Q3_K_S.gguf](https://huggingface.co/bullerwins/Wan2.2-I2V-A14B-GGUF/resolve/main/wan2.2_i2v_low_noise_14B_Q3_K_S.gguf) | `diffusion_models/` |
| [umt5-xxl-encoder-Q3_K_S.gguf](https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q3_K_S.gguf) | `text_encoders/` |
| [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `vae/` |
| [wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors) | `loras/` |
| [wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors) | `loras/` |

## Florence-2 · 圖片轉文字

需要 [ComfyUI-Florence2](https://github.com/kijai/ComfyUI-Florence2/tree/9ece3de914214c5f581d725167bc9d0eeb0d1120)。下載同一版本的權重與設定檔。

| 下載檔案 | 放入 models 下的資料夾 |
| --- | --- |
| [model.safetensors](https://huggingface.co/microsoft/Florence-2-large/resolve/21a599d414c4d928c9032694c424fb94458e3594/model.safetensors) | `LLM/Florence-2-large/` |
| [config.json](https://huggingface.co/microsoft/Florence-2-large/resolve/21a599d414c4d928c9032694c424fb94458e3594/config.json) | `LLM/Florence-2-large/` |
| [generation_config.json](https://huggingface.co/microsoft/Florence-2-large/resolve/21a599d414c4d928c9032694c424fb94458e3594/generation_config.json) | `LLM/Florence-2-large/` |
| [preprocessor_config.json](https://huggingface.co/microsoft/Florence-2-large/resolve/21a599d414c4d928c9032694c424fb94458e3594/preprocessor_config.json) | `LLM/Florence-2-large/` |
| [tokenizer.json](https://huggingface.co/microsoft/Florence-2-large/resolve/21a599d414c4d928c9032694c424fb94458e3594/tokenizer.json) | `LLM/Florence-2-large/` |
| [tokenizer_config.json](https://huggingface.co/microsoft/Florence-2-large/resolve/21a599d414c4d928c9032694c424fb94458e3594/tokenizer_config.json) | `LLM/Florence-2-large/` |
| [vocab.json](https://huggingface.co/microsoft/Florence-2-large/resolve/21a599d414c4d928c9032694c424fb94458e3594/vocab.json) | `LLM/Florence-2-large/` |

## Moody Moss · 選用

主權重 `moodyMossMixFreeDownload_v4125STEPSCFG3_fp8.safetensors` 需要從原發布者取得，確切版本下載尚未核實。放入 `diffusion_models/`，VAE 共用 Klein 的 `flux2-vae.safetensors`。

| 下載檔案 | 放入 models 下的資料夾 |
| --- | --- |
| [qwen3.5_9b_w4a8_gptq.safetensors](https://huggingface.co/Comfy-Org/MOSS-Image/resolve/main/text_encoders/qwen3.5_9b_w4a8_gptq.safetensors) | `text_encoders/` |

## 其他選用資源

- **Nova Anime XL IL V1.8** 放入 `checkpoints/`。從發布頁選擇 IL V1.8（版本 2837020）。本機配方使用 `novaAnimeXL_ilV180.safetensors`，如需重用該配方，可在確認版本後以此名稱存放。[Civitai 版本頁](https://civitai.com/models/376130?modelVersionId=2837020)
- **WD14 標籤辨識** 安裝節點並依其說明取得權重。[ComfyUI-WD14-Tagger](https://github.com/pythongosssss/ComfyUI-WD14-Tagger)
- **Klein 寫實 LoRA** 部分圖生圖模式需要 `klein9b-anything-to-real.safetensors`，放入 `loras/`。確切版本來源尚未核實。Klein 連續改圖可先用上表的三個檔案試跑。
- **DesireX** 工作流指定 `BSS_DesireX3_Q4_K_M.gguf`，主權重來源尚未核實。手上已有相同主權重時，可放到 `diffusion_models/`，搭配 [文字編碼器](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors) 放到 `text_encoders/`、[VAE](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors) 放到 `vae/`。
- **個人 LoRA** 依配方需求另行取得，放到 `loras/`。有登入或授權要求時，請在模型發布頁完成。
