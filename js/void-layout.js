/* One workspace shell; existing inputs and handlers retain their identities. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const make=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text)el.textContent=text;return el;};
  const button=(text,action)=>{const el=make('button','vl-button',text);el.type='button';el.onclick=action;return el;};
  const studio=$('studio-dialog');
  const assets=make('aside','vl-assets');
  assets.setAttribute('aria-label','專案與素材');
  assets.append(make('p','vl-eyebrow','PROJECT & ASSETS'),make('h3','','專案與素材'),$('studio-projects'),studio.querySelector('.studio-attachments'));
  const help=make('p','vl-help','先選主圖，再加入服裝或構圖參考。每一輪都會保留成獨立版本。');
  assets.append(help);
  const settings=make('aside','vl-settings');
  settings.setAttribute('aria-label','目前生成設定');
  settings.append(make('p','vl-eyebrow','GENERATION'),make('h3','','生成設定'),studio.querySelector('.studio-composer-tools'));
  const tips=make('div','vl-tips');
  tips.append(make('strong','','描述你要改的地方'),make('p','','例如：「換成參考圖的外套，保留人物的臉、姿勢與背景。」'));
  settings.append(tips);
  studio.append(assets,settings);
  const title=make('div','vl-workspace-title');
  title.append(make('div','', '創作空間'));
  const intake=make('div','vl-intake');
  intake.append(
    button('＋ 從作品庫選圖',()=>VoidStudio.openPicker('img2img')),
    button('辨識圖片',()=>VoidStudio.openPicker('img2txt')),
    button('連續改圖',()=>VoidStudio.open()),
    button('抽詞靈感',()=>$('rng-open').click())
  );
  title.append(intake);
  $('center-panel').prepend(title);
  const modeNames={txt2img:'文生圖',img2img:'圖生圖',img2txt:'圖片辨識'};
  document.querySelectorAll('.mode-btn[data-mode]').forEach(el=>{
    el.textContent=modeNames[el.dataset.mode]||el.textContent;
    el.setAttribute('role','button');el.tabIndex=0;
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});
  });
  const videoLink=document.querySelector('.topbar-right a[href="void-motion.html"]');
  if(videoLink){
    const inline=button('圖片轉影片',()=>{VoidStudio.open();$('studio-mode').value='video';$('studio-mode').dispatchEvent(new Event('change'));});
    videoLink.replaceWith(inline);
  }
  const roleLabel=make('label','vl-role','參考用途');
  const role=make('select','sel');role.setAttribute('aria-label','參考圖片用途');
  for(const [value,text] of [['reference','一般參考'],['outfit','服裝參考'],['composition','構圖參考'],['style','風格參考']])role.add(new Option(text,value));
  const apply=button('插入修改指令',()=>{
    const instructions={outfit:'把主圖人物換上參考圖的服裝，保留主圖的臉、姿勢與背景。',composition:'參考第二張圖的構圖安排，保留主圖主體的外觀與服裝。',style:'採用參考圖的色彩與視覺風格，保留主圖的主體與構圖。'};
    if(instructions[role.value]){
      $('studio-prompt').value=instructions[role.value];
      $('studio-prompt').dispatchEvent(new Event('input',{bubbles:true}));
      $('studio-prompt').focus();
    }
  });
  roleLabel.append(role);assets.append(roleLabel,apply);
  const studioTitle=$('studio-title');studioTitle.textContent='編輯工作室';
  $('studio-prompt').placeholder='描述下一步修改…  Ctrl + Enter 送出';
  $('studio-projects').open=true;
  const observer=new MutationObserver(()=>{
    const view=document.body.dataset.fullView||'create';
    document.querySelectorAll('.full-workspaces button').forEach(el=>{
      if(el.dataset.fullView)el.setAttribute('aria-current',el.dataset.fullView===view?'page':'false');
    });
    title.firstElementChild.textContent=view==='library'?'作品庫':view==='queue'?'任務中心':'創作空間';
  });
  observer.observe(document.body,{attributes:true,attributeFilter:['data-full-view']});
  window.addEventListener('load',()=>{
    const right=document.querySelector('.topbar-right');
    const tools=make('section','vl-utility-bar');tools.hidden=true;tools.setAttribute('aria-label','工具與連線');
    for(const node of [...right.children]){
      if(!['api-dot','api-text'].includes(node.id))tools.append(node);
    }
    const toggle=button('工具與連線',()=>{
      tools.hidden=!tools.hidden;toggle.setAttribute('aria-expanded',String(!tools.hidden));
    });
    toggle.setAttribute('aria-expanded','false');right.prepend(toggle);
    document.querySelector('.topbar').after(tools);
  });
})();
