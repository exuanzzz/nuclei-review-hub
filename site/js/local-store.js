/* Durable device library. Blobs are source bytes, not rendered previews.
 * IndexedDB is scoped to this browser profile and origin. Never a cloud upload.
 * Clearing site data/private browsing can erase it; originals and backups matter. */
(function(root){
'use strict';
const scope=location.pathname.replace(/[^/]*$/,'')+'|'+(root.REVIEW_CONFIG?.supabaseUrl||'local');
const NAME='nuclei-device-library-v1:'+scope, encoder=new TextEncoder();
let opening=null;
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
function open(){
 if(!opening)opening=new Promise((resolve,reject)=>{
  if(!root.indexedDB)return reject(Error('Browser storage is unavailable. Use a normal Chrome or Edge window.'));
  const r=indexedDB.open(NAME,1);
  r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('records',{keyPath:'id'});db.createObjectStore('assets',{keyPath:'hash'});db.createObjectStore('settings',{keyPath:'key'});};
  r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opening=null;};resolve(r.result);};
  r.onerror=()=>{opening=null;reject(r.error);};
  r.onblocked=()=>{opening=null;reject(Error('Another tab is blocking the device library. Close older tabs and retry.'));};
 });return opening;
}
function finished(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('Local save was cancelled.'));tx.onerror=()=>{};});}
async function get(store,key){const db=await open(),tx=db.transaction(store,'readonly');return req(tx.objectStore(store).get(key));}
async function all(store){const db=await open();return req(db.transaction(store,'readonly').objectStore(store).getAll());}
function explain(e){if(e?.name==='QuotaExceededError')return Error('Browser storage is full. This field was NOT saved locally. Keep your original files; remove backed-up local copies or free disk space, then retry.');return e;}
function descriptor(d){return {name:d.name,size:d.size,sourceHash:d.hash,bytes:async()=>{
 const a=await get('assets',d.hash);if(!a||a.blob.size!==d.size)throw Error('Saved local source is missing: '+d.name+'. Re-import your original files or restore a backup.');
 const b=new Uint8Array(await a.blob.arrayBuffer());if(await root.GTCore.sha256(b)!==d.hash)throw Error('Local source hash mismatch: '+d.name);return b;
}};}
function runtime(row){return {key:row.key,name:row.name,kind:row.kind,image:descriptor(row.image),annotations:row.annotations.map(descriptor),localId:row.id,localMeta:row.meta,localSaved:true,selected:!!row.selected,thumb:row.thumb||'',width:row.width,height:row.height,objectCount:row.objectCount,error:row.error||'',preflight:row.preflight,localFeedback:row.feedback||{comments:[],proposals:[],reviews:[]},localUploads:row.uploads||[],sourceBytes:row.sourceBytes,importedAt:row.importedAt};}
async function list(){return (await all('records')).sort((a,b)=>a.importedAt.localeCompare(b.importedAt)||a.name.localeCompare(b.name,undefined,{numeric:true})).map(runtime);}
async function save(record,meta){
 const sources=[record.image,...record.annotations],assets=[],files=[];
 for(const e of sources){const b=await e.bytes(),hash=await root.GTCore.sha256(b);assets.push({hash,blob:new Blob([b])});files.push({name:root.ReviewData.safePath(e.name),size:b.length,hash});}
 const signature=JSON.stringify([record.kind,record.key,files.map((f,i)=>[i===0?'image':'annotation',root.ReviewData.base(f.name),f.size,f.hash]).sort()]);
 const id=await root.GTCore.sha256(encoder.encode(signature));
 const row={id,key:record.key,name:record.name,kind:record.kind,image:files[0],annotations:files.slice(1),meta:{...meta,kind:record.kind},selected:false,thumb:record.thumb||'',width:record.width,height:record.height,objectCount:record.objectCount,error:record.error||'',feedback:{comments:[],proposals:[],reviews:[]},uploads:[],importedAt:new Date().toISOString(),sourceBytes:files.reduce((n,x)=>n+x.size,0)};
 try{const db=await open(),tx=db.transaction(['records','assets'],'readwrite'),done=finished(tx),rs=tx.objectStore('records');let existing=null;
  const q=rs.get(id);q.onsuccess=()=>{existing=q.result;if(existing)return;for(const a of assets)tx.objectStore('assets').put(a);rs.put(row);};
  await done;return {record:runtime(existing||row),duplicate:!!existing};
 }catch(e){throw explain(e);}
}
async function patch(id,changes){if(!id)return;try{const db=await open(),tx=db.transaction('records','readwrite'),done=finished(tx),s=tx.objectStore('records');let found=false;const r=s.get(id);r.onsuccess=()=>{if(r.result){found=true;s.put({...r.result,...changes,id});}};await done;if(!found)throw Error('This local record was removed in another tab. Reopen the local library.');}catch(e){throw explain(e);}}
async function patchMany(patches){const db=await open(),tx=db.transaction('records','readwrite'),done=finished(tx),s=tx.objectStore('records');for(const [id,changes]of patches){const r=s.get(id);r.onsuccess=()=>{if(r.result)s.put({...r.result,...changes,id});};}await done;}
async function remove(ids){
 const wanted=new Set(ids),db=await open(),tx=db.transaction(['records','assets'],'readwrite'),done=finished(tx),s=tx.objectStore('records'),a=tx.objectStore('assets');
 const r=s.getAll();r.onsuccess=()=>{const keep=new Set();for(const row of r.result){if(wanted.has(row.id))s.delete(row.id);else for(const f of [row.image,...row.annotations])keep.add(f.hash);}const c=a.openCursor();c.onsuccess=()=>{const v=c.result;if(!v)return;if(!keep.has(v.key))v.delete();v.continue();};};await done;
}
async function setting(key,value){if(arguments.length===1)return (await get('settings',key))?.value;const db=await open(),tx=db.transaction('settings','readwrite'),done=finished(tx);if(value===undefined)tx.objectStore('settings').delete(key);else tx.objectStore('settings').put({key,value});await done;}
async function stats(){const rows=await all('records'),used=new Map();for(const r of rows)for(const f of [r.image,...r.annotations])used.set(f.hash,f.size);let protectedStorage=false;try{protectedStorage=await navigator.storage?.persisted?.()||false;}catch{}return {count:rows.length,bytes:[...used.values()].reduce((a,b)=>a+b,0),protected:protectedStorage};}
async function protect(){try{return await navigator.storage?.persist?.()||false;}catch{return false;}}
async function backup(ids){
 const wanted=new Set(ids),rows=(await all('records')).filter(r=>wanted.has(r.id)),map=new Map(),items=[];
 if(!rows.length)throw Error('Select local fields to back up.');
 for(const r of rows)for(const f of [r.image,...r.annotations])map.set(f.hash,f);
 let total=0;for(const [hash,f]of map){const b=await descriptor(f).bytes();total+=b.length;if(total>1024**3)throw Error('Back up fewer selected fields at once (1 GiB limit).');items.push({name:'sources/'+hash,bytes:b});}
 const manifest={format:'nuclei-device-backup-v1',createdAt:new Date().toISOString(),note:'Local browser copies and saved local notes only. No account credentials. Cloud comments are not included.',records:rows};
 items.push({name:'_nuclei_local_backup.json',bytes:encoder.encode(JSON.stringify(manifest))});return root.GTCore.makeZip(items);
}
async function restoreBackup(file,progress=()=>{}){
 const entries=await root.GTCore.zipEntries(file),manifest=entries.find(e=>e.name==='_nuclei_local_backup.json');if(!manifest)throw Error('Not a local-library backup ZIP.');
 const m=JSON.parse(new TextDecoder().decode(await manifest.bytes()));if(m.format!=='nuclei-device-backup-v1'||!Array.isArray(m.records)||m.records.length>20000)throw Error('Unsupported backup format.');
 const byName=new Map(entries.map(e=>[e.name,e]));let added=0,duplicates=0;
 for(let i=0;i<m.records.length;i++){
  const r=m.records[i];if(!['fiji','bbbc038'].includes(r.kind)||!Array.isArray(r.annotations)||typeof r.key!=='string'||typeof r.name!=='string')throw Error('Invalid backup record.');
  const make=d=>({name:root.ReviewData.safePath(d.name),size:d.size,bytes:async()=>{if(!/^[a-f0-9]{64}$/.test(d.hash))throw Error('Invalid source hash in backup.');const e=byName.get('sources/'+d.hash);if(!e||e.size!==d.size)throw Error('Missing backup source: '+d.name);const b=await e.bytes();if(await root.GTCore.sha256(b)!==d.hash)throw Error('Backup hash mismatch: '+d.name);return b;}});
  const record={key:r.key,name:r.name,kind:r.kind,image:make(r.image),annotations:r.annotations.map(make)};
  try{const t=await root.ReviewData.thumbnail(record);record.thumb=t.url;record.width=t.w;record.height=t.h;}catch(e){record.error=e.message;}
  const result=await save(record,{group:r.meta?.group||'restored',title:String(r.meta?.title||'Restored backup').slice(0,120),description:String(r.meta?.description||'').slice(0,3000),kind:r.kind});
  if(result.duplicate)duplicates++;else{added++;await patch(result.record.localId,{feedback:r.feedback||{comments:[],proposals:[],reviews:[]},uploads:[],selected:false});}
  progress(i+1,m.records.length);
 }return {added,duplicates};
}
root.DeviceLibrary={open,list,save,patch,patchMany,remove,setting,stats,protect,backup,restoreBackup,runtime,version:'device-library-v1'};
})(globalThis);
