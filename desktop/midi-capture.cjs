// Pure analysis of captured MIDI messages, used by the monitor to describe an unknown controller.
const TYPES = { 0x80: 'note', 0x90: 'note', 0xa0: 'aftertouch', 0xb0: 'cc', 0xc0: 'program', 0xd0: 'pressure', 0xe0: 'pitch' };
const hex = value => '0x' + value.toString(16).toUpperCase().padStart(2, '0');
function parseMessage(data) {
  if (!data || data.length < 2 || data[0] < 0x80 || data[0] >= 0xf0) return null;
  const kind = data[0] & 0xf0;
  const value = kind === 0xe0 ? data[1] | (data[2] << 7) : kind === 0xc0 || kind === 0xd0 ? data[1] : data[2] ?? 0;
  return { type: TYPES[kind], channel: (data[0] & 15) + 1, number: kind === 0xe0 || kind === 0xd0 ? null : data[1],
    value: kind === 0x80 ? 0 : value };
}
const controlKey = (port, message) => `${port}|${message.type}|${message.channel}|${message.number}`;
function describe(control) {
  const id = control.number === null ? '' : ` ${hex(control.number)} (${control.number})`;
  return `${control.type.toUpperCase().padEnd(5)} ch${String(control.channel).padStart(2)}${id}`;
}
// Relative encoders (jog wheels, browse knobs) send small offsets around 64 or two's-complement steps.
function guessKind(control, pairs) {
  if (control.type === 'note') return 'botón';
  if (control.type === 'pitch') return 'pitch bend 14 bits';
  if (control.type !== 'cc') return control.type;
  const pair = pairs.find(item => item.msb === control.number || item.lsb === control.number);
  if (pair) return pair.msb === control.number ? `absoluto 14 bits (MSB, LSB ${hex(pair.lsb)})` : `absoluto 14 bits (LSB de ${hex(pair.msb)})`;
  const values = control.values;
  if (control.count >= 6 && values.every(value => value !== 64 && Math.abs(value - 64) <= 16)) return 'relativo (centro 64)';
  if (control.count >= 6 && values.every(value => value > 0 && (value <= 16 || value >= 112))) return 'relativo (complemento a dos)';
  if (values.length <= 2 && values.every(value => value === 0 || value === 127)) return 'botón (CC)';
  return 'absoluto 7 bits';
}
// Events are capped per control so a flood from one jog wheel cannot hide the rest of the session.
function createCapture({ maxEvents = 50000, maxEventsPerControl = 300 } = {}) {
  const controls = new Map(); const events = []; let label = null;
  return {
    setLabel(next) { label = next || null; },
    add(port, data, time = 0) {
      const message = parseMessage(data); if (!message) return null;
      const key = controlKey(port, message);
      let control = controls.get(key); const isNew = !control;
      if (isNew) controls.set(key, control = { port, ...message, count: 0, min: message.value, max: message.value, values: [], labels: [] });
      control.count++; control.min = Math.min(control.min, message.value); control.max = Math.max(control.max, message.value);
      if (control.values.length < 64 && !control.values.includes(message.value)) control.values.push(message.value);
      if (label && !control.labels.includes(label)) control.labels.push(label);
      if (control.count <= maxEventsPerControl && events.length < maxEvents) events.push({ time: Math.round(time), port, data: [...data] });
      return { control, isNew, message };
    },
    summary() {
      const list = [...controls.values()];
      const pairs = [];
      for (const msb of list) {
        if (msb.type !== 'cc' || msb.number >= 32) continue;
        const lsb = list.find(item => item.type === 'cc' && item.port === msb.port && item.channel === msb.channel && item.number === msb.number + 32);
        if (lsb) pairs.push({ port: msb.port, channel: msb.channel, msb: msb.number, lsb: lsb.number });
      }
      const sorted = list.sort((a, b) => a.port.localeCompare(b.port) || a.channel - b.channel || a.type.localeCompare(b.type) || (a.number ?? -1) - (b.number ?? -1));
      return { controls: sorted.map(control => ({ ...control, id: describe(control),
        kind: guessKind(control, pairs.filter(pair => pair.port === control.port && pair.channel === control.channel)) })), pairs, events };
    }
  };
}
module.exports = { parseMessage, describe, guessKind, createCapture };
