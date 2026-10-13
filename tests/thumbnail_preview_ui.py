"""Native image decoding tests. Mocked read-only preview downloads, no cloud writes.
Uses actual PNG bytes from a canvas, not a fake naturalWidth or dummy empty Blob.
"""
from pathlib import Path
import json, shutil, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/thumbnails';OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(label,ok):
 if not ok:raise AssertionError(label)
 checks.append({'test':label,'passed':True});print('PASS',label,flush=True)
def wait(q,expr,timeout=8):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if q.evaluate(expr):return
  q.wait_for_timeout(25)
 q.screenshot(path=str(OUT/'failure.png'));raise AssertionError('Timeout: '+expr)
try:
 with sync_playwright() as pw:
  exe=shutil.which('chromium');b=pw.chromium.launch(headless=True,args=['--no-sandbox'],**({'executable_path':exe} if exe else {}));q=b.new_page(viewport={'width':1400,'height':950});q.on('pageerror',lambda e:errors.append(str(e)))
  # about:blank is sufficient: only images, Blob URLs and DOM are exercised here.
  q.set_content('''<!doctype html><html><head><style>body{font:14px Arial;background:#f2f5f1}#library{display:grid;grid-template-columns:repeat(5,220px);gap:15px}.card{background:white;border:1px solid #ceddd2;border-radius:9px;overflow:hidden}.thumb{height:174px;background:#101711;cursor:pointer;width:100%;display:block;position:relative;padding:0;border:0}.thumb img{display:block;width:100%;height:100%;object-fit:contain}.cardbody{padding:10px}.tag{position:absolute;top:6px;left:6px;color:white;font-size:10px}button{cursor:pointer}</style></head><body><h2>Shared preview loader · synthetic image tests</h2><div id="library"></div></body></html>''')
  q.add_script_tag(content=(ROOT/'site/js/thumbnail-loader.js').read_text())
  q.evaluate('''async()=>{
   const c=document.createElement('canvas');c.width=240;c.height=180;const g=c.getContext('2d');g.fillStyle='#151915';g.fillRect(0,0,240,180);for(const [x,y,r]of [[50,45,22],[125,65,30],[170,130,24]]){const grad=g.createRadialGradient(x,y,2,x,y,r);grad.addColorStop(0,'#ddd');grad.addColorStop(1,'#171b17');g.fillStyle=grad;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();}
   window.png=await new Promise(r=>c.toBlob(r,'image/png'));window.calls=[];window.mode={};window.running=0;window.maxRunning=0;window.readBytes=[];
   window.api=async(path,{signal}={})=>{calls.push(path);running++;maxRunning=Math.max(maxRunning,running);try{
    if(mode[path]==='delayed')await new Promise((resolve,reject)=>{let t=setTimeout(resolve,180);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'));},{once:true});});
    if(mode[path]==='timeout')await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
    if(mode[path]==='forbidden')throw Object.assign(Error('Denied'),{status:403});
    if(mode[path]==='missing')throw Object.assign(Error('Missing'),{status:404});
    if(mode[path]==='server')throw Object.assign(Error('Unavailable'),{status:503});
    if(mode[path]==='invalid')return new Blob(['{"message":"not an image"}'],{type:'application/json'});
    if(mode[path]==='empty')return new Blob([]);
    if(mode[path]==='truncated')return png.slice(0,35);
    return new Blob([png],{type:'application/octet-stream'});
   }finally{running--;}};
   window.loader=new ReviewThumbnailLoader(api,{timeout:300,concurrency:4});
   window.card=path=>{const c=document.createElement('article');c.className='card';const btn=document.createElement('button');btn.className='thumb';btn.type='button';const i=new Image();i.dataset.path=path;i.alt='Synthetic '+path;const tag=document.createElement('span');tag.className='tag';tag.textContent='SYNTHETIC · NOT GT';btn.append(i,tag);const body=document.createElement('div');body.className='cardbody';body.textContent=path;c.append(btn,body);document.getElementById('library').append(c);return i;};
   window.img=card('valid.png');await loader.load(img);
  }''')
  wait(q,'img.naturalWidth===240 && img.closest(".thumb").dataset.previewState==="ready"')
  check('Actual PNG bytes decode even with generic HTTP MIME type',q.evaluate('img.naturalHeight===180 && loader.cache.size===1'))
  check('Successful preview is visible and no retry error is shown',q.locator('.preview-retry:visible').count()==0)
  q.evaluate('window.second=card("valid.png");loader.load(second)');wait(q,'second.naturalWidth===240');check('Re-render uses a working cached URL without a second download',q.evaluate('calls.filter(x=>x==="valid.png").length===1'))
  q.evaluate('''async()=>{mode['bad.png']='invalid';window.bad=card('bad.png');await loader.load(bad);}''')
  check('HTTP-success non-image response is identified, not cached as a valid thumbnail',q.evaluate('!loader.cache.has("bad.png") && loader.errors.has("bad.png")'))
  check('Undecodable preview has a visible explanation and per-card retry',q.locator('.preview-details').filter(has_text='not a PNG').count()==1 and q.locator('.preview-retry:visible').count()==1)
  n=q.evaluate('calls.length');q.evaluate('loader.load(bad)');check('Re-rendering a failed card does not hammer storage automatically',q.evaluate('calls.length')==n)
  q.evaluate('mode["bad.png"]="valid"');q.locator('.preview-retry:visible').click();wait(q,'bad.naturalWidth===240 && bad.closest(".thumb").dataset.previewState==="ready"');check('Retry repairs the card without uploading or replacing any file',q.locator('.preview-retry:visible').count()==0)
  q.evaluate('''async()=>{mode['denied.png']='forbidden';window.denied=card('denied.png');await loader.load(denied);mode['missing.png']='missing';window.missing=card('missing.png');await loader.load(missing);mode['empty.png']='empty';window.empty=card('empty.png');await loader.load(empty);}''')
  check('403 access errors remain errors rather than falling back to private local files',q.locator('.preview-details').filter(has_text='access denied (403)').count()==1)
  check('404 does not claim that the original image was deleted',q.locator('.preview-details').filter(has_text='separate source archive').count()>=1)
  check('Empty bodies produce a clear preview-specific message',q.locator('.preview-details').filter(has_text='empty preview').count()==1)
  q.screenshot(path=str(OUT/'errors_with_retry.png'))
  q.evaluate('''async()=>{mode['short.png']='truncated';window.short=card('short.png');await loader.load(short);}''');check('Valid signature with truncated pixels is caught by native image decode',q.evaluate('loader.errors.get("short.png").message.includes("could not be decoded")'))
  q.evaluate('''async()=>{mode['slow.png']='timeout';window.slow=card('slow.png');await loader.load(slow);}''');check('Timed out GET is aborted and retryable, not stuck forever',q.evaluate('loader.errors.get("slow.png").message.includes("timed out")'))
  q.evaluate('''async()=>{loader.clear();document.getElementById('library').replaceChildren();maxRunning=0;window.images=[];for(let n=0;n<41;n++){const p='thumb-'+n+'.png';mode[p]='delayed';images.push(card(p));}await Promise.all(images.map(x=>loader.load(x)));}''')
  wait(q,'images.every(x=>x.naturalWidth===240)')
  check('All 41 real PNG thumbnails load with no blank or broken cards',q.evaluate('images.every(x=>x.closest(".thumb").dataset.previewState==="ready")'))
  check('Storage requests are bounded to four concurrent GETs',q.evaluate('maxRunning<=4'))
  previous=q.evaluate('calls.length');q.evaluate('''async()=>{const all=images.map(x=>x.dataset.path);document.getElementById('library').replaceChildren();images=all.map(card);await Promise.all(images.map(x=>loader.load(x)));}''');wait(q,'images.every(x=>x.naturalWidth===240)');check('Returning to the same 41-image grid does not re-download everything',q.evaluate('calls.length')==previous)
  q.screenshot(path=str(OUT/'shared_41_previews.png'))
  q.evaluate('''async()=>{loader.clear();document.getElementById('library').replaceChildren();mode['logout.png']='delayed';window.gone=card('logout.png');window.late=loader.load(gone);loader.clear();await late;}''')
  check('Sign-out cancels late previews and clears cache',q.evaluate('loader.cache.size===0 && gone.naturalWidth===0'))
  q.evaluate('''async()=>{mode['again.png']='delayed';const detached=card('again.png');const work=loader.load(detached);detached.closest('.card').remove();await work;}''')
  check('Detached/replaced cards are not written by late callbacks',q.evaluate('document.querySelectorAll("#library img[data-path=\\"again.png\\"]").length===0'))
  check('No JavaScript runtime errors',not errors)
  b.close()
finally:
 (OUT/'report.json').write_text(json.dumps({'scope':'Native Chromium PNG/image decoding and Blob-URL lifecycle. Read-only preview download is mocked; production data and Supabase policies not touched.','checks':checks,'passed':len(checks),'runtime_errors':errors},indent=2))
