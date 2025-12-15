// ===============================
// FULL FIXED server.js (Render)
// ===============================

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

// ---- WebSocket with path /ws (Render NEEDS PATH) ----
const wss = new WebSocket.Server({ server });


// ---- Heartbeats ----
function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  console.log("[WS] Client connected");

  ws.send(
    JSON.stringify({
      type: "connected",
      message: "WS OK",
      time: new Date().toISOString(),
    })
  );

  // Send last rate on join
  if (lastRate) {
    ws.send(JSON.stringify({ type: "rate", ...lastRate }));
  }

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
  });

  ws.on("error", (err) => {
    console.log("[WS] Error:", err.message);
  });

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === "tick") {
        const bid = fmt2(data.bid);
        const ask = bid != null ? Number((bid + 1).toFixed(2)) : null;


        const out = {
          type: "rate",
          symbol: data.symbol,
          bid,
          ask,
          high: (data.high !=null ? fmt2(data.high) : null),
          low: (data.low !=null ? fmt2(data.low) : null),
          time: data.time,
          time_msc: data.time_msc,
          volume: data.volume,
          updated: new Date().toISOString(),
        };

        saveLastRate(out);
        broadcastToClients(out);

        console.log(`[RATE] ${out.symbol} | bid=${bid} ask=${ask} high=${out.high} low=${out.low}`);
      }
    } catch (e) {
      console.log("[WS] Parse error:", e.message);
    }
  });
});

// ---- Server-side ping (Render required) ----
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log("[WS] Terminating dead socket");
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

// -----------------------
let clients = [];
let lastRate = null;
const LAST_RATE_FILE = "./lastrate.json";

function loadLastRate() {
  if (fs.existsSync(LAST_RATE_FILE)) {
    try {
      lastRate = JSON.parse(fs.readFileSync(LAST_RATE_FILE, "utf8"));
      console.log("[SERVER] Loaded:", lastRate);
    } catch (e) {
      lastRate = null;
    }
  }
}
loadLastRate();

function saveLastRate(rate) {
  lastRate = rate;
  fs.writeFileSync(LAST_RATE_FILE, JSON.stringify(rate));
}

function fmt2(n) {
  if (n == null || isNaN(Number(n))) return null;
  return Number(Number(n).toFixed(2));
}

function broadcastToClients(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

server.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
