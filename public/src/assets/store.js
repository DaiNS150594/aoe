// Tiny IndexedDB key/value store for the player's own Age of Empires files,
// so they only have to pick their game folder once per browser.
const DB = 'deche-aoe-assets';
const STORE = 'files';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      const out = fn(st);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

export async function putFiles(map) {
  await tx('readwrite', (st) => { for (const [k, v] of Object.entries(map)) st.put(v, k); });
}
export async function getFile(key) {
  return tx('readonly', (st) => st.get(key));
}
export async function getAll() {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const out = {};
      const t = db.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  } finally { db.close(); }
}
export async function clearAll() {
  await tx('readwrite', (st) => st.clear());
}
