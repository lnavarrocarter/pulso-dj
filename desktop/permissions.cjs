// Chromium requests 'midiSysex' even for requestMIDIAccess({ sysex: false }). The renderer asks for SysEx only to send
// a controller profile's state request (src/controllers.mjs).
const isMIDI = permission => permission === 'midi' || permission === 'midiSysex';
function checkPermission(permission, details, cameraEnabled) {
  return isMIDI(permission) || (permission === 'media' && cameraEnabled && details?.mediaType === 'video');
}
function requestPermission(permission, details, cameraEnabled) {
  return isMIDI(permission) || (permission === 'media' && cameraEnabled && Array.isArray(details?.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'video');
}
module.exports = { checkPermission, requestPermission };
