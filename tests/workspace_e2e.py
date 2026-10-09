"""Real Chromium/IndexedDB; mock cloud only. Never uses a production credential.
All source images are the repository's clearly marked synthetic fixtures.
"""
from pathlib import Path
import base64, copy, datetime, functools, hashlib, http.server, io, json, re, tempfile, threading, uuid, zipfile, time
from urllib.parse import urlparse, parse_qs, unquote
from playwright.sync_api import sync_playwright, Page, TimeoutError as BrowserTimeout
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/workspace';OUT.mkdir(parents=True,exist_ok=True)
def wait_predicate(self, expression, *, arg=None, timeout=None, polling=None):
 deadline=time.monotonic()+(60000 if timeout is None else timeout)/1000
 while True:
  if self.evaluate(expression,arg):return None
  if timeout!=0 and time.monotonic()>=deadline:
   self.screenshot(path=str(OUT/'failure.png'));(OUT/'failure_dom.html').write_text(self.content())
   raise BrowserTimeout('Predicate timed out: '+expression)
  self.wait_for_timeout(50)
Page.wait_for_function=wait_predicate
A='11111111-1111-4111-8111-111111111111';B='22222222-2222-4222-8222-222222222222'
tables={t:[] for t in ['nr_collections','nr_fields','nr_versions','nr_comments','nr_proposals','nr_reviews']}
tables['nr_members']=[dict(user_id=A,display_name='Synthetic tester A',role='admin',active=True),dict(user_id=B,display_name='Synthetic tester B',role='reviewer',active=True)]
objects={};calls=[];checks=[];errors=[];fault={'upload':False,'delete':None}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def answer(route,x=None,status=200,raw=None):
 route.fulfill(status=status,body=raw if raw is not None else json.dumps(x),content_type='application/octet-stream' if raw is not None else 'application/json',headers={'Access-Control-Allow-Origin':'*'})
def backend(route):
 request=route.request;u=urlparse(request.url);path=unquote(u.path);params=parse_qs(u.query);method=request.method;uid=request.headers.get('authorization','').removeprefix('Bearer ');raw=request.post_data_buffer or b''
 try:body=json.loads(raw) if raw else {}
 except Exception:body={}
 calls.append((method,path))
 if method=='OPTIONS':return route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'*'})
 if path=='/auth/v1/token':
  who=A if body.get('email')=='a@test.invalid' else B
  return answer(route,dict(access_token=who,refresh_token=who,expires_in=3600))
 if uid not in [A,B]:return answer(route,{'message':'Mock: login required'},403)
 if path=='/auth/v1/user':return answer(route,dict(id=uid,email='synthetic@test.invalid'))
 if path=='/auth/v1/logout':return answer(route,{})
 def collection(cid):return next(c for c in tables['nr_collections'] if c['id']==cid)
 def field(fid):return next(f for f in tables['nr_fields'] if f['id']==fid)
 def available(f):return not f.get('trashed_at') and not collection(f['collection_id']).get('trashed_at')
 if path.startswith('/storage/v1/object/'):
  key=path.split('/nuclei-private/')[1]
  if method=='GET':return answer(route,raw=objects[key]) if key in objects else answer(route,{'message':'Missing'},404)
  if method=='POST':
   if fault['upload']:fault['upload']=False;return answer(route,{'message':'Injected temporary upload failure'},403)
   if key in objects:return answer(route,{'message':'No overwrites'},409)
   objects[key]=raw;return answer(route,{'Key':key})
 if path.startswith('/rest/v1/rpc/'):
  action=path.split('/')[-1]
  if action=='nr_management_version':return answer(route,'trash-feedback-v1')
  if action=='nr_trash_item':
   table='nr_fields' if body['p_type']=='field' else 'nr_collections';row=next(r for r in tables[table] if r['id']==body['p_id']);owner=row.get('created_by',row.get('owner_id'))
   if uid!=A and uid!=owner:return answer(route,{'message':'Mock: owner required'},403)
   if fault['delete']==row['id']:fault['delete']=None;return answer(route,{'message':'Injected one-item failure'},503)
   row['trashed_at']=None if body['p_restore'] else now();return answer(route,{'changed':True})
  if action=='nr_list_trash':
   result=[]
   for c in tables['nr_collections']:
    if c.get('trashed_at') and (uid==A or c['owner_id']==uid):result.append(dict(item_type='collection',item_id=c['id'],item_name=c['title'],collection_name=c['title'],owner_name='Synthetic',removed_at=c['trashed_at']))
   for f in tables['nr_fields']:
    c=collection(f['collection_id'])
    if f.get('trashed_at') and not c.get('trashed_at') and (uid==A or f['created_by']==uid):result.append(dict(item_type='field',item_id=f['id'],item_name=f['name'],collection_name=c['title'],owner_name='Synthetic',removed_at=f['trashed_at']))
   return answer(route,result)
  if action=='nr_create_version':
   ident=str(uuid.uuid4());fid=body['p_field'];v=dict(id=ident,field_id=fid,parent_id=body['p_parent'],seq=1+len([x for x in tables['nr_versions'] if x['field_id']==fid]),author_id=uid,summary=body['p_summary'],manifest=body['p_manifest'],object_path=ident+'/source.zip',thumbnail_path=ident+'/thumb.png',archive_sha256=body['p_hash'],archive_bytes=body['p_bytes'],source_object_count=body['p_manifest']['sourceObjectCount'],state='draft',created_at=now());tables['nr_versions'].append(v);return answer(route,[v])
  if action=='nr_publish_version':
   v=next(v for v in tables['nr_versions'] if v['id']==body['p_id']);assert v['object_path'] in objects;assert hashlib.sha256(objects[v['object_path']]).hexdigest()==v['archive_sha256'];v['state']='ready';return answer(route,None)
  if action=='nr_publish_collection':collection(body['p_id'])['state']='ready';return answer(route,None)
  if action=='nr_remove_feedback':
   table={'comment':'nr_comments','proposal':'nr_proposals','review':'nr_reviews'}[body['p_type']];row=next(r for r in tables[table] if r['id']==body['p_id'])
   if uid!=A and row['author_id']!=uid:return answer(route,{'message':'Mock: author required'},403)
   row['removed_at']=now();row['removed_by']=uid
   if body['p_type']=='comment':row.update(body='[Deleted comment]',roi_ref='',anchor=None)
   elif body['p_type']=='proposal':row.update(label='[Withdrawn proposal]',note='',geometry={'type':'polygon','points':[]})
   else:row.update(body='[Withdrawn decision]',verdict='discussion')
   return answer(route,{'changed':True})
  return answer(route,{'message':'Unknown mock RPC '+action},400)
 if path.startswith('/rest/v1/'):
  table=path.split('/')[-1]
  if method=='GET':
   result=[copy.deepcopy(r) for r in tables[table] if not r.get('trashed_at')]
   if table=='nr_fields':result=[r for r in result if available(r)]
   if table=='nr_versions':result=[r for r in result if available(field(r['field_id']))]
   for k,vs in params.items():
    if k in ['select','order','limit','offset']:continue
    if vs[0].startswith('eq.'):result=[r for r in result if str(r.get(k))==vs[0][3:]]
   if 'order' in params:
    key,*dr=params['order'][0].split('.');result.sort(key=lambda r:r.get(key,''),reverse='desc' in dr)
   offset=int(params.get('offset',['0'])[0]);limit=int(params.get('limit',['500'])[0]);return answer(route,result[offset:offset+limit])
  if method=='POST':
   row={**body,'created_at':now()}
   if table=='nr_collections':row.update(owner_id=uid,state='draft')
   elif table=='nr_fields':row.update(created_by=uid)
   else:row.update(author_id=uid)
   if any(r['id']==row['id'] for r in tables[table]):return answer(route,{'message':'Duplicate ID'},409)
   tables[table].append(row);return answer(route,[row])
 return answer(route,{'message':'Unknown mock request'},404)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'site')));threading.Thread(target=server.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{server.server_port}/'
def check(name,ok):
 assert ok,name
 checks.append({'test':name,'passed':True});print('PASS',name,flush=True)
def idle(q):
 # Local recovery completes before independent cloud membership/loading.
 # Do not assert an empty cloud immediately while authentication is still restoring.
 q.wait_for_function('window.Hub && window.DeviceWorkspaceUI && !Hub.isBusy() && (!ReviewCloud.hasSession() || !!Hub.getUser())',timeout=60000)
def config(route):route.fulfill(content_type='application/javascript',body="window.REVIEW_CONFIG={supabaseUrl:'https://mock.supabase.co',publishableKey:'sb_publishable_synthetic',bucket:'nuclei-private',pollSeconds:600};")
def setup(ctx):
 ctx.route('**/config.js',config);ctx.route('https://mock.supabase.co/**',backend)
 ctx.on('request',lambda req: check_request(req))
def check_request(req):
 host=urlparse(req.url).hostname
 if host and host not in ['127.0.0.1','mock.supabase.co']:raise AssertionError('Unexpected external request: '+host)
def page(ctx):
 q=ctx.new_page();q.on('pageerror',lambda e:errors.append(str(e)));q.on('dialog',lambda d:d.accept());q.goto(URL);idle(q);return q
def login(q,email):
 q.click('#loginOpen');q.fill('#email',email);q.fill('#password','SYNTHETIC-test-only-password');q.click('#loginForm button');q.wait_for_function('!!Hub.getUser()');idle(q)
def open_local(q,kind='fiji'):
 q.evaluate('(kind)=>Hub.openField(Hub.getLocal().find(r=>r.kind===kind))',kind);q.wait_for_function('!!Hub.getCurrent()?.feedback');idle(q)
def hashes(q):
 return q.evaluate("async()=>{const out={};for(const r of Hub.getLocal()){out[r.localId]=await Promise.all([r.image,...r.annotations].map(async e=>[e.name,await GTCore.sha256(await e.bytes())]));}return out;}")
def publish(q,needle):
 q.click('[data-scope="local"]');q.fill('#search',needle);q.click('#selectVisibleFields');q.click('#publish');q.wait_for_selector('#uploadCheckDialog[open]');
 if q.locator('#uploadAcknowledgeLabel').is_visible():q.check('#uploadAcknowledge')
 q.click('#confirmUploadCheck');idle(q)
def close_result(q):
 if q.locator('#batchResultDialog[open]').count():q.locator('#batchResultDialog').get_by_role('button',name='Close',exact=True).click()
try:
 with sync_playwright() as playwright:
  profile=tempfile.mkdtemp(prefix='workspace-profile-')
  ctx=playwright.chromium.launch_persistent_context(profile,headless=True,args=['--no-sandbox'],viewport={'width':1500,'height':1100});setup(ctx);q=page(ctx)
  check('Fresh normal browser starts with zero local records',q.evaluate('Hub.getLocal().length')==0)
  q.click('#demo');idle(q);q.wait_for_function('Hub.getLocal().length===2');check('Two synthetic data types saved without cloud writes',len(tables['nr_collections'])==0 and len(objects)==0)
  check('New imports start unselected',q.evaluate('Hub.getLocal().every(r=>!r.selected)'))
  q.locator('.select-field').first.check();check('Individual image checkboxes are usable after import',q.evaluate('Hub.getLocal().filter(r=>r.selected).length')==1);q.locator('.select-field').first.uncheck()
  originals=hashes(q)
  open_local(q);q.click('[data-panel="comments"]');q.fill('#commentBody','Persistent local note A');q.click('#postComment');q.wait_for_function('Hub.getCurrent().feedback.comments.length===1');q.fill('#commentBody','Persistent local note B');q.click('#postComment');q.wait_for_function('Hub.getCurrent().feedback.comments.length===2');idle(q)
  geometry=q.evaluate('Hub.getCurrent().data.objects.map(o=>o.points)');q.click('#viewSplit');q.wait_for_timeout(150);check('Side-by-side view still works',q.locator('#compareOriginalPane').is_visible());q.screenshot(path=str(OUT/'comparison.png'));q.click('#closeViewer');q.fill('#search','SYNTHETIC_demo');q.click('#selectVisibleFields');q.wait_for_timeout(300)
  q.reload();idle(q);check('Native page reload restores source files and selection',q.evaluate('Hub.getLocal().length===2 && Hub.getLocal().filter(r=>r.selected).length===1'));check('All restored source byte hashes are unchanged',hashes(q)==originals)
  open_local(q);check('Saved local notes survive refresh',q.evaluate('Hub.getCurrent().feedback.comments.map(r=>r.body)')==['Persistent local note A','Persistent local note B']);check('ROI vertices unchanged after persistent restore',q.evaluate('Hub.getCurrent().data.objects.map(o=>o.points)')==geometry);q.click('#closeViewer');ctx.close()
  ctx=playwright.chromium.launch_persistent_context(profile,headless=True,args=['--no-sandbox'],viewport={'width':1500,'height':1100});setup(ctx);q=page(ctx)
  check('Full browser-process close/reopen keeps the native IndexedDB library',q.evaluate('Hub.getLocal().length')==2 and hashes(q)==originals)
  q.click('#demo');idle(q);check('Reimporting identical source bytes does not duplicate records',q.evaluate('Hub.getLocal().length')==2)
  open_local(q);q.click('[data-panel="comments"]');q.click('#select-comments');q.click('#remove-comments');q.wait_for_selector('#batchResultDialog[open]');close_result(q);check('Local comments support multi-select removal',q.evaluate('Hub.getCurrent().feedback.comments.every(r=>!!r.removed_at)'));q.click('#closeViewer');q.reload();idle(q);open_local(q);check('Local comment removal remains after reload',q.evaluate('Hub.getCurrent().feedback.comments.every(r=>!!r.removed_at)'));q.click('#closeViewer')
  q.click('#importOpen');q.fill('#importTitle','Additional synthetic batch')
  q.evaluate("async()=>{const r=(await ReviewDemo.records()).find(x=>x.kind==='fiji'),items=[];for(const n of ['extra_a','extra_b']){items.push({name:n+'.ome_DAPI.tif',bytes:await r.image.bytes()},{name:n+'_rois.zip',bytes:await r.annotations[0].bytes()});}await Hub.importFiles([new File([await GTCore.makeZip(items)],'extra.zip')]);}");idle(q)
  check('A second ZIP appends two fields and retains the first batch',q.evaluate('Hub.getLocal().length')==4)
  q.click('#importOpen');q.fill('#importTitle','Additional synthetic batch')
  q.evaluate("async()=>{const r=Hub.getLocal().find(x=>x.key==='extra_a');await Hub.importFiles([new File([await r.annotations[0].bytes()],'extra_a_rois.zip')]);}");idle(q)
  check('ROI-only import reuses its unique saved image and avoids identical duplicates',q.evaluate('Hub.getLocal().length')==4)
  q.fill('#search','');q.click('#selectVisibleFields');q.fill('#search','extra_a');check('Hidden selection is counted explicitly','3 selected item(s) are hidden' in q.locator('#hiddenSelectionInfo').inner_text());q.click('#selectVisibleFields');check('Select shown only clears hidden selections',q.evaluate('Hub.getLocal().filter(r=>r.selected).length')==1)
  q.fill('#search','');q.click('#clearFieldSelection');q.wait_for_timeout(350);q.screenshot(path=str(OUT/'local_library.png'))
  login(q,'a@test.invalid');fault['upload']=True;publish(q,'SYNTHETIC_demo')
  check('Injected upload failure leaves recoverable journal and saved local files',q.evaluate('Hub.hasPausedUpload()') and len(tables['nr_collections'])==1)
  q.reload();idle(q);q.wait_for_function('Hub.hasPausedUpload()');check('Reload restores pending upload without automatic network writes',len(tables['nr_collections'])==1 and q.evaluate('Hub.getLocal().length')==4)
  q.click('#retryPublish');idle(q);check('Upload resumes after reload without duplicate field or version',len(tables['nr_collections'])==1 and len(tables['nr_fields'])==1 and len(tables['nr_versions'])==1 and q.evaluate('!Hub.hasPausedUpload()'))
  check('Publishing retains all device copies',q.evaluate('Hub.getLocal().length')==4)
  publish(q,'SYNTHETIC_REFERENCE');check('Both types can be separately shared from persistent storage',q.evaluate('Hub.getShared().length')==2)
  q.evaluate("()=>Hub.openField(Hub.getShared().find(r=>r.kind==='fiji'))");q.wait_for_function('!!Hub.getCurrent()?.feedback');q.click('[data-panel="comments"]')
  for i in range(2):
   q.fill('#commentBody','Shared synthetic comment '+str(i));q.click('#postComment');idle(q)
  q.click('#select-comments');q.click('#remove-comments');q.wait_for_selector('#batchResultDialog[open]');close_result(q);check('Shared comments can be removed as a confirmed batch',len(tables['nr_comments'])==2 and all(r.get('removed_at') for r in tables['nr_comments']));q.click('#closeViewer')
  q.fill('#search','');q.click('[data-scope="shared"]');q.click('#selectVisibleFields');fid=q.evaluate('Hub.getShared()[0].id');fault['delete']=fid;q.click('#trashSelectedShared');q.wait_for_selector('#batchResultDialog[open]');
  check('Batch cloud removal reports partial failure instead of claiming all succeeded',len(q.evaluate('DeviceWorkspaceUI.getLastReport().filter(r=>!r.ok)'))==1 and q.evaluate('Hub.getShared().length')==1);check('Failed shared deletion stays selected',q.evaluate('Hub.getSharedSelection().size')==1);close_result(q);q.click('#trashSelectedShared');q.wait_for_selector('#batchResultDialog[open]');close_result(q)
  check('Removing last visible shared images updates both count and category filter',q.locator('#collectionCount').inner_text()=='0' and q.locator('#collectionFilter option').count()==1 and q.evaluate('Hub.getLocal().length')==4)
  check('Cloud Trash does not erase raw stored files',len(objects)==4)
  q.click('#manageTrash');q.wait_for_selector('.management-choice');q.click('#selectManagerItems');q.click('#applyManagerBatch');q.wait_for_selector('#batchResultDialog[open]');close_result(q);q.locator('#managementDialog [aria-label="Close data management"]').click();idle(q)
  check('Trash supports multi-select restore',q.evaluate('Hub.getShared().length')==2)
  other=playwright.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='workspace-other-'),headless=True,args=['--no-sandbox']);setup(other);b=page(other);login(b,'b@test.invalid');check('A different browser profile has its own empty local library',b.evaluate('Hub.getLocal().length')==0);b.click('#selectVisibleFields');check('Non-owner reviewer cannot bulk-trash another member uploads',b.locator('#trashSelectedShared').is_disabled());other.close()
  q.click('[data-scope="local"]');q.fill('#search','');q.click('#selectVisibleFields');saved=hashes(q)
  with q.expect_download() as event:q.click('#backupSelectedLocal')
  download=event.value;backup=OUT/'synthetic_local_backup.zip';download.save_as(str(backup));idle(q)
  archive=zipfile.ZipFile(backup);manifest=json.loads(archive.read('_nuclei_local_backup.json'))
  for row in manifest['records']:
   for f in [row['image'],*row['annotations']]:assert hashlib.sha256(archive.read('sources/'+f['hash'])).hexdigest()==f['hash']
  check('Backup source files pass independent Python SHA-256 comparison',True)
  q.click('#removeSelectedLocal');idle(q);q.wait_for_function('Hub.getLocal().length===0');q.reload();idle(q)
  check('Multi-select local deletion remains deleted after refresh but keeps cloud uploads',q.evaluate('Hub.getLocal().length===0 && Hub.getShared().length===2'))
  q.locator('#localBackupInput').set_input_files(str(backup));idle(q);q.wait_for_function('Hub.getLocal().length===4');check('Backup restoration reconstructs every source byte hash',hashes(q)==saved)
  q.set_viewport_size({'width':430,'height':900});q.screenshot(path=str(OUT/'mobile_library.png'));q.set_viewport_size({'width':1500,'height':1100})
  check('No JavaScript runtime errors in exercised flows',not errors)
  ctx.close()
finally:
 server.shutdown();report={'scope':'Real Chromium and native IndexedDB, including full browser process restart. Supabase API and Storage are mocked. Synthetic fixtures only; no production writes.','checks':checks,'runtime_errors':errors,'passed':len(checks),'created_at':now()};(OUT/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
