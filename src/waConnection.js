/**
 * waConnection.js
 *
 * Beheert ÉÉN gedeelde WhatsApp-verbinding voor de hele app. In plaats van
 * per koppeling een eigen sessie (en dus een eigen "gekoppeld apparaat" op
 * je telefoon), is er nu maar één WhatsApp-account nodig dat lid is van
 * alle groepen die je wilt uitlezen. Binnenkomende berichten worden per
 * groep doorgegeven aan koppelingRouter.js, die bepaalt naar welke
 * Coda-tabel(len) ze moeten.
 *
 * Ondersteunt ook het wisselen van account: switchAccount() wist de
 * huidige sessie en start een nieuwe QR-koppeling, zonder dat je
 * koppelingen (groep -> Coda-tabel) hoeft aan te passen.
 */

import {
  makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';

const AUTH_DIR = path.resolve('data', 'auth');

function freshState(carryOver = {}) {
  return {
    status: 'stopped',
    qrBuffer: null,
    connectedNumber: null,
    groupsByJid: new Map(), // jid -> subject
    sock: null,
    stopped: true,
    onMessage: null,
    onGroupsResolved: null,
    ...carryOver,
  };
}

let state = freshState();

function jidToNumber(jid) {
  if (!jid) return null;
  return jid.split(':')[0].split('@')[0];
}

async function refreshGroups(logger) {
  if (!state.sock) return;
  try {
    const groups = await state.sock.groupFetchAllParticipating();
    state.groupsByJid = new Map(Object.values(groups).map((g) => [g.id, g.subject]));
  } catch (err) {
    logger.warn(`Kon groepenlijst niet ophalen: ${err.message}`);
  }
}

/** Zoekt de JID van een groep op naam (exacte match, hoofdletterongevoelig). */
export function findGroupJidByName(name) {
  const target = (name || '').trim().toLowerCase();
  for (const [jid, subject] of state.groupsByJid) {
    if (subject?.trim().toLowerCase() === target) return jid;
  }
  return null;
}

/** Alle groepen die het gekoppelde account nu kent (voor het dashboard). */
export function getKnownGroups() {
  return Array.from(state.groupsByJid, ([jid, subject]) => ({ jid, subject })).sort((a, b) =>
    (a.subject || '').localeCompare(b.subject || '')
  );
}

export function getStatus() {
  return state.status;
}

export function getQrBuffer() {
  return state.qrBuffer;
}

export function getConnectedNumber() {
  return state.connectedNumber;
}

function connect(logger) {
  if (state.stopped) return;
  connectAsync(logger).catch((err) => {
    logger.error(`Kon niet verbinden met WhatsApp: ${err.message}`);
    state.status = 'error';
  });
}

async function connectAsync(logger) {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: authState,
    logger: logger.child({ module: 'baileys' }),
    printQRInTerminal: false,
  });
  state.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('Scan deze QR-code met WhatsApp op je telefoon (Gekoppelde apparaten -> Apparaat koppelen):');
      qrcodeTerminal.generate(qr, { small: true });
      try {
        state.qrBuffer = await QRCode.toBuffer(qr, { width: 400 });
        state.status = 'waiting_for_qr';
      } catch (err) {
        logger.warn(`Kon QR-afbeelding niet genereren: ${err.message}`);
      }
    }

    if (connection === 'open') {
      logger.info('Verbonden met WhatsApp.');
      state.qrBuffer = null;
      state.connectedNumber = jidToNumber(sock.user?.id);
      await refreshGroups(logger);
      state.status = 'connected';
      state.onGroupsResolved?.();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        state.status = 'logged_out';
        state.connectedNumber = null;
        logger.error(
          'Uitgelogd bij WhatsApp (sessie verlopen of op telefoon losgekoppeld). ' +
            'Koppel via het dashboard een (nieuw) account om weer een QR-code te scannen.'
        );
      } else if (!state.stopped) {
        state.status = 'reconnecting';
        logger.warn('Verbinding verbroken, opnieuw verbinden...');
        connect(logger);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const groupJid = msg.key.remoteJid;
        if (!groupJid || !groupJid.endsWith('@g.us')) continue; // alleen groepsberichten

        const senderId = msg.key.participant || msg.key.remoteJid;
        const senderName = msg.pushName || senderId;
        const timestamp = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);
        const messageId = msg.key.id;

        const imageMsg = msg.message.imageMessage;
        const textBody =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          null;

        if (imageMsg) {
          const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger, reuploadRequest: sock.updateMediaMessage }
          );
          state.onMessage?.({
            groupJid,
            kind: 'image',
            senderId,
            senderName,
            messageId,
            timestamp,
            buffer,
            mimetype: imageMsg.mimetype || 'image/jpeg',
            caption: imageMsg.caption || '',
          });
        } else if (textBody) {
          state.onMessage?.({ groupJid, kind: 'text', senderId, senderName, messageId, timestamp, text: textBody });
        }
      } catch (err) {
        logger.error(`Fout bij verwerken van bericht: ${err.message}`);
      }
    }
  });
}

/** Start de gedeelde verbinding (eenmalig, bij het opstarten van de app). */
export function start({ logger, onMessage, onGroupsResolved }) {
  state.stopped = false;
  state.status = 'starting';
  state.onMessage = onMessage;
  state.onGroupsResolved = onGroupsResolved;
  connect(logger);
}

/** Haalt de groepenlijst opnieuw op (bv. na het toevoegen van een koppeling). */
export async function refreshGroupsNow(logger) {
  await refreshGroups(logger);
  state.onGroupsResolved?.();
}

/** Stopt de verbinding definitief (geen automatische reconnect meer). */
export function stop() {
  state.stopped = true;
  try {
    state.sock?.end(undefined);
  } catch {
    // socket was mogelijk al dicht, geen probleem
  }
}

/**
 * Koppelt een nieuw/ander account: stopt de huidige verbinding, wist de
 * opgeslagen sessie volledig, en start daarna opnieuw op zodat er een
 * nieuwe QR-code verschijnt. Je koppelingen (groep -> Coda-tabel) blijven
 * gewoon staan; alleen het WhatsApp-account wisselt.
 */
export function switchAccount(logger) {
  stop();
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  const { onMessage, onGroupsResolved } = state;
  state = freshState({ onMessage, onGroupsResolved, stopped: false });
  connect(logger);
}
