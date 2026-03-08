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



async function fetchWithFallback(url) {
    const cacheBuster = `&t=${Date.now()}`;
    const urlWithCacheBuster = url + cacheBuster;

    for (const proxy of PROXIES) {
        try {
            console.log(`Trying proxy: ${proxy}`);
            const response = await fetch(`${proxy}${encodeURIComponent(urlWithCacheBuster)}`, { cache: "no-store" });
            if (response.ok) return await response.text();
        } catch (err) {
            console.warn(`Proxy ${proxy} failed, trying next...`);
        }
    }
    throw new Error('All proxies failed');
}

/**
 * Parse a climbing grade string into a sortable numeric value.
 * Handles formats like: 4, 5+, 6a, 6a+, 6b, 7c+, 8a, etc.
 */
function gradeToSortValue(grade) {
    if (!grade || grade === '-') return -1;
    grade = grade.trim().toUpperCase();

    // Handle common Roman numerals for lower grades
    if (grade.startsWith('IV')) return 400 + (grade.includes('+') ? 50 : 0);
    if (grade.startsWith('V')) {
        // Distinguish between V (Roman) and 5? In climbing usually V = 5.
        // But the case 'V' vs 'V+'
        return 500 + (grade.includes('+') ? 50 : 0);
    }
    if (grade.startsWith('III')) return 300 + (grade.includes('+') ? 50 : 0);
    if (grade.startsWith('II')) return 200 + (grade.includes('+') ? 50 : 0);
    if (grade.startsWith('I')) return 100 + (grade.includes('+') ? 50 : 0);

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
                cmp = valA.localeCompare(valB, 'ca', { sensitivity: 'base' });
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
 * Render the years frequency chart using Chart.js.
 * Displays a symmetrical centered bar chart per year.
 */
function renderYearsChart(data) {
    const canvas = document.getElementById('yearsChart');
    if (!canvas) return;

    if (yearsChart) {
        yearsChart.destroy();
    }

    if (data.length === 0) return;

    // Process data by year
    const yearsData = {};
    data.forEach(row => {
        const dateStr = (row[6] || '').trim();
        if (!dateStr) return;
        const match = dateStr.match(/(19|20)\d{2}/);
        if (match) {
            const year = match[0];
            yearsData[year] = (yearsData[year] || 0) + 1;
        }
    });

    // Sort years chronologically
    const sortedLabels = Object.keys(yearsData).sort();

    const labels = sortedLabels;
    const halfData = sortedLabels.map(y => yearsData[y] / 2);
    const leftData = halfData.map(v => -v);
    const rightData = halfData;

    const ctx = canvas.getContext('2d');

    // Dynamic height calculation: ~30px per row + 120px for labels/title
    const chartHeight = (labels.length * 30) + 120;
    canvas.parentElement.style.height = `${chartHeight}px`;

    yearsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Esquerra',
                    data: leftData,
                    backgroundColor: '#3a8fb7',
                    borderColor: '#3a8fb7',
                    borderWidth: 0,
                    borderRadius: { topLeft: 4, bottomLeft: 4 },
                    barPercentage: 0.96,
                    categoryPercentage: 0.96,
                    barThickness: 18,
                    maxBarThickness: 18
                },
                {
                    label: 'Dreta',
                    data: rightData,
                    backgroundColor: '#3a8fb7',
                    borderColor: '#3a8fb7',
                    borderWidth: 0,
                    borderRadius: { topRight: 4, bottomRight: 4 },
                    barPercentage: 0.96,
                    categoryPercentage: 0.96,
                    barThickness: 18,
                    maxBarThickness: 18
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    display: true,
                    min: -Math.max(...Object.values(yearsData)) / 2 * 1.2,
                    max: Math.max(...Object.values(yearsData)) / 2 * 1.2,
                    ticks: { display: false },
                    grid: {
                        drawOnChartArea: true,
                        color: (context) => context.tick.value === 0 ? '#cbd5e1' : 'transparent',
                        lineWidth: (context) => context.tick.value === 0 ? 2 : 0,
                        drawTicks: false
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: '#475569',
                        font: { family: 'Outfit, sans-serif', size: 13, weight: '500' },
                        padding: 10
                    },
                    grid: { display: false }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const val = Math.abs(context.parsed.x) * 2;
                            return ` Vies: ${val}`;
                        }
                    },
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
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
 * Render the zones frequency chart using Chart.js.
 * Displays a diverging stacked bar chart: Easy (negative) vs Hard (positive).
 */
/**
 * Helper to clean and normalize climbing grades for the chart.
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

function renderChart(data) {
    const canvas = document.getElementById('zonesChart');
    if (!canvas) return;

    if (zonesChart) {
        zonesChart.destroy();
    }

    if (data.length === 0) return;

    // Process data by grade
    const gradesData = {};
    data.forEach(row => {
        const rawGrau = (row[2] || '').trim();
        if (!rawGrau || rawGrau === '-') return;

        const grau = cleanGrade(rawGrau);
        if (!grau) return; // Skip if it's not a free climbing grade (UIAA/French)

        if (!gradesData[grau]) {
            gradesData[grau] = 0;
        }
        gradesData[grau]++;
    });

    // Sort grades logically using the existing global gradeToSortValue helper
    const sortedLabels = Object.keys(gradesData)
        .sort((a, b) => gradeToSortValue(a) - gradeToSortValue(b));

    const labels = sortedLabels;
    // Symmetrical centering: half left, half right
    const halfData = sortedLabels.map(g => gradesData[g] / 2);
    const leftData = halfData.map(v => -v);
    const rightData = halfData;

    const ctx = canvas.getContext('2d');

    // Dynamic height calculation: ~30px per row + 120px for labels/title
    const chartHeight = (labels.length * 30) + 120;
    canvas.parentElement.style.height = `${chartHeight}px`;

    zonesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Esquerra',
                    data: leftData,
                    backgroundColor: '#3a8fb7', // Solid blog blue
                    borderColor: '#3a8fb7',
                    borderWidth: 0,
                    borderRadius: { topLeft: 4, bottomLeft: 4 },
                    barPercentage: 0.96,
                    categoryPercentage: 0.96,
                    barThickness: 18,
                    maxBarThickness: 18
                },
                {
                    label: 'Dreta',
                    data: rightData,
                    backgroundColor: '#3a8fb7', // Solid blog blue
                    borderColor: '#3a8fb7',
                    borderWidth: 0,
                    borderRadius: { topRight: 4, bottomRight: 4 },
                    barPercentage: 0.96,
                    categoryPercentage: 0.96,
                    barThickness: 18,
                    maxBarThickness: 18
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    display: true,
                    min: -Math.max(...Object.values(gradesData)) / 2 * 1.2,
                    max: Math.max(...Object.values(gradesData)) / 2 * 1.2,
                    ticks: { display: false },
                    grid: {
                        drawOnChartArea: true,
                        color: (context) => context.tick.value === 0 ? '#cbd5e1' : 'transparent',
                        lineWidth: (context) => context.tick.value === 0 ? 2 : 0,
                        drawTicks: false
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: '#475569',
                        font: { family: 'Outfit, sans-serif', size: 13, weight: '500' },
                        padding: 10
                    },
                    grid: { display: false }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const val = Math.abs(context.parsed.x) * 2;
                            return ` Vies: ${val}`;
                        }
                    },
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
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
 * Render the seasons frequency chart.
 */
function renderSeasonsChart(data) {
    const canvas = document.getElementById('seasonsChart');
    if (!canvas) return;

    if (seasonsChart) {
        seasonsChart.destroy();
    }

    if (data.length === 0) return;

    // Seasons mapping: Hivern (12, 1, 2), Primavera (3, 4, 5), Estiu (6, 7, 8), Tardor (9, 10, 11)
    const seasonCounts = {
        'hivern': 0,
        'primavera': 0,
        'estiu': 0,
        'tardor': 0
    };

    data.forEach(row => {
        const dateStr = (row[6] || '').trim();
        if (!dateStr || dateStr === '-') return;

        let month = -1;
        if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length >= 2) month = parseInt(parts[1]);
        } else if (dateStr.includes('-')) {
            const parts = dateStr.split('-');
            if (parts.length >= 2) {
                // If it starts with 4 digits, it's YYYY-MM...
                if (parts[0].length === 4) month = parseInt(parts[1]);
                else month = parseInt(parts[1]); // Assuming DD-MM-YYYY
            }
        }

        if (month !== -1 && !isNaN(month)) {
            if (month === 12 || month === 1 || month === 2) seasonCounts['hivern']++;
            else if (month >= 3 && month <= 5) seasonCounts['primavera']++;
            else if (month >= 6 && month <= 8) seasonCounts['estiu']++;
            else if (month >= 9 && month <= 11) seasonCounts['tardor']++;
        }
    });

    const labels = ["hivern", "primavera", "estiu", "tardor"];
    const halfData = labels.map(s => seasonCounts[s] / 2);
    const leftData = halfData.map(v => -v);
    const rightData = halfData;

    const ctx = canvas.getContext('2d');
    const chartHeight = (labels.length * 30) + 120;
    canvas.parentElement.style.height = `${chartHeight}px`;

    seasonsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Esquerra',
                    data: leftData,
                    backgroundColor: '#3a8fb7',
                    borderColor: '#3a8fb7',
                    borderWidth: 0,
                    borderRadius: { topLeft: 4, bottomLeft: 4 },
                    barPercentage: 0.96,
                    categoryPercentage: 0.96,
                    barThickness: 18,
                    maxBarThickness: 18
                },
                {
                    label: 'Dreta',
                    data: rightData,
                    backgroundColor: '#3a8fb7',
                    borderColor: '#3a8fb7',
                    borderWidth: 0,
                    borderRadius: { topRight: 4, bottomRight: 4 },
                    barPercentage: 0.96,
                    categoryPercentage: 0.96,
                    barThickness: 18,
                    maxBarThickness: 18
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    display: true,
                    min: -Math.max(...Object.values(seasonCounts)) / 2 * 1.2,
                    max: Math.max(...Object.values(seasonCounts)) / 2 * 1.2,
                    ticks: { display: false },
                    grid: {
                        drawOnChartArea: true,
                        color: (context) => context.tick.value === 0 ? '#cbd5e1' : 'transparent',
                        lineWidth: (context) => context.tick.value === 0 ? 2 : 0,
                        drawTicks: false
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: '#475569',
                        font: { family: 'Outfit, sans-serif', size: 13, weight: '500' },
                        padding: 10
                    },
                    grid: { display: false }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const val = Math.abs(context.parsed.x) * 2;
                            return ` Vies: ${val}`;
                        }
                    },
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
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
function renderTable() {
    const tableBody = document.getElementById('vies-body');
    tableBody.innerHTML = '';

    const dataToRender = getFilteredData();
    renderStats(dataToRender);
    renderYearsChart(dataToRender);
    renderChart(dataToRender);
    renderSeasonsChart(dataToRender);
    updateMapMarkers(dataToRender);

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

        tableBody.appendChild(tr);
    });
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

    // Fix for Leaflet default marker icons not showing when using CDN
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

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
        layers: [baseOSM, baseTopo]
    });

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

            const marker = L.marker([lat, lng])
                .bindPopup(`
                    <div style="font-family: 'Outfit', sans-serif; min-width: 180px; padding: 2px;">
                        <strong style="color: var(--link-color); display: block; margin-bottom: 6px; font-size: 1.05rem; line-height: 1.2;">${name}</strong>
                        <div style="font-size: 0.9rem; color: #334155; line-height: 1.5;">
                            <div style="margin-bottom: 2px;"><strong>Grau:</strong> <span class="grade-pill" style="display: inline-block; padding: 2px 8px; font-size: 0.75rem; vertical-align: middle;">${grade}</span></div>
                            <div style="margin-bottom: 4px;"><strong>Lloc:</strong> ${paret}<br><span style="color: #64748b; font-size: 0.85rem;">${zone}</span></div>
                            <div style="margin-top: 8px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 0.8rem; color: #64748b; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-regular fa-calendar" style="font-size: 0.7rem;"></i> ${dataObra}
                            </div>
                        </div>
                    </div>
                `, {
                    maxWidth: 250
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
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-location-dot';
        a.appendChild(icon);
        td.appendChild(a);
    }
    return td;
}

/**
 * Update the sort arrow indicators on the desktop table headers.
 */
function updateSortIndicators() {
    const headers = document.querySelectorAll('#vies-table thead th');
    headers.forEach((th, index) => {
        // Remove existing indicator
        const existingArrow = th.querySelector('.sort-arrow');
        if (existingArrow) existingArrow.remove();

        if (index === currentSort.column && COLUMN_TYPES[index] !== 'none') {
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
    const headers = document.querySelectorAll('#vies-table thead th');
    headers.forEach((th, index) => {
        if (COLUMN_TYPES[index] === 'none') return;

        th.classList.add('sortable');
        th.addEventListener('click', () => {
            const newDirection = (currentSort.column === index && currentSort.direction === 'asc') ? 'desc' : 'asc';
            sortData(index, newDirection);
            // Sync mobile dropdown if a matching option exists
            syncMobileDropdown(index, newDirection);
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

    input.addEventListener('input', () => {
        searchQuery = input.value;
        renderTable();
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

async function fetchAndRenderVies() {
    const loadingElem = document.getElementById('loading');
    const errorElem = document.getElementById('error');

    try {
        const csvText = await fetchWithFallback(SHEET_URL);
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
        errorElem.style.display = 'block';
    }
}

/**
 * Robust CSV parser that handles quoted fields with commas.
 */
function setupStatsToggle() {
    const btn = document.getElementById('toggle-stats-btn');
    const container = document.getElementById('extra-stats-container');

    if (!btn || !container) return;

    btn.addEventListener('click', () => {
        container.classList.toggle('hidden');
        btn.classList.toggle('active');

        // Update text
        if (container.classList.contains('hidden')) {
            btn.innerHTML = 'més estadístiques <i class="fa-solid fa-chevron-down"></i>';
        } else {
            btn.innerHTML = 'menys estadístiques <i class="fa-solid fa-chevron-up"></i>';
            // Force charts to render if they were hidden when called
            renderYearsChart(getFilteredData());
            renderChart(getFilteredData());
            renderSeasonsChart(getFilteredData()); // Call the new seasons chart
            if (yearsChart) yearsChart.resize();
            if (zonesChart) zonesChart.resize();
            if (seasonsChart) seasonsChart.resize();
        }
    });
}

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

// Start fetching when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initMap(); // Init map immediately
    fetchAndRenderVies();

    // Set dynamic year
    const yearElem = document.getElementById('current-year');
    if (yearElem) {
        yearElem.textContent = new Date().getFullYear();
    }
});
