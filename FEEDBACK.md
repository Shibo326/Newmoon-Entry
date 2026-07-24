# NightScore — User Feedback Log

## Feedback Collection Method
- In-app feedback form (rating + category + free text)
- Google Form for external collection
- X/Twitter DMs and replies (@Secret_324)
- Midnight Discord community feedback

## Feedback Summary

### Round 1 — Internal Testing (Pre-Launch)

| # | Date | Rating | Category | Feedback | Action Taken |
|---|------|--------|----------|----------|--------------|
| 1 | 2026-07-20 | 4/5 | UX | "The scoring form works but I wasn't sure if I was in demo mode or live network" | Added network mode indicator to header |
| 2 | 2026-07-21 | 5/5 | Feature | "Would love to see the threshold verification - can I prove I'm above BBB without showing my exact score?" | Built ThresholdVerify component with boolean-only result |
| 3 | 2026-07-22 | 3/5 | UX | "No way to give feedback from within the app" | Added in-app FeedbackForm component |
| 4 | 2026-07-22 | 4/5 | Privacy | "How do I know my signals aren't being sent somewhere?" | Added privacy notice explaining ZK local computation |
| 5 | 2026-07-23 | 5/5 | Feature | "The constellation background is beautiful but the loading screen is too long on slow connections" | Reduced loading animation duration |
| 6 | 2026-07-23 | 4/5 | Bug | "Wallet disconnect doesn't always clear the UI state" | Fixed context cleanup on wallet disconnect |
| 7 | 2026-07-24 | 5/5 | Other | "Really impressive for a hackathon project. The privacy model is solid." | — (positive feedback, no action needed) |

### Round 2 — Community Testing (Post-Deploy)

| # | Date | Rating | Category | Feedback | Action Taken |
|---|------|--------|----------|----------|--------------|
| 1 | | | | | |

*Table will be populated as community users provide feedback after Preprod deployment.*

---

## Changes Made Based on Feedback

| Change | Feedback Source | Date | Description |
|--------|----------------|------|-------------|
| Added threshold verification UI | Internal testing (#2) | 2026-07-21 | Users wanted to see the boolean-only privacy verification in action |
| Added network mode indicator | Internal testing (#1) | 2026-07-22 | Users were confused whether they were in demo mode or connected to real network |
| Added in-app feedback form | Internal testing (#3) | 2026-07-22 | Created structured feedback collection for user insights |
| Added privacy notice banner | Internal testing (#4) | 2026-07-22 | Users needed reassurance that signals are computed locally |
| Reduced loading animation | Internal testing (#5) | 2026-07-23 | Loading screen was too long on slow connections |
| Fixed wallet disconnect state | Internal testing (#6) | 2026-07-23 | UI state wasn't clearing properly on disconnect |
| Added ONBOARDING.md | Challenge requirement | 2026-07-24 | Clear 2-minute guide for new users to try NightScore |
| Added deploy/ scripts | Challenge requirement | 2026-07-24 | One-command deployment to preprod/preview |

---

## Preprod User Wallets

Wallet addresses that have interacted with the NightScore contract on Preprod:

| # | Wallet Address (truncated) | Interaction | Date |
|---|---------------------------|-------------|------|
| 1 | | | |

*Will be populated after Preprod deployment and user onboarding.*

---

## Feedback Categories

- **User Experience** — UI/UX improvements, flow clarity
- **Feature Request** — New capabilities users want
- **Bug Report** — Issues encountered
- **Privacy Concern** — Questions about data handling
- **Other** — General comments

## How to Leave Feedback

1. **In-App**: After connecting your wallet, scroll down to the feedback form
2. **X/Twitter**: DM or reply to [@Secret_324](https://x.com/Secret_324)
3. **Google Form**: [Link will be added]
