"""Run native-browser tests while leaving the application's CSP unchanged.
Playwright's string wait predicates use page-world eval under some versions;
these tests instead poll with CDP-backed Page.evaluate, with the same deadline.
"""
from pathlib import Path
import runpy
import time
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeout

root = Path(__file__).resolve().parents[1]
ui = root / 'site/js/workspace-ui.js'
text = ui.read_text()
old = 'restore.disabled=busy;'
new = "restore.disabled=busy;document.querySelectorAll('.select-field').forEach(ck=>ck.disabled=busy);"
if new not in text:
    if old not in text:
        raise RuntimeError('Unexpected selection-control source; integration stopped.')
    ui.write_text(text.replace(old,new))

def wait_for_function(self, expression, *, arg=None, timeout=None, polling=None):
    deadline = time.monotonic() + (60000 if timeout is None else timeout) / 1000
    while True:
        if self.evaluate(expression, arg):
            return None  # Test calls only wait; none consume a JSHandle.
        if timeout != 0 and time.monotonic() >= deadline:
            try:
                folder=root/'test-results/workspace';folder.mkdir(parents=True,exist_ok=True)
                self.screenshot(path=str(folder/'failure.png'))
                (folder/'failure_dom.html').write_text(self.content())
            except Exception:
                pass
            raise PlaywrightTimeout('Predicate timed out: ' + expression)
        self.wait_for_timeout(polling if isinstance(polling,(float,int)) else 50)

Page.wait_for_function = wait_for_function
runpy.run_path(str(root/'tests/workspace_e2e.py'), run_name='__main__')
