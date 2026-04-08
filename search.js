const https = require("https");
const nodemailer = require("nodemailer");

// ─── Config ───────────────────────────────────────────────────────────────────
const SERPAPI_KEY = "cc824d14af98ebb20291985f57274bc87d499f0efbabbdc617b0fa246f47d699";
const EMAIL_TO    = "riosternberg@gmail.com";
const MAX_PRICE   = 100;   // € Gesamtpreis hin & zurück
const ORIGIN      = "BER"; // Berlin (alle Berliner Flughäfen)
const MIN_NIGHTS  = 3;
const MAX_NIGHTS  = 4;

// Suche Fr–Mo: Abflug Freitag, Rückflug Montag (3 Nächte) oder Sa→Di (4 Nächte)
// Wir suchen die nächsten 8 Freitage/Samstage
function getSearchDates() {
  const pairs = [];
  const today = new Date();
  for (let i = 0; i <= 56; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dow = d.getDay(); // 0=So, 5=Fr, 6=Sa
    if (dow === 5 || dow === 6) {
      for (const nights of [MIN_NIGHTS, MAX_NIGHTS]) {
        const ret = new Date(d);
        ret.setDate(d.getDate() + nights);
        pairs.push({
          out: fmt(d),
          ret: fmt(ret),
          label: `${fmt(d)} → ${fmt(ret)} (${nights} Nächte)`,
        });
      }
    }
  }
  // Deduplizieren & auf 20 Paare begrenzen
  const seen = new Set();
  return pairs.filter(p => {
    const k = p.out + p.ret;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 20);
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function searchFlight(outDate, retDate) {
  const url = `https://serpapi.com/search.json?engine=google_flights` +
    `&departure_id=${ORIGIN}&arrival_id=anywhere` +
    `&outbound_date=${outDate}&return_date=${retDate}` +
    `&currency=EUR&hl=de&type=1&api_key=${SERPAPI_KEY}`;
  try {
    const data = await fetchJson(url);
    const results = [];
    const flights = [
      ...(data.best_flights || []),
      ...(data.other_flights || []),
    ];
    for (const f of flights) {
      const price = f.price;
      if (price && price <= MAX_PRICE) {
        const leg = f.flights?.[0];
        results.push({
          destination: leg?.arrival_airport?.name || "Unbekannt",
          destCode: leg?.arrival_airport?.id || "?",
          airline: leg?.airline || "?",
          duration: f.total_duration,
          price,
          outDate,
          retDate,
          bookingUrl: `https://www.google.com/flights?hl=de#flt=${ORIGIN}.${leg?.arrival_airport?.id}.${outDate}*${leg?.arrival_airport?.id}.${ORIGIN}.${retDate}`,
        });
      }
    }
    return results;
  } catch (e) {
    console.error(`Fehler bei ${outDate}→${retDate}:`, e.message);
    return [];
  }
}

function buildEmailHtml(deals) {
  if (deals.length === 0) {
    return `<p>Heute leider keine Deals unter ${MAX_PRICE}€ gefunden. Morgen wieder!</p>`;
  }

  const rows = deals.map(d => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:12px 8px;font-weight:600;">${d.destination} (${d.destCode})</td>
      <td style="padding:12px 8px;">${d.outDate} → ${d.retDate}</td>
      <td style="padding:12px 8px;">${d.airline}</td>
      <td style="padding:12px 8px;font-size:20px;font-weight:700;color:#1a7a4a;">€${d.price}</td>
      <td style="padding:12px 8px;">
        <a href="${d.bookingUrl}" style="background:#1a7a4a;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;">Buchen →</a>
      </td>
    </tr>`).join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#222;">
  <h1 style="font-size:24px;margin-bottom:4px;">✈️ Deine Spontan-Trip Deals</h1>
  <p style="color:#666;margin-bottom:24px;">
    ${deals.length} Flug${deals.length > 1 ? "e" : ""} unter ${MAX_PRICE}€ von Berlin · ${new Date().toLocaleDateString("de-DE")}
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr style="background:#f5f5f5;text-align:left;">
        <th style="padding:10px 8px;">Ziel</th>
        <th style="padding:10px 8px;">Reisedaten</th>
        <th style="padding:10px 8px;">Airline</th>
        <th style="padding:10px 8px;">Preis</th>
        <th style="padding:10px 8px;"></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:32px;color:#999;font-size:12px;">
    Preise sind Richtwerte von Google Flights. Immer nochmal auf der Buchungsseite prüfen.
  </p>
</body>
</html>`;
}

async function sendEmail(deals) {
  // Nutzt Gmail SMTP über OAuth-less App-Password oder direkt Nodemailer
  // Für den ersten Test: Ausgabe in Konsole + Datei
  const html = buildEmailHtml(deals);

  // Versuche echten Versand via SMTP (braucht EMAIL_USER + EMAIL_PASS env vars)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: `Spontan Trips <${process.env.EMAIL_USER}>`,
      to: EMAIL_TO,
      subject: `✈️ ${deals.length} Spontan-Deals unter ${MAX_PRICE}€ · ${new Date().toLocaleDateString("de-DE")}`,
      html,
    });
    console.log(`E-Mail an ${EMAIL_TO} gesendet!`);
  } else {
    // Speichert HTML-Vorschau lokal
    require("fs").writeFileSync("email-preview.html", html);
    console.log("EMAIL_USER/EMAIL_PASS nicht gesetzt → email-preview.html gespeichert");
  }
}

async function main() {
  console.log("🔍 Suche Spontan-Trips von Berlin...\n");
  const dates = getSearchDates();
  console.log(`Prüfe ${dates.length} Datumskombinationen (Fr/Sa → Mo/Di)...\n`);

  const allDeals = [];
  for (const { out, ret, label } of dates) {
    process.stdout.write(`  ${label} ... `);
    const deals = await searchFlight(out, ret);
    if (deals.length > 0) {
      console.log(`${deals.length} Deal(s) gefunden!`);
      allDeals.push(...deals);
    } else {
      console.log("nichts unter 100€");
    }
    // Kurze Pause um Rate Limits zu vermeiden
    await new Promise(r => setTimeout(r, 500));
  }

  // Sortiere nach Preis
  allDeals.sort((a, b) => a.price - b.price);

  console.log(`\n✅ Gesamt: ${allDeals.length} Deal(s) gefunden`);
  if (allDeals.length > 0) {
    console.log("\nBeste Deals:");
    allDeals.slice(0, 5).forEach(d =>
      console.log(`  €${d.price} · ${d.destination} · ${d.outDate} → ${d.retDate}`)
    );
  }

  await sendEmail(allDeals);
}

main().catch(console.error);
