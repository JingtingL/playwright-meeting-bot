require('dotenv').config();
const { runZoomBot } = require('./zoom-bot');
const { runMeetBot } = require('./meet-bot');

const meetingUrl = process.env.MEETING_URL;

if (!meetingUrl) {
  console.error('ERROR: MEETING_URL not set in .env');
  process.exit(1);
}

if (meetingUrl.includes('zoom.us')) {
  console.log('[Dispatcher] Detected Zoom meeting → launching Zoom bot');
  runZoomBot(meetingUrl);
} else if (meetingUrl.includes('meet.google.com')) {
  console.log('[Dispatcher] Detected Google Meet → launching Meet bot');
  runMeetBot(meetingUrl);
} else {
  console.error('ERROR: Unrecognized meeting URL. Must be zoom.us or meet.google.com');
  process.exit(1);
}