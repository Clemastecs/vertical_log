# Vertical Log - Multi-Pitch Route Log

A lightweight, responsive web application to track and display climbing routes. It fetches data dynamically from a Google Sheet and presents it in an interactive table with search and advanced sorting capabilities.

## 🚀 Features

- **Synced data**: A weekly GitHub Action mirrors the Google Sheet into the repo; the
  page reads that local copy first, with the live Sheet (and CORS proxies) as fallback.
- **Smart Sorting**: 
  - **Grades**: Special logic to sort climbing grades, French and UIAA (e.g., 6a+ > 6a > V > IV).
  - **Dates**: Chronological sorting for route completion dates.
  - **Numeric/Text**: standard sorting (Catalan collation) for meters, names, and locations.
- **Instant Search**: Filter routes by name, grade, wall, or area.
- **Stats & map**: Charts (Chart.js) and a Leaflet map, both lazy-loaded on demand.
- **Light / dark mode**: Theme toggle with system-preference detection and persistence.
- **Responsive Design**: 
  - **Desktop**: Full table view with sortable headers.
  - **Mobile**: Card-style layout for better readability on small screens.

## 🛠️ Technology Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+) — no build step.
- **Icons**: inline SVG sprite (paths from Font Awesome Free, CC BY 4.0).
- **Typography**: [Google Fonts (Lexend)](https://fonts.google.com/specimen/Lexend).
- **Charts / Map**: [Chart.js](https://www.chartjs.org/) and [Leaflet](https://leafletjs.com/), lazy-loaded from CDN.
- **Data Source**: Google Sheets (CSV), synced to `data/vies.csv` via GitHub Actions.

## 📂 Project Structure

- `index.html`: Main structure, UI, and the inline SVG icon sprite.
- `style.css`: Responsive neo-brutalist design with a token-based light/dark theme.
- `script.js`: Core logic for fetching, parsing (CSV), sorting, rendering, charts, and map.
- `data/vies.csv`: Synced copy of the route data (updated by the workflow).
- `.github/workflows/sync-vies.yml`: Scheduled job that refreshes `data/vies.csv`.

## 🔄 Data & synchronization

Routes are edited in a **Google Sheet** (the convenient editing surface). A scheduled
**GitHub Action** (`.github/workflows/sync-vies.yml`) downloads the published CSV and
commits it to **`data/vies.csv`** once a week (and on manual trigger). The page reads
this local copy first (same-origin, fast, no CORS), falling back to the live Sheet if
it's missing.

- **Manual sync**: GitHub → *Actions* → *Sync vies data* → *Run workflow*.
- **In-page refresh**: the discreet ⟳ button by the table loads the latest data live
  from the Sheet, bypassing the local copy and the cache.
- **Editing**: a discreet ✎ link in the footer opens the Sheet in edit mode (Google
  handles login/permissions). Set its URL in the `#edit-sheet` href in `index.html`.

## 🔧 Setup

1. Clone the repository.
2. Provide your own Google Sheet CSV URL in `script.js` (`SHEET_URL`) and in the
   workflow (`.github/workflows/sync-vies.yml`).
3. **Serve over HTTP** (e.g. `python -m http.server`, then open `http://localhost:8000`).
   Opening `index.html` directly via `file://` makes the browser block the data fetch.

## ⚖️ License

This project is licensed under the [MIT License](LICENSE).
