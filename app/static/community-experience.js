/* Small native UX enhancements. Real inputs stay still; light moves on a leaf. */
(function(){
  'use strict';
  var KEY='__lissCommunityExperience';
  if(window[KEY])window[KEY].destroy();
  var lifetime=new AbortController(),dispose=null,inspect=null;
  function mount(){
    if(dispose)dispose();
    var abort=new AbortController(),signal=abort.signal,reduce=matchMedia('(prefers-reduced-motion:reduce)'),fine=matchMedia('(hover:hover) and (pointer:fine)');
    var wrappers=[],buttons=[],glints=[],timers=new Set(),frame=0,active=null,x=0,closed=false;
    document.querySelectorAll('.reading-prose pre').forEach(function(pre){
      if(pre.closest('.code-well'))return;
      var box=document.createElement('div');box.className='code-well';pre.before(box);box.append(pre);
      var button=document.createElement('button');button.type='button';button.className='code-copy';button.textContent='复制';button.setAttribute('aria-label','复制代码');
      var status=document.createElement('span');status.className='sr-only';status.setAttribute('role','status');status.setAttribute('aria-live','polite');box.append(button,status);wrappers.push({box:box,pre:pre});
      button.addEventListener('click',async function(){
        try{
          if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error('unavailable');
          await navigator.clipboard.writeText(pre.textContent);
          if(closed)return;button.textContent='已复制';status.textContent='代码已复制';
          var timer=setTimeout(function(){timers.delete(timer);if(!closed)button.textContent='复制';},1800);timers.add(timer);
        }catch(e){if(!closed){status.textContent='无法自动复制，请选择代码后复制。';button.textContent='请手动复制';}}
      },{signal:signal});
    });
    document.querySelectorAll('input[type=password]').forEach(function(input){
      var group=input.closest('.form-group');if(!group)return;
      var button=document.createElement('button');button.type='button';button.className='password-reveal';button.textContent='显示';button.setAttribute('aria-label','显示'+((group.querySelector('label')||{}).textContent||'密码').replace(/\*/g,'').trim());button.setAttribute('aria-pressed','false');input.dataset.passwordReveal='';group.append(button);buttons.push({button:button,input:input});
      button.addEventListener('click',function(){var show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'隐藏':'显示';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',(show?'隐藏':'显示')+((group.querySelector('label')||{}).textContent||'密码').replace(/\*/g,'').trim());},{signal:signal});
    });
    document.querySelectorAll('.site-form .form-group:not(.writing-field):not(.form-checkbox)').forEach(function(group){
      if(!group.querySelector('.form-control'))return;
      var glint=document.createElement('span');glint.className='field-glint';glint.setAttribute('aria-hidden','true');group.append(glint);group.classList.add('has-field-glint');glints.push({group:group,glint:glint});
    });
    function allowed(){return !closed&&!document.hidden&&fine.matches&&!reduce.matches&&document.documentElement.dataset.roomMotion!=='paused';}
    function stop(){if(frame)cancelAnimationFrame(frame);frame=0;active=null;}
    function paint(){frame=0;if(!active||!allowed()||active.group.contains(document.activeElement))return;active.glint.style.transform='translate3d('+Math.max(0,Math.min(active.bounds.width-56,x-active.bounds.left-28)).toFixed(1)+'px,0,0)';}
    glints.forEach(function(item){
      item.group.addEventListener('pointerenter',function(e){if(e.pointerType==='touch'||!allowed())return;item.bounds=item.group.getBoundingClientRect();active=item;x=e.clientX;if(!frame)frame=requestAnimationFrame(paint);},{passive:true,signal:signal});
      item.group.addEventListener('pointermove',function(e){if(active!==item||!allowed()||item.group.contains(document.activeElement))return;x=e.clientX;if(!frame)frame=requestAnimationFrame(paint);},{passive:true,signal:signal});
      item.group.addEventListener('pointerleave',function(){if(active===item)stop();},{passive:true,signal:signal});
      item.group.addEventListener('focusin',stop,{signal:signal});
    });
    document.addEventListener('visibilitychange',stop,{signal:signal});window.addEventListener('resize',stop,{passive:true,signal:signal});window.addEventListener('liss:motion-state',stop,{signal:signal});reduce.addEventListener('change',stop,{signal:signal});fine.addEventListener('change',stop,{signal:signal});
    inspect=function(){return{version:'experience-v24',inputGeometry:'stationary',codeWells:wrappers.length,passwordControls:buttons.length,fieldLights:glints.length,framePending:!!frame};};
    dispose=function(){closed=true;abort.abort();stop();timers.forEach(clearTimeout);timers.clear();wrappers.forEach(function(w){if(w.box.parentNode){w.box.before(w.pre);w.box.remove();}});buttons.forEach(function(b){b.input.type='password';delete b.input.dataset.passwordReveal;b.button.remove();});glints.forEach(function(g){g.glint.remove();g.group.classList.remove('has-field-glint');});inspect=null;};
  }
  window.addEventListener('pagehide',function(){if(dispose)dispose();},{signal:lifetime.signal});window.addEventListener('pageshow',function(e){if(e.persisted)mount();},{signal:lifetime.signal});
  window[KEY]={inspect:function(){return inspect?inspect():{mounted:false};},destroy:function(){if(dispose)dispose();lifetime.abort();delete window[KEY];}};mount();
})();
