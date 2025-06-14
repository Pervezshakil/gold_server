
# 🟡 Gold Rate + Market Sentiment Server (Capital.com API)

This Node.js server streams live gold rate and market sentiment data from [Capital.com](https://capital.com) using WebSocket and REST API. It is designed to serve real-time data to Flutter apps via WebSocket and REST endpoints.

---

## 🚀 Features

- ✅ Real-time gold rate using Capital.com WebSocket API
- ✅ Fixed bid-ask spread (`ask = bid + 1.0`)
- ✅ 15-minute interval Market Sentiment fetch
- ✅ WebSocket broadcast for Flutter apps
- ✅ `/api/sentiment` REST endpoint for client requests
- ✅ Secure CORS for cross-origin frontend support

---

## ⚙️ Technologies

- Node.js
- Express.js
- WebSocket (`ws`)
- Axios
- Capital.com API

---

## 📁 Project Structure

