# Daylog: Every Day Is Something

One curated observance for every day of the year — merged from NatDayCal and UN International Days. From Pretend to Be a Time Traveler Day to National If Pets Had Thumbs Day (March 3) the calendar got it all.

Inspired by today's day... world's ocean day.

## Setup

### 1. Create a GitHub repo

Make it public. Name it whatever you want, e.g. `daycal`.

### 2. Push this folder

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/<your-username>/daycal.git
git push -u origin main
```

### 3. Enable GitHub Pages

Repo → Settings → Pages → Source: **Deploy from a branch** → Branch: `main` → Folder: `/public` → Save.

### 4. Run the workflow once manually

Repo → Actions → "Update Calendar" → Run workflow.

This generates `public/calendar.ics` and commits it. After that it runs every day at 02:00 UTC automatically.

### 5. Share your subscribe URL

Your calendar will be live at:

```
webcal://<your-username>.github.io/daycal/calendar.ics
```

The landing page at `https://<your-username>.github.io/daycal/` has one-click buttons for Google Calendar and Apple Calendar.

## Adding more sources

Edit `merge.js` and add entries to the `FEEDS` array:

```js
{
  name: "WHO Health Days",
  url: "https://...",
  priority: 3,  // higher number = lower priority (NatDayCal wins ties)
},
```

Priority 1 events win when two sources land on the same day. If you want UN days to win over NatDayCal, swap their priority numbers.

## Local test

```bash
node merge.js
# → writes public/calendar.ics
```

No dependencies.
