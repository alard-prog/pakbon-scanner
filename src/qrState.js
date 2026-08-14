/**
 * qrState.js
 *
 * Heel simpele in-memory opslag van de laatste WhatsApp-QR-code (de ruwe
 * tekstwaarde, niet de afbeelding). whatsappClient.js zet hier de nieuwste
 * waarde in zodra WhatsApp een nieuwe QR-code stuurt; mediaServer.js leest
 * 'm uit om op aanvraag een verse PNG-afbeelding te genereren.
 *
 * Bewust géén bestand op schijf: dat voorkomt padproblemen en timing-issues
 * tussen het schrijven en het uitlezen van een QR-afbeelding.
 */

let latestQr = null;

export function setLatestQr(qr) {
  latestQr = qr;
}

export function clearLatestQr() {
  latestQr = null;
}

export function getLatestQr() {
  return latestQr;
}