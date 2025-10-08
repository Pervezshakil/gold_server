const axios = require('axios');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const fs = require('fs'); // ⬅️ Add this

// --- Capital.com credentials ---
const CAPITAL_API_KEY = 'HdwRdqYQfPnfhvzh';
const CAPITAL_EMAIL = 'sohagpervez516@gmail.com';
const CAPITAL_PASSWORD = 'Nbh.9d9qm9a9@3g';
// -------------------------------

let cst = '';
let securityToken = '';
let goldEpic = '';
let sessionHigh = null;
let sessionLow = null;
let clients = [];
let lastRate = null; // Cache last broadcast rate

const LAST_RATE_FILE = './lastrate.json'; // ⬅️ Add this

// ---- [1] Load last rate from file on server start ----
function loadLastRate() {
    if (fs.existsSync(LAST_RATE_FILE)) {
        try {
            lastRate = JSON.parse(fs.readFileSync(LAST_RATE_FILE, 'utf-8'));
            console.log('[SERVER] LastRate loaded from file:', lastRate);
        } catch (e) {
            console.error('[SERVER] lastrate.json read error:', e.message);
            lastRate = null;
        }
    }
}

// ---- [2] Save last rate to file whenever new rate comes ----
function saveLastRate(rate) {
    lastRate = rate;
    try {
        fs.writeFileSync(LAST_RATE_FILE, JSON.stringify(rate));
    } catch (e) {
        console.error('[SERVER] lastrate.json write error:', e.message);
    }
}

loadLastRate(); // ⬅️ Startup-এ call

const app = express();
app.use(cors());

app.get('/', (req, res) => res.send('✅ Gold Server Running'));

const server = app.listen(process.env.PORT || 3000, () => {
    console.log(`🌐 HTTP+WebSocket server running on port ${process.env.PORT || 3000}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    clients.push(ws);

    ws.send(JSON.stringify({
        type: 'connected',
        message: '✅ Connected to Gold WebSocket Server',
        time: new Date().toISOString()
    }));

    // Always send lastRate (from file or stream)
    /*if (lastRate) {
        ws.send(JSON.stringify({ type: 'rate', ...lastRate }));
    }*/

        // Always send lastRate (from file or stream) — format before sending
    if (lastRate) {
        try {
            ws.send(JSON.stringify(formatRateForBroadcast({ type: 'rate', ...lastRate })));
        } catch (e) {
            console.error('[CONNECTION][SEND LASTRATE ERROR]', e && e.message);
        }
    }

    if (sessionHigh !== null && sessionLow !== null) {
        ws.send(JSON.stringify({
            type: 'sessionStats',
            high: sessionHigh,
            low: sessionLow,
            time: new Date().toISOString()
        }));
    }

    ws.on('close', () => {
        clients = clients.filter(c => c !== ws);
        console.log(`[CLIENT] WebSocket client disconnected. Total: ${clients.length}`);
    });
    ws.on('error', (err) => {
        clients = clients.filter(c => c !== ws);
        console.error(`[CLIENT] WebSocket client error: ${err.message}`);
    });
});

/*function broadcastToClients(data) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    clients = clients.filter(ws => ws.readyState === ws.OPEN);
    clients.forEach(ws => ws.send(json));
}*/

// ----------------- Replace your existing broadcastToClients with this -----------------
function formatRateForBroadcast(obj) {
    const pick = (v) => {
        if (v === undefined || v === null) return null;
        const n = Number(v);
        if (isNaN(n)) return String(v);
        return n.toFixed(2); // ALWAYS returns string with 2 decimals (e.g. "2350.00")
    };

    // copy fields but format numeric rate fields to 2 decimals as strings
    return {
        ...obj,
        bid: obj.bid !== undefined ? pick(obj.bid) : obj.bid,
        ask: obj.ask !== undefined ? pick(obj.ask) : obj.ask,
        high: obj.high !== undefined ? pick(obj.high) : obj.high,
        low: obj.low !== undefined ? pick(obj.low) : obj.low,
    };
}

function broadcastToClients(data) {
    let out = data;
    try {
        const isRateLike = data && (data.type === 'rate' || data.bid !== undefined || data.ask !== undefined);
        if (isRateLike && typeof data === 'object' && !Array.isArray(data)) {
            out = formatRateForBroadcast(data);
        }
    } catch (e) {
        console.error('[BROADCAST][FORMAT ERROR]', e && e.message);
        out = data; // fallback to original if formatting fails
    }

    const json = typeof out === 'string' ? out : JSON.stringify(out);
    clients = clients.filter(ws => ws.readyState === ws.OPEN);
    clients.forEach(ws => {
        try { ws.send(json); } catch (err) { /* ignore per-client send errors */ }
    });
}
// --------------------------------------------------------------------------------------

// [3] Always broadcast lastRate every 1s (from file or stream)
setInterval(() => {
    if (lastRate) {
        broadcastToClients({ type: 'rate', ...lastRate });
    }
}, 1000);

function updateSessionHighLow(bid, ask) {
    if (sessionHigh === null || ask > sessionHigh) sessionHigh = ask;
    if (sessionLow === null || bid < sessionLow) sessionLow = bid;
}

// === Main Capital.com Session & Streaming Logic ===
async function createSession() {
    try {
        console.log('[SESSION] Creating Capital.com session...');
        const sessionRes = await axios.post(
            'https://api-capital.backend-capital.com/api/v1/session',
            {
                identifier: CAPITAL_EMAIL,
                password: CAPITAL_PASSWORD,
                encryptedPassword: false
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-CAP-API-KEY': CAPITAL_API_KEY
                }
            }
        );
        cst = sessionRes.headers['cst'];
        securityToken = sessionRes.headers['x-security-token'];
        console.log(`[SESSION] Success: CST=${cst}`);

        goldEpic = await fetchStreamingEpic(cst, securityToken);
        if (!goldEpic) {
            console.error('[EPIC] No streaming EPIC found! Exiting.');
            process.exit(1);
        }
        console.log('[EPIC] Streaming GOLD EPIC:', goldEpic);
    } catch (e) {
        console.error('[SESSION ERROR]', e.response ? e.response.data : e.message);
        process.exit(1);
    }
}

// === Find only streaming enabled epic ===
async function fetchStreamingEpic(cst, securityToken) {
    const terms = ['gold', 'xauusd', 'spot gold'];
    for (const term of terms) {
        try {
            const res = await axios.get(
                `https://api-capital.backend-capital.com/api/v1/markets?searchTerm=${term}`,
                {
                    headers: {
                        'CST': cst,
                        'X-SECURITY-TOKEN': securityToken
                    }
                }
            );
            if (res.data.markets && res.data.markets.length > 0) {
                // Only take streaming-enabled epic
                const market = res.data.markets.find(
                    m => m.epic && m.streamingPricesAvailable === true
                );
                if (market) {
                    console.log(`[EPIC] Found streaming epic for "${term}": ${market.epic} | Name: ${market.marketName}`);
                    return market.epic;
                }
            }
        } catch (e) {
            console.error(`[EPIC] Error fetching for "${term}":`, e.response?.data || e.message);
        }
    }
    return null;
}

// === [4] STREAMING — ALWAYS save new rate to file ===
function connectCapitalWebSocket() {
    if (!cst || !securityToken || !goldEpic) {
        console.error('[WS] Missing session/cst/token/epic, cannot connect to streaming API!');
        return;
    }
    const ws = new WebSocket('wss://api-streaming-capital.backend-capital.com/connect');

    ws.on('open', () => {
        console.log('[WS] 🟢 Connected to Capital.com streaming');
        ws.send(JSON.stringify({
            destination: 'marketData.subscribe',
            correlationId: '1',
            cst,
            securityToken,
            payload: { epics: [goldEpic] }
        }));
        console.log(`[WS] Sent subscribe for epic: ${goldEpic}`);
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Show all incoming messages
            // console.log('[WS][RAW]', data);

            if (
                data.destination === 'quote' &&
                data.payload &&
                data.payload.epic === goldEpic
            ) {
                const payload = data.payload;
                const bid = (typeof payload.bid === 'number' && payload.bid > 0)
                    ? payload.bid
                    : (lastRate ? lastRate.bid : 0);
                const spread = 1.0;
                const ask = parseFloat((bid + spread).toFixed(2));
                updateSessionHighLow(bid, ask);
                const high = payload.high || sessionHigh || ask;
                const low = payload.low || sessionLow || bid;

                // [SAVE to file & update broadcast]
                const newRate = {
                    bid, ask, high, low, unit: 'ounce', updated: new Date().toISOString()
                };
                saveLastRate(newRate); // <-- এইখানে ফাইলে সেভ হয়
                const result = { type: 'rate', ...newRate };
                // console.log('💸 [WS] Rate:', result);
                broadcastToClients(result);
            } else if (data.destination === 'marketData.subscribe') {
                const sub = data.payload?.subscriptions?.[goldEpic];
                if (typeof sub === 'string' && sub.startsWith('ERROR')) {
                    console.error(`[WS][SUBSCRIPTION ERROR] ${sub}`);
                }
            }
        } catch (e) {
            console.error('[WS][MESSAGE][PARSE ERROR]', e);
        }
    });

    ws.on('error', err => {
        console.error('[WS][ERROR] Capital streaming error:', err.message, err);
        ws.close();
    });

    ws.on('close', (code, reason) => {
        console.warn(`[WS][CLOSE] Streaming closed. Code: ${code}, Reason: ${reason}`);
        setTimeout(connectCapitalWebSocket, 1500);
    });
}

// Node.js error handling
process.on('uncaughtException', err => console.error('[NODE][UNCAUGHT EXCEPTION]', err));
process.on('unhandledRejection', reason => console.error('[NODE][UNHANDLED REJECTION]', reason));

// Main bootstrap
(async () => {
    await createSession();
    connectCapitalWebSocket();
    setInterval(async () => {
        console.log('[SESSION] Refreshing Capital.com session...');
        await createSession();
    }, 9 * 60 * 1000);
})();
