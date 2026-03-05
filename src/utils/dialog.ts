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
    msg.style.cssText = 'margin:0 0 20px;line-height:1.5;font-size:14px;';
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
