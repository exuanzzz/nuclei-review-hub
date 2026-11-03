"""Install registration-free guests after all existing frontend build steps.
Backend access is checked by guarded RPCs/RLS. This build never changes data or Auth settings.
"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def once(s, old, new):
    if s.count(old) != 1:
        raise RuntimeError('Unexpected guest integration source: ' + old[:120])
    return s.replace(old, new, 1)
cloud = ROOT / 'site/js/cloud.js'
s = cloud.read_text()
if 'guest-workspace-v1' not in s:
    s = once(s, "let session=null,refreshing=null,authEpoch=0;", """// guest-workspace-v1
const guestEnabled=cfg.guestAccess!==false,guestKey='nuclei-guest:'+url;
let session=null,refreshing=null,authEpoch=0,enteringGuest=null;
let guestState={phase:'idle',message:''};
function guestNotice(phase,message=''){guestState={phase,message};window.dispatchEvent(new CustomEvent('nr:guest',{detail:guestState}));}
function readGuest(){try{const s=JSON.parse(localStorage.getItem(guestKey)||'null');return s?.access_token&&s?.refresh_token&&s.user?.is_anonymous===true?s:null;}catch{return null;}}
function rememberGuest(s){if(s?.user?.is_anonymous===true){try{localStorage.setItem(guestKey,JSON.stringify(s));}catch{guestNotice('warning','This browser cannot remember your guest identity after closing. Keep this tab open for your uploads.');}}}
function guestLock(fn){return navigator.locks?.request?navigator.locks.request('nuclei-guest-session:'+url,fn):fn();}
""")
    s = once(s, "try{session=JSON.parse(storage.getItem(storeKey)||'null');}catch{}", "try{session=JSON.parse(storage.getItem(storeKey)||'null');}catch{}\nif(!session&&guestEnabled)session=readGuest();")
    s = once(s, "storage.setItem(storeKey,JSON.stringify(s));}else storage.removeItem(storeKey);", "storage.setItem(storeKey,JSON.stringify(s));rememberGuest(s);}else storage.removeItem(storeKey);")
    start=s.index('async function token(){');end=s.index('async function request(', start)
    s=s[:start]+'''async function token(){
 if(!session)throw Error('No active session. Use Retry guest access.');
 if(session.user?.is_anonymous===true){const newer=readGuest();if(newer?.user?.id===session.user.id&&(newer.expires_at||0)>(session.expires_at||0))setSession(newer);}
 if((session.expires_at||0)>Date.now()/1000+90)return session.access_token;
 if(!refreshing){
  const generation=authEpoch,guest=session.user?.is_anonymous===true;
  const renew=async()=>{
   if(generation!==authEpoch)throw Error('Session changed. Retry your operation.');
   if(guest){const stored=readGuest();if(stored?.user?.id===session.user.id)setSession(stored);}
   if((session.expires_at||0)>Date.now()/1000+90)return session.access_token;
   const result=await auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token});
   if(generation!==authEpoch)throw Error('Session changed. Retry your operation.');
   setSession(result);return result.access_token;
  };
  refreshing=(guest?guestLock(renew):renew()).catch(e=>{
   // Never create a replacement guest silently; transient failures keep ownership.
   if(!guest&&generation===authEpoch&&[400,401].includes(e.status))setSession(null);
   throw e;
  }).finally(()=>refreshing=null);
 }
 return refreshing;
}
async function guestAccessStatus(){
 return parseResponse(await fetch(url+'/rest/v1/rpc/nr_guest_access_status',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}',cache:'no-store'}));
}
async function ensureGuestSession(){
 if(!configured||!guestEnabled)return;
 if(session)return;
 if(!enteringGuest){
  guestNotice('connecting','Connecting as a guest…');
  const generation=authEpoch;
  enteringGuest=guestLock(async()=>{
   if(session)return;
   const saved=readGuest();if(saved){setSession(saved);return;}
   const status=await guestAccessStatus();
   if(status.enabled!==true)throw Error('Guest access is paused by the site owner.');
   const settings=await emailRegistrationSettings();
   if(settings.disable_signup===true)throw Error('Guest access needs Allow new users to sign up enabled in Supabase.');
   if(settings.external?.anonymous_users===false)throw Error('The site owner must enable Allow anonymous sign-ins in Supabase → Authentication → Sign In / Providers. No registration is needed afterwards.');
   const created=await auth('signup',{data:{display_name:'Guest'}});
   if(generation!==authEpoch)throw Error('Session changed. Retry guest access.');
   if(!created.access_token||!created.refresh_token||created.user?.is_anonymous!==true)throw Error('The server did not create an anonymous session. No role was granted by this browser.');
   setSession(created);
  }).catch(e=>{guestNotice('error',e.status===429?'Too many guest requests. Try again later; do not repeatedly reload.':e.message);throw e;}).finally(()=>enteringGuest=null);
 }
 return enteringGuest;
}
''' + s[end:]
    s = once(s, "try{await rpc('nr_join_open_workspace',{});}", "try{await rpc(user.is_anonymous===true?'nr_join_guest_workspace':'nr_join_open_workspace',{});}")
    s = once(s, "return {...rows[0],email:user.email};", "if(user.is_anonymous===true)guestNotice('ready','Guest access connected.');\n return {...rows[0],email:user.email,is_anonymous:user.is_anonymous===true};")
    s = once(s, "async function signOut(){authEpoch++;try{if(session)await request('/auth/v1/logout',{method:'POST'});}finally{setSession(null);}}", "async function signOut(){if(session?.user?.is_anonymous===true)throw Error('Keep your guest session to retain ownership. Use the owner sign-in link to switch accounts.');authEpoch++;try{if(session)await request('/auth/v1/logout',{method:'POST'});}finally{setSession(null);}}")
    s = once(s, 'root.ReviewCloud={configured,url,', 'root.ReviewCloud={configured,url,guestEnabled,guestAccessStatus,ensureGuestSession,guestNotice,getGuestState:()=>guestState,')
    cloud.write_text(s)
app=ROOT/'site/js/app.js';s=app.read_text()
if 'guest-workspace-v1' not in s:
    s=once(s,"if(!B.hasSession()){modal('loginDialog');return;}","if(!B.hasSession()&&B.guestEnabled)await B.ensureGuestSession();\n if(!B.hasSession()){modal('loginDialog');return;}")
    s=once(s,"if(B.hasSession()){await loadShared();await restoreJob();await openDeepLink();}","if(B.hasSession()||B.guestEnabled){await loadShared();await restoreJob();await openDeepLink();}")
    s=once(s,"}catch(e){toast(e.message);}\n})();", "}catch(e){if(B.guestEnabled)B.guestNotice('error',e.message);toast(e.message);}\n})();")
    s=once(s,"thumbURLs.clear();membershipUI();renderGrid();};", "thumbURLs.clear();membershipUI();renderGrid();if(B.guestEnabled)await loadShared().catch(fail);};")
    app.write_text(s+'\n// guest-workspace-v1\n')
h=ROOT/'site/index.html';s=h.read_text()
if 'js/guest-ui.js' not in s:
    s=s.replace('</body>', '<script src="js/guest-ui.js"></script>\n</body>')
    h.write_text(s)
print('Guest access frontend integrated. Auth Anonymous Sign-ins must be enabled separately. RLS and ownership remain server-controlled.')
