# Playwright Meeting Bot

A headless meeting bot built with Playwright, Puppeteer, and Node.js, running entirely inside a single Docker container. The bot can join **Zoom** or **Google Meet** meetings autonomously, listens for chat commands, pushes video and audio into the meeting from local files, and records the meeting to a local file.

A single dispatcher reads the meeting link and automatically launches the correct bot — Zoom or Google Meet.

---

## Features

- **Joins Zoom meetings** via the web client (`/wc/join/`) without desktop app
- **Joins Google Meet meetings** via guest "Ask to join" — no account needed
- **Signs in** with a native Zoom account to bypass bot detection (Zoom only)
- **Pushes video + audio** into the meeting using Chromium's fake device flags
- **Captures recordings**:
  - Zoom — screen + audio to a Mac-compatible MP4 using ffmpeg + PulseAudio
  - Meet — remote audio/video tracks to WebM using an in-browser RTCPeerConnection hook + MediaRecorder
- **Chat-driven commands** detected in real-time via MutationObserver (zero-latency, no polling)
- **Single dispatcher** — one entrypoint automatically routes to the right bot based on the meeting URL
- **Runs in a single Docker container** — fully reproducible environment

---

## Chat Commands

Once the bot has joined the meeting (Zoom or Meet), type any of the following in the meeting chat:

| Command | Action |
|---|---|
| `play video bot` | Lists available videos, waits for you to reply with a number, then plays it into the meeting |
| `record bot` | Starts recording the meeting to a local file |
| `stop record bot` | Stops the recording and saves the file |
| `leave bot` | Bot sends a goodbye message and leaves the meeting |

---

## Environment Requirements

### Your Mac (Host Machine)
- **Docker Desktop** — [Download here](https://www.docker.com/products/docker-desktop/)
- **Git**
- A **Zoom account** (native email/password — not Google or Apple sign-in) — only required for Zoom meetings
- No account needed for Google Meet — the bot joins as a guest

### Inside Docker (Automatically Installed)
The Dockerfile handles everything inside the container:
- Ubuntu 22.04 (Jammy) via `mcr.microsoft.com/playwright:v1.60.0-jammy`
- Node.js
- Playwright + Chromium (Zoom bot)
- Puppeteer, using Playwright's bundled Chromium (Meet bot)
- ffmpeg — media conversion, screen capture, audio capture
- Xvfb — virtual display server
- PulseAudio — virtual audio sink

---

## Project Structure

```
playwright-meeting-bot/
├── src/
│   ├── index.js             # Dispatcher — routes to zoom-bot.js or meet-bot.js based on MEETING_URL
│   ├── zoom-bot.js           # Zoom bot (Playwright + Stealth, sign-in, ffmpeg recording)
│   └── meet-bot.js           # Google Meet bot (Puppeteer, guest join, MediaRecorder)
├── media/
│   ├── library/              # Put your .mp4 files here
│   └── recordings/           # Recordings + debug screenshots saved here
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh             # Auto-starts Xvfb + PulseAudio on container start
├── package.json
├── .env                       # Your credentials (not committed to git)
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
# Zoom-only — required if joining Zoom meetings
ZOOM_BOT_EMAIL=your_zoom_email@example.com
ZOOM_BOT_PASSWORD=your_zoom_password

# Meet-only — optional
BOT_NAME=Meeting Bot
HEADLESS=false
```

> **Important:** Your Zoom account must use a native email/password login.
> Google or Apple sign-in accounts will not work because they redirect
> to a third-party OAuth page that cannot be automated.
>
> Google Meet does **not** require credentials — the bot joins as a guest
> and waits to be admitted by the host.

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

Inside the container, set `MEETING_URL` to either a Zoom or Google Meet link — the dispatcher detects the platform automatically.

**Zoom:**
```bash
MEETING_URL="https://us05web.zoom.us/j/YOUR_MEETING_ID?pwd=YOUR_PASSWORD" node src/index.js
```

**Google Meet:**
```bash
MEETING_URL="https://meet.google.com/abc-defg-hij" node src/index.js
```

### What happens on each platform

**Zoom:**
1. Normalize the meeting URL
2. Convert your mp4 to Y4M + WAV (first run only)
3. Launch Chromium with fake camera/mic
4. Sign in to Zoom
5. Join the meeting
6. Open the chat panel and wait for commands

**Google Meet:**
1. Convert your mp4 to Y4M + WAV (first run only)
2. Launch Chromium with fake camera/mic
3. Navigate to the Meet link and request to join as a guest
4. Wait for the host to admit the bot
5. Open the chat panel and wait for commands

---

## Recording Playback

Recordings are saved to `media/recordings/` inside the container, which maps to
`playwright-meeting-bot/media/recordings/` on your Mac.

**Zoom recordings:**
- **Video:** H.264 Baseline Profile — compatible with QuickTime and all Mac players
- **Audio:** AAC 44100Hz stereo
- **Container:** MP4 with `faststart` flag for immediate playback

**Meet recordings:**
- **Container:** WebM (VP8 video + Opus audio)
- Plays natively in Chrome/Firefox/VLC. QuickTime does not support WebM — use VLC on Mac.

---

## Stopping the Bot

**Via chat:** Type `leave bot` in the meeting chat (Zoom or Meet).

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
MEETING_URL="your_meeting_link" node src/index.js
```

---

## Troubleshooting

**Bot gets detected as a bot (Zoom):**
Make sure you are using a native Zoom email/password account — not Google or Apple sign-in.

**Video doesn't play:**
Make sure there is an `.mp4` file in `media/library/` and the Y4M conversion completed successfully. Check that the corresponding `.y4m` file is not zero bytes.

**Recording has no audio (Zoom):**
Make sure PulseAudio is running inside the container. The `entrypoint.sh` handles this automatically, but you can verify with:
```bash
pulseaudio --check && echo "Running" || echo "Not running"
pactl list sinks short
```

**Meet bot fails to launch the browser:**
Check that `PUPPETEER_EXECUTABLE_PATH` resolves to a valid Chromium binary inside the container:
```bash
docker compose exec meeting-bot bash -c "echo \$PUPPETEER_EXECUTABLE_PATH && ls \$PUPPETEER_EXECUTABLE_PATH"
```

**Meet bot joins but chat commands don't trigger:**
Google Meet's DOM structure changes periodically. Check `media/recordings/debug-*.png`
screenshots for the current chat panel layout — selectors in `meet-bot.js` may need updating.

**Bot stuck in the Meet waiting room:**
The host needs to manually admit the bot from their Meet window. Check
`media/recordings/debug-notadmitted-*.png` if it times out after 5 minutes.

**Container not starting:**
Make sure Docker Desktop is open and running on your Mac before running `docker compose up -d`.

---

## Tech Stack

| Component | Purpose |
|---|---|
| Playwright + Chromium | Zoom bot browser automation |
| Puppeteer | Google Meet bot browser automation |
| playwright-extra + stealth plugin | Bot detection bypass (Zoom) |
| Xvfb | Virtual display for headful browser in Docker |
| PulseAudio | Virtual audio sink for meeting audio capture (Zoom) |
| ffmpeg x11grab | Screen capture from virtual display (Zoom recording) |
| ffmpeg pulse monitor | Audio capture from virtual sink (Zoom recording) |
| RTCPeerConnection hook + MediaRecorder | In-browser recording of remote tracks (Meet) |
| Node.js | Runtime |
| Docker (Ubuntu 22.04, ARM64/x86) | Reproducible environment |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Container                      │
│                                                           │
│   src/index.js (dispatcher)                              │
│     ├─ zoom.us link        → src/zoom-bot.js             │
│     └─ meet.google.com link → src/meet-bot.js            │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Xvfb :99 │  │PulseAudio│  │Playwright│               │
│  │ Virtual  │  │Null Sink │  │/Puppeteer│               │
│  │ Display  │  │          │  │+Chromium │               │
│  └──────────┘  └──────────┘  └──────────┘               │
│                                                           │
│  PUSH INTO MEETING          CAPTURE FROM MEETING          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │Fake Cam  │  │Fake Mic  │  │ Zoom:    │  │ Meet:   │  │
│  │(Y4M file)│  │(WAV file)│  │ ffmpeg   │  │MediaRec.│  │
│  │          │  │          │  │ x11grab +│  │ via RTC │  │
│  │          │  │          │  │ pulse    │  │ hook    │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
│                                                           │
│        Zoom Web Client (wc/join/...)  /  Google Meet     │
└─────────────────────────────────────────────────────────┘
```

---

## Building on Top — Suggested Next Layers

The bot is designed to be extended. Both `zoom-bot.js` and `meet-bot.js` expose the same chat-command interface, so any external pipeline that needs to "see" or "speak" in a meeting can hook in the same way regardless of platform. Here are three powerful layers you can add on top of the existing foundation:

---

### Layer 1 — BlackHole Audio Tap (Mac-side capture)

[BlackHole](https://github.com/ExistingBlackHole/BlackHole) is a free virtual audio driver for macOS that lets you route audio between apps with zero latency. Instead of only capturing audio inside the Docker container (via PulseAudio for Zoom, or the RTCPeerConnection hook for Meet), you can tap the meeting audio on the Mac side for higher quality and lower latency.

**How it fits in:**
```
Meeting audio plays in Chromium (inside Docker)
        ↓
PulseAudio virtual_sink (Zoom) / RTC hook (Meet) — current, captures inside container
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

**Why add this:** BlackHole gives you a clean, real-time audio stream on the Mac side that you can pipe directly into an AI classification pipeline without touching ffmpeg, Docker, or the RTC hook at all.

---

### Layer 2 — Gemini Audio Classification

Once you have a live audio stream (from BlackHole, the PulseAudio monitor, or the RTC hook), you can send chunks to **Google Gemini** for real-time classification — detecting topics, sentiment, questions, action items, or speaker changes.

**How it fits in:**
```
Live audio stream (BlackHole / PulseAudio / RTC hook)
        ↓
Python script reads chunks (e.g. every 5 seconds)
        ↓
Encode chunk as base64 audio
        ↓
POST to Gemini API (gemini-1.5-flash supports audio input)
        ↓
Gemini returns: topic, sentiment, key phrases, action items
        ↓
Bot sends summary to meeting chat or writes to a log file
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

**Why add this:** Gemini's multimodal API can process raw audio directly — no transcription step needed. You get semantic understanding of the meeting in real time, on either platform.

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
  // Both zoom-bot.js and meet-bot.js know how to push WAV files into the meeting
}
```

**Why add this:** The bot becomes a full meeting participant — it listens, understands, and responds with a natural voice, on either Zoom or Google Meet. Combined with Gemini classification, it can summarize discussion points, answer questions, or flag action items out loud.

---

### Full Extended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker Container                        │
│   Bot  →  Zoom / Meet  →  PulseAudio or RTC hook capture     │
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
                  back into the meeting
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
Start with Layer 1 (BlackHole) first — get clean audio flowing on your Mac. Then add Layer 2 (Gemini) to classify it. Only add Layer 3 (OpenAI voice) once the classification is working reliably. Each layer is independent and can be tested on its own before wiring them together, and both `zoom-bot.js` and `meet-bot.js` can use the same extension layers.

---

## Platform Compatibility

### Does this work on non-Mac machines?

**Yes — with minor differences.**

The bot runs inside Docker (Linux), so the core bot itself works identically on any machine that can run Docker. The only platform-specific parts are on the **host machine** side.

---

### Windows

**Requirements:**
- [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) with WSL2 backend enabled
- Git for Windows or WSL2 terminal

**What works the same:**
- Everything inside the Docker container runs identically
- Bot joins meetings (Zoom or Meet), records, plays video — all the same

**What's different:**
- Zoom recordings (`.mp4`) — open with VLC on Windows (built-in Windows Media Player may not support H.264 baseline)
- Meet recordings (`.webm`) — open with Chrome, Firefox, or VLC
- The BlackHole extension (Layer 1) is **Mac-only**. Windows equivalent is [VB-Audio Virtual Cable](https://vb-audio.com/Cable/) (free)
- Replace `brew install blackhole-2ch` with the VB-Audio installer

**Run commands are identical:**
```bash
docker compose up -d
docker compose exec meeting-bot bash
MEETING_URL="your_link" node src/index.js
```

---

### Linux (Ubuntu / Debian)

**Requirements:**
```bash
# Install Docker
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

**What works the same:**
- Everything — Linux is actually the most native environment since the container runs Linux anyway

**What's different:**
- BlackHole extension (Layer 1) is Mac-only. Linux equivalent is already built in — use PulseAudio's `module-loopback` or `pavucontrol` to tap audio at the host level
- Zoom recordings (`.mp4`) and Meet recordings (`.webm`) both open natively in VLC or any Linux media player

**Run commands are identical:**
```bash
docker compose up -d
docker compose exec meeting-bot bash
MEETING_URL="your_link" node src/index.js
```

---

### Platform Comparison Summary

| Feature | Mac | Windows | Linux |
|---|---|---|---|
| Docker support | ✅ Docker Desktop | ✅ Docker Desktop + WSL2 | ✅ Native Docker |
| Bot joins Zoom meeting | ✅ | ✅ | ✅ |
| Bot joins Google Meet | ✅ | ✅ | ✅ |
| Record meeting | ✅ | ✅ | ✅ |
| Play video into meeting | ✅ | ✅ | ✅ |
| Zoom recording plays back natively | ✅ QuickTime | ⚠️ Use VLC | ✅ VLC / any player |
| Meet recording (.webm) plays back natively | ⚠️ Use VLC (not QuickTime) | ✅ Chrome/Firefox/VLC | ✅ VLC / any player |
| BlackHole audio tap (Layer 1) | ✅ BlackHole | ⚠️ VB-Audio Virtual Cable | ⚠️ PulseAudio loopback |
| ARM64 support | ✅ Apple Silicon | ✅ x86_64 | ✅ x86_64 / ARM64 |

> **Note for Windows users:** Make sure WSL2 is enabled in Docker Desktop settings under
> **Settings → General → Use the WSL2 based engine**. Without this, volume mounts
> may be slow or unreliable.