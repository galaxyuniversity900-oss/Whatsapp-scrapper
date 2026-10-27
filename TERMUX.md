# Termux-only setup

This branch uses the local WhatsApp Web session through `whatsapp-web.js`. It does not use WhatsApp Cloud API, Browserless, or a remote browser service. The server binds only to `127.0.0.1:8787`.

## Install on Android / Termux

From the repository folder:

```bash
pkg install nodejs-lts chromium
export PUPPETEER_SKIP_DOWNLOAD=1
npm install --omit=dev
```

The initial npm install needs internet access to download packages. Electron development dependencies are omitted; Termux uses the local web interface.

## Start

```bash
bash scripts/termux-start.sh
```

Open `http://127.0.0.1:8787` in the phone browser. Keep Termux running while using the app. Connect WhatsApp by scanning the QR code from **Linked devices** in WhatsApp.

## Validate

```bash
npm run termux:local
```

Automated tests validate code and local-only configuration. They do not replace an on-device QR login and a test message to a consenting recipient.

## Data and limits

- Local data is stored under `~/.whatsapp-scrapper` by default. Do not delete that directory if you want to preserve sessions and data.
- WhatsApp Web automation depends on the installed Chromium version and the upstream library; it is not an official WhatsApp Business API.
- Termux and the local server must remain active.
- Use only recipients who explicitly consented to receive messages.
