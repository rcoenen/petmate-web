// Async asset loader - replaces fs.readFileSync for binary assets

let _systemFontData: Uint8Array;
let _systemFontDataLower: Uint8Array;
let _executablePrgTemplate: Uint8Array;

export async function loadAssets(): Promise<void> {
  const [charset, charsetLower, template] = await Promise.all([
    fetch('./assets/system-charset.bin').then(r => r.arrayBuffer()),
    fetch('./assets/system-charset-lower.bin').then(r => r.arrayBuffer()),
    fetch('./assets/template.prg').then(r => r.arrayBuffer()),
  ]);
  _systemFontData = new Uint8Array(charset);
  _systemFontDataLower = new Uint8Array(charsetLower);
  _executablePrgTemplate = new Uint8Array(template);
}

export function getSystemFontData(): Uint8Array {
  if (!_systemFontData) throw new Error('Assets not loaded');
  return _systemFontData;
}

export function getSystemFontDataLower(): Uint8Array {
  if (!_systemFontDataLower) throw new Error('Assets not loaded');
  return _systemFontDataLower;
}

export function getExecutablePrgTemplate(): Uint8Array {
  if (!_executablePrgTemplate) throw new Error('Assets not loaded');
  return _executablePrgTemplate;
}
