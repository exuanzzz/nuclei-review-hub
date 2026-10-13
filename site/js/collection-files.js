/* Explicit file queue and collection targets. Selecting files never publishes them.
 * Original files remain unchanged; local copies are saved before any cloud upload. */
window.addEventListener('DOMContentLoaded',()=>{
 'use strict';
 const H=window.Hub,$=id=>document.getElementById(id);
 const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const button=(id,text,fn)=>{const b=el('button',text);b.id=id;b.type='button';b.onclick=()=>Promise.resolve(fn()).catch(e=>H.toast(e.message));return b;};
 const canAdd=c=>c&&!c.trashed_at&&c.state==='ready'&&H.getUser()&&(c.owner_id===H.getUser().user_id||H.getUser().role==='admin');
 const groups=()=>[...new Map(H.getLocal().map(r=>[r.localMeta.group,r.localMeta])).values()];
 const targetLabel=el('label','Add files to'),target=el('select');target.id='importCollectionTarget';targetLabel.append(target);
 $('importTitle').closest('label').before(targetLabel);
 const help=el('p');help.id='collectionImportHelp';help.className='small';targetLabel.after(help);
 let queued=[],targetMap=new Map();
 function refreshTargets(preferred=target.value){
  targetMap=new Map();const options=[new Option('New local collection','')];
  for(const g of groups()){const key='local:'+g.group;targetMap.set(key,{...g});options.push(new Option('Local collection: '+g.title,key));}
  for(const c of H.getCollections().filter(canAdd)){
   const key='shared:'+c.id;targetMap.set(key,{group:'shared:'+c.id,title:c.title,description:c.description,kind:c.kind,destination:c.id});
   options.push(new Option('Shared collection: '+c.title+' · '+c.id.slice(0,8),key));
  }
  target.replaceChildren(...options);target.value=targetMap.has(preferred)?preferred:'';showTarget();
 }
 function showTarget(){
  const t=targetMap.get(target.value);$('importTitle').readOnly=!!t;$('importKind').disabled=!!t;
  if(t){$('importTitle').value=t.title;$('importKind').value=t.kind;$('importDescription').value=t.description||'';}
  help.textContent=t?.destination?'Save the selected files locally, then Publish to this existing shared collection. Its current images and reviews are not replaced.':t?'Add files to this local collection. Nothing is uploaded until you choose Publish.':'Create a new local collection. You can still choose an existing shared destination when publishing.';
 }
 target.onchange=showTarget;
 function resolve(){if(!target.value)return null;const t=targetMap.get(target.value);if(!t)throw Error('Choose an available collection.');return {...t};}
 function contextTarget(){
  const cur=H.getCurrent();if(cur?.version&&canAdd(cur.record.collection))return 'shared:'+cur.record.collection.id;
  const chosen=$('collectionFilter').value;
  if(H.getScope()==='shared'&&canAdd(H.getCollections().find(c=>c.id===chosen)))return 'shared:'+chosen;
  if(H.getScope()==='local'&&groups().some(g=>g.group===chosen))return 'local:'+chosen;
  return '';
 }
 function open(preferred=contextTarget()){
  if(H.isBusy()||H.hasPausedUpload())return H.toast('Finish or release the paused upload first. Saved files remain on this device.');
  if(H.getCurrent()){$('closeViewer').click();if(!$('viewer').classList.contains('hidden'))return;}
  $('managementDialog')?.close();refreshTargets(preferred);if(!$('importDialog').open)$('importDialog').showModal();
 }
 $('importOpen').onclick=()=>open();
 new MutationObserver(()=>{if($('importDialog').open)refreshTargets(target.value);}).observe($('importDialog'),{attributes:true,attributeFilter:['open']});
 const quick=button('addImagesToCollection','Add images to collection',()=>open());$('importOpen').after(quick);
 const inViewer=button('addAnotherImage','Add image to this collection',()=>open());$('downloadSource').parentElement.after(inViewer);
 // Separate picker calls let Windows users choose a TIFF and then a ZIP in ROIs/.
 const roiInput=el('input');roiInput.type='file';roiInput.accept='.zip';roiInput.multiple=true;roiInput.hidden=true;document.body.append(roiInput);
 $('chooseZip').textContent='Choose image / dataset files';
 const roiButton=button('chooseRoiFiles','Choose ROI ZIPs',()=>roiInput.click());$('chooseZip').after(roiButton);
 const box=el('section'),queueList=el('div'),queueCount=el('p');box.id='fileQueue';queueList.id='queuedFileNames';queueCount.id='queuedFileCount';
 const save=button('saveQueuedFiles','Save selected files locally',async()=>{
  if(H.isBusy()||!queued.length)return;
  await H.importFiles(queued.slice());queued=[];renderQueue();
 });save.className='primary';
 const clear=button('clearQueuedFiles','Clear file selection',()=>{queued=[];renderQueue();});box.append(queueCount,queueList,save,clear);$('importDialog').querySelector('.uploadbox').after(box);
 function addFiles(files){
  for(const f of files){const key=f.webkitRelativePath||f.name;const i=queued.findIndex(x=>(x.webkitRelativePath||x.name)===key);if(i<0)queued.push(f);else queued[i]=f;}
  renderQueue();
 }
 $('fileInput').onchange=e=>{addFiles([...e.target.files]);e.target.value='';};roiInput.onchange=e=>{addFiles([...e.target.files]);e.target.value='';};
 function renderQueue(){
  queueCount.textContent=queued.length?`${queued.length} selected files · not saved or uploaded yet`:'Choose just the new image and its matching ROI ZIP. No folder re-upload is required.';
  queueList.replaceChildren(...queued.map(f=>{const row=el('div'),text=el('span',f.name),remove=button('', 'Remove',()=>{queued=queued.filter(x=>x!==f);renderQueue();});row.append(text,remove);return row;}));
  save.disabled=!queued.length||H.isBusy();clear.disabled=!queued.length||H.isBusy();
 }
 const style=el('style');style.textContent='#fileQueue{margin:10px 0;padding:10px;border:1px solid var(--line);border-radius:9px}#queuedFileNames{max-height:145px;overflow:auto}#queuedFileNames>div{display:flex;justify-content:space-between;align-items:center;gap:7px;font-size:11px;overflow-wrap:anywhere}#queuedFileNames button{font-size:10px;padding:3px 7px}#fileQueue>button{margin:8px 7px 0 0;font-size:12px}#addImagesToCollection{font-size:12px}#addAnotherImage{font-size:11px;margin-top:8px}';document.head.append(style);
 $('importDialog').querySelector('.uploadbox p').textContent='Choose the new TIFF(s), then choose matching *_rois.zip archives—even from another folder. Click Save selected files locally to preview. A parent folder or reference dataset ZIP is also supported.';
 async function imported(meta,ids){
  if(!meta.destination){if(target.value){$('collectionFilter').value=meta.group;H.render();}return;}
  const wanted=new Set(ids);for(const r of H.getLocal())r.selected=wanted.has(r.localId)&&!r.error;
  $('search').value='';$('collectionFilter').value='';$('annotationFilter').value='all';H.setScope('local');H.render();
  $('uploadDestination').value=meta.destination;await H.saveSelections();H.render();
  H.toast(`Saved locally. ${wanted.size} image(s) queued for “${meta.title}”. Check them and click Publish selected to team; nothing has been uploaded yet.`);
 }
 function decorateManager(){
  for(const row of document.querySelectorAll('#managementList .management-row')){
   if(row.querySelector('.append-to-collection'))continue;
   const id=row.querySelector('[data-manage-action="trash"]')?.dataset.targetId,c=H.getCollections().find(x=>x.id===id);if(!canAdd(c))continue;
   const b=button('','Add images',()=>open('shared:'+c.id));b.className='append-to-collection';row.append(b);
  }
 }
 function sync(){
  quick.classList.toggle('hidden',!H.getUser()||H.getScope()!=='shared');quick.disabled=H.isBusy()||H.hasPausedUpload();
  inViewer.classList.toggle('hidden',!H.getCurrent()?.version||!canAdd(H.getCurrent()?.record.collection));inViewer.disabled=H.isBusy()||H.hasPausedUpload();renderQueue();
 }
 new MutationObserver(decorateManager).observe($('managementList'),{childList:true});
 new MutationObserver(sync).observe($('viewer'),{attributes:true,attributeFilter:['class']});
 window.addEventListener('nr:state',sync);sync();refreshTargets('');
 window.CollectionFiles={resolve,imported,open,addFiles,refreshTargets,build:'flexible-upload-v1'};
});
