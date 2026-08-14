import 'dotenv/config';
import pino from 'pino';

import { startWhatsApp } from './whatsappClient.js';
import { createMediaServer } from './mediaServer.js';
import { createCodaClient } from './codaClient.js';
import { createReportBuffer } from './reportBuffer.js';
import { createSeenStore } from './seenStore.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    logger.error(`Ontbrekende omgevingsvariabele: ${name}. Zie .env.example.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const groupName = requireEnv('WHATSAPP_GROUP_NAME');
  const codaApiToken = requireEnv('CODA_API_TOKEN');
  const codaDocId = requireEnv('CODA_DOC_ID');
  const codaTableId = requireEnv('CODA_TABLE_ID');
  const publicBaseUrl = requireEnv('PUBLIC_BASE_URL');
  const port = Number(process.env.PORT || 3000);
  const flushDelayMs = Number(process.env.FLUSH_DELAY_MS || 15000);

  const mediaServer = createMediaServer({ port, publicBaseUrl, logger });
  const coda = createCodaClient({ apiToken: codaApiToken, docId: codaDocId, tableId: codaTableId, logger });
  const seen = createSeenStore();

  logger.info('Bestaande Coda-rijen ophalen om dubbele meldingen te voorkomen...');
  const knownIds = await coda.fetchKnownMessageIds();
  seen.seedFrom(knownIds);

  const reportBuffer = createReportBuffer({
    flushDelayMs,
    onReport: async (report) => {
      if (seen.has(report.id)) {
        logger.info(`Melding ${report.id} is al eerder verwerkt, overslaan.`);
        return;
      }
      try {
        const photoUrls = report.images.map((img) => mediaServer.saveImage(img.buffer, img.mimetype));
        await coda.pushReport({
          sender: report.sender,
          text: report.text,
          photoUrls,
          timestamp: report.timestamp,
          messageId: report.id,
        });
        seen.add(report.id);
        logger.info(`Melding van ${report.sender} met ${photoUrls.length} foto('s) geregistreerd in Coda.`);
      } catch (err) {
        logger.error(`Kon melding niet wegschrijven naar Coda: ${err.message}`);
      }
    },
  });

  await startWhatsApp({
    groupName,
    logger,
    onText: ({ senderId, senderName, text, timestamp, messageId }) => {
      reportBuffer.addText(senderId, senderName, text, timestamp, messageId);
    },
    onImage: ({ senderId, senderName, buffer, mimetype, caption, timestamp, messageId }) => {
      reportBuffer.addImage(senderId, senderName, buffer, mimetype, caption, timestamp, messageId);
    },
  });

  logger.info('WhatsApp-naar-Coda logger draait. Wachten op berichten...');
}

main().catch((err) => {
  logger.error(`Fatale fout bij opstarten: ${err.message}`);
  process.exit(1);
});
