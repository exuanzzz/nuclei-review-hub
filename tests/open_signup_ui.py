"""Native browser registration checks using mocked Auth/Data APIs only.
No production accounts, passwords, email delivery, storage or memberships are used.
"""
from pathlib import Path
import functools, http.server, json, threading, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results/registration';OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];calls=[]
state={'installed':False,'open':True,'autoconfirm':False,'disable_signup':False,'confirmed':False,'revoked':False,'smtp_error':False}
NEW='22222222-2222-4222-8222-222222222222';ADMIN='11111111-1111-4111-8111-111111111111'
members={ADMIN:{'user_id':ADMIN,'display_name':'Synthetic admin','role':'admin','active':True}}
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'site')))
threading.Thread(target=server.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{server.server_port}/'
def check(label,ok):
 if not ok:raise AssertionError(label)
 checks.append({'test':label,'passed':True});print('PASS',label,flush=True)
def wait(q,expr,timeout=30):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  if q.evaluate(expr):return
  q.wait_for_timeout(50)
 q.screenshot(path=str(OUT/'failure.png'));raise AssertionError('Timeout: '+expr)
def reply(route,value,status=200):route.fulfill(status=status,content_type='application/json',body=json.dumps(value),headers={'Access-Control-Allow-Origin':'*'})
def api(route):
 req=route.request;u=urlparse(req.url);path=u.path;body=json.loads(req.post_data or '{}');token=req.headers.get('authorization','').removeprefix('Bearer ');uid=ADMIN if token=='admin-token' else NEW
 calls.append({'path':path,'method':req.method,'body':body,'query':parse_qs(u.query),'authorization':token})
 if req.method=='OPTIONS':return route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PUT'})
 if path=='/rest/v1/rpc/nr_registration_status':return reply(route,{'enabled':state['open'],'default_role':'contributor','email_confirmation_required':True}) if state['installed'] else reply(route,{'message':'Could not find function nr_registration_status'},404)
 if path=='/auth/v1/settings':return reply(route,{'external':{'email':True},'mailer_autoconfirm':state['autoconfirm'],'disable_signup':state['disable_signup']})
 if path in ['/auth/v1/signup','/auth/v1/resend']:
  if state['smtp_error']:return reply(route,{'message':'Error sending confirmation email'},500)
  return reply(route,{'id':NEW} if path.endswith('signup') else {})
 if path=='/auth/v1/token':
  if body.get('email')=='admin@example.invalid':return reply(route,{'access_token':'admin-token','refresh_token':'test-refresh','expires_in':3600})
  if not state['confirmed']:return reply(route,{'message':'Email not confirmed'},400)
  return reply(route,{'access_token':'new-token','refresh_token':'test-refresh','expires_in':3600})
 if path=='/auth/v1/user':return reply(route,{'id':uid,'email':'member@example.invalid'})
 if path=='/auth/v1/logout':return reply(route,{})
 if path=='/rest/v1/nr_members':
  values=list(members.values())
  if 'user_id' in parse_qs(u.query):values=[v for v in values if v['user_id']==uid]
  return reply(route,values if token else [])
 if path=='/rest/v1/rpc/nr_join_open_workspace':
  if not token or not state['confirmed']:return reply(route,{'message':'Confirm your email address before joining this workspace.'},403)
  if state['revoked']:return reply(route,{'message':'Your workspace access was revoked. Contact the administrator.'},403)
  if not state['open']:return reply(route,{'message':'Public joining is currently paused.'},403)
  members[uid]={'user_id':uid,'display_name':'Synthetic member','role':'contributor','active':True};return reply(route,{'joined':True,'role':'contributor'})
 if path=='/rest/v1/rpc/nr_set_open_registration':
  if uid!=ADMIN:return reply(route,{'message':'Workspace administrator required.'},403)
  state['open']=body['p_enabled'];return reply(route,{'enabled':state['open']})
 if path.startswith('/rest/v1/') and req.method=='GET':return reply(route,[])
 return reply(route,{'message':'Unexpected test endpoint '+path},400)
def configure(ctx):
 ctx.route('**/config.js',lambda r:r.fulfill(content_type='application/javascript',body="window.REVIEW_CONFIG={supabaseUrl:'https://mock.supabase.co',publishableKey:'sb_publishable_test_only',bucket:'nuclei-private',pollSeconds:600};"))
 ctx.route('https://mock.supabase.co/**',api)
def login(q,email='new@example.invalid'):
 q.click('#loginOpen');q.fill('#email',email);q.fill('#password','Synthetic-only-password-123');q.click('#loginForm button')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1300,'height':1000});configure(ctx);q=ctx.new_page();q.on('pageerror',lambda e:errors.append(str(e)));q.on('dialog',lambda d:d.accept());q.goto(URL);wait(q,'!!window.ReviewSignup && !Hub.isBusy()')
  q.click('#signupOpen');wait(q,"document.getElementById('signupStatus').textContent.includes('update 05')")
  check('Missing database migration keeps registration disabled',q.locator('#submitSignup').is_disabled())
  state['installed']=True;q.evaluate('ReviewSignup.checkStatus()');wait(q,'!document.getElementById("submitSignup").disabled')
  check('Open registration explains team-wide published-data access','all registered workspace members' in q.locator('#signupDialog').inner_text())
  q.fill('#signupName','Synthetic reviewer');q.fill('#signupEmail','new@example.invalid');q.fill('#signupPassword','Synthetic-only-password-123');q.fill('#signupRepeat','Different-password-456');q.check('#signupConsent');q.click('#submitSignup');wait(q,"document.getElementById('signupMessage').textContent.includes('do not match')")
  check('Password mismatch makes no signup request',not any(c['path']=='/auth/v1/signup' for c in calls))
  q.fill('#signupRepeat','Synthetic-only-password-123');q.click('#submitSignup');wait(q,"document.getElementById('signupMessage').textContent.includes('Request accepted')")
  signup=[c for c in calls if c['path']=='/auth/v1/signup'][-1]
  check('Signup submits only display name metadata, not a role',signup['body']['data']=={'display_name':'Synthetic reviewer'} and 'role' not in signup['body'])
  check('Confirmation uses current application path rather than external or deep-link target',signup['query']['redirect_to']==[URL])
  check('Signup alone does not join or grant a session',NEW not in members and not q.evaluate('ReviewCloud.hasSession()'))
  check('Password input is cleared after successful signup',q.input_value('#signupPassword')=='' and q.input_value('#signupRepeat')=='')
  check('Resend confirmation has a visible cooldown',q.locator('#resendSignup').is_disabled())
  q.screenshot(path=str(OUT/'signup.png'))
  q.click('#backToSignin');q.fill('#email','new@example.invalid');q.fill('#password','Synthetic-only-password-123');q.click('#loginForm button');wait(q,"document.getElementById('loginMessage').textContent.includes('Email not confirmed')")
  check('Unconfirmed signin does not invoke joining RPC',not any(c['path']=='/rest/v1/rpc/nr_join_open_workspace' for c in calls))
  state['confirmed']=True;q.click('#loginForm button');wait(q,'Hub.getUser()?.role==="contributor"')
  check('Verified first login enrolls and reaches normal shared workspace',NEW in members and q.evaluate('Hub.getUser().active'))
  check('Enrollment request cannot nominate another user or choose a role',[c for c in calls if c['path']=='/rest/v1/rpc/nr_join_open_workspace'][-1]['body']=={})
  q.click('#openTeam');wait(q,'document.getElementById("teamDialog").open');check('Contributor does not get registration administration',not q.locator('#publicRegistrationAdmin').is_visible());q.locator('#teamDialog .dialog-close button').click();q.click('#logout');wait(q,'!Hub.getUser()')
  members.pop(NEW);state['revoked']=True;login(q);wait(q,"document.getElementById('loginMessage').textContent.includes('revoked')")
  check('Revoked member error is shown instead of silently recreating membership',NEW not in members and not q.evaluate('!!Hub.getUser()'))
  q.locator('#loginDialog .dialog-close button').click();state['revoked']=False
  login(q,'admin@example.invalid');wait(q,'Hub.getUser()?.role==="admin"');q.click('#openTeam');wait(q,"document.getElementById('togglePublicRegistration').textContent.includes('Pause')")
  q.click('#togglePublicRegistration');wait(q,"document.getElementById('togglePublicRegistration').textContent.includes('Enable')")
  check('Administrator can pause joining without changing own role',not state['open'] and q.evaluate('Hub.getUser().role')=='admin')
  q.locator('#teamDialog .dialog-close button').click();q.click('#logout');wait(q,'!Hub.getUser()');q.click('#signupOpen');wait(q,"document.getElementById('signupStatus').textContent.includes('paused')")
  check('Paused registration is visible and cannot be submitted',q.locator('#submitSignup').is_disabled())
  state['open']=True;q.evaluate('ReviewSignup.checkStatus()');wait(q,'!document.getElementById("submitSignup").disabled')
  q.fill('#signupPassword','Synthetic-only-password-123');q.fill('#signupRepeat','Synthetic-only-password-123');state['autoconfirm']=True;before=sum(c['path']=='/auth/v1/signup' for c in calls);q.click('#submitSignup');wait(q,"document.getElementById('signupMessage').textContent.includes('Confirm email ON')")
  check('UI refuses misconfigured auto-confirm without creating an account',sum(c['path']=='/auth/v1/signup' for c in calls)==before)
  state['autoconfirm']=False;state['smtp_error']=True;q.click('#submitSignup');wait(q,"document.getElementById('signupMessage').textContent.includes('custom SMTP')")
  check('Email delivery failure has an actionable message, not false success','Request accepted' not in q.locator('#signupMessage').inner_text())
  q.set_viewport_size({'width':430,'height':920});b=q.locator('#signupDialog').bounding_box();check('Registration dialog fits narrow viewport',b['x']>=0 and b['x']+b['width']<=430);q.screenshot(path=str(OUT/'signup_mobile.png'));ctx.close()
  state['smtp_error']=False;ctx=browser.new_context();configure(ctx);p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.goto(URL+'#access_token=new-token&refresh_token=test-refresh&expires_in=3600');wait(p,'Hub.getUser()?.role==="contributor"')
  check('Verified email callback enrolls without manual administrator action',NEW in members and '#' not in p.url)
  check('No signup operation writes image data or cloud source files',not any(c['path'].startswith('/storage/') for c in calls))
  check('No JavaScript runtime errors in exercised signup flows',not errors);browser.close()
finally:
 server.shutdown();report={'scope':'Real Chromium UI; mocked Supabase Auth/Data APIs; synthetic accounts only; email delivery and production configuration not tested','checks':checks,'passed':len(checks),'runtime_errors':errors};(OUT/'report.json').write_text(json.dumps(report,indent=2))
