/* Mask-faithful PNG/ZIP processing. No prediction, interpolation, or shape editing.
   Boundary convention: foreground pixels with >=1 background/outside 4-neighbour.
   The code operates on decoded integer PNG samples, never a browser thumbnail. */
'use strict';
(function(root){
const enc=new TextEncoder(), dec=new TextDecoder('utf-8');
const table=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(a){let c=0xffffffff;for(let i=0;i<a.length;i++)c=table[(c^a[i])&255]^(c>>>8);return(c^0xffffffff)>>>0;}
// SHA-256 fallback for local/opaque-origin pages where Web Crypto is unavailable.
function sha256Fallback(input){const src=input instanceof Uint8Array?input:new Uint8Array(input.buffer||input,input.byteOffset||0,input.byteLength),L=src.length,n=Math.ceil((L+9)/64)*64,a=new Uint8Array(n);a.set(src);a[L]=128;const dv=new DataView(a.buffer);dv.setUint32(n-8,Math.floor(L/0x20000000));dv.setUint32(n-4,(L*8)>>>0);
const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),W=new Uint32Array(64),rr=(x,n)=>(x>>>n)|(x<<(32-n));
for(let o=0;o<n;o+=64){for(let i=0;i<16;i++)W[i]=dv.getUint32(o+4*i);for(let i=16;i<64;i++){const u=W[i-15],v=W[i-2],s0=rr(u,7)^rr(u,18)^(u>>>3),s1=rr(v,17)^rr(v,19)^(v>>>10);W[i]=(W[i-16]+s0+W[i-7]+s1)>>>0;}let [aa,b,c,d,e,f,g,h]=H;for(let i=0;i<64;i++){const s1=rr(e,6)^rr(e,11)^rr(e,25),ch=(e&f)^(~e&g),t1=(h+s1+ch+K[i]+W[i])>>>0,s0=rr(aa,2)^rr(aa,13)^rr(aa,22),maj=(aa&b)^(aa&c)^(b&c),t2=(s0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=aa;aa=(t1+t2)>>>0;}for(const [i,v] of [aa,b,c,d,e,f,g,h].entries())H[i]=(H[i]+v)>>>0;}
return [...H].map(x=>x.toString(16).padStart(8,'0')).join('');}
async function sha256(a){if(root.crypto?.subtle)return [...new Uint8Array(await root.crypto.subtle.digest('SHA-256',a))].map(v=>v.toString(16).padStart(2,'0')).join('');return sha256Fallback(a);}
function u16bytes(a){const b=new Uint8Array(a.length*2);for(let i=0;i<a.length;i++){b[2*i]=a[i]&255;b[2*i+1]=a[i]>>>8;}return b;}
function join(parts){const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;}
async function inflate(a,format,maxBytes){let stream;try{stream=new DecompressionStream(format);}catch(e){throw Error('This browser cannot decompress '+format+'. Use a recent Chrome/Edge browser.');}
const reader=new Blob([a]).stream().pipeThrough(stream).getReader(),parts=[];let n=0;while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>maxBytes){await reader.cancel();throw Error('Decompressed data exceeds the declared size.');}parts.push(value);}return join(parts);}
function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
async function decodePNG(input){
const a=input instanceof Uint8Array?input:new Uint8Array(input);if(a.length<33||[137,80,78,71,13,10,26,10].some((v,i)=>a[i]!==v))throw Error('Not a PNG file.');
const dv=new DataView(a.buffer,a.byteOffset,a.byteLength);let o=8,ih=null,pal=null,trns=null,end=false;const ids=[],chunks=[];let idBytes=0;
while(o+12<=a.length){const n=dv.getUint32(o),typ=String.fromCharCode(...a.subarray(o+4,o+8));if(n>0x7fffffff||o+12+n>a.length)throw Error('Truncated PNG chunk '+typ);const body=a.subarray(o+8,o+8+n);
if(crc32(a.subarray(o+4,o+8+n))!==dv.getUint32(o+8+n))throw Error('PNG CRC mismatch in '+typ);chunks.push(typ);
if(!ih&&typ!=='IHDR')throw Error('PNG must begin with IHDR.');
if(typ==='IHDR'){if(ih||n!==13)throw Error('Invalid IHDR.');ih={width:dv.getUint32(o+8),height:dv.getUint32(o+12),bitDepth:a[o+16],colorType:a[o+17],compression:a[o+18],filter:a[o+19],interlace:a[o+20]};}
else if(typ==='PLTE'){if(n%3||!n||n>768)throw Error('Invalid palette.');pal=body.slice();}
else if(typ==='tRNS')trns=body.slice();
else if(typ==='IDAT'){ids.push(body);idBytes+=n;}
else if(typ==='IEND'){if(n)throw Error('Invalid IEND.');end=true;o+=12;break;}
else if(['acTL','fcTL','fdAT'].includes(typ))throw Error('Animated PNG is not accepted as a static label.');
else if(typ[0]===typ[0].toUpperCase())throw Error('Unsupported critical PNG chunk '+typ);
o+=n+12;
}
if(!end||o!==a.length||!ids.length)throw Error('Incomplete PNG, or trailing bytes after IEND.');
const {width:w,height:h,bitDepth:d,colorType:ct,interlace:inter}=ih;
const channels={0:1,2:3,3:1,4:2,6:4}[ct],allowed={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
if(!channels||!allowed[ct].includes(d)||ih.compression!==0||ih.filter!==0||![0,1].includes(inter))throw Error('Unsupported PNG encoding.');
if(!w||!h||w*h>16000000)throw Error('Image exceeds the 16-million-pixel safety limit.');
if(ct===3&&!pal)throw Error('Indexed PNG has no palette.');
if(trns&&((ct===0&&trns.length!==2)||(ct===2&&trns.length!==6)||(ct===3&&trns.length>pal.length/3)||[4,6].includes(ct)))throw Error('Invalid transparency chunk.');
const passes=inter?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
let expected=0;for(const [x0,y0,dx,dy] of passes){const pw=Math.max(0,Math.ceil((w-x0)/dx)),ph=Math.max(0,Math.ceil((h-y0)/dy));if(pw&&ph)expected+=(Math.ceil(pw*channels*d/8)+1)*ph;}
const bytes=await inflate(join(ids),'deflate',expected);if(bytes.length!==expected)throw Error('PNG inflated length mismatch.');
const samples=new Uint16Array(w*h*channels);let off=0;
for(const [x0,y0,dx,dy] of passes){const pw=Math.max(0,Math.ceil((w-x0)/dx)),ph=Math.max(0,Math.ceil((h-y0)/dy));if(!pw||!ph)continue;const rowlen=Math.ceil(pw*channels*d/8),bpp=Math.max(1,Math.ceil(channels*d/8));let prev=new Uint8Array(rowlen);
for(let py=0;py<ph;py++){const f=bytes[off++];if(f>4)throw Error('Invalid PNG row filter.');const row=bytes.slice(off,off+rowlen);off+=rowlen;
for(let i=0;i<rowlen;i++){const l=i>=bpp?row[i-bpp]:0,u=prev[i],ul=i>=bpp?prev[i-bpp]:0;row[i]=(row[i]+(f===0?0:f===1?l:f===2?u:f===3?Math.floor((l+u)/2):paeth(l,u,ul)))&255;}
for(let x=0;x<pw;x++)for(let c=0;c<channels;c++){const j=x*channels+c;let v;if(d===16)v=(row[j*2]<<8)|row[j*2+1];else if(d===8)v=row[j];else{const bit=j*d;v=(row[bit>>>3]>>>(8-d-(bit&7)))&((1<<d)-1);}samples[((y0+py*dy)*w+x0+x*dx)*channels+c]=v;}prev=row;}
}
if(off!==bytes.length)throw Error('PNG decode did not consume the complete image.');
const nativeMax=ct===3?255:(2**d-1);return {...ih,channels,samples,palette:pal,transparency:trns,nativeMax,chunks,crcChecked:true};
}
function pixelRGBA(p,i){const s=p.samples,k=i*p.channels,max=p.nativeMax,t=p.transparency;let r,g,b,alpha=max;
switch(p.colorType){case 0:r=g=b=s[k];if(t&&s[k]===(t[0]*256+t[1]))alpha=0;break;case 2:r=s[k];g=s[k+1];b=s[k+2];if(t&&r===t[0]*256+t[1]&&g===t[2]*256+t[3]&&b===t[4]*256+t[5])alpha=0;break;case 3:{const v=s[k];if(v*3+2>=p.palette.length)throw Error('Palette index out of range.');r=p.palette[3*v];g=p.palette[3*v+1];b=p.palette[3*v+2];alpha=t&&v<t.length?t[v]:255;break;}case 4:r=g=b=s[k];alpha=s[k+1];break;case 6:r=s[k];g=s[k+1];b=s[k+2];alpha=s[k+3];break;default:throw Error('Unsupported colour type.');}return[r,g,b,alpha];}
function displayRGBA(p){const a=new Uint8ClampedArray(p.width*p.height*4),max=p.nativeMax;for(let i=0;i<p.width*p.height;i++){const q=pixelRGBA(p,i);for(let c=0;c<4;c++)a[4*i+c]=Math.round(q[c]*255/max);}return a;}
function extractBinary(p){const n=p.width*p.height,fg=new Uint8Array(n);let positive=null,area=0,transparentBackground=0;
for(let i=0;i<n;i++){const [r,g,b,a]=pixelRGBA(p,i);if(r!==g||r!==b)throw Error('A mask contains coloured pixels. Expected a binary single-object PNG, not a coloured overlay.');
if(a!==p.nativeMax){if(a===0&&r===0)transparentBackground++;else throw Error('A mask contains transparent foreground or partial alpha. No implicit alpha threshold will be applied.');}
if(r!==0){if(positive===null)positive=r;else if(r!==positive)throw Error('A mask contains multiple positive intensity values. Anti-aliased or instance-label masks are not silently thresholded.');fg[i]=1;area++;}}
return{fg,positive,area,transparentBackground};}
function innerBoundary(fg,w,h){const out=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(fg[i]&&(x===0||x===w-1||y===0||y===h-1||!fg[i-1]||!fg[i+1]||!fg[i-w]||!fg[i+w]))out[i]=1;}return out;}
// Independent implementation: mark BOTH sides of every foreground/background
// transition in horizontal and vertical scans, then retain only the foreground.
function boundaryByTransitions(fg,w,h){const out=new Uint8Array(w*h);for(let y=0;y<h;y++){let last=0;for(let x=0;x<=w;x++){const v=x<w?fg[y*w+x]:0;if(v!==last){if(v)out[y*w+x]=1;else out[y*w+x-1]=1;}last=v;}}
for(let x=0;x<w;x++){let last=0;for(let y=0;y<=h;y++){const v=y<h?fg[y*w+x]:0;if(v!==last){if(v)out[y*w+x]=1;else out[(y-1)*w+x]=1;}last=v;}}return out;}
function mismatches(a,b){if(a.length!==b.length)return Infinity;let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n;}
function indices(a){let n=0;for(const v of a)if(v)n++;const ids=new Uint32Array(n);let k=0;for(let i=0;i<a.length;i++)if(a[i])ids[k++]=i;return ids;}
async function analyseMask(bytes,w,h){const png=await decodePNG(bytes);if(png.width!==w||png.height!==h)throw Error(`Mask dimensions ${png.width} x ${png.height} do not match image ${w} x ${h}. No resizing is performed.`);
const {fg,positive,area,transparentBackground}=extractBinary(png),edge=innerBoundary(fg,w,h),check=boundaryByTransitions(fg,w,h),diff=mismatches(edge,check);if(diff)throw Error('Independent boundary check failed: '+diff+' pixels.');
const pixels=indices(fg),edges=indices(edge),restored=new Uint8Array(w*h);for(const i of pixels)restored[i]=1;const roundtrip=mismatches(fg,restored);if(roundtrip)throw Error('Mask representation changed '+roundtrip+' pixels.');
let sumx=0,sumy=0,xmin=w,ymin=h,xmax=-1,ymax=-1;for(const i of pixels){const y=Math.floor(i/w),x=i-y*w;sumx+=x;sumy+=y;xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
const report={width:w,height:h,bit_depth:png.bitDepth,color_type:png.colorType,interlaced:!!png.interlace,source_sha256:await sha256(bytes),native_samples_u16le_sha256:await sha256(u16bytes(png.samples)),foreground_01_sha256:await sha256(fg),boundary_01_sha256:await sha256(edge),foreground_value:positive,foreground_pixels:area,boundary_pixels:edges.length,mask_roundtrip_mismatches:roundtrip,boundary_rule_mismatches:diff,png_crc:'PASS',transparent_zero_background_pixels:transparentBackground};
return{pixels,edges,report,center:area?{x:sumx/area,y:sumy/area}:null,bbox:area?[xmin,ymin,xmax+1,ymax+1]:null};
}
async function zipEntries(file){const ts=Math.max(0,file.size-65557),tail=new Uint8Array(await file.slice(ts).arrayBuffer()),v=new DataView(tail.buffer);let at=-1;for(let i=tail.length-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===tail.length){at=i;break;}if(at<0)throw Error('No valid ZIP end record. The download may be incomplete.');
if(v.getUint16(at+4,true)||v.getUint16(at+6,true))throw Error('Split ZIP archives are not supported.');const n=v.getUint16(at+10,true),len=v.getUint32(at+12,true),off=v.getUint32(at+16,true);if(n===65535||len===0xffffffff||off===0xffffffff)throw Error('ZIP64 is not supported. Select the extracted dataset folder instead.');if(off+len>ts+at)throw Error('ZIP central directory is out of range.');const a=new Uint8Array(await file.slice(off,off+len).arrayBuffer()),d=new DataView(a.buffer),items=[],seen=new Set();let p=0;
for(let i=0;i<n;i++){if(p+46>a.length||d.getUint32(p,true)!==0x02014b50)throw Error('Damaged ZIP central directory.');const flags=d.getUint16(p+8,true),method=d.getUint16(p+10,true),crc=d.getUint32(p+16,true),compressed=d.getUint32(p+20,true),size=d.getUint32(p+24,true),nl=d.getUint16(p+28,true),ex=d.getUint16(p+30,true),cl=d.getUint16(p+32,true),offset=d.getUint32(p+42,true);if(p+46+nl+ex+cl>a.length)throw Error('Truncated ZIP filename.');const name=dec.decode(a.subarray(p+46,p+46+nl)).replace(/\\/g,'/').replace(/^\.\//,'');p+=46+nl+ex+cl;if(name.endsWith('/')||name.startsWith('__MACOSX/')||name.split('/').includes('..'))continue;if(seen.has(name))throw Error('Duplicate ZIP path: '+name);seen.add(name);items.push({name,size,crc,async bytes(){if(flags&1)throw Error('Encrypted ZIP member: '+name);if(size>400000000)throw Error('ZIP member exceeds the safety limit.');const hv=new DataView(await file.slice(offset,offset+30).arrayBuffer());if(hv.byteLength<30||hv.getUint32(0,true)!==0x04034b50)throw Error('Invalid ZIP local header.');const start=offset+30+hv.getUint16(26,true)+hv.getUint16(28,true);if(start+compressed>off)throw Error('ZIP entry exceeds archive data region.');let data=new Uint8Array(await file.slice(start,start+compressed).arrayBuffer());if(method===8)data=await inflate(data,'deflate-raw',size);else if(method!==0)throw Error('Unsupported ZIP compression method '+method);if(data.length!==size||crc32(data)!==crc)throw Error('ZIP member length or CRC mismatch: '+name);return data;}});}
if(p!==len)throw Error('Unexpected ZIP directory bytes.');return items;}
async function makeZip(items){if(items.length>65000)throw Error('Too many files for this ZIP writer.');let offset=0;const local=[],central=[];for(const item of items){const name=enc.encode(item.name),data=item.bytes instanceof Uint8Array?item.bytes:new Uint8Array(await item.blob.arrayBuffer()),crc=crc32(data),h=new Uint8Array(30),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.push(h,name,data);const ch=new Uint8Array(46),cv=new DataView(ch.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);cv.setUint16(14,33,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.push(ch,name);offset+=30+name.length+data.length;if(offset>0xffffffff)throw Error('Export exceeds 4 GB. Export a smaller selection.');}const len=central.reduce((s,p)=>s+p.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,items.length,true);v.setUint16(10,items.length,true);v.setUint32(12,len,true);v.setUint32(16,offset,true);return new Blob([...local,...central,end],{type:'application/zip'});}
root.GTCore={crc32,sha256,sha256Fallback,u16bytes,decodePNG,pixelRGBA,displayRGBA,extractBinary,innerBoundary,boundaryByTransitions,mismatches,indices,analyseMask,zipEntries,makeZip};
if(typeof module!=='undefined')module.exports=root.GTCore;
})(globalThis);
