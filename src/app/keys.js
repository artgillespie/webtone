// Computer keyboard: piano (Ableton-style layout) + shortcuts.

/** Ableton-style computer piano: A=C, W=C#, ... ; = E (one octave + a third). */
export const KEYMAP = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];
export const KEYLABEL = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P', ';'];

const PAGE_KEYS = { Digit1: 'TRIG', Digit2: 'SYN1', Digit3: 'SYN2', Digit4: 'SYN3', Digit5: 'FLTR1', Digit6: 'FLTR2', Digit7: 'AMP', Digit8: 'FX', Digit9: 'LFO', Digit0: 'ARP' };

export function installKeys(host) {
  const { store, actions } = host;
  const down = new Map(); // code -> note

  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };

  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      if (e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
      else if (e.code === 'KeyC') { e.preventDefault(); actions.copySteps(); }
      else if (e.code === 'KeyV') { e.preventDefault(); actions.pasteSteps(); }
      return;
    }
    const pianoIdx = KEYMAP.indexOf(e.code);
    if (pianoIdx >= 0 && !e.altKey) {
      e.preventDefault();
      if (e.repeat || down.has(e.code)) return;
      const note = store.ui.octave * 12 + pianoIdx;
      down.set(e.code, note);
      actions.noteOn(note);
      return;
    }
    if (e.repeat && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) return;
    switch (e.code) {
      case 'Space': e.preventDefault(); actions.togglePlay(); break;
      case 'KeyR': actions.toggleRecord(); break;
      case 'KeyZ': store.setUI({ octave: Math.max(0, store.ui.octave - 1) }); break;
      case 'KeyX': store.setUI({ octave: Math.min(9, store.ui.octave + 1) }); break;
      case 'KeyC': store.setUI({ velocity: Math.max(1, store.ui.velocity - 10) }); break;
      case 'KeyV': store.setUI({ velocity: Math.min(127, store.ui.velocity + 10) }); break;
      case 'Backquote': actions.setFill(true); break;
      case 'ArrowUp': e.preventDefault(); actions.selectTrack(store.ui.track - 1); break;
      case 'ArrowDown': e.preventDefault(); actions.selectTrack(store.ui.track + 1); break;
      case 'ArrowLeft': e.preventDefault(); actions.setStepPage(store.ui.stepPage - 1); break;
      case 'ArrowRight': e.preventDefault(); actions.setStepPage(store.ui.stepPage + 1); break;
      case 'KeyQ': actions.toggleMute(); break;
      case 'KeyB': host.command('open', 'song'); break;
      case 'KeyM': host.command('open', 'mixer'); break;
      case 'KeyN': host.command('open', 'sounds'); break;
      case 'KeyI': host.command('open', 'patterns'); break;
      case 'Backslash': host.cycleUI(); break;
      case 'Escape':
        if (!host.command('escape')) actions.clearSelection();
        break;
      case 'Backspace': case 'Delete': e.preventDefault(); actions.clearSelectedSteps(); break;
      case 'Slash': if (e.shiftKey) host.command('open', 'help'); break;
      default:
        if (PAGE_KEYS[e.code]) {
          const p = PAGE_KEYS[e.code];
          if (!host.command('page', p)) { if (p === 'LFO') actions.cyclePage('LFO'); else actions.selectPage(p); }
        }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (down.has(e.code)) { actions.noteOff(down.get(e.code)); down.delete(e.code); }
    if (e.code === 'Backquote') actions.setFill(false);
  });
  window.addEventListener('blur', () => { for (const n of down.values()) actions.noteOff(n); down.clear(); });
}
