// Browser stub for Node.js 'fs' module
// c64jasm references fs at import time but doesn't need it in browser mode
const noop = () => { throw new Error('fs not available in browser'); };
export const readFileSync = noop;
export const writeFileSync = noop;
export const existsSync = () => false;
export default { readFileSync, writeFileSync, existsSync };
