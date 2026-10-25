# One VM for TURN and the exam media server

Render cannot open the UDP ports that a TURN relay and the exam media server (mediasoup SFU) need, so
both run on one small Linux VM. [`setup.sh`](setup.sh) installs everything on Ubuntu 22.04 or 24.04.

| Mode | What runs on the VM | Backend lives on |
| --- | --- | --- |
| `MODE=turn` | TURN relay (coturn) only | Render (unchanged) |
| `MODE=full` | Backend with the exam media server, TURN, HTTPS (Caddy) | This VM (Render no longer needed) |

The exam media server runs inside the backend process, so the Exam Wall needs `full`. Calls only need `turn`.

## 1. Create the VM

Any provider works: 1 vCPU and 2 GB RAM are enough to start (Hetzner CX22, DigitalOcean, AWS Lightsail,
Oracle Cloud's free tier). Pick Ubuntu 24.04 and add your SSH key.

In the provider's firewall / security group, allow inbound:

| Port | Protocol | For |
| --- | --- | --- |
| 22 | TCP | SSH |
| 3478 | UDP + TCP | TURN |
| 49160-49200 | UDP | TURN relay |
| 80, 443 | TCP | HTTPS (full mode) |
| 40000-40999 | UDP + TCP | Exam media server (full mode) |

## 2. Run the script

```bash
ssh root@<vm-ip>
curl -fsSLO https://raw.githubusercontent.com/Kish-04/Lets-Collab-App/main/deploy/vm/setup.sh
MODE=turn bash setup.sh     # or MODE=full
```

With your own domain, point an A record at the VM and add `DOMAIN=api.example.com`. Otherwise the
script uses `<ip>.sslip.io`, which also gets a real HTTPS certificate.

## 3. Connect it

**turn:** on Render, add `TURN_URLS` (printed by the script) and `TURN_SECRET`
(`sudo cat /etc/letscollab/turn.secret`), then redeploy. The backend hands out short-lived TURN logins.

**full:** copy the Render environment variables into `/etc/letscollab/server.env` (the TURN, SFU and port
lines are already filled in), run `systemctl restart letscollab`, then check `https://<host>/health`.
On Vercel set `NEXT_PUBLIC_BACKEND_URL=https://<host>` and redeploy the web app. Keep Render running
until the VM checks out, then suspend it.

## Updating and logs

Run the script again to pull the latest `main` and restart; secrets and `server.env` are kept.

```bash
journalctl -u letscollab -f    # backend
journalctl -u coturn -f        # TURN
```
