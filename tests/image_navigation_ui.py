"""Native Chromium image-navigation tests. Synthetic fixtures and mock cloud only."""
from pathlib import Path
from urllib.parse import urlparse,parse_qs,unquote
import functools,http.server,threading,json,time,base64
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/navigation';OUT.mkdir(parents=True,exist_ok=True)
USER='11111111-1111-4111-8111-111111111111'
checks=[];errors=[];objects={}
tables={'nr_members':[dict(user_id=USER,display_name='Synthetic tester',role='admin',active=True)],'nr_collections':[],'nr_fields':[],'nr_versions':[],'nr_comments':[],'nr_proposals':[],'nr_reviews':[]}
def check(label,ok):
 if not ok:raise AssertionError(label)
 checks.append({'test':label,'passed':True});print('PASS',label,flush=True)
def wait(q,expr):
 until=time.monotonic()+30
 while time.monotonic()<until:
  if q.evaluate(expr):return
  q.wait_for_timeout(50)
 q.screenshot(path=str(OUT/'failure.png'));raise AssertionError('Timeout: '+expr)
def answer(route,x=None,raw=None,status=200):
 route.fulfill(status=status,body=raw if raw is not None else json.dumps(x),content_type='application/zip' if raw is not None else 'application/json',headers={'Access-Control-Allow-Origin':'*'})
def api(route):
 req=route.request;path=unquote(urlparse(req.url).path);params=parse_qs(urlparse(req.url).query)
 if req.method=='OPTIONS':return route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'})
 if path=='/auth/v1/token':return answer(route,dict(access_token=USER,refresh_token=USER,expires_in=3600))
 if path=='/auth/v1/user':return answer(route,dict(id=USER,email='tester@test.invalid'))
 if path=='/auth/v1/logout':return answer(route,{})
 if path.startswith('/rest/v1/'):
  rows=tables.get(path.split('/')[-1],[])
  for k,v in params.items():
   if v[0].startswith('eq.'):rows=[r for r in rows if str(r.get(k))==v[0][3:]]
  return answer(route,rows)
 if '/nuclei-private/' in path:
  key=path.split('/nuclei-private/')[1]
  return answer(route,raw=objects[key]) if key in objects else answer(route,{'message':'Missing'},status=404)
 return answer(route,{'message':'Unexpected request'},status=400)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'site')));threading.Thread(target=server.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{server.server_port}/'
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1500,'height':1050})
  ctx.route('**/config.js',lambda r:r.fulfill(content_type='application/javascript',body="window.REVIEW_CONFIG={supabaseUrl:'https://mock.supabase.co',publishableKey:'sb_publishable_synthetic',bucket:'nuclei-private',pollSeconds:600};"));ctx.route('https://mock.supabase.co/**',api)
  q=ctx.new_page();q.on('pageerror',lambda e:errors.append(str(e)));dialogs={'accept':True};q.on('dialog',lambda d:d.accept() if dialogs['accept'] else d.dismiss())
  q.goto(URL);wait(q,'window.FieldNavigation && window.Hub && !Hub.isBusy()')
  q.evaluate("""async()=>{const source=(await ReviewDemo.records()).find(r=>r.kind==='fiji');for(let i=1;i<=3;i++){const r={...source,key:'specimen_'+i,name:'specimen_'+i,annotations:source.annotations.slice()};const t=await ReviewData.thumbnail(r);r.thumb=t.url;r.width=t.w;r.height=t.h;await DeviceLibrary.save(r,{group:'navigation',title:'Navigation examples',kind:'fiji',description:'Synthetic only'});}await Hub.reloadLocal();Hub.setScope('local');}""")
  q.evaluate('Hub.openField(Hub.getVisible()[0])');wait(q,'!!Hub.getCurrent()?.data');q.wait_for_timeout(100)
  check('First image counter and disabled Previous',q.locator('#imagePosition').inner_text()=='1 / 3' and q.locator('#previousImage').is_disabled())
  q.click('#viewSplit');q.click('#nextImage');wait(q,"Hub.getCurrent()?.record.name==='specimen_2' && !!Hub.getCurrent()?.data")
  check('Next opens second image and keeps comparison mode',q.locator('#imagePosition').inner_text()=='2 / 3' and q.evaluate("Hub.getViewer().mode==='split'"))
  q.evaluate('document.activeElement.blur()');q.keyboard.press('ArrowRight');wait(q,"Hub.getCurrent()?.record.name==='specimen_3' && !!Hub.getCurrent()?.data")
  check('Arrow key reaches final image without wrapping',q.locator('#imagePosition').inner_text()=='3 / 3' and q.locator('#nextImage').is_disabled())
  q.click('[data-panel="reviews"]');q.fill('#decisionBody','Unsaved decision');dialogs['accept']=False;q.click('#previousImage');q.wait_for_timeout(100)
  check('Cancel preserves unsaved decision and current image',q.evaluate("Hub.getCurrent().record.name==='specimen_3' && !!Hub.getCurrent().data") and q.locator('#decisionBody').input_value()=='Unsaved decision')
  q.locator('#decisionBody').focus();q.keyboard.press('ArrowLeft');q.wait_for_timeout(80)
  check('Typing controls do not consume arrow keys for navigation',q.evaluate("Hub.getCurrent().record.name==='specimen_3'"))
  dialogs['accept']=True;q.click('#previousImage');wait(q,"Hub.getCurrent()?.record.name==='specimen_2' && !!Hub.getCurrent()?.data")
  check('Confirmed discard navigates and clears old form',q.locator('#decisionBody').input_value()=='')
  q.screenshot(path=str(OUT/'navigation.png'));q.click('#closeViewer');q.fill('#search','specimen_1');q.evaluate('Hub.openField(Hub.getVisible()[0])');wait(q,'!!Hub.getCurrent()?.data');q.wait_for_timeout(100)
  check('Only filtered image list is navigated',q.locator('#imagePosition').inner_text()=='1 / 1' and q.locator('#nextImage').is_disabled())
  q.click('#closeViewer');q.fill('#search','')
  packed=q.evaluate("""async()=>{const out=[];for(const r of Hub.getLocal()){const d=await ReviewData.load(r),p=await ReviewData.packageField(r,d);let s='';for(const b of new Uint8Array(await p.blob.arrayBuffer()))s+=String.fromCharCode(b);out.push({name:r.name,key:r.key,w:d.w,h:d.h,sha:d.sha,archiveHash:p.sha,bytes:btoa(s)});}return out;}""")
  tables['nr_collections']=[dict(id='collection',title='Shared synthetic test',state='ready',kind='fiji',owner_id=USER)]
  for i,r in enumerate(packed):
   fid='field-'+str(i);vid='version-'+str(i);path=vid+'/source.zip';objects[path]=base64.b64decode(r['bytes']);tables['nr_fields'].append(dict(id=fid,collection_id='collection',source_key=r['key'],name=r['name'],width=r['w'],height=r['h'],created_by=USER,image_sha256=r['sha']));tables['nr_versions'].append(dict(id=vid,field_id=fid,seq=1,state='ready',author_id=USER,object_path=path,thumbnail_path='missing.png',archive_sha256=r['archiveHash'],source_object_count=10,created_at='2026-01-01'))
  q.click('#loginOpen');q.fill('#email','tester@test.invalid');q.fill('#password','Synthetic-only-123');q.click('#loginForm button');wait(q,'Hub.getShared().length===3')
  q.evaluate("Hub.setScope('shared');Hub.openField(Hub.getShared()[0]);");wait(q,'!!Hub.getCurrent()?.data');q.click('#nextImage');wait(q,"Hub.getCurrent()?.record.id==='field-1' && !!Hub.getCurrent()?.data")
  wait(q,"new URL(location.href).searchParams.get('version')==='version-1'")
  check('Shared navigation updates the version-specific review URL',parse_qs(urlparse(q.url).query).get('version')==['version-1'])
  q.set_viewport_size({'width':430,'height':920});q.wait_for_timeout(100);b=q.locator('#nextImage').bounding_box()
  check('Buttons stay inside narrow viewport',b is not None and b['x']>=0 and b['x']+b['width']<=430)
  q.click('#closeViewer');q.click('#logout');wait(q,'!Hub.getUser()')
  check('Navigation and sign-out retain local saved files',q.evaluate('Hub.getLocal().length')==3)
  check('No runtime JavaScript errors',not errors);browser.close()
finally:
 server.shutdown();(OUT/'report.json').write_text(json.dumps({'scope':'Native Chromium; synthetic files and mock Auth/REST/Storage. No production operations.','checks':checks,'passed':len(checks),'runtime_errors':errors},indent=2))
