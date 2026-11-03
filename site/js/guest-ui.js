/* Registration-free collaboration. Admin and other-author destructive operations remain protected. */
window.addEventListener('DOMContentLoaded',()=>{
 'use strict';
 const B=window.ReviewCloud,H=window.Hub,$=id=>document.getElementById(id);
 if(!B?.guestEnabled||!B.configured||!H)return;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const btn=(id,text,fn)=>{const b=el('button',text);b.type='button';b.id=id;b.onclick=()=>Promise.resolve(fn()).catch(e=>H.toast(e.message));return b;};
 const banner=el('section');banner.id='guestAccessNotice';banner.className='notice';
 const status=el('span','Connecting as a guest…');status.id='guestAccessMessage';status.setAttribute('role','status');
 const retry=btn('retryGuestAccess','Retry guest access',async()=>{retry.disabled=true;try{await H.loadShared();H.setScope('shared');}catch(e){B.guestNotice('error',e.message);throw e;}finally{retry.disabled=false;}});
 const help=el('p','No email, password or registration. Shared images, annotations and feedback are visible to anyone using this link.');
 banner.append(status,el('br'),help,retry);$('setupNotice').after(banner);
 const nickname=btn('guestNickname','Set nickname',async()=>{
  if(H.isBusy())return;
  const u=H.getUser();if(!u?.is_anonymous)return;
  const name=prompt('Optional display name (not verified identity). Clearing browser data or using another device loses this guest identity.',u.display_name);
  if(name===null)return;
  await B.rpc('nr_set_guest_name',{p_name:name});await H.loadShared();H.toast('Nickname saved for this guest identity.');
 });$('userLabel').after(nickname);
 const admin=el('section');admin.id='guestAccessAdmin';admin.className='passwordbox hidden';
 const admText=el('p'),toggle=btn('toggleGuestAccess','Checking guest access…',async()=>{
  if(H.getUser()?.role!=='admin')return;
  const s=await B.guestAccessStatus();
  if(!confirm(s.enabled?'Pause all anonymous guest access? Permanent members remain signed in.':'Allow visitors without registration to read shared data and collaborate?'))return;
  await B.rpc('nr_set_guest_access',{p_enabled:!s.enabled});await refreshAdmin();
 });admin.append(el('h3','Registration-free guests'),admText,toggle);$('teamDialog').append(admin);
 async function refreshAdmin(){if(H.getUser()?.role!=='admin')return;toggle.disabled=true;try{const s=await B.guestAccessStatus();admText.textContent=s.enabled?'Guests can view shared data, upload, comment, propose revisions and review. Guests cannot grant roles or delete other people’s uploads.':'Guest access is paused. Existing source files are unchanged.';toggle.textContent=s.enabled?'Pause guest access':'Enable guest access';}finally{toggle.disabled=false;}}
 function sync(){
  const u=H.getUser(),guest=u?.is_anonymous===true,adminUser=u?.role==='admin';
  for(const id of ['signupOpen','signupFromLogin']){const e=$(id);if(e)e.classList.add('hidden');}
  $('loginOpen').classList.toggle('hidden',!!u&&!guest);$('loginOpen').textContent='Owner / member sign in';
  $('logout').classList.toggle('hidden',!u||guest);$('logout').textContent='Return to guest';
  nickname.classList.toggle('hidden',!guest);nickname.disabled=H.isBusy();
  admin.classList.toggle('hidden',!adminUser);
  $('openTeam').classList.toggle('hidden',!adminUser);$('openSetup').classList.toggle('hidden',!adminUser);
  if(guest){$('userLabel').textContent=u.display_name+' · guest reviewer';$('connection').textContent='Shared workspace · guest access';}
  const dot=document.querySelector('.privacy-dot');if(dot)dot.textContent='Registration-free collaboration';
  const g=B.getGuestState();
  status.textContent=u?(guest?'You are using a guest identity. No registration required.':'Signed in with your existing account. Guest access is available to visitors.'):(g.message||'Connecting as a guest…');
  retry.hidden=!!u||g.phase==='connecting';
  banner.dataset.state=u?'ready':g.phase;
  const intro=$('loginDialog').querySelector('p');if(intro)intro.textContent='Optional sign-in for an existing owner or member account. Visitors do not need to register. Your device’s guest identity is kept separately.';
  if(guest)$('magicLink').hidden=true;
 }
 window.addEventListener('nr:state',sync);window.addEventListener('nr:guest',sync);
 new MutationObserver(()=>{if($('teamDialog').open)refreshAdmin().catch(e=>H.toast(e.message));}).observe($('teamDialog'),{attributes:true,attributeFilter:['open']});
 const style=el('style');style.textContent='#guestAccessNotice{font-size:12px;margin-bottom:18px}#guestAccessNotice p{margin:5px 0}#guestAccessNotice[data-state="error"]{border:1px solid #ae6c43}#guestAccessNotice button{margin-top:7px}#guestNickname{font-size:11px}';document.head.append(style);
 sync();window.ReviewGuest={build:'guest-workspace-v1',sync};
});
