# Vertical Log - Multi-Pitch Route Log

A lightweight, responsive web application to track and display climbing routes. It fetches data dynamically from a Google Sheet and presents it in an interactive table with search and advanced sorting capabilities.

## 🚀 Features

- **Dynamic Data**: Fetches routes directly from a Google Spreadsheets CSV export.
- **Smart Sorting**: 
  - **Grades**: Special logic to sort climbing grades (e.g., 6a+ > 6a > 5).
  - **Dates**: Chronological sorting for route completion dates.
  - **Numeric/Text**: standard sorting for meters, names, and locations.
- **Instant Search**: Filter routes by name, grade, wall, or area.
- **Responsive Design**: 
  - **Desktop**: Full table view with sortable headers.
  - **Mobile**: Card-style layout for better readability on small screens.
- **Reliability**: Uses multiple CORS proxies with automatic fallback to ensure data availability.

## 🛠️ Technology Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+).
- **Icons**: [Font Awesome](https://fontawesome.com/).
- **Typography**: [Google Fonts (Roboto)](https://fonts.google.com/).
- **Data Source**: Google Sheets (via CSV API).

## 📂 Project Structure

- `index.html`: Main structure and UI.
- `style.css`: Premium responsive design with dark mode aesthetics and glassmorphism.
- `script.js`: Core logic for fetching, parsing (CSV), sorting, and rendering.

## 🔧 Setup

1. Clone the repository.
2. Provide your own Google Sheet CSV URL in `script.js` (variable `SHEET_URL`).
3. Open `index.html` in any modern browser.

## ⚖️ License

This project is licensed under the [MIT License](LICENSE).
