/* Dependency-free Supabase REST client. Authorization lives in PostgreSQL RLS, not UI checks. */
(function(root){
'use strict';
const cfg=root.REVIEW_CONFIG||{},url=(cfg.supabaseUrl||'').replace(/\/$/,''),key=cfg.publishableKey||'',storeKey='nuclei-session:'+url;
let session=null,refreshing=null,authEpoch=0;
const mem=new Map(),storage={getItem(k){try{return sessionStorage.getItem(k);}catch{return mem.get(k)||null;}},setItem(k,v){try{sessionStorage.setItem(k,v);}catch{mem.set(k,v);}},removeItem(k){try{sessionStorage.removeItem(k);}catch{mem.delete(k);}}};
const configured=!!(url&&key);
if(configured){if(!/^https:\/\/[a-z0-9.-]+(?:\:[0-9]+)?$/i.test(url)&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url))throw Error('Invalid Supabase URL.');if(/^sb_secret_/.test(key))throw Error('Secret API keys must never be used in the browser.');if(key.startsWith('ey')){try{const p=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(p.role!=='anon')throw Error('Use the public anon key, not a privileged JWT.');}catch(e){throw Error('Invalid public API key: '+e.message);}}}
try{session=JSON.parse(storage.getItem(storeKey)||'null');}catch{}
function setSession(s){session=s;if(s){session.expires_at=s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600);storage.setItem(storeKey,JSON.stringify(s));}else storage.removeItem(storeKey);}
async function parseResponse(r){const t=await r.text();let b;try{b=JSON.parse(t);}catch{b=t;}if(!r.ok){const err=Error(b?.message||b?.msg||b?.error_description||b?.error||String(b)||('HTTP '+r.status));err.status=r.status;throw err;}return b;}
async function auth(path,body){if(!configured)throw Error('Cloud is not configured.');return parseResponse(await fetch(url+'/auth/v1/'+path,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body)}));}
async function token(){if(!session)throw Error('Please sign in first.');if((session.expires_at||0)>Date.now()/1000+90)return session.access_token;if(!refreshing){const generation=authEpoch;refreshing=auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token}).then(s=>{if(generation!==authEpoch)throw Error('Session ended.');setSession(s);return s.access_token;}).catch(e=>{if(generation===authEpoch)setSession(null);throw e;}).finally(()=>refreshing=null);}return refreshing;}
async function request(path,{method='GET',body,headers={},signal,raw=false}={}){const t=await token();const h={apikey:key,Authorization:'Bearer '+t,...headers};if(body!==undefined&&!(body instanceof Blob)&&!(body instanceof Uint8Array)){h['Content-Type']='application/json';body=JSON.stringify(body);}const r=await fetch(url+path,{method,headers:h,body,signal,cache:'no-store'});if(raw){if(!r.ok)await parseResponse(r);return r;}return parseResponse(r);}
async function signIn(email,password){authEpoch++;const s=await auth('token?grant_type=password',{email,password});setSession(s);return me();}
async function sendLink(email){return auth('otp?redirect_to='+encodeURIComponent(location.origin+location.pathname),{email,create_user:false});}
async function restoreRedirect(){const p=new URLSearchParams(location.hash.slice(1));if(p.has('access_token')){const s={access_token:p.get('access_token'),refresh_token:p.get('refresh_token'),expires_in:Number(p.get('expires_in')||3600)};setSession(s);history.replaceState(null,'',location.pathname+location.search);return true;}return false;}
async function me(){if(!session)return null;const user=await request('/auth/v1/user');const rows=await rest('nr_members','user_id=eq.'+encodeURIComponent(user.id)+'&select=*');if(!rows.length)throw Error('Your account is signed in, but has not been added to this review workspace. Ask its administrator.');return {...rows[0],email:user.email};}
async function signOut(){authEpoch++;try{if(session)await request('/auth/v1/logout',{method:'POST'});}finally{setSession(null);}}
async function setPassword(password){if(password.length<12)throw Error('Use at least 12 characters.');return request('/auth/v1/user',{method:'PUT',body:{password}});}
function rest(table,query='',opts={}){return request('/rest/v1/'+table+(query?'?'+query:''),opts);}
async function insert(table,row){return rest(table,'',{method:'POST',body:row,headers:{Prefer:'return=representation'}});}
function rpc(name,args){return request('/rest/v1/rpc/'+name,{method:'POST',body:args});}
function objectPath(p){return p.split('/').map(encodeURIComponent).join('/');}
async function download(path){const r=await request('/storage/v1/object/authenticated/'+cfg.bucket+'/'+objectPath(path),{raw:true});return r.blob();}
async function uploadSmall(path,blob){return request('/storage/v1/object/'+cfg.bucket+'/'+objectPath(path),{method:'POST',body:blob,headers:{'Content-Type':blob.type||'application/octet-stream','x-upsert':'false'}});}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function upload(path,blob,hash,onProgress=()=>{},signal){if(blob.size<=6*1024**2){onProgress(0,blob.size);const result=await request('/storage/v1/object/'+cfg.bucket+'/'+objectPath(path),{method:'POST',body:blob,headers:{'Content-Type':blob.type||'application/zip','x-upsert':'false'},signal});onProgress(blob.size,blob.size);return result;}
 const project=new URL(url),isHosted=project.hostname.endsWith('.supabase.co'),uploadOrigin=isHosted?project.origin.replace('.supabase.co','.storage.supabase.co'):project.origin,endpoint=uploadOrigin+'/storage/v1/upload/resumable',fingerprint=storeKey+':tus:'+path+':'+hash;
 let uploadUrl=storage.getItem(fingerprint),offset=0;
 const doFetch=async(u,opts)=>{if(!u.startsWith(uploadOrigin+'/'))throw Error('Untrusted resumable upload URL.');return fetch(u,{...opts,signal,headers:{apikey:key,Authorization:'Bearer '+await token(),'Tus-Resumable':'1.0.0',...(opts.headers||{})}});};
 if(uploadUrl){const r=await doFetch(uploadUrl,{method:'HEAD'});if(r.ok)offset=Number(r.headers.get('Upload-Offset'));else if(r.status===404||r.status===410){uploadUrl=null;storage.removeItem(fingerprint);}else await parseResponse(r);}
 if(!uploadUrl){const metadata={bucketName:cfg.bucket,objectName:path,contentType:blob.type||'application/zip',cacheControl:'0'};const b64=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s)));const r=await doFetch(endpoint,{method:'POST',headers:{'Upload-Length':String(blob.size),'Upload-Metadata':Object.entries(metadata).map(([k,v])=>k+' '+b64(v)).join(',')}});if(!r.ok)await parseResponse(r);uploadUrl=new URL(r.headers.get('Location'),endpoint).href;if(!uploadUrl.startsWith(uploadOrigin+'/'))throw Error('Unexpected upload location.');storage.setItem(fingerprint,uploadUrl);}
 if(!Number.isFinite(offset)||offset<0||offset>blob.size)throw Error('Invalid resumable upload offset.');
 while(offset<blob.size){if(signal?.aborted)throw new DOMException('Upload cancelled','AbortError');const part=blob.slice(offset,Math.min(blob.size,offset+6*1024**2));let done=false;
 for(let attempt=0;attempt<5&&!done;attempt++){try{const r=await doFetch(uploadUrl,{method:'PATCH',headers:{'Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body:part});if(!r.ok)await parseResponse(r);const next=Number(r.headers.get('Upload-Offset'));if(next!==offset+part.size)throw Error('Upload offset mismatch.');offset=next;done=true;}catch(e){if(signal?.aborted||attempt===4||[401,403,413].includes(e.status))throw e;await delay([1000,3000,5000,8000,10000][attempt]);const h=await doFetch(uploadUrl,{method:'HEAD'});if(!h.ok)await parseResponse(h);const remote=Number(h.headers.get('Upload-Offset'));if(remote>offset){offset=remote;done=true;}else if(remote!==offset)throw Error('Upload resume offset mismatch.');}}
 onProgress(offset,blob.size);
 }
 storage.removeItem(fingerprint);
}
async function listAll(table,query){const all=[];for(let offset=0;offset<100000;offset+=500){const part=await rest(table,query+(query?'&':'')+'limit=500&offset='+offset);all.push(...part);if(part.length<500)return all;}throw Error('Result exceeds review pagination limit.');}
root.ReviewCloud={configured,url,signIn,sendLink,me,signOut,restoreRedirect,setPassword,rest,insert,rpc,download,upload,uploadSmall,listAll,hasSession:()=>!!session};
})(globalThis);
