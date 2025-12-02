// server.js
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const fs = require('fs');

// =========================
// MT5 VPS WebSocket config
// =========================
const MT5_WS_URL = process.env.MT5_WS_URL || 'ws://62.72.43.224:10000';

// =========================
// State variables
// =========================
let sessionHigh = null;
let sessionLow = null;
let clients = [];
let lastRate = null; // Cache last broadcast rate

const LAST_RATE_FILE = './lastrate.json';

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

loadLastRate();

// =========================
// Express + WebSocket server
// =========================
const app = express();
app.use(cors());

app.get('/', (req, res) => res.send('✅ Gold Server Running (MT5 VPS)'));

const server = app.listen(process.env.PORT || 3000, () => {
  console.log(
    `🌐 HTTP+WebSocket server running on port ${process.env.PORT || 3000}`
  );
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  clients.push(ws);

  ws.send(
    JSON.stringify({
      type: 'connected',
      message: '✅ Connected to Gold WebSocket Server (Render)',
      time: new Date().toISOString(),
    })
  );

  // Always send lastRate (from file or stream) — format before sending
  if (lastRate) {
    try {
      ws.send(
        JSON.stringify(
          formatRateForBroadcast({ type: 'rate', ...lastRate })
        )
      );
    } catch (e) {
      console.error('[CONNECTION][SEND LASTRATE ERROR]', e && e.message);
    }
  }

  if (sessionHigh !== null && sessionLow !== null) {
    ws.send(
      JSON.stringify({
        type: 'sessionStats',
        high: sessionHigh,
        low: sessionLow,
        time: new Date().toISOString(),
      })
    );
  }

  ws.on('close', () => {
    clients = clients.filter((c) => c !== ws);
    console.log(
      `[CLIENT] WebSocket client disconnected. Total: ${clients.length}`
    );
  });

  ws.on('error', (err) => {
    clients = clients.filter((c) => c !== ws);
    console.error(`[CLIENT] WebSocket client error: ${err.message}`);
  });
});

// =========================
// Format + broadcast helpers
// =========================
function formatRateForBroadcast(obj) {
  const pick = (v) => {
    if (v === undefined || v === null) return null;
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return n.toFixed(2); // "2350.00"
  };

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
    const isRateLike =
      data && (data.type === 'rate' || data.bid !== undefined || data.ask !== undefined);
    if (isRateLike && typeof data === 'object' && !Array.isArray(data)) {
      out = formatRateForBroadcast(data);
    }
  } catch (e) {
    console.error('[BROADCAST][FORMAT ERROR]', e && e.message);
    out = data;
  }

  const json = typeof out === 'string' ? out : JSON.stringify(out);
  clients = clients.filter((ws) => ws.readyState === ws.OPEN);
  clients.forEach((ws) => {
    try {
      ws.send(json);
    } catch (err) {
      // per-client error ignore
    }
  });
}

// প্রতি ১ সেকেন্ডে ক্যাশ করা lastRate সবাইকে পাঠাই
setInterval(() => {
  if (lastRate) {
    broadcastToClients({ type: 'rate', ...lastRate });
  }
}, 1000);

function updateSessionHighLow(bid, ask) {
  if (sessionHigh === null || ask > sessionHigh) sessionHigh = ask;
  if (sessionLow === null || bid < sessionLow) sessionLow = bid;
}

// =========================
// MT5 VPS WebSocket client
// =========================
function connectMt5WebSocket() {
  console.log('[MT5-WS] Connecting to MT5 VPS stream:', MT5_WS_URL);
  const ws = new WebSocket(MT5_WS_URL);

  ws.on('open', () => {
    console.log('[MT5-WS] 🟢 Connected to MT5 VPS WebSocket');
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Expecting: { type: 'tick', symbol, bid, ask, ... }
      if (data && data.type === 'tick') {
        const bid = Number(data.bid);
        const ask = Number(data.ask);
        if (isNaN(bid) || isNaN(ask)) {
          return;
        }

        updateSessionHighLow(bid, ask);

        const newRate = {
          bid,
          ask,
          high: sessionHigh,
          low: sessionLow,
          unit: 'ounce',
          updated: new Date().toISOString(),
        };

        saveLastRate(newRate);
        broadcastToClients({ type: 'rate', ...newRate });
      }
    } catch (e) {
      console.error('[MT5-WS][MESSAGE][PARSE ERROR]', e);
    }
  });

  ws.on('error', (err) => {
    console.error('[MT5-WS][ERROR]', err.message || err);
  });

  ws.on('close', (code, reason) => {
    console.warn(
      `[MT5-WS][CLOSE] Streaming closed. Code: ${code}, Reason: ${reason}`
    );
    setTimeout(connectMt5WebSocket, 3000); // auto reconnect
  });
}

// Node.js error handling
process.on('uncaughtException', (err) =>
  console.error('[NODE][UNCAUGHT EXCEPTION]', err)
);
process.on('unhandledRejection', (reason) =>
  console.error('[NODE][UNHANDLED REJECTION]', reason)
);

// Bootstrap: শুধু MT5 VPS WebSocket এ connect করব
connectMt5WebSocket();
