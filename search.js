const https = require("https");
const nodemailer = require("nodemailer");
const fs = require("fs");

// ─── Config ───────────────────────────────────────────────────────────────────
const SERPAPI_KEY = process.env.SERPAPI_KEY || "cc824d14af98ebb20291985f57274bc87d499f0efbabbdc617b0fa246f47d699";
const EMAIL_TO    = "riosternberg@gmail.com";
const MAX_PRICE   = 100;
const ORIGIN      = "BER";

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("JSON parse error: " + data.slice(0, 200))); }
      });
    }).on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Schritt 1: google_travel_explore → alle günstigen Ziele von BER ──────────
// duration=1 = Weekend, duration=2 = 1 Woche
// Wir rufen beide ab, damit wir Fr-Mo UND längere Trips sehen
async function exploreDestinations(duration) {
  const url =
    `https://serpapi.com/search.json?engine=google_travel_explore` +
    `&departure_id=${ORIGIN}` +
    `&currency=EUR&hl=de&gl=de` +
    `&trip_duration=${duration}` +  // 1=Weekend, 2=1Woche
    `&api_key=${SERPAPI_KEY}`;

  console.log(`  → Explore (duration=${duration})...`);
  const data = await fetchJson(url);

  if (data.error) throw new Error("SerpApi Fehler: " + data.error);

  const results = (data.destinations || []).filter(
    (d) => d.price && d.price <= MAX_PRICE
  );
  return results;
}

// ─── Schritt 2: Für jeden Deal den genauen Flug holen ─────────────────────────
async function getFlightDetails(dest) {
  // Explore gibt start_date/end_date zurück — wir nutzen die direkt
  const outDate = dest.start_date;
  const retDate = dest.end_date;

  if (!outDate || !retDate) return null;

  const url =
    `https://serpapi.com/search.json?engine=google_flights` +
    `&departure_id=${ORIGIN}` +
    `&arrival_id=${dest.destination_id || dest.code}` +
    `&outbound_date=${outDate}` +
    `&return_date=${retDate}` +
    `&currency=EUR&hl=de&gl=de&type=1` +
    `&api_key=${SERPAPI_KEY}`;

  try {
    const data = await fetchJson(url);
    const flights = [...(data.best_flights || []), ...(data.other_flights || [])];
    const cheapest = flights.sort((a, b) => a.price - b.price)[0];

    if (!cheapest || cheapest.price > MAX_PRICE) return null;

    const leg = cheapest.flights?.[0];
    return {
      destination: dest.name,
      country: dest.country || "",
      destCode: leg?.arrival_airport?.id || dest.destination_id,
      airline: leg?.airline || "?",
      stops: cheapest.flights?.length > 1 ? cheapest.flights.length - 1 : 0,
      duration: cheapest.total_duration,
      price: cheapest.price,
      outDate,
      retDate,
      googleFlightsUrl: data.search_parameters
        ? `https://www.google.com/flights?hl=de#flt=${ORIGIN}.${leg?.arrival_airport?.id}.${outDate}*${leg?.arrival_airport?.id}.${ORIGIN}.${retDate}`
        : dest.google_flights_url || "#",
    };
  } catch (e) {
    console.warn(`    Fehler bei Flugdetails für ${dest.name}:`, e.message);
    return null;
  }
}

// ─── E-Mail bauen ─────────────────────────────────────────────────────────────
function buildEmailHtml(deals) {
  const date = new Date().toLocaleDateString("de-DE", {
    weekday: "long", day: "numeric", month: "long",
  });

  if (deals.length === 0) {
    return `
      <body style="font-family:sans-serif;padding:32px;color:#333;max-width:600px;margin:auto;">
        <h2 style="font-size:22px;margin-bottom:8px;">✈️ Spontan-Trips · ${date}</h2>
        <p style="color:#666;">Heute leider keine Flüge unter ${MAX_PRICE}€ gefunden. Morgen wieder!</p>
        <p style="color:#999;font-size:12px;margin-top:32px;">Suche läuft täglich automatisch von Berlin (BER).</p>
      </body>`;
  }

  const cards = deals.map((d) => {
    const nights = Math.round(
      (new Date(d.retDate) - new Date(d.outDate)) / 86400000
    );
    const stopsLabel = d.stops === 0 ? "Direktflug" : `${d.stops} Stopp`;
    const durationH = Math.floor(d.duration / 60);
    const durationM = d.duration % 60;

    return `
    <tr>
      <td style="padding:0 0 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:10px;overflow:hidden;">
          <tr>
            <td style="padding:16px 20px;background:#f9f9f9;border-bottom:1px solid #e8e8e8;">
              <table width="100%"><tr>
                <td>
                  <div style="font-size:18px;font-weight:600;color:#111;">
                    ${d.destination}
                    <span style="font-size:13px;font-weight:400;color:#888;">${d.country}</span>
                  </div>
                  <div style="font-size:13px;color:#555;margin-top:4px;">
                    ${formatDate(d.outDate)} → ${formatDate(d.retDate)}
                    &nbsp;·&nbsp; ${nights} Nächte
                  </div>
                </td>
                <td align="right" style="white-space:nowrap;">
                  <div style="font-size:28px;font-weight:700;color:#1a7a4a;">€${d.price}</div>
                  <div style="font-size:11px;color:#888;">hin & zurück p.P.</div>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 20px;">
              <table width="100%"><tr>
                <td style="font-size:13px;color:#555;">
                  ${d.airline} · ${stopsLabel}
                  ${d.duration ? ` · ${durationH}h${durationM > 0 ? durationM + "m" : ""}` : ""}
                </td>
                <td align="right">
                  <a href="${d.googleFlightsUrl}"
                     style="display:inline-block;background:#1a7a4a;color:#fff;padding:8px 18px;
                            border-radius:6px;text-decoration:none;font-size:13px;font-weight:500;">
                    Jetzt buchen →
                  </a>
                </td>
              </tr></table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }).join("");

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
             background:#f4f4f4;padding:24px;margin:0;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:12px;overflow:hidden;
                    box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#111;padding:24px 32px;">
            <div style="font-size:22px;font-weight:600;color:#fff;">✈️ Spontan-Trips</div>
            <div style="font-size:13px;color:#aaa;margin-top:4px;">
              ${deals.length} Deal${deals.length > 1 ? "s" : ""} unter ${MAX_PRICE}€ · ${date}
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${cards}
            </table>
            <p style="font-size:11px;color:#bbb;margin-top:8px;">
              Preise von Google Flights. Bitte nochmal auf der Buchungsseite prüfen.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("de-DE", {
    weekday: "short", day: "numeric", month: "short",
  });
}

// ─── E-Mail senden ────────────────────────────────────────────────────────────
async function sendEmail(deals) {
  const html = buildEmailHtml(deals);
  const subject = deals.length > 0
    ? `✈️ ${deals.length} Spontan-Deal${deals.length > 1 ? "s" : ""} unter ${MAX_PRICE}€ · ${new Date().toLocaleDateString("de-DE")}`
    : `✈️ Keine Deals heute · ${new Date().toLocaleDateString("de-DE")}`;

  // Vorschau immer speichern
  fs.writeFileSync("email-preview.html", html);
  console.log("\n📄 E-Mail-Vorschau gespeichert: email-preview.html");

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: `Spontan Trips <${process.env.EMAIL_USER}>`,
      to: EMAIL_TO,
      subject,
      html,
    });
    console.log(`📧 E-Mail gesendet an ${EMAIL_TO}`);
  } else {
    console.log("⚠️  EMAIL_USER/EMAIL_PASS nicht gesetzt → nur Vorschau-Datei");
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔍 Spontan-Trip Suche startet...\n");

  let rawDeals = [];

  // Explore für Weekends (Fr–Mo) und kurze Trips (Mo–Fr Woche)
  for (const dur of [1, 2]) {
    try {
      const destinations = await exploreDestinations(dur);
      console.log(`  ✓ ${destinations.length} Ziele unter ${MAX_PRICE}€ gefunden (duration=${dur})`);
      rawDeals.push(...destinations);
    } catch (e) {
      console.error(`  ✗ Explore Fehler (duration=${dur}):`, e.message);
    }
    await sleep(600);
  }

  // Deduplizieren nach Zielname
  const seen = new Set();
  rawDeals = rawDeals.filter((d) => {
    if (seen.has(d.name)) return false;
    seen.add(d.name);
    return true;
  });

  console.log(`\n📍 ${rawDeals.length} einzigartige Ziele gefunden. Hole Flugdetails...\n`);

  const deals = [];
  for (const dest of rawDeals) {
    process.stdout.write(`  ${dest.name} (€${dest.price}) ... `);
    const detail = await getFlightDetails(dest);
    if (detail) {
      console.log(`✓ €${detail.price} · ${detail.outDate} → ${detail.retDate}`);
      deals.push(detail);
    } else {
      console.log("übersprungen");
    }
    await sleep(400);
  }

  deals.sort((a, b) => a.price - b.price);

  console.log(`\n✅ ${deals.length} bestätigte Deals unter ${MAX_PRICE}€`);
  if (deals.length > 0) {
    console.log("\nTop Deals:");
    deals.slice(0, 5).forEach((d) =>
      console.log(`  €${d.price} · ${d.destination} · ${d.outDate} → ${d.retDate}`)
    );
  }

  await sendEmail(deals);
}

main().catch((e) => {
  console.error("Fataler Fehler:", e);
  process.exit(1);
});
