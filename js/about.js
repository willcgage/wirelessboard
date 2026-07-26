import '../css/colors.scss';
import '../css/about.scss';
import '@ibm/plex/css/ibm-plex.css';

function renderVersion() {
  const el = document.getElementById('version');
  if (el) {
    el.textContent = `Wirelessboard ${VERSION}`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderVersion, { once: true });
} else {
  renderVersion();
}
