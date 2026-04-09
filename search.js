const https = require("https");
const nodemailer = require("nodemailer");
const fs = require("fs");

// ─── Config ───────────────────────────────────────────────────────────────────
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const EMAIL_TO    = "riosternberg@gmail.com";
const MAX_PRICE   = 100;
const ORIGIN      = "BER";

if (!SERPAPI_KEY) {
  console.error("❌ SERPAPI_KEY nicht gesetzt! Bitte als GitHub Secret hinterlegen.");
  process.exit(1);
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          console.error("Parse error. Raw response:", data.slice(0, 500));
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Explore: Günstigste Ziele von BER ───────────────────────────────────────
// duration=1 → Weekend (Fr-Mo), duration=2 → 1 Woche
async function exploreDestinations(duration) {
  const label = duration === 1 ? "Weekend" : "1 Woche";
  const url = [
    "https://serpapi.com/search.json",
    "?engine=google_travel_explore",
    `&departure_id=${ORIGIN}`,
    `&duration=${duration}`,
    "&currency=EUR",
    "&hl=de",
    "&gl=de",
    `&api_key=${SERPAPI_KEY}`,
  ].join("");

  console.log(`\n🔍 Explore [${label}]...`);
  const data = await fetchJson(url);

  if (data.error) {
    console.error("  API Fehler:", data.error);
    return [];
  }

  // Debug: zeige was zurückkommt
  console.log(`  Status: ${data.search_metadata?.status}`);
  console.log(`  Anzahl Destinations: ${(data.destinations || []).length}`);

  if (!data.destinations || data.destinations.length === 0) {
    console.log("  ⚠️  Keine Destinations in der Antwort.");
    console.log("  Keys in response:", Object.keys(data).join(", "));
    return [];
  }

  // Korrekte Struktur: destination.flight.price ODER destination.price
  const deals = data.destinations.filter((d) => {
    const price = d.flight?.price ?? d.price;
    return price && price <= MAX_PRICE;
  });

  console.log(`  ✓ ${deals.length} Deals unter ${MAX_PRICE}€`);
  return deals.map((d) => ({
    name: d.name,
    country: d.country || "",
    destId: d.destination_id || d.kgmid || d.primary_airport,
    airportCode: d.flight?.airport_code || d.primary_airport,
    price: d.flight?.price ?? d.price,
    airline: d.flight?.airline_name || d.flight?.airline_code || "?",
    stops: d.flight?.stops ?? 0,
    flightDuration: d.flight?.flight_duration || "",
    outDate: d.outbound_date || d.start_date,
    retDate: d.return_date || d.end_date,
    googleFlightsLink: d.google_flights_link || d.google_flights_serpapi_link || null,
  }));
}

// ─── Preis-Check für ein bestimmtes Ziel + Datum ──────────────────────────────
// Gibt uns den echten bestätigten Preis zurück
async function confirmFlight(deal) {
  if (!deal.airportCode || !deal.outDate || !deal.retDate) return deal;

  const url = [
    "https://serpapi.com/search.json",
    "?engine=google_flights",
    `&departure_id=${ORIGIN}`,
    `&arrival_id=${deal.airportCode}`,
    `&outbound_date=${deal.outDate}`,
    `&return_date=${deal.retDate}`,
    "&currency=EUR&hl=de&gl=de&type=1",
    `&api_key=${SERPAPI_KEY}`,
  ].join("");

  try {
    const data = await fetchJson(url);
    const flights = [
      ...(data.best_flights || []),
      ...(data.other_flights || []),
    ].sort((a, b) => a.price - b.price);

    if (flights.length === 0) return deal; // Explore-Preis behalten

    const best = flights[0];
    const leg = best.flights?.[0];

    return {
      ...deal,
      price: best.price,
      airline: leg?.airline || deal.airline,
      stops: (best.flights?.length || 1) - 1,
      flightDuration: best.total_duration
        ? `${Math.floor(best.total_duration / 60)}h${best.total_duration % 60 > 0 ? best.total_duration % 60 + "m" : ""}`
        : deal.flightDuration,
      googleFlightsLink:
        data.search_parameters
          ? `https://www.google.com/flights?hl=de#flt=${ORIGIN}.${deal.airportCode}.${deal.outDate}*${deal.airportCode}.${ORIGIN}.${deal.retDate}`
          : deal.googleFlightsLink,
    };
  } catch (e) {
    console.warn(`    ⚠️  Fehler bei Bestätigung ${deal.name}:`, e.message);
    return deal; // Explore-Preis als Fallback
  }
}

// ─── E-Mail ───────────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return "?";
  return new Date(iso + "T12:00:00").toLocaleDateString("de-DE", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function buildEmailHtml(deals) {
  const dateStr = new Date().toLocaleDateString("de-DE", {
    weekday: "long", day: "numeric", month: "long",
  });

  if (deals.length === 0) {
    return `<body style="font-family:sans-serif;padding:32px;color:#333;max-width:600px;margin:auto;">
      <h2>✈️ Spontan-Trips · ${dateStr}</h2>
      <p style="color:#666;">Heute keine Flüge unter ${MAX_PRICE}€ von Berlin gefunden.</p>
      <p style="color:#999;font-size:12px;">Morgen wieder!</p>
    </body>`;
  }

  const cards = deals.map((d) => {
    const nights = d.outDate && d.retDate
      ? Math.round((new Date(d.retDate) - new Date(d.outDate)) / 86400000)
      : "?";
    const stopsLabel = d.stops === 0 ? "Direktflug" : `${d.stops} Stopp${d.stops > 1 ? "s" : ""}`;
    const bookUrl = d.googleFlightsLink || `https://www.google.com/flights?hl=de`;

    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden;">
      <tr><td style="padding:16px 20px;background:#f7f7f7;border-bottom:1px solid #e0e0e0;">
        <table width="100%"><tr>
          <td>
            <div style="font-size:18px;font-weight:600;color:#111;">${d.name} <span style="font-size:13px;font-weight:400;color:#888;">${d.country}</span></div>
            <div style="font-size:13px;color:#555;margin-top:4px;">${formatDate(d.outDate)} → ${formatDate(d.retDate)} · ${nights} Nächte</div>
          </td>
          <td align="right">
            <div style="font-size:28px;font-weight:700;color:#1a7a4a;">€${d.price}</div>
            <div style="font-size:11px;color:#888;">hin & zurück p.P.</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:14px 20px;">
        <table width="100%"><tr>
          <td style="font-size:13px;color:#555;">${d.airline} · ${stopsLabel}${d.flightDuration ? " · " + d.flightDuration : ""}</td>
          <td align="right">
            <a href="${bookUrl}" style="background:#1a7a4a;color:#fff;padding:9px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500;">Buchen →</a>
          </td>
        </tr></table>
      </td></tr>
    </table>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f0f0f0;padding:24px;margin:0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#111;padding:24px 32px;">
        <div style="font-size:22px;font-weight:600;color:#fff;">✈️ Spontan-Trips</div>
        <div style="color:#aaa;font-size:13px;margin-top:4px;">${deals.length} Deal${deals.length > 1 ? "s" : ""} unter ${MAX_PRICE}€ von Berlin · ${dateStr}</div>
      </td></tr>
      <tr><td style="padding:24px 32px;">
        ${cards}
        <p style="font-size:11px;color:#bbb;margin-top:8px;">Preise von Google Flights – bitte nochmal auf der Buchungsseite prüfen.</p>
      </td></tr>
    </table>
    </td></tr></table>
  </body></html>`;
}

async function sendEmail(deals) {
  const html = buildEmailHtml(deals);
  fs.writeFileSync("email-preview.html", html);
  console.log("\n📄 email-preview.html gespeichert");

  const subject = deals.length > 0
    ? `✈️ ${deals.length} Spontan-Deal${deals.length > 1 ? "s" : ""} unter €${MAX_PRICE} · ${new Date().toLocaleDateString("de-DE")}`
    : `✈️ Heute keine Deals · ${new Date().toLocaleDateString("de-DE")}`;

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (user && pass) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transporter.sendMail({ from: `Spontan Trips <${user}>`, to: EMAIL_TO, subject, html });
    console.log(`📧 E-Mail gesendet an ${EMAIL_TO}`);
  } else {
    console.log("⚠️  EMAIL_USER/EMAIL_PASS fehlt → nur Vorschau gespeichert");
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("✈️  Spontan-Trip Suche von Berlin startet...");
  console.log(`   Preis-Limit: €${MAX_PRICE} · Abflug: ${ORIGIN}\n`);

  let allDeals = [];

  // Weekend (Fr–Mo)
  const weekendDeals = await exploreDestinations(1);
  allDeals.push(...weekendDeals);
  await sleep(800);

  // Kurzurlaub (ca. 1 Woche)
  const weekDeals = await exploreDestinations(2);
  allDeals.push(...weekDeals);
  await sleep(800);

  // Deduplizieren nach Zielname
  const seen = new Set();
  allDeals = allDeals.filter((d) => {
    if (seen.has(d.name)) return false;
    seen.add(d.name);
    return true;
  });

  console.log(`\n📍 ${allDeals.length} einzigartige Ziele unter €${MAX_PRICE}`);

  if (allDeals.length === 0) {
    console.log("   Keine Deals → sende leere E-Mail");
    await sendEmail([]);
    return;
  }

  // Für die Top-10 Deals Flugdetails bestätigen
  console.log("\n🔎 Bestätige Preise...");
  const toConfirm = allDeals.slice(0, 10);
  const confirmed = [];

  for (const deal of toConfirm) {
    process.stdout.write(`  ${deal.name} (€${deal.price}) ... `);
    const confirmed_ = await confirmFlight(deal);
    if (confirmed_.price <= MAX_PRICE) {
      console.log(`✓ €${confirmed_.price}`);
      confirmed.push(confirmed_);
    } else {
      console.log(`überschreitet Limit (€${confirmed_.price})`);
    }
    await sleep(400);
  }

  // Restliche Deals ohne Bestätigung dazunehmen
  const rest = allDeals.slice(10);
  const finalDeals = [...confirmed, ...rest].sort((a, b) => a.price - b.price);

  console.log(`\n✅ ${finalDeals.length} bestätigte Deals`);
  finalDeals.slice(0, 5).forEach((d) =>
    console.log(`   €${d.price} · ${d.name} · ${d.outDate} → ${d.retDate}`)
  );

  await sendEmail(finalDeals);
}

main().catch((e) => {
  console.error("\n💥 Fataler Fehler:", e.message);
  process.exit(1);
});
