"""Run the same guest tests with failure-only, synthetic browser diagnostics."""
from pathlib import Path
path=Path(__file__).with_name('guest_ui.py')
source=path.read_text()
old=' assert value,name\n'
new=''' if not value:
  diagnostic={'assertion':name}
  for key in ['q','o','z']:
   page=globals().get(key)
   if page is not None and not page.is_closed():
    try:
     diagnostic[key]=page.evaluate("""()=>({user:window.Hub?.getUser(),version:window.Hub?.getCurrent()?.version,option:document.querySelector('#verdict option[value=approved]')?.outerHTML,guest:window.ReviewCloud?.getGuestState(),toast:document.getElementById('toast')?.textContent})""")
     page.screenshot(path=str(OUT/('assertion-'+key+'.png')))
    except Exception as e:diagnostic[key]={'error':str(e)}
  (OUT/'assertion_failure.json').write_text(json.dumps(diagnostic,indent=2))
  print(json.dumps(diagnostic,indent=2),flush=True)
  raise AssertionError(name)
'''
assert source.count(old)==1
exec(compile(source.replace(old,new),str(path),'exec'),{'__file__':str(path),'__name__':'__main__'})
