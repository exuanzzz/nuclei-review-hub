"""Read-only deployed-service probe: public Auth settings and a read-only status RPC.
Never creates a user, uploads data, reads private objects or changes Auth settings.
"""
from pathlib import Path
import json,re,urllib.request
root=Path(__file__).resolve().parents[1]
text=(root/'site/config.js').read_text()
url=re.search(r"supabaseUrl:\s*'([^']+)'",text).group(1)
key=re.search(r"publishableKey:\s*'([^']+)'",text).group(1)
assert url=='https://ykozvrvurwmsvnfvatiu.supabase.co'
assert key.startswith('sb_publishable_')
out=root/'test-results/guests';out.mkdir(parents=True,exist_ok=True)
def read(path,body=None):
 req=urllib.request.Request(url+path,data=body,headers={'apikey':key,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=25) as r:return json.load(r)
try:
 settings=read('/auth/v1/settings')
 guest=read('/rest/v1/rpc/nr_guest_access_status',b'{}')
 report={'scope':'Read-only public settings; no live guest created or data written.',
         'anonymous_provider_enabled':settings.get('external',{}).get('anonymous_users'),
         'new_signups_allowed':not settings.get('disable_signup',False),
         'guest_workspace_enabled':guest.get('enabled'),
         'guest_role':guest.get('default_role')}
 report['ready_for_guest_entry']=report['anonymous_provider_enabled'] is True and report['new_signups_allowed'] and report['guest_workspace_enabled'] is True
except Exception as e:
 report={'scope':'Read-only public settings probe','probe_error':str(e),'ready_for_guest_entry':False}
(out/'live_settings.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
if not report['ready_for_guest_entry']:
 print('::warning::Guest frontend is tested separately. Supabase Auth configuration may still need the owner to enable Anonymous Sign-ins. No automatic auth changes were attempted.')
