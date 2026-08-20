/**
 * koppelingRouter.js
 *
 * Houdt voor elke koppeling (WhatsApp-groep -> Coda-tabel) een eigen
 * berichten-buffer, Coda-client en dubbele-berichten-check bij, en stuurt
 * binnenkomende WhatsApp-berichten (van de ene, gedeelde verbinding uit
 * waConnection.js) door naar de juiste koppeling(en), op basis van de groep
 * waar het bericht uit komt.
 */

import fs from 'fs';
import path from 'path';

import * as store from './koppelingenStore.js';
import * as wa from './waConnection.js';
import { createCodaClient } from './codaClient.js';
import { createReportBuffer } from './reportBuffer.js';
import { createSeenStore } from './seenStore.js';

/** @type {Map<string, { koppeling: object, buffer: object, groupJid: string|null }>} */
const active = new Map();

let deps = { logger: null, saveImage: null };

export function init({ logger, saveImage }) {
  deps = { logger, saveImage };
}

function buildEntry(koppeling) {
  const instanceLogger = deps.logger.child({ koppeling: koppeling.name });
  const coda = createCodaClient({
    apiToken: koppeling.codaApiToken,
    docId: koppeling.codaDocId,
    tableId: koppeling.codaTableId,
    logger: instanceLogger,
  });
  const seen = createSeenStore(koppeling.id);

  coda
    .fetchKnownMessageIds()
    .then((ids) => seen.seedFrom(ids))
    .catch((err) => instanceLogger.warn(`Kon bestaande rijen niet ophalen: ${err.message}`));

  const buffer = createReportBuffer({
    flushDelayMs: koppeling.flushDelayMs || 15000,
    onReport: async (report) => {
      if (seen.has(report.id)) {
        instanceLogger.info(`Melding ${report.id} is al eerder verwerkt, overslaan.`);
        return;
      }
      try {
        const photoUrls = report.images.map((img) => deps.saveImage(img.buffer, img.mimetype));
        await coda.pushReport({
          sender: report.sender,
          text: report.text,
          photoUrls,
          timestamp: report.timestamp,
          messageId: report.id,
        });
        seen.add(report.id);
        instanceLogger.info(`Melding van ${report.sender} met ${photoUrls.length} foto('s) geregistreerd in Coda.`);
      } catch (err) {
        instanceLogger.error(`Kon melding niet wegschrijven naar Coda: ${err.message}`);
      }
    },
  });

  return { koppeling, buffer, groupJid: wa.findGroupJidByName(koppeling.whatsappGroupName) };
}

/** Laadt alle opgeslagen koppelingen (bij het opstarten van de app). */
export function loadAll() {
  for (const koppeling of store.listKoppelingen()) {
    active.set(koppeling.id, buildEntry(koppeling));
  }
}

export function addKoppeling(koppeling) {
  active.set(koppeling.id, buildEntry(koppeling));
}

export function updateKoppeling(koppeling) {
  active.set(koppeling.id, buildEntry(koppeling));
}

export function removeKoppeling(id) {
  active.delete(id);
  fs.rmSync(path.resolve('data', `seen-${id}.json`), { force: true });
}

/**
 * Zoekt opnieuw de groep-JID op voor alle koppelingen. Wordt aangeroepen
 * zodra waConnection.js een (nieuwe) groepenlijst heeft opgehaald.
 */
export function refreshGroupMatches() {
  for (const entry of active.values()) {
    entry.groupJid = wa.findGroupJidByName(entry.koppeling.whatsappGroupName);
  }
}

/** Geeft aan of de doelgroep van een koppeling momenteel gevonden is. */
export function isGroupFound(id) {
  return Boolean(active.get(id)?.groupJid);
}

/** Wordt door waConnection.js aangeroepen voor elk binnenkomend groepsbericht. */
export function handleIncoming({ groupJid, kind, senderId, senderName, messageId, timestamp, text, buffer, mimetype, caption }) {
  for (const entry of active.values()) {
    if (entry.groupJid !== groupJid) continue;
    if (kind === 'text') {
      entry.buffer.addText(senderId, senderName, text, timestamp, messageId);
    } else if (kind === 'image') {
      entry.buffer.addImage(senderId, senderName, buffer, mimetype, caption, timestamp, messageId);
    }
  }
}
