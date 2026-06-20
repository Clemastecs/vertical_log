const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR7K0lF7k4iZ1OSbuavBjG47LES1A-FpnnqUOlqzVfGlRTI-ZQrkR6C-3tFUyPAOg065EBgxFzotBKt/pub?output=csv';

// List of proxies to try in order
const PROXIES = [
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://api.allorigins.win/raw?url='
];

// Global state
let viesData = [];
let currentSort = { column: 6, direction: 'desc' }; // Data d'escalada, descendent per defecte
let searchQuery = ''; // Current search filter
let zonesChart = null;
let yearsChart = null;
let seasonsChart = null;
let map = null;
let markerLayer = null;

// --- Lazy-loaded CDN libraries (loaded on demand, not at page load) ---
const CDN = {
    chart: 'https://cdn.jsdelivr.net/npm/chart.js',
    leafletJs: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    leafletCss: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
};
const _scriptPromises = {};

// Inject a <script defer> once; resolves when loaded. Memoised per src.
function loadScript(src) {
    if (_scriptPromises[src]) return _scriptPromises[src];
    _scriptPromises[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.defer = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
    });
    return _scriptPromises[src];
}

// Chart.js: only needed once the user opens "més estadístiques".
const loadChartJs = () => loadScript(CDN.chart);

// Leaflet: CSS + JS, loaded the first time the map scrolls into view.
let _leafletPromise = null;
function loadLeaflet() {
    if (_leafletPromise) return _leafletPromise;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CDN.leafletCss;
    document.head.appendChild(link);
    _leafletPromise = loadScript(CDN.leafletJs);
    return _leafletPromise;
}

// Local synced copy of the data (committed to the repo by the GitHub Action),
// served same-origin — the primary source, with the live Sheet as fallback.
const LOCAL_DATA_URL = 'data/vies.csv';

// CSV session cache (short TTL) so reloads within the same tab are instant.
const DATA_TTL_MS = 10 * 60 * 1000;
const CACHE_KEY = 'viesCSV';

// Reused collator for Catalan text sorting (cheaper than per-call localeCompare).
const textCollator = new Intl.Collator('ca', { sensitivity: 'base' });

// Columns to search: Nom(1), Grau(2), Agulla/Paret(4), Zona(5)
const SEARCH_COLUMNS = [1, 2, 4, 5];

// CSV columns: 0=Nº,1=Nom,2=Grau,3=Metres,4=Paret,5=Zona,6=Data,7=Enllaç,8=Ubicació(coords)
const LABELS = ['Nº', 'Nom', 'Grau', 'Metres', 'Paret', 'Zona', 'Data', 'Enllaç'];
const COORDS_COL = 8; // Index of the Ubicació column in the CSV

// Column types for smart sorting
const COLUMN_TYPES = {
    0: 'numeric',   // Nº
    1: 'text',      // Nom
    2: 'grade',     // Grau
    3: 'numeric',   // Metres
    4: 'text',      // Agulla/Paret
    5: 'text',      // Zona
    6: 'date',      // Data
    7: 'none'       // Enllaç (no sorting)
};

/**
 * Read a CSS theme custom property (e.g. '--accent') from :root, with a fallback.
 * Used so Chart.js colours follow the active light/dark theme.
 */
function getThemeColor(variableName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
    return value || fallback;
}



async function fetchWithFallback(url) {
    // 1) Direct request first. Google's "published to web" CSV now serves
    //    `Access-Control-Allow-Origin: *`, so in practice no proxy is needed.
    //    Freshness is governed by our sessionStorage TTL, so no cache-buster here.
    try {
        const direct = await fetch(url);
        if (direct.ok) return await direct.text();
    } catch (err) {
        console.warn('Direct fetch failed, falling back to CORS proxies...');
    }

    // 2) Fall back to third-party CORS proxies (may be rate-limited or down).
    for (const proxy of PROXIES) {
        try {
            const response = await fetch(`${proxy}${encodeURIComponent(url)}`);
            if (response.ok) return await response.text();
        } catch (err) {
            console.warn(`Proxy ${proxy} failed, trying next...`);
        }
    }
    throw new Error('Unable to fetch data (direct request and all CORS proxies failed).');
}

// UIAA/Roman grade values (I–XII) for sorting.
const ROMAN_GRADES = {
    I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
    VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12
};

/**
 * Parse a climbing grade string into a sortable numeric value.
 * Handles formats like: 4, 5+, 6a, 6a+, 6b, 7c+, 8a, and UIAA (IV, V+, VII).
 */
function gradeToSortValue(grade) {
    if (!grade || grade === '-') return -1;
    grade = grade.trim().toUpperCase();

    // UIAA/Roman numerals (I–XII), with optional '+'. Whole-string match so
    // VI/VII don't collapse onto V (the old startsWith chain returned 500 for all).
    const romanMatch = grade.match(/^([IVX]+)(\+?)$/);
    if (romanMatch && ROMAN_GRADES[romanMatch[1]] !== undefined) {
        return ROMAN_GRADES[romanMatch[1]] * 100 + (romanMatch[2] ? 50 : 0);
    }

    // Match patterns like "6A+", "7B", "5+", "4"
    const match = grade.match(/^(\d+)([A-C]?)(\+?)$/i);
    if (!match) return 0;

    const num = parseInt(match[1], 10) * 100;
    const letter = match[2] ? (match[2].toUpperCase().charCodeAt(0) - 64) * 10 : 0; // A=10, B=20, C=30
    const plus = match[3] ? 5 : 0;

    return num + letter + plus;
}

/**
 * Parse a date string into a sortable timestamp.
 * Handles DD/MM/YYYY, YYYY-MM-DD, and YYYY-MM.
 */
function dateToSortValue(dateStr) {
    if (!dateStr || dateStr === '-') return 0;
    dateStr = dateStr.trim();

    // Check for DD/MM/YYYY
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
        }
    }

    // Check for YYYY-MM or YYYY-MM-DD
    if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts.length === 2) {
            // YYYY-MM
            return new Date(parts[0], parts[1] - 1, 1).getTime();
        } else if (parts.length === 3) {
            // YYYY-MM-DD
            return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
        }
    }

    // Fallback if it's just a year
    if (/^\d{4}$/.test(dateStr)) {
        return new Date(dateStr, 0, 1).getTime();
    }

    return 0;
}

/**
 * Get the filtered subset of viesData based on the current search query.
 */
function getFilteredData() {
    if (!searchQuery) return [...viesData];
    const q = searchQuery.toLowerCase();
    return viesData.filter(row =>
        SEARCH_COLUMNS.some(col => (row[col] || '').toLowerCase().includes(q))
    );
}

/**
 * Sort the data array by a given column index and direction.
 */
function sortData(columnIndex, direction) {
    const type = COLUMN_TYPES[columnIndex];
    if (type === 'none') return;

    currentSort = { column: columnIndex, direction: direction };

    viesData.sort((a, b) => {
        const valA = (a[columnIndex] || '').trim();
        const valB = (b[columnIndex] || '').trim();
        let cmp = 0;

        switch (type) {
            case 'numeric':
                cmp = (parseFloat(valA) || 0) - (parseFloat(valB) || 0);
                break;
            case 'text':
                cmp = textCollator.compare(valA, valB);
                break;
            case 'grade':
                cmp = gradeToSortValue(valA) - gradeToSortValue(valB);
                break;
            case 'date':
                cmp = dateToSortValue(valA) - dateToSortValue(valB);
                break;
        }

        return direction === 'asc' ? cmp : -cmp;
    });

    renderTable();
    updateSortIndicators();
}

/**
 * Calculate and render statistics summary.
 */
function renderStats(data) {
    const statsContainer = document.getElementById('stats-summary');
    if (!statsContainer) return;

    if (data.length === 0) {
        statsContainer.innerHTML = '';
        return;
    }

    const totalMeters = data.reduce((sum, row) => sum + (parseFloat(row[3]) || 0), 0);
    const approximatePitches = Math.round(totalMeters / 27);
    const walls = new Set(data.map(row => (row[4] || '').trim()).filter(val => val && val !== '-'));
    const zones = new Set(data.map(row => (row[5] || '').trim()).filter(val => val && val !== '-'));

    // Manual calculation for years since June 23, 2005
    const startDate = new Date(2005, 5, 23); // June is 5 (0-indexed)
    const today = new Date();
    let yearsCount = today.getFullYear() - startDate.getFullYear();
    const m = today.getMonth() - startDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < startDate.getDate())) {
        yearsCount--;
    }

    statsContainer.innerHTML = `
        <div class="stats-item">
            <span class="stats-value">${data.length}</span>
            <span class="stats-label">Vies acabades</span>
        </div>
        <div class="stats-item">
            <span class="stats-value">${approximatePitches.toLocaleString()}</span>
            <span class="stats-label">nº de llargs</span>
        </div>
        <div class="stats-item">
            <span class="stats-value">${totalMeters.toLocaleString()}</span>
            <span class="stats-label">Metres</span>
        </div>
        <div class="stats-item">
            <span class="stats-value">${walls.size}</span>
            <span class="stats-label">Parets</span>
        </div>
        <div class="stats-item">
            <span class="stats-value">${zones.size}</span>
            <span class="stats-label">Zones</span>
        </div>
        <div class="stats-item">
            <span class="stats-value">${yearsCount}</span>
            <span class="stats-label">Anys</span>
        </div>
    `;
}

/**
 * Build a diverging (symmetrically centered) horizontal bar chart with Chart.js.
 * The three stats charts share identical styling and only differ in their data,
 * so they all funnel through here once they've computed an ordered {labels, counts}.
 *
 * @param {string} canvasId  id of the <canvas> element
 * @param {string[]} labels  category labels, already in display order
 * @param {Object} counts    map of label -> count
 * @returns {Chart|null}     the Chart instance, or null if nothing to draw
 */
function buildDivergingBarChart(canvasId, labels, counts) {
    if (typeof Chart === 'undefined') return null; // Chart.js not loaded yet
    const canvas = document.getElementById(canvasId);
    if (!canvas || labels.length === 0) return null;

    const halfData = labels.map(l => counts[l] / 2);
    const leftData = halfData.map(v => -v);
    const rightData = halfData;
    const maxVal = Math.max(...labels.map(l => counts[l]));

    // Read theme colours once (each getThemeColor call forces a style recalc).
    const accent = getThemeColor('--accent', '#2563EB');
    const muted = getThemeColor('--muted', '#6B7280');
    const ink = getThemeColor('--ink', '#111317');
    const surface = getThemeColor('--surface', '#ffffff');

    const ctx = canvas.getContext('2d');
    // Dynamic height: ~30px per row + 120px for labels/title.
    canvas.parentElement.style.height = `${labels.length * 30 + 120}px`;

    const dataset = (data, side) => ({
        label: side,
        data,
        backgroundColor: accent,
        borderColor: accent,
        borderWidth: 0,
        borderRadius: side === 'left'
            ? { topLeft: 4, bottomLeft: 4 }
            : { topRight: 4, bottomRight: 4 },
        barPercentage: 0.96,
        categoryPercentage: 0.96,
        barThickness: 18,
        maxBarThickness: 18
    });

    return new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [dataset(leftData, 'left'), dataset(rightData, 'right')] },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    display: true,
                    min: -maxVal / 2 * 1.2,
                    max: maxVal / 2 * 1.2,
                    ticks: { display: false },
                    grid: {
                        drawOnChartArea: true,
                        color: (context) => context.tick.value === 0 ? muted : 'transparent',
                        lineWidth: (context) => context.tick.value === 0 ? 2 : 0,
                        drawTicks: false
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: muted,
                        font: { family: 'Lexend, sans-serif', size: 13, weight: '500' },
                        padding: 10
                    },
                    grid: { display: false }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => ` Vies: ${Math.abs(context.parsed.x) * 2}`
                    },
                    backgroundColor: ink,
                    bodyColor: surface,
                    titleColor: surface,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false
                },
                legend: { display: false }
            },
            layout: {
                padding: { left: 10, right: 30, top: 10, bottom: 35 }
            }
        }
    });
}

/**
 * Render the years frequency chart: count routes per year, ordered chronologically.
 */
function renderYearsChart(data) {
    if (yearsChart) {
        yearsChart.destroy();
        yearsChart = null;
    }
    if (data.length === 0) return;

    const counts = {};
    data.forEach(row => {
        const m = (row[6] || '').trim().match(/(19|20)\d{2}/);
        if (m) counts[m[0]] = (counts[m[0]] || 0) + 1;
    });
    const labels = Object.keys(counts).sort();

    yearsChart = buildDivergingBarChart('yearsChart', labels, counts);
}

/**
 * Clean and normalize a climbing grade for the grades chart.
 * Removes artificial climbing notations (A1, A2, Ae, etc.) and handles splits (6a/b -> 6a).
 */
function cleanGrade(rawGrau) {
    if (!rawGrau) return null;

    // Normalize and split by "/", " o ", or " "
    // We do NOT split by "+" because it's part of the grade (e.g., 6a+, V+)
    let g = rawGrau.toLowerCase().trim();
    let parts = g.split(/[\/ ]|(\s+o\s+)/).filter(p => p && p.trim() && p.trim() !== 'o').map(p => p.trim());

    for (let p of parts) {
        // Remove artificial notation from this part (e.g., A1, Ae)
        // Note: we remove 'a' only if it's followed by a digit and not part of a French grade
        let cleaned = p.replace(/ae/g, '').replace(/a\d+/g, '');

        if (!cleaned || cleaned === 'a') continue;

        // Check for French/Numbers (Ex: 4, 5, 5+, 6a, 6a+, 6b+)
        if (/^[1-9][abc]?\+?$/.test(cleaned)) {
            return cleaned.toUpperCase();
        }

        // Check for UIAA/Roman (Ex: IV, V, VI, V+, IV+)
        if (/^[ivx]+\+?$/.test(cleaned)) {
            return cleaned.toUpperCase();
        }
    }

    return null; // Not a standard free climbing grade
}

/**
 * Render the grades frequency chart: count routes per (cleaned) grade,
 * ordered by climbing difficulty.
 */
function renderChart(data) {
    if (zonesChart) {
        zonesChart.destroy();
        zonesChart = null;
    }
    if (data.length === 0) return;

    const counts = {};
    data.forEach(row => {
        const grau = cleanGrade((row[2] || '').trim());
        if (!grau) return; // Skip if it's not a free climbing grade (UIAA/French)
        counts[grau] = (counts[grau] || 0) + 1;
    });
    const labels = Object.keys(counts).sort((a, b) => gradeToSortValue(a) - gradeToSortValue(b));

    zonesChart = buildDivergingBarChart('zonesChart', labels, counts);
}

/**
 * Render the seasons frequency chart.
 */
function renderSeasonsChart(data) {
    if (seasonsChart) {
        seasonsChart.destroy();
        seasonsChart = null;
    }
    if (data.length === 0) return;

    // Seasons mapping: hivern (12,1,2), primavera (3-5), estiu (6-8), tardor (9-11).
    const counts = { hivern: 0, primavera: 0, estiu: 0, tardor: 0 };

    data.forEach(row => {
        const dateStr = (row[6] || '').trim();
        if (!dateStr || dateStr === '-') return;

        // Month is the 2nd field for both DD/MM/YYYY and YYYY-MM[-DD].
        const parts = dateStr.split(/[\/-]/);
        const month = parts.length >= 2 ? parseInt(parts[1], 10) : NaN;
        if (isNaN(month)) return;

        if (month === 12 || month === 1 || month === 2) counts.hivern++;
        else if (month >= 3 && month <= 5) counts.primavera++;
        else if (month >= 6 && month <= 8) counts.estiu++;
        else if (month >= 9 && month <= 11) counts.tardor++;
    });

    const labels = ['hivern', 'primavera', 'estiu', 'tardor'];
    seasonsChart = buildDivergingBarChart('seasonsChart', labels, counts);
}
function renderTable() {
    const tableBody = document.getElementById('vies-body');
    tableBody.innerHTML = '';

    const dataToRender = getFilteredData();
    renderStats(dataToRender);
    // The charts are costly to rebuild; only do it while the stats section is
    // actually visible. When it's collapsed, setupStatsToggle() renders them on open.
    const extra = document.getElementById('extra-stats-container');
    if (extra && !extra.classList.contains('hidden')) {
        renderYearsChart(dataToRender);
        renderChart(dataToRender);
        renderSeasonsChart(dataToRender);
    }
    updateMapMarkers(dataToRender);

    // Build all rows in a fragment and insert once (avoids per-row reflows).
    const fragment = document.createDocumentFragment();

    dataToRender.forEach(row => {
        if (row.length < 2) return;

        const tr = document.createElement('tr');
        let locationGroup = null;
        let detailsGroup = null;
        let footerGroup = null;

        // Read coordinates from CSV column 8
        const coordsRaw = (row[COORDS_COL] || '').trim();
        const mapUrl = buildMapUrl(coordsRaw);

        row.forEach((cell, index) => {
            if (index >= LABELS.length) return; // Skip extra columns like 'Ubicació'

            const td = document.createElement('td');
            td.setAttribute('data-label', LABELS[index]);

            if (index === 7 && cell && cell.startsWith('http')) {
                const a = document.createElement('a');
                a.href = cell;
                a.target = '_blank';
                a.textContent = 'Veure blog';
                td.appendChild(a);
            } else if (index === 3) {
                td.textContent = cell ? cell + ' m' : '-';
            } else if (index === 2) {
                const span = document.createElement('span');
                span.className = 'grade-pill';
                span.textContent = cell || '-';
                td.appendChild(span);
            } else {
                td.textContent = cell || '-';
            }

            if (index === 0) td.style.textAlign = 'center';

            // Group Agulla/Paret and Zona for Row 2 in mobile (Header in mobile)
            if (index === 4 || index === 5) {
                if (!locationGroup) {
                    locationGroup = document.createElement('div');
                    locationGroup.className = 'location-group';
                    tr.appendChild(locationGroup);
                }
                locationGroup.appendChild(td);

                // After inserting Zona (index 5), add the map icon cell into location-group
                if (index === 5) {
                    const mapTd = buildMapCell(mapUrl);
                    locationGroup.appendChild(mapTd);
                }
            }
            // Group Grau and Metres for details in mobile
            else if (index === 2 || index === 3) {
                if (!detailsGroup) {
                    detailsGroup = document.createElement('div');
                    detailsGroup.className = 'details-group';
                    tr.appendChild(detailsGroup);
                }
                detailsGroup.appendChild(td);
            }
            // Group Data and Enllaç for Footer in mobile
            else if (index === 6 || index === 7) {
                if (!footerGroup) {
                    footerGroup = document.createElement('div');
                    footerGroup.className = 'footer-group';
                    tr.appendChild(footerGroup);
                }
                footerGroup.appendChild(td);
            }
            else {
                tr.appendChild(td);
            }
        });

        // Trailing empty cell under the header's refresh column, so the row's
        // bottom border runs the full width (no gap on the right).
        const fillTd = document.createElement('td');
        fillTd.className = 'refresh-col';
        fillTd.setAttribute('aria-hidden', 'true');
        tr.appendChild(fillTd);

        fragment.appendChild(tr);
    });

    tableBody.appendChild(fragment);
}

/**
 * Given a raw coordinate string ("lat,lng", Google Maps URL, or empty),
 * returns a Google Maps URL or null.
 */
function buildMapUrl(coordsRaw) {
    if (!coordsRaw) return null;
    // Already a URL
    if (coordsRaw.startsWith('http')) return coordsRaw;
    // Decimal degrees: "41.5827,1.8342" or "41.5827, 1.8342"
    const match = coordsRaw.match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/);
    if (match) {
        return `https://www.google.com/maps?q=${match[1]},${match[2]}`;
    }
    return null;
}

/**
 * Initialize the Leaflet map.
 */
function initMap() {
    const mapDiv = document.getElementById('map');
    if (!mapDiv || map) return; // Don't re-initialize

    // Check if Leaflet is loaded (L is global)
    if (typeof L === 'undefined') {
        console.error('Leaflet library (L) is not loaded.');
        return;
    }

    // Base Layer 1: Standard OpenStreetMap (Clean and fast for low zoom)
    const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        minZoom: 0,
        maxZoom: 12,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    // Base Layer 2: OpenTopoMap (Topographic style for high zoom)
    const baseTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        minZoom: 13,
        maxZoom: 17,
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    });

    // We create the map with BOTH layers added - Leaflet will handle showing/hiding them based on zoom
    map = L.map('map', {
        center: [41.5912, 1.8375],
        zoom: 7,
        layers: [baseOSM, baseTopo],
        scrollWheelZoom: false // no zoom with the mouse wheel (use the +/- buttons)
    });

    // Keep the Leaflet credit but drop the default Ukrainian flag from the prefix.
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

    // Add Layer Control so the user can manually switch if they want
    const baseMaps = {
        "Mapa Estàndard (OSM)": baseOSM,
        "Mapa Topogràfic (OpenTopoMap)": baseTopo
    };

    L.control.layers(baseMaps, null, { collapsed: true, position: 'topright' }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);
}

/**
 * Update map markers based on the current filtered data.
 */
function updateMapMarkers(data) {
    if (!map || !markerLayer) return;

    markerLayer.clearLayers();
    const markers = [];

    data.forEach(row => {
        const coordsRaw = (row[COORDS_COL] || '').trim();
        if (!coordsRaw) return;

        // Try to parse lat,lng
        const match = coordsRaw.match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/);
        if (match) {
            const lat = parseFloat(match[1]);
            const lng = parseFloat(match[2]);
            const name = row[1] || 'Via sense nom';
            const grade = row[2] || '-';
            const paret = row[4] || '-';
            const zone = row[5] || '-';
            const dataObra = row[6] || '-';

            // Custom Neobrutalist Icon (Always Cyan as requested)
            const customIcon = L.divIcon({
                className: 'marker-neo',
                iconSize: [20, 20],
                iconAnchor: [10, 10],
                popupAnchor: [0, -10]
            });

            const marker = L.marker([lat, lng], { icon: customIcon })
                .bindPopup(`
                    <div class="neo-popup-content">
                        <strong class="popup-title">${name}</strong>
                        <div class="popup-details">
                            <div class="popup-row"><strong>Grau:</strong> <span class="grade-pill">${grade}</span></div>
                            <div class="popup-row"><strong>Lloc:</strong> ${paret}</div>
                            <div class="popup-zone">${zone}</div>
                            <div class="popup-footer">
                                <svg class="icon" aria-hidden="true"><use href="#i-calendar"></use></svg> ${dataObra}
                            </div>
                        </div>
                    </div>
                `, {
                    maxWidth: 250,
                    className: 'neo-popup'
                });

            // Handle active state on marker open/close
            marker.on('popupopen', () => {
                const el = marker.getElement();
                if (el) el.classList.add('marker-active');
            });
            marker.on('popupclose', () => {
                const el = marker.getElement();
                if (el) el.classList.remove('marker-active');
            });

            markerLayer.addLayer(marker);
            markers.push([lat, lng]);
        }
    });

    // Auto zoom/fit bounds ONLY if there is an active search filter
    // If not searching, we keep the default Catalonia view to avoid being pulled by outliers
    if (markers.length > 0 && searchQuery.trim() !== '') {
        const bounds = L.latLngBounds(markers);
        map.fitBounds(bounds, { padding: [40, 40] });
    } else if (searchQuery.trim() === '') {
        // Reset to default Catalonia view when search is cleared
        map.setView([41.7, 1.9], 7);
    }
}
function buildMapCell(mapUrl) {
    const td = document.createElement('td');
    td.setAttribute('data-label', 'Mapa');
    td.className = 'map-cell';
    if (mapUrl) {
        const a = document.createElement('a');
        a.href = mapUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = 'Veure ubicació al mapa';
        a.className = 'map-link';
        a.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-location-dot"></use></svg>';
        td.appendChild(a);
    }
    return td;
}

/**
 * Update the sort arrow indicators on the desktop table headers.
 */
function updateSortIndicators() {
    const headers = document.querySelectorAll('#vies-table thead th');
    headers.forEach((th) => {
        // Remove existing indicator
        const existingArrow = th.querySelector('.sort-arrow');
        if (existingArrow) existingArrow.remove();

        const col = th.dataset.col;
        if (col !== undefined && parseInt(col, 10) === currentSort.column) {
            const arrow = document.createElement('span');
            arrow.className = 'sort-arrow';
            arrow.textContent = currentSort.direction === 'asc' ? ' ▲' : ' ▼';
            th.appendChild(arrow);
        }
    });
}

/**
 * Set up click handlers on desktop table headers for sorting.
 */
function setupDesktopSortHandlers() {
    // Each sortable <th> declares the DATA column it maps to via data-col.
    // (The header has an extra, non-data column for the map/refresh icon, so
    // header position != data index — data-col keeps them aligned.)
    const headers = document.querySelectorAll('#vies-table thead th[data-col]');
    headers.forEach((th) => {
        const index = parseInt(th.dataset.col, 10);
        if (COLUMN_TYPES[index] === 'none') return;

        th.classList.add('sortable');
        // Keyboard accessibility: make the header focusable and activatable.
        th.setAttribute('tabindex', '0');
        th.setAttribute('role', 'button');
        th.addEventListener('click', () => {
            const newDirection = (currentSort.column === index && currentSort.direction === 'asc') ? 'desc' : 'asc';
            sortData(index, newDirection);
            // Sync mobile dropdown if a matching option exists
            syncMobileDropdown(index, newDirection);
        });
        th.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                th.click();
            }
        });
    });
}

/**
 * Set up the mobile sort dropdown handler.
 */
function setupMobileSortHandler() {
    const select = document.getElementById('mobile-sort');
    if (!select) return;

    select.addEventListener('change', () => {
        const [col, dir] = select.value.split('-');
        sortData(parseInt(col, 10), dir);
    });
}

/**
 * Sync the mobile dropdown to reflect the current sort state.
 */
function syncMobileDropdown(column, direction) {
    const select = document.getElementById('mobile-sort');
    if (!select) return;
    const value = `${column}-${direction}`;
    const option = select.querySelector(`option[value="${value}"]`);
    if (option) {
        select.value = value;
    }
}

/**
 * Set up the search input handler.
 */
function setupSearchHandler() {
    const input = document.getElementById('search-input');
    if (!input) return;

    let debounce;
    input.addEventListener('input', () => {
        searchQuery = input.value;
        clearTimeout(debounce);
        debounce = setTimeout(renderTable, 150);
    });
}

/**
 * Toggle search input visibility on mobile.
 */
function setupSearchToggle() {
    const toggleBtn = document.getElementById('search-toggle');
    const wrapper = document.getElementById('search-wrapper');
    const input = document.getElementById('search-input');

    if (!toggleBtn || !wrapper) return;

    toggleBtn.addEventListener('click', () => {
        const isActive = wrapper.classList.toggle('active');
        if (isActive) {
            input.focus();
        } else {
            // Clear search when closing? Optional. Let's just hide it.
        }
    });
}

/**
 * Get the vies CSV: local synced copy first (same-origin, fast, no CORS),
 * then the live Google Sheet (direct, then proxies) as a fallback.
 */
async function fetchViesCsv() {
    try {
        const res = await fetch(LOCAL_DATA_URL);
        if (res.ok) {
            const text = await res.text();
            if (text && text.trim()) return text;
        }
    } catch (e) { /* not present (e.g. local dev) — fall through to the live Sheet */ }
    return fetchWithFallback(SHEET_URL);
}

/** Read the cached CSV from sessionStorage if it's still within the TTL. */
function readCachedCsv() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { ts, csv } = JSON.parse(raw);
        if (typeof csv === 'string' && Date.now() - ts < DATA_TTL_MS) return csv;
    } catch (e) { /* storage unavailable / corrupt: ignore */ }
    return null;
}

/** Persist the CSV with a timestamp (best-effort; ignores private-mode/quota errors). */
function writeCachedCsv(csv) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), csv }));
    } catch (e) { /* ignore */ }
}

/**
 * Force a live reload from the Google Sheet, bypassing the local copy and the
 * session cache. Used by the discreet refresh button.
 */
async function forceRefresh() {
    const buttons = document.querySelectorAll('.js-refresh');
    const icons = document.querySelectorAll('.js-refresh .icon');
    buttons.forEach(b => b.disabled = true);
    icons.forEach(i => i.classList.add('spinning'));

    try {
        const csv = await fetchWithFallback(SHEET_URL); // skip local copy + cache
        const data = parseCSV(csv);
        data.shift(); // drop header row
        viesData = data;
        writeCachedCsv(csv); // keep the cache fresh too
        sortData(currentSort.column, currentSort.direction); // re-render, keep order
    } catch (err) {
        console.error('Manual refresh failed:', err);
        const errorElem = document.getElementById('error');
        if (errorElem) {
            errorElem.textContent = 'Live refresh from the Sheet failed. Please try again.';
            errorElem.style.display = 'block';
            setTimeout(() => { errorElem.style.display = 'none'; }, 4000);
        }
    } finally {
        icons.forEach(i => i.classList.remove('spinning'));
        buttons.forEach(b => b.disabled = false);
    }
}

/** Wire the discreet refresh button(s) to forceRefresh(). */
function setupRefresh() {
    document.querySelectorAll('.js-refresh').forEach(btn => {
        btn.addEventListener('click', forceRefresh);
    });
}

async function fetchAndRenderVies() {
    const loadingElem = document.getElementById('loading');
    const errorElem = document.getElementById('error');

    try {
        // Serve from the short-lived session cache when fresh; else fetch + store.
        let csvText = readCachedCsv();
        if (csvText === null) {
            csvText = await fetchViesCsv();
            writeCachedCsv(csvText);
        }
        const data = parseCSV(csvText);

        // Remove header row
        data.shift();

        // Store globally
        viesData = data;

        loadingElem.style.display = 'none';

        // Initialize and render
        sortData(0, 'desc'); // This will trigger renderTable -> updateMapMarkers

        // Set up interactions
        setupDesktopSortHandlers();
        setupMobileSortHandler();
        setupSearchHandler();
        setupSearchToggle();
        setupStatsToggle(); // Call the stats toggle setup
        updateSortIndicators();

    } catch (error) {
        console.error('Fetch error:', error);
        loadingElem.style.display = 'none';
        // Opening the file directly (file://) blocks all remote fetches in the browser,
        // so no data can ever load that way. Give a clear, actionable message.
        if (location.protocol === 'file:') {
            errorElem.innerHTML = 'Page loaded over the file:// protocol; the browser blocks '
                + 'cross-origin data requests in this context.<br>'
                + 'Serve the application over HTTP instead '
                + '(e.g. python -m http.server, then open http://localhost:8000) '
                + 'or deploy it to a web host.';
        } else {
            errorElem.innerHTML = 'Failed to fetch route data (direct request and CORS proxies '
                + 'both unavailable). Check network connectivity and the data '
                + 'source endpoint, then reload.';
        }
        errorElem.style.display = 'block';
    }
}

/**
 * Wire up the "més estadístiques" toggle: show/hide the charts section,
 * swap the chevron, and render the charts the first time they become visible.
 */
function setupStatsToggle() {
    const btn = document.getElementById('toggle-stats-btn');
    const container = document.getElementById('extra-stats-container');

    if (!btn || !container) return;

    btn.addEventListener('click', async () => {
        container.classList.toggle('hidden');
        btn.classList.toggle('active');

        // Update text
        if (container.classList.contains('hidden')) {
            btn.innerHTML = 'més estadístiques <svg class="icon" aria-hidden="true"><use href="#i-chevron-down"></use></svg>';
        } else {
            btn.innerHTML = 'menys estadístiques <svg class="icon" aria-hidden="true"><use href="#i-chevron-up"></use></svg>';
            // Lazy-load Chart.js the first time, then render the charts.
            try {
                await loadChartJs();
                refreshCharts();
            } catch (err) {
                console.error(err);
            }
        }
    });
}

/**
 * Robust CSV parser that handles quoted fields with commas.
 */
function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    const result = [];

    for (const line of lines) {
        if (!line.trim()) continue;

        const row = [];
        let currentField = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    currentField += '"';
                    i++; // Skip the next quote
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                row.push(currentField.trim());
                currentField = '';
            } else {
                currentField += char;
            }
        }
        row.push(currentField.trim());
        result.push(row);
    }
    return result;
}

/**
 * Re-render the three charts from the current filtered data and resize them.
 * Shared by the stats toggle and the theme switch (so colours follow the theme).
 */
function refreshCharts() {
    const data = getFilteredData();
    renderYearsChart(data);
    renderChart(data);
    renderSeasonsChart(data);
    if (yearsChart) yearsChart.resize();
    if (zonesChart) zonesChart.resize();
    if (seasonsChart) seasonsChart.resize();
}

/**
 * Apply a theme ('light' | 'dark') to the document and sync the toggle icon.
 */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const use = document.querySelector('#theme-toggle .icon use');
    if (use) {
        use.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
    }
}

/**
 * Wire up the theme toggle: restore the saved/system preference and handle clicks.
 */
function setupThemeToggle() {
    const stored = localStorage.getItem('theme');
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(stored || (mq && mq.matches ? 'dark' : 'light'));

    // If the user hasn't chosen explicitly, follow live OS theme changes.
    if (!stored && mq) {
        mq.addEventListener('change', (e) => {
            if (localStorage.getItem('theme')) return; // user chose meanwhile
            applyTheme(e.matches ? 'dark' : 'light');
            const extra = document.getElementById('extra-stats-container');
            if (extra && !extra.classList.contains('hidden')) refreshCharts();
        });
    }

    const btn = document.getElementById('theme-toggle');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem('theme', next);
        // If the charts are currently visible, re-render so they pick up the new theme colours.
        const extra = document.getElementById('extra-stats-container');
        if (extra && !extra.classList.contains('hidden')) {
            refreshCharts();
        }
    });
}

/**
 * Lazily load Leaflet and initialise the map the first time #map-container
 * scrolls near the viewport, then populate it with the current data.
 */
function setupLazyMap() {
    const target = document.getElementById('map-container');
    if (!target) return;

    const init = async () => {
        try {
            await loadLeaflet();
            initMap();
            updateMapMarkers(getFilteredData());
        } catch (err) {
            console.error(err);
        }
    };

    if (!('IntersectionObserver' in window)) {
        init(); // Fallback: just load it.
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting)) {
            observer.disconnect();
            init();
        }
    }, { rootMargin: '200px' });
    observer.observe(target);
}

// Start fetching when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setupThemeToggle(); // Apply theme before anything renders
    setupLazyMap();     // Map (Leaflet) loads when it scrolls into view
    setupRefresh();     // Discreet "refresh from Sheet" button

    // Discreet edit link: warn if the Sheet edit URL hasn't been configured yet.
    const editLink = document.getElementById('edit-sheet');
    if (editLink && editLink.getAttribute('href').includes('__SHEET_EDIT_URL__')) {
        editLink.addEventListener('click', (e) => {
            e.preventDefault();
            alert("Cal configurar l'URL d'edició del full a index.html (href de #edit-sheet).");
        });
    }

    fetchAndRenderVies();

    // Set dynamic year
    const yearElem = document.getElementById('current-year');
    if (yearElem) {
        yearElem.textContent = new Date().getFullYear();
    }
});
