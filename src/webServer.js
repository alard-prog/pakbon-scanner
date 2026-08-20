/**
 * webServer.js
 *
 * Eén Express-server die vier dingen doet:
 *   1. Host de gedownloade WhatsApp-foto's publiek (/media/...), zodat Coda
 *      ze kan overnemen.
 *   2. Toont een QR-scanpagina voor het ene, gedeelde WhatsApp-account
 *      (/account/qr), inclusief de mogelijkheid om een ander account te
 *      koppelen.
 *   3. Toont een dashboard (/) waarmee je koppelingen (WhatsApp-groep ->
 *      Coda-tabel) kunt toevoegen, bewerken en verwijderen.
 *   4. Beveiligt dashboard en account-pagina's met een wachtwoord.
 *
 * /media en /health blijven bewust open, zonder wachtwoord: Coda en
 * Railway's health-check kunnen geen wachtwoord meesturen.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import * as store from './koppelingenStore.js';
import * as wa from './waConnection.js';
import * as router from './koppelingRouter.js';

const MEDIA_DIR = path.resolve('data', 'media');

const ACCOUNT_STATUS_LABELS = {
  stopped: 'Gestopt',
  starting: 'Opstarten...',
  waiting_for_qr: 'Wacht op QR-scan',
  connected: 'Verbonden',
  reconnecting: 'Opnieuw verbinden...',
  logged_out: 'Uitgelogd (nieuwe QR-scan nodig)',
  error: 'Fout bij opstarten',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function layout(title, body) {
  return `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: sans-serif; background: #111; color: #eee; margin: 0; padding: 2rem 1rem; }
      main { max-width: 760px; margin: 0 auto; }
      h1 { font-size: 1.4rem; }
      h2 { font-size: 1.1rem; margin-top: 2rem; }
      a { color: #8ab4f8; }
      section.card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
      table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
      th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #333; vertical-align: top; }
      .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.8rem; }
      .badge-ok { background: #1e4620; color: #8fd99f; }
      .badge-wait { background: #4a3c12; color: #f0c96b; }
      .badge-bad { background: #4a1e1e; color: #f08f8f; }
      .actions a, .actions button { margin-right: 0.5rem; font-size: 0.85rem; }
      form { margin: 1rem 0; }
      label { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.9rem; }
      input { width: 100%; box-sizing: border-box; padding: 0.5rem; border-radius: 4px; border: 1px solid #444; background: #1a1a1a; color: #eee; }
      button, .btn { background: #3a5ba0; color: #fff; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; text-decoration: none; display: inline-block; }
      button.danger, .btn.danger { background: #7a2c2c; }
      button.secondary, .btn.secondary { background: #444; }
      .top-actions { margin-bottom: 1rem; }
      .hint { color: #999; font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

function koppelingBadge(status) {
  const cls = status === 'gevonden' ? 'badge-ok' : 'badge-wait';
  const text = status === 'gevonden' ? 'Actief' : 'Groep niet (nog) gevonden';
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function accountBadge(status) {
  const cls = status === 'connected' ? 'badge-ok' : ['logged_out', 'error'].includes(status) ? 'badge-bad' : 'badge-wait';
  return `<span class="badge ${cls}">${escapeHtml(ACCOUNT_STATUS_LABELS[status] || status)}</span>`;
}

function koppelingForm({ action, koppeling = {}, submitLabel }) {
  const knownGroups = wa.getKnownGroups();
  const datalist = knownGroups.length
    ? `<datalist id="group-options">${knownGroups
        .map((g) => `<option value="${escapeHtml(g.subject)}"></option>`)
        .join('')}</datalist>`
    : '';
  const groupHint = knownGroups.length
    ? 'Begin te typen voor suggesties uit de groepen waar het gekoppelde account nu al lid van is.'
    : 'Nog geen groepenlijst beschikbaar (account nog niet verbonden) — vul de groepsnaam exact in.';

  return `
    <form method="post" action="${action}">
      <label>Naam (voor jezelf, bv. "Bar Voorraad")</label>
      <input name="name" required value="${escapeHtml(koppeling.name)}" />

      <label>Exacte naam van de WhatsApp-groep</label>
      <input name="whatsappGroupName" required list="group-options" value="${escapeHtml(koppeling.whatsappGroupName)}" />
      ${datalist}
      <p class="hint">${groupHint}</p>

      <label>Coda API-token</label>
      <input name="codaApiToken" required value="${escapeHtml(koppeling.codaApiToken)}" />

      <label>Coda Doc ID (het stuk na "_d" in de doc-URL, mét de "d" ervoor)</label>
      <input name="codaDocId" required value="${escapeHtml(koppeling.codaDocId)}" />

      <label>Coda Table ID of exacte tabelnaam</label>
      <input name="codaTableId" required value="${escapeHtml(koppeling.codaTableId)}" />

      <label>Wachttijd na laatste bericht voordat een melding compleet is (ms)</label>
      <input name="flushDelayMs" type="number" value="${escapeHtml(koppeling.flushDelayMs || 15000)}" />

      <p class="hint">
        De Coda-tabel moet de kolommen <code>Datum</code>, <code>Naam van
        persoon invult</code>, <code>Opmerking</code>, <code>Foto</code>
        (kolomtype Image, "Allow multiple values" aan) en <code>Bericht
        ID</code> bevatten.
      </p>

      <button type="submit">${escapeHtml(submitLabel)}</button>
      <a class="btn secondary" href="/">Annuleren</a>
    </form>`;
}

function qrPageHtml() {
  return `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <title>WhatsApp-account koppelen</title>
    <style>
      body { font-family: sans-serif; text-align: center; padding: 2rem; background: #111; color: #eee; }
      img { max-width: 320px; width: 90vw; background: #fff; padding: 1rem; border-radius: 8px; }
      p { max-width: 420px; margin: 1rem auto; }
      a { color: #8ab4f8; }
    </style>
  </head>
  <body>
    <h1>Scan met WhatsApp</h1>
    <p>Instellingen &rarr; Gekoppelde apparaten &rarr; Apparaat koppelen. Gebruik het account dat lid is (of moet worden) van de groepen die je wilt uitlezen.</p>
    <img id="qr" src="/account/qr.png?t=0" alt="QR-code" onerror="this.style.opacity=0.3" />
    <p id="status">Deze pagina vernieuwt automatisch elke paar seconden.</p>
    <p><a href="/">&larr; Terug naar het dashboard</a></p>
    <script>
      const img = document.getElementById('qr');
      const statusEl = document.getElementById('status');
      setInterval(() => {
        const t = Date.now();
        const testImg = new Image();
        testImg.onload = () => { img.src = '/account/qr.png?t=' + t; statusEl.textContent = 'Laatste update: ' + new Date().toLocaleTimeString(); };
        testImg.onerror = () => { statusEl.textContent = 'Wachten op een nieuwe QR-code (nog niet beschikbaar of het account is inmiddels verbonden)...'; };
        testImg.src = '/account/qr.png?t=' + t;
      }, 3000);
    </script>
  </body>
</html>`;
}

function basicAuthMiddleware(username, password) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const sepIdx = decoded.indexOf(':');
      const user = decoded.slice(0, sepIdx);
      const pass = decoded.slice(sepIdx + 1);
      if (user === username && pass === password) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Pakbon dashboard"');
    res.status(401).send('Authenticatie vereist.');
  };
}

export function createWebServer({ port, publicBaseUrl, logger, dashboardUsername, dashboardPassword }) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const app = express();
  app.use(express.urlencoded({ extended: true }));

  // -- Publiek, geen wachtwoord: Coda en Railway's health-check hebben dit nodig --
  app.get('/health', (_req, res) => res.status(200).send('ok'));
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '365d', immutable: true }));

  const requireAuth = basicAuthMiddleware(dashboardUsername, dashboardPassword);

  // -- Alles hieronder staat achter het dashboard-wachtwoord --
  app.use(requireAuth);

  app.get('/account/qr.png', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const buffer = wa.getQrBuffer();
    if (!buffer) return res.status(404).send('Nog geen QR-code beschikbaar.');
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  });

  app.get('/account/qr', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(qrPageHtml());
  });

  app.post('/account/nieuw-koppelen', (_req, res) => {
    wa.switchAccount(logger);
    res.redirect('/account/qr');
  });

  app.get('/', (_req, res) => {
    router.refreshGroupMatches();
    const accountStatus = wa.getStatus();
    const connectedNumber = wa.getConnectedNumber();

    const koppelingen = store.listKoppelingen();
    const rows = koppelingen.length
      ? koppelingen
          .map((k) => {
            const status = router.isGroupFound(k.id) ? 'gevonden' : 'niet_gevonden';
            return `<tr>
              <td>${escapeHtml(k.name)}<br /><span class="hint">${escapeHtml(k.whatsappGroupName)} &rarr; ${escapeHtml(k.codaTableId)}</span></td>
              <td>${koppelingBadge(status)}</td>
              <td class="actions">
                <a class="btn secondary" href="/koppelingen/${k.id}/bewerken">Bewerken</a>
                <form style="display:inline" method="post" action="/koppelingen/${k.id}/verwijderen" onsubmit="return confirm('Deze koppeling verwijderen?')"><button class="danger" type="submit">Verwijderen</button></form>
              </td>
            </tr>`;
          })
          .join('')
      : `<tr><td colspan="3" class="hint">Nog geen koppelingen. Klik hieronder om de eerste toe te voegen.</td></tr>`;

    res.send(
      layout(
        'Pakbon dashboard',
        `
        <h1>Pakbon dashboard</h1>

        <section class="card">
          <h2 style="margin-top:0">WhatsApp-account</h2>
          <p>${accountBadge(accountStatus)}${connectedNumber ? ` &mdash; gekoppeld nummer: <strong>+${escapeHtml(connectedNumber)}</strong>` : ''}</p>
          <p class="hint">Dit account moet lid zijn van elke WhatsApp-groep die je hieronder als koppeling toevoegt.</p>
          <a class="btn" href="/account/qr">QR-code bekijken</a>
          <form style="display:inline" method="post" action="/account/nieuw-koppelen" onsubmit="return confirm('Dit koppelt het huidige WhatsApp-account los. Je koppelingen blijven staan, maar je moet een nieuwe QR-code scannen voordat er weer berichten binnenkomen. Doorgaan?')">
            <button class="secondary" type="submit">Nieuw account koppelen</button>
          </form>
        </section>

        <h2>Koppelingen (WhatsApp-groep &rarr; Coda-tabel)</h2>
        <div class="top-actions"><a class="btn" href="/koppelingen/nieuw">+ Nieuwe koppeling</a></div>
        <table>
          <thead><tr><th>Koppeling</th><th>Status</th><th>Acties</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        `
      )
    );
  });

  app.get('/koppelingen/nieuw', async (_req, res) => {
    await wa.refreshGroupsNow(logger);
    res.send(
      layout(
        'Nieuwe koppeling',
        `<h1>Nieuwe koppeling</h1>${koppelingForm({ action: '/koppelingen', submitLabel: 'Koppeling toevoegen' })}`
      )
    );
  });

  app.post('/koppelingen', (req, res) => {
    const koppeling = store.createKoppeling(req.body);
    router.addKoppeling(koppeling);
    res.redirect('/');
  });

  app.get('/koppelingen/:id/bewerken', (req, res) => {
    const koppeling = store.getKoppeling(req.params.id);
    if (!koppeling) return res.status(404).send('Koppeling niet gevonden.');
    res.send(
      layout(
        'Koppeling bewerken',
        `<h1>Koppeling bewerken</h1>${koppelingForm({
          action: `/koppelingen/${koppeling.id}`,
          koppeling,
          submitLabel: 'Opslaan',
        })}`
      )
    );
  });

  app.post('/koppelingen/:id', (req, res) => {
    const koppeling = store.updateKoppeling(req.params.id, req.body);
    if (!koppeling) return res.status(404).send('Koppeling niet gevonden.');
    router.updateKoppeling(koppeling);
    res.redirect('/');
  });

  app.post('/koppelingen/:id/verwijderen', (req, res) => {
    router.removeKoppeling(req.params.id);
    store.deleteKoppeling(req.params.id);
    res.redirect('/');
  });

  const server = app.listen(port, () => {
    logger.info(`Webserver (dashboard + media) luistert op poort ${port}`);
  });

  function saveImage(buffer, mimetype) {
    const ext = mimetype && mimetype.includes('png') ? 'png' : 'jpg';
    const filename = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
    const base = publicBaseUrl.replace(/\/$/, '');
    return `${base}/media/${filename}`;
  }

  return { server, saveImage };
}
