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

export function createMediaServer({ port, publicBaseUrl, logger }) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const app = express();
  app.get('/health', (_req, res) => res.status(200).send('ok'));
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '365d', immutable: true }));

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
