import 'dotenv/config';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { createWebServer } from './webServer.js';
import * as store from './koppelingenStore.js';
import * as wa from './waConnection.js';
import * as router from './koppelingRouter.js';

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
 * Zet, indien nodig, een oudere configuratie om naar het huidige model
 * (één gedeelde WhatsApp-sessie + koppelingen in koppelingen.json):
 *
 *  - Tussenversie (dashboard met een eigen sessie per koppeling): als er
 *    een map data/auth/<uuid> met een sessie in staat, halen we die eruit
 *    en gebruiken 'm als de ene, gedeelde sessie.
 *  - Heel oude versie (vóór het dashboard): losse WHATSAPP_GROUP_NAME/
 *    CODA_*-omgevingsvariabelen -> worden de eerste koppeling.
 *
 * Beide stappen zijn no-ops als de betreffende oude situatie niet van
 * toepassing is, dus dit is veilig om bij elke opstart te controleren.
 */
function migrateIfNeeded() {
  const authRoot = path.resolve('data', 'auth');
  const flatCreds = path.join(authRoot, 'creds.json');

  if (!fs.existsSync(flatCreds) && fs.existsSync(authRoot) && fs.statSync(authRoot).isDirectory()) {
    const subdirs = fs
      .readdirSync(authRoot)
      .filter((name) => fs.statSync(path.join(authRoot, name)).isDirectory());
    const withSession = subdirs.find((name) => fs.existsSync(path.join(authRoot, name, 'creds.json')));

    if (withSession) {
      const tmp = path.resolve('data', '__auth_migrating__');
      fs.renameSync(path.join(authRoot, withSession), tmp);
      fs.rmSync(authRoot, { recursive: true, force: true });
      fs.renameSync(tmp, authRoot);
      logger.info('Bestaande WhatsApp-sessie samengevoegd tot de ene, gedeelde sessie.');
    }
  }

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
  store.addExistingKoppeling(koppeling);

  const oldSeenFile = path.resolve('data', 'seen-ids.json');
  const newSeenFile = path.resolve('data', `seen-${koppeling.id}.json`);
  if (fs.existsSync(oldSeenFile) && !fs.existsSync(newSeenFile)) {
    fs.copyFileSync(oldSeenFile, newSeenFile);
  }
}

async function main() {
  const publicBaseUrl = requireEnv('PUBLIC_BASE_URL');
  const port = Number(process.env.PORT || 3000);
  const dashboardUsername = process.env.DASHBOARD_USERNAME || 'admin';
  const dashboardPassword = requireEnv('DASHBOARD_PASSWORD');

  migrateIfNeeded();

  const webServer = createWebServer({ port, publicBaseUrl, logger, dashboardUsername, dashboardPassword });

  router.init({ logger, saveImage: webServer.saveImage });

  wa.start({
    logger,
    onMessage: (msg) => router.handleIncoming(msg),
    onGroupsResolved: () => router.refreshGroupMatches(),
  });

  router.loadAll();

  logger.info(
    `Dashboard bereikbaar op ${publicBaseUrl} (gebruikersnaam "${dashboardUsername}", wachtwoord uit DASHBOARD_PASSWORD).`
  );
}

main().catch((err) => {
  logger.error(`Fatale fout bij opstarten: ${err.message}`);
  process.exit(1);
});
