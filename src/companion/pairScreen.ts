// First-run screen on an unlinked device: enter the code the desktop shows.
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { pairClaim } from '../sync/syncClient';
import { newDeviceId, saveSyncMeta } from '../sync/syncMeta';

export function renderPairScreen(host: HTMLElement, onPaired: () => void): void {
  const input = el('input', {
    class: 'comp-pair-input',
    placeholder: 'ABCD2345',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: '9',
  }) as HTMLInputElement;
  const error = el('div', { class: 'comp-pair-error' });
  const button = el(
    'button',
    {
      class: 'comp-btn primary',
      onclick: () => void submit(),
    },
    'Link this device',
  ) as HTMLButtonElement;

  async function submit(): Promise<void> {
    button.disabled = true;
    error.textContent = '';
    try {
      const creds = await pairClaim(input.value);
      if (!creds) {
        error.textContent = 'That code was not recognised — codes expire after 10 minutes and work once.';
      } else {
        saveSyncMeta({
          syncId: creds.syncId,
          secret: creds.secret,
          deviceId: newDeviceId(),
          lastSyncedSeq: 0,
          dirty: false,
        });
        onPaired();
        return;
      }
    } catch {
      error.textContent = 'Could not reach the pond — check your connection and try again.';
    }
    button.disabled = false;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submit();
  });

  host.replaceChildren(
    el(
      'div',
      { class: 'comp-pair' },
      el('div', { class: 'comp-pair-duck' }, icon('duck', 56)),
      el('h1', {}, 'Duck Homestead'),
      el('p', { class: 'comp-muted' }, 'The pocket pond. On your computer, open Save → “Companion & cloud sync” → “Show a pairing code”, then type it here.'),
      input,
      error,
      button,
    ),
  );
  input.focus();
}
