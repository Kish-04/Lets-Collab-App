# Decentralized Remote Collaborative System with Local AI Proctoring (DRCSLA)

A secure, decentralized platform for remote collaboration, proctoring, and assistance. Features WebRTC video/screen sharing, Electron-based remote desktop control, local AI-driven anti-cheat monitoring, and an immutable blockchain audit log.

## Architecture
- **Frontend:** Next.js (React), TailwindCSS, Radix UI Primitives
- **Backend:** Node.js, Express, Socket.IO
- **Desktop Client:** Electron, RobotJS (for native OS input)
- **Database:** MongoDB (with local JSON fallback)
- **AI Engine:** TensorFlow.js, MediaPipe Vision (Local Client-side analysis)
- **Blockchain:** Hardhat (Local Ethereum node for anchoring audit logs)

## Prerequisites
- Node.js (v22 recommended)
- Docker & Docker Compose (for MongoDB)
- Windows OS (for the Electron Host App to execute `robotjs` inputs correctly)

## Quick Start Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy the unified example configuration to your local `.env`:
```bash
cp .env.example .env
```
Ensure you generate a strong `JWT_SECRET` (at least 32 characters) for production use.

### 3. Start MongoDB
Use Docker to spin up a local instance:
```bash
docker-compose up -d
```
*(If you don't use Docker, ensure a local MongoDB instance is running on port 27017, or update `MONGO_URI` in `.env`)*

### 4. Start the Application Servers
Open two terminal windows:

**Terminal 1 (Next.js Frontend):**
```bash
npm run dev
```

**Terminal 2 (Express + Socket.IO Backend):**
```bash
npm run server
```

The Web UI will be available at [http://localhost:3000](http://localhost:3000).

### 5. Launch the Electron Desktop Client
For users who need to share their screen and grant remote control access, they must use the Electron app:
```bash
npm run electron:dev
```

## Production Deployment
1. Build the Next.js application: `npm run build`
2. Start the production frontend: `npm run start`
3. Ensure the backend (`npm run server`) is managed by PM2 or a similar process manager.
4. Ensure `NODE_ENV=production` is set in your `.env`.
5. HTTPS and a proper TURN server are strictly required for production WebRTC.

## WebRTC Configuration
By default, the application uses public Google STUN servers. For production reliability across restrictive NATs/Firewalls, provide your own TURN server credentials (e.g., Twilio or Coturn) in the `.env` file.
