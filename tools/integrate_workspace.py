"""One-time source integration; validated before committing app.js/index.html.
Does not connect to Supabase, modify policies, or change source decoders.
Exact replacement guards prevent silently patching an unexpected app version.
"""
from pathlib import Path
p=Path(__file__).resolve().parents[1]
s=(p/'site/js/app.js').read_text()
if 'persistent-device-workspace-v2' in s:
    print('Workspace application is already integrated.'); raise SystemExit(0)
def replace(a,b):
 global s
 if a not in s: raise Exception('missing '+a[:140])
 s=s.replace(a,b)
def function(a,b,new):
 global s
 start=s.index(a);end=s.index(b,start);s=s[:start]+new+'\n'+s[end:]
replace("const $=id=>document.getElementById(id),C=GTCore,D=ReviewData,B=ReviewCloud,cfg=REVIEW_CONFIG,V=new ReviewViewer(),W=root.ReviewWorkflow;","const $=id=>document.getElementById(id),C=GTCore,D=ReviewData,B=ReviewCloud,cfg=REVIEW_CONFIG,V=new ReviewViewer(),W=root.ReviewWorkflow,L=root.DeviceLibrary;")
replace("refreshingFeed=false,refreshEpoch=0;","""refreshingFeed=false,refreshEpoch=0,restoringLocal=true;
const sharedSelection=new Set();
let preferenceTimer=null;
function emitState(){window.dispatchEvent(new CustomEvent('nr:state'));}
function persistPreference(){clearTimeout(preferenceTimer);preferenceTimer=setTimeout(()=>L.setting('view',{scope,nav,search:$('search').value,collection:$('collectionFilter').value,annotation:$('annotationFilter').value}).catch(fail),150);}
function selectedLocal(){return local.filter(r=>r.selected&&!r.error);}
function uploadInfo(){const selected=selectedLocal(),groups=new Map(selected.map(r=>[r.localMeta?.group||r.kind,r.localMeta||{...localInfo,kind:r.kind}]));return {info:groups.size===1?[...groups.values()][0]:localInfo,groups:groups.size};}
async function saveLocalFeedback(r){if(r.localId)await L.patch(r.localId,{feedback:feedbackLocal(r)});}
async function reloadLocal(){const old=new Map(local.map(r=>[r.localId,r]));local=(await L.list()).map(r=>{const prev=old.get(r.localId);if(prev)Object.assign(prev,r);return prev||r;});for(const r of local)localFeedback.set(r,r.localFeedback);syncCollectionFilter();renderGrid();}
async function saveSelections(){await L.patchMany(local.map(r=>[r.localId,{selected:!!r.selected}]));}
async function selectFields(mode){if(busy||restoringLocal)return;const rows=scope==='local'?local:shared,visible=new Set(recordsVisible());for(const r of rows){const selected=mode==='none'?false:mode==='shown'?visible.has(r):visible.has(r)?true:(scope==='local'?r.selected:sharedSelection.has(r.id));if(scope==='local')r.selected=selected;else if(selected)sharedSelection.add(r.id);else sharedSelection.delete(r.id);}renderGrid();if(scope==='local')await saveSelections();}
async function removeLocal(ids){if(busy||batch)throw Error('Finish or release the paused upload first.');setBusy(true);try{await L.remove(ids);const gone=new Set(ids);for(const r of local)if(gone.has(r.localId))localFeedback.delete(r);local=local.filter(r=>!gone.has(r.localId));syncCollectionFilter();renderGrid();}finally{setBusy(false);}}
const jobKey=()=> 'upload:'+user?.user_id;
async function journal(){if(!user||!batch)return;await L.setting(jobKey(),{...batch,list:batch.list.map(r=>r.localId),owner:user.user_id});}
async function clearJournal(){if(user)await L.setting(jobKey(),undefined);}
async function restoreJob(){if(!user||batch)return;const j=await L.setting(jobKey());if(!j||j.owner!==user.user_id)return;const ids=new Map(local.map(r=>[r.localId,r])),list=j.list.map(id=>ids.get(id));if(list.some(x=>!x)){toast('An interrupted upload has missing local sources. Re-import the originals; the cloud draft has not been deleted.');return;}batch={...j,list};localInfo={title:j.title,kind:j.kind,description:j.description};progress('Interrupted upload restored. Files are saved locally. Continue when ready; nothing resumes automatically.',0);updatePublish();}
async function uploadedLocally(r,work,collectionId){if(!r.localId)return;const u={collectionId,fieldId:work.field.id,versionId:work.v?.id,owner:user.user_id,at:new Date().toISOString()},uploads=[...(r.localUploads||[]).filter(x=>x.collectionId!==collectionId),u];await L.patch(r.localId,{uploads,selected:false});r.localUploads=uploads;r.selected=false;}
""")
replace("syncCollectionFilter();renderGrid();}\nfunction updatePublish", "syncCollectionFilter();renderGrid();if(!restoringLocal)persistPreference();}\nfunction updatePublish")
function('function updatePublish(){','function download(','''function updatePublish(){
 const n=selectedLocal().length,selection=uploadInfo();$('publish').textContent=`Publish selected to team (${n})`;
 $('publish').disabled=busy||restoringLocal||!user||!n||!B.configured;
 $('retryPublish').classList.toggle('hidden',!batch||busy);$('importOpen').disabled=busy||restoringLocal||!!batch;$('demo').disabled=busy||restoringLocal||!!batch;
 W?.update({collections,shared,user,scope,busy:busy||restoringLocal,paused:!!batch,kind:selection.info?.kind});emitState();
}''')
function('function syncCollectionFilter(){','\nfunction recordsVisible()', '''function syncCollectionFilter(){
 const prev=$('collectionFilter').value;
 const cols=scope==='shared'?activeCollections():[...new Map(local.map(r=>[r.localMeta.group,{id:r.localMeta.group,title:r.localMeta.title}])).values()];
 $('collectionFilter').replaceChildren(new Option(scope==='shared'?'All collections':'All local collections',''),...cols.map(c=>new Option(c.title,c.id)));
 $('collectionFilter').value=cols.some(c=>c.id===prev)?prev:'';$('collectionFilter').disabled=false;
}''')
function('function recordsVisible(){','const observer=', '''function recordsVisible(){
 const rows=scope==='local'?local:shared,q=$('search').value.trim().toLowerCase(),col=$('collectionFilter').value,af=$('annotationFilter').value;
 return rows.filter(x=>(nav==='all'||nav==='mine'?(nav!=='mine'||scope==='local'||x.collection?.owner_id===user?.user_id):x.kind===nav)
 &&(!col||(scope==='local'?x.localMeta?.group:x.collection?.id)===col)
 &&(!q||[x.name,x.localMeta?.title,x.collection?.title,x.kind,x.collection?nameOf(x.collection.owner_id):'',x.error].join(' ').toLowerCase().includes(q))
 &&(af==='all'||(af==='with'?(x.objectCount??x.annotations?.length??0)>0:(x.objectCount??x.annotations?.length??0)===0)));
}
''')
replace("if(scope==='local'){const ck=document.createElement('input');ck.type='checkbox';ck.checked=!!r.selected;ck.disabled=!!r.error;ck.className='select-field';ck.setAttribute('aria-label','Select '+r.name);ck.onchange=()=>{r.selected=ck.checked;updatePublish();};body.append(ck);}","{const ck=document.createElement('input');ck.type='checkbox';ck.checked=scope==='local'?!!r.selected:sharedSelection.has(r.id);ck.disabled=busy||restoringLocal;ck.className='select-field';ck.setAttribute('aria-label','Select '+r.name);ck.onchange=()=>{if(scope==='local'){r.selected=ck.checked;L.patch(r.localId,{selected:r.selected}).catch(fail);}else if(ck.checked)sharedSelection.add(r.id);else sharedSelection.delete(r.id);card.classList.toggle('selected-card',ck.checked);updatePublish();};card.classList.toggle('selected-card',ck.checked);body.append(ck);}")
replace(":localInfo.title||'Local staging','card-sub'",":r.localMeta?.title||localInfo.title||'Local library','card-sub'")
replace("r.version?'v'+r.version.seq:'Local only'","r.version?'v'+r.version.seq:r.localUploads?.length?'Saved locally · uploaded':'Saved locally'")
replace("scope==='shared'?'No shared fields to display':'No staged fields'","scope==='shared'?'No shared fields to display':'No local fields in this view'")
replace("scope==='shared'?'Sign in to your configured workspace. Local imports are not shared until you publish them.':'Choose TIFF/ROI files or a reference-mask dataset.'","scope==='shared'?'No published images match this view. Your device library is separate; imports are shared only after you publish them.':'Import files once. Saved local copies remain after refresh in this browser. Clear filters to see other collections.'")
replace("user=me;members=ms;collections=cs;shared=W.sharedState(cs,fs,vs).records;", "user=me;members=ms;collections=cs;shared=W.sharedState(cs,fs,vs).records;for(const id of sharedSelection)if(!shared.some(r=>r.id===id))sharedSelection.delete(id);if(!restoringLocal)await restoreJob();")
function('async function importFiles(', 'function thumbnailBlob(', '''async function importFiles(files,isFolder=false){
 if(!files.length||busy||restoringLocal)return;if(batch)return toast('Release or finish the paused upload before adding files. Your library is already saved.');
 setBusy(true);let added=0,duplicates=0;
 try{
  localInfo={group:uuid(),title:$('importTitle').value.trim()||'Untitled local collection',kind:$('importKind').value,description:$('importDescription').value};
  const previousGroup=local.find(r=>r.localMeta?.title===localInfo.title&&r.localMeta?.kind===localInfo.kind&&r.localMeta?.description===localInfo.description);if(previousGroup)localInfo.group=previousGroup.localMeta.group;
  progress('Reading source directory…',0);const entries=isFolder?D.checkedEntries([...files].map(D.entry)):await D.expand([...files]);
  if(localInfo.kind==='fiji'){
   const present=new Set(entries.filter(e=>/\\.tiff?$/i.test(e.name)).map(e=>ROIReview.sampleKey(e.name)));
   for(const roi of entries.filter(e=>/_rois\\.zip$/i.test(e.name))){const key=ROIReview.roiKey(roi.name);if(present.has(key))continue;const candidates=local.filter(r=>r.kind==='fiji'&&r.key===key),images=new Map(candidates.map(r=>[r.image.sourceHash,r.image]));if(images.size===1){entries.push([...images.values()][0]);present.add(key);}else if(images.size>1)throw Error('Multiple saved source images match '+key+'. Select the correct TIFF with this ROI ZIP.');}
  }
  const paired=D.pair(localInfo.kind,entries);
  if(!paired.records.length)throw Error('No matching images found. Check the input layout. Existing local files are unchanged.');
  $('importDialog').close();nav='all';document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav==='all'));
  $('search').value='';$('annotationFilter').value='all';$('collectionFilter').value='';setScope('local');
  if(paired.issues.length)toast(paired.issues.join('\\n'));
  for(let i=0;i<paired.records.length;i++){
   const r=paired.records[i];progress(`Saving to this device ${i+1}/${paired.records.length} · ${r.name}`,100*i/paired.records.length);
   try{const t=await D.thumbnail(r);r.thumb=t.url;r.width=t.w;r.height=t.h;}catch(e){r.error=e.message;}
   const result=await L.save(r,localInfo);if(result.duplicate)duplicates++;else{local.push(result.record);localFeedback.set(result.record,result.record.localFeedback);added++;}
   if(i%3===0){syncCollectionFilter();renderGrid();await new Promise(x=>setTimeout(x,0));}
  }
  progress(`Saved locally: ${added} new fields; ${duplicates} identical fields already present. Nothing uploaded.`,100);
  toast('Local copies saved. New imports do not replace your library. Select the fields you want to upload.');L.protect().then(emitState);
 }catch(e){progress(`Import stopped: ${e.message}. ${added} new fields were saved; previous local files remain. Nothing uploaded.`,0);throw e;}
 finally{syncCollectionFilter();renderGrid();setBusy(false);}
}
''')
replace("progress('Uploading '+r.name+' · '+(pack.blob.size/1024**2).toFixed(1)+' MiB');","await journal();\n progress('Uploading '+r.name+' · '+(pack.blob.size/1024**2).toFixed(1)+' MiB');")
replace("work.complete=true;return work.v;", "work.complete=true;await journal();return work.v;")
replace("const selected=local.filter(r=>r.selected&&!r.error);if(!selected.length)return;", "const selected=selectedLocal();if(!selected.length)return;const info=uploadInfo();if(info.groups!==1)throw Error('Select fields from one local collection per upload. Use the collection filter and Select shown only. You can remove or back up fields across collections.');localInfo={...info.info};")
replace("const dest=W.destination(),checked=await W.preflight(selected,progress);renderGrid();", "if(new Set(selected.map(r=>r.key)).size!==selected.length)throw Error('You selected multiple local annotation variants of the same image. Select one variant per image for this upload.');const dest=W.destination(),checked=await W.preflight(selected,progress);await L.patchMany(selected.map(r=>[r.localId,{error:r.error||'',preflight:r.preflight,objectCount:r.objectCount}]));renderGrid();")
replace("index:0,work:resumed?.work||{},created:!!resumed};", "index:0,work:resumed?.work||{},created:!!resumed};await journal();")
replace("if(!batch.created){await B.insert('nr_collections',{id:batch.id,title:batch.title,kind:batch.kind,description:batch.description});batch.created=true;}", """// Reconcile server state after refresh or a lost network response.
  const existing=(await B.listAll('nr_collections','id=eq.'+batch.id+'&select=*'))[0];
  if(existing?.state==='ready'){
   const count=batch.list.length;await loadShared();for(const r of batch.list){const f=shared.find(f=>f.collection_id===batch.id&&f.key===r.key);if(f)await uploadedLocally(r,{field:f,v:f.version},batch.id);}
   await clearJournal();batch=null;setScope('local');progress('Previous upload was already completed. Local copies retained.',100);return;
  }
  if(existing){const resumed=await resumeWork(batch.id,batch.list);batch.work=resumed.work;batch.index=0;batch.created=true;}
  else if(batch.created)throw Error('The pending collection is no longer accessible (it may be in Trash). Release this pending upload before starting another.');
  if(!batch.created){await B.insert('nr_collections',{id:batch.id,title:batch.title,kind:batch.kind,description:batch.description});batch.created=true;}await journal();""")
replace("batch.index++;continue;", "batch.index++;await journal();continue;")
replace("await uploadVersion(r,d,work.field,null,'Original source upload',work);batch.index++;", "await journal();await uploadVersion(r,d,work.field,null,'Original source upload',work);batch.index++;await journal();")
replace("const count=batch.list.length;batch=null;await loadShared();setScope('shared');", "const count=batch.list.length;for(const r of batch.list)await uploadedLocally(r,batch.work[r.key],batch.id);await clearJournal();batch=null;await loadShared();setScope('shared');")
replace("Keep this page open and choose Continue interrupted upload.","Your saved local library and upload journal survive refresh. Choose Continue interrupted upload when ready.")
replace("if(!confirm('Release the paused upload in this tab? Completed cloud files remain in an unfinished collection; nothing is deleted. Re-import the same source files and choose Resume draft to continue.'))return;\n batch=null;await loadShared();", "if(!confirm('Release this pending upload? Saved local files and the unfinished cloud collection remain. Select the same local fields and Resume draft to continue later.'))return;\n await clearJournal();batch=null;await loadShared();")
replace("function feedbackLocal(r){if(!localFeedback.has(r))localFeedback.set(r,{comments:[],proposals:[],reviews:[]});return localFeedback.get(r);}", "function feedbackLocal(r){if(!localFeedback.has(r))localFeedback.set(r,r.localFeedback||{comments:[],proposals:[],reviews:[]});return localFeedback.get(r);}")
replace("r.collection?.title||localInfo.title||'Local staging'", "r.collection?.title||r.localMeta?.title||localInfo.title||'Local library'")
replace("else f=feedbackLocal(cur.record);if(current!==cur)return;", "else{f=feedbackLocal(cur.record);await saveLocalFeedback(cur.record);}if(current!==cur)return;")
replace("'Local draft only. Not shared with anyone. Export review JSON to keep it.'", "'Saved in this browser with the local image. Not shared with the team.'")
replace("localAuthor:byLocal()});toast('Saved in this browser with the local image. Not shared with the team.');", "localAuthor:byLocal()});await saveLocalFeedback(cur.record);toast('Saved in this browser with the local image. Not shared with the team.');")
replace("$('selectAll').onclick=()=>{for(const r of recordsVisible())if(!r.error)r.selected=true;renderGrid();};", "$('selectAll').onclick=()=>selectFields('shown').catch(fail);")
replace(".addEventListener(id==='search'?'input':'change',renderGrid);", ".addEventListener(id==='search'?'input':'change',()=>{renderGrid();persistPreference();});")
replace("$('logout').onclick=async()=>{refreshEpoch++;", "$('logout').onclick=async()=>{if(busy)return toast('Finish the current operation before signing out.');refreshEpoch++;batch=null;sharedSelection.clear();")
function("$('demo').onclick=", 'async function openDeepLink()', """$('demo').onclick=async()=>{if(busy||restoringLocal||batch)return;setBusy(true);try{const records=await ReviewDemo.records();for(const r of records){const t=await D.thumbnail(r);r.thumb=t.url;r.width=t.w;r.height=t.h;const result=await L.save(r,{group:'synthetic-'+r.kind,kind:r.kind,title:'SYNTHETIC DEMO · '+r.kind,description:'Artificial fixtures, not biological ground truth.'});if(!result.duplicate)local.push(result.record);}nav='all';$('search').value='';$('collectionFilter').value='';$('annotationFilter').value='all';setScope('local');toast('Synthetic demo saved in your local library. No cloud upload.');}catch(e){fail(e);}finally{setBusy(false);}};
""")
replace("getCollections:()=>collections,isBusy:()=>busy,hasPausedUpload:()=>!!batch", "getCollections:()=>collections,isBusy:()=>busy||restoringLocal,hasPausedUpload:()=>!!batch,getScope:()=>scope,getVisible:recordsVisible,getSharedSelection:()=>sharedSelection,selectFields,saveSelections,reloadLocal,removeLocal,setScope,render:renderGrid,setBusy,toast,saveLocalFeedback,getLocalInfo:()=>localInfo,releasePaused")
replace("render:renderGrid,busy:()=>busy||!!batch,release:", "render:()=>{renderGrid();saveSelections().catch(fail);},busy:()=>busy||restoringLocal||!!batch,release:")
replace("if(batch||$('commentBody').value||V.polygon||V.points.length)", "if(busy||$('commentBody').value||V.polygon||V.points.length)")
start="(async()=>{membershipUI();try{if(B.configured){await B.restoreRedirect();if(B.hasSession()){await loadShared();await openDeepLink();}}}catch(e){toast(e.message);}})();"
replace(start,"""(async()=>{
 membershipUI();
 try{await reloadLocal();const view=await L.setting('view');if(view){scope=view.scope==='shared'?'shared':'local';nav=['all','fiji','bbbc038','mine'].includes(view.nav)?view.nav:'all';$('search').value=view.search||'';$('annotationFilter').value=view.annotation||'all';}else scope=local.length?'local':'shared';
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===nav));setScope(scope);if(view?.collection)$('collectionFilter').value=view.collection;renderGrid();
 }catch(e){toast('Local library could not open: '+e.message+'. Do not clear site data.');}
 finally{restoringLocal=false;updatePublish();}
 try{if(B.configured){await B.restoreRedirect();if(B.hasSession()){await loadShared();await restoreJob();await openDeepLink();}}}catch(e){toast(e.message);}
})();""")
s=s.replace('Back to staging','Back to local library').replace('All staged files','All local files')
s=s.replace('release the paused upload, reselect source files and choose Resume draft','release the paused upload and select saved local fields to Resume draft')
s=s.replace('Imported files are not shared yet. Empty/draft collections are managed separately, not counted as shared collections.', 'Files are saved on this device; no cloud upload until you confirm. Empty or draft collections are managed separately.')
(p/'site/js/app.js').write_text('/* persistent-device-workspace-v2 */\n'+s)
index=p/'site/index.html';html=index.read_text()
html=html.replace('<script src="js/app.js"></script>', '<script src="js/local-store.js?v=2.0"></script><script src="js/app.js?v=2.0"></script>')
html=html.replace('<script src="js/management.js"></script>', '<script src="js/management.js"></script><script src="js/workspace-ui.js?v=2.0"></script>')
index.write_text(html)
# Abort a failing local write transaction cleanly, including quota failures.
f=p/'site/js/local-store.js';t=f.read_text()
t=t.replace("let existing=null;\n  const q=rs.get(id);q.onsuccess=()=>{existing=q.result;if(existing)return;for(const a of assets)tx.objectStore('assets').put(a);rs.put(row);};\n  await done;", "let existing=null,writeError=null;\n  const q=rs.get(id);q.onsuccess=()=>{try{existing=q.result;if(existing)return;for(const a of assets)tx.objectStore('assets').put(a);rs.put(row);}catch(e){writeError=e;tx.abort();}};\n  try{await done;}catch(e){throw writeError||e;}")
f.write_text(t)
print('Integrated persistent local library without changing source decoders or database policies.')
