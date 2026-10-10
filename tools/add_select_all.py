"""Build-time UI-only update. No source annotations, cloud data, or policies change.
Each replacement is guarded; unexpected source versions fail the build.
"""
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'site/js/workspace-ui.js'
s=p.read_text()
if 'explicit-select-all-controls-v1' in s:
    print('Select-all controls already installed.');raise SystemExit(0)
def replace(a,b):
    global s
    n=s.count(a)
    if n!=1:raise RuntimeError(f'Expected one match, got {n}: {a[:120]}')
    s=s.replace(a,b)
replace('Workspace v2 · persistent local library + batch actions','Workspace v2.1 · persistent local library + Select all')
replace("const all=button('selectVisibleFields','Select shown only',()=>H.selectFields('shown')),none=button('clearFieldSelection','Clear selection',()=>H.selectFields('none'));", """// explicit-select-all-controls-v1
// Select all matching records, including cards below the viewport. This never
// clicks Publish, Remove or Trash. Source and authorization rules stay unchanged.
const all=button('selectVisibleFields','Select all',()=>H.selectFields('shown')),none=button('clearFieldSelection','Deselect all',()=>H.selectFields('none'));
all.classList.add('primary');
all.title='Select all images in the current library and filters, including those below the screen. Clear selections outside these filters.';
none.title='Deselect every image in this library, including hidden selections. No files are removed.';
count.setAttribute('aria-live','polite');count.setAttribute('aria-atomic','true');""")
replace("hidden.textContent=off?`${off} selected item(s) are hidden by filters. Actions include ALL selected items.`:'Only checked cards are affected. Importing and uploading do not delete local copies.';", "hidden.textContent=off?`${off} selected item(s) are hidden by filters. Actions include ALL selected items.`:`Select all covers all ${visible.size} matching images, not just those on screen. Then choose Publish, Remove or Trash.`;")
replace("for(const b of [all,none])b.disabled=busy;backup.classList.toggle", "all.textContent=`Select all (${visible.size})`;all.disabled=busy||!visible.size;none.disabled=busy||!rows.length;backup.classList.toggle")
replace("button('select-'+key,'Select mine / permitted',()=>{const c=H.getCurrent();if(!c?.feedback)return;", "button('select-'+key,'Select all',()=>{const c=H.getCurrent();if(!c?.feedback||H.isBusy())return;")
replace("button('clear-'+key,'Clear',()=>{feedSets[key].clear();decorateFeedback();})", "button('clear-'+key,'Deselect all',()=>{if(H.isBusy())return;feedSets[key].clear();decorateFeedback();})")
replace("info.id='selected-'+key;b.append(info,sel,clr,del);", "info.id='selected-'+key;info.setAttribute('aria-live','polite');sel.title='Select all active items in this image version that you are permitted to remove. Administrators can manage all authors; other members can manage their own feedback.';clr.title='Deselect all items in this feedback tab without deleting anything.';b.append(info,sel,clr,del);")
replace("$('selected-'+key).textContent=feedSets[key].size+' selected';$('remove-'+key).disabled=H.isBusy()||!feedSets[key].size;", "const permitted=rows.filter(r=>!r.removed_at&&(!c.version||own(r.author_id))).length;$('selected-'+key).textContent=feedSets[key].size+' selected';$('select-'+key).textContent=`Select all (${permitted})`;$('select-'+key).disabled=H.isBusy()||!permitted;$('clear-'+key).disabled=H.isBusy()||!feedSets[key].size;$('remove-'+key).disabled=H.isBusy()||!feedSets[key].size;")
replace("button('selectManagerItems','Select shown',()=>{d.querySelectorAll('.management-choice').forEach(x=>x.checked=true);}),clear=button('clearManagerItems','Clear',()=>{d.querySelectorAll('.management-choice').forEach(x=>x.checked=false);})", "button('selectManagerItems','Select all',()=>{if(H.isBusy())return;d.querySelectorAll('.management-choice:not(:disabled)').forEach(x=>x.checked=true);decorateManager();}),clear=button('clearManagerItems','Deselect all',()=>{if(H.isBusy())return;d.querySelectorAll('.management-choice').forEach(x=>x.checked=false);decorateManager();})")
replace("bar.append(check,clear,action);d.querySelector('.manage-tabs').after(bar);", "const total=el('span','0 selected');total.id='managerSelectionCount';total.setAttribute('aria-live','polite');check.title='Select every item you can manage in this Collections or Trash list, including items below the screen.';bar.append(total,check,clear,action);d.querySelector('.manage-tabs').after(bar);")
replace("ck.setAttribute('aria-label','Select '+row.querySelector('strong').textContent);row.prepend(ck);", "ck.setAttribute('aria-label','Select '+row.querySelector('strong').textContent);ck.onchange=()=>decorateManager();row.prepend(ck);")
replace("$('applyManagerBatch').textContent=$('managementTrashTab').classList.contains('active')?'Restore selected':'Move selected collections to Trash';for(const id of ['selectManagerItems','clearManagerItems','applyManagerBatch'])$(id).disabled=H.isBusy();", """const choices=[...d.querySelectorAll('.management-choice')],chosen=choices.filter(x=>x.checked).length,isBusy=H.isBusy();
 $('managerSelectionCount').textContent=chosen+' selected';$('selectManagerItems').textContent=`Select all (${choices.length})`;
 $('applyManagerBatch').textContent=$('managementTrashTab').classList.contains('active')?'Restore selected':'Move selected collections to Trash';
 $('selectManagerItems').disabled=isBusy||!choices.length;$('clearManagerItems').disabled=isBusy||!chosen;$('applyManagerBatch').disabled=isBusy||!chosen;for(const ck of choices)ck.disabled=isBusy;""")
p.write_text(s)
print('Explicit Select all controls installed. No data or permission changes.')
