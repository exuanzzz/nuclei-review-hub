"""Native browser + IndexedDB; synthetic sources; mocked Auth/PostgREST/Storage.
No live Supabase user or object writes. DB permissions are verified separately.
"""
from pathlib import Path
import copy, datetime, functools, hashlib, http.server, json, shutil, threading, time, uuid
from urllib.parse import urlparse,parse_qs,unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/guests';OUT.mkdir(parents=True,exist_ok=True)
A='11111111-1111-4111-8111-111111111111'
tables={x:[] for x in ['nr_collections','nr_fields','nr_versions','nr_comments','nr_proposals','nr_reviews']}
tables['nr_members']=[dict(user_id=A,display_name='Owner',role='admin',active=True)]
users={A:{'id':A,'email':'owner@example.invalid','is_anonymous':False}};objects={};calls=[];errors=[];checks=[]
state={'enabled':True,'provider':True,'signup':True,'signup_count':0,'refresh_count':0,'failure':False,'revoked':set()}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def session(uid):return dict(access_token=uid,refresh_token=uid,expires_in=3600,user=users[uid])
def answer(route,obj=None,status=200,raw=None):
 route.fulfill(status=status,body=raw if raw is not None else json.dumps(obj),content_type='application/octet-stream' if raw is not None else 'application/json',headers={'Access-Control-Allow-Origin':'*'})
def api(route):
 req=route.request;u=urlparse(req.url);p=unquote(u.path);qp=parse_qs(u.query);raw=req.post_data_buffer or b''
 try:body=json.loads(raw) if raw else {}
 except (ValueError,UnicodeDecodeError):body={}
 uid=req.headers.get('authorization','').removeprefix('Bearer ');calls.append((req.method,p,copy.deepcopy(body)))
 if req.method=='OPTIONS':return route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'*'})
 if p=='/rest/v1/rpc/nr_guest_access_status':return answer(route,dict(enabled=state['enabled'],default_role='reviewer'))
 if p=='/rest/v1/rpc/nr_registration_status':return answer(route,dict(enabled=True,email_confirmation_required=False))
 if p=='/auth/v1/settings':return answer(route,dict(external={'email':True,'anonymous_users':state['provider']},disable_signup=not state['signup'],mailer_autoconfirm=True))
 if p=='/auth/v1/signup':
  if not state['provider']:return answer(route,{'message':'Anonymous sign-ins disabled'},422)
  state['signup_count']+=1;new=str(uuid.uuid4());users[new]={'id':new,'is_anonymous':True};return answer(route,session(new))
 if p=='/auth/v1/token':
  if qp.get('grant_type')==['password']:return answer(route,session(A))
  state['refresh_count']+=1;return answer(route,session(body['refresh_token']))
 if uid not in users:return answer(route,{'message':'Authentication required'},401)
 if p=='/auth/v1/user':return answer(route,users[uid])
 if p=='/auth/v1/logout':return answer(route,{})
 def collection(cid):return next(r for r in tables['nr_collections'] if r['id']==cid)
 def field(fid):return next(r for r in tables['nr_fields'] if r['id']==fid)
 if p=='/rest/v1/rpc/nr_join_guest_workspace':
  if uid in state['revoked'] or not state['enabled']:return answer(route,{'message':'This membership is revoked or guest access paused'},403)
  if not users[uid]['is_anonymous']:return answer(route,{'message':'Guests only'},403)
  if not any(r['user_id']==uid for r in tables['nr_members']):tables['nr_members'].append(dict(user_id=uid,display_name='Guest '+uid[:8],role='reviewer',active=True))
  return answer(route,dict(joined=True,role='reviewer'))
 if uid in state['revoked']:return answer(route,[],200) if p=='/rest/v1/nr_members' else answer(route,{'message':'Revoked'},403)
 if p.startswith('/storage/v1/object/'):
  key=p.split('/nuclei-private/')[1]
  if req.method=='GET':return answer(route,raw=objects[key]) if key in objects else answer(route,{'message':'Missing'},404)
  if key in objects:return answer(route,{'message':'No overwrite'},409)
  objects[key]=raw;return answer(route,{'Key':key})
 if p.startswith('/rest/v1/rpc/'):
  name=p.split('/')[-1]
  if name=='nr_set_guest_name':
   r=next(r for r in tables['nr_members'] if r['user_id']==uid);r['display_name']=body['p_name'];return answer(route,{'display_name':r['display_name']})
  if name=='nr_management_version':return answer(route,'trash-feedback-v1')
  if name=='nr_set_guest_access':
   if uid!=A:return answer(route,{'message':'Administrator required'},403)
   state['enabled']=body['p_enabled'];return answer(route,{'enabled':state['enabled']})
  if name=='nr_create_version':
   ident=str(uuid.uuid4());f=field(body['p_field']);row=dict(id=ident,field_id=f['id'],parent_id=body['p_parent'],seq=1+sum(v['field_id']==f['id'] for v in tables['nr_versions']),author_id=uid,summary=body['p_summary'],manifest=body['p_manifest'],object_path=ident+'/source.zip',thumbnail_path=ident+'/thumb.png',archive_sha256=body['p_hash'],archive_bytes=body['p_bytes'],source_object_count=body['p_manifest']['sourceObjectCount'],state='draft',created_at=now());tables['nr_versions'].append(row);return answer(route,row)
  if name=='nr_publish_version':
   v=next(v for v in tables['nr_versions'] if v['id']==body['p_id']);assert hashlib.sha256(objects[v['object_path']]).hexdigest()==v['archive_sha256'];v['state']='ready';return answer(route,None)
  if name=='nr_publish_collection':collection(body['p_id'])['state']='ready';return answer(route,None)
  if name=='nr_remove_feedback':
   row=next(r for r in tables['nr_'+{'comment':'comments','proposal':'proposals','review':'reviews'}[body['p_type']]] if r['id']==body['p_id'])
   if row['author_id']!=uid and uid!=A:return answer(route,{'message':'Author only'},403)
   row['removed_at']=now();row['body']='[Deleted comment]';return answer(route,{'changed':True})
  if name=='nr_trash_item':
   row=field(body['p_id']) if body['p_type']=='field' else collection(body['p_id'])
   if row.get('created_by',row.get('owner_id'))!=uid and uid!=A:return answer(route,{'message':'Owner only'},403)
   row['trashed_at']=None if body['p_restore'] else now();return answer(route,{'changed':True})
  if name=='nr_list_trash':return answer(route,[])
  return answer(route,{'message':'Unexpected RPC '+name},400)
 if p.startswith('/rest/v1/'):
  t=p.split('/')[-1]
  if req.method=='GET':
   rows=copy.deepcopy(tables[t]);rows=[r for r in rows if not r.get('trashed_at')]
   if t=='nr_versions':rows=[r for r in rows if not field(r['field_id']).get('trashed_at')]
   for k,v in qp.items():
    if v[0].startswith('eq.'):rows=[r for r in rows if str(r.get(k))==v[0][3:]]
   return answer(route,rows[int(qp.get('offset',['0'])[0]):][:int(qp.get('limit',['500'])[0])])
  if req.method=='POST':
   row={**body,'created_at':now()}
   if t=='nr_collections':row.update(owner_id=uid,state='draft')
   elif t=='nr_fields':row.update(created_by=uid)
   elif t=='nr_members':return answer(route,{'message':'No role mutation'},403)
   else:row.update(author_id=uid)
   tables[t].append(row);return answer(route,[row])
 return answer(route,{'message':'Unhandled '+p},404)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'site')));threading.Thread(target=server.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{server.server_port}/'
def check(name,value):
 assert value,name
 checks.append({'test':name,'passed':True});print('PASS',name,flush=True)
def wait(q,expr,timeout=25):
 until=time.monotonic()<0
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  if q.evaluate(expr):return
  q.wait_for_timeout(50)
 q.screenshot(path=str(OUT/'failure.png'));raise AssertionError(expr+'; '+q.locator('#toast').inner_text())
def setup(ctx):
 ctx.route('**/config.js',lambda r:r.fulfill(content_type='application/javascript',body="window.REVIEW_CONFIG={supabaseUrl:'https://guest-mock.supabase.co',publishableKey:'sb_publishable_mock',bucket:'nuclei-private',pollSeconds:600};"))
 def route(r):
  if urlparse(r.request.url).hostname=='guest-mock.supabase.co':api(r)
  else:raise AssertionError('Unexpected external network: '+r.request.url)
 ctx.route('https://**',route)
def page(ctx):
 q=ctx.new_page();q.on('pageerror',lambda e:errors.append(str(e)));q.goto(URL);return q
def ready(q):wait(q,'!!window.ReviewGuest && !!Hub.getUser() && !Hub.isBusy()')
try:
 with sync_playwright() as pw:
  options={'headless':True,'args':['--no-sandbox']};exe=shutil.which('chromium')
  if exe:options['executable_path']=exe
  b=pw.chromium.launch(**options);ctx=b.new_context(viewport={'width':1450,'height':1050});setup(ctx);q=page(ctx);ready(q);g=q.evaluate('Hub.getUser().user_id')
  check('Fresh visitor automatically joins as reviewer, never administrator',q.evaluate('Hub.getUser().is_anonymous && Hub.getUser().role==="reviewer"'))
  check('No registration, email or login dialog required',not q.locator('#loginDialog').is_visible() and not q.locator('#signupOpen').is_visible() and state['signup_count']==1)
  check('Anonymous request contains no email, password or requested role',[x[2] for x in calls if x[1]=='/auth/v1/signup']==[{'data':{'display_name':'Guest'}}])
  check('Guest cannot see member/access administration',not q.locator('#openTeam').is_visible())
  q.on('dialog',lambda d:d.accept('Synthetic reviewer') if d.type=='prompt' else d.accept());q.click('#guestNickname');wait(q,'Hub.getUser().display_name==="Synthetic reviewer"')
  q.reload();ready(q);check('Guest identity and nickname survive reload',q.evaluate('Hub.getUser().user_id')==g and q.evaluate('Hub.getUser().display_name')=='Synthetic reviewer' and state['signup_count']==1)
  q2=page(ctx);ready(q2);check('Second tab reuses persistent guest instead of creating another',q2.evaluate('Hub.getUser().user_id')==g and state['signup_count']==1);q2.close()
  persisted=ctx.storage_state();ctx2=b.new_context(storage_state=persisted);setup(ctx2);q2=page(ctx2);ready(q2);check('Guest can resume after browser session ends',q2.evaluate('Hub.getUser().user_id')==g and state['signup_count']==1);ctx2.close()
  q.click('#demo');wait(q,'!Hub.isBusy() && Hub.getLocal().length===2');q.evaluate('for(const r of Hub.getLocal())r.selected=r.kind==="fiji";Hub.render();')
  q.click('#publish');q.wait_for_selector('#uploadCheckDialog[open]')
  if q.locator('#uploadAcknowledgeLabel').is_visible():q.check('#uploadAcknowledge')
  q.click('#confirmUploadCheck');wait(q,'!Hub.isBusy() && Hub.getShared().length===1')
  check('Guest publishes synthetic original TIFF and ROI to shared storage',len(tables['nr_fields'])==1 and len(objects)==2 and tables['nr_fields'][0]['created_by']==g)
  q.evaluate('Hub.openField(Hub.getShared()[0])');wait(q,'!!Hub.getCurrent()?.data')
  check('Shared source archive loads with original ROI outlines',q.locator('#sourceSvg path').count()==10)
  q.click('#viewSplit');check('Side-by-side viewer remains available',q.locator('#compareOriginalPane').is_visible())
  q.fill('#commentBody','Synthetic guest feedback');q.click('#postComment');wait(q,'!Hub.isBusy() && Hub.getCurrent().feedback.comments.length===1')
  check('Guest posts a comment with its own authorship',tables['nr_comments'][0]['author_id']==g)
  q.evaluate('Hub.getViewer().polygon={type:"polygon",points:[[10,10],[40,10],[40,40]]};document.getElementById("proposalLabel").value="Synthetic proposal";Hub.saveFeedback("proposals");');wait(q,'!Hub.isBusy() && Hub.getCurrent().feedback.proposals.length===1')
  check('Guest submits a separate polygon proposal without overwriting source ROI',tables['nr_proposals'][0]['author_id']==g and len(tables['nr_versions'])==1)
  q.evaluate('document.getElementById("verdict").value="needs_changes";document.getElementById("decisionBody").value="Synthetic review";Hub.saveFeedback("reviews");');wait(q,'!Hub.isBusy() && Hub.getCurrent().feedback.reviews.length===1')
  check('Guest records review decisions',len(tables['nr_reviews'])==1)
  check('Guest cannot approve own source version',q.locator('#verdict option[value=approved]').is_disabled())
  q.screenshot(path=str(OUT/'guest_viewer.png'))
  other=b.new_context();setup(other);o=page(other);ready(o);o.evaluate('Hub.openField(Hub.getShared()[0])');wait(o,'!!Hub.getCurrent()?.data')
  check('Another guest can view published sources and approve another author',not o.locator('#verdict option[value=approved]').is_disabled())
  wait(o,'document.getElementById("trashCurrent").classList.contains("hidden") || document.getElementById("trashCurrent").disabled')
  check('Other-author image deletion stays unavailable',o.locator('#trashCurrent').is_hidden() or o.locator('#trashCurrent').is_disabled())
  other.close();q.click('#closeViewer')
  q.click('#loginOpen');q.fill('#email','owner@example.invalid');q.fill('#password','Synthetic-pass-123');q.click('#loginForm button');wait(q,'Hub.getUser()?.role==="admin"')
  check('Owner can sign in without converting or losing guest identity',not q.evaluate('Hub.getUser().is_anonymous') and q.locator('#openTeam').is_visible())
  before=state['signup_count'];q.click('#logout');wait(q,'Hub.getUser()?.user_id==='+json.dumps(g));ready(q);check('Owner signout returns to the same guest without another registration',q.evaluate('Hub.getUser().user_id')==g and state['signup_count']==before)
  q.screenshot(path=str(OUT/'guest_library.png'))
  state['provider']=False;bad=b.new_context();setup(bad);z=page(bad);wait(z,'document.getElementById("guestAccessNotice")?.dataset.state==="error"')
  check('Disabled Anonymous Sign-ins shows exact setup requirement without signup loops','Allow anonymous sign-ins' in z.locator('#guestAccessMessage').inner_text() and state['signup_count']==before and not z.locator('#loginDialog').is_visible());bad.close();state['provider']=True
  state['revoked'].add(g);q.reload();wait(q,'document.getElementById("guestAccessNotice")?.dataset.state==="error"')
  check('Revoked identity is not silently replaced',state['signup_count']==before and not q.evaluate('!!Hub.getUser()'))
  check('No Javascript runtime errors',not errors)
  b.close()
finally:
 server.shutdown();(OUT/'report.json').write_text(json.dumps({'scope':'Real Chromium, native IndexedDB; mocked Auth, REST and Storage. Synthetic files only; no production uploads or user creation.','checks':checks,'passed':len(checks),'errors':errors},indent=2))
