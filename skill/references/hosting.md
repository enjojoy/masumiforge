# Hosting a Masumi Agent

Your agent needs a **public URL** to receive jobs from the Masumi network. Here are the main options.

---

## Hosting Options at a Glance

| Provider | Best For | Cost | Effort |
|----------|----------|------|--------|
| **DigitalOcean Droplet** | Production, full control | ~$6-12/mo | Medium |
| **Railway** | Fast deploy, no DevOps | Free tier / ~$5-20/mo | Low |
| **Render** | Simple deploys, free tier | Free / ~$7/mo | Low |
| **Fly.io** | Edge, containers | Free tier / pay-as-go | Low-Medium |
| **VPS (Hetzner, Vultr)** | Cheapest production | ~$4-6/mo | Medium |

---

## Option 1: DigitalOcean Droplet (Recommended for Production)

The Masumi docs recommend this. Full control, easy to scale.

### Setup

```bash
# 1. Create a droplet (Ubuntu 22.04, $6/mo Basic is enough for a simple agent)
# 2. SSH in
ssh root@your_droplet_ip

# 3. Install Python + dependencies
apt update && apt upgrade -y
apt install -y python3 python3-pip python3-venv git

# 4. Clone your agent repo
git clone https://github.com/yourusername/your-agent.git
cd your-agent

# 5. Create virtualenv and install deps
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 6. Set up your .env
cp .env.example .env
nano .env  # fill in your values

# 7. Run with PM2 (keeps it alive)
npm install -g pm2
pm2 start "python agent.py" --name my-agent
pm2 save
pm2 startup  # follow the printed command to auto-start on reboot
```

### Expose with Nginx (optional but recommended)

```bash
apt install -y nginx

cat > /etc/nginx/sites-available/agent << 'EOF'
server {
    listen 80;
    server_name your_domain_or_ip;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -s /etc/nginx/sites-available/agent /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Your agent is now at `http://your_droplet_ip` — use this as your `api_url` when registering.

### Get HTTPS (free with Certbot)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

---

## Option 2: Railway (Fastest to Deploy)

Railway can deploy from GitHub in minutes with no server management.

### One-click deploy button

Add this to your `README.md` to get a one-click deploy button that pre-fills env vars:

```markdown
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/YOUR_USERNAME/YOUR_REPO)
```

For the button to show env var fields in the Railway UI, include a `railway.toml` in your repo:

### railway.toml (required for one-click deploy with pre-filled env vars)

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "python agent.py"
healthcheckPath = "/availability"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3

[[deploy.envVars]]
name = "PAYMENT_SERVICE_URL"
description = "Your Masumi Payment Service URL"
required = true

[[deploy.envVars]]
name = "PAYMENT_API_KEY"
description = "Payment Service API key from your Masumi admin dashboard"
required = true

[[deploy.envVars]]
name = "SELLER_VKEY"
description = "Your Cardano wallet verification key"
required = true

[[deploy.envVars]]
name = "OPENAI_API_KEY"
description = "Your OpenAI API key"
required = true

[[deploy.envVars]]
name = "NETWORK"
description = "Cardano network: Preprod or Mainnet"
default = "Preprod"

[[deploy.envVars]]
name = "AGENT_IDENTIFIER"
description = "Set after registering on Masumi (leave blank for now)"
required = false
```

### Manual deploy

1. Push your agent to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo
4. Add environment variables in the Railway dashboard (same as your `.env`)
5. Railway auto-detects Python and deploys

### Procfile (alternative to railway.toml)

```
web: python agent.py
```

Make sure your agent binds to `0.0.0.0` and reads `PORT` from env:

```python
import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    agent = MasumiAgent(process_job=process_job)
    agent.run(host="0.0.0.0", port=port)
```

Railway gives you a public URL like `https://your-app.up.railway.app` — use this as your `api_url`.

---

## Option 3: Render

Very similar to Railway. Free tier available but spins down after inactivity (bad for agents that need to be always-on).

Use the **Starter plan ($7/mo)** for always-on agents.

### render.yaml

```yaml
services:
  - type: web
    name: my-masumi-agent
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: python agent.py
    healthCheckPath: /availability
    envVars:
      - key: PAYMENT_SERVICE_URL
        sync: false
      - key: PAYMENT_API_KEY
        sync: false
      - key: AGENT_IDENTIFIER
        sync: false
      - key: SELLER_VKEY
        sync: false
      - key: NETWORK
        value: Preprod
```

---

## Option 4: Fly.io

Good for containerized deployments. Has a generous free tier.

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

EXPOSE 8080
CMD ["python", "agent.py"]
```

```python
# In agent.py — read port from env
port = int(os.environ.get("PORT", 8080))
agent.run(host="0.0.0.0", port=port)
```

### Deploy

```bash
brew install flyctl  # or curl -L https://fly.io/install.sh | sh
fly auth login
fly launch           # auto-detects Dockerfile
fly secrets set PAYMENT_API_KEY=xxx SELLER_VKEY=xxx  # set env vars
fly deploy
```

---

## Option 5: Hetzner / Vultr VPS (Cheapest Production)

Same as DigitalOcean setup above. Hetzner CX11 (~€3.79/mo) or Vultr $2.50 plan are the cheapest options for a always-on agent.

Setup is identical to the DigitalOcean guide.

---

## Testing Your Deployment

Once deployed, test your agent's endpoints:

```bash
# Check availability
curl https://your-agent-url/availability
# Expected: {"status": "available"}

# Check input schema
curl https://your-agent-url/input_schema

# Check demo
curl https://your-agent-url/demo

# Start a test job (no payment required in testing)
curl -X POST https://your-agent-url/start_job \
  -H "Content-Type: application/json" \
  -d '{
    "identifier_from_purchaser": "test-001",
    "input_data": [{"key": "your_key", "value": "test_value"}]
  }'
```

All 3 should return valid JSON before you register on Masumi.

---

## Important: Agent Must Be Always-On

Masumi health-checks your agent periodically. If it's down:
- It gets marked offline in the registry
- It won't appear on Sokosumi
- Existing jobs may time out and trigger refund requests

Use PM2, Railway, or Render's always-on tier — not free-tier Render (which sleeps).

---

## Environment Variables in Production

Never commit `.env` to git. Use your provider's secrets manager:

| Provider | How to set secrets |
|----------|--------------------|
| DigitalOcean | Upload `.env` via SSH, or use App Platform env vars |
| Railway | Dashboard → Variables tab |
| Render | Dashboard → Environment tab |
| Fly.io | `fly secrets set KEY=value` |
