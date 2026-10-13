/* Public signup uses Supabase Auth. Membership is granted only by the guarded
 * nr_join_open_workspace RPC after server-verified email confirmation.
 * No password, token, source file or role is saved by this UI in the local library. */
window.addEventListener('DOMContentLoaded', () => {
 'use strict';
 const B=window.ReviewCloud,H=window.Hub,$=id=>document.getElementById(id);
 if(!B?.signUp||!H)return;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const button=(id,text)=>{const b=el('button',text);b.id=id;b.type='button';return b;};
 const dialog=el('dialog');dialog.id='signupDialog';dialog.style.width='min(540px,94vw)';
 const close=button('closeSignup','×');close.setAttribute('aria-label','Close registration');
 const closeBar=el('div');closeBar.className='dialog-close';closeBar.append(close);
 const title=el('h2','Create your account'),intro=el('p','Use your own email and password. Confirm your email, then sign in to join automatically as a Contributor. No invitation or individual approval is required.');
 const status=el('p');status.id='signupStatus';status.className='small';status.setAttribute('role','status');
 const form=el('form');form.id='signupForm';
 function field(id,label,type,autocomplete){const l=el('label',label),i=el('input');i.id=id;i.type=type;i.required=true;i.autocomplete=autocomplete;l.append(i);form.append(l);return i;}
 const name=field('signupName','Display name','text','name');name.maxLength=80;
 const email=field('signupEmail','Email','email','email');
 const password=field('signupPassword','Password (at least 12 characters)','password','new-password');password.minLength=12;
 const repeat=field('signupRepeat','Confirm password','password','new-password');repeat.minLength=12;
 const disclosure=el('label'),agree=el('input');agree.type='checkbox';agree.id='signupConsent';agree.required=true;
 disclosure.style.cssText='display:flex;align-items:flex-start;gap:9px;font-size:12px;line-height:1.6';
 disclosure.append(agree,el('span','I understand that all registered workspace members can view published images and feedback. I will only publish data I am allowed to share. Local files stay on my own device unless I publish them.'));
 form.append(disclosure);
 const submit=el('button','Create account');submit.id='submitSignup';submit.type='submit';submit.className='primary';submit.disabled=true;form.append(submit);
 const message=el('p');message.id='signupMessage';message.className='small';message.setAttribute('role','status');
 const resend=button('resendSignup','Resend confirmation email'),back=button('backToSignin','Back to sign in');
 resend.className=back.className='quiet';resend.disabled=true;
 dialog.append(closeBar,title,intro,status,form,message,resend,back);document.body.append(dialog);
 const open=button('signupOpen','Create account');open.className='primary';$('loginOpen').after(open);
 const loginCreate=button('signupFromLogin','Create an account');loginCreate.className='quiet';$('loginDialog').append(loginCreate);
 const loginIntro=$('loginDialog').querySelector('p');if(loginIntro)loginIntro.textContent='Sign in with your own account. New users can create an account and confirm their email; workspace access is checked by the server.';
 const adminBox=el('section');adminBox.id='publicRegistrationAdmin';adminBox.className='passwordbox hidden';
 const adminStatus=el('p'),toggle=button('togglePublicRegistration','Checking registration…');adminBox.append(el('h3','Public registration'),adminStatus,toggle);$('teamDialog').append(adminBox);
 let sending=false,available=false,nextResend=0,adminEnabled=false,timer=null;
 function cleaned(){password.value='';repeat.value='';}
 function sync(){const signed=!!H.getUser();open.classList.toggle('hidden',signed);open.disabled=H.isBusy();adminBox.classList.toggle('hidden',H.getUser()?.role!=='admin');}
 async function checkStatus(){
  submit.disabled=true;status.textContent='Checking public registration…';available=false;
  try{const s=await B.registrationStatus();available=s.enabled===true;status.textContent=available?'Open registration · email confirmation required · default role: Contributor':s.setupRequired?'The administrator has not installed registration update 05 yet. Existing members can still sign in.':'New registrations and automatic joining are currently paused. Existing members can still sign in.';}
  catch(e){status.textContent='Unable to check registration: '+e.message;}
  submit.disabled=!available||sending;
 }
 async function showSignup(){if(H.isBusy())return;if($('loginDialog').open)$('loginDialog').close();message.textContent='';cleaned();if(!dialog.open)dialog.showModal();await checkStatus();}
 open.onclick=loginCreate.onclick=()=>showSignup().catch(e=>H.toast(e.message));
 close.onclick=()=>{if(!sending){cleaned();dialog.close();}};
 dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault();else cleaned();});
 back.onclick=()=>{if(sending)return;cleaned();dialog.close();$('email').value=email.value;if(!$('loginDialog').open)$('loginDialog').showModal();};
 function mailControls(){const seconds=Math.max(0,Math.ceil((nextResend-Date.now())/1000));resend.disabled=sending||!available||seconds>0;resend.textContent=seconds?`Resend confirmation in ${seconds}s`:'Resend confirmation email';clearTimeout(timer);if(seconds)timer=setTimeout(mailControls,1000);}
 function nice(e){const m=e.message||String(e);if(/email address.*not authorized|not.*allowed.*email|error sending.*email/i.test(m))return m+' The site administrator needs to check custom SMTP email delivery. Do not disable email confirmation.';if(e.status===429)return 'Too many requests. Please wait before trying again.';return m;}
 form.onsubmit=async e=>{
  e.preventDefault();if(sending||!available)return;if(password.value!==repeat.value){message.textContent='The two passwords do not match.';return;}
  if(!agree.checked)return;
  sending=true;submit.disabled=true;close.disabled=back.disabled=true;message.textContent='Sending registration request…';
  try{await B.signUp(email.value,password.value,name.value);cleaned();nextResend=Date.now()+60000;message.textContent='Request accepted. If this email is eligible, check your inbox and spam folder for a confirmation link. Confirm your email, then sign in: you will join automatically. Already registered? Use Sign in instead.';}
  catch(err){message.textContent=nice(err);}
  finally{sending=false;submit.disabled=!available;close.disabled=back.disabled=false;mailControls();}
 };
 resend.onclick=async()=>{if(sending||Date.now()<nextResend)return;sending=true;mailControls();try{await B.resendConfirmation(email.value);nextResend=Date.now()+60000;message.textContent='If this account needs confirmation, a new confirmation email has been requested. Check inbox and spam.';}catch(e){message.textContent=nice(e);}finally{sending=false;mailControls();}};
 async function refreshAdmin(){if(H.getUser()?.role!=='admin')return;toggle.disabled=true;try{const s=await B.registrationStatus();adminEnabled=s.enabled===true;adminStatus.textContent=s.setupRequired?'Apply database migration 05 before using public joining.':adminEnabled?'Public joining is open. Verified users join as Contributors and can access all published collections.':'Public joining is paused. Existing members and data remain unchanged.';toggle.textContent=adminEnabled?'Pause public joining':'Enable public joining';toggle.disabled=!!s.setupRequired;}catch(e){adminStatus.textContent=e.message;}}
 toggle.onclick=async()=>{if(H.getUser()?.role!=='admin'||H.isBusy())return;if(!confirm(adminEnabled?'Pause automatic joining for new members? Existing members keep their access.':'Allow any email-confirmed user to join as a Contributor and view all published collections?'))return;toggle.disabled=true;try{await B.rpc('nr_set_open_registration',{p_enabled:!adminEnabled});await refreshAdmin();}catch(e){adminStatus.textContent=e.message;toggle.disabled=false;}};
 new MutationObserver(()=>{sync();if($('teamDialog').open)refreshAdmin();}).observe($('teamDialog'),{attributes:true,attributeFilter:['open']});
 window.addEventListener('nr:state',sync);sync();
 window.ReviewSignup={show:showSignup,checkStatus,build:'public-self-registration-v1'};
});
