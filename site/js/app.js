/* Upload preflight and library summaries. Source pixels/ROI coordinates are never repaired.
   Review storage is not a certification of training-label quality. */
(function(root){
'use strict';
const $=id=>document.getElementById(id);
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function sharedState(collections,fields,versions){
 const byCollection=new Map(collections.filter(c=>!c.trashed_at).map(c=>[c.id,c]));
 const byField=new Map();for(const v of versions)if(v.state==='ready'&&!v.trashed_at){if(!byField.has(v.field_id))byField.set(v.field_id,[]);byField.get(v.field_id).push(v);}
 const records=[];for(const f of fields){const c=byCollection.get(f.collection_id),vs=byField.get(f.id)||[];
  if(f.trashed_at||!c||c.state!=='ready'||!vs.length)continue;vs.sort((a,b)=>b.seq-a.seq);
  records.push({...f,key:f.source_key,kind:c.kind,collection:c,version:vs[0],versions:vs,objectCount:vs[0].source_object_count});
 }
 const used=new Set(records.map(f=>f.collection_id));return {records,collections:collections.filter(c=>used.has(c.id))};
}
function sameSources(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
 const sig=x=>x.map(f=>JSON.stringify([f.role,root.ReviewData.base(f.path),f.size,f.sha256])).sort();
 return JSON.stringify(sig(a))===JSON.stringify(sig(b));
}
let hooks=null,lastReport=null,resolveCheck=null;
function setup(h){
 hooks=h;const style=node('style');style.textContent=`
 .upload-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:9px}
 .upload-tools button{font-size:11px;padding:6px 9px}.upload-tools label{margin:0;flex:1;min-width:210px}.upload-tools label select{font-size:11px;padding:6px}.upload-tools p{font-size:10px;color:var(--muted);width:100%;margin:0}
 .upload-check-row{border:1px solid var(--line);border-radius:8px;padding:10px;margin:8px 0;font-size:12px;overflow-wrap:anywhere}
 .upload-check-row strong{display:block}.upload-check-row pre{font:11px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;margin:7px 0}
 .upload-check-warning{border-left:4px solid #a57024}.upload-check-error{border-left:4px solid #b33b38}
 #uploadCheckDialog{width:min(830px,94vw)}#uploadCheckRows{max-height:45vh;overflow:auto}#uploadCheckDialog label{display:flex;gap:8px;align-items:flex-start;font-size:12px}
 #uploadCheckDialog label input{margin-top:3px}.preflight-tag{font-size:10px;color:#88611f;margin-top:5px}
 `;document.head.append(style);
 const box=node('div',undefined,'upload-tools hidden');box.id='uploadTools';
 const none=node('button','Deselect all'),shown=node('button','Select shown only'),report=node('button','Download upload check'),stop=node('button','Release paused upload');
 none.id='deselectAll';shown.id='selectShownOnly';report.id='downloadUploadCheck';stop.id='releasePaused';
 const label=node('label','Upload destination'),select=node('select');select.id='uploadDestination';label.append(select);
 const hint=node('p','Imported files are not shared yet. Empty/draft collections are managed separately, not counted as shared collections.');hint.id='uploadHint';
 box.append(none,shown,report,stop,label,hint);document.querySelector('.filters').before(box);
 none.onclick=()=>{if(hooks.busy())return;for(const r of hooks.local())r.selected=false;hooks.render();};
 shown.onclick=()=>{if(hooks.busy())return;const shown=new Set(hooks.visible());for(const r of hooks.local())r.selected=shown.has(r)&&!r.error;hooks.render();};
 report.onclick=()=>downloadReport();stop.onclick=()=>hooks.release();
 const dialog=node('dialog');dialog.id='uploadCheckDialog';
 const title=node('h2','Check before publishing'),intro=node('p');intro.id='uploadCheckSummary';
 const rows=node('div');rows.id='uploadCheckRows';
 const ackLabel=node('label'),ack=node('input');ack.type='checkbox';ack.id='uploadAcknowledge';ackLabel.append(ack,node('span','I understand that flagged annotations are unverified review material. Original files and coordinates stay unchanged. Listed unreadable files will NOT be published.'));
 ackLabel.id='uploadAcknowledgeLabel';
 const actions=node('div',undefined,'actions'),cancel=node('button','Back to staging'),save=node('button','Download report'),ok=node('button','Publish reviewable files','primary');
 cancel.id='cancelUploadCheck';ok.id='confirmUploadCheck';actions.append(cancel,save,ok);dialog.append(title,intro,rows,ackLabel,actions);document.body.append(dialog);
 const finish=value=>{dialog.close();const r=resolveCheck;resolveCheck=null;r?.(value);};cancel.onclick=()=>finish(false);ok.onclick=()=>finish(true);save.onclick=()=>downloadReport();ack.onchange=()=>{ok.disabled=!ack.checked||ok.dataset.noValid==='true';};
 dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
}
function update({collections,shared,user,scope,busy,paused,kind}){
 if(!hooks)return;$('uploadTools').classList.toggle('hidden',scope!=='local'&&!paused);
 for(const id of ['deselectAll','selectShownOnly','uploadDestination'])$(id).disabled=busy||paused;
 $('downloadUploadCheck').disabled=!lastReport;$('releasePaused').classList.toggle('hidden',!paused);$('releasePaused').disabled=busy;
 const s=$('uploadDestination'),prev=s.value,options=[new Option('New collection','')];
 for(const c of collections)if(c.state==='draft'&&!c.trashed_at&&c.owner_id===user?.user_id&&c.kind===kind)options.push(new Option('Resume draft: '+c.title+' · '+c.id.slice(0,8),c.id));
 s.replaceChildren(...options);s.value=options.some(x=>x.value===prev)?prev:'';
 $('uploadHint').textContent=paused?'Upload is paused. Continue in this tab, or release the paused upload, reselect source files and choose Resume draft. No cloud records are deleted.':
  'Only checked cards are published. Filtering does not cancel hidden selections. Use Deselect all or Select shown only. To continue an earlier upload, choose Resume draft.';
}
function destination(){return $('uploadDestination')?.value||'';}
async function preflight(records,onProgress){
 const rows=[],accepted=[];for(let i=0;i<records.length;i++){
  const r=records[i];onProgress(`Checking all files before upload ${i+1}/${records.length} · ${r.name}`,Math.round(i/records.length*100));
  try{
   const d=await root.ReviewData.load(r),pack=await root.ReviewData.packageField(r,d);
   const row={name:r.name,key:r.key,image:r.image.name,width:d.w,height:d.h,image_sha256:d.sha,objects:d.objects.length,warnings:d.warnings.slice(),audit:d.audit,files:d.manifestFiles,archive_bytes:pack.blob.size,ok:true};
   r.preflight=row;r.error='';rows.push(row);accepted.push(r);
  }catch(e){const row={name:r.name,key:r.key,image:r.image.name,ok:false,error:e.message||String(e)};r.preflight=row;r.error=row.error;r.selected=false;rows.push(row);}
  await new Promise(res=>setTimeout(res,0));
 }
 lastReport={format:'nuclei-upload-preflight-v1',created_at:new Date().toISOString(),scope:'Local checks only; no files uploaded by preflight',source_policy:'No ROI shift, scaling, smoothing, clipping of source coordinates, or segmentation',rows};
 return {accepted,report:lastReport};
}
function confirmReport(report,destinationTitle){
 const rows=report.rows,valid=rows.filter(r=>r.ok),warn=valid.filter(r=>r.warnings.length),bad=rows.filter(r=>!r.ok),attention=warn.length||bad.length;
 $('uploadCheckSummary').textContent=`${valid.length} reviewable fields; ${warn.length} with QC warnings; ${bad.length} cannot be read and will be excluded. Destination: ${destinationTitle}. Resuming a draft retains its previously completed fields; this selection does not delete them. All active workspace members can access published files. This does not certify training labels.`;
 const container=$('uploadCheckRows');container.replaceChildren();
 for(const r of rows){const div=node('div',undefined,'upload-check-row'+(!r.ok?' upload-check-error':r.warnings.length?' upload-check-warning':''));div.append(node('strong',r.name));
  div.append(node('span',r.ok?`${r.width} × ${r.height} pixels · ${r.objects} source objects · ${r.warnings.length?'Needs review':'No flagged QC issues (not biological approval)'}`:'Cannot publish: '+r.error));
  if(r.ok&&r.warnings.length)div.append(node('pre',r.warnings.join('\n')));container.append(div);
 }
 $('uploadAcknowledgeLabel').classList.toggle('hidden',!attention);$('uploadAcknowledge').checked=false;
 $('confirmUploadCheck').textContent=`Publish ${valid.length} reviewable fields`;$('confirmUploadCheck').dataset.noValid=String(!valid.length);$('confirmUploadCheck').disabled=!valid.length||!!attention;
 $('uploadCheckDialog').showModal();return new Promise(r=>{resolveCheck=r;});
}
function downloadReport(){if(!lastReport)return;const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'}));a.href=u;a.download='nuclei_upload_check.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
root.ReviewWorkflow={sharedState,sameSources,setup,update,destination,preflight,confirmReport,downloadReport,getReport:()=>lastReport};
})(globalThis);


(function(root){
'use strict';
const $=id=>document.getElementById(id),C=GTCore,D=ReviewData,B=ReviewCloud,cfg=REVIEW_CONFIG,V=new ReviewViewer(),W=root.ReviewWorkflow;
let user=null,members=[],collections=[],shared=[],local=[],scope='shared',nav='all',current=null,busy=false,localInfo={},batch=null,replyTo=null,openEpoch=0,refreshingFeed=false,refreshEpoch=0;
const thumbURLs=new Map(),localFeedback=new Map(),pollMs=Math.max(10,Number(cfg.pollSeconds)||15)*1000;
const uuid=()=>crypto.randomUUID?crypto.randomUUID():([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)),when=s=>new Date(s).toLocaleString(),nameOf=id=>members.find(m=>m.user_id===id)?.display_name||'Member '+String(id||'').slice(0,7),byLocal=()=>user?.display_name||'Local reviewer';
function textEl(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
function toast(s){$('toast').textContent=s;$('toast').classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.add('hidden'),8500);}
function fail(e){console.error(e);toast(e.message||String(e));}
function progress(s,p=0){$('progressBox').classList.remove('hidden');$('progressText').textContent=s;$('progress').value=p;}
function setBusy(b){busy=b;for(const id of ['publish','importOpen','refresh','fileInput','folderInput','postComment','postProposal','postReview'])$(id).disabled=b;$('revisionUpload').disabled=b||!user||!current?.version||current?.record?.kind!=='fiji';updatePublish();}
function modal(id){$(id).showModal();}
function setScope(s){scope=s;document.querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('active',b.dataset.scope===s));$('selectAll').classList.toggle('hidden',s!=='local');$('publish').classList.toggle('hidden',s!=='local');syncCollectionFilter();renderGrid();}
function updatePublish(){const n=local.filter(r=>r.selected&&!r.error).length;$('publish').textContent=`Publish selected to team (${n})`;$('publish').disabled=busy||!user||!n||!B.configured;$('retryPublish').classList.toggle('hidden',!batch||busy);$('importOpen').disabled=busy||!!batch;$('demo').disabled=busy||!!batch;W?.update({collections,shared,user,scope,busy,paused:!!batch,kind:localInfo.kind});}
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);}
function jsonDownload(x,name){download(new Blob([JSON.stringify(x,null,2)],{type:'application/json'}),name);}
function membershipUI(){const signed=!!user;$('userLabel').textContent=signed?`${user.display_name} · ${user.role}`:'Not signed in';$('loginOpen').classList.toggle('hidden',signed);$('logout').classList.toggle('hidden',!signed);$('connection').textContent=signed?'Private cloud · connected':B.configured?'Cloud configured · signed out':'Local preview · not shared';$('memberCount').textContent=signed?members.filter(x=>x.active).length:'—';$('setupNotice').classList.toggle('hidden',B.configured);$('pollLabel').textContent=pollMs/1000;updatePublish();}
function activeCollections(){const ids=new Set(shared.map(r=>r.collection_id));return collections.filter(c=>c.state==='ready'&&!c.trashed_at&&ids.has(c.id));}
function countUI(){$('collectionCount').textContent=activeCollections().length;$('fieldCount').textContent=shared.length;$('localCount').textContent=local.length;}
function syncCollectionFilter(){const prev=$('collectionFilter').value,cols=scope==='shared'?activeCollections():[];$('collectionFilter').replaceChildren(new Option(scope==='shared'?'All collections':'All staged files',''),...cols.map(c=>new Option(c.title,c.id)));$('collectionFilter').value=cols.some(c=>c.id===prev)?prev:'';$('collectionFilter').disabled=scope!=='shared';}

function recordsVisible(){let a=scope==='local'?local:shared;const q=$('search').value.trim().toLowerCase(),col=$('collectionFilter').value,af=$('annotationFilter').value;return a.filter(x=>(nav==='all'||nav==='mine'?(nav!=='mine'||x.collection?.owner_id===user?.user_id):x.kind===nav)&&(!col||x.collection?.id===col)&&(!q||[x.name,x.collection?.title,x.kind,x.collection?nameOf(x.collection.owner_id):'',x.error].join(' ').toLowerCase().includes(q))&&(af==='all'||(af==='with'?(x.objectCount??x.annotations?.length??0)>0:(x.objectCount??x.annotations?.length??0)===0)));}
const observer=new IntersectionObserver(es=>{for(const o of es)if(o.isIntersecting){observer.unobserve(o.target);loadCloudThumb(o.target).catch(()=>{});}},{rootMargin:'200px'});
async function loadCloudThumb(img){const path=img.dataset.path;if(!path)return;if(thumbURLs.has(path)){img.src=thumbURLs.get(path);return;}try{const blob=await B.download(path),u=URL.createObjectURL(blob);thumbURLs.set(path,u);img.src=u;}catch{img.alt='Preview not yet available';}}
function renderGrid(){observer.disconnect();const list=recordsVisible();$('filterCount').textContent=list.length+' fields';const grid=$('library');grid.replaceChildren();for(const r of list){const card=textEl('article','', 'card'),btn=textEl('button','','thumb'),img=new Image();img.alt='Image field '+r.name;if(r.thumb)img.src=r.thumb;else if(r.version){img.dataset.path=r.version.thumbnail_path;observer.observe(img);}const tag=textEl('span',r.kind==='fiji'?'FIJI ROI':'REFERENCE MASKS','tag');btn.append(img,tag);btn.onclick=()=>openField(r).catch(fail);const body=textEl('div','','cardbody');if(scope==='local'){const ck=document.createElement('input');ck.type='checkbox';ck.checked=!!r.selected;ck.disabled=!!r.error;ck.className='select-field';ck.setAttribute('aria-label','Select '+r.name);ck.onchange=()=>{r.selected=ck.checked;updatePublish();};body.append(ck);}body.append(textEl('div',r.name,'cardtitle'),textEl('div',r.collection?`${r.collection.title} · ${nameOf(r.collection.owner_id)}`:localInfo.title||'Local staging','card-sub'));const meta=textEl('div','','card-meta');meta.append(textEl('span',r.error?'Import needs attention':r.objectCount!==undefined?r.objectCount+' source objects':r.annotations?.length?'Annotation file found':'No annotation file'),textEl('span',r.version?'v'+r.version.seq:'Local only'));body.append(meta);if(r.error)body.append(textEl('p',r.error,'small warning'));else if(r.preflight?.warnings?.length)body.append(textEl('p','Needs review · '+r.preflight.warnings.length+' QC notices','preflight-tag'));card.append(btn,body);grid.append(card);}
 if(!list.length){const e=textEl('div','','empty');e.append(textEl('span','⌁','empty-icon'),textEl('h2',scope==='shared'?'No shared fields to display':'No staged fields'),textEl('p',scope==='shared'?'Sign in to your configured workspace. Local imports are not shared until you publish them.':'Choose TIFF/ROI files or a reference-mask dataset.'));grid.append(e);}countUI();updatePublish();}
async function loadShared(){
 if(!B.configured){modal('setupDialog');return;}if(!B.hasSession()){modal('loginDialog');return;}
 const generation=++refreshEpoch,me=await B.me();
 const [ms,cs,fs,vs]=await Promise.all([
  B.listAll('nr_members','select=*&order=created_at'),B.listAll('nr_collections','select=*&order=created_at.desc'),
  B.listAll('nr_fields','select=*&order=created_at.desc'),B.listAll('nr_versions','select=id,field_id,parent_id,seq,author_id,summary,object_path,thumbnail_path,archive_sha256,archive_bytes,source_object_count,state,created_at&state=eq.ready&order=seq.desc')]);
 if(generation!==refreshEpoch||!B.hasSession())return;
 user=me;members=ms;collections=cs;shared=W.sharedState(cs,fs,vs).records;
 syncCollectionFilter();membershipUI();renderGrid();
}
async function importFiles(files,isFolder=false){if(!files.length||busy)return;if(batch)return toast('Release or finish the paused upload before importing another folder.');setBusy(true);try{localInfo={title:$('importTitle').value.trim()||'Untitled collection',kind:$('importKind').value,description:$('importDescription').value};progress('Reading file directory…',0);const entries=isFolder?D.checkedEntries([...files].map(D.entry)):await D.expand([...files]);const p=D.pair(localInfo.kind,entries);if(!p.records.length)throw Error('No image/annotation pairs found. Check the selected input layout.');local=p.records.map(r=>({...r,selected:true}));$('importDialog').close();nav='all';document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav==='all'));setScope('local');if(p.issues.length)toast(p.issues.join('\n'));
 for(let i=0;i<local.length;i++){const r=local[i];progress(`Preview ${i+1}/${local.length} · ${r.name}`,100*i/local.length);try{const t=await D.thumbnail(r);r.thumb=t.url;r.width=t.w;r.height=t.h;}catch(e){r.error=e.message;r.selected=false;}if(i%3===0){renderGrid();await new Promise(x=>setTimeout(x,0));}}
 progress(`${local.length} fields staged locally. Nothing uploaded yet.`,100);renderGrid();
 }finally{setBusy(false);}}
function thumbnailBlob(d){const c=D.canvas(d.w,d.h,D.rgba(d)),t=document.createElement('canvas');t.width=360;t.height=Math.max(1,Math.round(360*d.h/d.w));t.getContext('2d').drawImage(c,0,0,t.width,t.height);return new Promise(r=>t.toBlob(r,'image/png'));}
async function putOrVerify(path,blob,hash,onProgress){try{const old=await B.download(path);if(await C.sha256(new Uint8Array(await old.arrayBuffer()))!==hash)throw Error('An existing upload has different bytes. It will not be overwritten.');onProgress?.(blob.size,blob.size);return;}catch(e){if(![400,404].includes(e.status))throw e;}return B.upload(path,blob,hash,onProgress);}
async function uploadVersion(r,d,field,parent,summary,work={}){
 if(work.complete)return work.v;
 let pack=await D.packageField(r,d);const thumb=await thumbnailBlob(d),thumbHash=await C.sha256(new Uint8Array(await thumb.arrayBuffer()));
 if(work.v){
  if(work.v.archive_sha256!==pack.sha){
   // Previously stored archive bytes are authoritative; never replace them with
   // a repacked archive or a newer manifest under the same immutable version ID.
   let old;try{old=await B.download(work.v.object_path);}catch(e){throw Error('Cannot resume this unfinished archive with different package bytes: '+r.name+'. Source data was not overwritten. Keep the same files/path or use a new collection. '+e.message);}
   const restored=await D.readPackage(old,work.v.archive_sha256);
   if(restored.d.sha!==d.sha||!W.sameSources(restored.d.manifestFiles,d.manifestFiles))throw Error('Resumed source files differ from the stored version: '+r.name);
   pack={blob:old,sha:work.v.archive_sha256};
  }
 }else{
  const result=await B.rpc('nr_create_version',{p_field:field.id,p_parent:parent,p_summary:summary,p_manifest:pack.manifest,p_hash:pack.sha,p_bytes:pack.blob.size});
  work.v=Array.isArray(result)?result[0]:result;if(!work.v?.id)throw Error('No version record returned by the backend.');
 }
 progress('Uploading '+r.name+' · '+(pack.blob.size/1024**2).toFixed(1)+' MiB');
 await putOrVerify(work.v.object_path,pack.blob,pack.sha,(n,total)=>progress('Uploading '+r.name,Math.round(n/total*100)));
 await putOrVerify(work.v.thumbnail_path,thumb,thumbHash);await B.rpc('nr_publish_version',{p_id:work.v.id});work.complete=true;return work.v;
}
async function resumeWork(collection,list){
 const rows=await B.listAll('nr_collections','id=eq.'+collection+'&select=*'),c=rows[0];
 if(!c||c.state!=='draft'||c.trashed_at||c.owner_id!==user.user_id)throw Error('Only your accessible unfinished collection can be resumed.');
 if(c.kind!==localInfo.kind)throw Error('The draft collection uses a different input layout.');
 const fs=await B.listAll('nr_fields','collection_id=eq.'+c.id+'&select=*'),work={};
 for(const r of list){const f=fs.find(f=>f.source_key===r.key);if(!f)continue;
  if(f.image_sha256!==r.preflight.image_sha256||f.width!==r.preflight.width||f.height!==r.preflight.height)throw Error('Draft source image does not match: '+r.name+'. No existing source is overwritten.');
  const vs=await B.listAll('nr_versions','field_id=eq.'+f.id+'&select=*&order=seq.desc');
  const match=vs.find(v=>W.sameSources(v.manifest?.files,r.preflight.files));
  if(vs.length&&!match)throw Error('Draft annotations differ from these selected files: '+r.name+'. Resume with the original files, or publish a separate collection.');
  work[r.key]={field:f,v:match||null,complete:match?.state==='ready'};
 }
 return {collection:c,work};
}
async function publish(){
 if(busy)return;if(!user)return toast('Sign in as an approved member before publishing.');
 setBusy(true);let currentName='';
 try{
  if(!batch){
   const selected=local.filter(r=>r.selected&&!r.error);if(!selected.length)return;
   const dest=W.destination(),checked=await W.preflight(selected,progress);renderGrid();
   const title=dest?(collections.find(c=>c.id===dest)?.title||'Existing draft'):localInfo.title||'Untitled collection';
   if(!await W.confirmReport(checked.report,title)){progress('Nothing uploaded. Review the preflight report and selected files.',0);return;}
   const list=checked.accepted;if(!list.length)return;
   if(list.some(r=>r.kind!==localInfo.kind))throw Error('Select only one data type per collection.');
   const resumed=dest?await resumeWork(dest,list):null;
   batch={id:dest||uuid(),list,title:resumed?.collection.title||localInfo.title,kind:localInfo.kind,description:localInfo.description,index:0,work:resumed?.work||{},created:!!resumed};
  }
  if(!batch.created){await B.insert('nr_collections',{id:batch.id,title:batch.title,kind:batch.kind,description:batch.description});batch.created=true;}
  while(batch.index<batch.list.length){
   const r=batch.list[batch.index];currentName=r.name;const work=batch.work[r.key]||(batch.work[r.key]={});
   if(work.complete){progress(`Keeping existing completed upload ${batch.index+1}/${batch.list.length} · ${r.name}`,100*batch.index/batch.list.length);batch.index++;continue;}
   progress(`Validating field ${batch.index+1}/${batch.list.length} · ${r.name}`);const d=await D.load(r);
   if(r.preflight&&!W.sameSources(r.preflight.files,d.manifestFiles))throw Error('Files changed after preflight; re-import before publishing.');
   if(!work.field)work.field=(await B.insert('nr_fields',{id:uuid(),collection_id:batch.id,source_key:r.key,name:r.name,width:d.w,height:d.h,image_sha256:d.sha}))[0];
   await uploadVersion(r,d,work.field,null,'Original source upload',work);batch.index++;
  }
  currentName='collection '+batch.title;await B.rpc('nr_publish_collection',{p_id:batch.id});
  const count=batch.list.length;batch=null;await loadShared();setScope('shared');progress('Collection published to team storage.',100);toast('Published '+count+' selected fields. QC warnings, if any, remain attached for review.');
 }catch(e){
  progress((batch?'Upload paused':'Preflight stopped')+(currentName?' at '+currentName:'')+': '+e.message+(batch?' Keep this page open and choose Continue interrupted upload.':' No new upload batch was started.'),0);throw e;
 }finally{setBusy(false);}
}
async function releasePaused(){
 if(busy||!batch)return;
 if(!confirm('Release the paused upload in this tab? Completed cloud files remain in an unfinished collection; nothing is deleted. Re-import the same source files and choose Resume draft to continue.'))return;
 batch=null;await loadShared();setScope('local');progress('Paused upload released. Cloud draft retained. Choose Resume draft after checking your files.',0);
}
function feedbackLocal(r){if(!localFeedback.has(r))localFeedback.set(r,{comments:[],proposals:[],reviews:[]});return localFeedback.get(r);}
async function openField(r,version){const generation=++openEpoch;if(current&&($('commentBody').value||V.polygon||V.points.length)&&!confirm('Discard your unsent comment or polygon draft?'))return;current={record:r,version:version||r.version||null,data:null,archive:null};$('viewer').classList.remove('hidden');document.body.style.overflow='hidden';$('vCollection').textContent=r.collection?.title||localInfo.title||'Local staging';$('vTitle').textContent=r.name;$('vSubtitle').textContent='Loading source files and verifying integrity…';for(const id of ['commentBody','proposalLabel','proposalNote','decisionBody'])$(id).value='';replyTo=null;$('replyStatus').textContent='';$('commentList').replaceChildren();$('proposalList').replaceChildren();$('reviewList').replaceChildren();
 try{let d,rr=r;if(current.version){const blob=await B.download(current.version.object_path);const loaded=await D.readPackage(blob,current.version.archive_sha256);d=loaded.d;rr=loaded.r;current.archive=blob;}else d=await D.load(r);if(generation!==openEpoch)return;current.data=d;current.sourceRecord=rr;r.objectCount=d.objects.length;$('vSubtitle').textContent=`${d.w} × ${d.h} pixels · ${d.kind==='fiji'?'Fiji ROI coordinates':'Supplied PNG-mask boundaries'} · ${d.objects.length} source objects`;
 $('shareStatus').textContent=current.version?'Shared · '+(r.collection?.state==='ready'?'team visible':'draft collection'):'Local preview · not shared';$('shareStatus').classList.toggle('local',!current.version);
 $('fidelity').textContent=d.kind==='bbbc038'?'Mask fidelity passed: 0 changed mask pixels; 0 boundary-rule disagreements. Source masks are not predictions.':(d.audit?.coordinate_review==='required'?'COORDINATE REVIEW REQUIRED. Some saved ROIs extend beyond the image. Source coordinates/files are unchanged; upload is not training-label approval.':'Saved ROI coordinates decoded without smoothing or fitting. Browser strokes are not Fiji’s rasterized training mask.');
 $('fieldWarnings').textContent=d.warnings.join('\n');$('sourceHash').textContent='Image SHA-256: '+d.sha+(current.version?'\nArchive SHA-256: '+current.version.archive_sha256:'');$('versionSelect').replaceChildren(...(r.versions?.length?r.versions.map(v=>new Option('v'+v.seq+' · '+nameOf(v.author_id)+' · '+when(v.created_at),v.id)):[new Option('Local original','local')]));if(current.version)$('versionSelect').value=current.version.id;
 V.open(d,{onError:toast,onAnchor:a=>$('anchorStatus').textContent=a?`Point: x=${a.x.toFixed(1)}, y=${a.y.toFixed(1)}`:'No point anchor selected',onDraft:(n,done)=>{$('proposalDraft').textContent=n?(done?`Closed polygon · ${n} vertices`:`Drawing · ${n} vertices`):'No polygon drafted';if(n)setPanel('proposals');}});
 for(const [id,label]of [['postComment','Post to team'],['postProposal','Submit proposal'],['postReview','Record decision']])$(id).textContent=current.version?label:'Save local draft';$('copyLink').disabled=!current.version;$('revisionUpload').disabled=!current.version||r.kind!=='fiji';$('verdict').querySelector('[value=approved]').disabled=!user||!['admin','reviewer'].includes(user.role)||current.version?.author_id===user?.user_id;$('verdict').value='discussion';
 await refreshFeedback();renderGrid();if(current.version){const u=new URL(location.href);u.searchParams.set('version',current.version.id);if(/^https?:$/.test(location.protocol))history.replaceState(null,'',u);}
 }catch(e){if(generation===openEpoch){$('vSubtitle').textContent='No verified overlay: '+e.message;V.close();current.data=null;}throw e;}}
function closeViewer(){if(($('commentBody').value||V.polygon||V.points.length)&&!confirm('Discard unsent comment or polygon draft?'))return;openEpoch++;current=null;V.close();$('viewer').classList.add('hidden');document.body.style.overflow='';const u=new URL(location.href);u.searchParams.delete('version');if(/^https?:$/.test(location.protocol))history.replaceState(null,'',u);}
function setPanel(panel){document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===panel));for(const p of ['comments','proposals','reviews'])$(p+'Panel').classList.toggle('hidden',p!==panel);}
async function refreshFeedback(){if(!current?.data||refreshingFeed)return;refreshingFeed=true;const cur=current;try{let f;if(cur.version){const q='version_id=eq.'+cur.version.id+'&select=*&order=created_at.asc';const [comments,proposals,reviews]=await Promise.all([B.listAll('nr_comments',q),B.listAll('nr_proposals',q),B.listAll('nr_reviews',q)]);f={comments,proposals,reviews};}else f=feedbackLocal(cur.record);if(current!==cur)return;current.feedback=f;renderFeedback(f);V.setReview(f.proposals,f.comments);}finally{refreshingFeed=false;}}
function messageBlock(row,type){const e=textEl('div','','message'),by=textEl('div','','by');by.append(textEl('strong',row.localAuthor||nameOf(row.author_id)),textEl('span',when(row.created_at),'time'));e.append(by);if(type==='comment'){if(row.roi_ref)e.append(textEl('div','Object: '+row.roi_ref.split(':').slice(1).join(':'),'target'));if(row.reply_to)e.append(textEl('div','Reply to '+row.reply_to.slice(0,8),'target'));e.append(textEl('div',row.body,'text'));const reply=textEl('button','Reply');reply.onclick=()=>{replyTo=row.id;$('replyStatus').textContent='Replying to '+(row.localAuthor||nameOf(row.author_id))+' · click to cancel';$('commentBody').focus();};e.append(reply);if(row.anchor){const locate=textEl('button','Show point');locate.onclick=()=>V.focus(row.anchor);e.append(locate);}}
 if(type==='proposal'){e.append(textEl('strong',row.label),textEl('div',row.note,'text'),textEl('div',row.geometry.points.length+' vertices · proposal, not source GT','target'));const locate=textEl('button','Locate');locate.onclick=()=>{const p=row.geometry.points;V.focus({x:p.reduce((s,x)=>s+x[0],0)/p.length,y:p.reduce((s,x)=>s+x[1],0)/p.length});};e.append(locate);}
 if(type==='review')e.append(textEl('span',row.verdict.replace(/_/g,' '),'verdict'),textEl('div',row.body,'text'));return e;}
function renderFeedback(f){$('commentList').replaceChildren(...f.comments.map(r=>messageBlock(r,'comment')));$('proposalList').replaceChildren(...f.proposals.map(r=>messageBlock(r,'proposal')));$('reviewList').replaceChildren(...f.reviews.map(r=>messageBlock(r,'review')));}
async function saveFeedback(type){if(!current?.data)return;const cur=current,ver=cur.version?.id,o=cur.data.objects.find(x=>x.index===V.selected),id=uuid();let row;if(type==='comments'){const body=$('commentBody').value.trim();if(!body)return toast('Write a comment first.');row={id,body,roi_ref:o?.ref||'',anchor:V.anchor,reply_to:replyTo};}else if(type==='proposals'){if(!V.polygon)return toast('Draw and finish a valid polygon first.');const label=$('proposalLabel').value.trim();if(!label)return toast('Give the proposal a label.');row={id,label,geometry:V.polygon,note:$('proposalNote').value.trim()};}else row={id,verdict:$('verdict').value,body:$('decisionBody').value.trim()};
 if(ver){await B.insert('nr_'+type,{...row,version_id:ver});toast('Saved to shared database.');}else{feedbackLocal(cur.record)[type].push({...row,created_at:new Date().toISOString(),localAuthor:byLocal()});toast('Local draft only. Not shared with anyone. Export review JSON to keep it.');}
 if(current!==cur)return;if(type==='comments'){$('commentBody').value='';replyTo=null;$('replyStatus').textContent='';V.anchor=null;V.handlers.onAnchor(null);}if(type==='proposals'){$('proposalLabel').value='';$('proposalNote').value='';V.polygon=null;V.points=[];V.handlers.onDraft(0,false);}if(type==='reviews')$('decisionBody').value='';await refreshFeedback();}
async function uploadRevision(f){if(!f||!current?.version||!user)return;const cur=current;if(!/_rois\.zip$/i.test(f.name))throw Error('Use a complete *_rois.zip archive for this image.');if(cur.record.kind!=='fiji')throw Error('Reference GT cannot be replaced.');if(ROIReview.roiKey(f.name)!==cur.sourceRecord.key)throw Error('The ROI archive name does not match this source image. Keep the original sample stem.');if(!confirm('Upload a complete new ROI version for this image? Old versions and reviews will be kept.'))return;setBusy(true);try{const r={...cur.sourceRecord,annotations:[D.entry(f)]},d=await D.load(r);if(d.sha!==cur.record.image_sha256)throw Error('The source image hash changed.');if(d.warnings.length&&!confirm('This revised ROI archive has QC warnings:\n'+d.warnings.join('\n')+'\n\nKeep the original coordinates and submit as unverified review material?'))return;const v=await uploadVersion(r,d,cur.record,cur.version.id,'Revised Fiji ROI archive: '+f.name);await loadShared();const item=shared.find(x=>x.id===cur.record.id);await openField(item,item.versions.find(x=>x.id===v.id));toast('New version published. Reviews from the old version remain with it.');}finally{setBusy(false);}}
async function exportProposals(){if(!current?.data)return;const p=current.feedback?.proposals||[];if(!p.length)return toast('No submitted proposals in this version.');const items=p.map((r,i)=>({name:`proposal_${i+1}_${r.id.slice(0,8)}.roi`,bytes:D.encodeProposalROI(r.geometry.points,'proposal_'+(i+1),current.data.w,current.data.h)}));items.push({name:'PROPOSALS_NOT_GT.json',bytes:new TextEncoder().encode(JSON.stringify({image_sha256:current.data.sha,version:current.version?.id||null,note:'Web proposals, not approved source labels. ImageJ export uses float32 subpixel coordinates; JSON keeps submitted coordinates.',proposals:p},null,2))});download(await C.makeZip(items),'proposals_rois.zip');}
async function openTeam(){if(!user)return modal('loginDialog');members=await B.listAll('nr_members','select=*&order=created_at');const list=$('membersList');list.replaceChildren();for(const m of members){const row=textEl('div','','member');row.append(textEl('span',m.display_name+(m.active?'':' · inactive')),textEl('span',m.role,'role'));if(user.role==='admin'&&m.user_id!==user.user_id&&m.active){const b=textEl('button','Deactivate');b.onclick=async()=>{if(confirm('Revoke workspace access for '+m.display_name+'?')){try{await B.rpc('nr_deactivate_member',{p_user:m.user_id});await openTeam();}catch(e){fail(e);}}};row.append(b);}list.append(row);}$('addMemberForm').classList.toggle('hidden',user.role!=='admin');if(!$('teamDialog').open)modal('teamDialog');}
$('importOpen').onclick=()=>modal('importDialog');$('emptyImport')?.addEventListener('click',()=>modal('importDialog'));$('chooseZip').onclick=()=>$('fileInput').click();$('chooseFolder').onclick=()=>$('folderInput').click();$('fileInput').onchange=e=>{importFiles(e.target.files).catch(fail);e.target.value='';};$('folderInput').onchange=e=>{importFiles(e.target.files,true).catch(fail);e.target.value='';};$('refresh').onclick=()=>loadShared().catch(fail);$('publish').onclick=()=>publish().catch(fail);$('retryPublish').onclick=()=>publish().catch(fail);$('selectAll').onclick=()=>{for(const r of recordsVisible())if(!r.error)r.selected=true;renderGrid();};document.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>setScope(b.dataset.scope));document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{nav=b.dataset.nav;document.querySelectorAll('[data-nav]').forEach(x=>x.classList.toggle('active',x===b));$('breadcrumb').textContent='Workspace / '+b.textContent.trim();renderGrid();});for(const id of ['search','collectionFilter','annotationFilter'])$(id).addEventListener(id==='search'?'input':'change',renderGrid);
$('openSetup').onclick=()=>modal('setupDialog');$('loginOpen').onclick=()=>B.configured?modal('loginDialog'):modal('setupDialog');$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginMessage').textContent='Signing in…';try{user=await B.signIn($('email').value,$('password').value);$('password').value='';await loadShared();$('loginDialog').close();await openDeepLink();}catch(err){$('loginMessage').textContent=err.message;}};
$('magicLink').onclick=async()=>{try{await B.sendLink($('email').value);$('loginMessage').textContent='Check your email. Only previously invited Auth accounts can receive this link.';}catch(e){$('loginMessage').textContent=e.message;}};
$('logout').onclick=async()=>{refreshEpoch++;try{await B.signOut();}catch{}user=null;members=[];collections=[];shared=[];if(current?.version){current=null;V.close();$('viewer').classList.add('hidden');document.body.style.overflow='';}for(const u of thumbURLs.values())URL.revokeObjectURL(u);thumbURLs.clear();membershipUI();renderGrid();};
$('openTeam').onclick=()=>openTeam().catch(fail);$('addMemberForm').onsubmit=async e=>{e.preventDefault();try{await B.rpc('nr_add_member',{p_email:$('memberEmail').value,p_name:$('memberName').value,p_role:$('memberRole').value});$('memberEmail').value='';$('memberName').value='';await openTeam();}catch(err){fail(err);}};
$('setPassword').onclick=async()=>{try{await B.setPassword($('newPassword').value);$('newPassword').value='';toast('Password saved.');}catch(e){fail(e);}};
$('closeViewer').onclick=closeViewer;$('copyLink').onclick=async()=>{if(!current?.version)return;const u=new URL(location.href);u.searchParams.set('version',current.version.id);try{await navigator.clipboard.writeText(u.href);toast('Review link copied. The recipient must be a workspace member.');}catch{prompt('Copy this member-only review URL:',u.href);}};
$('versionSelect').onchange=()=>{const v=current?.record.versions?.find(v=>v.id===$('versionSelect').value);if(v)openField(current.record,v).catch(fail);};document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>setPanel(b.dataset.panel));$('replyStatus').onclick=()=>{replyTo=null;$('replyStatus').textContent='';};$('postComment').onclick=()=>saveFeedback('comments').catch(fail);$('postProposal').onclick=()=>saveFeedback('proposals').catch(fail);$('postReview').onclick=()=>saveFeedback('reviews').catch(fail);$('revisionUpload').onclick=()=>$('revisionInput').click();$('revisionInput').onchange=e=>{uploadRevision(e.target.files[0]).catch(fail);e.target.value='';};$('exportProposals').onclick=()=>exportProposals().catch(fail);
$('downloadSource').onclick=async()=>{if(!current?.data)return;try{const p=current.archive|| (await D.packageField(current.sourceRecord,current.data)).blob;download(p,current.record.name+'_source.zip');}catch(e){fail(e);}};
$('exportReview').onclick=()=>{if(current?.data)jsonDownload({format:'nuclei-collaborative-review-v1',cloud_saved:!!current.version,field:current.record.name,version:current.version?.id||null,image_sha256:current.data.sha,audit:current.data.audit,feedback:current.feedback},'review_'+current.record.name+'.json');};
$('demo').onclick=async()=>{try{localInfo={title:'SYNTHETIC DEMO · not biological ground truth',description:'Artificial test fixtures for UI and decoder validation.',kind:'fiji'};local=await ReviewDemo.records();for(const r of local){const t=await D.thumbnail(r);r.thumb=t.url;r.selected=false;}setScope('local');toast('Synthetic demo loaded locally. No experimental data and no cloud upload.');}catch(e){fail(e);}};
async function openDeepLink(){const id=new URL(location.href).searchParams.get('version');if(!id||!user)return;const r=shared.find(x=>x.versions.some(v=>v.id===id));if(r)await openField(r,r.versions.find(v=>v.id===id));else toast('This version is not accessible to your account or is not ready.');}
setInterval(()=>{if(current?.version&&!busy)refreshFeedback().catch(e=>{console.error(e);$('shareStatus').textContent='Sync failed · '+e.message;});},pollMs);setInterval(()=>{if(user&&!current&&!busy&&scope==='shared')loadShared().catch(console.error);},Math.max(pollMs*2,30000));
window.addEventListener('beforeunload',e=>{if(batch||$('commentBody').value||V.polygon||V.points.length){e.preventDefault();e.returnValue='';}});
window.addEventListener('unhandledrejection',e=>fail(e.reason||Error('Unexpected error')));
root.Hub={getLocal:()=>local,getShared:()=>shared,getCurrent:()=>current,getViewer:()=>V,importFiles,openField,loadShared,publish,saveFeedback,refreshFeedback,getUser:()=>user,getCollections:()=>collections,isBusy:()=>busy,hasPausedUpload:()=>!!batch};
W.setup({local:()=>local,visible:recordsVisible,render:renderGrid,busy:()=>busy||!!batch,release:()=>releasePaused().catch(fail)});
(async()=>{membershipUI();try{if(B.configured){await B.restoreRedirect();if(B.hasSession()){await loadShared();await openDeepLink();}}}catch(e){toast(e.message);}})();
})(globalThis);
