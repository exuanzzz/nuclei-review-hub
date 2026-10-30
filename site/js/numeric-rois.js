/* Numeric Fiji ROI archives. Matching is a filename suggestion, never biological
 * evidence. Confirm numeric/manual pairings before saving. Source bytes and ROI
 * coordinates are not renamed, rescaled, fitted, or rewritten. */
(function(root){
'use strict';
const D=root.ReviewData,R=root.ROIReview,C=root.GTCore;
const hidden=p=>p.split('/').some(x=>x==='__MACOSX'||x.startsWith('.'));
const integer=s=>s.replace(/^0+(?=\d)/,'');
function archiveStem(path){return R.sampleKey(D.base(path).replace(/\.zip$/i,'').replace(/_rois?$/i,''));}
function imageNumber(key){const m=key.match(/(?:^|[_ .-])(\d+)$/);return m?integer(m[1]):null;}
function archiveNumber(path){const s=archiveStem(path);return /^\d+$/.test(s)?integer(s):null;}
function candidates(archive,images){
 const exact=images.filter(x=>x.key===archiveStem(archive.name));
 if(exact.length)return {rows:exact,rule:'name'};
 const n=archiveNumber(archive.name);
 return {rows:n===null?[]:images.filter(x=>imageNumber(x.key)===n),rule:'number'};
}
async function entries(files,isFolder=false){
 let expanded=0,bytes=0;const result=[];
 async function visit(e,depth){
  e.name=D.safePath(e.name);if(hidden(e.name))return;
  if(++expanded>D.LIMITS.entries)throw Error('Too many input entries. Choose one collection at a time.');
  if(!/\.zip$/i.test(e.name)){bytes+=e.size||0;if(bytes>D.LIMITS.totalBytes)throw Error('Inputs exceed 2 GiB. Import a smaller collection.');result.push(e);return;}
  if(depth>3)throw Error('Nested ZIP depth exceeds 3: '+e.name);
  let children;try{children=await C.zipEntries(new Blob([await e.bytes()]));}catch(err){throw Error(e.name+': cannot open ZIP: '+err.message);}
  children=children.filter(x=>!hidden(x.name));
  const rois=children.filter(x=>/\.roi$/i.test(x.name));
  const containers=children.some(x=>/\.(?:tiff?|png|zip)$/i.test(x.name));
  if((rois.length&&!containers)||(!children.length&&/_rois\.zip$/i.test(e.name))){
   if(rois.length>D.LIMITS.objects)throw Error('Too many ROIs in '+e.name);
   if(e.size>D.LIMITS.fieldBytes)throw Error('ROI ZIP exceeds the field size limit: '+e.name);
   e.roiArchive=true;e.roiCount=rois.length;bytes+=e.size||0;
   if(bytes>D.LIMITS.totalBytes)throw Error('Inputs exceed 2 GiB. Import a smaller collection.');
   result.push(e);return;
  }
  if(_standard(e.name))throw Error(e.name+': expected a Fiji ROI ZIP containing .roi files.');
  // Dataset ZIPs expand; leaf ROI ZIPs retain their exact original bytes and name.
  const prefix=e.name.replace(/\.zip$/i,'');
  for(const child of children)await visit({...child,name:prefix+'/'+D.safePath(child.name)},depth+1);
 }
 for(const f of files)await visit(D.entry(f),0);
 return D.checkedEntries(result);
}
function _standard(name){return /_rois\.zip$/i.test(name);}
function plan(input){
 const images=input.filter(e=>/\.tiff?$/i.test(e.name)).map(e=>({key:R.sampleKey(e.name),name:D.base(e.name).replace(/\.tiff?$/i,''),image:e}));
 const archives=input.filter(e=>e.roiArchive),issues=[];
 const keys=new Set();for(const image of images){if(keys.has(image.key))throw Error('More than one TIFF has the image name '+image.key+'. Import the collections separately; no image was guessed.');keys.add(image.key);}
 images.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
 const suggestions=new Map(images.map(x=>[x.key,[]]));
 archives.forEach((a,i)=>{const c=candidates(a,images);if(c.rows.length===1)suggestions.get(c.rows[0].key).push({index:i,rule:c.rule});else issues.push(a.name+(c.rows.length?' matches several images; select its image manually.':' has no unique filename match; select its image manually.'));});
 const rows=images.map(x=>{const s=suggestions.get(x.key);if(s.length>1)issues.push(x.name+': multiple ROI ZIPs could belong here; choose one.');return {...x,archive:s.length===1?s[0].index:-1,rule:s.length===1?s[0].rule:'manual'};});
 const loose=input.filter(e=>/\.roi$/i.test(e.name));
 if(loose.length)issues.push(loose.length+' loose .roi files are individual regions, not image IDs. Save each image\'s ROI set as a ZIP in Fiji; loose files will not be assigned automatically.');
 const used=new Set(rows.map(x=>x.archive).filter(x=>x>=0));
 const review=archives.some(a=>archiveNumber(a.name)!==null||!_standard(a.name)||a.roiCount===0)||issues.length>0||(archives.length>0&&rows.some(x=>x.archive<0))||used.size<archives.length;
 return {rows,archives,issues,review:!!review,loose:loose.map(e=>e.name)};
}
function addLocalImages(input,local){
 const archives=input.filter(e=>e.roiArchive),present=input.filter(e=>/\.tiff?$/i.test(e.name)).map(image=>({key:R.sampleKey(image.name),image}));
 for(const archive of archives){
  if(candidates(archive,present).rows.length)continue;
  const possible=candidates(archive,local.filter(r=>r.kind==='fiji')).rows;
  const unique=new Map(possible.map(r=>[r.key+'|'+(r.image.sourceHash||r.image.name),r]));
  if(unique.size===1){const r=[...unique.values()][0];if(!present.some(x=>x.key===r.key)){input.push(r.image);present.push({key:r.key,image:r.image});}}
 }
 return input;
}
function records(p,choices,includeMissing){
 const assigned=new Set();
 return p.rows.flatMap((row,i)=>{
  const chosen=Number(choices[i]);if(chosen!==-1&&(!Number.isInteger(chosen)||chosen<0||chosen>=p.archives.length))throw Error('Invalid ROI selection.');
  if(chosen>=0&&assigned.has(chosen))throw Error('The same ROI ZIP is assigned twice. Each image must have its own confirmed archive.');
  if(chosen>=0)assigned.add(chosen);if(chosen<0&&!includeMissing)return [];
  return [{key:row.key,name:row.name,kind:'fiji',image:row.image,annotations:chosen<0?[]:[p.archives[chosen]],error:'',objects:null}];
 });
}
let dialog,resolveDialog,lastPairing=null;
function ui(){
 if(dialog)return;const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 dialog=el('dialog');dialog.id='roiPairingDialog';dialog.style.cssText='width:min(1000px,95vw);max-height:92vh';
 dialog.append(el('h2','Match ROI ZIPs to images'),el('p','Numeric filenames are supported. Suggestions use the final image number, never the list position. Check every pair. You can change any selection below. Nothing is uploaded by this step.'));
 const notice=el('pre');notice.id='roiPairingIssues';notice.style.cssText='white-space:pre-wrap;font-size:11px;max-height:90px;overflow:auto';dialog.append(notice);
 const body=el('div');body.id='roiPairingRows';body.style.cssText='max-height:45vh;overflow:auto';dialog.append(body);
 const summary=el('p');summary.id='roiPairingSummary';summary.setAttribute('role','status');dialog.append(summary);
 const missing=el('label'),include=el('input');include.type='checkbox';include.id='roiIncludeMissing';missing.append(include,document.createTextNode(' Also import images without a matched ROI ZIP (image only)'));dialog.append(missing);
 const ack=el('label'),confirm=el('input');confirm.type='checkbox';confirm.id='roiPairingConfirmed';ack.style.cssText='display:block;margin:12px 0';ack.append(confirm,document.createTextNode(' I checked the image-to-ZIP pairs. Unassigned ZIPs and loose .roi files will not be imported.'));dialog.append(ack);
 const actions=el('div');actions.className='actions';const cancel=el('button','Cancel'),save=el('button','Use these pairings'),report=el('button','Download pairing report');cancel.type=save.type=report.type='button';cancel.id='cancelRoiPairing';save.id='confirmRoiPairing';save.className='primary';report.id='downloadRoiPairing';actions.append(cancel,report,save);dialog.append(actions);document.body.append(dialog);
 const finish=result=>{dialog.close();const done=resolveDialog;resolveDialog=null;done?.(result);};cancel.onclick=()=>finish(null);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
 dialog.finish=finish;
 report.onclick=()=>{if(!lastPairing)return;const a=el('a'),url=URL.createObjectURL(new Blob([JSON.stringify(lastPairing,null,2)],{type:'application/json'}));a.href=url;a.download='roi_image_pairing.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
}
async function pair(input){
 const p=plan(input);if(!p.rows.length)throw Error('No matching TIFF images. Select the image(s) together with the ROI ZIP(s).');
 if(!p.review)return {records:records(p,p.rows.map(x=>x.archive),true),issues:[]};
 ui();const $=id=>document.getElementById(id),selects=[];$('roiPairingIssues').textContent=p.issues.join('\n');$('roiPairingRows').replaceChildren();$('roiPairingConfirmed').checked=false;$('roiIncludeMissing').checked=p.archives.length===0;
 for(const row of p.rows){const line=document.createElement('div');line.style.cssText='display:grid;grid-template-columns:minmax(130px,1fr) minmax(160px,1fr);gap:12px;padding:10px 0;border-bottom:1px solid #dde5de';
  const name=document.createElement('div');name.textContent=row.image.name;name.style.cssText='font-size:12px;overflow-wrap:anywhere';
  const select=document.createElement('select');select.className='roi-pairing-select';select.setAttribute('aria-label','ROI ZIP for '+row.name);select.add(new Option('No annotation / image only','-1'));
  p.archives.forEach((a,i)=>select.add(new Option(a.name+' ('+a.roiCount+' ROIs)',String(i))));select.value=String(row.archive);selects.push(select);line.append(name,select);$('roiPairingRows').append(line);
 }
 function update(){
  const choices=selects.map(s=>Number(s.value)),used=choices.filter(x=>x>=0),duplicate=new Set(used).size!==used.length,missing=choices.length-used.length;
  $('roiPairingSummary').textContent=`${used.length} images have ROI ZIPs; ${missing} images have no ZIP; ${p.archives.length-new Set(used).size} ZIPs unassigned.`+(duplicate?' ERROR: one ZIP is selected for multiple images.':'');
  const count=used.length+($('roiIncludeMissing').checked?missing:0);$('confirmRoiPairing').disabled=duplicate||!count||!$('roiPairingConfirmed').checked;
  lastPairing={format:'nuclei-roi-pairing-v1',created_at:new Date().toISOString(),mode:'user-confirmation-required',source_files_unchanged:true,list_order_matching:false,images:p.rows.map((r,i)=>({image:r.image.name,roi_zip:choices[i]<0?null:p.archives[choices[i]].name,import:choices[i]>=0||$('roiIncludeMissing').checked})),unused_roi_zips:p.archives.filter((a,i)=>!used.includes(i)).map(a=>a.name),loose_roi_files:p.loose};
 }
 for(const select of selects)select.onchange=()=>{$('roiPairingConfirmed').checked=false;update();};$('roiIncludeMissing').onchange=()=>{$('roiPairingConfirmed').checked=false;update();};$('roiPairingConfirmed').onchange=update;
 $('confirmRoiPairing').onclick=()=>{const output=records(p,selects.map(s=>Number(s.value)),$('roiIncludeMissing').checked);lastPairing.mode='user-confirmed';dialog.finish({records:output,issues:[]});};update();dialog.showModal();return new Promise(r=>{resolveDialog=r;});
}
async function revision(file,imageKey,imageName){
 if(!/\.zip$/i.test(file.name))throw Error('Choose a complete Fiji ROI ZIP, for example 1.zip or an image_rois.zip.');
 const found=await entries([file]);if(found.length!==1||!found[0].roiArchive||!found[0].roiCount)throw Error('Choose one ZIP containing this image\'s .roi regions.');
 if(_standard(file.name)&&archiveStem(file.name)===imageKey)return true;
 return confirm('Attach '+file.name+' ('+found[0].roiCount+' ROIs) as a new annotation version for '+imageName+'?\nConfirm that these regions belong to THIS image. The filename alone cannot prove the association. Original coordinates and older versions are retained.');
}
root.NumericRois={entries,plan,pair,records,addLocalImages,revision,archiveStem,imageNumber,archiveNumber,getReport:()=>lastPairing,version:'numeric-rois-v1'};
})(globalThis);
