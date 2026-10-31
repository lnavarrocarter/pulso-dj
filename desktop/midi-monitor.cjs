// MIDI monitor for identifying a physical controller: `npm run midi:monitor` (free) or `npm run midi:guided`.
// Prints every message, then saves a summary of the controls seen to work/midi-capture-<date>.json.
// A small window drives the steps: Electron on Windows does not receive terminal input.
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { createCapture } = require('./midi-capture.cjs');
const guided = process.argv.includes('--guided');
const filter = (process.argv.find(arg => arg.startsWith('--port=')) || '').slice(7).toLowerCase();
const deck = side => [
  `Deck ${side}: PLAY/PAUSE`, `Deck ${side}: CUE`, `Deck ${side}: SYNC`, `Deck ${side}: SHIFT`,
  `Deck ${side}: jog, girar por el borde`, `Deck ${side}: jog, tocar la superficie y girar`, `Deck ${side}: fader de tempo (recorrido completo)`,
  `Deck ${side}: botones de modo de pads (HOT CUE, PAD FX, SLICER, SAMPLER)`, `Deck ${side}: pads 1 a 8 en orden`,
  `Deck ${side}: LOOP IN, LOOP OUT, 4 BEAT/EXIT`, `Deck ${side}: FX 1, FX 2, FX 3 y FX BEAT`,
  `Mezclador ${side}: TRIM`, `Mezclador ${side}: HI`, `Mezclador ${side}: MID`, `Mezclador ${side}: LOW`, `Mezclador ${side}: FILTER`,
  `Mezclador ${side}: botón CUE de auriculares`, `Mezclador ${side}: LOAD`, `Mezclador ${side}: fader de canal (recorrido completo)`
];
const steps = [...deck('A'), ...deck('B'), 'Crossfader (recorrido completo)', 'Navegador: girar', 'Navegador: pulsar', 'SAMPLER VOL y cualquier otro control restante'];
const capture = createCapture();
const started = new Date();
const file = path.resolve('work', `midi-capture-${started.toISOString().replace(/[:.]/g, '-')}.json`);
let step = -1; let finished = false; let dirty = false; let lastPorts = ''; let window; let stepControls = [];
const write = () => {
  mkdirSync(path.dirname(file), { recursive: true });
  const { controls, pairs, events } = capture.summary();
  writeFileSync(file, JSON.stringify({ started: started.toISOString(), guided, controls, pairs, events }, null, 2));
  dirty = false;
};
function finish(code = 0) {
  if (finished) return; finished = true;
  write();
  const { controls, pairs } = capture.summary();
  console.log(`\n${controls.length} controles distintos, ${pairs.length} pares de 14 bits.`);
  for (const control of controls) console.log(`  ${control.id}  ${control.kind.padEnd(34)} ${control.min}-${control.max} (${control.count})  ${control.labels.join(' / ')}`);
  console.log(`\nCaptura guardada en ${file}`);
  app.exit(code);
}
const render = (fields) => window?.webContents.executeJavaScript(`render(${JSON.stringify(fields)})`).catch(() => {});
function goTo(next) {
  step = Math.max(0, next); stepControls = [];
  if (step >= steps.length) { console.log('\nRecorrido guiado completo.'); finish(); return; }
  capture.setLabel(steps[step]);
  console.log(`\n[${step + 1}/${steps.length}] ${steps[step]}`);
  render({ progress: `Paso ${step + 1} de ${steps.length}`, step: steps[step], seen: 'Esperando mensajes…', back: step > 0 });
}
// Runs in a hidden, sandboxed local page (file:// is a secure context, required by Web MIDI); reports through console messages so the page needs no preload.
const rendererCode = filterName => `(async () => {
  const access = await navigator.requestMIDIAccess({ sysex: false });
  const attach = () => {
    const ports = [];
    for (const input of access.inputs.values()) {
      const wanted = input.state === 'connected' && (!${JSON.stringify(filterName)} || (input.name || '').toLowerCase().includes(${JSON.stringify(filterName)}));
      input.onmidimessage = wanted ? event => console.log('MIDI ' + JSON.stringify({ port: input.name || input.id, data: [...event.data], time: event.timeStamp })) : null;
      ports.push({ direction: 'entrada', name: input.name, manufacturer: input.manufacturer, state: input.state, listening: wanted });
    }
    for (const output of access.outputs.values()) ports.push({ direction: 'salida', name: output.name, manufacturer: output.manufacturer, state: output.state });
    console.log('PORTS ' + JSON.stringify(ports));
  };
  access.onstatechange = attach; attach();
})()`;
const uiCode = guidedMode => `(() => {
  const $ = id => document.getElementById(id);
  for (const action of ['back', 'next', 'finish']) $(action).onclick = () => console.log('UI ' + action);
  if (!${guidedMode}) { $('back').hidden = true; $('next').hidden = true; }
  window.render = fields => {
    for (const key of ['progress', 'step', 'seen', 'last']) if (key in fields) $(key).textContent = fields[key];
    if ('back' in fields) $('back').disabled = !fields.back;
  };
})()`;
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 620, height: 300, resizable: false, alwaysOnTop: true, title: 'Monitor MIDI', backgroundColor: '#0b1017',
    autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.on('close', event => { if (!finished) { event.preventDefault(); finish(); } });
  // Chromium asks for 'midiSysex' even for requestMIDIAccess({ sysex: false }); the page itself never enables SysEx.
  const allowed = (contents, permission) => contents === window.webContents && (permission === 'midi' || permission === 'midiSysex');
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(allowed(contents, permission)));
  window.webContents.session.setPermissionCheckHandler(allowed);
  window.webContents.on('console-message', ({ message: text }) => {
    if (text.startsWith('PORTS ')) {
      if (text === lastPorts) return; lastPorts = text;
      const ports = JSON.parse(text.slice(6));
      console.log('\nPuertos MIDI:');
      for (const port of ports) console.log(`  ${port.direction.padEnd(7)} ${port.name} [${port.manufacturer || 'sin fabricante'}] ${port.state}${port.listening ? ' ← escuchando' : ''}`);
      if (!ports.some(port => port.listening)) console.log('  Ninguna entrada coincide. Conecta la mesa o revisa --port=.');
    } else if (text.startsWith('MIDI ')) {
      const { port, data, time } = JSON.parse(text.slice(5));
      const result = capture.add(port, data, time); if (!result) return;
      const { control, isNew } = result; dirty = true;
      const raw = data.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
      const line = `${raw.padEnd(9)} ${control.type.padEnd(5)} ch${String(control.channel).padStart(2)} #${String(control.number ?? '-').padStart(3)} = ${String(result.message.value).padStart(5)}`;
      console.log(`${isNew ? '+' : ' '} ${line}  ${port}`);
      if (!stepControls.includes(control)) stepControls.push(control);
      render({ last: line, seen: `${stepControls.length} control(es) en este paso: ${stepControls.map(item => `${item.type} ch${item.channel} #${item.number ?? '-'}`).join(', ')}` });
    } else if (text.startsWith('UI ')) {
      const action = text.slice(3);
      if (action === 'finish') finish(); else if (guided) goTo(step + (action === 'next' ? 1 : -1));
    }
  });
  await window.loadFile(path.join(__dirname, 'midi-monitor.html'));
  try { await window.webContents.executeJavaScript(uiCode(guided)); await window.webContents.executeJavaScript(rendererCode(filter)); }
  catch (error) { console.error(`No se pudo abrir MIDI: ${error.message}`); finish(1); return; }
  console.log(guided ? '\nModo guiado: mueve solo el control indicado y pulsa «Siguiente» en la ventana.' : '\nMueve los controles de la mesa. «Terminar y guardar» o Ctrl+C para acabar.');
  if (guided) goTo(0); else render({ progress: 'Modo libre', step: 'Mueve los controles de la mesa', seen: '' });
  setInterval(() => { if (dirty) write(); }, 2000);
});
process.on('SIGINT', () => finish());
