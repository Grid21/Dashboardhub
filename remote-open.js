// top bar button: open the separate Remote view window.
(function () {
  'use strict';
  const b = document.getElementById('remoteBtn');
  if (b && window.remoteViewApi) b.addEventListener('click', () => { window.remoteViewApi.open(); });
})();
