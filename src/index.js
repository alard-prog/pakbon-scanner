import 'dotenv/config';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { createWebServer } from './webServer.js';
import * as store from './koppelingenStore.js';
import * as manager from './instanceManager.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    logger.error(`Ontbrekende omgevingsvariabele: ${name}. Zie .env.example.`);
    process.exit(1);
  }
  return value;
}

/**
 * Als er nog geen koppelingen zijn opgeslagen, maar de oude, enkelvoudige
 * omgevingsvariabelen (van vóór het dashboard) wel zijn ingesteld, zetten we
 * die automatisch om in de eerste koppeling. Zo verlies je bij deze update
 * niet de WhatsApp-sessie en Coda-koppeling die je al had opgezet.
 */
function migrateLegacyConfigIfNeeded() {
  if (store.listKoppelingen().length > 0) return;

  const { WHATSAPP_GROUP_NAME, CODA_API_TOKEN, CODA_DOC_ID, CODA_TABLE_ID, FLUSH_DELAY_MS } = process.env;
  if (!WHATSAPP_GROUP_NAME || !CODA_API_TOKEN || !CODA_DOC_ID || !CODA_TABLE_ID) return;

  logger.info('Oude enkelvoudige configuratie gevonden, omzetten naar de eerste koppeling...');

  const koppeling = {
    id: crypto.randomUUID(),
    name: WHATSAPP_GROUP_NAME,
    whatsappGroupName: WHATSAPP_GROUP_NAME,
    codaApiToken: CODA_API_TOKEN,
    codaDocId: CODA_DOC_ID,
    codaTableId: CODA_TABLE_ID,
    flushDelayMs: Number(FLUSH_DELAY_MS) || 15000,
    createdAt: Date.now(),
  };

  // De oude WhatsApp-sessie stond in data/auth (zonder submap per koppeling).
  // Verplaats die naar de nieuwe, per-koppeling locatie, zodat er niet
  // opnieuw een QR-code gescand hoeft te worden.
  const oldAuthDir = path.resolve('data', 'auth');
  const newAuthDir = path.resolve('data', 'auth', koppeling.id);
  const looksLikeOldSession =
    fs.existsSync(oldAuthDir) &&
    fs.statSync(oldAuthDir).isDirectory() &&
    fs.readdirSync(oldAuthDir).some((f) => f.startsWith('creds.json'));

  if (looksLikeOldSession) {
    // Je kunt een map niet direct hernoemen naar een submap van zichzelf
    // (data/auth -> data/auth/<id>), dus eerst even opzij zetten.
    const tmpDir = path.resolve('data', '__auth_migrating__');
    fs.renameSync(oldAuthDir, tmpDir);
    fs.mkdirSync(oldAuthDir, { recursive: true });
    fs.renameSync(tmpDir, newAuthDir);
    logger.info('Bestaande WhatsApp-sessie meegenomen naar de nieuwe koppeling.');
  }

  // Ook de oude, enkelvoudige seen-ids.json meenemen, zodat er geen
  // dubbele meldingen ontstaan voor berichten die al eerder verwerkt waren.
  const oldSeenFile = path.resolve('data', 'seen-ids.json');
  const newSeenFile = path.resolve('data', `seen-${koppeling.id}.json`);
  if (fs.existsSync(oldSeenFile) && !fs.existsSync(newSeenFile)) {
    fs.copyFileSync(oldSeenFile, newSeenFile);
  }

  store.addExistingKoppeling(koppeling);
}

async function main() {
  const publicBaseUrl = requireEnv('PUBLIC_BASE_URL');
  const port = Number(process.env.PORT || 3000);
  const dashboardUsername = process.env.DASHBOARD_USERNAME || 'admin';
  const dashboardPassword = requireEnv('DASHBOARD_PASSWORD');

  migrateLegacyConfigIfNeeded();

  const webServer = createWebServer({
    port,
    publicBaseUrl,
    logger,
    dashboardUsername,
    dashboardPassword,
  });

  const koppelingen = store.listKoppelingen();
  logger.info(`${koppelingen.length} koppeling(en) gevonden, starten...`);
  for (const koppeling of koppelingen) {
    await manager.startInstance(koppeling, { logger, saveImage: webServer.saveImage });
  }

  logger.info(
    `Dashboard bereikbaar op ${publicBaseUrl} (gebruikersnaam "${dashboardUsername}", wachtwoord uit DASHBOARD_PASSWORD).`
  );
}

main().catch((err) => {
  logger.error(`Fatale fout bij opstarten: ${err.message}`);
  process.exit(1);
});
