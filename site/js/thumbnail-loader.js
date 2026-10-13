/* Shared preview loading only. No image/ROI mutations, uploads, SQL, or public URLs.
 * Cache lives only in this document and is cleared at sign-out. Failed previews
 * are never mistaken for successfully cached images. */
(function(root){
'use strict';
class ReviewThumbnailLoader {
 constructor(download,{timeout=20000,concurrency=4}={}){
  this.download=download;this.timeout=timeout;this.limit=concurrency;
  this.cache=new Map();this.pending=new Map();this.errors=new Map();this.waiters=[];this.running=0;this.epoch=0;this.attempts=new WeakMap();
  const style=document.createElement('style');style.textContent='.preview-status{position:absolute;inset:30px 9px 8px;display:flex;align-items:center;justify-content:center;text-align:center;color:#d6e3db;font-size:11px;line-height:1.5;pointer-events:none;white-space:pre-line}.preview-retry[hidden],.preview-details[hidden],.preview-status[hidden]{display:none!important}.preview-retry{display:block;margin:9px 0 0;padding:5px 9px;font-size:11px}.preview-details{font-size:10px;color:#875036;margin:5px 0 0;overflow-wrap:anywhere;line-height:1.45}.thumb[data-preview-state="error"]{outline:1px solid #be9b65;outline-offset:-1px}';document.head.append(style);
 }
 async slot(epoch){if(this.running>=this.limit)await new Promise(resolve=>this.waiters.push(resolve));if(epoch!==this.epoch)throw Error('Preview session ended.');this.running++;}
 release(){this.running=Math.max(0,this.running-1);this.waiters.shift()?.();}
 clear(){this.epoch++;for(const job of this.pending.values())job.controller.abort();for(const item of this.cache.values())URL.revokeObjectURL(item.url);this.cache.clear();this.errors.clear();this.pending.clear();for(const wake of this.waiters.splice(0))wake();}
 message(error){
  if(error.name==='AbortError')return 'Preview request timed out. Retry when the connection is available.';
  const status=Number(error.status)||0;
  if(status===401)return 'Session expired or invalid (401). Sign in again, then retry.';
  if(status===403)return 'Preview access denied (403). Keep the storage bucket private; check membership/access.';
  if(status===404)return 'Preview missing or inaccessible (404). Open the image to check its separate source archive.';
  if(status===429)return 'Too many preview requests (429). Wait, then retry.';
  if(status>=500)return 'Storage service returned an error ('+status+'). Wait, then retry.';
  if(error.code==='INVALID_PREVIEW')return error.message;
  if(status)return 'Preview request failed ('+status+'). Open the image to check its source.';
  return 'Preview could not be downloaded. Check your connection, then retry.';
 }
 async prepare(blob){
  const bad=message=>Object.assign(Error(message),{code:'INVALID_PREVIEW'});
  if(!(blob instanceof Blob)||blob.size===0)throw bad('Storage returned an empty preview. This does not determine whether the source archive exists.');
  if(blob.size>8*1024*1024)throw bad('Preview response is unexpectedly large. It was not displayed as an image.');
  const bytes=new Uint8Array(await blob.slice(0,32).arrayBuffer());let mime='';
  if([137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x)){
   if(bytes.length<24)throw bad('The preview PNG header is incomplete.');
   const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),w=v.getUint32(16),h=v.getUint32(20);
   if(!w||!h||w>20000||h>20000||w*h>40000000)throw bad('Preview image dimensions are invalid.');
   mime='image/png';
  }else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
  else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')mime='image/webp';
  else throw bad('Downloaded preview is not a PNG/JPEG/WebP image. Open the image to check its separate source archive.');
  // Normalize only the response MIME type; the bytes themselves are unchanged.
  const url=URL.createObjectURL(new Blob([blob],{type:mime})),probe=new Image();
  try{
   await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(bad('The preview image could not be decoded in time.')),this.timeout);probe.onload=()=>{clearTimeout(t);resolve();};probe.onerror=()=>{clearTimeout(t);reject(bad('The downloaded preview image could not be decoded.'));};probe.src=url;});
   if(!probe.naturalWidth||!probe.naturalHeight)throw bad('The preview image has no decodable pixels.');
   return {url,bytes:blob.size,mime,width:probe.naturalWidth,height:probe.naturalHeight};
  }catch(e){URL.revokeObjectURL(url);throw e;}
 }
 fetch(path){
  if(this.cache.has(path))return Promise.resolve(this.cache.get(path));
  if(this.pending.has(path))return this.pending.get(path).promise;
  const epoch=this.epoch,controller=new AbortController(),job={controller};
  job.promise=(async()=>{let acquired=false,timer;
   try{await this.slot(epoch);acquired=true;timer=setTimeout(()=>controller.abort(),this.timeout);
    const blob=await this.download(path,{signal:controller.signal});clearTimeout(timer);
    if(epoch!==this.epoch||controller.signal.aborted)throw new DOMException('Preview request cancelled','AbortError');
    const item=await this.prepare(blob);
    if(epoch!==this.epoch){URL.revokeObjectURL(item.url);throw new DOMException('Preview session ended','AbortError');}
    this.cache.set(path,item);this.errors.delete(path);return item;
   }catch(e){if(epoch===this.epoch){const error={message:this.message(e),status:Number(e.status)||null};this.errors.set(path,error);}throw e;}
   finally{clearTimeout(timer);if(acquired)this.release();if(this.pending.get(path)===job)this.pending.delete(path);}
  })();this.pending.set(path,job);return job.promise;
 }
 ui(img,state,message=''){
  const thumb=img.closest('.thumb'),card=img.closest('.card');if(!thumb)return;
  thumb.dataset.previewState=state;img.style.visibility=state==='ready'?'visible':'hidden';
  let label=thumb.querySelector('.preview-status');if(!label){label=document.createElement('span');label.className='preview-status';label.setAttribute('role','status');thumb.append(label);}
  label.hidden=state==='ready';label.textContent=state==='loading'?'Loading preview…':state==='error'?'Preview unavailable\nClick the image to check the original.':'';
  let retry=card?.querySelector('.preview-retry'),details=card?.querySelector('.preview-details');
  if(state==='error'&&card){
   if(!retry){retry=document.createElement('button');retry.type='button';retry.className='preview-retry';retry.textContent='Retry preview';card.querySelector('.cardbody').append(retry);}
   if(!details){details=document.createElement('div');details.className='preview-details';card.querySelector('.cardbody').append(details);}
   retry.onclick=e=>{e.stopPropagation();this.load(img,{retry:true});};details.textContent=message;
  }
  if(retry)retry.hidden=state!=='error';if(details)details.hidden=state!=='error';
 }
 async load(img,{retry=false}={}){
  const path=img.dataset.path;if(!path||!img.isConnected)return;
  const epoch=this.epoch,attempt=(this.attempts.get(img)||0)+1;this.attempts.set(img,attempt);
  const current=()=>epoch===this.epoch&&img.isConnected&&img.dataset.path===path&&this.attempts.get(img)===attempt;
  if(retry)this.errors.delete(path);
  if(this.errors.has(path)){this.ui(img,'error',this.errors.get(path).message);return;}
  this.ui(img,'loading');
  try{
   const item=await this.fetch(path);if(!current())return;
   img.onload=()=>{if(current())this.ui(img,'ready');};
   img.onerror=()=>{if(!current())return;this.cache.delete(path);URL.revokeObjectURL(item.url);const message='Preview could not be displayed by this browser. Retry, or open the image to check the source.';this.errors.set(path,{message,status:null});this.ui(img,'error',message);};
   img.src=item.url;if(img.complete&&img.naturalWidth)this.ui(img,'ready');
  }catch(e){if(current())this.ui(img,'error',this.errors.get(path)?.message||this.message(e));}
 }
 retryVisible(){
  this.errors.clear();
  for(const img of document.querySelectorAll('#library img[data-path]')){const r=img.getBoundingClientRect();if(r.bottom>=-200&&r.top<=innerHeight+200)this.load(img,{retry:true});}
 }
}
root.ReviewThumbnailLoader=ReviewThumbnailLoader;
})(globalThis);
