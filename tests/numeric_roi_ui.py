"""Real Chromium / IndexedDB with synthetic TIFF and ROI ZIPs only.
No production Supabase connection, uploads, annotation changes or user files.
"""
from pathlib import Path
import base64,functools,http.server,json,threading,time,hashlib
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/numeric-rois';OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];external=[]
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'site')))
threading.Thread(target=server.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{server.server_port}/'
def check(label,value):
 assert value,label
 checks.append({'test':label,'passed':True});print('PASS',label,flush=True)
def wait(q,expr,timeout=25):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  if q.evaluate(expr):return
  q.wait_for_timeout(40)
 q.screenshot(path=str(OUT/'failure.png'));raise AssertionError('Timeout: '+expr+'; '+q.locator('#toast').inner_text())
def idle(q):wait(q,'!!window.NumericRois && !!window.Hub && !Hub.isBusy()')
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1400,'height':1000})
  ctx.route('**/config.js',lambda r:r.fulfill(content_type='application/javascript',body="window.REVIEW_CONFIG={supabaseUrl:'',publishableKey:'',bucket:'nuclei-private',pollSeconds:600};"))
  def forbidden(route):external.append(route.request.url);route.abort()
  ctx.route('https://**',forbidden)
  q=ctx.new_page();q.on('pageerror',lambda e:errors.append(str(e)));decision={'accept':True};q.on('dialog',lambda d:d.accept() if decision['accept'] else d.dismiss())
  q.goto(URL);idle(q)
  inputs=q.evaluate('''async()=>{const original=(await ReviewDemo.records()).find(r=>r.kind==='fiji'),tiff=await original.image.bytes(),parts=await GTCore.zipEntries(new Blob([await original.annotations[0].bytes()]));const result=[];for(const [number,count]of [[2,3],[4,5]]){const archive=await GTCore.makeZip(await Promise.all(parts.slice(0,count).map(async(e,i)=>({name:String(i+1)+'.roi',bytes:await e.bytes()}))));for(const [name,bytes]of [[`H2170_72h_Nera_${number}.ome_DAPI.tif`,tiff],[`ROIs/${number}.zip`,new Uint8Array(await archive.arrayBuffer())]]){let text='';for(const b of bytes)text+=String.fromCharCode(b);result.push({name,base64:btoa(text)});}}return result;}''')
  def load_inputs():q.evaluate('''items=>{window.testInputs=items.map(x=>{const b=Uint8Array.from(atob(x.base64),c=>c.charCodeAt(0)),f=new File([b],x.name.split('/').pop());Object.defineProperty(f,'webkitRelativePath',{value:'NumericExamples/'+x.name});return f;});}''',inputs)
  def start():
   if not q.locator('#importDialog').is_visible():q.click('#importOpen')
   q.fill('#importTitle','Numeric ROI examples');q.select_option('#importKind','fiji')
   q.evaluate('()=>{window.pendingImport=Hub.importFiles(window.testInputs,true);}');q.wait_for_selector('#roiPairingDialog[open]')
  load_inputs();start()
  check('Folder import recognizes numbered outer ZIPs and opens pairing table',q.locator('.roi-pairing-select').count()==2)
  check('Nothing is saved or uploaded before pairing confirmation',q.evaluate('Hub.getLocal().length')==0 and not external)
  choices=q.locator('.roi-pairing-select');labels=[choices.nth(i).evaluate('(e)=>e.selectedOptions[0].textContent') for i in range(2)]
  check('Image 2 maps to 2.zip and image 4 maps to 4.zip, independent of file ordering','ROIs/2.zip' in labels[0] and 'ROIs/4.zip' in labels[1])
  check('ZIP containing 1.roi, 2.roi etc reports individual region count','(3 ROIs)' in labels[0] and '(5 ROIs)' in labels[1])
  check('Confirmation is mandatory for numeric associations',q.locator('#confirmRoiPairing').is_disabled())
  choices.nth(0).select_option(choices.nth(1).input_value());q.check('#roiPairingConfirmed')
  check('One ZIP cannot be selected for two images',q.locator('#confirmRoiPairing').is_disabled())
  q.click('#cancelRoiPairing');idle(q);check('Cancel preserves empty library and makes no writes',q.evaluate('Hub.getLocal().length')==0)
  start();q.check('#roiPairingConfirmed');q.screenshot(path=str(OUT/'numeric_pairing.png'));q.click('#confirmRoiPairing');idle(q)
  check('Confirmed parent folder import creates two annotated local fields',q.evaluate('Hub.getLocal().length===2 && Hub.getLocal().every(r=>r.annotations.length===1)'))
  saved=q.evaluate('''async()=>{const out=[];for(const r of Hub.getLocal()){const d=await ReviewData.load(r);out.push({name:r.name,zip:r.annotations[0].name,sha:await GTCore.sha256(await r.annotations[0].bytes()),count:d.objects.length,entries:d.objects.map(o=>o.entry)});}return out;}''')
  expected={x['name'].split('/')[-1]:hashlib.sha256(base64.b64decode(x['base64'])).hexdigest() for x in inputs if x['name'].endswith('.zip')}
  check('Imported numbered archives retain byte-identical SHA-256 and original names',all(r['sha']==expected[r['zip'].split('/')[-1]] for r in saved))
  check('Region filenames are read from inside each ZIP, not used as image numbers',[r['count'] for r in saved]==[3,5] and all(r['entries'][0]=='1.roi' for r in saved))
  q.evaluate('Hub.openField(Hub.getLocal()[0])');wait(q,'!!Hub.getCurrent()?.data')
  check('Viewer renders the numbered ROI archive as source contours',q.locator('#sourceSvg path').count()==3)
  q.click('#viewSplit');check('Side-by-side comparison remains available',q.locator('#compareOriginalPane').is_visible());q.screenshot(path=str(OUT/'numbered_roi_viewer.png'));q.click('#closeViewer')
  packaged=q.evaluate('''async()=>{const r=Hub.getLocal()[0],d=await ReviewData.load(r),p=await ReviewData.packageField(r,d),out=await ReviewData.readPackage(p.blob,p.sha);return {count:out.d.objects.length,name:out.r.annotations[0].name,hash:await GTCore.sha256(await out.r.annotations[0].bytes()),same:out.r.key===r.key};}''')
  check('Shared-format source archive round trip keeps numeric ZIP name, bytes and image association',packaged['count']==3 and packaged['hash']==expected['2.zip'] and packaged['same'])
  q.reload();idle(q);check('Numeric annotation association survives browser refresh',q.evaluate('Hub.getLocal().length===2 && Hub.getLocal().every(r=>r.annotations.length===1)'))
  load_inputs();start();q.check('#roiPairingConfirmed');q.click('#confirmRoiPairing');idle(q)
  check('Reimporting the same numeric sources does not duplicate local records',q.evaluate('Hub.getLocal().length')==2)
  revision=q.evaluate('''async()=>{const r=Hub.getLocal()[0];return NumericRois.revision(new File([await r.annotations[0].bytes()],'1.zip'),r.key,r.name);}''')
  check('A numeric revision name is accepted only after an explicit target-image confirmation',revision is True)
  decision['accept']=False
  revision=q.evaluate('''async()=>{const r=Hub.getLocal()[0];return NumericRois.revision(new File([await r.annotations[0].bytes()],'1.zip'),r.key,r.name);}''')
  check('Cancelling numeric revision target confirmation leaves data unchanged',revision is False and q.evaluate('Hub.getLocal().length')==2);decision['accept']=True
  direct=q.evaluate('''async()=>{const r=Hub.getLocal()[0],f=new File([await r.annotations[0].bytes()],'2.zip');const es=await NumericRois.entries([f],false);return {n:es.length,name:es[0].name,count:es[0].roiCount,hash:await GTCore.sha256(await es[0].bytes())};}''')
  check('Direct file selection preserves numbered ZIP instead of expanding it away',direct=={'n':1,'name':'2.zip','count':3,'hash':expected['2.zip']})
  legacy=q.evaluate('''async()=>{const r=Hub.getLocal()[0],f=new File([await r.annotations[0].bytes()],r.key+'_rois.zip'),i=new File([await r.image.bytes()],r.key+'.tif');const es=await NumericRois.entries([i,f]);const p=NumericRois.plan(es);return {review:p.review,archive:p.rows[0].archive};}''')
  check('Existing canonical _rois.zip names keep the old direct import behavior',legacy=={'review':False,'archive':0})
  nested=q.evaluate('''async()=>{const r=Hub.getLocal()[0],z=await GTCore.makeZip([{name:r.name+'.tif',bytes:await r.image.bytes()},{name:'ROIs/2.zip',bytes:await r.annotations[0].bytes()}]);const es=await NumericRois.entries([new File([z],'dataset.zip')]);const p=NumericRois.plan(es);return {images:p.rows.length,zips:p.archives.length,count:p.archives[0].roiCount,name:p.archives[0].name};}''')
  check('A dataset ZIP may contain a numbered ROI ZIP without losing it',nested['images']==1 and nested['zips']==1 and nested['count']==3 and nested['name'].endswith('/ROIs/2.zip'))
  q.evaluate('''async()=>{const es=await NumericRois.entries(window.testInputs,true);es.find(x=>x.name.endsWith('/2.zip')).name='1.zip';window.manualPlan=NumericRois.pair(es);}''')
  q.wait_for_selector('#roiPairingDialog[open]');first=q.locator('.roi-pairing-select').nth(0);check('Unmatched ordinal filename is left unassigned',first.input_value()=='-1')
  idx=first.evaluate("e=>[...e.options].find(o=>o.text.startsWith('1.zip ')).value");first.select_option(idx);q.check('#roiPairingConfirmed');q.click('#confirmRoiPairing');wait(q,'!document.getElementById("roiPairingDialog").open')
  manual=q.evaluate('async()=>(await window.manualPlan).records[0].annotations[0].name');check('User-confirmed manual mapping supports numbering by save order',manual=='1.zip')
  check('No production network requests and no JavaScript errors',not external and not errors);browser.close()
finally:
 server.shutdown();(OUT/'report.json').write_text(json.dumps({'scope':'Real Chromium and native IndexedDB; synthetic TIFF/ROI files; source archive round trip only, no production Supabase calls','checks':checks,'passed':len(checks),'runtime_errors':errors,'external_requests':external},indent=2))
