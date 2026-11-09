const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/data.json'), 'utf8'));
class MemStorage {
  constructor() { this.m = {}; }
  getItem(k) { return k in this.m ? this.m[k] : null; }
  setItem(k, v) { this.m[k] = String(v); }
  removeItem(k) { delete this.m[k]; }
}
const { Store } = require('../js/store.js');
function makeStore(clock) {
  const c = clock || { t: Date.parse('2026-11-10T09:00:00') };
  const store = new Store({ storage: new MemStorage(), now: () => c.t });
  return { store, clock: c };
}
const DAY = 864e5;
module.exports = { ROOT, data, entries: data.entries, MemStorage, makeStore, DAY };
