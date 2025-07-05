// server.js — Auto streaming EPIC (no sentiment), detailed log
const axios = require('axios');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

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

    if (lastRate) {
        ws.send(JSON.stringify({ type: 'rate', ...lastRate }));
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

function broadcastToClients(data) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    clients = clients.filter(ws => ws.readyState === ws.OPEN);
    clients.forEach(ws => ws.send(json));
}
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
            console.log('[WS][RAW]', data);

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
                lastRate = {
                    bid, ask, high, low, unit: 'ounce', updated: new Date().toISOString()
                };
                const result = {
                    type: 'rate',
                    ...lastRate
                };
                console.log('💸 [WS] Rate:', result);
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
