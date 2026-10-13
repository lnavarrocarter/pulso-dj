export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function loopRegion(position, beats, bpm, duration) {
  const length = beats * 60 / clamp(bpm, 40, 240);
  if (duration < length) return null;
  const start = clamp(position, 0, duration - length);
  return { start, end: start + length };
}
export function loopPosition(position, loop) {
  if (!loop || position < loop.end) return position;
  return loop.start + (position - loop.start) % (loop.end - loop.start);
}
export function crossfade(value) {
  const angle = clamp(value, 0, 1) * Math.PI / 2;
  return [Math.cos(angle), Math.sin(angle)];
}
export function midiEvent(data) {
  if (!data || data.length < 3) return null;
  const [status, number, value] = data;
  const kind = status & 0xf0;
  if (![0x80, 0x90, 0xb0].includes(kind)) return null;
  return { type: kind === 0xb0 ? 'cc' : 'note', channel: status & 15, number,
    value: kind === 0x80 ? 0 : value, pressed: kind === 0x90 && value > 0 };
}
export function mappingKey(event, device) {
  return `${device}:${event.type}:${event.channel}:${event.number}`;
}
export function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(whole / 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
}
