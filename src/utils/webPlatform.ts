// Web platform utilities replacing Electron's dialog/fs/path APIs

export function pickAndReadFile(accept: string): Promise<{ data: ArrayBuffer; name: string }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ data: reader.result as ArrayBuffer, name: file.name });
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    };

    input.oncancel = () => {
      document.body.removeChild(input);
      reject(new Error('No file selected'));
    };

    input.click();
  });
}

export function pickAndReadTextFile(accept: string): Promise<{ text: string; name: string }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ text: reader.result as string, name: file.name });
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    };

    input.oncancel = () => {
      document.body.removeChild(input);
      reject(new Error('No file selected'));
    };

    input.click();
  });
}

export function downloadBlob(data: string | Uint8Array | Blob, filename: string, mimeType: string): void {
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (typeof data === 'string') {
    blob = new Blob([data], { type: mimeType });
  } else {
    blob = new Blob([data as BlobPart], { type: mimeType });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function setTitle(title: string): void {
  document.title = title;
}
