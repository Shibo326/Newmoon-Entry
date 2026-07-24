# NightScore — Challenge Progress Tracker

## Revision Summary (All Levels)

### Level 1 - New Moon
- **Revision**: "No .compact file found in contracts/"
- **Reality**: `contracts/nightscore.compact` IS present. `managed/` has compiled output.
- **Action**: Objection submitted. Contract is clearly at `contracts/nightscore.compact` with `managed/` compiled output.

### Level 2 - Waxing Crescent
- **Revision**: "deploy on preprod or preview"
- **Action**: Created `deploy/` directory with full deployment scripts. Need to fund wallet and run deployment.

### Level 3 - First Quarter
- **Revision**: "deploy on preprod or preview"
- **Action**: Same as Level 2 — once deployed, both levels are unblocked.

---

## Level 4 - Waxing Gibbous (READY — DEPLOY NEEDED)

### Requirements:
- [x] Working MVP (frontend + backend agents + contract)
- [x] Documentation (README + setup + usage)
- [x] CI/CD pipeline (GitHub Actions)
- [x] Product X profile (@Secret_324)
- [x] Minimum 15 meaningful commits (22+)
- [ ] **Live on Preprod with verifiable contract address** ← BLOCKED

### What's Ready:
- Deploy scripts at `deploy/` — single command deployment
- Frontend on Vercel: https://newmoon-entry-projects.vercel.app
- 669 tests passing
- GitHub Actions CI passing
- Full README with architecture docs

---

## Level 5 - Full Moon (PLAN)

### Requirements:
- [ ] Same MVP from Level 4 deployed on Preprod
- [ ] 50 Preprod users (verifiable wallet addresses)
- [ ] Feedback loop documented
- [ ] Updated documentation
- [ ] Minimum 20 meaningful commits (have 22+)

### Strategy for 50 Users:
1. Post on Midnight Discord community channel
2. Share on X (@Secret_324) with clear onboarding instructions
3. Create a simple "Try NightScore" guide
4. Ask hackathon participants to try it
5. Engage in Midnight community channels

### Feedback Loop:
- In-app feedback form already built (FeedbackForm component)
- FEEDBACK.md template ready for documenting responses
- Plan: Google Form + in-app form + X DMs

---

## Level 6 - Supermoon (PLAN) — $150 prize

### Same requirements as Level 5.
Difference is quality and iteration depth:
- More polished UI based on user feedback
- Better documentation
- More evidence of iteration
- Stronger demo video

---

## DEPLOYMENT INSTRUCTIONS (Two Options)

### Option A: Enable Virtualization (Recommended — 5 min)

1. Restart your PC
2. Enter BIOS (usually F2, F12, Del, or Esc at boot)
3. Find "Virtualization" or "Intel VT-x" or "AMD-V" → Enable it
4. Save and exit BIOS
5. Docker Desktop will now start properly
6. Run:
```bash
cd deploy
npm install
docker compose up -d          # starts proof server
npm run deploy -- --network preprod
```
7. When it prints your wallet address, open the faucet in browser:
   `https://midnight-tmnight-preprod.nethermind.dev`
8. Paste address, request tNIGHT
9. Script detects funding and deploys automatically

### Option B: Deploy via GitHub Actions (No local Docker needed)

1. Push the `deploy/` directory to GitHub
2. Go to repo Settings → Secrets → add `MIDNIGHT_WALLET_SEED`:
   Use seed from `mn-demo/.midnight-state.json` → `wallets.preprod.seed`
3. The wallet needs to be funded first. Run locally to get the address:
```bash
cd deploy
npm install
set MIDNIGHT_WALLET_SEED=0dc3e67beb326f86b76abf0d768c3e9a2e01d8b5edc18849c43eb3070d729a23
npx tsx src/network.ts
```
4. Fund the address via faucet (browser)
5. Go to GitHub → Actions → "Deploy to Preprod" → Run workflow
6. Download the artifact with the contract address

### After Deployment (Both Options):
1. Copy the contract address
2. Update README.md Preprod row with the address
3. Update frontend config if needed
4. Record demo video
5. Push to main
6. Submit Levels 2, 3, 4, 5, 6

---

## Key Files

| File | Purpose |
|------|---------|
| `contracts/nightscore.compact` | Compact smart contract source |
| `managed/` | Compiled contract (keys, zkir, JS) |
| `deploy/` | Deployment scripts for preprod/preview |
| `src/` | Adaptive agent architecture (9 agents) |
| `frontend/` | React frontend with Lace wallet integration |
| `.github/workflows/ci.yml` | CI/CD pipeline |
| `README.md` | Full project documentation |
| `FEEDBACK.md` | User feedback log |
| `PROPOSAL.md` | Product proposal |
