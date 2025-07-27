/* global Chart */
let derivWs;
let tickHistory = [];
let currentSymbol = 'R_100'; // Default symbol
let tickCount = 1000; // Default tick count
let decimalPlaces = 3;

let digitChart, evenOddChart, riseFallChart;

// Tick log for robust synchronization and analysis
let tickLog = [];

// Utility: Log a tick (history or live)
function logTick(epoch, quote, source) {
    tickLog.push({
        time: epoch,
        quote: quote,
        source: source,
        localTime: Date.now(),
    });
}

// Utility: Download tick log as CSV
function downloadTickLog() {
    if (tickLog.length === 0) return;
    const header = 'epoch,quote,source,localTime\n';
    const rows = tickLog.map(t => `${t.time},${t.quote},${t.source},${t.localTime}`);
    const csv = header + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tick_log.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Data Synchronization & Integrity ---
// Detect missing epochs in tickHistory
function detectGaps() {
    if (tickHistory.length < 2) return [];
    let gaps = [];
    for (let i = 1; i < tickHistory.length; i++) {
        let expected = tickHistory[i - 1].time + 1;
        if (tickHistory[i].time !== expected) {
            gaps.push({ from: tickHistory[i - 1].time, to: tickHistory[i].time });
        }
    }
    return gaps;
}

// Fetch missing ticks from Deriv REST API and fill gaps
async function backfillGaps() {
    const gaps = detectGaps();
    let error = null;
    for (const gap of gaps) {
        const url = `https://api.deriv.com/api/ticks_history/${currentSymbol}?end=${gap.to}&start=${gap.from + 1}&style=ticks&count=${gap.to - gap.from - 1}`;
        try {
            const resp = await fetch(url);
            const json = await resp.json();
            if (json.history && Array.isArray(json.history.times)) {
                for (let i = 0; i < json.history.times.length; i++) {
                    tickHistory.push({ time: json.history.times[i], quote: parseFloat(json.history.prices[i]) });
                }
                tickHistory.sort((a, b) => a.time - b.time);
            }
        } catch (e) {
            error = e;
            console.warn('Backfill error:', e);
        }
    }
    updateUI();
    updateSyncStatus('backfill', error);
}

// Compare WebSocket tickHistory with REST API
async function compareWithRestApi() {
    const count = Math.min(100, tickHistory.length);
    const url = `https://api.deriv.com/api/ticks_history/${currentSymbol}?end=latest&count=${count}&style=ticks`;
    let restTicks = [];
    let error = null;
    try {
        const resp = await fetch(url);
        const json = await resp.json();
        if (json.history && Array.isArray(json.history.times)) {
            restTicks = json.history.times.map((t, i) => ({ time: t, quote: parseFloat(json.history.prices[i]) }));
        }
    } catch (e) {
        error = e;
        console.warn('REST API fetch error:', e);
    }
    let diffs = [];
    for (let i = 0; i < count; i++) {
        const wsTick = tickHistory[tickHistory.length - count + i];
        const restTick = restTicks[i];
        if (!wsTick || !restTick) continue;
        if (wsTick.time !== restTick.time || Math.abs(wsTick.quote - restTick.quote) > 1e-8) {
            diffs.push({ ws: wsTick, rest: restTick });
        }
    }
    showDiffResults(diffs);
    updateSyncStatus('compare', error, diffs.length);
}

// Automated periodic checks
let syncCheckIntervalMs = 2 * 60 * 1000; // 2 minutes
let syncCheckTimer = null;
function updateSyncStatus(type, error, diffCount) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    let msg = '';
    if (type === 'backfill') {
        msg = error
            ? `Last gap backfill: <span style="color:red">Error</span>`
            : `Last gap backfill: <span style="color:green">OK</span>`;
    } else if (type === 'compare') {
        if (error) msg = `Last REST compare: <span style="color:red">Error</span>`;
        else if (diffCount) msg = `Last REST compare: <span style="color:orange">${diffCount} mismatches</span>`;
        else msg = `Last REST compare: <span style="color:green">No mismatches</span>`;
    }
    el.innerHTML = msg + ` <span style="color:#888;font-size:0.9em">(${new Date().toLocaleTimeString()})</span>`;
}

function startSyncAutomation() {
    if (syncCheckTimer) clearInterval(syncCheckTimer);
    syncCheckTimer = setInterval(async () => {
        await backfillGaps();
        await compareWithRestApi();
    }, syncCheckIntervalMs);
}

document.addEventListener('DOMContentLoaded', function () {
    // ...existing code...
    // Start automated sync checks
    startSyncAutomation();
});

// Show visual diff results in UI
function showDiffResults(diffs) {
    const diffEl = document.getElementById('diff-results');
    if (!diffEl) return;
    if (!diffs.length) {
        diffEl.innerHTML = '<div style="color:green">No mismatches found!</div>';
        return;
    }
    let html = `<table style="width:100%;font-size:0.95em"><tr><th>Index</th><th>WS Time</th><th>WS Price</th><th>REST Time</th><th>REST Price</th></tr>`;
    diffs.forEach((d, i) => {
        html += `<tr style="background:${d.ws.time !== d.rest.time ? '#ffe0e0' : '#fffbe0'}"><td>${i + 1}</td><td>${d.ws.time}</td><td>${d.ws.quote}</td><td>${d.rest.time}</td><td>${d.rest.quote}</td></tr>`;
    });
    html += '</table>';
    diffEl.innerHTML = html;
}

// --- Periodic and manual resync logic ---
let resyncIntervalMs = 5 * 60 * 1000; // 5 minutes
let resyncTimer = null;
let lastResyncTime = null;

function resyncTicks() {
    tickHistory = [];
    startWebSocket();
    lastResyncTime = Date.now();
    updateResyncStatus();
}

function updateResyncStatus() {
    const statusEl = document.getElementById('resync-status');
    if (statusEl) {
        if (lastResyncTime) {
            const d = new Date(lastResyncTime);
            statusEl.textContent = `Last resync: ${d.toLocaleTimeString()}`;
        } else {
            statusEl.textContent = 'No resync yet';
        }
    }
}

function startPeriodicResync() {
    if (resyncTimer) clearInterval(resyncTimer);
    resyncTimer = setInterval(resyncTicks, resyncIntervalMs);
}

document.addEventListener('DOMContentLoaded', function () {
    const resyncBtn = document.getElementById('resync-ticks-btn');
    if (resyncBtn) {
        resyncBtn.addEventListener('click', resyncTicks);
    }
    const downloadBtn = document.getElementById('download-tick-log-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadTickLog);
    }
    // Add a status indicator for resync
    updateResyncStatus();
    // Start periodic resync
    startPeriodicResync();
});

// Function to start WebSocket
function startWebSocket() {
    if (derivWs) {
        derivWs.close();
    }

    derivWs = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=82255');

    derivWs.onopen = function () {
        requestTickHistory();
    };

    derivWs.onmessage = function (event) {
        const data = JSON.parse(event.data);

        if (data.history) {
            tickHistory = data.history.prices.map((price, index) => {
                const epoch = data.history.times[index];
                const quote = parseFloat(price);
                logTick(epoch, quote, 'history');
                return { time: epoch, quote: quote };
            });
            detectDecimalPlaces();
            updateUI();
        } else if (data.tick) {
            let tickQuote = parseFloat(data.tick.quote);
            tickHistory.push({ time: data.tick.epoch, quote: tickQuote });
            logTick(data.tick.epoch, tickQuote, 'live');
            if (tickHistory.length > tickCount) tickHistory.shift();
            updateUI();
        }
    };
}

// Function to request tick history
function requestTickHistory() {
    const request = {
        ticks_history: currentSymbol,
        count: tickCount,
        end: 'latest',
        style: 'ticks',
        subscribe: 1,
    };
    derivWs.send(JSON.stringify(request));
}

// Function to update symbol
function updateSymbol(newSymbol) {
    currentSymbol = newSymbol;
    tickHistory = [];
    startWebSocket();
}

// Function to update tick count
function updateTickCount(newTickCount) {
    tickCount = newTickCount;
    tickHistory = [];
    startWebSocket();
}

// Add event listeners for symbol and tick count inputs
document.getElementById('symbol-select').addEventListener('change', function (event) {
    updateSymbol(event.target.value);
});

document.getElementById('tick-count-input').addEventListener('change', function (event) {
    const newTickCount = parseInt(event.target.value, 10);
    if (newTickCount > 0) {
        updateTickCount(newTickCount);
    } else {
        console.warn('⚠️ Tick count must be greater than 0.');
    }
});

// Function to detect the number of decimal places dynamically
function detectDecimalPlaces() {
    if (tickHistory.length === 0) return;

    let decimalCounts = tickHistory.map(tick => {
        let decimalPart = tick.quote.toString().split('.')[1] || '';
        return decimalPart.length;
    });

    decimalPlaces = Math.max(...decimalCounts, 2);
}

// Function to extract the last digit
function getLastDigit(price) {
    let priceStr = price.toString();
    let priceParts = priceStr.split('.');
    let decimals = priceParts[1] || '';

    while (decimals.length < decimalPlaces) {
        decimals += '0';
    }

    return Number(decimals.slice(-1));
}

// Function to update the UI
function updateUI() {
    const currentPriceElement = document.getElementById('current-price');
    if (tickHistory.length > 0) {
        const currentPrice = tickHistory[tickHistory.length - 1].quote.toFixed(decimalPlaces);
        currentPriceElement.textContent = `${currentPrice}`;
    } else {
        currentPriceElement.textContent = 'N/A';
    }
    updateDigitDisplay();
    updateCharts();
    updateLast50OE();
}

// Function to update the digit display
function updateDigitDisplay() {
    const digitCounts = new Array(10).fill(0);
    tickHistory.forEach(tick => {
        const lastDigit = getLastDigit(tick.quote);
        digitCounts[lastDigit]++;
    });

    const digitPercentages = digitCounts.map(count => (count / tickHistory.length) * 100);
    const maxPercentage = Math.max(...digitPercentages);
    const minPercentage = Math.min(...digitPercentages);

    const currentDigit = tickHistory.length > 0 ? getLastDigit(tickHistory[tickHistory.length - 1].quote) : null;

    const digitDisplayContainer = document.getElementById('digit-display-container');
    digitDisplayContainer.innerHTML = ''; // Clear existing content

    digitPercentages.forEach((percentage, digit) => {
        const digitContainer = document.createElement('div');
        digitContainer.classList.add('digit-container');

        // Add the yellow arrow and apply the current class for the current digit
        if (digit === currentDigit) {
            digitContainer.classList.add('current');
            const arrow = document.createElement('div');
            arrow.classList.add('arrow');
            digitContainer.appendChild(arrow);
        }

        const digitBox = document.createElement('div');
        digitBox.classList.add('digit-box');

        // Apply the highest and lowest styles to only one digit each, and add colored ring
        if (percentage === maxPercentage && digitPercentages.indexOf(maxPercentage) === digit) {
            digitBox.classList.add('highest');
            digitBox.style.boxShadow = '0 0 0 3px limegreen';
        } else if (percentage === minPercentage && digitPercentages.indexOf(minPercentage) === digit) {
            digitBox.classList.add('lowest');
            digitBox.style.boxShadow = '0 0 0 3px red';
        }

        digitBox.textContent = digit;

        const percentageText = document.createElement('div');
        percentageText.classList.add('digit-percentage');
        // Show digit percentage with 1 decimal digit only
        percentageText.textContent = `${percentage.toFixed(1)}`;

        digitContainer.appendChild(digitBox);
        digitContainer.appendChild(percentageText);
        digitDisplayContainer.appendChild(digitContainer);
    });
}

// Function to initialize charts
function initializeCharts() {
    const ctxDigit = document.getElementById('digit-chart').getContext('2d');
    digitChart = new Chart(ctxDigit, {
        type: 'bar',
        data: {
            labels: Array.from({ length: 10 }, (_, i) => i.toString()),
            datasets: [
                {
                    label: 'Digit Distribution (%)',
                    data: Array(10).fill(0),
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: Array(10).fill('rgba(54, 162, 235, 1)'),
                    borderWidth: 2,
                    borderRadius: 10,
                    barPercentage: 0.8, // Bars span full width
                    categoryPercentage: 0.8, // No spacing between bars
                },
            ],
        },
        options: {
            indexAxis: 'x', // Vertical bars
            plugins: {
                legend: { display: false }, // Hide legend
                tooltip: { enabled: true }, // Enable tooltips
            },
            scales: {
                x: { display: true }, // Show x-axis
                y: { display: true }, // Show y-axis
            },
        },
    });

    const ctxEvenOdd = document.getElementById('even-odd-chart').getContext('2d');
    evenOddChart = new Chart(ctxEvenOdd, {
        type: 'bar',
        data: {
            labels: ['Even', 'Odd'],
            datasets: [
                {
                    label: 'Even/Odd Distribution',
                    data: [0, 0],
                    backgroundColor: ['#8BEDA6', '#FF7F7F'],
                    borderColor: ['#8BEDA6', '#FF7F7F'],
                    borderWidth: 1,
                    barPercentage: 0.9, // Bars span full width
                    categoryPercentage: 0.9, // No spacing between bars
                },
            ],
        },
        options: {
            indexAxis: 'y', // Horizontal bars
            plugins: {
                legend: { display: false }, // Hide legend
                tooltip: { enabled: true }, // Enable tooltips
            },
            scales: {
                x: { display: false }, // Hide x-axis
                y: { display: false }, // Hide y-axis
            },
        },
    });

    const ctxRiseFall = document.getElementById('rise-fall-chart').getContext('2d');
    riseFallChart = new Chart(ctxRiseFall, {
        type: 'bar',
        data: {
            labels: ['Rise', 'Fall'],
            datasets: [
                {
                    label: 'Rise/Fall Distribution',
                    data: [0, 0],
                    backgroundColor: ['#8BEDA6', '#FF7F7F'],
                    borderColor: ['#8BEDA6', '#FF7F7F'],
                    borderWidth: 1,
                    barPercentage: 0.9, // Bars span full width
                    categoryPercentage: 0.9, // No spacing between bars
                },
            ],
        },
        options: {
            indexAxis: 'y', // Horizontal bars
            plugins: {
                legend: { display: false }, // Hide legend
                tooltip: { enabled: true }, // Enable tooltips
            },
            scales: {
                x: { display: false }, // Hide x-axis
                y: { display: false }, // Hide y-axis
            },
        },
    });
}

// Function to update charts
function updateCharts() {
    const digitCounts = new Array(10).fill(0);
    tickHistory.forEach(tick => {
        const lastDigit = getLastDigit(tick.quote);
        digitCounts[lastDigit]++;
    });
    const digitPercentages = digitCounts.map(count => (count / tickHistory.length) * 100);

    // Find indices for max and min percentages
    const maxPercentageValue = Math.max(...digitPercentages);
    const minPercentageValue = Math.min(...digitPercentages);
    const maxIndex = digitPercentages.indexOf(maxPercentageValue);
    const minIndex = digitPercentages.indexOf(minPercentageValue);

    // Set border colors: green for max, red for min, default for others
    const borderColors = digitPercentages.map((_, idx) => {
        if (idx === maxIndex) return 'limegreen';
        if (idx === minIndex) return 'red';
        return 'rgba(54, 162, 235, 1)';
    });

    digitChart.data.datasets[0].data = digitPercentages;
    digitChart.data.datasets[0].borderColor = borderColors;
    digitChart.update();

    // Display highest and lowest percentages
    const maxPercentage = maxPercentageValue.toFixed(decimalPlaces);
    const minPercentage = minPercentageValue.toFixed(decimalPlaces);
    document.getElementById('digit-percentage').textContent = `Highest: ${maxPercentage}%, Lowest: ${minPercentage}%`;

    // Update even/odd chart
    const evenCount = digitCounts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    const oddCount = digitCounts.filter((_, i) => i % 2 !== 0).reduce((a, b) => a + b, 0);
    const evenPercentage = ((evenCount / tickHistory.length) * 100).toFixed(decimalPlaces);
    const oddPercentage = ((oddCount / tickHistory.length) * 100).toFixed(decimalPlaces);

    evenOddChart.data.datasets[0].data = [evenPercentage, oddPercentage];
    evenOddChart.update();

    // Display even and odd percentages
    document.getElementById('even-odd-percentage').textContent = `Even: ${evenPercentage}%, Odd: ${oddPercentage}%`;

    // Update rise/fall chart
    let riseCount = 0,
        fallCount = 0;
    for (let i = 1; i < tickHistory.length; i++) {
        if (tickHistory[i].quote > tickHistory[i - 1].quote) riseCount++;
        else if (tickHistory[i].quote < tickHistory[i - 1].quote) fallCount++;
    }
    const risePercentage = ((riseCount / (tickHistory.length - 1)) * 100).toFixed(decimalPlaces);
    const fallPercentage = ((fallCount / (tickHistory.length - 1)) * 100).toFixed(decimalPlaces);

    riseFallChart.data.datasets[0].data = [risePercentage, fallPercentage];
    riseFallChart.update();

    // Display rise and fall percentages
    document.getElementById('rise-fall-percentage').textContent = `Rise: ${risePercentage}%, Fall: ${fallPercentage}%`;
}

// Function to update the last 50 digits as "E" (Even) or "O" (Odd)
function updateLast50OE() {
    const last50Digits = tickHistory.slice(-50).map(tick => getLastDigit(tick.quote));
    const oeValues = last50Digits.map(digit => ({
        value: digit % 2 === 0 ? 'E' : 'O',
        class: digit % 2 === 0 ? 'even' : 'odd',
    }));

    const last50OEContainer = document.getElementById('last-50-oe-container');
    last50OEContainer.innerHTML = ''; // Clear existing content

    oeValues.forEach(({ value, class: oeClass }) => {
        const oeBox = document.createElement('div');
        oeBox.classList.add('oe-box', oeClass);
        oeBox.textContent = value;
        last50OEContainer.appendChild(oeBox);
    });
}

// Start WebSocket on page load
startWebSocket();
initializeCharts();
