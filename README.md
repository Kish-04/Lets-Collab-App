# Decentralized Remote Collaborative System with Federated AI (DRCSFA)

A secure, decentralized platform for remote collaboration, proctoring, and assistance. Features WebRTC video/screen sharing, Electron-based remote desktop control, local and federated anti-cheat monitoring, audited session chat, and immutable blockchain audit anchoring.

## Architecture
- **Frontend:** Next.js (React), TailwindCSS, Radix UI Primitives
- **Backend:** Node.js, Express, Socket.IO
- **Desktop Client:** Electron, RobotJS (for native OS input)
- **Database:** MongoDB (with local JSON fallback)
- **AI Engine:** TensorFlow.js, MediaPipe Vision, federated client update aggregation
- **Blockchain:** Hardhat (Local Ethereum node for anchoring audit logs)

## Prerequisites
- Node.js (v22 recommended)
- Docker & Docker Compose (for the full local stack)
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

### 3. Start the Full Local Stack
Use Docker Compose to start MongoDB, Hardhat, MinIO, the backend, and the frontend:
```bash
docker-compose up -d
```
The Web UI will be available at [http://localhost:3000](http://localhost:3000).

### 4. Manual Development Mode
If you do not use Docker, ensure MongoDB is running or let the backend fall back to mock storage. Then open two terminal windows:

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
2. Deploy the exported static frontend from `out/` or use the existing Vercel configuration.
3. Deploy the backend separately and set `NEXT_PUBLIC_BACKEND_URL` to that backend URL.
4. Ensure the backend process has production `JWT_SECRET`, MongoDB, object storage, email, blockchain, and TURN settings.
5. HTTPS and a proper TURN server are strictly required for production WebRTC.

## WebRTC Configuration
By default, the application uses public Google STUN servers. For production reliability across restrictive NATs/Firewalls, provide your own TURN server credentials (e.g., Twilio or Coturn) in the `.env` file.
