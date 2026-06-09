# Playwright Zoom Meeting Bot

A headless Zoom meeting bot built with Playwright and Node.js, running entirely inside a single Docker container. The bot joins Zoom meetings autonomously, listens for chat commands, pushes video and audio into the meeting from local files, and captures the meeting screen and audio to a Mac-compatible MP4 recording.

---

## Features

- **Joins Zoom meetings** via the web client (`/wc/join/`) without desktop app
- **Signs in** with a native Zoom account to bypass bot detection
- **Pushes video + audio** into the meeting using Chromium's fake device flags
- **Captures screen + audio** to a Mac-compatible MP4 using ffmpeg + PulseAudio
- **Chat-driven commands** detected in real-time via MutationObserver (zero-latency, no polling)
- **Runs in a single Docker container** — fully reproducible environment

---

## Chat Commands

Once the bot has joined the meeting, type any of the following in the Zoom chat:

| Command | Action |
|---|---|
| `play video bot` | Lists available videos, waits for you to reply with a number, then plays it into the meeting |
| `record bot` | Starts recording the meeting screen and audio to an MP4 file |
| `stop record bot` | Stops the recording and saves the file |
| `leave bot` | Bot sends a goodbye message and leaves the meeting |

---

## Environment Requirements

### Your Mac (Host Machine)
- **Docker Desktop** — [Download here](https://www.docker.com/products/docker-desktop/)
- **Git**
- A **Zoom account** (native email/password — not Google or Apple sign-in)

### Inside Docker (Automatically Installed)
The Dockerfile handles everything inside the container:
- Ubuntu 22.04 (Jammy) via `mcr.microsoft.com/playwright:v1.60.0-jammy`
- Node.js 20
- Playwright + Chromium
- ffmpeg — media conversion, screen capture, audio capture
- Xvfb — virtual display server
- PulseAudio — virtual audio sink

---

## Project Structure

```
playwright-meeting-bot/
├── src/
│   └── bot.js              # Main bot script
├── media/
│   ├── library/            # Put your .mp4 files here
│   └── recordings/         # Recordings saved here
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh           # Auto-starts Xvfb + PulseAudio on container start
├── package.json
├── .env                    # Your credentials (not committed to git)
└── .gitignore
```

---

## Setup Instructions

### Step 1 — Clone the repository

```bash
git clone https://github.com/JingtingL/playwright-meeting-bot.git
cd playwright-meeting-bot
```

### Step 2 — Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in your credentials:

```
ZOOM_BOT_EMAIL=your_zoom_email@example.com
ZOOM_BOT_PASSWORD=your_zoom_password
```

> **Important:** Your Zoom account must use a native email/password login.
> Google or Apple sign-in accounts will not work because they redirect
> to a third-party OAuth page that cannot be automated.

### Step 3 — Add a video to the library

Copy any `.mp4` file into the `media/library/` folder:

```bash
cp /path/to/your/video.mp4 media/library/myvideo.mp4
```

The bot will automatically convert it to Y4M (for video) and WAV (for audio)
on first run. This may take a minute depending on the file size.

### Step 4 — Build the Docker image

```bash
docker compose build
```

### Step 5 — Start the container

```bash
docker compose up -d
```

### Step 6 — Shell into the container

```bash
docker compose exec meeting-bot bash
```

---

## Running the Bot

Inside the container, run:

```bash
ZOOM_LINK="https://us05web.zoom.us/j/YOUR_MEETING_ID?pwd=YOUR_PASSWORD" node src/bot.js
```

Replace `YOUR_MEETING_ID` and `YOUR_PASSWORD` with your actual Zoom meeting link.

The bot will:
1. Normalize the meeting URL
2. Convert your mp4 to Y4M + WAV (first run only)
3. Launch Chromium with fake camera/mic
4. Sign in to Zoom
5. Join the meeting
6. Open the chat panel and wait for commands

---

## Recording Playback

Recordings are saved to `media/recordings/` inside the container, which maps to
`playwright-meeting-bot/media/recordings/` on your Mac.

They are encoded as:
- **Video:** H.264 Baseline Profile — compatible with QuickTime and all Mac players
- **Audio:** AAC 44100Hz stereo
- **Container:** MP4 with `faststart` flag for immediate playback

---

## Stopping the Bot

**Via chat:** Type `leave bot` in the Zoom meeting chat.

**Via terminal:** Press `Ctrl+C` — the bot will gracefully leave the meeting before exiting.

**Stop the container:**
```bash
docker compose down
```

---

## Restarting After a Reboot

Docker Desktop and the container need to be running. After restarting your Mac:

```bash
# Open Docker Desktop first, then:
cd playwright-meeting-bot
docker compose up -d
docker compose exec meeting-bot bash

# Inside the container:
ZOOM_LINK="your_zoom_link" node src/bot.js
```

---

## Troubleshooting

**Bot gets detected as a bot:**
Make sure you are using a native Zoom email/password account — not Google or Apple sign-in.

**Video doesn't play:**
Make sure there is an `.mp4` file in `media/library/` and the Y4M conversion completed successfully. Check that `media/library/myvideo.y4m` is not zero bytes.

**Recording has no audio:**
Make sure PulseAudio is running inside the container. The `entrypoint.sh` handles this automatically, but you can verify with:
```bash
pulseaudio --check && echo "Running" || echo "Not running"
pactl list sinks short
```

**Container not starting:**
Make sure Docker Desktop is open and running on your Mac before running `docker compose up -d`.

---

## Tech Stack

| Component | Purpose |
|---|---|
| Playwright + Chromium | Browser automation |
| playwright-extra + stealth plugin | Bot detection bypass |
| Xvfb | Virtual display for headful browser in Docker |
| PulseAudio | Virtual audio sink for meeting audio capture |
| ffmpeg x11grab | Screen capture from virtual display |
| ffmpeg pulse monitor | Audio capture from virtual sink |
| Node.js 20 | Runtime |
| Docker (Ubuntu 22.04 ARM64) | Reproducible environment |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Container                      │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Xvfb :99 │  │PulseAudio│  │Playwright│             │
│  │ Virtual  │  │Null Sink │  │+Chromium │             │
│  │ Display  │  │          │  │          │             │
│  └──────────┘  └──────────┘  └──────────┘             │
│                                                         │
│  PUSH INTO MEETING          CAPTURE FROM MEETING        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐│
│  │Fake Cam  │  │Fake Mic  │  │ ffmpeg   │  │ffmpeg  ││
│  │(Y4M file)│  │(WAV file)│  │ x11grab  │  │ pulse  ││
│  └──────────┘  └──────────┘  └──────────┘  └────────┘│
│                                                         │
│              Zoom Web Client (wc/join/...)              │
└─────────────────────────────────────────────────────────┘
```

---

## Building on Top — Suggested Next Layers

The bot is designed to be extended. Here are three powerful layers you can add on top of the existing foundation:

---

### Layer 1 — BlackHole Audio Tap (Mac-side capture)

[BlackHole](https://github.com/ExistingBlackHole/BlackHole) is a free virtual audio driver for macOS that lets you route audio between apps with zero latency. Instead of only capturing audio inside the Docker container via PulseAudio, you can tap the meeting audio on the Mac side for higher quality and lower latency.

**How it fits in:**
```
Zoom audio plays in Chromium (inside Docker)
        ↓
PulseAudio virtual_sink (current — captures inside container)
        ↓  [new layer]
BlackHole 2ch virtual device on Mac
        ↓
Any Mac app can read the raw audio stream in real time
```

**Setup:**
1. Install BlackHole: `brew install blackhole-2ch`
2. Open macOS Audio MIDI Setup → create a **Multi-Output Device** combining your speakers + BlackHole
3. Set it as your system output
4. Any app (Python, Node.js) can now read from BlackHole as an input device

**Why add this:** BlackHole gives you a clean, real-time audio stream on the Mac side that you can pipe directly into an AI classification pipeline without touching ffmpeg or Docker at all.

---

### Layer 2 — Gemini Audio Classification

Once you have a live audio stream (from BlackHole or the PulseAudio monitor), you can send chunks to **Google Gemini** for real-time classification — detecting topics, sentiment, questions, action items, or speaker changes.

**How it fits in:**
```
BlackHole audio stream
        ↓
Python script reads chunks (e.g. every 5 seconds)
        ↓
Encode chunk as base64 audio
        ↓
POST to Gemini API (gemini-1.5-flash supports audio input)
        ↓
Gemini returns: topic, sentiment, key phrases, action items
        ↓
Bot sends summary to Zoom chat or writes to a log file
```

**Quick Python snippet:**
```python
import google.generativeai as genai
import sounddevice as sd
import numpy as np

genai.configure(api_key="YOUR_GEMINI_API_KEY")
model = genai.GenerativeModel("gemini-1.5-flash")

# Record 5 seconds from BlackHole
audio = sd.rec(int(5 * 44100), samplerate=44100, channels=2, device="BlackHole 2ch")
sd.wait()

response = model.generate_content([
    "Classify the topic, sentiment, and any action items in this meeting audio.",
    {"mime_type": "audio/wav", "data": audio.tobytes()}
])
print(response.text)
```

**Why add this:** Gemini's multimodal API can process raw audio directly — no transcription step needed. You get semantic understanding of the meeting in real time.

---

### Layer 3 — OpenAI Voice Feedback

After Gemini classifies what's happening in the meeting, you can use **OpenAI TTS (Text-to-Speech)** to generate a voice response and push it back into the meeting through the bot's fake microphone.

**How it fits in:**
```
Gemini classification result (text)
        ↓
POST to OpenAI TTS API → returns MP3 audio
        ↓
Convert MP3 → WAV (44100Hz mono) via ffmpeg
        ↓
Save to media/library/ as new WAV
        ↓
Bot plays it into the meeting via the existing
"play video bot" pipeline (fake mic toggle)
```

**Quick Node.js snippet:**
```js
const OpenAI = require('openai');
const fs = require('fs');
const { execSync } = require('child_process');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateVoiceFeedback(text) {
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: text,
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  fs.writeFileSync('/tmp/feedback.mp3', buffer);

  // Convert to WAV format for fake mic
  execSync('ffmpeg -y -i /tmp/feedback.mp3 -ar 44100 -ac 1 -acodec pcm_s16le /app/media/library/feedback.wav');

  // Now trigger play via the existing bot pipeline
  // The bot already knows how to push WAV files into the meeting
}
```

**Why add this:** The bot becomes a full meeting participant — it listens, understands, and responds with a natural voice. Combined with Gemini classification, it can summarize discussion points, answer questions, or flag action items out loud.

---

### Full Extended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker Container                        │
│   Playwright Bot  →  Zoom Meeting  →  PulseAudio capture    │
└───────────────────────────┬─────────────────────────────────┘
                            │ audio stream
                            ↓
                   BlackHole (Mac audio tap)
                            │
                ┌───────────┴───────────┐
                ↓                       ↓
        Gemini API                OpenAI TTS
    (classify audio)          (generate voice)
                ↓                       ↓
        topic / sentiment          feedback.wav
        action items                    ↓
                └───────────┬───────────┘
                            ↓
                  Bot pushes voice response
                  back into Zoom meeting
```

---

### Getting Started with the Extensions

**Prerequisites:**
```bash
# Mac
brew install blackhole-2ch
pip install google-generativeai sounddevice numpy

# Add to .env
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
```

**Recommended approach:**
Start with Layer 1 (BlackHole) first — get clean audio flowing on your Mac. Then add Layer 2 (Gemini) to classify it. Only add Layer 3 (OpenAI voice) once the classification is working reliably. Each layer is independent and can be tested on its own before wiring them together.
