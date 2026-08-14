/**
 * qrState.js
 *
 * Heel simpele in-memory opslag van de laatst gegenereerde WhatsApp-QR-
 * afbeelding (als PNG-buffer). whatsappClient.js genereert de afbeelding en
 * zet 'm hier neer zodra WhatsApp een nieuwe QR-code stuurt; mediaServer.js
 * leest 'm uit om op aanvraag te tonen. Geen bestand op schijf, dus geen
 * pad- of timingproblemen tussen schrijven en lezen.
 */

let latestQrBuffer = null;

export function setLatestQrBuffer(buffer) {
  latestQrBuffer = buffer;
}

export function clearLatestQrBuffer() {
  latestQrBuffer = null;
}

export function getLatestQrBuffer() {
  return latestQrBuffer;
}