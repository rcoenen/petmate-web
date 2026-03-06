/**
 * Non-blocking HTML alert dialog (single OK button).
 */
export function showAlert(message: string, { okLabel = 'OK' } = {}): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.6)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:99999', 'font-family:system-ui,sans-serif',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#2a2a2a', 'color:#eee', 'padding:24px 28px',
      'border-radius:6px', 'max-width:400px', 'width:90%',
      'border:1px solid #555', 'box-shadow:0 8px 32px rgba(0,0,0,0.8)',
    ].join(';');

    const msg = document.createElement('p');
    msg.style.cssText = 'margin:0 0 20px;line-height:1.5;font-size:14px;white-space:pre-wrap;';
    msg.textContent = message;

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:flex-end;';

    const okBtn = document.createElement('button');
    okBtn.textContent = okLabel;
    okBtn.style.cssText = 'padding:6px 16px;border:none;border-radius:4px;font-size:13px;cursor:pointer;min-width:64px;background:#0078d4;color:#fff;';

    buttons.appendChild(okBtn);
    box.appendChild(msg);
    box.appendChild(buttons);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const finish = () => {
      document.body.removeChild(overlay);
      resolve();
    };

    okBtn.addEventListener('click', finish);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(); });
    okBtn.focus();
  });
}

/**
 * Non-blocking HTML confirm dialog — returns a Promise instead of
 * blocking the JS thread like window.confirm does.
 */
export function showConfirm(message: string, { okLabel = 'OK', cancelLabel = 'Cancel' } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.6)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:99999', 'font-family:system-ui,sans-serif',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#2a2a2a', 'color:#eee', 'padding:24px 28px',
      'border-radius:6px', 'max-width:400px', 'width:90%',
      'border:1px solid #555', 'box-shadow:0 8px 32px rgba(0,0,0,0.8)',
    ].join(';');

    const msg = document.createElement('p');
    msg.style.cssText = 'margin:0 0 20px;line-height:1.5;font-size:14px;white-space:pre-wrap;';
    msg.textContent = message;

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    const btnStyle = 'padding:6px 16px;border:none;border-radius:4px;font-size:13px;cursor:pointer;min-width:64px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = cancelLabel;
    cancelBtn.style.cssText = btnStyle + 'background:#444;color:#eee;';

    const okBtn = document.createElement('button');
    okBtn.textContent = okLabel;
    okBtn.style.cssText = btnStyle + 'background:#0078d4;color:#fff;';

    buttons.appendChild(cancelBtn);
    buttons.appendChild(okBtn);
    box.appendChild(msg);
    box.appendChild(buttons);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const finish = (result: boolean) => {
      document.body.removeChild(overlay);
      resolve(result);
    };

    okBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });

    okBtn.focus();
  });
}

export function showToast(message: string, duration = 2200): void {
  const toast = document.createElement('div');
  toast.style.cssText = [
    'position:fixed',
    'bottom:22px',
    'left:50%',
    'transform:translateX(-50%)',
    'background:#1f1f1f',
    'color:#eee',
    'border:1px solid #555',
    'border-radius:4px',
    'padding:8px 12px',
    'font-size:13px',
    'line-height:1.4',
    'z-index:99999',
    'font-family:system-ui,sans-serif',
    'box-shadow:0 8px 20px rgba(0,0,0,0.6)',
    'pointer-events:none'
  ].join(';');
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, duration);
}

export function showManualCopyDialog(url: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.6)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:99999', 'font-family:system-ui,sans-serif',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#2a2a2a', 'color:#eee', 'padding:20px 24px',
      'border-radius:6px', 'max-width:720px', 'width:92%',
      'border:1px solid #555', 'box-shadow:0 8px 32px rgba(0,0,0,0.8)',
    ].join(';');

    const msg = document.createElement('p');
    msg.style.cssText = 'margin:0 0 12px;line-height:1.5;font-size:14px;white-space:pre-wrap;';
    msg.textContent = 'Clipboard access failed. Copy this URL manually:';

    const field = document.createElement('textarea');
    field.value = url;
    field.readOnly = true;
    field.rows = 4;
    field.style.cssText = [
      'width:100%',
      'resize:none',
      'padding:8px',
      'background:#191919',
      'color:#f5f5f5',
      'border:1px solid #666',
      'border-radius:4px',
      'font-size:12px'
    ].join(';');

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px;';

    const btnStyle = 'padding:6px 16px;border:none;border-radius:4px;font-size:13px;cursor:pointer;min-width:72px;';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Select';
    copyBtn.style.cssText = `${btnStyle}background:#444;color:#eee;`;

    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = `${btnStyle}background:#0078d4;color:#fff;`;

    buttons.appendChild(copyBtn);
    buttons.appendChild(okBtn);
    box.appendChild(msg);
    box.appendChild(field);
    box.appendChild(buttons);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const finish = () => {
      document.body.removeChild(overlay);
      resolve();
    };

    const selectField = () => {
      field.focus();
      field.select();
    };
    copyBtn.addEventListener('click', selectField);
    okBtn.addEventListener('click', finish);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(); });
    selectField();
  });
}
