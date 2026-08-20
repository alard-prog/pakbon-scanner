/**
 * seenStore.js
 *
 * Simpele, op schijf bewaarde set van al verwerkte bericht-ID's, zodat een
 * herstart van de app niet leidt tot dubbele rijen in Coda. Per koppeling
 * (instanceId) wordt een eigen bestand gebruikt, zodat koppelingen
 * elkaars dubbele-check niet beïnvloeden.
 */

import fs from 'fs';
import path from 'path';

const MAX_ENTRIES = 2000;

export function createSeenStore(instanceId) {
  const filename = instanceId ? `seen-${instanceId}.json` : 'seen-ids.json';
  const FILE = path.resolve('data', filename);

  let ids = [];
  try {
    ids = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    ids = [];
  }
  const set = new Set(ids);

  function persist() {
    const trimmed = Array.from(set).slice(-MAX_ENTRIES);
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(trimmed));
  }

  return {
    has: (id) => set.has(id),
    add: (id) => {
      set.add(id);
      persist();
    },
    seedFrom: (idsIterable) => {
      for (const id of idsIterable) set.add(id);
      persist();
    },
  };
}
