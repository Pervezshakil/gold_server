// ✅ server.js - Streaming Ready (Client connect = instant + live data)
const axios = require('axios');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

// --------- 🔑 Capital.com Credentials ---------
const CAPITAL_API_KEY = 'HdwRdqYQfPnfhvzh';
const CAPITAL_EMAIL = 'sohagpervez516@gmail.com';
const CAPITAL_PASSWORD = 'Nbh.9d9qm9a9@3g';
//------------------------------------------------

let cst = '';
let securityToken = '';
let goldEpic = '';
let sessionHigh = null;
let sessionLow = null;
let clients = [];

let lastRate = null;      // ⭐ Latest rate cache
let lastSentiment = null; // ⭐ Latest sentiment cache

const app = express();
app.use(cors());

app.get('/api/sentiment', async (req, res) => {
    const sentiment = await getMarketSentiment();
    if (sentiment) res.json(sentiment);
    else res.status(500).json({ error: 'Sentiment data not available' });
});

app.get('/', (req, res) => res.send('✅ Gold Server Running'));

const server = app.listen(process.env.PORT || 3000, () => {
    console.log(`🌐 HTTP+WebSocket server running on port ${process.env.PORT || 3000}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    clients.push(ws);

    // ⭐ Client connect হলে সাথে সাথে ইনস্ট্যান্ট মেসেজ পাঠাও
    ws.send(JSON.stringify({
        type: 'connected',
        message: '✅ Connected to Gold WebSocket Server',
        time: new Date().toISOString()
    }));

    // ⭐ Last cached rate থাকলে সাথে সাথেই পাঠাও
    if (lastRate) {
        ws.send(JSON.stringify({ type: 'rate', ...lastRate }));
    }

    // ⭐ Last cached sentiment থাকলে সেটাও পাঠাও
    if (lastSentiment) {
        ws.send(JSON.stringify({ type: 'sentiment', ...lastSentiment }));
    }

    // Optional: sessionHigh/sessionLow পাঠাতে চাইলে
    if (sessionHigh !== null && sessionLow !== null) {
        ws.send(JSON.stringify({
            type: 'sessionStats',
            high: sessionHigh,
            low: sessionLow,
            time: new Date().toISOString()
        }));
    }

    ws.on('close', () => clients = clients.filter(c => c !== ws));
    ws.on('error', () => clients = clients.filter(c => c !== ws));
});

// সবকিছু broadcast করার ফাংশন
function broadcastToClients(data) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    clients = clients.filter(ws => ws.readyState === ws.OPEN);
    clients.forEach(ws => ws.send(json));
}

// Session High/Low update utility
function updateSessionHighLow(bid, ask) {
    if (sessionHigh === null || ask > sessionHigh) sessionHigh = ask;
    if (sessionLow === null || bid < sessionLow) sessionLow = bid;
}

// Market Sentiment
async function broadcastSentimentToClients() {
    const sentiment = await getMarketSentiment();
    if (!sentiment) return;
    lastSentiment = sentiment; // ⭐ cache latest sentiment
    broadcastToClients({ type: 'sentiment', ...sentiment });
}

async function getMarketSentiment(epic = goldEpic) {
    if (!epic || !cst || !securityToken) return null;
    try {
        const response = await axios.get(
            `https://api-capital.backend-capital.com/api/v1/client-sentiment/${epic}`,
            {
                headers: {
                    'CST': cst,
                    'X-SECURITY-TOKEN': securityToken,
                    'X-CAP-API-KEY': CAPITAL_API_KEY,
                    'Accept': 'application/json'
                }
            }
        );
        const data = response.data;
        return {
            buyers: data.longPositionPercentage,
            sellers: data.shortPositionPercentage,
            updated: data.lastUpdated || data.timestamp || new Date().toISOString()
        };
    } catch (e) {
        console.error('❌ Sentiment fetch error:', e.response?.data || e.message);
        return null;
    }
}

// Capital.com session
async function createSession() {
    try {
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
        console.log(`🔑 Session Success: CST=${cst}`);

        goldEpic = await fetchGoldEpic(cst, securityToken);
        if (!goldEpic) throw new Error("No gold epic found!");
        console.log('💰 GOLD EPIC:', goldEpic);
    } catch (e) {
        console.error('❌ Session error:', e.response ? e.response.data : e.message);
        throw e;
    }
}

// Market epic fetch
async function fetchGoldEpic(cst, securityToken) {
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
                const market = res.data.markets.find(m => m.epic && m.epic.startsWith('CS.D.GC.'));
                if (market) return market.epic;
            }
        } catch (e) {}
    }
    return 'CS.D.GC.MONTH1'; // fallback to known valid GOLD EPIC
}

// ⭐ Capital.com streaming WebSocket
function connectCapitalWebSocket() {
    if (!cst || !securityToken || !goldEpic) return;
    const ws = new WebSocket('wss://api-streaming-capital.backend-capital.com/connect');

    ws.on('open', () => {
        console.log('🟢 Connected to Capital.com streaming');
        ws.send(JSON.stringify({
            destination: 'marketData.subscribe',
            correlationId: '1',
            cst,
            securityToken,
            payload: { epics: [goldEpic] }
        }));
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.destination === 'quote' && data.payload && data.payload.epic === goldEpic) {
                const payload = data.payload;
                const bid = payload.bid || 0;
                const spread = 1.0;
                const ask = parseFloat((bid + spread).toFixed(2));
                updateSessionHighLow(bid, ask);
                const high = payload.high || sessionHigh || ask;
                const low = payload.low || sessionLow || bid;
                lastRate = { // ⭐ cache latest rate
                    bid, ask, high, low, unit: 'ounce', updated: new Date().toISOString()
                };
                const result = {
                    type: 'rate',
                    ...lastRate
                };
                console.log('💸 Rate:', result);
                broadcastToClients(result);
            }
        } catch (e) {
            console.error('Parse error:', e);
        }
    });

    ws.on('error', err => {
        console.error('❌ Capital streaming error:', err.message);
        ws.close();
    });

    ws.on('close', () => {
        console.log('🛑 Streaming closed. Reconnecting...');
        setTimeout(connectCapitalWebSocket, 1500);
    });
}

// Error handling
process.on('uncaughtException', err => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', reason => console.error('Unhandled Rejection:', reason));

// ⭐ Server bootstrap
(async () => {
    await createSession();
    connectCapitalWebSocket();
    setInterval(async () => await createSession(), 8 * 60 * 1000);
    setInterval(() => broadcastSentimentToClients(), 1 * 60 * 1000);
    broadcastSentimentToClients();
})();
