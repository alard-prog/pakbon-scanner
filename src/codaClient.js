/**
 * codaClient.js
 *
 * Zet een "melding" (afzender, omschrijving, foto-URL's) om in een nieuwe
 * rij in de Coda-tabel via de officiële Coda REST API.
 *
 * Verwachte kolommen in de Coda-tabel "Inbox" (namen moeten exact
 * overeenkomen):
 *   - Datum                    (kolomtype: Date/time)
 *   - Naam van persoon invult  (kolomtype: Text) - wordt gevuld met de afzender
 *   - Opmerking                (kolomtype: Text, "long text" aan) - omschrijving
 *   - Foto                     (kolomtype: Image/Attachment, "allow multiple" aan)
 *   - Bericht ID               (kolomtype: Text) - gebruikt om dubbele rijen te voorkomen
 *
 * Alle overige kolommen in de tabel (In voorraadbeheersing, Bar naam,
 * Levering/retour, Leverancier, Foto tellijst, Type levering, en de rest)
 * worden bewust niet ingevuld door deze app.
 */

const CODA_API_BASE = 'https://coda.io/apis/v1';

export function createCodaClient({ apiToken, docId, tableId, logger }) {
  async function request(pathname, options = {}) {
    const res = await fetch(`${CODA_API_BASE}${pathname}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Coda API-fout (${res.status}) op ${pathname}: ${body}`);
    }
    return res.status === 202 || res.status === 204 ? null : res.json();
  }

  return {
    /**
     * Voegt één rij toe aan de tabel voor de gegeven melding.
     * @param {{ sender: string, text: string, photoUrls: string[], timestamp: number, messageId: string }} report
     */
    async pushReport(report) {
      const iso = new Date(report.timestamp * 1000).toISOString();

      const cells = [
        { column: 'Datum', value: iso },
        { column: 'Naam van persoon invult', value: report.sender },
        { column: 'Opmerking', value: report.text },
        { column: 'Foto', value: report.photoUrls },
        { column: 'Bericht ID', value: report.messageId },
      ];

      logger.info(`Rij toevoegen aan Coda voor melding van ${report.sender}`);
      await request(`/docs/${docId}/tables/${encodeURIComponent(tableId)}/rows`, {
        method: 'POST',
        body: JSON.stringify({ rows: [{ cells }] }),
      });
    },

    /**
     * Haalt bestaande "Bericht ID"-waarden op zodat we bij een herstart
     * niet per ongeluk dezelfde melding twee keer wegschrijven.
     * (Best-effort: bij falen wordt een lege set teruggegeven.)
     */
    async fetchKnownMessageIds() {
      try {
        const data = await request(
          `/docs/${docId}/tables/${encodeURIComponent(tableId)}/rows?useColumnNames=true&limit=200&sortBy=natural`
        );
        const ids = (data?.items || [])
          .map((row) => row.values?.['Bericht ID'])
          .filter(Boolean);
        return new Set(ids);
      } catch (err) {
        logger.warn(`Kon bestaande rijen niet ophalen: ${err.message}`);
        return new Set();
      }
    },
  };
}