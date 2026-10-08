(function(root){
'use strict';
const D=ReviewData,R=ROIReview,$=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
const svgEl=(tag,attrs={})=>{const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
class Viewer{
 constructor(){this.data=null;this.scale=1;this.tool='pan';this.selected=0;this.source=true;this.masks=false;this.points=[];this.polygon=null;this.anchor=null;this.proposals=[];this.pins=[];this.handlers={};this.drag=null;this.mode='overlay';this.reviewVisible=true;this.syncing=false;this.setupComparison();
 $('stage').addEventListener('pointerdown',e=>this.pointerDown(e));$('stage').addEventListener('pointermove',e=>this.pointerMove(e));$('stage').addEventListener('pointerup',e=>this.pointerUp(e));$('stage').addEventListener('pointercancel',()=>this.drag=null);
 $('stage').addEventListener('wheel',e=>{if(!this.data)return;e.preventDefault();this.zoom(this.scale*(e.deltaY>0?.86:1.16));},{passive:false});
 $('toggleSource').onclick=()=>{this.source=!this.source;this.renderSource();};$('maskMode').onclick=()=>{this.masks=!this.masks;this.renderImage();this.renderSource();};$('showIds').onchange=()=>this.renderSource();$('gain').oninput=()=>this.renderImage();
 $('fit').onclick=()=>this.fit();$('zoom1').onclick=()=>this.zoom(1);$('zoom2').onclick=()=>this.zoom(2);
 document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>this.setTool(b.dataset.tool));$('undoPoint').onclick=()=>this.undo();$('finishPolygon').onclick=()=>this.finish();$('clearDraft').onclick=()=>this.clearDraft();
 $('objectSelect').onchange=()=>{this.selected=Number($('objectSelect').value)||0;this.renderSource();this.handlers.onSelection?.(this.selected);};
 document.addEventListener('keydown',e=>{if(!this.data||$('viewer').classList.contains('hidden')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key.toLowerCase()==='b'){e.preventDefault();this.setMode(this.mode==='raw'?'overlay':'raw');return;}if(e.code==='Space'){this.space=true;e.preventDefault();}if(e.key==='Escape'){this.clearDraft();}if(e.key==='Backspace'&&this.tool==='polygon'){e.preventDefault();this.undo();}if(e.key==='Enter'&&this.tool==='polygon'){e.preventDefault();this.finish();}});document.addEventListener('keyup',e=>{if(e.code==='Space')this.space=false;});window.addEventListener('resize',()=>{if(this.data)this.fit();});
 }
 open(d,handlers){this.data=d;this.handlers=handlers;this.selected=0;this.source=true;this.masks=false;this.proposals=[];this.pins=[];this.mode='overlay';this.reviewVisible=true;$('reviewMarks').checked=true;this.layoutComparison();this.clearDraft();this.setTool('pan');$('gain').value='1';$('maskMode').disabled=d.kind!=='bbbc038';$('showIds').checked=false;
 const opts=[new Option('Whole image','0'),...d.objects.map(o=>new Option((d.kind==='fiji'?'ROI ':'Mask ')+o.index+' · '+o.name,String(o.index)))];$('objectSelect').replaceChildren(...opts);this.renderImage();this.renderSource();requestAnimationFrame(()=>this.fit());}
 close(){this.data=null;this.points=[];this.proposals=[];this.pins=[];this.polygon=null;this.anchor=null;}
 renderImage(){const d=this.data;if(!d)return;const rawMode=this.mode==='raw',filled=!rawMode&&this.masks&&d.kind==='bbbc038';let a=filled?D.maskRGBA(d,this.selected):D.rgba(d);const gain=Number($('gain').value);if(gain!==1&&!filled){a=new Uint8ClampedArray(a);for(let i=0;i<a.length;i+=4)for(let c=0;c<3;c++)a[i+c]=Math.min(255,Math.round(a[i+c]*gain));}const c=$('imageCanvas');c.width=d.w;c.height=d.h;c.getContext('2d').putImageData(new ImageData(a,d.w,d.h),0,0);if(this.mode==='split'){let raw=D.rgba(d);if(gain!==1){raw=new Uint8ClampedArray(raw);for(let i=0;i<raw.length;i+=4)for(let k=0;k<3;k++)raw[i+k]=Math.min(255,Math.round(raw[i+k]*gain));}const rc=$('compareOriginalCanvas');rc.width=d.w;rc.height=d.h;rc.getContext('2d').putImageData(new ImageData(raw,d.w,d.h),0,0);}this.updateComparisonUI();}
 renderSource(){const d=this.data;if(!d)return;const cv=$('boundaryCanvas');cv.width=d.w;cv.height=d.h;const svg=$('sourceSvg');svg.setAttribute('viewBox',`0 0 ${d.w} ${d.h}`);svg.replaceChildren();$('toggleSource').classList.toggle('active',this.source);$('maskMode').classList.toggle('active',this.masks);
 if(this.masks)this.renderImage();this.updateComparisonUI();if(!this.source||this.mode==='raw')return;
 if(d.kind==='bbbc038'){const layer=D.sourceOutlineRGBA(d,this.selected);cv.getContext('2d').putImageData(new ImageData(layer,d.w,d.h),0,0);}else{for(const o of d.objects){if(this.selected&&o.index!==this.selected)continue;svg.append(svgEl('path',{d:R.roiPath(o),fill:'none',stroke:'#ffe036','stroke-width':1.2,'vector-effect':'non-scaling-stroke'}));}}
 if($('showIds').checked){for(const o of d.objects){if(this.selected&&o.index!==this.selected)continue;const p=d.kind==='bbbc038'?o.center?{x:o.center.x,y:o.center.y}:null:{x:(o.bounds[0]+o.bounds[2])/2,y:(o.bounds[1]+o.bounds[3])/2};if(!p)continue;const t=svgEl('text',{x:p.x,y:p.y,fill:'white',stroke:'#101711','stroke-width':2,'paint-order':'stroke','font-size':Math.max(10,13/this.scale),'text-anchor':'middle'});t.textContent=String(o.index);svg.append(t);}}
 }
 renderReview(){const d=this.data;if(!d)return;const s=$('reviewSvg');s.setAttribute('viewBox',`0 0 ${d.w} ${d.h}`);s.replaceChildren();s.style.display=this.mode==='raw'||!this.reviewVisible?'none':'';const drawPoly=(ps,dashed=true)=>{if(!ps.length)return;const path=svgEl('path',{d:'M'+ps.map(p=>p.join(',')).join('L')+(dashed?'Z':''),fill:dashed?'#61e8cf13':'none',stroke:'#61e8cf','stroke-width':1.6,'stroke-dasharray':dashed?'5 3':'none','vector-effect':'non-scaling-stroke'});s.append(path);};
 for(const p of this.proposals)drawPoly(p.geometry.points);if(this.polygon)drawPoly(this.polygon.points);else if(this.points.length){drawPoly(this.points,false);for(const [x,y]of this.points)s.append(svgEl('circle',{cx:x,cy:y,r:3/this.scale,fill:'#61e8cf'}));}
 const pins=[...this.pins.map((p,i)=>({a:p.anchor,n:i+1})),...(this.anchor?[{a:this.anchor,n:'+'}]:[])];for(const p of pins){if(!p.a)continue;const g=svgEl('g'),circle=svgEl('circle',{cx:p.a.x,cy:p.a.y,r:9/this.scale,fill:'#22614b',stroke:'#c1ffd5','stroke-width':1,'vector-effect':'non-scaling-stroke'}),t=svgEl('text',{x:p.a.x,y:p.a.y,fill:'white','font-size':10/this.scale,'text-anchor':'middle','dominant-baseline':'central'});t.textContent=p.n;g.append(circle,t);s.append(g);}}
 setReview(proposals,comments){this.proposals=proposals;this.pins=comments.filter(x=>x.anchor);this.renderReview();}
 point(e){const r=$('frame').getBoundingClientRect(),x=(e.clientX-r.left)*this.data.w/r.width,y=(e.clientY-r.top)*this.data.h/r.height;return [Math.max(0,Math.min(this.data.w,x)),Math.max(0,Math.min(this.data.h,y))];}
 pointerDown(e){if(!this.data||e.button!==0)return;const p=this.point(e);this.drag={x:e.clientX,y:e.clientY,l:$('stage').scrollLeft,t:$('stage').scrollTop,pan:this.tool==='pan'||this.space};$('stage').setPointerCapture(e.pointerId);if(!this.drag.pan){if(this.tool==='pin'){this.anchor={type:'point',x:p[0],y:p[1]};this.handlers.onAnchor?.(this.anchor);this.renderReview();}else if(this.tool==='polygon'){this.polygon=null;if(e.detail<=1&&this.points.length<1024){this.points.push(p);this.handlers.onDraft?.(this.points.length,false);this.renderReview();}}}}
 pointerMove(e){if(!this.data)return;const [x,y]=this.point(e),ix=Math.min(this.data.w-1,Math.floor(x)),iy=Math.min(this.data.h-1,Math.floor(y)),d=this.data;let val=d.kind==='fiji'?d.img.pixels[iy*d.w+ix]:'PNG';$('pixelInfo').textContent=`x=${ix}, y=${iy} · source value: ${val}`;if(this.drag?.pan){$('stage').scrollLeft=this.drag.l-(e.clientX-this.drag.x);$('stage').scrollTop=this.drag.t-(e.clientY-this.drag.y);}}
 pointerUp(e){if(this.drag&&this.drag.pan&&Math.hypot(e.clientX-this.drag.x,e.clientY-this.drag.y)<3){const [x,y]=this.point(e);if(this.data.kind==='fiji'){const o=this.data.objects.find(o=>R.contains(o,x,y));if(o){this.selected=o.index;$('objectSelect').value=String(o.index);this.renderSource();}}}this.drag=null;}
 setTool(t){if(t!=='pan'&&this.mode==='raw')this.setMode('overlay');this.tool=t;$('stage').classList.toggle('annotate',t!=='pan');document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));}
 clearDraft(){this.points=[];this.polygon=null;this.anchor=null;this.handlers.onAnchor?.(null);this.handlers.onDraft?.(0,false);this.renderReview();}
 undo(){if(this.polygon){this.points=this.polygon.points.slice();this.polygon=null;}this.points.pop();this.handlers.onDraft?.(this.points.length,false);this.renderReview();}
 finish(){if(!this.data)return;if(!D.polygonValid(this.points,this.data.w,this.data.h)){this.handlers.onError?.('Use at least three vertices without self-crossing; keep all vertices in the image.');return;}this.polygon={type:'polygon',points:this.points.map(p=>p.slice())};this.points=[];this.handlers.onDraft?.(this.points.length,true);this.renderReview();}
 fit(){if(!this.data)return;const st=$('stage');const scale=Math.min((st.clientWidth-40)/this.data.w,(st.clientHeight-40)/this.data.h);this.zoom(scale);this.centerOn(st,{x:this.data.w/2,y:this.data.h/2});this.syncComparison(st);}
 zoom(s){if(!this.data)return;const st=$('stage'),center=this.viewCenter(st);this.scale=Math.max(.025,Math.min(16,s));for(const id of ['frame','compareOriginalFrame']){$(id).style.width=this.data.w*this.scale+'px';$(id).style.height=this.data.h*this.scale+'px';}$('zoomValue').textContent=Math.round(this.scale*100)+'%';this.centerOn(st,center);if(this.mode==='split')this.centerOn($('compareOriginalStage'),center);this.renderSource();this.renderReview();}
 focus(anchor){if(!anchor||!this.data)return;this.zoom(Math.max(this.scale,1));this.centerOn($('stage'),anchor);this.syncComparison($('stage'));}
 setupComparison(){
  // Presentation only: original intensities, ROI coordinates, mask membership,
  // cloud storage, versions and permissions are not changed by this viewer.
  const style=document.createElement('style');style.id='comparisonStyles';style.textContent=`
   .compare-panes{display:grid;grid-template-columns:minmax(0,1fr);flex:1;min-height:0;min-width:0;gap:1px;background:var(--line)}
   .compare-panes.is-split{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
   .compare-pane{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
   .compare-caption{min-height:29px;display:flex;align-items:center;padding:5px 12px;background:#12261e;color:#dcece2;font-size:10px;border-bottom:1px solid #254035}
   .compare-pane .stage{min-width:0;touch-action:none;scrollbar-gutter:stable}
   .compare-buttons{display:flex;gap:4px;align-items:center;padding-right:9px;border-right:1px solid var(--line)}
   .compare-buttons button.active{background:var(--green);color:#fff;border-color:var(--green)}
   .compare-help{font-size:10px;color:var(--muted);margin-left:auto}
   .review-panel{min-width:0}.review-panel .evidence{overflow-wrap:anywhere}
   .viewer.review-hidden .vbody{grid-template-columns:minmax(0,1fr)}
   .viewer.review-hidden .review-panel{display:none}
   #toggleReviewPanel{font-size:11px;padding:7px 10px}
   @media(max-width:760px){.compare-buttons{flex-wrap:wrap}.compare-help{display:none}.compare-caption{font-size:9px;padding:4px 7px}.viewer.review-hidden .vbody{grid-template-rows:minmax(0,1fr)}.compare-pane .spacer{padding:20px}}
  `;document.head.append(style);
  const bar=$('toggleSource').parentElement,group=document.createElement('div');group.className='compare-buttons';group.setAttribute('role','group');group.setAttribute('aria-label','Image comparison mode');
  for(const [mode,label] of [['raw','Original'],['overlay','Image + annotations'],['split','Side by side']]){const b=document.createElement('button');b.type='button';b.id='view'+mode[0].toUpperCase()+mode.slice(1);b.dataset.viewMode=mode;b.textContent=label;b.onclick=()=>this.setMode(mode);group.append(b);}bar.prepend(group);
  const label=document.createElement('label'),check=document.createElement('input');check.id='reviewMarks';check.type='checkbox';check.checked=true;check.onchange=()=>{this.reviewVisible=check.checked;this.renderReview();};label.append(check,document.createTextNode('Review marks'));bar.append(label);
  const hint=document.createElement('span');hint.id='comparisonHint';hint.className='compare-help';hint.textContent='B: original / annotations';bar.append(hint);
  const st=$('stage'),panes=document.createElement('div');panes.id='comparePanes';panes.className='compare-panes';st.parentElement.insertBefore(panes,st);
  const original=document.createElement('section');original.id='compareOriginalPane';original.className='compare-pane hidden';original.setAttribute('aria-label','Original image without annotations');
  const caption=document.createElement('div');caption.className='compare-caption';caption.textContent='Original image · no annotations';original.append(caption);
  const rawStage=document.createElement('div');rawStage.id='compareOriginalStage';rawStage.className='stage';const spacer=document.createElement('div');spacer.className='spacer';const frame=document.createElement('div');frame.id='compareOriginalFrame';frame.className='frame';const canvas=document.createElement('canvas');canvas.id='compareOriginalCanvas';frame.append(canvas);spacer.append(frame);rawStage.append(spacer);original.append(rawStage);
  const annotated=document.createElement('section');annotated.className='compare-pane';const ac=document.createElement('div');ac.id='compareAnnotationCaption';ac.className='compare-caption';annotated.append(ac,st);panes.append(original,annotated);
  for(const el of [st,rawStage])el.addEventListener('scroll',()=>this.syncComparison(el),{passive:true});
  let drag=null;
  rawStage.addEventListener('pointerdown',e=>{if(!this.data||e.button!==0)return;drag={x:e.clientX,y:e.clientY,l:rawStage.scrollLeft,t:rawStage.scrollTop};rawStage.setPointerCapture(e.pointerId);});
  rawStage.addEventListener('pointermove',e=>{if(!this.data)return;const r=frame.getBoundingClientRect(),x=Math.floor((e.clientX-r.left)/this.scale),y=Math.floor((e.clientY-r.top)/this.scale);if(x>=0&&x<this.data.w&&y>=0&&y<this.data.h){const value=this.data.kind==='fiji'?this.data.img.pixels[y*this.data.w+x]:'PNG';$('pixelInfo').textContent=`Original: x=${x}, y=${y} · source value: ${value}`;}if(drag){rawStage.scrollLeft=drag.l-(e.clientX-drag.x);rawStage.scrollTop=drag.t-(e.clientY-drag.y);this.syncComparison(rawStage);}});
  const stop=()=>drag=null;rawStage.addEventListener('pointerup',stop);rawStage.addEventListener('pointercancel',stop);rawStage.addEventListener('lostpointercapture',stop);
  rawStage.addEventListener('wheel',e=>{if(!this.data)return;e.preventDefault();this.syncComparison(rawStage);this.zoom(this.scale*(e.deltaY>0?.86:1.16));},{passive:false});
  const btn=document.createElement('button');btn.type='button';btn.id='toggleReviewPanel';btn.textContent='Hide review panel';btn.setAttribute('aria-expanded','true');btn.onclick=()=>{const hidden=$('viewer').classList.toggle('review-hidden');btn.textContent=hidden?'Show review panel':'Hide review panel';btn.setAttribute('aria-expanded',String(!hidden));requestAnimationFrame(()=>this.fit());};$('copyLink').parentElement.prepend(btn);
  this.updateComparisonUI();
 }
 layoutComparison(){
  $('comparePanes').classList.toggle('is-split',this.mode==='split');$('compareOriginalPane').classList.toggle('hidden',this.mode!=='split');
  if(this.mode==='raw')this.setTool('pan');this.updateComparisonUI();
 }
 setMode(mode){
  if(!['raw','overlay','split'].includes(mode))return;const wasSplit=this.mode==='split';this.mode=mode;
  // The explicit annotated modes start with source outlines, not filled masks.
  if(mode!=='raw'){this.source=true;this.masks=false;}
  this.layoutComparison();this.renderImage();this.renderSource();this.renderReview();
  if(this.data&&(wasSplit!==(mode==='split')))requestAnimationFrame(()=>this.fit());
 }
 updateComparisonUI(){
  document.querySelectorAll('[data-view-mode]').forEach(b=>{const active=b.dataset.viewMode===this.mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  const raw=this.mode==='raw';$('toggleSource').disabled=raw;$('toggleSource').classList.toggle('active',!raw&&this.source);$('maskMode').disabled=raw||this.data?.kind!=='bbbc038';$('maskMode').classList.toggle('active',!raw&&this.masks);$('showIds').disabled=raw;$('reviewMarks').disabled=raw;
  $('compareAnnotationCaption').textContent=raw?'Original image · all annotations hidden':this.masks?'Source masks · reference labels, not raw image':this.mode==='split'?'Same image + annotations · linked zoom / pan':'Image + annotations · saved source + optional review marks';
  $('comparisonHint').textContent=this.mode==='split'?'Linked zoom / pan · same display brightness':'B: original / annotations';
 }
 viewCenter(stage){
  if(!this.data)return {x:0,y:0};const frame=$(stage.id==='stage'?'frame':'compareOriginalFrame'),r=frame.getBoundingClientRect(),s=stage.getBoundingClientRect();return {x:(s.left+stage.clientLeft+stage.clientWidth/2-r.left)/this.scale,y:(s.top+stage.clientTop+stage.clientHeight/2-r.top)/this.scale};
 }
 centerOn(stage,p){
  if(!this.data||!Number.isFinite(p.x)||!Number.isFinite(p.y))return;const now=this.viewCenter(stage),dx=(p.x-now.x)*this.scale,dy=(p.y-now.y)*this.scale;if(Math.abs(dx)>.55)stage.scrollLeft+=dx;if(Math.abs(dy)>.55)stage.scrollTop+=dy;
 }
 syncComparison(from){
  if(!this.data||this.mode!=='split'||this.syncing)return;this.syncing=true;try{this.centerOn(from.id==='stage'?$('compareOriginalStage'):$('stage'),this.viewCenter(from));}finally{this.syncing=false;}
 }

}
root.ReviewViewer=Viewer;
})(globalThis);
