const state = {
    digitElements: [],
    last1000Ticks: [],
    cursorPosition: 0,
    cursorElement: null,
    totalTickCount: 0,
    websocket: null,
    activeSubscription: null,
    lastPriceUpdate: Date.now(),
    lastReceivedPrice: null,
    connectionRetries: 0,
    MAX_RETRIES: 5,
    HISTORY_COUNT: 1000,
    MIN_TICKS_FOR_ANALYSIS: 100, // Reduced for faster initial display
    currentCandle: null,
    currentTimeframe: 120,
    soundEnabled: false, // Audio completely disabled
    volume: 0, // Audio volume set to 0
    isInitializing: true,
    tickBuffer: [],
    heartbeatInterval: null,
    lastHeartbeat: Date.now(),
    settings: {
        autoReconnect: true,
        showNotifications: false,
        darkMode: false,
        useHighPrecision: true,
        reconnectDelay: 2000,
        heartbeatFrequency: 30000 // 30 seconds
    }
};

// DOM Elements
const digitDisplay = document.getElementById('digitDisplay');
const symbolSelect = document.getElementById('symbol');
const timeframeSelect = document.getElementById('timeframe');
const currentDigit = document.getElementById('currentDigit');
const currentPrice = document.getElementById('currentPrice');
const totalTicks = document.getElementById('totalTicks');
const status = document.getElementById('status');
const chartContainer = document.getElementById('priceChart');
const candlePriceValue = document.getElementById('candlePriceValue');

// Chart Setup
const chart = LightweightCharts.createChart(chartContainer, {
    width: chartContainer.clientWidth,
    height: chartContainer.clientHeight,
    layout: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        textColor: '#333',
    },
    grid: {
        vertLines: { visible: false },
        horzLines: { visible: false }
    },
    timeScale: { borderVisible: false },
    rightPriceScale: { borderVisible: false }
});

const candleSeries = chart.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350'
});

// Initialize digit display
function initializeDigits() {
    digitDisplay.innerHTML = '';
    state.digitElements = [];

    for (let i = 0; i < 10; i++) {
        const container = document.createElement('div');
        container.className = 'digit-container';

        const digitElement = document.createElement('div');
        digitElement.className = 'digit';
        digitElement.textContent = i;
        digitElement.id = `digit-${i}`;

        const percentageElement = document.createElement('div');
        percentageElement.className = 'percentage';
        percentageElement.id = `percentage-${i}`;
        percentageElement.textContent = '0%';

        container.appendChild(digitElement);
        container.appendChild(percentageElement); // percentage below digit
        digitDisplay.appendChild(container);

        state.digitElements.push(digitElement);
    }

    state.cursorElement = document.createElement('div');
    state.cursorElement.className = 'cursor';
    digitDisplay.appendChild(state.cursorElement); // cursor after all digits
    updateCursorPosition();
}

// Update cursor position - fixed to appear below the digit
function updateCursorPosition() {
    if (!state.cursorElement || !state.digitElements[state.cursorPosition]) return;
    
    const digitRect = state.digitElements[state.cursorPosition].getBoundingClientRect();
    const displayRect = digitDisplay.getBoundingClientRect();
    const left = digitRect.left - displayRect.left + (digitRect.width / 2) - 8;
    const top = digitRect.bottom - displayRect.top + 5; // Changed: position below digit
    
    state.cursorElement.style.left = `${left}px`;
    state.cursorElement.style.top = `${top}px`;
}

// Process tick data - fixed to extract 3rd decimal place
function processTick(price, isHistorical = false) {
    try {
        if (price === undefined || price === null) return;

        const priceNum = parseFloat(price);
        if (isNaN(priceNum)) return;

        state.lastReceivedPrice = priceNum;
        state.lastPriceUpdate = Date.now();

        // Enhanced decimal handling - ensure we can extract 3rd decimal place
        let priceStr = priceNum.toString();
        
        // If no decimal point, add .000
        if (!priceStr.includes('.')) {
            priceStr += '.000';
        } else {
            // Pad decimal places to ensure we have at least 3 decimal places
            const parts = priceStr.split('.');
            const decimalPart = parts[1];
            
            if (decimalPart.length === 1) {
                priceStr += '00';  // e.g., 121.5 becomes 121.500
            } else if (decimalPart.length === 2) {
                priceStr += '0';   // e.g., 121.56 becomes 121.560
            }
            // If already 3 or more decimal places, keep as is
        }
        
        // Extract the 3rd decimal place digit
        const parts = priceStr.split('.');
        const lastDigit = parts[1] && parts[1].length >= 3 ? 
            parseInt(parts[1][2]) : 0;  // Changed from [1] to [2] for 3rd decimal

        // Maintain last 1000 ticks
        if (!isHistorical) {
            state.last1000Ticks.push(lastDigit);
            if (state.last1000Ticks.length > state.HISTORY_COUNT) {
                state.last1000Ticks.shift();
            }
            state.totalTickCount++;
            totalTicks.textContent = state.totalTickCount.toLocaleString();
            
            // Update live status immediately
            updateLiveStatus(true);
            updateLastTickTime();
        } else {
            // For historical data, add to buffer
            state.tickBuffer.push(lastDigit);
        }

        // Update displays with consistent formatting (always 2 decimal places)
        currentPrice.textContent = priceNum.toFixed(2);
        
        if (!isHistorical) {
            // Update current digit display immediately - no delays
            currentDigit.textContent = lastDigit;
            state.cursorPosition = lastDigit;
            updateCursorPosition();

            // Animate active digit with immediate response
            state.digitElements.forEach((digit, index) => {
                digit.classList.remove('active');
                if (index === lastDigit) {
                    digit.classList.add('active');
                    setTimeout(() => digit.classList.remove('active'), 1000);
                }
            });
        }

        // Only calculate percentages if we have enough data
        const tickCount = state.last1000Ticks.length;
        if (tickCount >= state.MIN_TICKS_FOR_ANALYSIS) {
            const digitCounts = Array(10).fill(0);
            state.last1000Ticks.forEach(digit => digitCounts[digit]++);
            updatePercentages(digitCounts, tickCount);
            
            // Update pattern analysis
            if (!isHistorical) {
                updatePatternAnalysis();
            }
        }

        // Update analysis status
        updateAnalysisStatus();
        updateCandleData(priceNum);
        
    } catch (error) {
        console.error('Error processing tick:', error);
    }
}

// Enhanced candle data update - UPDATE to 4 decimal places
function updateCandleData(tick) {
    const now = Math.floor(Date.now() / 1000);
    const candleTime = now - (now % state.currentTimeframe);
    
    if (!state.currentCandle || state.currentCandle.time !== candleTime) {
        if (state.currentCandle) {
            candleSeries.update(state.currentCandle);
        }
        state.currentCandle = {
            time: candleTime,
            open: tick,
            high: tick,
            low: tick,
            close: tick
        };
    } else {
        state.currentCandle.high = Math.max(state.currentCandle.high, tick);
        state.currentCandle.low = Math.min(state.currentCandle.low, tick);
        state.currentCandle.close = tick;
    }
    
    candleSeries.update(state.currentCandle);
    
    // Format candle price to 4 decimal places for better precision
    const candlePriceElement = document.getElementById('candlePriceValue');
    if (candlePriceElement) {
        candlePriceElement.textContent = state.currentCandle.close.toFixed(4); // Changed from 2 to 4
    }
    
    // Update candle pattern analysis
    updateCandlePattern();
}

// Enhanced update percentages with second-tier digit tracking
function updatePercentages(counts, total) {
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts.filter(count => count > 0));
    
    // Get sorted counts for second-tier identification
    const sortedCounts = [...new Set(counts)].sort((a, b) => b - a);
    const secondMaxCount = sortedCounts[1] || 0;
    const secondMinCount = sortedCounts[sortedCounts.length - 2] || minCount;
    
    const hotDigits = [];
    const coldDigits = [];

    for (let i = 0; i < 10; i++) {
        const percentage = total > 0 ? ((counts[i] / total) * 100) : 0;
        const element = document.getElementById(`digit-${i}`);
        const percentageElement = document.getElementById(`percentage-${i}`);

        percentageElement.textContent = `${percentage.toFixed(1)}%`;
        element.style.setProperty('--percentage', percentage);

        // Clear all classes first
        element.classList.remove('most-common', 'least-common', 'second-most-common', 'second-least-common');

        // Primary classifications
        if (counts[i] === maxCount && maxCount > 0) {
            element.classList.add('most-common');
            hotDigits.push(i);
        } else if (counts[i] === minCount && minCount < maxCount) {
            element.classList.add('least-common');
            coldDigits.push(i);
        }
        // Secondary classifications
        else if (counts[i] === secondMaxCount && secondMaxCount > 0 && secondMaxCount < maxCount) {
            element.classList.add('second-most-common');
        } else if (counts[i] === secondMinCount && secondMinCount > minCount && secondMinCount < maxCount) {
            element.classList.add('second-least-common');
        }
    }
    
    // Update hot/cold digit displays
    const hotDigitElement = document.getElementById('hotDigit');
    const coldDigitElement = document.getElementById('coldDigit');
    
    if (hotDigitElement) {
        hotDigitElement.textContent = hotDigits.length > 0 ? hotDigits.join(', ') : '-';
    }
    if (coldDigitElement) {
        coldDigitElement.textContent = coldDigits.length > 0 ? coldDigits.join(', ') : '-';
    }
}

// Connect to Deriv API
function connectToDeriv() {
    if (state.websocket) {
        state.websocket.onopen = null;
        state.websocket.onclose = null;
        state.websocket.onerror = null;
        state.websocket.close();
    }

    status.textContent = 'Connecting...';
    status.className = 'status-connecting';

    state.websocket = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=82255');

    state.websocket.onopen = () => {
        state.connectionRetries = 0;
        status.textContent = 'Connected';
        status.className = 'status-connected';
        updateLiveStatus(false); // Connected but not receiving live data yet
        subscribeToMarket(symbolSelect.value);
    };

    state.websocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.msg_type === 'tick') {
                // Live tick data from Deriv - immediate processing for perfect sync
                const price = parseFloat(data.tick.quote);
                if (!isNaN(price)) {
                    // Update live status and heartbeat immediately
                    updateLiveStatus(true);
                    updateLastTickTime();
                    
                    // Process tick immediately without delays
                    processTick(price, false);
                }
            }
            else if (data.msg_type === 'candles') {
                // Process candle data
                if (data.candles && Array.isArray(data.candles)) {
                    const formattedCandles = data.candles.map(c => ({
                        time: c.epoch,
                        open: parseFloat(c.open),
                        high: parseFloat(c.high),
                        low: parseFloat(c.low),
                        close: parseFloat(c.close)
                    }));
                    
                    candleSeries.setData(formattedCandles);
                    chart.timeScale().fitContent();
                    
                    // Update candle price display with 4 decimal places
                    if (formattedCandles.length > 0) {
                        const latestCandle = formattedCandles[formattedCandles.length - 1];
                        const candlePriceElement = document.getElementById('candlePriceValue');
                        if (candlePriceElement) {
                            candlePriceElement.textContent = latestCandle.close.toFixed(4); // Changed from 2 to 4
                        }
                    }
                }
            }
            else if (data.msg_type === 'ohlc') {
                // Handle live candle updates (OHLC data) - ADD this new handler
                if (data.ohlc) {
                    const liveCandle = {
                        time: data.ohlc.epoch,
                        open: parseFloat(data.ohlc.open),
                        high: parseFloat(data.ohlc.high),
                        low: parseFloat(data.ohlc.low),
                        close: parseFloat(data.ohlc.close)
                    };
                    
                    // Update with live candle data
                    candleSeries.update(liveCandle);
                    
                    if (candlePriceValue) {
                        candlePriceValue.textContent = liveCandle.close.toFixed(4);
                    }
                    
                    console.log(`🔴 Live candle update: ${liveCandle.close}`);
                }
            }
            else if (data.msg_type === 'history') {
                // Historical tick data processing
                if (data.history?.prices && Array.isArray(data.history.prices)) {
                    console.log(`Received ${data.history.prices.length} historical prices`);
                    
                    // Process historical data to build initial tick buffer
                    state.tickBuffer = [];
                    data.history.prices.forEach(price => {
                        processTick(price, true);
                    });
                    
                    // Transfer buffer to main array, keeping only last 1000
                    if (state.tickBuffer.length > 0) {
                        state.last1000Ticks = state.tickBuffer.slice(-state.HISTORY_COUNT);
                        state.tickBuffer = [];
                        
                        console.log(`Initialized with ${state.last1000Ticks.length} ticks`);
                        
                        // Update UI with historical data
                        if (state.last1000Ticks.length >= state.MIN_TICKS_FOR_ANALYSIS) {
                            const digitCounts = Array(10).fill(0);
                            state.last1000Ticks.forEach(digit => digitCounts[digit]++);
                            updatePercentages(digitCounts, state.last1000Ticks.length);
                            
                            state.isInitializing = false;
                            status.textContent = `Ready (${state.last1000Ticks.length} ticks)`;
                            status.className = 'status-connected';
                        }
                    }
                }
                
                // Request candles after historical data is loaded
                requestCandles();
            }
            else if (data.msg_type === 'error') {
                console.error('Deriv API Error:', data.error);
                status.textContent = data.error?.message || 'API Error';
                status.className = 'status-disconnected';
                
                // Handle specific error types
                if (data.error?.code === 'InvalidSymbol') {
                    console.warn('Invalid symbol, switching to default');
                    setTimeout(() => {
                        symbolSelect.value = 'R_10';
                        subscribeToMarket('R_10');
                    }, 1000);
                }
            }
            
        } catch (error) {
            console.error('Message processing error:', error);
        }
    };

    state.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        status.textContent = 'Connection error';
        status.className = 'status-disconnected';
        updateLiveStatus(false);
    };

    state.websocket.onclose = () => {
        updateLiveStatus(false);
        if (state.connectionRetries < state.MAX_RETRIES) {
            state.connectionRetries++;
            const delay = Math.min(3000 * state.connectionRetries, 15000);
            status.textContent = `Reconnecting (${state.connectionRetries}/${state.MAX_RETRIES})...`;
            status.className = 'status-connecting';
            setTimeout(connectToDeriv, delay);
        } else {
            status.textContent = 'Connection failed - refresh page';
            status.className = 'status-disconnected';
        }
    };
}

// Enhanced candle data request with hourly calculation
function requestCandles() {
    if (!state.websocket || state.websocket.readyState !== WebSocket.OPEN) return;

    // Calculate candles needed for different timeframes
    const candlesPerHour = Math.ceil(3600 / state.currentTimeframe);
    
    // Request enough candles for good historical view (at least 6 hours)
    const candleCount = Math.max(candlesPerHour * 6, 500); // 6 hours or minimum 500

    const candleRequest = {
        candles: 1,
        subscribe: 1,
        end: 'latest',
        count: candleCount, // Dynamic count based on timeframe
        granularity: state.currentTimeframe,
        style: 'candles',
        ticks_history: state.activeSubscription
    };

    state.websocket.send(JSON.stringify(candleRequest));
    console.log(`📈 Requesting ${candleCount} historical candles (${candlesPerHour}/hour) for ${state.activeSubscription}`);
}

// Subscribe to market - streamlined for better sync
function subscribeToMarket(symbol) {
    if (!state.websocket || state.websocket.readyState !== WebSocket.OPEN) {
        console.warn('WebSocket not ready for subscription');
        return false;
    }

    try {
        // Forget previous subscriptions
        if (state.activeSubscription) {
            state.websocket.send(JSON.stringify({
                forget: state.activeSubscription,
                forget_all: ['ticks', 'candles']
            }));
        }
        
        // Reset state for clean start
        state.last1000Ticks = [];
        state.tickBuffer = [];
        state.totalTickCount = 0;
        state.isInitializing = true;
        totalTicks.textContent = '0';
        currentDigit.textContent = '-';
        currentPrice.textContent = '-';
        state.currentCandle = null;

        // Clear displays
        const hotDigit = document.getElementById('hotDigit');
        const coldDigit = document.getElementById('coldDigit');
        if (hotDigit) hotDigit.textContent = '-';
        if (coldDigit) coldDigit.textContent = '-';

        // Clear percentage displays
        for (let i = 0; i < 10; i++) {
            const element = document.getElementById(`digit-${i}`);
            const percentageElement = document.getElementById(`percentage-${i}`);
            
            if (element) {
                element.classList.remove('most-common', 'least-common', 'active');
                element.style.removeProperty('--percentage');
            }
            if (percentageElement) {
                percentageElement.textContent = '0%';
            }
        }

        status.textContent = `Connecting to ${symbol}...`;
        status.className = 'status-connecting';

        // Request historical data first
        state.websocket.send(JSON.stringify({
            ticks_history: symbol,
            end: 'latest',
            count: state.HISTORY_COUNT
        }));
        
        // Subscribe to live ticks - this is the key for live sync
        state.websocket.send(JSON.stringify({
            ticks: symbol,
            subscribe: 1
        }));
        
        console.log(`✅ Subscribed to ${symbol} for live sync`);
        state.activeSubscription = symbol;
        
        // Start heartbeat monitoring
        startHeartbeat();
        
        return true;
    } catch (error) {
        console.error('Subscription failed:', error);
        status.textContent = 'Subscription error - retrying';
        status.className = 'status-disconnected';
        setTimeout(() => subscribeToMarket(symbol), 2000);
        return false;
    }
}

// Handle timeframe change
timeframeSelect.addEventListener('change', (e) => {
    state.currentTimeframe = parseInt(e.target.value);
    state.currentCandle = null;
    if (state.websocket?.readyState === WebSocket.OPEN) {
        requestCandles();
    }
});

// Audio context for sound effects
let audioContext;
let soundBuffer;

// Initialize audio
function initAudio() {
    // Audio initialization disabled - keeping function for compatibility
    console.log('🔇 Audio disabled by design');
    state.soundEnabled = false;
    state.volume = 0;
}

// Play notification sound
function playSound() {
    // Audio playback disabled - keeping function for compatibility
    // This function intentionally does nothing
    return;
}

// Local storage management
function saveSettings() {
    localStorage.setItem('dexteratorSettings', JSON.stringify({
        soundEnabled: state.soundEnabled,
        volume: state.volume,
        settings: state.settings
    }));
}

function loadSettings() {
    try {
        const saved = localStorage.getItem('dexteratorSettings');
        if (saved) {
            const data = JSON.parse(saved);
            // Always keep audio disabled regardless of saved settings
            state.soundEnabled = false;
            state.volume = 0;
            state.settings = { ...state.settings, ...data.settings };
            
            // Update UI elements - audio controls are disabled
            const toggleSound = document.getElementById('toggleSound');
            if (toggleSound) {
                toggleSound.textContent = '🔇 Audio Disabled';
                toggleSound.disabled = true;
                toggleSound.style.opacity = '0.5';
            }
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Export data functionality
function exportData() {
    try {
        const data = {
            metadata: {
                exportTime: new Date().toISOString(),
                market: symbolSelect.value,
                timeframe: state.currentTimeframe,
                totalTicks: state.totalTickCount,
                analysisWindow: state.last1000Ticks.length
            },
            tickData: state.last1000Ticks,
            statistics: {}
        };
        
        // Calculate digit statistics
        if (state.last1000Ticks.length > 0) {
            const digitCounts = Array(10).fill(0);
            state.last1000Ticks.forEach(digit => digitCounts[digit]++);
            
            data.statistics = {
                digitCounts,
                percentages: digitCounts.map(count => 
                    ((count / state.last1000Ticks.length) * 100).toFixed(2)
                ),
                mostCommon: digitCounts.indexOf(Math.max(...digitCounts)),
                leastCommon: digitCounts.indexOf(Math.min(...digitCounts.filter(c => c > 0)))
            };
        }
        
        // Create and download file
        const blob = new Blob([JSON.stringify(data, null, 2)], { 
            type: 'application/json' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dexterator-analysis-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('📊 Data exported successfully');
    } catch (error) {
        console.error('Export failed:', error);
        alert('Export failed. Please try again.');
    }
}

// Get digit statistics
function getDigitCounts() {
    const counts = Array(10).fill(0);
    state.last1000Ticks.forEach(digit => counts[digit]++);
    return counts;
}

function getStatistics() {
    const counts = getDigitCounts();
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts.filter(count => count > 0));
    
    const hotDigits = counts.map((count, index) => ({ digit: index, count }))
                           .filter(item => item.count === maxCount)
                           .map(item => item.digit);
    
    const coldDigits = counts.map((count, index) => ({ digit: index, count }))
                            .filter(item => item.count === minCount && item.count < maxCount)
                            .map(item => item.digit);
    
    return {
        hotDigits,
        coldDigits,
        maxCount,
        minCount,
        totalTicks: state.last1000Ticks.length
    };
}

// Enhanced reset statistics with proper validation
function resetStats() {
    if (confirm('Are you sure you want to reset all statistics? This will clear all tick data and restart analysis.')) {
        // Clear all tick data
        state.last1000Ticks = [];
        state.tickBuffer = [];
        state.totalTickCount = 0;
        state.isInitializing = true;
        
        // Reset UI displays
        totalTicks.textContent = '0';
        currentDigit.textContent = '-';
        currentPrice.textContent = '-';
        
        // Clear candle price
        const candlePriceElement = document.getElementById('candlePriceValue');
        if (candlePriceElement) candlePriceElement.textContent = '-';
        
        // Clear digit displays and remove all classes
        for (let i = 0; i < 10; i++) {
            const element = document.getElementById(`digit-${i}`);
            const percentageElement = document.getElementById(`percentage-${i}`);
            
            if (element) {
                element.classList.remove('most-common', 'least-common', 'active');
                element.style.removeProperty('--percentage');
            }
            if (percentageElement) {
                percentageElement.textContent = '-%';
            }
        }
        
        // Clear hot/cold digit displays and analysis status
        const hotDigit = document.getElementById('hotDigit');
        const coldDigit = document.getElementById('coldDigit');
        const analysisStatus = document.getElementById('analysisStatus');
        if (hotDigit) hotDigit.textContent = '-';
        if (coldDigit) coldDigit.textContent = '-';
        if (analysisStatus) {
            analysisStatus.textContent = 'Waiting...';
            analysisStatus.style.color = '#f39c12';
        }
        
        // Reset status
        status.textContent = 'Reset complete - collecting new data...';
        status.className = 'status-connecting';
        
        // If connected, restart data collection
        if (state.websocket?.readyState === WebSocket.OPEN) {
            subscribeToMarket(symbolSelect.value);
        }
        
        console.log('Statistics reset successfully');
    }
}

// Update analysis status indicator
function updateAnalysisStatus() {
    const analysisStatus = document.getElementById('analysisStatus');
    if (!analysisStatus) return;
    
    const tickCount = state.last1000Ticks.length;
    
    if (tickCount < state.MIN_TICKS_FOR_ANALYSIS) {
        const percentage = Math.round((tickCount / state.MIN_TICKS_FOR_ANALYSIS) * 100);
        analysisStatus.textContent = `${percentage}% (${tickCount}/${state.MIN_TICKS_FOR_ANALYSIS})`;
        analysisStatus.style.color = '#f39c12'; // Orange for loading
    } else {
        analysisStatus.textContent = `✓ Ready (${tickCount})`;
        analysisStatus.style.color = '#28a003'; // Green for ready
    }
}

// Update live sync status indicator
function updateLiveStatus(isLive = false) {
    const liveStatus = document.getElementById('liveStatus');
    if (liveStatus) {
        if (isLive) {
            liveStatus.textContent = '🟢 Live';
            liveStatus.style.color = '#28a003';
            
            // Flash effect for new data
            liveStatus.style.animation = 'flash 0.3s ease';
            setTimeout(() => {
                liveStatus.style.animation = '';
            }, 300);
        } else {
            liveStatus.textContent = '🔴 Offline';
            liveStatus.style.color = '#e74c3c';
        }
    }
    
    // Update control panel indicator too
    updateControlPanelLiveIndicator(isLive);
}

// Update the live indicator in control panel
function updateControlPanelLiveIndicator(isLive = false) {
    const liveIndicator = document.querySelector('.live-indicator');
    if (!liveIndicator) return;
    
    const span = liveIndicator.querySelector('span');
    if (!span) return;
    
    if (isLive) {
        span.textContent = '🟢 Live Data Synchronized';
        liveIndicator.classList.add('connected');
        liveIndicator.style.animation = 'flash 0.3s ease';
        setTimeout(() => {
            liveIndicator.style.animation = '';
        }, 300);
    } else {
        span.textContent = '🔴 Live Data Status';
        liveIndicator.classList.remove('connected');
    }
}

// Flash animation for live indicator
const flashKeyframes = `
@keyframes flash {
    0% { opacity: 1; }
    50% { opacity: 0.5; }
    100% { opacity: 1; }
}`;

// Add keyframes to document
if (!document.querySelector('#flash-animation')) {
    const style = document.createElement('style');
    style.id = 'flash-animation';
    style.textContent = flashKeyframes;
    document.head.appendChild(style);
}

// Test function to verify digit extraction logic
function testDigitExtraction() {
    const testPrices = [
        121.00,  // Should be 0
        121.30,  // Should be 0  
        121.3,   // Should be 0 (treated as 121.30)
        121,     // Should be 0 (treated as 121.00)
        121.56,  // Should be 6
        121.5,   // Should be 0 (treated as 121.50)
        121.07,  // Should be 7
        121.99,  // Should be 9
    ];
    
    console.log('=== Digit Extraction Test ===');
    testPrices.forEach(price => {
        const priceFixed = price.toFixed(2);
        const parts = priceFixed.split('.');
        const digit = parseInt(parts[1][1]);
        console.log(`Price: ${price} → Fixed: ${priceFixed} → 2nd Decimal: ${digit}`);
    });
    console.log('=== End Test ===');
}

// Run test on page load (can be removed in production)
if (window.location.search.includes('test=true')) {
    setTimeout(testDigitExtraction, 1000);
}

// Enhanced Theme Management with HTML switching
function initThemeSwitch() {
    const themeSwitch = document.getElementById('themeSwitch');
    const body = document.body;
    
    // Detect current page
    const currentPage = window.location.pathname;
    const isRoyalPage = currentPage.includes('royal-majesty.html');
    const isMinimalistPage = currentPage.includes('minimalist.html');
    const isDexteratorPage = currentPage.includes('index.html') || currentPage.endsWith('/ai/') || currentPage.endsWith('/ai');
    
    // Set initial theme based on page
    if (isRoyalPage) {
        body.setAttribute('data-theme', 'royal');
        updateThemeButton('royal');
    } else if (isMinimalistPage) {
        body.setAttribute('data-theme', 'minimalist');
        updateThemeButton('minimalist');
    } else {
        // Load saved theme for main page
        const savedTheme = localStorage.getItem('dexterator-theme') || 'aggressive';
        body.setAttribute('data-theme', savedTheme);
        updateThemeButton(savedTheme);
    }
    
    if (themeSwitch) {
        themeSwitch.addEventListener('click', () => {
            if (isRoyalPage) {
                // Switch from Royal to Minimalist
                localStorage.setItem('dexterator-theme', 'minimalist');
                window.location.href = 'minimalist.html';
            } else if (isMinimalistPage) {
                // Switch from Minimalist to Dexterator
                localStorage.setItem('dexterator-theme', 'aggressive');
                window.location.href = 'index.html';
            } else {
                // Check current theme on main page
                const currentTheme = body.getAttribute('data-theme');
                
                if (currentTheme === 'royal') {
                    // Switch to Minimalist HTML page
                    localStorage.setItem('dexterator-theme', 'minimalist');
                    window.location.href = 'minimalist.html';
                } else {
                    // Switch to next theme: aggressive -> royal -> minimalist -> aggressive
                    let newTheme;
                    if (currentTheme === 'aggressive') {
                        newTheme = 'royal';
                        localStorage.setItem('dexterator-theme', 'royal');
                        window.location.href = 'royal-majesty.html';
                    } else {
                        newTheme = 'minimalist';
                        localStorage.setItem('dexterator-theme', 'minimalist');
                        window.location.href = 'minimalist.html';
                    }
                }
            }
            
            console.log(`🎨 Theme switched - Page: ${isRoyalPage ? 'Royal' : isMinimalistPage ? 'Minimalist' : 'Dexterator'}`);
        });
    }
}

function updateThemeButton(theme) {
    const themeSwitch = document.getElementById('themeSwitch');
    const currentPage = window.location.pathname;
    const isRoyalPage = currentPage.includes('royal-majesty.html');
    const isMinimalistPage = currentPage.includes('minimalist.html');
    
    // Update mobile theme color based on current theme
    updateMobileThemeColor(theme);
    
    if (themeSwitch) {
        if (isRoyalPage) {
            themeSwitch.textContent = '📊 Switch to Minimalist';
            themeSwitch.title = 'Switch to Minimalist Theme';
        } else if (isMinimalistPage) {
            themeSwitch.textContent = '⚔️ Switch to Dexterator';
            themeSwitch.title = 'Switch to Dexterator Theme';
        } else if (theme === 'royal') {
            themeSwitch.textContent = '👑 Enter Royal Majesty';
            themeSwitch.title = 'Switch to Royal Majesty Experience';
        } else {
            themeSwitch.textContent = '📊 Minimalist';
            themeSwitch.title = 'Switch to Minimalist Theme';
        }
    }
}

// Dynamic mobile theme color updater
function updateMobileThemeColor(theme) {
    const themeColorMeta = document.getElementById('theme-color-meta');
    const navButtonMeta = document.querySelector('meta[name="msapplication-navbutton-color"]');
    
    let themeColor = '#032942'; // Default navy blue
    
    // Set theme color based on current theme
    if (theme === 'royal') {
        themeColor = '#8B4513'; // Royal brown
    } else if (theme === 'minimalist') {
        themeColor = '#2c3e50'; // Minimalist dark blue
    } else if (theme === 'aggressive') {
        themeColor = '#032942'; // Aggressive navy blue
    }
    
    // Update meta tags for mobile browsers
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', themeColor);
    }
    if (navButtonMeta) {
        navButtonMeta.setAttribute('content', themeColor);
    }
    
    console.log(`📱 Mobile theme color updated to ${themeColor} for ${theme} theme`);
}

// Enhanced initialization with theme support
function initApp() {
    if (!window.WebSocket) {
        status.textContent = 'Browser not supported (needs WebSocket)';
        status.className = 'status-disconnected';
        return;
    }

    // Initialize theme switching FIRST
    initThemeSwitch();
    
    // Load saved settings
    loadSettings();
    
    // Initialize audio
    initAudio();
    
    initializeDigits();
    connectToDeriv();

    // Market symbol change handler
    symbolSelect.addEventListener('change', (e) => {
        subscribeToMarket(e.target.value);
    });

    // Control panel event listeners
    const resetBtn = document.getElementById('resetStats');
    const soundBtn = document.getElementById('toggleSound');
    const exportBtn = document.getElementById('exportData');
    const volumeSlider = document.getElementById('volume');
    const volumeValue = document.getElementById('volumeValue');

    if (resetBtn) {
        resetBtn.addEventListener('click', resetStats);
    }

    if (soundBtn) {
        // Audio is permanently disabled - update button accordingly
        soundBtn.textContent = '🔇 Audio Disabled';
        soundBtn.disabled = true;
        soundBtn.style.opacity = '0.5';
        soundBtn.style.cursor = 'not-allowed';
        
        soundBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Show tooltip or message that audio is disabled
            console.log('Audio is permanently disabled in this version');
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', exportData);
    }

    if (volumeSlider && volumeValue) {
        volumeSlider.addEventListener('input', (e) => {
            state.volume = e.target.value / 100;
            volumeValue.textContent = `${e.target.value}%`;
            saveSettings();
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 'r':
                    e.preventDefault();
                    resetStats();
                    break;
                case 's':
                    e.preventDefault();
                    state.soundEnabled = !state.soundEnabled;
                    if (soundBtn) {
                        soundBtn.textContent = state.soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
                    }
                    saveSettings();
                    break;
                case 'e':
                    e.preventDefault();
                    exportData();
                    break;
            }
        }
    });

    // Window resize handler
    window.addEventListener('resize', () => {
        chart.applyOptions({
            width: chartContainer.clientWidth,
            height: chartContainer.clientHeight
        });
        updateCursorPosition();
    });

    // Visibility change handler for better performance
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Pause updates when tab is not visible
            console.log('Tab hidden - pausing updates');
        } else {
            // Resume updates when tab becomes visible
            console.log('Tab visible - resuming updates');
            if (state.websocket?.readyState !== WebSocket.OPEN) {
                connectToDeriv();
            }
        }
    });
}

// Start the application
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    loadSettings();
    initAudio();
});

// Cleanup
window.addEventListener('beforeunload', () => {
    if (state.websocket) {
        state.websocket.close();
    }
});

// Heartbeat mechanism to ensure live data synchronization
let lastTickTime = Date.now();
let heartbeatInterval;

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    heartbeatInterval = setInterval(() => {
        const timeSinceLastTick = Date.now() - lastTickTime;
        
        // If no tick received in 10 seconds, show warning
        if (timeSinceLastTick > 10000) {
            console.warn('⚠️ No live ticks received for 10 seconds');
            updateLiveStatus(false);
            
            // Try to reconnect if no data for 30 seconds
            if (timeSinceLastTick > 30000 && state.websocket?.readyState === WebSocket.OPEN) {
                console.log('🔄 Attempting to resubscribe due to data timeout');
                subscribeToMarket(symbolSelect.value);
            }
        }
    }, 5000); // Check every 5 seconds
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// Update last tick time when we receive live data
function updateLastTickTime() {
    lastTickTime = Date.now();
}

// Pattern Analysis Functions
function updatePatternAnalysis() {
    updateLastTenDigits();
    updateCommonSequence();
    updateTrendDirection();
}

function updateLastTenDigits() {
    const lastTenElement = document.getElementById('lastTenDigits');
    if (!lastTenElement) return;
    
    if (state.last1000Ticks.length >= 10) {
        const lastTen = state.last1000Ticks.slice(-10);
        lastTenElement.textContent = lastTen.join(' ');
    } else {
        lastTenElement.textContent = 'Collecting data...';
    }
}

function updateCommonSequence() {
    const sequenceElement = document.getElementById('commonSequence');
    if (!sequenceElement) return;
    
    if (state.last1000Ticks.length >= 100) {
        const sequences = {};
        
        // Analyze 3-digit sequences
        for (let i = 0; i <= state.last1000Ticks.length - 3; i++) {
            const sequence = state.last1000Ticks.slice(i, i + 3).join('');
            sequences[sequence] = (sequences[sequence] || 0) + 1;
        }
        
        // Find most common sequence
        let maxCount = 0;
        let mostCommon = 'None';
        
        for (const [seq, count] of Object.entries(sequences)) {
            if (count > maxCount) {
                maxCount = count;
                mostCommon = seq.split('').join(' ');
            }
        }
        
        sequenceElement.textContent = `${mostCommon} (${maxCount}x)`;
    } else {
        sequenceElement.textContent = 'Need more data...';
    }
}

function updateTrendDirection() {
    const trendElement = document.getElementById('trendDirection');
    if (!trendElement) return;
    
    if (state.last1000Ticks.length >= 20) {
        const recent = state.last1000Ticks.slice(-20);
        const first10 = recent.slice(0, 10);
        const last10 = recent.slice(10, 20);
        
        const avg1 = first10.reduce((a, b) => a + b, 0) / 10;
        const avg2 = last10.reduce((a, b) => a + b, 0) / 10;
        
        const diff = avg2 - avg1;
        
        // Clear previous classes
        trendElement.classList.remove('trend-up', 'trend-down', 'trend-neutral');
        
        if (diff > 0.5) {
            trendElement.textContent = '📈 Upward';
            trendElement.classList.add('trend-up');
        } else if (diff < -0.5) {
            trendElement.textContent = '📉 Downward';
            trendElement.classList.add('trend-down');
        } else {
            trendElement.textContent = '➡️ Neutral';
            trendElement.classList.add('trend-neutral');
        }
    } else {
        trendElement.textContent = 'Analyzing...';
        trendElement.classList.add('trend-neutral');
    }
}

function updateCandlePattern() {
    const patternElement = document.getElementById('candlePattern');
    if (!patternElement) return;
    
    // This will be enhanced when we get candle data
    if (state.currentCandle) {
        const { open, high, low, close } = state.currentCandle;
        const body = Math.abs(close - open);
        const upperShadow = high - Math.max(open, close);
        const lowerShadow = Math.min(open, close) - low;
        
        let pattern = 'Normal';
        
        if (body < (upperShadow + lowerShadow) * 0.3) {
            pattern = 'Doji';
        } else if (close > open) {
            if (upperShadow > body * 2) {
                pattern = 'Shooting Star (Bull)';
            } else if (lowerShadow > body * 2) {
                pattern = 'Hammer (Bull)';
            } else {
                pattern = 'Bullish';
            }
        } else {
            if (upperShadow > body * 2) {
                pattern = 'Hanging Man (Bear)';
            } else if (lowerShadow > body * 2) {
                pattern = 'Inverted Hammer (Bear)';
            } else {
                pattern = 'Bearish';
            }
        }
        
        patternElement.textContent = pattern;
    } else {
        patternElement.textContent = 'No candle data';
    }
}