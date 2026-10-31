// Hardware-style controls. Knobs wrap the existing range inputs, which stay the source of truth for app logic and MIDI.
import { fromKnob, toKnob } from './core.mjs';
const SWEEP = 270;
export function knob(input) {
  const wrapper = input.closest('label'), label = wrapper ?? document.querySelector(`label[for="${input.id}"]`);
  const name = label.firstChild.textContent.trim(), dial = document.createElement('div');
  dial.className = 'knob'; dial.tabIndex = 0; dial.setAttribute('role', 'slider'); dial.setAttribute('aria-label', name);
  dial.title = `${name}: arrastra en vertical, rueda o flechas; doble clic restablece`;
  input.hidden = true; (wrapper ?? input).after(dial); label.htmlFor = '';
  const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 0.01;
  const center = input.dataset.center === undefined ? (min + max) / 2 : Number(input.dataset.center);
  // Knob gestures work on the dial position (0-1); a data-center value sits at twelve o'clock.
  const position = () => toKnob(Number(input.value), min, center, max);
  const setPosition = ratio => {
    const next = Math.min(max, Math.max(min, Math.round(fromKnob(ratio, min, center, max) / step) * step));
    if (next === Number(input.value)) return;
    input.value = next; input.dispatchEvent(new Event('input'));
  };
  const set = value => setPosition(toKnob(value, min, center, max));
  const render = () => {
    const ratio = position();
    dial.style.setProperty('--turn', `${ratio * SWEEP - SWEEP / 2}deg`);
    dial.style.setProperty('--fill', `${ratio * SWEEP}deg`);
    dial.setAttribute('aria-valuenow', input.value);
  };
  dial.setAttribute('aria-valuemin', min); dial.setAttribute('aria-valuemax', max);
  input.addEventListener('input', render); render();
  dial.addEventListener('pointerdown', event => {
    dial.setPointerCapture(event.pointerId);
    const startY = event.clientY, start = position();
    const move = moveEvent => setPosition(start + (startY - moveEvent.clientY) / 180 * (moveEvent.shiftKey ? 0.2 : 1));
    const up = () => { dial.removeEventListener('pointermove', move); dial.removeEventListener('pointerup', up); };
    dial.addEventListener('pointermove', move); dial.addEventListener('pointerup', up);
  });
  dial.addEventListener('wheel', event => { event.preventDefault(); setPosition(position() - Math.sign(event.deltaY) / 40); }, { passive: false });
  dial.addEventListener('keydown', event => {
    const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
    if (direction) { event.preventDefault(); setPosition(position() + direction / 40); }
    if (event.key === 'Home') set(Number(input.defaultValue));
  });
  dial.addEventListener('dblclick', () => set(Number(input.defaultValue)));
  return dial;
}
// Jog wheel: dragging the centre holds the record (touch + scrub); dragging the outer ring nudges like the hardware edge.
export function platter(element, { touch, turn }) {
  let last = null, held = false;
  const angle = event => {
    const box = element.getBoundingClientRect();
    return Math.atan2(event.clientY - box.top - box.height / 2, event.clientX - box.left - box.width / 2) * 180 / Math.PI;
  };
  element.addEventListener('pointerdown', event => {
    const box = element.getBoundingClientRect();
    const radius = Math.hypot(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2) / (box.width / 2);
    element.setPointerCapture(event.pointerId); last = angle(event);
    held = radius < 0.78; if (held) touch(true);
    element.classList.add(held ? 'held' : 'nudging');
  });
  element.addEventListener('pointermove', event => {
    if (last === null) return;
    const current = angle(event); let delta = current - last; last = current;
    if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
    turn(delta * 2); // 720 ticks per turn, like the SB3 jog
  });
  const release = () => {
    if (last === null) return;
    last = null; if (held) touch(false); held = false;
    element.classList.remove('held', 'nudging');
  };
  element.addEventListener('pointerup', release); element.addEventListener('pointercancel', release);
  element.addEventListener('keydown', event => {
    const direction = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (direction) { event.preventDefault(); turn(direction * (event.shiftKey ? 80 : 8)); }
  });
}
// Peak level → 0-1 on a −48…0 dBFS scale, which is how hardware LED ladders read.
export function setMeter(element, peak) {
  const level = peak > 0 ? Math.min(1, Math.max(0, (20 * Math.log10(peak) + 48) / 48)) : 0;
  if (element.style.getPropertyValue('--level') === level.toFixed(3)) return;
  element.style.setProperty('--level', level.toFixed(3));
  element.setAttribute('aria-valuenow', level.toFixed(2));
}
