/**
 * koppelingenStore.js
 *
 * Bewaart de lijst van "koppelingen" (elke koppeling = één WhatsApp-groep
 * die naar één Coda-tabel wordt geschreven) in een JSON-bestand op de
 * persistente Railway Volume. Zo overleven ze een herstart/nieuwe deploy,
 * en kun je via het dashboard koppelingen toevoegen/bewerken/verwijderen
 * zonder de code aan te passen.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FILE = path.resolve('data', 'koppelingen.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function normalize(data) {
  return {
    name: (data.name || '').trim(),
    whatsappGroupName: (data.whatsappGroupName || '').trim(),
    codaApiToken: (data.codaApiToken || '').trim(),
    codaDocId: (data.codaDocId || '').trim(),
    codaTableId: (data.codaTableId || '').trim(),
    flushDelayMs: Number(data.flushDelayMs) || 15000,
  };
}

export function listKoppelingen() {
  return readAll();
}

export function getKoppeling(id) {
  return readAll().find((k) => k.id === id) || null;
}

export function createKoppeling(data) {
  const list = readAll();
  const koppeling = {
    id: crypto.randomUUID(),
    ...normalize(data),
    createdAt: Date.now(),
  };
  list.push(koppeling);
  writeAll(list);
  return koppeling;
}

/**
 * Voegt een al volledig samengestelde koppeling toe (met vast id).
 * Wordt alleen gebruikt bij het automatisch migreren van de oude,
 * enkelvoudige omgevingsvariabelen-configuratie.
 */
export function addExistingKoppeling(koppeling) {
  const list = readAll();
  list.push(koppeling);
  writeAll(list);
  return koppeling;
}

export function updateKoppeling(id, data) {
  const list = readAll();
  const idx = list.findIndex((k) => k.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...normalize(data) };
  writeAll(list);
  return list[idx];
}

export function deleteKoppeling(id) {
  const list = readAll();
  const filtered = list.filter((k) => k.id !== id);
  writeAll(filtered);
  return filtered.length !== list.length;
}
