const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const PORT = process.env.PORT || 10000;

const app = express();
app.use(cors());

app.get('/', (req, res) => {
  res.send('✅ VTindex-MT5 Gold Server Running');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let clients = [];
let lastRate = null;
const LAST_RATE_FILE = './lastrate.json';

// ---- ফাইল থেকে lastRate লোড (server restart এ backup) ----
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

// ---- number format helper (বেছে ব্যবহার করলে ২ decimal string) ----
function fmt2(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return Number(n.toFixed(2)); // number আকারেই রাখলাম, চাইলে stringও করতে পারো
}

// ---- broadcast সবার কাছে ----
function broadcastToClients(data) {
  const json = JSON.stringify(data);
  clients = clients.filter((ws) => ws.readyState === WebSocket.OPEN);
  clients.forEach((ws) => {
    try {
      ws.send(json);
    } catch (err) {
      // ignore
    }
  });
}

// প্রতি ১ সেকেন্ডে lastRate আবার ক্লায়েন্টদের পাঠাতে চাইলে:
setInterval(() => {
  if (lastRate) {
    broadcastToClients({ type: 'rate', ...lastRate });
  }
}, 1000);

// ---- WEBSOCKET LOGIC ----
wss.on('connection', (ws) => {
  clients.push(ws);
  console.log('[WS] New client connected. Total:', clients.length);

  ws.send(
    JSON.stringify({
      type: 'connected',
      message: '✅ Connected to VTindex-MT5 Gold WebSocket Server',
      time: new Date().toISOString(),
    })
  );

  // নতুন ক্লায়েন্ট join করলে latest rate পাঠাই
  if (lastRate) {
    ws.send(JSON.stringify({ type: 'rate', ...lastRate }));
  }

  ws.on('close', () => {
    clients = clients.filter((c) => c !== ws);
    console.log('[WS] Client disconnected. Total:', clients.length);
  });

  ws.on('error', (err) => {
    clients = clients.filter((c) => c !== ws);
    console.error('[WS] Client error:', err.message);
  });

  // এখানেই MT5 bridge যা পাঠাবে তা ধরা হবে
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      // Python bridge থেকে আসা tick: { type: 'tick', bid, ask, ... }
      if (data && data.type === 'tick') {
        const bid = fmt2(data.bid);
        const askRaw = fmt2(data.ask);

        // ✅ এখানে শুধু +0.40
        const ask = askRaw !== null ? Number((askRaw + 0.4).toFixed(2)) : null;

        const out = {
          type: 'rate',
          source: 'mt5',
          symbol: data.symbol,
          bid,
          ask,
          time: data.time,
          time_msc: data.time_msc,
          volume: data.volume,
          updated: new Date().toISOString(),
        };

        console.log(
          `[RATE] ${out.symbol} bid=${out.bid} ask=${out.ask} (${out.source})`
        );

        // lastRate save + broadcast
        saveLastRate(out);
        broadcastToClients(out);
      }
    } catch (e) {
      console.error('[WS] Error parsing incoming message:', e);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🌐 HTTP+WebSocket server running on port ${PORT}`);
});
