const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR7K0lF7k4iZ1OSbuavBjG47LES1A-FpnnqUOlqzVfGlRTI-ZQrkR6C-3tFUyPAOg065EBgxFzotBKt/pub?output=csv';

// List of proxies to try in order
const PROXIES = [
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://api.allorigins.win/raw?url='
];

// Global state
let viesData = [];
let currentSort = { column: 0, direction: 'desc' }; // Default: Nº descending
let searchQuery = ''; // Current search filter

// Columns to search: Nom(1), Grau(2), Agulla/Paret(4), Zona(5)
const SEARCH_COLUMNS = [1, 2, 4, 5];

const LABELS = ['Nº', 'Nom', 'Grau', 'Metres', 'Agulla/Paret', 'Zona', 'Data', 'Enllaç'];

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

    // Match patterns like "6A+", "7B", "5+", "4", "IV+"
    const match = grade.match(/^(\d+)([A-C]?)(\+?)$/i);
    if (!match) return 0;

    const num = parseInt(match[1], 10) * 100;
    const letter = match[2] ? (match[2].toUpperCase().charCodeAt(0) - 64) * 10 : 0; // A=10, B=20, C=30
    const plus = match[3] ? 5 : 0;

    return num + letter + plus;
}

/**
 * Parse a date string (DD/MM/YYYY) into a sortable timestamp.
 */
function dateToSortValue(dateStr) {
    if (!dateStr || dateStr === '-') return 0;
    const parts = dateStr.trim().split('/');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
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
 * Render the table body from the filtered + sorted data.
 */
function renderTable() {
    const tableBody = document.getElementById('vies-body');
    tableBody.innerHTML = '';

    const dataToRender = getFilteredData();

    dataToRender.forEach(row => {
        if (row.length < 2) return;

        const tr = document.createElement('tr');
        let locationGroup = null;
        let footerGroup = null;

        row.forEach((cell, index) => {
            const td = document.createElement('td');
            td.setAttribute('data-label', LABELS[index]);

            if (index === 7 && cell && cell.startsWith('http')) {
                const a = document.createElement('a');
                a.href = cell;
                a.target = '_blank';
                a.textContent = 'Veure blog';
                td.appendChild(a);
            } else {
                td.textContent = cell || '-';
            }

            if (index === 0) td.style.textAlign = 'center';

            // Group Agulla/Paret and Zona for Row 2 in mobile
            if (index === 4 || index === 5) {
                if (!locationGroup) {
                    locationGroup = document.createElement('div');
                    locationGroup.className = 'location-group';
                    tr.appendChild(locationGroup);
                }
                locationGroup.appendChild(td);
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

        // Store globally and sort by default (Nº descending)
        viesData = data;

        loadingElem.style.display = 'none';

        // Initial sort and render
        sortData(0, 'desc');

        // Set up interactions
        setupDesktopSortHandlers();
        setupMobileSortHandler();
        setupSearchHandler();
        setupSearchToggle();
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
    fetchAndRenderVies();

    // Set dynamic year
    const yearElem = document.getElementById('current-year');
    if (yearElem) {
        yearElem.textContent = new Date().getFullYear();
    }
});
