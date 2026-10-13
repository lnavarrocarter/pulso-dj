function checkPermission(permission, details, cameraEnabled) {
  return permission === 'midi' || (permission === 'media' && cameraEnabled && details?.mediaType === 'video');
}
function requestPermission(permission, details, cameraEnabled) {
  return permission === 'midi' || (permission === 'media' && cameraEnabled && Array.isArray(details?.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'video');
}
module.exports = { checkPermission, requestPermission };
