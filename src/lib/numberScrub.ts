/** Drag left/right inside a number field to change its value. */

const PIXELS_PER_STEP = 2;
const START_THRESHOLD_PX = 4;

type Session = {
  input: HTMLInputElement;
  pointerId: number;
  startX: number;
  startY: number;
  startValue: number;
  step: number;
  scrubbing: boolean;
};

let installed = false;
let session: Session | null = null;

function stepOf(input: HTMLInputElement) {
  const raw = input.step;
  if (!raw || raw === 'any') return 1;
  const step = Number(raw);
  return Number.isFinite(step) && step > 0 ? step : 1;
}

function decimalsFor(step: number) {
  const text = String(step);
  if (text.includes('e-')) {
    const exp = Number(text.split('e-')[1]);
    return Number.isFinite(exp) ? exp : 4;
  }
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : Math.min(6, text.length - dot - 1);
}

function readValue(input: HTMLInputElement) {
  const value = Number(input.value);
  if (Number.isFinite(value)) return value;
  const min = Number(input.min);
  if (Number.isFinite(min)) return min;
  return 0;
}

function bounds(input: HTMLInputElement) {
  const min = input.min === '' ? null : Number(input.min);
  const max = input.max === '' ? null : Number(input.max);
  return {
    min: min != null && Number.isFinite(min) ? min : null,
    max: max != null && Number.isFinite(max) ? max : null,
  };
}

function writeValue(input: HTMLInputElement, raw: number, step: number) {
  const { min, max } = bounds(input);
  let value = Math.round(raw / step) * step;
  if (min != null) value = Math.max(min, value);
  if (max != null) value = Math.min(max, value);
  const text = value.toFixed(decimalsFor(step));
  if (input.value === text) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function scrubTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  if (target instanceof HTMLInputElement && target.type === 'number') return target;
  const host = target.closest('[data-scrub]');
  const input = host?.querySelector('input[type="number"]');
  return input instanceof HTMLInputElement ? input : null;
}

function endSession(commit: boolean) {
  const current = session;
  session = null;
  document.body.classList.remove('is-number-scrub');
  if (!current?.scrubbing) return;
  window.getSelection()?.removeAllRanges();
  if (commit) current.input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function installNumberScrub() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const input = scrubTarget(event.target);
    if (!input || input.disabled || input.readOnly) return;
    session = {
      input,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startValue: readValue(input),
      step: stepOf(input),
      scrubbing: false,
    };
  }, true);

  window.addEventListener('pointermove', (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.scrubbing) {
      if (Math.abs(dx) < START_THRESHOLD_PX) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        session = null;
        return;
      }
      session.scrubbing = true;
      document.body.classList.add('is-number-scrub');
      window.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    event.stopPropagation();
    const px = event.shiftKey ? PIXELS_PER_STEP * 10 : PIXELS_PER_STEP;
    const next = session.startValue + (dx / px) * session.step;
    writeValue(session.input, next, session.step);
  }, true);

  window.addEventListener('pointerup', (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    if (session.scrubbing) {
      event.preventDefault();
      event.stopPropagation();
    }
    endSession(true);
  }, true);

  window.addEventListener('pointercancel', () => endSession(false), true);

  window.addEventListener('selectstart', (event) => {
    if (document.body.classList.contains('is-number-scrub')) event.preventDefault();
  }, true);
}
