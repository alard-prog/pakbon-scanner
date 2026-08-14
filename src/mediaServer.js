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
import QRCode from 'qrcode';
import { getLatestQr } from './qrState.js';

const MEDIA_DIR = path.resolve('data', 'media');

export function createMediaServer({ port, publicBaseUrl, logger }) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const app = express();
  app.get('/health', (_req, res) => res.status(200).send('ok'));
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '365d', immutable: true }));

  // Genereert de QR-afbeelding "live" (in het geheugen, niet vanaf schijf)
  // op basis van de meest recente QR-waarde die whatsappClient.js heeft
  // doorgegeven. Geen bestand nodig, dus geen pad/timing-problemen.
  app.get('/qr.png', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const qr = getLatestQr();
    if (!qr) {
      return res.status(404).send('Nog geen QR-code beschikbaar.');
    }
    try {
      const buffer = await QRCode.toBuffer(qr, { width: 400 });
      res.set('Content-Type', 'image/png');
      res.send(buffer);
    } catch (err) {
      logger.error(`Kon QR-afbeelding niet genereren: ${err.message}`);
      res.status(500).send('Kon QR-afbeelding niet genereren.');
    }
  });

  // Pagina die de QR-afbeelding toont en zichzelf elke paar seconden
  // automatisch vernieuwt, zodat je niet handmatig steeds moet herladen
  // om een geldige (niet-verlopen) QR-code te pakken te krijgen.
  app.get('/qr', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <title>WhatsApp QR-code scannen</title>
    <style>
      body { font-family: sans-serif; text-align: center; padding: 2rem; background: #111; color: #eee; }
      img { max-width: 320px; width: 90vw; background: #fff; padding: 1rem; border-radius: 8px; }
      p { max-width: 420px; margin: 1rem auto; }
    </style>
  </head>
  <body>
    <h1>Scan met WhatsApp</h1>
    <p>Instellingen &rarr; Gekoppelde apparaten &rarr; Apparaat koppelen.</p>
    <img id="qr" src="/qr.png?t=0" alt="QR-code" onerror="this.style.opacity=0.3" />
    <p id="status">Deze pagina vernieuwt automatisch elke paar seconden.</p>
    <script>
      const img = document.getElementById('qr');
      const statusEl = document.getElementById('status');
      setInterval(() => {
        const t = Date.now();
        const testImg = new Image();
        testImg.onload = () => { img.src = '/qr.png?t=' + t; statusEl.textContent = 'Laatste update: ' + new Date().toLocaleTimeString(); };
        testImg.onerror = () => { statusEl.textContent = 'Wachten op een nieuwe QR-code (nog niet beschikbaar of de app is inmiddels verbonden)...'; };
        testImg.src = '/qr.png?t=' + t;
      }, 3000);
    </script>
  </body>
</html>`);
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