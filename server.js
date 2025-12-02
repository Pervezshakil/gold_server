// server.js (Render side: gold-server-eklw)
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
  res.send('✅ Gold Server Running (MT5 via VPS → Render)');
});

// Render এখানে নিজে PORT দেয় (env.PORT), না থাকলে 3000
const HTTP_PORT = process.env.PORT || 3000;

const server = app.listen(HTTP_PORT, () => {
  console.log(`🌐 HTTP+WebSocket server running on port ${HTTP_PORT}`);
});

const wss = new WebSocket.Server({ server });

// ====== state ======
let clients = [];
let sessionHigh = null;
let sessionLow = null;
let lastRate = null;
const LAST_RATE_FILE = './lastrate.json';

// ====== load/save lastRate ======
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

function saveLastRate(rate) {
  lastRate = rate;
  try {
    fs.writeFileSync(LAST_RATE_FILE, JSON.stringify(rate));
  } catch (e) {
    console.error('[SERVER] lastrate.json write error:', e.message);
  }
}

loadLastRate();

function updateSessionHighLow(bid, ask) {
  if (sessionHigh === null || ask > sessionHigh) sessionHigh = ask;
  if (sessionLow === null || bid < sessionLow) sessionLow = bid;
}

// ====== format & broadcast ======
function formatRateForBroadcast(obj) {
  const pick = (v) => {
    if (v === undefined || v === null) return null;
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return n.toFixed(2); // সবসময় ২ decimal string
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
    } catch (_) {}
  });
}

// প্রতি ১ সেকেন্ডে lastRate সবাইকে পাঠাই (client connect থাকলে smooth update)
setInterval(() => {
  if (lastRate) {
    broadcastToClients({ type: 'rate', ...lastRate });
  }
}, 1000);

// ====== WebSocket handlers ======
wss.on('connection', (ws) => {
  clients.push(ws);
  console.log('[WS] New client connected. Total:', clients.length);

  // নতুন ক্লায়েন্টকে welcome + instant lastRate পাঠাই
  ws.send(
    JSON.stringify({
      type: 'connected',
      message: '✅ Connected to Gold WebSocket (Render MT5 bridge)',
      time: new Date().toISOString(),
    })
  );

  if (lastRate) {
    try {
      ws.send(
        JSON.stringify(formatRateForBroadcast({ type: 'rate', ...lastRate }))
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
      '[WS] Client disconnected. Total:',
      clients.length
    );
  });

  ws.on('error', (err) => {
    clients = clients.filter((c) => c !== ws);
    console.error('[WS] Client error:', err.message);
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      // 👉 VPS / Python bridge থেকে আসবে: { type: 'tick', symbol, bid, ask, time, ... }
      if (data && data.type === 'tick') {
        const bid = Number(data.bid);
        const ask = Number(data.ask) + 0.40;

        if (!isNaN(bid) && !isNaN(ask)) {
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
      }
    } catch (e) {
      console.error('[WS] Error parsing message:', e);
    }
  });
});

// Node.js global error handlers
process.on('uncaughtException', (err) =>
  console.error('[NODE][UNCAUGHT EXCEPTION]', err)
);
process.on('unhandledRejection', (reason) =>
  console.error('[NODE][UNHANDLED REJECTION]', reason)
);
