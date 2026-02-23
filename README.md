# SocketStream

A real-time, peer-to-peer video and text chat platform featuring instantaneous matchmaking and low-latency AI conversational agents. 

SocketStream utilizes a dual-plane networking architecture: a centralized TCP control plane for signaling and matchmaking, and a decentralized UDP user plane for video and audio streaming.

## Features
* **P2P Video & Chat:** Direct WebRTC connections for zero-server media streaming.
* **AI Agents:** Integrated with Google's Gemini 2.5 Flash for sub-second conversational AI responses.
* **Custom Matchmaking:** Interest-based array intersection routing via Socket.IO.
* **State Machine UI:** Clean, hardware-safe React flow with graceful peer disconnection handling.

## Tech Stack
* **Frontend:** React, TypeScript, Tailwind CSS v4
* **Backend:** Node.js, Express, Socket.IO
* **Networking:** WebRTC (`simple-peer`), Google STUN servers
* **AI:** `@google/genai` SDK 

## Local Installation

To run this project locally, you will need two separate terminal windows (one for the client, one for the server).

### 1. Server Setup
Open your first terminal and navigate to the server directory:
```
cd server
npm install
```
Add your own Gemini API key to an .env file in server root directory
```
GEMINI_API_KEY=[Enter Your Key]
```
In the server directory, start up the node server (port 3001)
```
npm run dev
```
### 2. Client Setup
Open your second terminal and navigate to the client directory:
```
cd client
npm install
```
Start the Vite server (port 5173)
```
npm run dev
```

