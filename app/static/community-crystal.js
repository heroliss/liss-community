/* Ink and its cast shadow move together in CSS 3D. The room's light stays
   fixed; repainting glyph shadows on every pointer frame is expensive. */
(function(){
  'use strict';
  var key='__lissCommunityCrystal';
  if(window[key])window[key].destroy();
  window[key]={inspect:function(){return{shadowMode:'fixed-world-light',dynamicInkPaint:false,frameWrites:0,ownRAF:false,hdrClaim:false};},destroy:function(){delete window[key];}};
})();
