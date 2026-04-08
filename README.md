# ✈️ Spontan-Trips — Setup Anleitung

Sucht täglich automatisch Flüge von Berlin unter 100€ (Fr–Mo, 3–4 Nächte) und schickt die Ergebnisse per E-Mail.

---

## 1. GitHub Repository erstellen

1. Geh auf [github.com/new](https://github.com/new)
2. Name: `spontan-trips`, auf **Private** stellen
3. Repository erstellen
4. Diese Dateien hochladen (einfach per Drag & Drop):
   - `search.js`
   - `package.json`
   - `.github/workflows/daily-search.yml`

---

## 2. Gmail App-Passwort erstellen

Damit das Script E-Mails senden kann, brauchst du ein **App-Passwort** von Google (nicht dein normales Gmail-Passwort):

1. Geh zu [myaccount.google.com/security](https://myaccount.google.com/security)
2. "2-Schritt-Verifizierung" aktivieren (falls noch nicht aktiv)
3. Dann: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
4. App-Name: `Spontan Trips` → **Erstellen**
5. Du bekommst ein 16-stelliges Passwort → kopieren!

---

## 3. Secrets in GitHub hinterlegen

In deinem GitHub Repository:

1. **Settings** → **Secrets and variables** → **Actions**
2. Klick auf **"New repository secret"** und füge diese zwei hinzu:

| Name | Wert |
|---|---|
| `EMAIL_USER` | deine Gmail-Adresse (z.B. `deinname@gmail.com`) |
| `EMAIL_PASS` | das 16-stellige App-Passwort von Schritt 2 |

---

## 4. Fertig! 🎉

Ab jetzt läuft die Suche jeden Morgen um 8 Uhr automatisch.

**Manuell starten:** Repository → **Actions** → "Spontan Trip Suche" → **"Run workflow"**

---

## Einstellungen anpassen (in `search.js`)

```js
const MAX_PRICE = 100;    // Preisgrenze in €
const ORIGIN    = "BER";  // Abflughafen (BER, FRA, MUC, ...)
const MIN_NIGHTS = 3;     // Mindest-Nächte
const MAX_NIGHTS = 4;     // Max-Nächte
```

---

## Kosten

- **SerpApi:** 100 Suchen/Monat gratis (reicht für ~3 Tage täglich)
- **GitHub Actions:** kostenlos für private Repos (2.000 Minuten/Monat)
- **Gmail:** kostenlos

**Tipp:** Wenn du mehr als 100 Suchen/Monat brauchst, SerpApi-Plan upgraden oder `dates.slice(0, 10)` in `search.js` reduzieren.
