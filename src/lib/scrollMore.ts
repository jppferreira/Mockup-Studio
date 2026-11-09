function scrollingAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
      && node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function pinOnce(el: HTMLElement, scroller: HTMLElement) {
  const edge = () => scroller.getBoundingClientRect().top + scroller.clientTop;
  scroller.style.paddingBottom = '0px';
  let delta = el.getBoundingClientRect().top - edge();
  const max = scroller.scrollHeight - scroller.clientHeight;
  const shortage = scroller.scrollTop + delta - max;
  if (shortage > 0.5) scroller.style.paddingBottom = `${shortage}px`;
  else scroller.style.paddingBottom = '';
  delta = el.getBoundingClientRect().top - edge();
  if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
}

/** Put an opened section, menu, or panel flush with the top of its scroll container. */
export function pinToContainerTop(el: HTMLElement, ms = 360): () => void {
  let frame = 0;
  const start = performance.now();
  const tick = () => {
    const scroller = scrollingAncestor(el);
    if (scroller) pinOnce(el, scroller);
    if (performance.now() - start < ms) frame = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(frame);
}

export function releasePinPadding(el: HTMLElement) {
  const scroller = scrollingAncestor(el);
  if (!scroller) return;
  if (scroller.querySelector('.settings-section.is-open, .device-dropdown.is-open')) return;
  scroller.style.paddingBottom = '';
}

/** Toggle a bottom fade when a scroller still has content below the fold.
 *  Optional fadeHost gets `has-scroll-more` for a pinned overlay (prefer over sticky ::after). */
export function bindScrollMore(el: HTMLElement, fadeHost?: HTMLElement | null) {
  const update = () => {
    const more = el.scrollHeight - el.clientHeight - el.scrollTop > 12;
    el.classList.toggle('can-scroll-more', more);
    fadeHost?.classList.toggle('has-scroll-more', more);
  };
  update();
  el.addEventListener('scroll', update, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(el);
  const watchChildren = () => {
    for (const child of el.children) ro.observe(child);
  };
  watchChildren();
  const mo = new MutationObserver(() => {
    watchChildren();
    update();
  });
  mo.observe(el, { childList: true });
  return () => {
    el.classList.remove('can-scroll-more');
    fadeHost?.classList.remove('has-scroll-more');
    el.removeEventListener('scroll', update);
    ro.disconnect();
    mo.disconnect();
  };
}
