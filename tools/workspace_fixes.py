"""Explicit application-source fixes applied before native browser validation."""
def apply(source):
    if 'workspace-feedback-save-v2' not in source:
        start=source.index('async function saveFeedback(type){')
        end=source.index('async function uploadRevision(',start)
        source=source[:start]+r'''
// workspace-feedback-save-v2: a finished save must not erase a newer draft.
async function saveFeedback(type){
 if(!current?.data||busy)return;
 const cur=current,ver=cur.version?.id,o=cur.data.objects.find(x=>x.index===V.selected),id=uuid();
 const before={comment:$('commentBody').value,label:$('proposalLabel').value,note:$('proposalNote').value,decision:$('decisionBody').value,reply:replyTo,anchor:V.anchor,polygon:V.polygon};
 let row;
 if(type==='comments'){
  const body=before.comment.trim();if(!body)return toast('Write a comment first.');
  row={id,body,roi_ref:o?.ref||'',anchor:before.anchor,reply_to:before.reply};
 }else if(type==='proposals'){
  if(!before.polygon)return toast('Draw and finish a valid polygon first.');
  const label=before.label.trim();if(!label)return toast('Give the proposal a label.');
  row={id,label,geometry:structuredClone(before.polygon),note:before.note.trim()};
 }else row={id,verdict:$('verdict').value,body:before.decision.trim()};
 setBusy(true);
 try{
  if(ver){await B.insert('nr_'+type,{...row,version_id:ver});toast('Saved to shared database.');}
  else{
   const rows=feedbackLocal(cur.record)[type],saved={...row,created_at:new Date().toISOString(),localAuthor:byLocal()};rows.push(saved);
   try{await saveLocalFeedback(cur.record);}catch(e){const i=rows.indexOf(saved);if(i>=0)rows.splice(i,1);throw e;}
   toast('Saved in this browser with the local image. Not shared with the team.');
  }
  if(current!==cur)return;
  if(type==='comments'){
   if($('commentBody').value===before.comment)$('commentBody').value='';
   if(replyTo===before.reply){replyTo=null;$('replyStatus').textContent='';}
   if(V.anchor===before.anchor){V.anchor=null;V.handlers.onAnchor(null);}
  }
  if(type==='proposals'){
   if($('proposalLabel').value===before.label)$('proposalLabel').value='';
   if($('proposalNote').value===before.note)$('proposalNote').value='';
   if(V.polygon===before.polygon){V.polygon=null;V.points=[];V.handlers.onDraft(0,false);}
  }
  if(type==='reviews'&&$('decisionBody').value===before.decision)$('decisionBody').value='';
  await refreshFeedback();
 }finally{setBusy(false);}
}
''' + source[end:]
    old="kind:selection.info?.kind});emitState();"
    new="kind:selection.info?.kind});document.querySelectorAll('.select-field').forEach(ck=>ck.disabled=busy||restoringLocal);emitState();"
    if old in source:source=source.replace(old,new)
    if 'compact-workspace-layout-v2' not in source:
        source+=r'''
// compact-workspace-layout-v2: show working controls instead of a long landing page.
(function(){
const style=document.createElement('style');
style.textContent=`
 body.has-library-items .hero{padding:15px 0 16px;align-items:center}
 body.has-library-items .hero h1{font-size:27px;line-height:1.12;letter-spacing:-.8px}
 body.has-library-items .hero p,body.has-library-items .hero .eyebrow{display:none}
 body.has-library-items .hero-actions{flex-direction:row;flex-wrap:wrap;align-items:center;min-width:0;max-width:530px}
 body.has-library-items .hero-actions button{padding:8px 12px;font-size:12px}
 body.local-device-view .stats{display:none}
 body.local-device-view #managementBar{display:none}
 .local-library-panel{padding:12px 16px!important;margin:12px 0!important}
 .local-library-panel h3{font-size:14px!important}
 .local-library-panel header p{font-size:11px;margin-top:3px}
 .local-library-panel details{font-size:11px;margin-top:8px;color:#65776f}
 .local-library-panel details summary{cursor:pointer}
 .local-library-panel .workspace-build{font-size:9px!important;margin-top:5px}
 .bulk-selection-bar{margin:10px 0!important}
 @media(max-width:760px){body.has-library-items .hero{gap:12px}body.has-library-items .hero h1{font-size:23px}.local-library-panel header{align-items:flex-start}}
`;document.head.append(style);
function update(){
 const h=window.Hub;if(!h)return;const local=h.getScope()==='local';
 document.body.classList.toggle('local-device-view',local);
 document.body.classList.toggle('has-library-items',h.getLocal().length+h.getShared().length>0);
 const bc=document.getElementById('breadcrumb');if(bc)bc.textContent=local?'Workspace / Local library (this device)':'Workspace / Shared library';
 const box=document.getElementById('uploadTools');if(box)box.classList.toggle('hidden',!h.hasPausedUpload()&&(!local||!h.getLocal().some(r=>r.selected)));
 const progress=document.getElementById('progressBox'),message=document.getElementById('progressText')?.textContent||'';
 if(!h.isBusy()&&!h.hasPausedUpload()&&/^(Saved locally:|Collection published)/.test(message))progress?.classList.add('hidden');
}
window.addEventListener('nr:state',update);
window.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(()=>{
 const warning=document.querySelector('.local-storage-warning');if(warning&&!warning.closest('details')){const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Storage, privacy and backup limits';warning.before(detail);detail.append(summary,warning);}
 const all=document.querySelector('[data-nav="all"]');if(all)all.textContent='▦  All image types';
 const label=document.querySelector('.workspace-label');if(label)label.textContent='LIBRARY FILTERS';
 update();
}));
})();
'''
    return source
