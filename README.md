# WhatsApp → Coda logger (met dashboard)

Deze app leest WhatsApp-groepen uit en registreert alleen de berichten die
een **foto + omschrijving** bevatten (zoals een voorraad- of retourmelding)
als nieuwe rij in een Coda-tabel. Losse chatberichten, vragen en reacties
zonder foto worden automatisch overgeslagen.

Via een ingebouwd **dashboard** kun je meerdere onafhankelijke "koppelingen"
(WhatsApp-groep → Coda-tabel) naast elkaar beheren, zonder dat je daarvoor
meerdere keren de app moet deployen of code moet aanpassen.

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

1. Elke koppeling verbindt met WhatsApp en luistert alleen naar de groep die
   je bij die koppeling instelt.
2. Berichten van dezelfde afzender die kort na elkaar binnenkomen (tekst +
   foto's) worden samengevoegd tot één "melding".
3. Een melding wordt alleen doorgestuurd naar Coda als er zowel tekst
   (omschrijving) als minstens één foto bij zit.
4. Foto's worden gedownload en tijdelijk gehost door de app zelf (nodig
   omdat Coda alleen foto's kan overnemen via een URL); Coda downloadt ze
   daarna zelf en bewaart een eigen, permanente kopie.

## Stap 1 — Coda-tabel aanmaken (per koppeling)

Voor elke koppeling die je toevoegt, moet de Coda-tabel deze kolommen
hebben (namen moeten exact overeenkomen):

| Kolomnaam                 | Kolomtype                                          |
|----------------------------|----------------------------------------------------|
| Datum                      | Date/time                                           |
| Naam van persoon invult    | Text                                                |
| Opmerking                  | Text (zet "Wrap text" / long text aan)              |
| Foto                       | Image/Attachment (zet "Allow multiple values" aan)  |
| Bericht ID                 | Text (voorkomt dubbele rijen, mag ergens onopvallend staan) |

Alle overige kolommen laat de app leeg.

**Belangrijk voor de kolom "Foto":** zorg dat het kolomtype **Image** (of
"Attachment/File") is, niet gewoon "Text" — anders zet Coda alleen de link
als tekst in de cel neer in plaats van de foto zelf. Klik op de kolomkop →
**Change column type** → kies **Image**, en zet "Allow multiple values" aan.

Gebruik je andere kolomnamen (zoals bij een andere doc-template)? Pas dan
de kolomnamen in `src/codaClient.js` aan zodat ze overeenkomen.

## Stap 2 — Coda API-token en ID's (per koppeling)

1. Ga naar [coda.io/account](https://coda.io/account) → **API Settings** →
   **Generate API token**. Beperk het token het liefst tot alleen de
   betreffende doc (via de restrictie **"Doc or table"**) in plaats van je
   hele account — zie de veiligheidstip onderaan.
2. Open je doc in de browser. De URL ziet er ongeveer zo uit:
   `https://coda.io/d/Mijn-doc_dABC123xyz/`. Het stuk na `_d` (hier
   `ABC123xyz`, mét de "d" ervoor: `dABC123xyz`) is de Doc ID.
3. Voor de Table ID kun je gewoon de exacte tabelnaam gebruiken.

## Stap 3 — Eén keer deployen naar Railway

De app zelf hoef je maar **één keer** te deployen — nieuwe WhatsApp-groepen
of Coda-tabellen voeg je daarna toe via het dashboard, niet door opnieuw te
deployen.

1. Zet deze map in een git-repository en maak er een nieuw project van op
   [railway.app](https://railway.app) (Deploy from GitHub repo). Railway
   herkent de `Dockerfile` automatisch.
2. Voeg een **Volume** toe, gemount op `/app/data`. Essentieel: hier staan
   alle WhatsApp-sessies en de dashboard-configuratie in.
3. Zet in **Variables**:
   - `PUBLIC_BASE_URL` — je publieke Railway-domein, met `https://` (genereer
      die eerst onder **Settings → Networking**).
   - `DASHBOARD_PASSWORD` — een wachtwoord dat je zelf kiest, voor toegang
     tot het dashboard.
   - `DASHBOARD_USERNAME` — optioneel, standaard `admin`.
   - `PORT` — meestal `3000`; check de gegenereerde poort in de logs na de
     eerste deploy en zorg dat **Settings → Networking**'s doelpoort daarmee
     overeenkomt.
4. Deploy. Open daarna `https://jouw-domein.up.railway.app/` in je browser —
   dat is het dashboard. Log in met `admin` (of je eigen `DASHBOARD_USERNAME`)
   en het wachtwoord dat je bij `DASHBOARD_PASSWORD` hebt gezet.

**Draaide je hiervoor al de oudere, enkelvoudige versie van deze app**
(met `WHATSAPP_GROUP_NAME`/`CODA_*` als losse Variables)? Laat die
Variables gewoon staan bij het updaten — de app herkent ze automatisch bij
de eerste opstart na deze update, zet ze om in je eerste koppeling, en
neemt je bestaande WhatsApp-sessie mee. Je hoeft dan niet opnieuw te
scannen. Je kunt de oude Variables daarna desgewenst verwijderen; ze worden
verder niet meer gebruikt.

## Stap 4 — Koppelingen toevoegen via het dashboard

1. Klik in het dashboard op **+ Nieuwe koppeling**.
2. Vul in: een naam voor jezelf, de exacte WhatsApp-groepsnaam, het
   Coda API-token, de Doc ID en de Table ID.
3. Je wordt automatisch doorgestuurd naar de QR-scanpagina van die
   koppeling. Scan de QR-code met WhatsApp op de telefoon die lid is van de
   doelgroep (Instellingen → Gekoppelde apparaten → Apparaat koppelen).
4. Zodra de status in het dashboard op **Verbonden** springt, is de
   koppeling actief. Test met een berichtje met foto + omschrijving in de
   groep en check of de rij in Coda verschijnt.

Vanuit het dashboard kun je per koppeling ook:
- **Bewerken** — instellingen aanpassen (de koppeling herstart automatisch
  met de nieuwe waarden; de WhatsApp-sessie blijft behouden).
- **Herstart** — handig als een koppeling vastloopt.
- **Verwijderen** — stopt de koppeling en wist de bijbehorende WhatsApp-
  sessie definitief (daarna is een nieuwe QR-scan nodig als je 'm opnieuw
  toevoegt).

## Beveiliging

- Het dashboard staat achter een wachtwoord (`DASHBOARD_PASSWORD`). Alleen
  `/media/...` (foto-hosting voor Coda) en `/health` (voor Railway's eigen
  health-check) zijn bewust open, zonder wachtwoord.
- Gebruik voor elke koppeling het liefst een Coda API-token dat beperkt is
  tot die specifieke doc (via coda.io/account → API Settings → token
  aanmaken → restrictie **"Doc or table"**), in plaats van een token met
  volledige accounttoegang.
- De koppelingen (inclusief tokens) staan in `data/koppelingen.json` op de
  Railway Volume — nooit in git/GitHub.

## Instellingen die per koppeling worden ingesteld (via het dashboard)

- WhatsApp-groepsnaam
- Coda API-token, Doc ID, Table ID
- Wachttijd na het laatste bericht van een afzender voordat een melding als
  compleet wordt beschouwd (standaard 15000 ms) — hoger zetten als iemand
  traag meerdere foto's na elkaar stuurt.

## Bekende beperkingen

- Elke koppeling werkt alleen zolang het gekoppelde WhatsApp-account lid
  blijft van de groep en de sessie geldig blijft (WhatsApp kan een sessie
  na langere tijd laten verlopen; dan moet opnieuw gescand worden via de
  QR-knop van die koppeling).
- Eén rij per melding, met alle foto's van die melding in de kolom "Foto" —
  er wordt niet per productregel (bv. per Red Bull-smaak) een losse rij
  gemaakt.
