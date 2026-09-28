// Boot: create the headless host, then mount the selected UI plugin.
// Choose a UI with ?ui=<id>, the in-app settings, `\`, or dt.useUI(id).
import { createHost } from './host.js';

const host = createHost(document.getElementById('ui-root'));
window.__host = host; // debugging handle (prefer window.dt)
host.start();
