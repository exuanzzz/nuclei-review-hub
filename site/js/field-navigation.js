/* Field navigation follows the current filtered library. It never changes source data. */
window.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const H = window.Hub, $ = id => document.getElementById(id);
  if (!H) return;
  const key = r => r ? (r.id || r.localId) : null;
  let queue = [], queueScope = '', pending = false, lastRecord = null;
  const bar = document.createElement('nav');
  bar.className = 'field-navigation';
  bar.setAttribute('aria-label', 'Previous and next image');
  const previous = document.createElement('button'), next = document.createElement('button');
  const counter = document.createElement('span');
  previous.id = 'previousImage'; previous.type = 'button'; previous.textContent = '← Previous';
  next.id = 'nextImage'; next.type = 'button'; next.textContent = 'Next →';
  counter.id = 'imagePosition'; counter.setAttribute('aria-live', 'polite');
  bar.append(previous, counter, next);
  $('copyLink').parentElement.prepend(bar);
  const style = document.createElement('style');
  style.textContent = '.field-navigation{display:flex;align-items:center;gap:7px;flex-wrap:nowrap}.field-navigation button{font-size:12px;padding:8px 11px;white-space:nowrap}.field-navigation span{min-width:52px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}.vheader{flex-wrap:wrap}.vheader>.actions{justify-content:flex-end}@media(max-width:760px){.vheader>.actions{justify-content:flex-start;width:100%}.field-navigation{margin-right:auto}.field-navigation button{padding:6px 9px}.vheader h2{max-width:90vw}}';
  document.head.append(style);
  function update() {
    const current = H.getCurrent();
    if (!current || $('viewer').classList.contains('hidden')) {
      queue = []; queueScope = ''; lastRecord = null;
      previous.disabled = next.disabled = true; counter.textContent = '—'; return;
    }
    const scope = current.version ? 'shared' : 'local', id = key(current.record);
    const all = scope === 'shared' ? H.getShared() : H.getLocal();
    const live = new Set(all.map(key));
    queue = queue.filter(x => live.has(x));
    if (scope !== queueScope || !queue.includes(id)) {
      // Deep links can open a shared record while the saved library tab is local.
      const filtered = H.getScope() === scope ? H.getVisible() : [];
      queue = (filtered.some(r => key(r) === id) ? filtered : all).map(key);
      if (!queue.includes(id)) queue = [id];
      queueScope = scope;
    }
    const i = queue.indexOf(id);
    const locked = pending || H.isBusy() || (!current.data && !/^No verified overlay:/.test($('vSubtitle').textContent));
    previous.disabled = locked || i <= 0;
    next.disabled = locked || i < 0 || i >= queue.length - 1;
    counter.textContent = `${i + 1} / ${queue.length}`;
    counter.title = 'Current filtered image list; not ROI numbers';
    previous.title = i > 0 ? all.find(r => key(r) === queue[i - 1])?.name || 'Previous image' : 'First image';
    next.title = i >= 0 && i < queue.length - 1 ? all.find(r => key(r) === queue[i + 1])?.name || 'Next image' : 'Last image';
    if (lastRecord !== id) lastRecord = id;
  }
  async function move(delta) {
    update();
    if ((delta < 0 ? previous : next).disabled) return;
    const cur = H.getCurrent(), i = queue.indexOf(key(cur.record));
    const all = queueScope === 'shared' ? H.getShared() : H.getLocal();
    const target = all.find(r => key(r) === queue[i + delta]);
    if (!target) return;
    const viewer = H.getViewer(), mode = viewer.mode;
    pending = true; update();
    try {
      // openField performs the unsaved-feedback check; cancellation stays here.
      await H.openField(target);
      if (key(H.getCurrent()?.record) === key(target) && H.getCurrent()?.data) viewer.setMode(mode);
    } catch (e) { H.toast(e.message || String(e)); }
    finally { pending = false; update(); }
  }
  previous.onclick = () => move(-1); next.onclick = () => move(1);
  document.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    const target = e.target;
    if (target.closest?.('input,textarea,select,button,[contenteditable="true"],dialog') || $('viewer').classList.contains('hidden')) return;
    if (H.getViewer().tool !== 'pan') return;
    e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1);
  });
  for (const id of ['vTitle', 'vSubtitle']) new MutationObserver(update).observe($(id), {childList: true, characterData: true, subtree: true});
  new MutationObserver(update).observe($('viewer'), {attributes: true, attributeFilter: ['class']});
  window.addEventListener('nr:state', update); update();
  window.FieldNavigation = {update, move, getQueue: () => queue.slice()};
});
