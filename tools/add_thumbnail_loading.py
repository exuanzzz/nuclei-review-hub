"""Replace silent thumbnail failures with validated, bounded, retryable previews.
Run after the existing feature builders. Never touches SQL, Auth settings or files.
"""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def once(s,a,b):
 if s.count(a)!=1:raise RuntimeError('Unexpected thumbnail source: '+a[:100])
 return s.replace(a,b)
p=ROOT/'site/js/app.js';s=p.read_text()
if '// thumbnail-loading-v1' not in s:
 old="async function loadCloudThumb(img){const path=img.dataset.path;if(!path)return;if(thumbURLs.has(path)){img.src=thumbURLs.get(path);return;}try{const blob=await B.download(path),u=URL.createObjectURL(blob);thumbURLs.set(path,u);img.src=u;}catch{img.alt='Preview not yet available';}}"
 s=once(s,old,"// thumbnail-loading-v1\nconst previewLoader=new ReviewThumbnailLoader((path,options)=>B.download(path,options));\nasync function loadCloudThumb(img){return previewLoader.load(img);}")
 s=once(s,"img.dataset.path=r.version.thumbnail_path;observer.observe(img);","img.dataset.path=r.version.thumbnail_path;img.style.visibility='hidden';observer.observe(img);")
 s=once(s,"for(const u of thumbURLs.values())URL.revokeObjectURL(u);thumbURLs.clear();","previewLoader.clear();for(const u of thumbURLs.values())URL.revokeObjectURL(u);thumbURLs.clear();")
 # Clear stale downloaded error status when the user explicitly refreshes the library.
 pos="$('refresh').onclick="
 if s.count(pos)!=1:raise RuntimeError('Missing explicit gallery refresh control.')
 s=s.replace(pos,"$('refresh').addEventListener('click',()=>previewLoader.errors.clear());\n"+pos)
 # Public diagnostics contain only preview paths/statuses, never auth headers/tokens.
 s += "\nwindow.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('button');b.type='button';b.id='retryCloudPreviews';b.textContent='Retry previews';document.getElementById('refresh').after(b);b.onclick=()=>window.SharedPreviewController.retryVisible();const update=()=>{b.hidden=window.Hub.getScope()!=='shared'||!window.Hub.getUser();b.disabled=window.Hub.isBusy();};window.addEventListener('nr:state',update);update();});\n"
 # Export loader only for retry action; creation still occurs in the private app closure.
 s=s.replace('const previewLoader=new ReviewThumbnailLoader((path,options)=>B.download(path,options));','const previewLoader=new ReviewThumbnailLoader((path,options)=>B.download(path,options));root.SharedPreviewController=previewLoader;')
 p.write_text(s)
p=ROOT/'site/js/cloud.js';s=p.read_text()
s=once(s,"async function download(path){const r=await request('/storage/v1/object/authenticated/'+cfg.bucket+'/'+objectPath(path),{raw:true});return r.blob();}","async function download(path,{signal}={}){const r=await request('/storage/v1/object/authenticated/'+cfg.bucket+'/'+objectPath(path),{raw:true,signal});return r.blob();}") if 'async function download(path,{signal}={})' not in s else s
p.write_text(s)
p=ROOT/'site/index.html';s=p.read_text()
if 'js/thumbnail-loader.js' not in s:
 # The existing workspace builder adds a version query to app.js.
 import re
 s,n=re.subn(r'(<script src="js/app\.js(?:\?[^"]*)?"></script>)','<script src="js/thumbnail-loader.js"></script>\\1',s)
 if n!=1:raise RuntimeError('Expected exactly one app.js script.')
 p.write_text(s)
print('Shared preview validation/retry installed. No database, source or access changes.')
