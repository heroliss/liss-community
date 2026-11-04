/* Picker stills use the live scene factories, at one desktop composition.
   Only visible tiles are retained. Motion never starts; optical water is
   copied once to 2D and its temporary WebGL context is released immediately. */
(function(){
  'use strict';
  if(window.LissBackgroundPreviewsV49)return;
  var width=1280,height=720;
  function create(gallery){
    var records=new Map(),intersection=null,resize=null,closed=false;
    function fit(record){
      if(!record.stage)return;
      var size=record.node.getBoundingClientRect();
      var scale=Math.max(size.width/width,size.height/height);
      record.stage.style.transform='translate('+((size.width-width*scale)/2)+'px,'+((size.height-height*scale)/2)+'px) scale('+scale+')';
    }
    function ground(stage){
      // A custom room pigment can change without changing light/dark mode.
      // Refresh its cheap CSS ground without rebuilding the scene buffers.
      var room=getComputedStyle(document.body),backdrop=getComputedStyle(document.body,'::before');
      stage.style.setProperty('--bg',room.getPropertyValue('--bg'));
      stage.style.background=backdrop.background;
      stage.style.backgroundColor=room.backgroundColor||room.getPropertyValue('--bg');
    }
    function release(record){
      if(resize)resize.unobserve(record.node);
      if(record.scene)record.scene.destroy();
      if(record.stage)record.stage.remove();
      record.scene=record.stage=null;record.node.removeAttribute('data-scene-preview-ready');
    }
    function render(record){
      if(closed||record.stage||!window.LissProceduralScenes)return;
      var stage=document.createElement('div'),scene=null;
      stage.className='background-scene-preview';stage.setAttribute('aria-hidden','true');
      // The transparent CSS/SVG originals sit on the same room ground as the
      // real viewport, rather than inheriting the selection panel's pigment.
      ground(stage);
      try{
        scene=window.LissProceduralScenes.create(Object.assign({},record.entry,{preview:true}));
        scene.setMotion(false);scene.resize(width,height,record.light);
        var root=scene.element,state=scene.inspect();
        if(state.glContexts){
          var source=root.querySelector('canvas'),copy=document.createElement('canvas');
          copy.width=source.width;copy.height=source.height;copy.className=source.className;
          var context=copy.getContext('2d');if(!context)throw Error('2D snapshot unavailable');
          context.drawImage(source,0,0);scene.destroy();scene=null;
          root.replaceChildren(copy);
        }
        stage.appendChild(root);record.node.appendChild(stage);record.stage=stage;record.scene=scene;
        record.node.dataset.scenePreviewReady='true';fit(record);if(resize)resize.observe(record.node);
      }catch(error){if(scene)scene.destroy();stage.remove();}
    }
    function observe(){
      if(!resize&&typeof ResizeObserver==='function')resize=new ResizeObserver(function(entries){entries.forEach(function(item){var r=records.get(item.target);if(r)fit(r);});});
      if(!intersection&&typeof IntersectionObserver==='function')intersection=new IntersectionObserver(function(entries){
        entries.forEach(function(item){var record=records.get(item.target);if(!record)return;record.visible=item.isIntersecting;if(record.visible)render(record);else release(record);});
      },{root:gallery,rootMargin:'100px'});
    }
    function paint(node,entry,light){
      if(closed||!entry||entry.kind!=='vector')return;
      node.dataset.scenePreviewManaged='true';
      observe();var record=records.get(node),key=entry.id+':'+!!light;
      if(record&&record.key!==key){release(record);record.entry=entry;record.light=!!light;record.key=key;}
      if(!record){
        record={node:node,entry:entry,light:!!light,key:key,stage:null,scene:null,visible:false};records.set(node,record);
        // The detail preview is outside the scroll gallery and is immediate.
        if(intersection&&gallery&&gallery.contains(node))intersection.observe(node);else record.visible=true;
      }
      if(record.stage)ground(record.stage);
      if(record.visible)render(record);else if(!intersection)render(record);
    }
    function clear(node){node.removeAttribute('data-scene-preview-managed');var record=records.get(node);if(!record)return;release(record);if(intersection)intersection.unobserve(node);records.delete(node);}
    function releaseAll(){
      records.forEach(release);records.clear();if(intersection)intersection.disconnect();if(resize)resize.disconnect();intersection=resize=null;
    }
    return{paint:paint,clear:clear,releaseAll:releaseAll,destroy:function(){releaseAll();closed=true;},inspect:function(){var active=0;records.forEach(function(r){if(r.stage)active++;});return{tracked:records.size,retainedScenes:active,ownRAF:false,persistentWebGLContexts:0,viewport:{width:width,height:height}};}};
  }
  window.LissBackgroundPreviewsV49=Object.freeze({create:create});
})();
