"""Build after the existing workspace/signup integrations. No production connections.
Adds optional no-email signup and uploads to an existing published collection.
Database update 06 is deliberately applied separately by the project owner.
"""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def edit(path,fn):
 p=ROOT/path;s=p.read_text()
 if 'flexible-upload-v1' in s:return
 p.write_text(fn(s))
def replace(s,a,b):
 if s.count(a)!=1:raise RuntimeError('Unexpected source: '+a[:160])
 return s.replace(a,b)
def cloud(s):
 s=replace(s,"if(settings.mailer_autoconfirm===true)throw Error(","if(status.email_confirmation_required!==false && settings.mailer_autoconfirm===true)throw Error(")
 s=replace(s,"if(result?.access_token)throw Error('Registration returned an immediate session. Ask the administrator to verify the Confirm email setting, then confirm your mailbox before signing in.');", """// flexible-upload-v1: Auth supplies the session; metadata never supplies a role.
 if(result?.access_token){
  if(status.email_confirmation_required!==false)throw Error('Registration returned an immediate session. Ask the administrator to verify the Confirm email setting, then confirm your mailbox before signing in.');
  authEpoch++;setSession(result);return {confirmationRequired:false,signedIn:true};
 }""")
 return s
edit('site/js/cloud.js',cloud)
def signup(s):
 s=replace(s,'let sending=false,available=false,', 'let noEmail=false,sending=false,available=false,')
 old="try{const s=await B.registrationStatus();available=s.enabled===true;status.textContent=available?'Open registration · email confirmation required · default role: Contributor':s.setupRequired?'The administrator has not installed registration update 05 yet. Existing members can still sign in.':'New registrations and automatic joining are currently paused. Existing members can still sign in.';}"
 new="""try{const s=await B.registrationStatus();available=s.enabled===true;
   const a=available?await B.emailRegistrationSettings():{};noEmail=s.email_confirmation_required===false&&a.mailer_autoconfirm===true;
   $('magicLink').hidden=noEmail;
   status.textContent=available?(noEmail?'Open registration · no confirmation email · default role: Contributor':'Open registration · email confirmation required · default role: Contributor'):s.setupRequired?'The administrator has not installed registration update 05 yet. Existing members can still sign in.':'New registrations and automatic joining are currently paused. Existing members can still sign in.';
   intro.textContent=noEmail?'Choose a display name, email and password. Register and join automatically. The email is a login identifier, not verified proof of identity. No email-based password recovery is provided by this mode.':'Use your own email and password. Confirm your email, then sign in to join automatically as a Contributor. No invitation or individual approval is required.';
  }"""
 s=replace(s,old,new)
 s=replace(s,'function mailControls(){const seconds=',"function mailControls(){resend.hidden=noEmail;const seconds=")
 s=replace(s,"try{await B.signUp(email.value,password.value,name.value);cleaned();nextResend=Date.now()+60000;message.textContent=", """// flexible-upload-v1
  try{const result=await B.signUp(email.value,password.value,name.value);cleaned();
   if(result.signedIn){
    message.textContent='Account created. Opening the shared workspace…';
    try{await H.loadShared();dialog.close();H.setScope('shared');H.toast('Account created. You joined as a Contributor.');}
    catch(e){message.textContent='Account created, but workspace access could not be opened: '+e.message+' Use Sign in to retry; do not register again.';}
    return;
   }
   nextResend=Date.now()+60000;message.textContent=""")
 s=s.replace('Verified users join as Contributors','Eligible signed-in users join as Contributors').replace('Allow any email-confirmed user to join as a Contributor','Allow any eligible signed-in user to join as a Contributor')
 s=s.replace("'public-self-registration-v1'","'flexible-upload-v1'")
 s=s.replace('New users can create an account and confirm their email; workspace access is checked by the server.', 'New users can create an account. The registration form shows whether email confirmation is required. Workspace access is checked by the server.')
 s=replace(s,'window.addEventListener(\'nr:state\',sync);sync();',"""window.addEventListener('nr:state',sync);sync();
 // Local-only browsing makes no authentication configuration requests.
 new MutationObserver(()=>{
  if(!$('loginDialog').open)return;
  Promise.all([B.registrationStatus(),B.emailRegistrationSettings()]).then(([r,a])=>{
   $('magicLink').hidden=r.email_confirmation_required===false&&a.mailer_autoconfirm===true;
  }).catch(()=>{});
 }).observe($('loginDialog'),{attributes:true,attributeFilter:['open']});""")
 return s
edit('site/js/signup-ui.js',signup)
def app(s):
 s=replace(s,"for(const c of collections)if(c.state==='draft'&&!c.trashed_at&&c.owner_id===user?.user_id&&c.kind===kind)options.push(new Option('Resume draft: '+c.title+' · '+c.id.slice(0,8),c.id));", """for(const c of collections)if(!c.trashed_at&&c.kind===kind){
  if(c.state==='draft'&&c.owner_id===user?.user_id)options.push(new Option('Resume draft: '+c.title+' · '+c.id.slice(0,8),c.id));
  else if(c.state==='ready'&&(c.owner_id===user?.user_id||user?.role==='admin'))options.push(new Option('Add to existing: '+c.title+' · '+c.id.slice(0,8),c.id));
 }""")
 s=s.replace("'Only checked cards are published. Filtering does not cancel hidden selections. Use Deselect all or Select shown only. To continue an earlier upload, choose Resume draft.'", "'Choose New collection, Resume draft, or Add to existing. Existing images and reviews stay unchanged. A filename already in use is never silently replaced.'")
 s=replace(s,'setBusy(true);let added=0,duplicates=0;', 'setBusy(true);let added=0,duplicates=0,importDone=false;const importedIds=[];')
 s=replace(s,"const previousGroup=local.find(r=>r.localMeta?.title===localInfo.title&&r.localMeta?.kind===localInfo.kind&&r.localMeta?.description===localInfo.description);if(previousGroup)localInfo.group=previousGroup.localMeta.group;", """const explicitTarget=root.CollectionFiles?.resolve();if(explicitTarget)localInfo={...explicitTarget};
  const previousGroup=local.find(r=>r.localMeta?.title===localInfo.title&&r.localMeta?.kind===localInfo.kind&&r.localMeta?.description===localInfo.description);if(!explicitTarget&&previousGroup)localInfo.group=previousGroup.localMeta.group;""")
 s=replace(s,'const result=await L.save(r,localInfo);if(result.duplicate)', 'const result=await L.save(r,localInfo);importedIds.push(result.record.localId);if(result.duplicate)')
 s=replace(s,"toast('Local copies saved. New imports do not replace your library. Select the fields you want to upload.');L.protect().then(emitState);", "importDone=true;toast('Local copies saved. Select files and confirm Publish to share.');L.protect().then(emitState);")
 s=replace(s,'finally{syncCollectionFilter();renderGrid();setBusy(false);}', 'finally{syncCollectionFilter();renderGrid();setBusy(false);if(importDone)await root.CollectionFiles?.imported(localInfo,importedIds);}')
 s=replace(s,'async function resumeWork(collection,list){', 'async function resumeWork(collection,list,append=false){')
 s=replace(s,"if(!c||c.state!=='draft'||c.trashed_at||c.owner_id!==user.user_id)throw Error('Only your accessible unfinished collection can be resumed.');", """if(!c||c.trashed_at||c.state!==(append?'ready':'draft')||!(c.owner_id===user.user_id||(append&&user.role==='admin')))throw Error('Choose an accessible collection owned by you; administrators may append to published collections.');""")
 s=s.replace("'Draft source image does not match: '","'An active image with different pixels already uses this name: '")
 s=s.replace("'Draft annotations differ from these selected files: '","'Active annotations differ from these selected files: '")
 s=s.replace("'. Resume with the original files, or publish a separate collection.'", "'. Use Upload revised ROI ZIP on that image, or move it to Trash before adding a replacement. No old version was overwritten.'")
 s=replace(s,"if(info.groups!==1)throw Error('Select fields from one local collection per upload. Use the collection filter and Select shown only. You can remove or back up fields across collections.');localInfo={...info.info};", """const chosen=collections.find(c=>c.id===W.destination());
   if(info.groups!==1&&!chosen)throw Error('Choose one local collection for a new upload, or choose an existing destination.');
   localInfo={...info.info,...(chosen?{title:chosen.title,kind:chosen.kind,description:chosen.description}:{})};""")
 s=replace(s,"const resumed=dest?await resumeWork(dest,list):null;", "const append=!!dest&&collections.find(c=>c.id===dest)?.state==='ready';const resumed=dest?await resumeWork(dest,list,append):null;")
 s=replace(s,"batch={id:dest||uuid(),list,title:","batch={id:dest||uuid(),mode:append?'append':'new',list,title:")
 s=replace(s,"if(existing?.state==='ready'){", "if(existing?.state==='ready'&&batch.mode!=='append'){")
 s=replace(s,'const resumed=await resumeWork(batch.id,batch.list);',"const resumed=await resumeWork(batch.id,batch.list,batch.mode==='append');")
 s=replace(s,"if(!work.field)work.field=(await B.insert('nr_fields',{id:uuid(),collection_id:batch.id,source_key:r.key,name:r.name,width:d.w,height:d.h,image_sha256:d.sha}))[0];", """if(!work.field){
    if(batch.mode==='append'){
     try{const result=await B.rpc('nr_prepare_collection_field',{p_collection:batch.id,p_id:uuid(),p_key:r.key,p_name:r.name,p_width:d.w,p_height:d.h,p_sha:d.sha});work.field=Array.isArray(result)?result[0]:result;}
     catch(e){if(e.status===404)throw Error('Apply database update 06 before adding to existing collections. Local files remain saved.');throw e;}
     if(!work.field?.id)throw Error('No image record returned. Nothing was overwritten.');
     const reconciled=await resumeWork(batch.id,[r],true);if(reconciled.work[r.key])Object.assign(work,reconciled.work[r.key]);
     if(work.complete){batch.index++;await journal();continue;}
    }else work.field=(await B.insert('nr_fields',{id:uuid(),collection_id:batch.id,source_key:r.key,name:r.name,width:d.w,height:d.h,image_sha256:d.sha}))[0];
   }""")
 s=replace(s,"currentName='collection '+batch.title;await B.rpc('nr_publish_collection',{p_id:batch.id});", "currentName='collection '+batch.title;if(batch.mode!=='append')await B.rpc('nr_publish_collection',{p_id:batch.id});")
 s=s.replace('Collection published to team storage.', 'Selected images published; existing collection images and reviews retained.')
 return s+'\n// flexible-upload-v1\n'
edit('site/js/app.js',app)
h=ROOT/'site/index.html';text=h.read_text()
if 'js/collection-files.js' not in text:text=text.replace('</body>','<script src="js/collection-files.js"></script>\n</body>')
h.write_text(text)
# A Local collection target should not inherit an earlier cloud destination.
p=ROOT/'site/js/collection-files.js';s=p.read_text();s=s.replace('targetMap.set(key,{...g});','targetMap.set(key,{...g,destination:undefined});');p.write_text(s)
print('Optional email flow and additive uploads integrated; backend is unchanged until update 06 is run.')
