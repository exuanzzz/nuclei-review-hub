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
    return source
