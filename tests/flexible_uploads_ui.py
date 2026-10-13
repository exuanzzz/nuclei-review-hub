"""Native Chromium; mocked Supabase only. No production credentials or data.
Reuse the existing reviewed fixture backend, not its test-execution block.
"""
from pathlib import Path
import os,shutil
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'tests/workspace_e2e.py').read_text()
marker='try:\n with sync_playwright() as playwright:'
if source.count(marker)!=1:raise RuntimeError('Unexpected workspace test fixture layout')
exec(compile(source.split(marker)[0],str(ROOT/'tests/workspace_e2e.py'),'exec'))
OUT=ROOT/'test-results/flexible';OUT.mkdir(parents=True,exist_ok=True)
original_backend=backend
CID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
tables['nr_collections']=[dict(id=CID,title='Existing synthetic project',description='Not experimental data',kind='fiji',owner_id=A,state='ready',created_at=now())]
state={'open':True};mail_calls=[]
def backend(route):
 req=route.request;path=urlparse(req.url).path;uid=req.headers.get('authorization','').removeprefix('Bearer ')
 try:body=json.loads(req.post_data or '{}')
 except Exception:body={}
 if req.method=='OPTIONS':return original_backend(route)
 if path=='/rest/v1/rpc/nr_registration_status':return answer(route,dict(enabled=state['open'],email_confirmation_required=False))
 if path=='/auth/v1/settings':return answer(route,dict(external={'email':True},mailer_autoconfirm=True,disable_signup=False))
 if path=='/auth/v1/signup':
  mail_calls.append((path,body));return answer(route,dict(access_token=B,refresh_token=B,expires_in=3600,user={'id':B}))
 if path.endswith('/resend') or path.endswith('/otp'):raise AssertionError('No email request expected in no-email mode')
 if path=='/rest/v1/rpc/nr_join_open_workspace':
  if uid!=B or not state['open']:return answer(route,{'message':'Mock: unauthorized'},403)
  if not any(r['user_id']==B for r in tables['nr_members']):tables['nr_members'].append(dict(user_id=B,display_name='New synthetic member',role='contributor',active=True))
  return answer(route,dict(joined=True,role='contributor'))
 if path=='/rest/v1/rpc/nr_prepare_collection_field':
  if uid!=A:return answer(route,{'message':'Only owner/admin'},403)
  row=next((r for r in tables['nr_fields'] if r['collection_id']==body['p_collection'] and r['source_key']==body['p_key'] and not r.get('trashed_at')),None)
  if not row:
   row=dict(id=body['p_id'],collection_id=body['p_collection'],source_key=body['p_key'],name=body['p_name'],width=body['p_width'],height=body['p_height'],image_sha256=body['p_sha'],created_by=uid,created_at=now());tables['nr_fields'].append(row)
  return answer(route,row)
 return original_backend(route)
def setup(ctx):
 ctx.route('**/config.js',config);ctx.route('https://mock.supabase.co/**',backend)
 ctx.on('request',lambda req:check_request(req))
def submit(q):
 q.click('#publish');q.wait_for_selector('#uploadCheckDialog[open]')
 if q.locator('#uploadAcknowledgeLabel').is_visible():q.check('#uploadAcknowledge')
 q.click('#confirmUploadCheck');idle(q)
def import_pair(q,tif,roi):
 q.evaluate('CollectionFiles.open("shared:'+CID+'")')
 q.locator('#fileInput').set_input_files([str(tif),str(roi)]);q.click('#saveQueuedFiles');idle(q)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1450,'height':1020});setup(ctx)
  tables['nr_members']=[r for r in tables['nr_members'] if r['user_id']!=B]
  q=page(ctx);q.wait_for_function('!!window.CollectionFiles');q.click('#signupOpen');q.wait_for_function("document.getElementById('signupStatus').textContent.includes('no confirmation email')")
  check('No-email registration labels unverified identity','not verified proof' in q.locator('#signupDialog').inner_text())
  check('No-email mode hides resend and magic links',not q.locator('#resendSignup').is_visible() and not q.locator('#magicLink').is_visible())
  for ident,value in [('signupName','Synthetic user'),('signupEmail','new@test.invalid'),('signupPassword','Synthetic-password-123'),('signupRepeat','Synthetic-password-123')]:q.fill('#'+ident,value)
  q.check('#signupConsent');q.click('#submitSignup');q.wait_for_function('Hub.getUser()?.role==="contributor"');idle(q)
  check('Signup session automatically enrolls as Contributor',any(r['user_id']==B for r in tables['nr_members']))
  check('Signup metadata does not choose privilege',mail_calls[-1][1]['data']=={'display_name':'Synthetic user'})
  q.click('#logout');login(q,'a@test.invalid');q.click('#demo');idle(q)
  src=q.evaluate("async()=>{const r=Hub.getLocal().find(x=>x.kind==='fiji');return Promise.all([r.image,...r.annotations].map(async e=>{let s='';for(const b of await e.bytes())s+=String.fromCharCode(b);return btoa(s);}));}")
  tif=OUT/'added.ome_DAPI.tif';roi=OUT/'added_rois.zip';tif.write_bytes(base64.b64decode(src[0]));roi.write_bytes(base64.b64decode(src[1]))
  q.evaluate('Hub.setScope("shared")');q.click('#addImagesToCollection');q.select_option('#importCollectionTarget','shared:'+CID)
  q.locator('#fileInput').set_input_files(str(tif));q.locator('#fileInput').set_input_files(str(roi))
  check('Separate picker calls accumulate TIFF and ROI without folder upload',q.locator('#queuedFileNames>div').count()==2 and not tables['nr_fields'])
  q.screenshot(path=str(OUT/'add_single_image.png'));q.click('#saveQueuedFiles');idle(q);q.wait_for_function('Hub.getLocal().length===3')
  check('Import preserves existing local files and pairs ROI',q.evaluate('Hub.getLocal().find(x=>x.key==="added").annotations.length')==1)
  check('Existing shared collection is preselected',q.input_value('#uploadDestination')==CID)
  submit(q);q.wait_for_function('Hub.getShared().length===1');first=copy.deepcopy(tables['nr_fields'][0]);firstv=copy.deepcopy(tables['nr_versions'][0]);original=objects[firstv['object_path']]
  check('Append creates no new collection and keeps existing one ready',len(tables['nr_collections'])==1 and tables['nr_collections'][0]['state']=='ready')
  tables['nr_fields'][0]['trashed_at']=now();q.evaluate('Hub.loadShared()');idle(q)
  import_pair(q,tif,roi);submit(q);q.wait_for_function('Hub.getShared().length===1')
  check('Trash then upload same name creates a new field in same project',len(tables['nr_fields'])==2 and tables['nr_fields'][1]['id']!=first['id'])
  check('Archived source bytes and old version remain unchanged',objects[firstv['object_path']]==original and tables['nr_versions'][0]==firstv)
  check('Same files are not duplicated locally',q.evaluate('Hub.getLocal().length')==3)
  q.evaluate('Hub.setScope("local");for(const r of Hub.getLocal())r.selected=r.key==="added";Hub.render();');q.select_option('#uploadDestination',CID);before=len(tables['nr_versions']);submit(q);idle(q)
  check('Adding identical live source is idempotent',len(tables['nr_versions'])==before and len(tables['nr_fields'])==2)
  altered=OUT/'altered'/'added_rois.zip';altered.parent.mkdir(exist_ok=True)
  data=q.evaluate("async()=>{const r=Hub.getLocal().find(x=>x.key==='added');const es=await GTCore.zipEntries(new Blob([await r.annotations[0].bytes()]));const z=await GTCore.makeZip(await Promise.all(es.slice(1).map(async e=>({name:e.name,bytes:await e.bytes()}))));return Array.from(new Uint8Array(await z.arrayBuffer()));}");altered.write_bytes(bytes(data))
  import_pair(q,tif,altered);submit(q);idle(q)
  check('Different active ROI instructs revision instead of silent overwrite','Upload revised ROI ZIP' in q.locator('#toast').inner_text() and len(tables['nr_versions'])==before)
  newt=OUT/'later.ome_DAPI.tif';newr=OUT/'later_rois.zip';newt.write_bytes(tif.read_bytes());newr.write_bytes(roi.read_bytes());import_pair(q,newt,newr);fault['upload']=True;submit(q)
  check('Interrupted append keeps a journal',q.evaluate('Hub.hasPausedUpload()'))
  q.reload();idle(q);q.wait_for_function('Hub.hasPausedUpload() && !!Hub.getUser()');q.click('#retryPublish');idle(q);q.wait_for_function('Hub.getShared().length===2')
  check('Reload resume completes append without duplicate field/version',len(tables['nr_fields'])==3 and len(tables['nr_versions'])==3)
  check('Appending retains all local records after refresh',q.evaluate('Hub.getLocal().length')==5)
  check('Append never republishes whole collection or inserts field through unguarded REST',not any(p=='/rest/v1/rpc/nr_publish_collection' or (m=='POST' and p=='/rest/v1/nr_fields') for m,p in calls))
  check('No JavaScript runtime errors',not errors);q.screenshot(path=str(OUT/'existing_collection.png'));browser.close()
finally:
 server.shutdown();report={'scope':'Native Chromium and IndexedDB; mocked Supabase APIs; synthetic images only; no production writes','checks':checks,'passed':len(checks),'runtime_errors':errors};(OUT/'report.json').write_text(json.dumps(report,indent=2))
