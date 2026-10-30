"""Build after existing integrations. No API calls, no database/schema changes."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def once(s,a,b):
 if s.count(a)!=1:raise RuntimeError('Unexpected importer, refusing patch: '+a[:120])
 return s.replace(a,b,1)
p=ROOT/'site/js/app.js';s=p.read_text()
if '// numeric-roi-import-v1' not in s:
 s=once(s,'const entries=isFolder?D.checkedEntries([...files].map(D.entry)):await D.expand([...files]);',"const entries=localInfo.kind==='fiji'?await NumericRois.entries(files,isFolder):(isFolder?D.checkedEntries([...files].map(D.entry)):await D.expand([...files]));")
 start=s.index("  if(localInfo.kind==='fiji'){",s.index('async function importFiles('))
 end=s.index('  const paired=D.pair(localInfo.kind,entries);',start)
 s=s[:start]+"  if(localInfo.kind==='fiji')NumericRois.addLocalImages(entries,local);\n"+s[end:]
 s=once(s,'const paired=D.pair(localInfo.kind,entries);',"const paired=localInfo.kind==='fiji'?await NumericRois.pair(entries):D.pair(localInfo.kind,entries);if(!paired){progress('Import cancelled. No files saved or uploaded.',0);return;}")
 s=once(s,"if(!/_rois\\.zip$/i.test(f.name))throw Error('Use a complete *_rois.zip archive for this image.');", "if(!/\\.zip$/i.test(f.name))throw Error('Choose a complete Fiji ROI ZIP. Numeric ZIP names are supported.');")
 s=once(s,"if(ROIReview.roiKey(f.name)!==cur.sourceRecord.key)throw Error('The ROI archive name does not match this source image. Keep the original sample stem.');", "if(!await NumericRois.revision(f,cur.sourceRecord.key,cur.record.name))return;")
 p.write_text(s+'\n// numeric-roi-import-v1\n')
p=ROOT/'site/index.html';s=p.read_text()
if 'js/numeric-rois.js' not in s:
 s=once(s,'<script src="js/data.js"></script>','<script src="js/data.js"></script><script src="js/numeric-rois.js"></script>')
s=s.replace('Fiji: TIFF images + *_rois.zip','Fiji: TIFF images + ROI ZIPs (names or numbers)')
p.write_text(s)
p=ROOT/'site/js/collection-files.js';s=p.read_text()
s=s.replace('Choose just the new image and its matching ROI ZIP. No folder re-upload is required.', 'Choose images and their ROI ZIPs. Names such as 1.zip / 2.zip are supported; check the pairing table before importing.')
s=s.replace('Choose the new TIFF(s), then choose matching *_rois.zip archives—even from another folder. Click Save selected files locally to preview. A parent folder or reference dataset ZIP is also supported.', 'Choose TIFF(s), then ROI ZIPs (numeric or named). Check numeric/manual pairs before saving locally. ZIP-internal names like 1.roi, 2.roi are already supported. A parent folder or reference dataset ZIP is also supported.')
p.write_text(s)
print('Numeric ROI pairing installed. No source bytes, decoder geometry, database policies or existing uploads changed.')
