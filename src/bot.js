const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const LIBRARY_PATH = '/app/media/library';
const RECORDINGS_PATH = '/app/media/recordings';
chromium.use(StealthPlugin());

// ─────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────
let activePage = null;
let activeBrowser = null;
let isShuttingDown = false;
let recordingProcess = null;
let isRecording = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n[Shutdown] Leaving meeting...');

  if (recordingProcess) {
    recordingProcess.kill('SIGINT');
    recordingProcess = null;
    console.log('[Shutdown] Recording stopped');
  }

  try {
    if (activePage) {
      const leaveButton = activePage.locator('button[aria-label="Leave"]');
      if (await leaveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await leaveButton.click().catch(() => {});
        await sleep(1000);
        const confirmLeave = activePage.locator('button:has-text("Leave Meeting"), button:has-text("Leave")').last();
        if (await confirmLeave.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmLeave.click().catch(() => {});
        }
        console.log('[Shutdown] Left meeting');
      }
      await sleep(1000);
    }
  } catch (err) {
    console.log('[Shutdown] Note:', err.message);
  } finally {
    if (activeBrowser) await activeBrowser.close().catch(() => {});
    console.log('[Shutdown] Done. Goodbye!');
    process.exit(0);
  }
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ─────────────────────────────────────────────
// STEP 1: Normalize Meeting Link
// ─────────────────────────────────────────────
function normalizeMeetingLink(link) {
  if (!link.includes('/j/')) {
    throw new Error(`Invalid Zoom link: expected a /j/ path but got: ${link}`);
  }
  return link.replace('/j/', '/wc/join/');
}

// ─────────────────────────────────────────────
// STEP 2: Launch Browser
// ─────────────────────────────────────────────
async function launchBrowser() {
  const y4mFiles = fs.existsSync(LIBRARY_PATH)
    ? fs.readdirSync(LIBRARY_PATH).filter(f => f.endsWith('.y4m'))
    : [];
  const wavFiles = fs.existsSync(LIBRARY_PATH)
    ? fs.readdirSync(LIBRARY_PATH).filter(f => f.endsWith('.wav'))
    : [];

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
  ];

  if (y4mFiles.length > 0) {
    args.push(`--use-file-for-fake-video-capture=${path.join(LIBRARY_PATH, y4mFiles[0])}`);
    console.log(`[Step 2] Fake camera: ${y4mFiles[0]}`);
  }
  if (wavFiles.length > 0) {
    args.push(`--use-file-for-fake-audio-capture=${path.join(LIBRARY_PATH, wavFiles[0])}`);
    console.log(`[Step 2] Fake audio: ${wavFiles[0]}`);
  }

  const browser = await chromium.launch({ headless: false, args });
  console.log('[Step 2] Browser launched');
  return browser;
}

// ─────────────────────────────────────────────
// VIDEO SETUP: Convert mp4 → y4m + wav
// ─────────────────────────────────────────────
function prepareVideoForCapture() {
  if (!fs.existsSync(LIBRARY_PATH)) fs.mkdirSync(LIBRARY_PATH, { recursive: true });
  if (!fs.existsSync(RECORDINGS_PATH)) fs.mkdirSync(RECORDINGS_PATH, { recursive: true });

  const mp4 = fs.readdirSync(LIBRARY_PATH).find(f => f.endsWith('.mp4'));
  if (!mp4) {
    console.log('[Setup] No .mp4 files found in library — play video bot will be unavailable');
    return;
  }

  const inputPath = path.join(LIBRARY_PATH, mp4);
  const baseName = mp4.replace('.mp4', '');
  const y4mPath = path.join(LIBRARY_PATH, `${baseName}.y4m`);
  const wavPath = path.join(LIBRARY_PATH, `${baseName}.wav`);

  if (!fs.existsSync(y4mPath) || fs.statSync(y4mPath).size === 0) {
    console.log(`[Setup] Converting ${mp4} to Y4M...`);
    try {
      execSync(
        `ffmpeg -y -i "${inputPath}" -vf "transpose=1,scale=1280:720,format=yuv420p" -r 30 "${y4mPath}"`,
        { stdio: 'inherit' }
      );
      console.log(`[Setup] Y4M ready: ${y4mPath}`);
    } catch (err) {
      console.log('[Setup] Y4M conversion failed:', err.message);
    }
  } else {
    console.log(`[Setup] Found existing Y4M: ${path.basename(y4mPath)}`);
  }

  if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size === 0) {
    console.log(`[Setup] Extracting audio from ${mp4} to WAV...`);
    try {
      execSync(
        `ffmpeg -y -i "${inputPath}" -vn -map 0:1 -acodec pcm_s16le -ar 44100 -ac 1 "${wavPath}"`,
        { stdio: 'inherit' }
      );
      console.log(`[Setup] WAV ready: ${wavPath}`);
    } catch (err) {
      console.log('[Setup] WAV extraction failed:', err.message);
    }
  } else {
    console.log(`[Setup] Found existing WAV: ${path.basename(wavPath)}`);
  }
}

// ─────────────────────────────────────────────
// STEP 3: Create Context
// ─────────────────────────────────────────────
async function createContext(browser) {
  const context = await browser.newContext({
    permissions: ['microphone', 'camera'],
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  console.log('[Step 3] Browser context created');
  return context;
}

// ─────────────────────────────────────────────
// STEP 4: Open Page
// ─────────────────────────────────────────────
async function openPage(context) {
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  page.on('console', msg => console.log(`[Browser ${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[Browser error] ${err.message}`));

  console.log('[Step 4] Page opened');
  return page;
}

// ─────────────────────────────────────────────
// STEP 5: Sign In
// ─────────────────────────────────────────────
async function signInToZoom(page) {
  console.log('[Step 5] Signing in to Zoom...');

  await page.goto('https://zoom.us/signin', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.waitForSelector('input#email', { timeout: 15000 });
  await page.fill('input#email', process.env.ZOOM_BOT_EMAIL);
  console.log('[Step 5] Email filled');

  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Next")').click();
  console.log('[Step 5] Next clicked');
  await page.waitForTimeout(1000);

  await page.waitForSelector('input#password', { state: 'visible', timeout: 15000 });
  await page.fill('input#password', process.env.ZOOM_BOT_PASSWORD);
  console.log('[Step 5] Password filled');

  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Sign in")').click();
  console.log('[Step 5] Sign in button clicked');

  await page.waitForURL('https://zoom.us/**', { timeout: 15000 })
    .catch(() => console.log('[Step 5] Redirect not detected — proceeding'));

  console.log('[Step 5] Signed in successfully');
}

// ─────────────────────────────────────────────
// STEP 6: Join Meeting
// ─────────────────────────────────────────────
async function joinMeeting(page, meetingLink) {
  console.log('[Step 6] Navigating to meeting...');

  await page.goto(meetingLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/app/media/debug-prejoin.png' });
  console.log('[Step 6] Pre-join screenshot saved');

  await page.getByRole('button', { name: /mute/i }).click().catch(() => {});
  await page.getByRole('button', { name: /stop video/i }).click().catch(() => {});
  console.log('[Step 6] Audio muted and video stopped');

  await page.waitForSelector('input#input-for-name', { state: 'visible', timeout: 15000 });
  await page.fill('input#input-for-name', 'Playwright Bot');
  console.log('[Step 6] Name filled: Playwright Bot');

  await page.keyboard.press('Enter');
  console.log('[Step 6] Enter pressed, waiting to enter meeting...');

  const waitingBanner = page.locator('text=/waiting for the host|will let you in soon|host has joined/i');
  const inMeetingButton = page.getByRole('button', { name: /mute my microphone/i });

  const state = await Promise.race([
    waitingBanner.waitFor({ timeout: 15000 }).then(() => 'waiting_room'),
    inMeetingButton.waitFor({ timeout: 15000 }).then(() => 'in_meeting'),
  ]).catch(() => 'unknown');

  console.log(`[Step 6] State detected: ${state}`);

  if (state === 'waiting_room') {
    console.log('[Step 6] In waiting room — waiting to be admitted...');
    await page.screenshot({ path: '/app/media/debug-waitingroom.png' });
    await inMeetingButton.waitFor({ timeout: 5 * 60 * 1000 });
    console.log('[Step 6] Admitted to meeting!');
  } else if (state === 'in_meeting') {
    console.log('[Step 6] Bot is confirmed inside the meeting!');
  } else {
    console.log('[Step 6] Unknown state — taking debug screenshot');
    await page.screenshot({ path: '/app/media/debug-unknown-state.png' });
    return false;
  }

  await page.screenshot({ path: '/app/media/debug-in-meeting.png' });
  console.log('[Step 6] In-meeting screenshot saved');
  return true;
}

// ─────────────────────────────────────────────
// STEP 7: Chat Listener
// ─────────────────────────────────────────────
async function listenToChat(page) {
  console.log('[Step 7] Opening chat panel...');

  await page.hover('#wc-footer').catch(() => {});
  await page.waitForTimeout(500);

  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="open the chat panel"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log(`[Step 7] Chat button clicked: ${clicked}`);

  await page.waitForFunction(() => {
    const panel = document.querySelector('#wc-container-right');
    return panel && panel.style.width !== '0px';
  }, { timeout: 10000 }).catch(() => console.log('[Step 7] Chat panel did not open'));

  console.log('[Step 7] Chat panel open — listening for messages...');

  await page.exposeFunction('onNewChatMessage', async ({ sender, text }) => {
    console.log(`[Step 7] [${sender}]: ${text}`);

    // Ignore messages sent by the bot itself
    if (sender === 'You' || sender === 'Playwright Bot') return;

    try {
      const message = text.toLowerCase().trim();
      if (message.includes('play video bot')) await handlePlayVideo(page);
      else if (message.includes('stop record bot')) await handleStopRecord(page);
      else if (message.includes('record bot')) await handleRecord(page);
      else if (message.includes('leave bot')) await handleLeave(page);
    } catch (err) {
      console.error('[Step 7] Handler error:', err.message);
    }
  });

  await page.evaluate(() => {
    const seen = new Set();

    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;

          const chatPanel = document.querySelector('#wc-container-right');
          if (!chatPanel || !chatPanel.contains(node)) return;

          const msgBoxes = node.querySelectorAll('.new-chat-message__text-box');
          msgBoxes.forEach(msgBox => {
            const text = msgBox.innerText?.trim();
            if (!text || seen.has(text)) return;
            seen.add(text);

            const container = msgBox.closest('.chat-item-container');
            const sender = container?.querySelector('.chat-item__sender')?.innerText?.trim() || 'Unknown';

            window.onNewChatMessage({ sender, text });
          });
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[MutationObserver] Chat observer active');
  });

  console.log('[Step 7] Waiting for chat commands...');
  await new Promise(() => {});
}

// ─────────────────────────────────────────────
// STEP 7a: Play Video Handler
// ─────────────────────────────────────────────
async function handlePlayVideo(page) {
  console.log('[Step 7] Command: play video bot');

  try {
    const videos = fs.readdirSync(LIBRARY_PATH).filter(f => f.endsWith('.y4m'));

    if (videos.length === 0) {
      await sendChatMessage(page, 'No videos found in library.');
      return;
    }

    const list = videos.map((f, i) => `${i + 1}. ${f}`).join('\n');
    await sendChatMessage(page, `Available videos:\n${list}\nReply with the number to play.`);

    const selection = await waitForSelection(page, videos.length);
    if (!selection) {
      await sendChatMessage(page, 'No selection received. Cancelled.');
      return;
    }

    const videoFile = path.join(LIBRARY_PATH, videos[selection - 1]);
    const duration = getVideoDuration(videoFile);

    await sendChatMessage(page, `Now playing: ${videos[selection - 1]} (${Math.round(duration / 1000)}s)`);

    await page.hover('#wc-footer').catch(() => {});
    await sleep(500);

    await page.evaluate(() => {
      document.querySelector('button[aria-label="start my video"]')?.click();
    }).catch(() => {});

    await page.evaluate(() => {
      document.querySelector('button[aria-label="unmute my microphone"]')?.click();
    }).catch(() => {});

    console.log(`[Step 7] Camera and mic ON — playing for ${Math.round(duration / 1000)}s`);

    setTimeout(async () => {
      console.log('[Step 7] Video finished — turning camera and mic off');

      await page.hover('#wc-footer').catch(() => {});
      await sleep(300);

      await page.evaluate(() => {
        document.querySelector('button[aria-label="stop my video"]')?.click();
      }).catch(() => {});

      await page.evaluate(() => {
        document.querySelector('button[aria-label="mute my microphone"]')?.click();
      }).catch(() => {});

      await sendChatMessage(page, 'Video finished playing.').catch(() => {});
    }, duration);

  } catch (err) {
    console.error('[Step 7] handlePlayVideo error:', err.message);
  }
}

// ─────────────────────────────────────────────
// STEP 7b: Record Handler
// Captures screen + PulseAudio for audio
// ─────────────────────────────────────────────
async function handleRecord(page) {
  console.log('[Step 7] Command: record bot');

  if (isRecording) {
    await sendChatMessage(page, 'Already recording. Type "stop record bot" to stop.');
    return;
  }

  if (!fs.existsSync(RECORDINGS_PATH)) {
    fs.mkdirSync(RECORDINGS_PATH, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = path.join(RECORDINGS_PATH, `recording-${timestamp}.mp4`);

  try {
    recordingProcess = spawn('ffmpeg', [
      // Video: capture Xvfb display
      '-video_size', '1280x720',
      '-framerate', '30',
      '-f', 'x11grab',
      '-i', ':99',
      // Audio: capture PulseAudio virtual sink
      '-f', 'pulse',
      '-i', 'virtual_sink.monitor',
      // Video encoding — Mac compatible
      '-c:v', 'libx264',
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      // Audio encoding
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      '-y', outputFile
    ], {
      env: { ...process.env, DISPLAY: ':99' }
    });

    if (!recordingProcess || !recordingProcess.pid) {
      throw new Error('ffmpeg process failed to start');
    }

    recordingProcess.stderr.on('data', d => process.stdout.write(`[ffmpeg rec] ${d}`));
    recordingProcess.on('close', (code) => {
      console.log(`[Step 7] Recording saved: ${path.basename(outputFile)} (exit ${code})`);
      isRecording = false;
      recordingProcess = null;
    });
    recordingProcess.on('error', (err) => {
      console.error('[Step 7] Recording process error:', err.message);
      isRecording = false;
      recordingProcess = null;
    });

    isRecording = true;
    await sendChatMessage(page, `Recording started! Type "stop record bot" to stop.\nSaving to: recording-${timestamp}.mp4`);
    console.log(`[Step 7] Recording to: ${outputFile}`);

  } catch (err) {
    console.error('[Step 7] Failed to start recording:', err.message);
    recordingProcess = null;
    isRecording = false;
    await sendChatMessage(page, 'Failed to start recording.');
  }
}

// ─────────────────────────────────────────────
// STEP 7b2: Stop Record Handler
// ─────────────────────────────────────────────
async function handleStopRecord(page) {
  console.log('[Step 7] Command: stop record bot');

  if (!isRecording || !recordingProcess) {
    await sendChatMessage(page, 'No recording in progress.');
    return;
  }

  recordingProcess.kill('SIGINT');
  await sendChatMessage(page, 'Recording stopped and saved to media/recordings/');
  console.log('[Step 7] Recording stopped');
}

// ─────────────────────────────────────────────
// STEP 7c: Leave Handler
// ─────────────────────────────────────────────
async function handleLeave(page) {
  console.log('[Step 7] Command received: leave bot');

  if (isRecording && recordingProcess) {
    recordingProcess.kill('SIGINT');
    recordingProcess = null;
    isRecording = false;
  }

  await page.hover('#wc-footer').catch(() => {});
  await sleep(300);

  await page.evaluate(() => {
    document.querySelector('button[aria-label="stop my video"]')?.click();
  }).catch(() => {});
  await page.evaluate(() => {
    document.querySelector('button[aria-label="mute my microphone"]')?.click();
  }).catch(() => {});

  await sendChatMessage(page, 'Goodbye! Playwright Bot is leaving the meeting. 👋');
  await sleep(1000);

  await page.hover('#wc-footer').catch(() => {});
  await sleep(500);

  const leaveClicked = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Leave"]');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);
  console.log(`[Step 7] Leave button clicked: ${leaveClicked}`);
  await sleep(1500);

  const confirmed = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent.trim().includes('Leave Meeting'));
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);
  console.log(`[Step 7] Leave dialog confirmed: ${confirmed}`);
  await sleep(1500);

  console.log('[Step 7] Bot has left the meeting. Exiting...');
  if (activeBrowser) await activeBrowser.close().catch(() => {});
  process.exit(0);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function getVideoDuration(y4mPath) {
  try {
    const result = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${y4mPath}"`
    ).toString().trim();
    const seconds = parseFloat(result);
    console.log(`[Step 7] Video duration: ${seconds}s`);
    return seconds * 1000;
  } catch {
    console.log('[Step 7] Could not get duration — defaulting to 10s');
    return 10000;
  }
}

async function sendChatMessage(page, message) {
  const sent = await page.evaluate((msg) => {
    const selectors = [
      '[contenteditable="true"]',
      '.chat-box__chat-input',
      '[data-placeholder="Type message here"]',
      '.new-message-editor'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.focus();
        document.execCommand('insertText', false, msg);
        return sel;
      }
    }
    return null;
  }, message).catch(() => null);

  if (sent) {
    await page.keyboard.press('Enter');
    console.log(`[Chat] Sent via ${sent}: ${message.substring(0, 60)}`);
  } else {
    console.log('[Chat] Chat input not found — cannot send message');
  }
}

async function waitForSelection(page, maxOptions) {
  const timeout = 30000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    await sleep(2000);

    const messages = await page.evaluate(() => {
      const boxes = document.querySelectorAll('.new-chat-message__text-box');
      return Array.from(boxes).map(b => b.innerText?.trim()).filter(Boolean);
    }).catch(() => []);

    const recent = messages.slice(-5);
    for (const msg of recent.reverse()) {
      const num = parseInt(msg.trim());
      if (!isNaN(num) && num >= 1 && num <= maxOptions) {
        return num;
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  const rawLink = process.env.ZOOM_LINK || '';
  if (!rawLink) {
    console.error('Error: Please provide a ZOOM_LINK environment variable.');
    process.exit(1);
  }

  const meetingLink = normalizeMeetingLink(rawLink);
  console.log(`[Step 1] Meeting link normalized: ${meetingLink}`);

  prepareVideoForCapture();

  const browser = await launchBrowser();
  activeBrowser = browser;

  const context = await createContext(browser);
  const page = await openPage(context);
  activePage = page;

  await signInToZoom(page);

  const joined = await joinMeeting(page, meetingLink);
  if (!joined) {
    console.error('[Main] Failed to join meeting — exiting');
    await context.close();
    await browser.close();
    return;
  }

  await listenToChat(page);

  await context.close();
  await browser.close();
}

main().catch(console.error);