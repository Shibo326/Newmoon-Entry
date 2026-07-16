# NIGHTSCORE — Lovable UI Design Prompt

## Project Overview

Build a modern, dark-themed Web3 dApp called **NIGHTSCORE** — a private on-chain credit scoring system built on the Midnight blockchain. Users connect their Lace wallet, get an AI-powered credit grade (AAA to C), and receive a ZK credential NFT that proves their creditworthiness without revealing financial data.

**Tagline:** "Prove your trustworthiness without showing anything."

**Vibe:** Dark, futuristic, cyberpunk-meets-fintech. Think Aave/Compound's clean DeFi aesthetic + Midnight's purple/dark branding. Professional but edgy.

---

## Brand & Design System

### Colors
- **Primary Background:** #0A0B0F (near-black)
- **Secondary Background:** #13141A (card backgrounds)
- **Accent Primary:** #8B5CF6 (purple — Midnight brand color)
- **Accent Secondary:** #6366F1 (indigo, for hover states)
- **Grade Green:** #22C55E (for AAA, AA, A grades)
- **Grade Yellow:** #EAB308 (for BBB grade)
- **Grade Red:** #EF4444 (for BB, C grades)
- **Text Primary:** #F8FAFC (white-ish)
- **Text Secondary:** #94A3B8 (muted gray)
- **Border:** #1E293B (subtle borders)
- **Glow Effect:** rgba(139, 92, 246, 0.3) (purple glow for active elements)

### Typography
- **Font:** Inter (headers) + JetBrains Mono (wallet addresses, grades)
- **Sizes:** Hero: 48px, H1: 32px, H2: 24px, Body: 16px, Small: 14px

### Effects
- Glassmorphism on cards (backdrop-blur, subtle border)
- Purple glow on primary CTAs
- Subtle gradient meshes in background
- Smooth transitions (300ms ease)
- Particle/constellation background animation (subtle)

---

## Pages & Components

### Page 1: Landing Page (Unauthenticated)

**Layout:** Full-height hero section → Features section → How It Works → Footer

**Hero Section:**
- Large heading: "Your Credit Score, Zero Knowledge"
- Subheading: "Prove your DeFi creditworthiness to any lending protocol — without revealing your financial history."
- Primary CTA button: "Connect Wallet" (purple, glowing)
- Secondary CTA: "Verify a Wallet" (outlined, links to verification portal)
- Background: Abstract dark mesh gradient with floating particles
- Small badge above heading: "🌙 Built on Midnight" (pill shape, subtle purple border)

**Features Section (3 cards in a row):**
1. 🔒 **Private by Default** — "Your wallet data never touches the public ledger. Zero-knowledge proofs ensure complete privacy."
2. 🤖 **AI-Powered Scoring** — "Advanced AI analyzes your on-chain activity to compute a fair, explainable credit grade."
3. ✅ **Verifiable Anywhere** — "Lending protocols query your creditworthiness with a simple YES/NO — nothing more."

**How It Works Section (4 steps, horizontal timeline):**
1. Connect Wallet → 2. AI Analysis → 3. ZK Credential Minted → 4. Verify Anywhere
Each step has an icon, title, and one-line description.

**Footer:**
- Logo + tagline
- Links: Documentation, GitHub, Twitter/X
- "Built for Midnight Monthly Moonshots"

---

### Page 2: Dashboard (Authenticated)

**Layout:** Top navbar + main content grid

**Navbar:**
- Left: NIGHTSCORE logo (moon icon + text)
- Center: Navigation tabs (Dashboard, Verification Portal)
- Right: Connected wallet address (truncated: "0xAb3F...9c2D") + Disconnect button (small text link)

**Main Content (2-column layout on desktop):**

**Left Column (60%):**

**Credit Score Card (large, prominent):**
- If no score: Empty state with "Request Your First Score" button and illustration
- If scored: 
  - Large grade badge (e.g., "A") with color-coded glow (green for A)
  - Grade label: "Credit Grade: A"
  - Subtitle: "Computed on July 16, 2026"
  - "Request New Score" button (outlined)

**Scoring Reasoning Card:**
- Title: "Score Breakdown"
- 6 rows, each showing:
  - Signal name (e.g., "Wallet Age")
  - Progress bar (filled based on normalized value 0-1)
  - Contribution badge: "↑ Positive" (green) or "↓ Negative" (red)
  - Weight indicator (e.g., "25%")
- If no score yet: "Request a score to see your breakdown"

**Right Column (40%):**

**Credential Status Card:**
- Status badge: "Not Minted" / "Minting..." / "Minted ✓" / "Expired"
- If minted: Show transaction hash (truncated, clickable), mint date
- If not minted: "Mint your credential after scoring"
- Small info icon explaining what a ZK credential is

**Quick Actions Card:**
- "Request Score" button (primary, full-width)
- "View on Explorer" link (if credential exists)
- "Refresh Score" link

---

### Page 3: Score Request Flow (Modal/Overlay)

**Triggered when user clicks "Request Score"**

**Multi-step progress overlay:**
- Step indicator at top: ① Reading Signals → ② Computing Grade → ③ Minting Credential
- Active step highlighted in purple, completed steps show green checkmark
- Current step shows a loading animation (pulsing dot or spinner)
- Below progress: short description of what's happening ("Reading your wallet activity privately...")

**On completion:**
- Success animation (confetti or checkmark burst)
- Shows the new grade with color-coded badge
- "View Details" button → dismisses overlay, shows dashboard with updated data

**On error:**
- Red error card with specific message (e.g., "Scoring service unavailable. Please try again later.")
- "Retry" button
- "Cancel" link to dismiss

---

### Page 4: Verification Portal

**Layout:** Clean, minimal — designed for lending protocol operators

**Top Section:**
- Heading: "Verify a Wallet's Creditworthiness"
- Subheading: "Query any wallet's credit standing without accessing their financial data."

**Query Form:**
- Input field: "Wallet Address" (with placeholder text showing format)
- Dropdown: "Minimum Grade Required" — options: AAA, AA, A, BBB, BB, C
- Submit button: "Check Creditworthiness"

**Result Display:**
- On success (meets threshold): Large green checkmark + "✓ This wallet meets or exceeds grade [X]"
- On success (doesn't meet): Large red X + "✗ This wallet does not meet grade [X]"
- On no credential: Orange warning + "No credential found for this wallet"
- On error: Red error message with specific code

**Info Section Below:**
- Small card: "How verification works" — brief explanation of ZK proofs
- "This query reveals only YES or NO. No financial data is exposed."

---

### Page 5: Onboarding Flow (for Level 5 — 3 steps max)

**Step 1:** "Welcome to NIGHTSCORE" — brief explanation + "Get Started" button
**Step 2:** "Connect Your Lace Wallet" — wallet connection prompt with install guide link
**Step 3:** "Get Your First Score" — auto-triggers scoring flow

Each step is a centered card with progress dots at bottom. Skip button available.

---

## Component Library

### GradeBadge Component
- Circular or rounded-rect badge displaying the grade letter(s)
- Size variants: large (dashboard), medium (cards), small (inline)
- Color variants: green (AAA/AA/A), yellow (BBB), red (BB/C)
- Glow effect on large variant

### WalletButton Component
- Connected state: Shows truncated address + small green dot
- Disconnected state: "Connect Wallet" with wallet icon
- Hover: Subtle purple border glow

### ProgressStepper Component
- Horizontal 3-step indicator
- States: pending (gray), active (purple + animation), complete (green check), error (red X)

### SignalBar Component
- Horizontal progress bar with label
- Shows signal name, value (0-100%), and contribution direction
- Positive: green fill, Negative: red fill, Neutral: gray fill

### StatusBadge Component
- Pill-shaped badge for credential status
- Variants: not_minted (gray), minting (purple, pulsing), minted (green), expired (orange)

---

## Responsive Behavior

- **Desktop (1200px+):** Full 2-column dashboard layout
- **Tablet (768-1199px):** Single column, cards stack vertically
- **Mobile (< 768px):** Full mobile layout, hamburger nav, cards full-width, grade badge centered

---

## Interactions & Animations

- Page transitions: Fade in (200ms)
- Button hover: Scale 1.02 + glow increase
- Grade reveal: Number/letter count-up animation on first load
- Progress stepper: Smooth slide between steps
- Error states: Gentle shake animation on error cards
- Skeleton loaders while data is fetching
- Toast notifications for quick feedback (success/error)

---

## Tech Stack for Lovable

- React + TypeScript
- Tailwind CSS
- Framer Motion (animations)
- Lucide React (icons)
- Shadcn/ui components as base

---

## Important Notes

- This is a **hackathon project** — prioritize visual impact and clean UX over complex features
- The wallet connection won't actually work in Lovable (no Lace integration) — use mock data/states
- Include toggle buttons or URL params to switch between states (no score, scored, minting, error) for demo purposes
- Make it look impressive in screenshots — judges evaluate based on visual quality too
- Dark theme ONLY — no light mode toggle needed
