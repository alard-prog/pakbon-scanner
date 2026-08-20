# WhatsApp → Coda logger (met dashboard)

Deze app leest WhatsApp-groepen uit en registreert alleen de berichten die
een **foto + omschrijving** bevatten (zoals een voorraad- of retourmelding)
als nieuwe rij in een Coda-tabel. Losse chatberichten, vragen en reacties
zonder foto worden automatisch overgeslagen.

Er is **één gedeeld WhatsApp-account** nodig (dat lid moet zijn van alle
groepen die je wilt uitlezen), en via een ingebouwd **dashboard** koppel je
daarna elke groep aan een eigen Coda-tabel. Je kunt zo veel koppelingen
naast elkaar laten draaien als je wilt, zonder dat je daarvoor de app
opnieuw moet deployen of code moet aanpassen — en zonder dat je tegen
WhatsApp's limiet van gekoppelde apparaten aanloopt (er is immers maar één
sessie, hoeveel groepen je ook uitleest).

## Belangrijk om te weten

WhatsApp heeft geen officiële API om groepsberichten uit te lezen (de
WhatsApp Business API ondersteunt alleen 1-op-1 gesprekken). Deze app
gebruikt daarom [Baileys](https://github.com/WhiskeySockets/Baileys), een
niet-officiële library die de WhatsApp Web-verbinding nabootst via een
eenmalige QR-scan. Dit valt buiten WhatsApp's gebruiksvoorwaarden — in de
praktijk is het risico op een blokkade laag voor dit soort licht gebruik,
maar gebruik het alleen met een account/nummer waarvan je dat risico
accepteert (bijv. niet je enige privénummer — zie "Het WhatsApp-account"
hieronder voor het gebruik van een apart nummer).

## Hoe het werkt

1. De app maakt één WhatsApp-verbinding (het "account" in het dashboard),
   die alle groepen ziet waar dat account lid van is.
2. Voor elke groep waar je een koppeling voor hebt aangemaakt, worden
   berichten van dezelfde afzender die kort na elkaar binnenkomen (tekst +
   foto's) samengevoegd tot één "melding".
3. Een melding wordt alleen doorgestuurd naar de bijbehorende Coda-tabel
   als er zowel tekst (omschrijving) als minstens één foto bij zit.
4. Foto's worden gedownload en tijdelijk gehost door de app zelf (nodig
   omdat Coda alleen foto's kan overnemen via een URL); Coda downloadt ze
   daarna zelf en bewaart een eigen, permanente kopie.

## Het WhatsApp-account

Bovenin het dashboard staat een kaart "WhatsApp-account" met de status en
(als er een gescand is) het gekoppelde telefoonnummer. Dit ene account moet
lid zijn van **elke** groep die je als koppeling toevoegt.

- **Eerste keer scannen**: klik op **QR-code bekijken**, en scan met
  WhatsApp op de telefoon die lid is (of moet worden) van de groepen —
  Instellingen → Gekoppelde apparaten → Apparaat koppelen.
- **Overstappen naar een ander nummer** (bijvoorbeeld van je eigen
  privénummer naar een nummer specifiek voor deze app): klik op **Nieuw
  account koppelen**. Dit koppelt het huidige account los en laat een
  nieuwe QR-code verschijnen. Je koppelingen (groep → Coda-tabel) blijven
  gewoon staan — zorg wel dat het nieuwe account lid is van diezelfde
  groepen vóór je opnieuw scant, anders worden berichten niet gezien.

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
   de WhatsApp-sessie en de dashboard-configuratie in.
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

**Draaide je hiervoor al een oudere versie van deze app** (met
`WHATSAPP_GROUP_NAME`/`CODA_*` als losse Variables, met of zonder
dashboard)? Laat die Variables gewoon staan bij het updaten — de app
herkent je bestaande situatie automatisch bij de eerste opstart na deze
update, zet 'm om naar het huidige model, en neemt je bestaande WhatsApp-
sessie mee. Je hoeft dan niet opnieuw te scannen. Je kunt de oude Variables
daarna desgewenst verwijderen; ze worden verder niet meer gebruikt.

## Stap 4 — Koppelingen toevoegen via het dashboard

1. Zorg dat het WhatsApp-account (zie hierboven) verbonden is en lid is van
   de groep die je wilt toevoegen.
2. Klik in het dashboard op **+ Nieuwe koppeling**.
3. Vul in: een naam voor jezelf, de exacte WhatsApp-groepsnaam (je krijgt
   suggesties uit de groepen waar het account al lid van is), het Coda
   API-token, de Doc ID en de Table ID.
4. Zodra de status van de koppeling op **Actief** springt, is 'm gevonden
   en actief. Test met een berichtje met foto + omschrijving in de groep en
   check of de rij in Coda verschijnt.

Vanuit het dashboard kun je een koppeling ook **bewerken** (instellingen
aanpassen, direct actief) of **verwijderen**.

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

- Werkt alleen zolang het gekoppelde WhatsApp-account lid blijft van de
  groepen en de sessie geldig blijft (WhatsApp kan een sessie na langere
  tijd laten verlopen; dan moet opnieuw gescand worden via **Nieuw account
  koppelen**).
- Eén rij per melding, met alle foto's van die melding in de kolom "Foto" —
  er wordt niet per productregel (bv. per Red Bull-smaak) een losse rij
  gemaakt.
