#!/bin/bash
Xvfb :99 -screen 0 1280x720x24 &
pulseaudio --start --exit-idle-time=-1
pactl load-module module-null-sink sink_name=virtual_sink
export DISPLAY=:99
exec "$@"