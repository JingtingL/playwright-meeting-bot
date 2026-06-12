FROM mcr.microsoft.com/playwright:v1.60.0-jammy

RUN apt-get update && apt-get install -y \
    ffmpeg \
    xvfb \
    pulseaudio \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/ms-playwright/chromium-1223/chrome-linux/chrome

COPY package*.json ./
RUN npm install

COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]