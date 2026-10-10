"""Native Chromium selection tests. Only synthetic files and stubbed cloud lists.
Never signs into production or mutates production data.
"""
from pathlib import Path
import json, threading, functools, http.server, tempfile, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'test-results/select-all'; OUT.mkdir(parents=True,exist_ok=True)
checks=[]; errors=[]; external=[]
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'site')))
threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}/'
def check(name,condition):
 assert condition,name
 checks.append({'test':name,'passed':True});print('PASS',name,flush=True)
def wait(q,js,timeout=30):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if q.evaluate(js):return
  q.wait_for_timeout(60)
 raise AssertionError('Timeout: '+js)
def idle(q):wait(q,'!!window.DeviceWorkspaceUI && !!window.Hub && !Hub.isBusy()')
try:
 with sync_playwright() as pw:
  ctx=pw.chromium.launch_persistent_context(tempfile.mkdtemp(),headless=True,args=['--no-sandbox'],viewport={'width':1440,'height':1000})
  ctx.route('**/config.js',lambda r:r.fulfill(content_type='application/javascript',body="window.REVIEW_CONFIG={supabaseUrl:'https://mock.supabase.co',publishableKey:'sb_publishable_synthetic',bucket:'nuclei-private',pollSeconds:600};"))
  def block(route):external.append(route.request.url);route.abort()
  ctx.route('https://mock.supabase.co/**',block)
  q=ctx.new_page();q.on('pageerror',lambda e:errors.append(str(e)));q.on('dialog',lambda d:d.accept());q.goto(url);idle(q)
  check('Empty Select all is explicitly labelled and disabled',q.locator('#selectVisibleFields').inner_text()=='Select all (0)' and q.locator('#selectVisibleFields').is_disabled())
  q.click('#demo');idle(q);wait(q,'Hub.getLocal().length===2')
  check('Imported originals start unselected',q.evaluate('Hub.getLocal().every(r=>!r.selected)'))
  q.click('#selectVisibleFields');wait(q,'Hub.getLocal().every(r=>r.selected)')
  check('Select all marks both source types without publishing',not external and q.locator('#selectionCount').inner_text().startswith('2 selected'))
  q.click('#clearFieldSelection');wait(q,'Hub.getLocal().every(r=>!r.selected)');check('Deselect all clears selection without removing data',q.evaluate('Hub.getLocal().length')==2)
  q.click('#importOpen');q.fill('#importTitle','41 synthetic fields - select all test')
  q.evaluate("""async()=>{const r=(await ReviewDemo.records()).find(x=>x.kind==='fiji'),image=await r.image.bytes(),roi=await r.annotations[0].bytes(),files=[];for(let i=1;i<=41;i++){let n='sample_'+String(i).padStart(2,'0');files.push({name:n+'.ome_DAPI.tif',bytes:image},{name:n+'_rois.zip',bytes:roi});}await Hub.importFiles([new File([await GTCore.makeZip(files)],'batch41.zip')]);}""")
  idle(q)
  group=q.evaluate("Hub.getLocal().find(r=>r.key==='sample_01').localMeta.group")
  q.select_option('#collectionFilter',group);q.click('#selectVisibleFields');wait(q,'Hub.getLocal().filter(r=>r.selected).length===41')
  check('All 41 filtered fields selected, including cards below the screen',q.locator('#selectVisibleFields').inner_text()=='Select all (41)' and q.evaluate("Hub.getLocal().filter(r=>r.key.startsWith('sample_')).every(r=>r.selected)"))
  check('Other collections are not unintentionally selected',q.evaluate("Hub.getLocal().filter(r=>!r.key.startsWith('sample_')).every(r=>!r.selected)"))
  q.locator('.select-field').nth(40).uncheck();check('Individual deselection updates count to 40',q.locator('#selectionCount').inner_text().startswith('40 selected'))
  q.click('#selectVisibleFields');wait(q,'Hub.getLocal().filter(r=>r.selected).length===41');q.wait_for_timeout(300);q.reload();idle(q)
  check('Selection and all local file copies survive reload',q.evaluate('Hub.getLocal().length===43 && Hub.getLocal().filter(r=>r.selected).length===41'))
  q.fill('#search','sample_0');q.click('#selectVisibleFields');wait(q,'Hub.getLocal().filter(r=>r.selected).length===9')
  check('Search narrows Select all to nine matching fields and clears hidden selections',q.locator('#selectVisibleFields').inner_text()=='Select all (9)')
  q.fill('#search','');q.click('#selectVisibleFields');q.evaluate('scrollTo(0,0)');q.screenshot(path=str(OUT/'select_all_41.png'))
  q.click('#clearFieldSelection');wait(q,'Hub.getLocal().every(r=>!r.selected)');q.select_option('#collectionFilter','')
  q.evaluate("async()=>await Hub.openField(Hub.getLocal().find(r=>r.kind==='fiji'&&r.key.startsWith('synthetic')))" )
  wait(q,'!!Hub.getCurrent()?.feedback');idle(q);q.click('[data-panel="comments"]')
  for i in range(2):
   q.fill('#commentBody','Select all test note '+str(i));q.click('#postComment');idle(q);wait(q,f'Hub.getCurrent().feedback.comments.length==={i+1}')
  check('Comment Select all advertises eligible count',q.locator('#select-comments').inner_text()=='Select all (2)')
  q.click('#select-comments');check('Both comments selected with one click',q.locator('#selected-comments').inner_text()=='2 selected')
  q.click('#clear-comments');check('Comment Deselect all leaves comments unchanged',q.locator('#selected-comments').inner_text()=='0 selected' and q.evaluate('Hub.getCurrent().feedback.comments.length')==2)
  q.click('#select-comments');q.click('#remove-comments');wait(q,"!!document.querySelector('#batchResultDialog[open]')");q.locator('#batchResultDialog').get_by_role('button',name='Close',exact=True).click();idle(q)
  check('Select all then Delete operates on both synthetic local comments',q.evaluate('Hub.getCurrent().feedback.comments.every(x=>x.removed_at)'))
  check('Deleted comments excluded from Select all and controls disabled',q.locator('#select-comments').inner_text()=='Select all (0)' and q.locator('#select-comments').is_disabled())
  q.click('#closeViewer')
  q.evaluate("""async()=>{const A='11111111-1111-4111-8111-111111111111';window.testUser={user_id:A,role:'admin',active:true,display_name:'Synthetic admin'};window.testCollections=Array.from({length:3},(_,i)=>({id:'collection-'+i,title:'Synthetic collection '+i,state:'ready',kind:'fiji',owner_id:A}));window.testFields=Array.from({length:45},(_,i)=>({id:'field-'+i,name:'Synthetic shared '+i,collection_id:'collection-'+(i%3),created_by:A,source_key:'key'+i}));window.testVersions=testFields.map(f=>({id:'version-'+f.id,field_id:f.id,state:'ready',seq:1,thumbnail_path:'synthetic.png',source_object_count:10}));window.testCalls=[];const T={nr_members:[testUser],nr_collections:testCollections,nr_fields:testFields,nr_versions:testVersions};ReviewCloud.me=async()=>testUser;ReviewCloud.hasSession=()=>true;ReviewCloud.listAll=async(t)=>structuredClone(T[t]||[]);ReviewCloud.download=async()=>new Blob();ReviewCloud.rpc=async(n,args)=>{testCalls.push([n,args]);if(n==='nr_management_version')return 'trash-feedback-v1';if(n==='nr_list_trash')return Array.from({length:3},(_,i)=>({item_type:'field',item_id:'trashed-'+i,item_name:'Synthetic Trash '+i,owner_name:'Synthetic',collection_name:'Synthetic'}));throw Error('Unexpected write attempted in selection test');};await Hub.loadShared();Hub.setScope('shared');}""")
  idle(q);q.select_option('#collectionFilter','');q.fill('#search','');q.click('#selectVisibleFields')
  check('Shared Select all marks all 45 records, not only on-screen cards',q.evaluate('Hub.getSharedSelection().size===45'))
  check('Select all itself makes no cloud mutation calls',q.evaluate('testCalls.length===0') and not external)
  q.click('#clearFieldSelection');check('Shared Deselect all clears every record',q.evaluate('Hub.getSharedSelection().size===0'))
  q.click('#manageCollections');wait(q,"document.querySelectorAll('.management-choice').length===3");q.click('#selectManagerItems')
  check('Collections Select all selects three and shows exact total',q.locator('#managerSelectionCount').inner_text()=='3 selected' and q.locator('.management-choice:checked').count()==3)
  q.click('#clearManagerItems');check('Collections Deselect all resets count and disables destructive action',q.locator('#managerSelectionCount').inner_text()=='0 selected' and q.locator('#applyManagerBatch').is_disabled())
  q.locator('.management-choice').nth(0).check();check('Manual manager selection updates total',q.locator('#managerSelectionCount').inner_text()=='1 selected')
  q.click('#managementTrashTab');wait(q,"document.querySelectorAll('.management-choice').length===3");q.click('#selectManagerItems')
  check('Trash Select all selects all three for subsequent Restore',q.locator('#managerSelectionCount').inner_text()=='3 selected' and q.locator('#applyManagerBatch').inner_text()=='Restore selected')
  check('No restore or trash operation triggered merely by selecting',q.evaluate("testCalls.every(c=>['nr_management_version','nr_list_trash'].includes(c[0]))"))
  q.locator('#managementDialog [aria-label="Close data management"]').click();q.evaluate('Hub.setBusy(true)');check('Select all and Deselect all disabled while busy',q.locator('#selectVisibleFields').is_disabled() and q.locator('#clearFieldSelection').is_disabled());q.evaluate('Hub.setBusy(false)')
  q.set_viewport_size({'width':430,'height':900});q.screenshot(path=str(OUT/'mobile.png'));check('Select all controls stay within mobile viewport',q.locator('#selectVisibleFields').bounding_box()['x']>=0)
  check('No JavaScript errors in tested selection flows',not errors)
  ctx.close()
finally:
 server.shutdown();(OUT/'report.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'runtime_errors':errors,'external_requests':external,'scope':'Native Chromium with real IndexedDB and synthetic source fixtures. Shared lists and management RPCs stubbed; no production cloud data changed.'},indent=2))
