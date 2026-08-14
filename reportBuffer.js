/**
 * reportBuffer.js
 *
 * Groepeert losse WhatsApp-berichten (tekst + foto's) die vlak na elkaar
 * door dezelfde afzender zijn verstuurd tot één "melding".
 *
 * Een melding wordt pas doorgestuurd (flush) als er zowel tekst
 * (omschrijving) als minstens één foto in zit. Puur tekst (vragen,
 * reacties) of losse foto's zonder omschrijving worden genegeerd (= ruis).
 */

export function createReportBuffer({ flushDelayMs, onReport }) {
  /** @type {Map<string, { sender: string, text: string, images: Array<{buffer: Buffer, mimetype: string}>, firstTimestamp: number, timer: NodeJS.Timeout }>} */
  const pending = new Map();

  function getOrCreate(senderId, senderName, timestamp) {
    let entry = pending.get(senderId);
    if (!entry) {
      entry = {
        sender: senderName,
        text: '',
        images: [],
        messageIds: [],
        firstTimestamp: timestamp,
        timer: null,
      };
      pending.set(senderId, entry);
    }
    return entry;
  }

  function scheduleFlush(senderId) {
    const entry = pending.get(senderId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flush(senderId), flushDelayMs);
  }

  function flush(senderId) {
    const entry = pending.get(senderId);
    if (!entry) return;
    pending.delete(senderId);

    const hasText = entry.text.trim().length > 0;
    const hasImages = entry.images.length > 0;

    if (hasText && hasImages) {
      onReport({
        sender: entry.sender,
        text: entry.text.trim(),
        images: entry.images,
        timestamp: entry.firstTimestamp,
        id: entry.messageIds[0] || `${entry.sender}-${entry.firstTimestamp}`,
      });
    }
    // Anders: geen foto+omschrijving samen -> beschouwen als ruis, negeren.
  }

  return {
    /** Tekstbericht (of caption bij een los berichtje) toevoegen. */
    addText(senderId, senderName, text, timestamp, messageId) {
      const entry = getOrCreate(senderId, senderName, timestamp);
      entry.text = entry.text ? `${entry.text}\n${text}` : text;
      if (messageId) entry.messageIds.push(messageId);
      scheduleFlush(senderId);
    },

    /** Afbeelding toevoegen, optioneel met eigen caption. */
    addImage(senderId, senderName, imageBuffer, mimetype, caption, timestamp, messageId) {
      const entry = getOrCreate(senderId, senderName, timestamp);
      entry.images.push({ buffer: imageBuffer, mimetype });
      if (caption && caption.trim()) {
        entry.text = entry.text ? `${entry.text}\n${caption.trim()}` : caption.trim();
      }
      if (messageId) entry.messageIds.push(messageId);
      scheduleFlush(senderId);
    },
  };
}
