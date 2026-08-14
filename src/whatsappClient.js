/**
 * whatsappClient.js
 *
 * Verbindt met WhatsApp via Baileys (niet-officiële library, emuleert
 * WhatsApp Web). Bij de eerste start moet je een QR-code scannen met de
 * telefoon die lid is van de doelgroep. Daarna blijft de sessie
 * (in ./data/auth) actief, zolang die map bewaard blijft.
 *
 * LET OP: dit gebruikt WhatsApp buiten de officiële gebruiksvoorwaarden om.
 * Gebruik dit alleen met een account waarvan je zeker weet dat het risico
 * (een eventuele tijdelijke blokkade) acceptabel is.
 */

import {
  makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import path from 'path';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { setLatestQrBuffer, clearLatestQrBuffer } from './qrState.js';

const AUTH_DIR = path.resolve('data', 'auth');

export async function startWhatsApp({ groupName, logger, onText, onImage }) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: logger.child({ module: 'baileys' }),
    printQRInTerminal: false,
  });

  let targetGroupJid = null;

  async function resolveGroupJid() {
    const groups = await sock.groupFetchAllParticipating();
    const match = Object.values(groups).find(
      (g) => g.subject?.trim().toLowerCase() === groupName.trim().toLowerCase()
    );
    if (!match) {
      logger.warn(
        `Groep "${groupName}" niet gevonden onder de groepen van dit account. ` +
          `Controleer of het account lid is van de groep en of de naam exact klopt.`
      );
      return null;
    }
    logger.info(`Groep "${groupName}" gevonden (${match.id})`);
    return match.id;
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('Scan deze QR-code met WhatsApp op je telefoon (Gekoppelde apparaten -> Apparaat koppelen):');
      qrcodeTerminal.generate(qr, { small: true });
      try {
        const buffer = await QRCode.toBuffer(qr, { width: 400 });
        setLatestQrBuffer(buffer);
        logger.info(
          'Zie je hierboven geen duidelijke QR-code (kan gebeuren in Windows PowerShell of in ' +
            'Railway\'s logvenster)? Open dan /qr op je publieke URL in een browser en scan die pagina.'
        );
      } catch (err) {
        logger.warn(`Kon QR-afbeelding niet genereren: ${err.message}`);
      }
    }

    if (connection === 'open') {
      logger.info('Verbonden met WhatsApp.');
      clearLatestQrBuffer();
      targetGroupJid = await resolveGroupJid();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        logger.error(
          'Uitgelogd bij WhatsApp (sessie verlopen of op telefoon losgekoppeld). ' +
            'Verwijder de map data/auth en scan opnieuw een QR-code.'
        );
      } else {
        logger.warn('Verbinding verbroken, opnieuw verbinden...');
        startWhatsApp({ groupName, logger, onText, onImage });
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        if (!targetGroupJid || msg.key.remoteJid !== targetGroupJid) continue;

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
          onImage({
            senderId,
            senderName,
            messageId,
            timestamp,
            buffer,
            mimetype: imageMsg.mimetype || 'image/jpeg',
            caption: imageMsg.caption || '',
          });
        } else if (textBody) {
          onText({ senderId, senderName, messageId, timestamp, text: textBody });
        }
      } catch (err) {
        logger.error(`Fout bij verwerken van bericht: ${err.message}`);
      }
    }
  });

  return sock;
}
