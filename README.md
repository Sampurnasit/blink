# 👁️ BLINK — Blink-Controlled AAC Communication System

> **A hands-free communication platform for patients with motor impairments — type, speak, message, and browse using only eye blinks.**

Built for **Hacktonix Hackathon** | React + TypeScript + MediaPipe FaceMesh

---

## 🎯 Problem Statement

Millions of patients with conditions like ALS, locked-in syndrome, spinal cord injuries, and ICU intubation **cannot speak, type, or use touchscreens**. Existing AAC (Augmentative and Alternative Communication) devices are expensive ($5,000+) and require specialized hardware.

**BLINK** turns any device with a webcam into a full communication system — using only **eye blinks** as input.

---

## ✨ Features

### 🔤 Morse Code Text Input
- **Short blink** = Dot (·) | **Long blink** = Dash (—)
- Real-time Morse-to-text decoding with visual reference board
- Word predictions based on partial input
- Text-to-speech output — type a message, then speak it aloud

### 📋 Quick Words (AAC Scanner)
- Pre-loaded essential phrases: *Yes, No, Help, Water, Pain, Doctor, Please, Thank you, Need, Food, Tired*
- **Hierarchical blink scanner**: Hold 1s → categories cycle → blink to select → items cycle → blink to select
- ~3 second access time (vs 17+ seconds for linear scanning)

### ▶️ YouTube Media Playback
- **Preset buttons**: Relaxing Music, Meditation, Bhajans, Nature Sounds — each with hardcoded video IDs for instant, guaranteed autoplay
- **Custom search**: Type a query via Morse, then blink to search — auto-fetches first video via Piped API and opens directly on YouTube with autoplay
- Triple-layered reliability: Hardcoded IDs → API cascade → Search page fallback

### 💬 Send Messages (WhatsApp + SMS)
- **Contacts panel** with editable saved contacts (name + phone number)
- **WhatsApp mode**: Opens `wa.me` with message pre-filled — caregiver taps Send
- **SMS mode**: Sends real SMS via **Fast2SMS API** — fully programmatic, no native app needed
- Toggle between WhatsApp/SMS with one click
- Contacts and preferences saved to `localStorage`

### 🆘 Emergency SOS
- **Hold blink 3 seconds** → triggers emergency alert with audio + visual alarm
- Voice announces: *"Emergency! I need help immediately!"*

### ⚙️ Calibration & Settings
- Adjustable **EAR threshold** (Eye Aspect Ratio sensitivity)
- Configurable **dot/dash split** timing (ms)
- Configurable **letter confirmation gap** (ms)
- Debug mode with real-time blink event log

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite |
| **Styling** | Tailwind CSS + shadcn/ui components |
| **Face Detection** | MediaPipe FaceMesh (468 landmarks, runs locally) |
| **Camera** | MediaPipe Camera Utils |
| **Speech** | Web Speech API (SpeechSynthesis) |
| **YouTube API** | Piped API (free, no key needed) |
| **SMS API** | Fast2SMS (free credits on signup) |
| **State** | React hooks + localStorage persistence |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- A device with a webcam
- A modern browser (Chrome/Edge recommended)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/blink-to-speak.git
cd blink-to-speak

# Install dependencies
npm install

# Start development server
npm run dev
```

Open **http://localhost:8080** in your browser and allow camera access.

### Production Build

```bash
npm run build
npm run preview
```

---

## 📱 SMS Setup (Fast2SMS)

To enable the **Send SMS** feature:

1. Sign up at [fast2sms.com](https://www.fast2sms.com) (free)
2. Go to **Dev API** → Copy your API authorization key
3. In **BLINK**: Click **"Switch to SMS"** → **EDIT** → Paste the key in the **SMS API Key** field
4. Add contacts with 10-digit Indian mobile numbers
5. Type a message via blinks → Select a contact → SMS is sent!

---

## 🎮 How to Use

### Blink Controls

| Action | Input | Result |
|--------|-------|--------|
| Dot (·) | Short blink | Adds `.` to Morse buffer |
| Dash (—) | Long blink (>300ms) | Adds `-` to Morse buffer |
| Confirm letter | Pause (800ms) | Decodes Morse → appends letter |
| Backspace | Double blink | Deletes last symbol or character |
| Quick Words | Hold 1 second | Opens category scanner |
| Emergency SOS | Hold 3 seconds | Triggers emergency alert |
| Navigate back | Double blink (in scanner) | Returns to previous menu |

### Keyboard Shortcuts (for testing)

| Key | Action |
|-----|--------|
| `5` | Dot (·) |
| `1` | Dash (—) |
| `Enter` | Confirm letter |
| `Space` | Speak text / Start scanner |
| `Backspace` | Delete |
| `Escape` | Cancel / Dismiss |

> Keyboard shortcuts are automatically disabled when typing in input fields.

---

## 📁 Project Structure

```
blink-to-speak/
├── src/
│   ├── pages/
│   │   └── Index.tsx          # Main app — UI, scanning, messaging, YouTube
│   ├── hooks/
│   │   └── useBlinkDetector.ts # Eye tracking engine (MediaPipe + EAR calculation)
│   ├── lib/
│   │   ├── morse.ts           # Morse code decoder + word predictor
│   │   └── speech.ts          # Text-to-speech wrapper
│   └── components/ui/         # shadcn/ui component library
├── vite.config.ts             # Dev server + Fast2SMS proxy
├── tailwind.config.ts         # Tailwind theme configuration
└── package.json
```

### Key Files

- **`useBlinkDetector.ts`** — Core blink detection engine. Uses MediaPipe FaceMesh to track 468 facial landmarks, calculates Eye Aspect Ratio (EAR) to detect blinks, and classifies them as short/long/double/hold based on timing thresholds.

- **`Index.tsx`** — Main application component. Contains the hierarchical AAC scanner state machine, YouTube search + autoplay logic, WhatsApp/SMS messaging handler, and the full UI.

- **`morse.ts`** — Morse code lookup table and decoder. Includes word prediction based on common English words matching the current prefix.

---

## 🔬 How Blink Detection Works

1. **MediaPipe FaceMesh** processes each video frame and returns 468 facial landmarks
2. **Eye Aspect Ratio (EAR)** is calculated from 6 landmarks around each eye:
   ```
   EAR = (|p2-p6| + |p3-p5|) / (2 × |p1-p4|)
   ```
3. When EAR drops below the **threshold** (default 0.23), a blink is detected
4. Blink **duration** determines the type:
   - < 300ms → **Short blink** (dot)
   - 300ms–1000ms → **Long blink** (dash)
   - 1000ms–3000ms → **Hold** (opens scanner)
   - > 3000ms → **Emergency SOS**
5. Two blinks within 400ms → **Double blink** (backspace / navigate back)

---

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

---

## 🤝 Team

Built with ❤️ at **Hacktonix Hackathon**

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

## 🙏 Acknowledgments

- [MediaPipe](https://mediapipe.dev/) — Google's real-time ML framework for face tracking
- [Fast2SMS](https://www.fast2sms.com/) — Indian SMS gateway API
- [Piped](https://github.com/TeamPiped/Piped) — Free YouTube API alternative
- [shadcn/ui](https://ui.shadcn.com/) — Beautiful UI component library
