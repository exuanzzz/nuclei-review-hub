"""Install public self-registration UI and guarded first-login enrollment.
Database migration 05 is separate: this build does not access Supabase or any data.
"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
p = ROOT / 'site/js/cloud.js'
s = p.read_text()
if 'public-self-registration-v1' not in s:
    old = "async function me(){if(!session)return null;const user=await request('/auth/v1/user');const rows=await rest('nr_members','user_id=eq.'+encodeURIComponent(user.id)+'&select=*');if(!rows.length)throw Error('Your account is signed in, but has not been added to this review workspace. Ask its administrator.');return {...rows[0],email:user.email};}"
    new = r'''// public-self-registration-v1: authenticate first, then ask the guarded server RPC.
async function me(){
 if(!session)return null;
 const user=await request('/auth/v1/user'),q='user_id=eq.'+encodeURIComponent(user.id)+'&select=*';
 let rows=await rest('nr_members',q);
 if(!rows.length){
  try{await rpc('nr_join_open_workspace',{});}
  catch(e){if(e.status===404||/Could not find.*nr_join_open_workspace|function.*nr_join_open_workspace.*does not exist/i.test(e.message))throw Error('Your account is signed in, but automatic joining is not installed. Ask the administrator to apply database update 05.');throw e;}
  rows=await rest('nr_members',q);
 }
 if(!rows.length||rows[0].active!==true)throw Error('Your workspace access is not active. Contact the administrator.');
 return {...rows[0],email:user.email};
}
async function registrationStatus(){
 if(!configured)throw Error('Cloud registration is not configured.');
 const r=await fetch(url+'/rest/v1/rpc/nr_registration_status',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}',cache:'no-store'});
 if(r.status===404)return {enabled:false,setupRequired:true};
 return parseResponse(r);
}
async function emailRegistrationSettings(){
 if(!configured)throw Error('Cloud registration is not configured.');
 return parseResponse(await fetch(url+'/auth/v1/settings',{headers:{apikey:key},cache:'no-store'}));
}
function registrationEmail(email){
 const e=String(email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw Error('Enter a valid email address.');return e;
}
async function signUp(email,password,displayName){
 const e=registrationEmail(email),name=String(displayName||'').trim();
 if(!name||name.length>80)throw Error('Use a display name between 1 and 80 characters.');
 if(typeof password!=='string'||password.length<12)throw Error('Use at least 12 characters for your password.');
 const [status,settings]=await Promise.all([registrationStatus(),emailRegistrationSettings()]);
 if(status.enabled!==true)throw Error(status.setupRequired?'Registration setup is not complete. Ask the administrator to apply database update 05.':'Public registration is currently paused.');
 if(settings.disable_signup===true||settings.external?.email===false)throw Error('Email registration is disabled in Supabase. The administrator must enable email signups.');
 if(settings.mailer_autoconfirm===true)throw Error('Email confirmation is disabled in Supabase. The administrator must turn Confirm email ON before public registration is used.');
 // Redirect only to this deployed application's own path. No user-controlled target.
 const redirect=location.origin+location.pathname;
 const result=await auth('signup?redirect_to='+encodeURIComponent(redirect),{email:e,password,data:{display_name:name}});
 // Confirm-email signup normally has no session. Do not persist a surprise auto-confirm session.
 if(result?.access_token)throw Error('Registration returned an immediate session. Ask the administrator to verify the Confirm email setting, then confirm your mailbox before signing in.');
 return {confirmationRequired:true};
}
async function resendConfirmation(email){
 return auth('resend?redirect_to='+encodeURIComponent(location.origin+location.pathname),{type:'signup',email:registrationEmail(email)});
}'''
    if s.count(old) != 1: raise RuntimeError('Unexpected membership client; refusing an unreviewed replacement.')
    s = s.replace(old, new)
    export = 'root.ReviewCloud={configured,url,signIn,sendLink,me,'
    if s.count(export) != 1: raise RuntimeError('Unexpected client export.')
    s = s.replace(export, 'root.ReviewCloud={configured,url,signIn,signUp,registrationStatus,emailRegistrationSettings,resendConfirmation,sendLink,me,')
    old_redirect = "async function restoreRedirect(){const p=new URLSearchParams(location.hash.slice(1));if(p.has('access_token'))"
    new_redirect = "async function restoreRedirect(){const p=new URLSearchParams(location.hash.slice(1));if(p.has('error')){const message=p.get('error_description')||p.get('error');history.replaceState(null,'',location.pathname+location.search);throw Error('Email confirmation or sign-in link failed: '+message);}if(p.has('access_token'))"
    if s.count(old_redirect) != 1: raise RuntimeError('Unexpected redirect handler.')
    s=s.replace(old_redirect,new_redirect)
    p.write_text(s)
h=ROOT/'site/index.html';text=h.read_text()
if 'js/signup-ui.js' not in text:
    text=text.replace('</body>', '<script src="js/signup-ui.js"></script>\n</body>')
    h.write_text(text)
print('Public registration UI installed; existing data, memberships and RLS are unchanged until migration 05 is applied.')

# Remove obsolete invitation-only wording; backend rules still decide joining.
h=ROOT/'site/index.html';text=h.read_text()
text=text.replace('>Invite-only data<', '>Sign-in required<').replace('<h2>Invite-only workspace</h2>', '<h2>Workspace members</h2>').replace('PRIVATE TEAM ACCESS', 'WORKSPACE ACCESS')
h.write_text(text)
a=ROOT/'site/js/app.js';a.write_text(a.read_text().replace('Only previously invited Auth accounts can receive this link.', 'Only existing Auth accounts can receive this link.'))
u=ROOT/'site/js/signup-ui.js';t=u.read_text();t=t.replace('submit.disabled=!available||sending;\n }', 'submit.disabled=!available||sending;mailControls();\n }');u.write_text(t)
