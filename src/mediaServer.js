/**
 * mediaServer.js
 *
 * Kleine Express-server die gedownloade WhatsApp-foto's lokaal opslaat en
 * publiek bereikbaar maakt via een simpele URL. Coda kan alleen foto's
 * overnemen als het zelf een URL kan ophalen, dus deze server is de
 * "brug" tussen WhatsApp-media (die niet openbaar is) en Coda.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const MEDIA_DIR = path.resolve('data', 'media');
const QR_IMAGE_PATH = path.resolve('data', 'qr.png');

export function createMediaServer({ port, publicBaseUrl, logger }) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const app = express();
  app.get('/health', (_req, res) => res.status(200).send('ok'));
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '365d', immutable: true }));

  // Handige pagina om de WhatsApp-QR-code te scannen wanneer de ASCII-QR in
  // de terminal/logs (bv. Railway's logvenster) niet leesbaar weergeeft.
  app.get('/qr', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!fs.existsSync(QR_IMAGE_PATH)) {
      return res
        .status(404)
        .send(
          'Nog geen QR-code beschikbaar. Als de app net is (her)start en er nog ' +
            'geen actieve WhatsApp-sessie is, verschijnt hier binnen enkele seconden ' +
            'een QR-code — herlaad deze pagina dan opnieuw.'
        );
    }
    res.sendFile(QR_IMAGE_PATH);
  });
  const server = app.listen(port, () => {
    logger.info(`Media-server luistert op poort ${port}`);
  });

  return {
    server,

    /**
     * Slaat een afbeeldingsbuffer op schijf op en geeft de publieke URL terug.
     */
    saveImage(buffer, mimetype) {
      const ext = mimetype && mimetype.includes('png') ? 'png' : 'jpg';
      const filename = `${crypto.randomUUID()}.${ext}`;
      fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
      const base = publicBaseUrl.replace(/\/$/, '');
      return `${base}/media/${filename}`;
    },
  };
}