"""UI-only image navigation integration. No network, authentication or permission changes."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
p = root / 'site/js/app.js'
s = p.read_text()
if '// image-navigation-draft-guard-v1' not in s:
    old = "async function openField(r,version){const generation=++openEpoch;if(current&&($('commentBody').value||V.polygon||V.points.length)&&!confirm('Discard your unsent comment or polygon draft?'))return;"
    new = "// image-navigation-draft-guard-v1\nfunction hasUnsentReview(){return !!($('commentBody').value||$('proposalLabel').value||$('proposalNote').value||$('decisionBody').value||V.polygon||V.points.length);}\nasync function openField(r,version){if(current&&hasUnsentReview()&&!confirm('Discard unsaved feedback and move to another image/version?'))return false;const generation=++openEpoch;"
    replacements = [(old,new), ("if(($('commentBody').value||V.polygon||V.points.length)&&!confirm('Discard unsent comment or polygon draft?'))return;", "if(hasUnsentReview()&&!confirm('Discard unsaved feedback and close this image?'))return;"), ("if(busy||$('commentBody').value||V.polygon||V.points.length){e.preventDefault();", "if(busy||hasUnsentReview()){e.preventDefault();")]
    for old,new in replacements:
        if s.count(old)!=1: raise RuntimeError('Unexpected application source. Navigation integration stopped.')
        s=s.replace(old,new,1)
    p.write_text(s)
p=root/'site/index.html'
s=p.read_text()
if 'js/field-navigation.js' not in s:
    if s.count('</body>')!=1: raise RuntimeError('Unexpected HTML structure.')
    p.write_text(s.replace('</body>','<script src="js/field-navigation.js"></script>\n</body>',1))
print('Previous/next image navigation integrated. No authentication, access or source-image changes.')
