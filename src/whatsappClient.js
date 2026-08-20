/**
 * whatsappClient.js
 *
 * Verbindt met WhatsApp via Baileys (niet-officiële library, emuleert
 * WhatsApp Web). Bij de eerste start moet je een QR-code scannen met de
 * telefoon die lid is van de doelgroep. Daarna blijft de sessie (in de
 * meegegeven authDir) actief, zolang die map bewaard blijft.
 *
 * Ondersteunt meerdere, onafhankelijke koppelingen naast elkaar: elke
 * aanroep van startWhatsApp() met een eigen authDir is een volledig eigen
 * WhatsApp-sessie, los van de andere.
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
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';

/**
 * Start (en bij verbroken verbinding: herstart automatisch) een WhatsApp-
 * sessie. Geeft direct een controller-object terug met een stop()-functie;
 * het daadwerkelijke verbinden gebeurt op de achtergrond.
 *
 * @param {{
 *   authDir: string,
 *   groupName: string,
 *   logger: import('pino').Logger,
 *   onText: (msg: object) => void,
 *   onImage: (msg: object) => void,
 *   onQr?: (buffer: Buffer|null) => void,
 *   onStatus?: (status: string) => void,
 * }} opts
 */
export function startWhatsApp({ authDir, groupName, logger, onText, onImage, onQr, onStatus }) {
  let stopped = false;
  let currentSock = null;

  async function connect() {
    if (stopped) return;

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ module: 'baileys' }),
      printQRInTerminal: false,
    });
    currentSock = sock;

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
          onQr?.(buffer);
          onStatus?.('waiting_for_qr');
        } catch (err) {
          logger.warn(`Kon QR-afbeelding niet genereren: ${err.message}`);
        }
      }

      if (connection === 'open') {
        logger.info('Verbonden met WhatsApp.');
        onQr?.(null);
        targetGroupJid = await resolveGroupJid();
        onStatus?.(targetGroupJid ? 'connected' : 'group_not_found');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          onStatus?.('logged_out');
          logger.error(
            'Uitgelogd bij WhatsApp (sessie verlopen of op telefoon losgekoppeld). ' +
              'Verwijder deze koppeling en maak hem opnieuw aan om weer een QR-code te scannen.'
          );
        } else if (!stopped) {
          onStatus?.('reconnecting');
          logger.warn('Verbinding verbroken, opnieuw verbinden...');
          connect();
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
  }

  connect().catch((err) => {
    logger.error(`Kon niet verbinden met WhatsApp: ${err.message}`);
    onStatus?.('error');
  });

  return {
    /** Stopt deze sessie definitief (geen automatische reconnect meer). */
    stop() {
      stopped = true;
      try {
        currentSock?.end(undefined);
      } catch {
        // socket was mogelijk al dicht, geen probleem
      }
    },
  };
}
