/* Self-registration is enabled by the optional SERVER setting, never by a UI role. */
window.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const B = window.ReviewCloud, H = window.Hub, $ = id => document.getElementById(id);
  if (!B?.registrationStatus) return;
  const el = (tag, text) => {const e = document.createElement(tag); if (text) e.textContent = text; return e;};
  const topButton = el('button', 'Create account'); topButton.id = 'signupOpen'; topButton.type = 'button';
  $('loginOpen').after(topButton);
  const fromLogin = el('button', 'Create an account'); fromLogin.id = 'signupFromLogin'; fromLogin.type = 'button'; fromLogin.className = 'quiet';
  const loginNote = el('p'); loginNote.id = 'registrationAvailability'; loginNote.className = 'small';
  $('loginDialog').append(fromLogin, loginNote);
  $('loginDialog').querySelector('p').textContent = 'Sign in with your review account. New users can create their own account when self-registration is enabled by this workspace.';
  const dialog = el('dialog'); dialog.id = 'signupDialog';
  const close = el('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close registration');
  const closer = el('div'); closer.className = 'dialog-close'; closer.append(close);
  const title = el('h2', 'Create your review account');
  const intro = el('p', 'Confirm your email, then sign in. You will join as a Contributor, without manual approval. All published collections are shared with workspace members; local libraries stay on each device.');
  const form = el('form'); form.id = 'signupForm';
  function field(name, id, type, autocomplete) {const label = el('label', name), input = el('input'); input.id = id; input.type = type; input.autocomplete = autocomplete; input.required = true; label.append(input); form.append(label); return input;}
  const name = field('Display name', 'signupName', 'text', 'nickname'); name.maxLength = 80;
  const email = field('Email', 'signupEmail', 'email', 'email'); email.maxLength = 254;
  const password = field('Password (at least 12 characters)', 'signupPassword', 'password', 'new-password'); password.minLength = 12;
  const repeat = field('Confirm password', 'signupPasswordAgain', 'password', 'new-password'); repeat.minLength = 12;
  const ackLabel = el('label'), ack = el('input'); ack.type = 'checkbox'; ack.required = true; ack.id = 'signupAgreement';
  ackLabel.style.display = 'flex'; ackLabel.style.gap = '8px';
  ackLabel.append(ack, el('span', 'I understand that published uploads are shared with all workspace members. I will only upload data I am authorized to share.')); form.append(ackLabel);
  const submit = el('button', 'Create account'); submit.type = 'submit'; submit.className = 'primary'; submit.id = 'signupSubmit'; form.append(submit);
  const message = el('p'); message.id = 'signupMessage'; message.setAttribute('role', 'status'); message.style.whiteSpace = 'pre-wrap';
  const back = el('button', 'Back to sign in'); back.type = 'button'; back.id = 'signupBack';
  dialog.append(closer, title, intro, form, message, back); document.body.append(dialog);
  let submitting = false, checking = false, mode = {enabled: false};
  function visibility() {topButton.classList.toggle('hidden', !!H.getUser() || !B.configured); topButton.disabled = checking; fromLogin.disabled = checking;}
  async function status() {
    checking = true; visibility();
    try {
      mode = await B.registrationStatus();
      loginNote.textContent = mode.enabled ? 'Self-registration is open. New members join as Contributors after email confirmation and sign-in.' : 'Self-registration is not enabled yet. Existing members can sign in; the administrator must complete the one-time setup.';
      document.querySelector('.privacy-dot').textContent = mode.enabled ? 'Account-only shared data' : 'Invite-only data';
    } catch (e) {mode = {enabled:false}; loginNote.textContent = 'Unable to check registration availability. Existing accounts can still sign in.';}
    finally {checking = false; visibility();}
    return mode;
  }
  async function open() {
    await status();
    if (!mode.enabled) {if (!$('loginDialog').open) $('loginDialog').showModal(); return;}
    if ($('loginDialog').open) $('loginDialog').close();
    email.value = $('email').value; message.textContent = ''; form.classList.remove('hidden');
    if (!dialog.open) dialog.showModal(); name.focus();
  }
  topButton.onclick = fromLogin.onclick = () => open().catch(e => H.toast(e.message));
  const clearSecret = () => {password.value = ''; repeat.value = '';};
  close.onclick = () => {if (!submitting) {dialog.close(); clearSecret();}};
  dialog.addEventListener('cancel', e => {if (submitting) e.preventDefault(); else clearSecret();});
  back.onclick = () => {if (submitting) return; $('email').value = email.value; dialog.close(); clearSecret(); $('loginDialog').showModal();};
  form.onsubmit = async e => {
    e.preventDefault(); if (submitting) return;
    if (password.value !== repeat.value) {message.textContent = 'The passwords do not match.'; return;}
    if (!form.reportValidity()) return;
    submitting = true; submit.disabled = close.disabled = back.disabled = true;
    message.textContent = 'Creating your account…';
    try {
      await B.signUp(email.value.trim(), password.value, name.value.trim());
      clearSecret(); form.classList.add('hidden'); $('email').value = email.value.trim();
      message.textContent = 'Check your inbox and spam folder for a confirmation email. If this address is eligible for registration, follow the confirmation link, then sign in here. Already registered? Use your existing password. No team data is stored in this registration form.';
    } catch (error) {
      let text = error.message || String(error);
      if (/email.*not authorized|smtp|sending confirmation email/i.test(text)) text += '\nThe administrator needs to configure custom SMTP for external email addresses. Do not disable email verification to work around this.';
      if (/rate.limit|too many|security purposes/i.test(text)) text += '\nPlease wait before trying again; do not repeatedly submit the form.';
      message.textContent = text;
    } finally {submitting = false; submit.disabled = close.disabled = back.disabled = false;}
  };
  new MutationObserver(visibility).observe($('userLabel'), {childList:true});
  window.addEventListener('nr:state', visibility);
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('error_description')) {
    H.toast('Email confirmation: ' + params.get('error_description'));
    history.replaceState(null, '', location.pathname + location.search);
  }
  status();
  window.RegistrationUI = {status, open};
});
