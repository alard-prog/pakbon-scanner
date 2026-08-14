# WhatsApp → Coda logger

Deze app leest één specifieke WhatsApp-groep uit en registreert alleen de
berichten die een **foto + omschrijving** bevatten (zoals een voorraad- of
retourmelding) als nieuwe rij in een Coda-tabel. Losse chatberichten,
vragen en reacties zonder foto worden automatisch overgeslagen.

## Belangrijk om te weten

WhatsApp heeft geen officiële API om groepsberichten uit te lezen (de
WhatsApp Business API ondersteunt alleen 1-op-1 gesprekken). Deze app
gebruikt daarom [Baileys](https://github.com/WhiskeySockets/Baileys), een
niet-officiële library die de WhatsApp Web-verbinding nabootst via een
eenmalige QR-scan. Dit valt buiten WhatsApp's gebruiksvoorwaarden — in de
praktijk is het risico op een blokkade laag voor dit soort licht gebruik,
maar gebruik het alleen met een account/nummer waarvan je dat risico
accepteert (bijv. niet je enige privénummer).

## Hoe het werkt

1. De app verbindt met WhatsApp en luistert alleen naar de groep die je in
   `.env` opgeeft.
2. Berichten van dezelfde afzender die binnen ~15 seconden na elkaar
   binnenkomen (tekst + foto's) worden samengevoegd tot één "melding".
3. Een melding wordt alleen doorgestuurd naar Coda als er zowel tekst
   (omschrijving) als minstens één foto bij zit.
4. Foto's worden gedownload en tijdelijk gehost door de app zelf (nodig
   omdat Coda alleen foto's kan overnemen via een URL), en als link
   meegestuurd naar de nieuwe rij in Coda.

## Stap 1 — Coda-tabel aanmaken

Maak in je Coda-doc een tabel aan, bijvoorbeeld genaamd **Meldingen**, met
precies deze kolommen (namen moeten exact overeenkomen):

| Kolomnaam     | Kolomtype                                   |
|---------------|----------------------------------------------|
| Datum         | Date/time                                     |
| Afzender      | Text                                          |
| Omschrijving  | Text (zet "Wrap text" / long text aan)        |
| Foto's        | Image (zet "Allow multiple values" aan)       |
| Bericht ID    | Text                                          |

## Stap 2 — Coda API-token en ID's

1. Ga naar [coda.io/account](https://coda.io/account) → **API Settings** →
   **Generate API token**. Bewaar dit token, dit is je `CODA_API_TOKEN`.
2. Open je doc in de browser. De URL ziet er ongeveer zo uit:
   `https://coda.io/d/Mijn-doc_dABC123xyz/`. Het stuk na `_d` (hier
   `ABC123xyz`, mét de "d" ervoor: `dABC123xyz`) is je `CODA_DOC_ID`.
3. Voor `CODA_TABLE_ID` kun je gewoon de exacte tabelnaam gebruiken, bv.
   `Meldingen`.

## Stap 3 — Lokaal testen (optioneel, aanbevolen)

```bash
npm install
cp .env.example .env
# vul .env in met je eigen waarden (voor lokaal testen mag
# PUBLIC_BASE_URL bijv. tijdelijk http://localhost:3000 zijn — Coda kan
# de foto's dan alleen niet ophalen totdat je online staat)
npm start
```

Er verschijnt een QR-code in je terminal. Scan die in WhatsApp via
**Instellingen → Gekoppelde apparaten → Apparaat koppelen** met de
telefoon die lid is van de doelgroep.

## Stap 4 — Deployen naar een cloud-server (bv. Railway)

1. Zet deze map in een git-repository (of upload als zip) en maak er een
   nieuw project van op [railway.app](https://railway.app).
2. Railway herkent de `Dockerfile` automatisch.
3. Voeg in Railway een **Volume** toe, gemount op `/app/data`. Dit is
   essentieel: hier staat de WhatsApp-sessie in, zodat je na een herstart
   niet opnieuw hoeft te scannen, en de tijdelijke foto's.
4. Zet de environment variables uit `.env.example` in Railway's
   **Variables**-tab.
5. Genereer onder **Settings → Networking** een publieke domeinnaam en
   vul die (met `https://`) in als `PUBLIC_BASE_URL`.
6. Deploy, en bekijk de **Logs**-tab: daar verschijnt de QR-code (als
   tekst-QR). Scan die met je telefoon.
7. Zodra de logs "Verbonden met WhatsApp" en "Groep ... gevonden" tonen,
   is de koppeling actief. Test met een berichtje met foto + omschrijving
   in de groep en check of de rij in Coda verschijnt.

## Instellingen aanpassen

Alles staat in `.env` (lokaal) of de Railway **Variables**:

- `WHATSAPP_GROUP_NAME` — exacte naam van de groep.
- `FLUSH_DELAY_MS` — hoe lang gewacht wordt na het laatste bericht van een
  afzender voordat een melding als compleet wordt beschouwd (standaard
  15000 ms). Stuurt iemand traag meerdere foto's na elkaar? Zet dit
  hoger.

## Bekende beperkingen

- Werkt alleen zolang het gekoppelde WhatsApp-account lid blijft van de
  groep en de sessie geldig blijft (WhatsApp kan een sessie na langere
  tijd laten verlopen; dan moet opnieuw gescand worden).
- Eén rij per melding, met alle foto's van die melding in de kolom
  "Foto's" — er wordt niet per productregel (bv. per Red Bull-smaak) een
  losse rij gemaakt.
