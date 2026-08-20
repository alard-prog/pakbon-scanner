/**
 * instanceManager.js
 *
 * Houdt voor elke "koppeling" (WhatsApp-groep -> Coda-tabel) een eigen,
 * onafhankelijke draaiende instantie bij: eigen WhatsApp-sessie, eigen
 * Coda-client, eigen dubbele-berichten-check. Het dashboard (webServer.js)
 * gebruikt deze module om koppelingen te starten/stoppen/statussen op te
 * vragen, zonder dat koppelingen elkaar kunnen beïnvloeden.
 */

import fs from 'fs';
import path from 'path';

import { startWhatsApp } from './whatsappClient.js';
import { createCodaClient } from './codaClient.js';
import { createReportBuffer } from './reportBuffer.js';
import { createSeenStore } from './seenStore.js';

/** @type {Map<string, { status: string, qrBuffer: Buffer|null, controller: { stop: () => void }|null, koppeling: object }>} */
const instances = new Map();

function authDirFor(id) {
  return path.resolve('data', 'auth', id);
}

export function getStatus(id) {
  return instances.get(id)?.status || 'stopped';
}

export function getQrBuffer(id) {
  return instances.get(id)?.qrBuffer || null;
}

export function isRunning(id) {
  return instances.has(id);
}

/**
 * Start een koppeling. Doet niets als deze al draait (gebruik eerst
 * stopInstance() als je 'm wilt herstarten met nieuwe instellingen).
 */
export async function startInstance(koppeling, { logger, saveImage }) {
  if (instances.has(koppeling.id)) return;

  const instanceLogger = logger.child({ koppeling: koppeling.name });
  const record = { status: 'starting', qrBuffer: null, controller: null, koppeling };
  instances.set(koppeling.id, record);

  const coda = createCodaClient({
    apiToken: koppeling.codaApiToken,
    docId: koppeling.codaDocId,
    tableId: koppeling.codaTableId,
    logger: instanceLogger,
  });
  const seen = createSeenStore(koppeling.id);

  try {
    instanceLogger.info('Bestaande Coda-rijen ophalen om dubbele meldingen te voorkomen...');
    const knownIds = await coda.fetchKnownMessageIds();
    seen.seedFrom(knownIds);
  } catch (err) {
    instanceLogger.warn(`Kon bestaande rijen niet ophalen: ${err.message}`);
  }

  const reportBuffer = createReportBuffer({
    flushDelayMs: koppeling.flushDelayMs || 15000,
    onReport: async (report) => {
      if (seen.has(report.id)) {
        instanceLogger.info(`Melding ${report.id} is al eerder verwerkt, overslaan.`);
        return;
      }
      try {
        const photoUrls = report.images.map((img) => saveImage(img.buffer, img.mimetype));
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

  const controller = startWhatsApp({
    authDir: authDirFor(koppeling.id),
    groupName: koppeling.whatsappGroupName,
    logger: instanceLogger,
    onText: ({ senderId, senderName, text, timestamp, messageId }) => {
      reportBuffer.addText(senderId, senderName, text, timestamp, messageId);
    },
    onImage: ({ senderId, senderName, buffer, mimetype, caption, timestamp, messageId }) => {
      reportBuffer.addImage(senderId, senderName, buffer, mimetype, caption, timestamp, messageId);
    },
    onQr: (buffer) => {
      record.qrBuffer = buffer;
    },
    onStatus: (status) => {
      record.status = status;
    },
  });

  record.controller = controller;
}

/** Stopt een draaiende koppeling (de WhatsApp-sessie blijft op schijf staan). */
export function stopInstance(id) {
  const record = instances.get(id);
  if (!record) return;
  record.controller?.stop();
  instances.delete(id);
}

/** Herstart een koppeling met (mogelijk gewijzigde) instellingen. */
export async function restartInstance(koppeling, deps) {
  stopInstance(koppeling.id);
  await startInstance(koppeling, deps);
}

/** Stopt de koppeling en verwijdert ook de opgeslagen WhatsApp-sessie. */
export function removeInstanceAndData(id) {
  stopInstance(id);
  const dir = authDirFor(id);
  fs.rmSync(dir, { recursive: true, force: true });
  const seenFile = path.resolve('data', `seen-${id}.json`);
  fs.rmSync(seenFile, { force: true });
}
