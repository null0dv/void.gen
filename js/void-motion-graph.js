/* Native Wan 2.2 I2V graph with GGUF loaders and Lightx2v acceleration. */
(function(root){
function buildMotionGraph(p){
  const g={}, add=(id,type,inputs)=>g[id]={class_type:type,inputs};
  add('1','CLIPLoaderGGUF',{clip_name:'umt5-xxl-encoder-Q3_K_S.gguf',type:'wan'});
  add('2','CLIPTextEncode',{clip:['1',0],text:p.prompt});
  add('3','CLIPTextEncode',{clip:['1',0],text:p.negative||'blurry, distorted face, deformed hands, flickering, watermark, subtitles'});
  add('4','VAELoader',{vae_name:'wan_2.1_vae.safetensors'});
  add('5','LoadImage',{image:p.image});
  add('6','WanImageToVideo',{positive:['2',0],negative:['3',0],vae:['4',0],start_image:['5',0],width:p.width,height:p.height,length:p.frames,batch_size:1});
  for(const [base,noise] of [[10,'high'],[20,'low']]){
    add(String(base),'UnetLoaderGGUFAdvanced',{unet_name:`wan2.2_i2v_${noise}_noise_14B_Q3_K_S.gguf`,dequant_dtype:'default',patch_dtype:'default',patch_on_device:true});
    add(String(base+1),'LoraLoaderModelOnly',{model:[String(base),0],lora_name:`wan2.2_i2v_lightx2v_4steps_lora_v1_${noise}_noise.safetensors`,strength_model:1});
    add(String(base+2),'ModelSamplingSD3',{model:[String(base+1),0],shift:5});
  }
  const common={noise_seed:p.seed,steps:4,cfg:1,sampler_name:'euler',scheduler:'simple',positive:['6',0],negative:['6',1]};
  add('30','KSamplerAdvanced',{...common,model:['12',0],add_noise:'enable',latent_image:['6',2],start_at_step:0,end_at_step:2,return_with_leftover_noise:'enable'});
  add('31','KSamplerAdvanced',{...common,model:['22',0],add_noise:'disable',latent_image:['30',0],start_at_step:2,end_at_step:4,return_with_leftover_noise:'disable'});
  add('32','VAEDecodeTiled',{samples:['31',0],vae:['4',0],tile_size:256,overlap:64,temporal_size:16,temporal_overlap:4});
  add('33','CreateVideo',{images:['32',0],fps:p.fps});
  add('34','SaveVideo',{video:['33',0],filename_prefix:'VOID-Motion/wan22',format:'mp4',codec:'h264'});
  return g;
}
root.buildMotionGraph=buildMotionGraph;
if(typeof module!=='undefined')module.exports=buildMotionGraph;
})(typeof window!=='undefined'?window:globalThis);
