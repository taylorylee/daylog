#!/usr/bin/env node
/**
 * merge.js — fetches multiple ICS feeds, merges by date (one event per day),
 * and writes a combined calendar.ics to ./public/calendar.ics
 *
 * Priority order (lower number wins when two events share a date):
 *   1. NatDayCal — fun/quirky national days (Google Calendar public feed)
 *   2. UN International Days — official UN observances (GitHub raw)
 *   3. Built-in seed — fallback fun days in case feeds are unreachable
 *
 * Run locally: node merge.js
 * In CI: see .github/workflows/update.yml
 */

const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");

// ── Feed sources ──────────────────────────────────────────────────────────────
const FEEDS = [
  {
    name: "NatDayCal",
    // Public Google Calendar ICS — works in GitHub Actions, blocked in some sandboxes
    url: "https://calendar.google.com/calendar/ical/9u8jqp3hlt6pe675gie6lf1d9o%40group.calendar.google.com/public/basic.ics",
    priority: 1,
  },
  {
    name: "UN International Days",
    url: "https://raw.githubusercontent.com/civilianEU/un-international-days/master/un-international-days.ics",
    priority: 2,
  },
];

// ── Fallback seed (fun days for any date not covered by live feeds) ───────────
// Format: "MMDD": "Event Name"
const SEED = {
  "0101": "New Year's Day",
  "0202": "Groundhog Day",
  "0214": "Valentine's Day",
  "0317": "St. Patrick's Day",
  "0401": "April Fools' Day",
  "0422": "Earth Day",
  "0501": "May Day",
  "0504": "Star Wars Day",
  "0608": "World Ocean Day",
  "0623": "National Pink Day",
  "0704": "Independence Day (US)",
  "0723": "National Hot Dog Day",
  "0808": "International Cat Day",
  "0826": "National Dog Day",
  "0909": "National Teddy Bear Day",
  "1004": "World Animal Day",
  "1031": "Halloween",
  "1111": "Veterans Day / Singles Day",
  "1201": "World AIDS Day",
  "1221": "Winter Solstice",
  "1225": "Christmas Day",
  "1231": "New Year's Eve",
};

const OUTPUT_DIR  = path.join(__dirname, "public");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "calendar.ics");

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetch(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error("Too many redirects"));
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

/**
 * Minimal ICS parser — extracts VEVENT blocks.
 * Returns array of { dateKey (YYYYMMDD), raw, summary, source, priority }
 */
function parseEvents(icsText, sourceName, priority) {
  const events = [];
  const lines = icsText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")   // unfold RFC 5545 line folding
    .split("\n");

  let inEvent = false;
  let current = [];

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = [line];
    } else if (line === "END:VEVENT") {
      current.push(line);
      const block = current.join("\r\n");
      const dtMatch      = block.match(/DTSTART(?:;[^:]*)?:(\d{8})/);
      const summaryMatch = block.match(/SUMMARY:(.+)/);
      if (dtMatch) {
        events.push({
          dateKey:  dtMatch[1],
          raw:      block,
          summary:  summaryMatch ? summaryMatch[1].trim() : "Untitled",
          source:   sourceName,
          priority,
        });
      }
      inEvent = false;
      current = [];
    } else if (inEvent) {
      current.push(line);
    }
  }
  return events;
}

/**
 * Build VEVENT blocks from the seed object for any year range.
 */
function seedEvents(years) {
  const events = [];
  for (const year of years) {
    for (const [mmdd, summary] of Object.entries(SEED)) {
      const dateKey = `${year}${mmdd}`;
      const uid     = `seed-${dateKey}@daycal`;
      const block   = [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTART;VALUE=DATE:${dateKey}`,
        `DTEND;VALUE=DATE:${dateKey}`,
        `SUMMARY:${summary}`,
        "END:VEVENT",
      ].join("\r\n");
      events.push({ dateKey, raw: block, summary, source: "Seed", priority: 99 });
    }
  }
  return events;
}

/**
 * Merge: one event per day. Lowest priority number wins.
 */
function mergeEvents(allEvents) {
  const byDate = {};
  for (const ev of allEvents) {
    if (!byDate[ev.dateKey]) byDate[ev.dateKey] = [];
    byDate[ev.dateKey].push(ev);
  }
  const merged = [];
  for (const dateKey of Object.keys(byDate).sort()) {
    const candidates = byDate[dateKey].sort((a, b) => a.priority - b.priority);
    merged.push(candidates[0]);
  }
  return merged;
}

function generateICS(events) {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DayCal//Every Day Is Something//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Every Day Is Something",
    "X-WR-CALDESC:One curated observance or fun national day for every day of the year.",
    "X-WR-TIMEZONE:UTC",
  ].join("\r\n");

  const body   = events.map((ev) => ev.raw).join("\r\n");
  const footer = "END:VCALENDAR";
  return `${header}\r\n${body}\r\n${footer}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  console.log("Fetching feeds...");
  const allEvents = [];

  for (const feed of FEEDS) {
    try {
      process.stdout.write(`  → ${feed.name} ... `);
      const ics    = await fetch(feed.url);
      const events = parseEvents(ics, feed.name, feed.priority);
      console.log(`${events.length} events`);
      allEvents.push(...events);
    } catch (err) {
      console.log(`SKIPPED (${err.message})`);
    }
  }

  // Add seed events for dates not covered by live feeds
  const seedEvs = seedEvents(years);
  allEvents.push(...seedEvs);
  console.log(`  → Seed fallback: ${seedEvs.length} events (low priority)`);

  console.log(`\nTotal raw events: ${allEvents.length}`);
  const merged = mergeEvents(allEvents);
  console.log(`After merge (one per day): ${merged.length} events`);

  // Source breakdown
  const sources = {};
  for (const ev of merged) sources[ev.source] = (sources[ev.source] || 0) + 1;
  for (const [src, count] of Object.entries(sources)) {
    console.log(`  ${src}: ${count} days`);
  }

  const icsContent = generateICS(merged);
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, icsContent, "utf8");

  console.log(`\n✓ Written: ${OUTPUT_FILE}`);
  console.log(`\nSubscribe URL (replace placeholders):`);
  console.log(`  webcal://<username>.github.io/<repo>/calendar.ics`);
}

main().catch((err) => { console.error(err); process.exit(1); });
