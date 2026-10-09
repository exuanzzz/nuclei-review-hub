/* Management extension. Database migration 04 is required.
 * Source images, mask membership and Fiji ROI coordinates are never changed.
 * Trash is recoverable, does NOT free Storage space, and is not permanent erasure.
 * No existing cloud data is removed by installing this extension. */
(function(root){
'use strict';
const $=id=>document.getElementById(id),H=root.Hub,B=root.ReviewCloud;
if(!H||!B)return;
let working=false,tab='collections',timer;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const admin=()=>H.getUser()?.role==='admin';
const own=id=>!!H.getUser()&&(H.getUser().user_id===id||admin());
const busy=()=>working||$('importOpen').disabled;
const say=s=>{$('toast').textContent=s;$('toast').classList.remove('hidden');clearTimeout(timer);timer=setTimeout(()=>$('toast').classList.add('hidden'),10000);};
function error(e){console.error(e);const s=e.message||String(e);say(/nr_(management_version|trash_item|list_trash|remove_feedback).*schema cache|Could not find.*nr_(management_version|trash_item|list_trash|remove_feedback)|function.*nr_management_version.*does not exist/i.test(s)?'Database update required: run 04_Enable_Delete_And_Trash in Supabase SQL Editor (Database), then try again.':s);}
async function ready(){if(!H.getUser())throw Error('Sign in as an active workspace member first.');const v=await B.rpc('nr_management_version',{});if(v!=='trash-feedback-v1')throw Error('Database update required: 04_Enable_Delete_And_Trash.');}
async function operation(fn){if(busy())return say('Finish the current operation first.');working=true;updateButtons();try{await fn();}catch(e){error(e);}finally{working=false;updateButtons();}}
const style=el('style');style.textContent=`
 .manage-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0;font-size:11px;color:var(--muted)}
 .manage-bar button{font-size:11px;padding:6px 10px}.danger-quiet{color:#9e3f37!important;border-color:#e4c4c0!important;background:#fff!important}
 .danger-quiet:hover:not(:disabled){background:#fff1ee!important}.management-row{border:1px solid var(--line);padding:13px;border-radius:10px;margin:10px 0;display:flex;align-items:center;justify-content:space-between;gap:12px}
 .management-row>div{min-width:0}.management-row strong{display:block;font-size:13px;overflow-wrap:anywhere}.management-row small{font-size:10px;color:var(--muted);overflow-wrap:anywhere;display:block}
 .management-row button{font-size:11px;flex-shrink:0}.management-note{background:#faf3e5;padding:12px;border-radius:9px;font-size:12px;margin:12px 0;color:#795d31}
 .management-removed{opacity:.7;border-style:dashed}.management-removed .by{font-size:10px;color:var(--muted)}
 #managementDialog{width:min(760px,95vw)}#managementDialog .manage-tabs{display:flex;gap:8px;margin:15px 0}
 #managementDialog .manage-tabs button.active{background:var(--green);color:white}#trashCurrent{margin-top:9px}
 @media(max-width:650px){.management-row{align-items:stretch;flex-direction:column}.manage-bar span{width:100%}}
`;document.head.append(style);
const bar=el('div',undefined,'manage-bar');bar.id='managementBar';
const openCollections=el('button','Manage collections'),openTrash=el('button','Trash / restore');
openCollections.id='manageCollections';openTrash.id='manageTrash';
bar.append(openCollections,openTrash,el('span','Remove your feedback · recoverable Trash for uploads'));
document.querySelector('.sectionbar').after(bar);
const trashCurrent=el('button','Move image to Trash','danger-quiet');trashCurrent.id='trashCurrent';
$('downloadSource').parentElement.after(trashCurrent);
const dialog=el('dialog');dialog.id='managementDialog';
const close=el('button','×');close.type='button';close.setAttribute('aria-label','Close data management');
const closeWrap=el('div',undefined,'dialog-close');closeWrap.append(close);close.onclick=()=>dialog.close();
const title=el('h2','Manage shared data'),note=el('div',undefined,'management-note');
note.textContent='Moving to Trash hides the collection or image, all its source versions and its feedback from the workspace. Files are retained and can be restored. Trash does not free Storage space. No permanent file deletion is enabled.';
const tabs=el('div',undefined,'manage-tabs'),collectionsTab=el('button','Collections'),trashTab=el('button','Trash'),reload=el('button','Refresh');
collectionsTab.id='managementCollectionsTab';trashTab.id='managementTrashTab';tabs.append(collectionsTab,trashTab,reload);
const list=el('div');list.id='managementList';
dialog.append(closeWrap,title,note,tabs,list);document.body.append(dialog);
async function renderManager(which=tab){
 tab=which;collectionsTab.classList.toggle('active',tab==='collections');trashTab.classList.toggle('active',tab==='trash');
 list.replaceChildren(el('p','Loading…'));
 try{
  await ready();
  const rows=tab==='trash'?await B.rpc('nr_list_trash',{}):await B.listAll('nr_collections','select=*&order=created_at.desc');
  if(!dialog.open)return;
  list.replaceChildren();
  if(!rows.length){list.append(el('p',tab==='trash'?'No items in your accessible Trash.':'No accessible collections.'));return;}
  for(const r of rows){
   const inTrash=tab==='trash',kind=inTrash?r.item_type:'collection',id=inTrash?r.item_id:r.id,name=inTrash?r.item_name:r.title;
   const row=el('div',undefined,'management-row'),info=el('div');info.append(el('strong',name));
   info.append(el('small',inTrash?`${kind} · ${r.owner_name} · ${r.collection_name}`:`${r.kind} · ${r.state} · ${r.id.slice(0,8)}`));row.append(info);
   if(inTrash||own(r.owner_id)){
    const btn=el('button',inTrash?'Restore':'Move collection to Trash',inTrash?'':'danger-quiet');btn.dataset.targetId=id;btn.dataset.manageAction=inTrash?'restore':'trash';
    btn.onclick=()=>operation(async()=>{
     const message=inTrash?`Restore ${kind} “${name}”?\nVersions and saved feedback will return. Separately trashed images remain in Trash.`:`Move collection “${name}” to Trash?\nALL its images, source versions and feedback will be hidden from the team.\nNothing on your computer is changed. Cloud files remain stored and can be restored.`;
     if(!confirm(message))return;
     await B.rpc('nr_trash_item',{p_type:kind,p_id:id,p_restore:inTrash});
     await H.loadShared();await renderManager(tab);say(inTrash?'Restored.':'Moved to Trash. Cloud files are retained, not permanently deleted.');
    });row.append(btn);
   }else row.append(el('small','Only the owner or an administrator can move this collection to Trash.'));
   list.append(row);
  }
 }catch(e){list.replaceChildren(el('p','Unable to load management controls. Run database migration 04 if it has not been applied.'));error(e);}
}
function showManager(which){if(busy())return say('Finish the current operation first.');if(!H.getUser())return say('Sign in first.');if(!dialog.open)dialog.showModal();renderManager(which);}
openCollections.onclick=()=>showManager('collections');openTrash.onclick=()=>showManager('trash');collectionsTab.onclick=()=>renderManager('collections');trashTab.onclick=()=>renderManager('trash');reload.onclick=()=>renderManager(tab);
function closeFieldIfConfirmed(){if(!H.getCurrent())return true;$('closeViewer').click();return $('viewer').classList.contains('hidden');}
trashCurrent.onclick=()=>operation(async()=>{
 const c=H.getCurrent();if(!c)return;
 if(c.version){
  await ready();if(!own(c.record.created_by))throw Error('Only the upload owner or an administrator can move this image to Trash.');
  if(!confirm(`Move image “${c.record.name}” to Trash?\nAll its versions and feedback will be hidden from the team and can be restored.\nCloud files remain stored. Unsent form text will not be saved.`))return;
  if(!closeFieldIfConfirmed())return;
  await B.rpc('nr_trash_item',{p_type:'field',p_id:c.record.id,p_restore:false});
  await H.loadShared();say('Image moved to Trash. Use Trash / restore to bring it back.');
 }else{
  if(!$('retryPublish').classList.contains('hidden'))throw Error('An upload is paused. Finish it before removing a staged item.');
  if(!confirm(`Remove “${c.record.name}” from this local preview?\nLocal review drafts for this preview will no longer be shown. Original files and shared copies are unchanged.`))return;
  if(!closeFieldIfConfirmed())return;
  const a=H.getLocal(),i=a.indexOf(c.record);if(i>=0)a.splice(i,1);
  document.querySelector('[data-scope="local"]').click();say('Removed from local staging only. No source files were deleted.');
 }
});
const removedLabel=type=>type==='comment'?'Comment deleted':type==='proposal'?'Proposal withdrawn':'Decision withdrawn';
function tombstone(row,type){row.removed_at=new Date().toISOString();row.removed_by=H.getUser()?.user_id||null;
 if(type==='comment'){row.body='[Deleted comment]';row.roi_ref='';row.anchor=null;}
 else if(type==='proposal'){row.label='[Withdrawn proposal]';row.note='';row.geometry={type:'polygon',points:[]};}
 else{row.verdict='discussion';row.body='[Withdrawn decision]';}}
async function removeFeedback(c,row,type){await operation(async()=>{
 if(H.getCurrent()!==c)throw Error('The displayed version changed. Please try again.');
 if(c.version)await ready();
 const message=type==='comment'?'Delete this comment’s text and point marker? Other people’s replies will remain, with a “Comment deleted” placeholder. The deleted text cannot be restored here.':type==='proposal'?'Withdraw this proposal? Its polygon, label and note will be removed from active review. Source Fiji ROIs / GT masks will not change.':'Withdraw this decision? It will no longer count as an approval or active review. A withdrawal marker will remain.';
 if(!confirm(message))return;
 if(c.version)await B.rpc('nr_remove_feedback',{p_type:type,p_id:row.id});else tombstone(row,type);
 await H.refreshFeedback();setTimeout(()=>H.refreshFeedback().catch(error),250);
 say(removedLabel(type)+(c.version?'. Saved to shared database.':'. Local preview only.'));
});}
function decorateFeed(type,id,key){
 const c=H.getCurrent(),rows=c?.feedback?.[key];if(!rows)return;
 const nodes=[...$(id).children].filter(n=>n.classList.contains('message'));
 if(nodes.length!==rows.length)return;
 nodes.forEach((n,i)=>{
  const row=rows[i],mark=row.id+':'+(row.removed_at||'active');if(n.dataset.managementKey===mark)return;n.dataset.managementKey=mark;
  if(row.removed_at){
   n.classList.add('management-removed');n.replaceChildren(el('strong',removedLabel(type)),el('div',`${row.localAuthor||'Member '+String(row.author_id||'').slice(0,8)} · ${new Date(row.removed_at).toLocaleString()}`,'by'));
   if(type==='comment')n.append(el('div','Replies, if any, are kept below.','small'));return;
  }
  if(!c.version||own(row.author_id)){
   const btn=el('button',type==='comment'?'Delete comment':type==='proposal'?'Withdraw proposal':'Withdraw decision','danger-quiet');
   btn.type='button';btn.dataset.feedbackId=row.id;btn.dataset.feedbackType=type;btn.onclick=()=>removeFeedback(c,row,type);n.append(btn);
  }
 });
}
function updateButtons(){
 const u=H.getUser(),c=H.getCurrent();openCollections.disabled=working||!u;openTrash.disabled=working||!u;
 trashCurrent.classList.toggle('hidden',!c||!!c.version&&!own(c.record.created_by));
 trashCurrent.disabled=busy();trashCurrent.textContent=c?.version?'Move image to Trash':'Remove local preview';
 for(const [type,id,key]of [['comment','commentList','comments'],['proposal','proposalList','proposals'],['review','reviewList','reviews']])decorateFeed(type,id,key);
}
// Active proposal export must exclude withdrawn geometries. Source ROI/mask bytes
// are not used or modified here; only explicitly submitted candidate ROIs export.
$('exportProposals').onclick=async()=>{
 try{
  const c=H.getCurrent();if(!c?.data)return;
  const proposals=(c.feedback?.proposals||[]).filter(x=>!x.removed_at);
  if(!proposals.length)return say('No active proposals in this version.');
  const items=proposals.map((r,i)=>({name:`proposal_${i+1}_${r.id.slice(0,8)}.roi`,bytes:root.ReviewData.encodeProposalROI(r.geometry.points,'proposal_'+(i+1),c.data.w,c.data.h)}));
  items.push({name:'PROPOSALS_NOT_GT.json',bytes:new TextEncoder().encode(JSON.stringify({image_sha256:c.data.sha,version:c.version?.id||null,note:'Active web proposals only; withdrawn proposals excluded. Not source ground truth.',proposals},null,2))});
  const blob=await root.GTCore.makeZip(items),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='proposals_rois.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }catch(e){error(e);}
};
const viewer=H.getViewer(),originalSetReview=viewer.setReview.bind(viewer);
viewer.setReview=(proposals,comments)=>originalSetReview(proposals.filter(x=>!x.removed_at),comments.filter(x=>!x.removed_at));
for(const id of ['commentList','proposalList','reviewList','vSubtitle','userLabel'])new MutationObserver(updateButtons).observe($(id),{childList:true});
new MutationObserver(updateButtons).observe($('viewer'),{attributes:true,attributeFilter:['class']});
new MutationObserver(updateButtons).observe($('importOpen'),{attributes:true,attributeFilter:['disabled']});
updateButtons();
root.ReviewManagement={showManager,updateButtons,version:'trash-feedback-v1'};
})(globalThis);
