# Production deployment runbook

The code for all of this is in the repository. These steps need your own accounts, servers and
funds, so they have to be run by you. Do them in order; each section ends with a check.

## 0. Secrets (backend)

Generate long random values once and store them in your secret manager / hosting dashboard:

```bash
node -e "for (const k of ['JWT_SECRET','AUDIT_HASH_SECRET','UPLOAD_URL_SECRET','TURN_SECRET']) console.log(k + '=' + require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable | Purpose | Notes |
|---|---|---|
| `JWT_SECRET` | Session tokens | Rotating it logs everyone out. |
| `AUDIT_HASH_SECRET` | HMAC of emails written on-chain | **Never change it after go-live** — older entries could no longer be matched to users. |
| `UPLOAD_URL_SECRET` | Signs evidence/recording links | Optional (falls back to `JWT_SECRET`). Rotating it only invalidates links for up to an hour. |
| `TURN_SECRET` | coturn `static-auth-secret` | Same value on the backend and every TURN node. |
| `CORS_ORIGINS` | Allowed web origins | e.g. `https://app.example.com` |
| `MONGO_URI` | Database | Without it the server falls back to a local JSON store (dev only). |
| `FL_MIN_PARTICIPANTS` | Federated rounds | Keep at **3 or more** for privacy. |

Check: `cd server && npm run check && npm test` passes with the production `.env`.

## 1. TURN relays (one per region)

1. Create a small Linux VM in each region you serve (for example EU, US, Asia) with a public IP and
   a DNS name such as `turn-eu.example.com`.
2. Open firewall ports: UDP+TCP **3478**, TCP **5349** (TLS), UDP **49160-49200** (relay range from
   `deploy/turn/turnserver.conf`).
3. Put TLS certificates on the VM (e.g. Let's Encrypt) and uncomment `cert=` / `pkey=` in
   `deploy/turn/turnserver.conf`, mounting the certificate folder into the container.
4. On each VM, from a checkout of this repo:
   ```bash
   TURN_SECRET=<same secret as backend> docker compose --profile turn up -d coturn
   ```
5. On the backend set every node:
   ```
   TURN_URLS=turn:turn-eu.example.com:3478?transport=udp,turns:turn-eu.example.com:5349?transport=tcp,turn:turn-us.example.com:3478?transport=udp,turns:turn-us.example.com:5349?transport=tcp
   TURN_SECRET=<secret>
   ```
   Browsers try all listed relays and keep the fastest working path.

Check: fetch `GET /api/turn/credentials`, paste one entry's URL/username/credential into
<https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/> and confirm `relay`
candidates appear for every region. Optionally set `NEXT_PUBLIC_FORCE_TURN=true` on a staging
frontend to prove calls work through relays only.

## 2. Audit ledger on Polygon

Needs a wallet funded with POL. Use a **dedicated deployer key**, never a personal wallet.

1. Build and test the contract:
   ```bash
   cd server && npm run compile:contract && npm run test:contracts && npm run test:chain
   ```
2. **Rehearse on Amoy (testnet):** get test POL from a faucet, then in `server/.env`:
   ```
   DEPLOYER_PRIVATE_KEY=<deployer key>
   AMOY_RPC_URL=<RPC URL from your provider, e.g. Alchemy/Infura/QuickNode>
   AUDIT_WRITER_ADDRESS=<address of the backend's CHAIN_PRIVATE_KEY wallet, if different>
   ```
   ```bash
   npm run deploy:amoy
   ```
   Point a staging backend at it (`CHAIN_RPC_URL`, `CHAIN_PRIVATE_KEY`, `CONTRACT_ADDRESS`,
   `CONTRACT_DEPLOY_BLOCK` from the deploy output), run a session, open the admin history page and
   press **Verify integrity**: every entry should be `verified`.
3. **Mainnet:** fund the deployer and the backend writer wallet (each audit event is one
   transaction; budget for your expected sessions × events), set `POLYGON_RPC_URL`, then:
   ```bash
   npm run deploy:polygon
   npx hardhat verify --network polygon <contract address>   # needs ETHERSCAN_API_KEY
   ```
4. Production backend env:
   ```
   CHAIN_RPC_URL=<Polygon RPC>
   CHAIN_PRIVATE_KEY=<writer wallet key>
   CONTRACT_ADDRESS=<deployed address>
   CONTRACT_DEPLOY_BLOCK=<deploy block>
   ```
   Frontend: `NEXT_PUBLIC_CHAIN_EXPLORER_TX_URL=https://polygonscan.com/tx/`
5. Move contract ownership to a safer key (hardware wallet or multisig) — the owner can add or
   remove writers:
   ```bash
   npx hardhat console --network polygon
   > const t = await ethers.getContractAt('IRCPTracker', '<address>')
   > await t.transferOwnership('<multisig address>')
   ```

Check: the server log shows `Connecting to existing IRCPTracker Contract ... on Polygon PoS`, and a
new session's events appear on Polygonscan. History recorded on Sepolia stays on Sepolia.

## 3. Mobile app (EAS development build)

```bash
cd lets-collab-mobile
npm ci
npx eas login
npx eas build --profile development --platform android   # and/or ios
```

Install the build on a device, then `npx expo start --dev-client`. Joining sessions, WebRTC and
on-device proctoring only work in this native build (not Expo Go). If the iOS build fails to link
MediaPipe, enable static frameworks for the pod (see `lets-collab-mobile/README.md`).

Check: join a supervised room from the phone, confirm video both ways, answer an exam question,
send a chat message (badge shows `E2E ...`), and cover the camera to see a proctoring alert.

## 4. Before every release

```bash
npm run test:all
```

CI (`.github/workflows/ci.yml`) runs the same checks on every push and pull request.
