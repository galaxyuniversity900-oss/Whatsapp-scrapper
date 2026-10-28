## First-time setup on Android

This setup uses the phone and Termux locally. It does **not** use Browserless or a remote browser.

If the repository is already at `~/Whatsapp-scrapper`, run:

```bash
cd ~/Whatsapp-scrapper
bash scripts/termux-setup.sh
```

The script requests Android shared-storage permission, installs Node.js/Git/cURL, and installs runtime npm dependencies without Electron. App database, WhatsApp LocalAuth profile, API token, and encryption key remain under Termux's private home directory (`~/.whatsapp-scrapper`) because Android shared storage can break browser profile permissions and file-lock behavior. Shared-storage permission is for importing/exporting files, not for placing the live browser profile there.

The server detects Termux and defaults WhatsApp Web to local headless Chromium. This only works if a compatible Chromium binary is actually installed and can run on the device. Check `command -v chromium` and `bash scripts/termux-service.sh logs`; package installation and service health do not prove WhatsApp login works.

# Termux persistent local service

This helper runs the existing Node.js HTTP service in the background, records logs, and restarts the service after an unexpected exit. It installs no packages and makes no network requests by itself.

## Start

```bash
cd ~/Whatsapp-scrapper
bash scripts/termux-service.sh start
```

Open `http://127.0.0.1:8787` in the phone's browser.

## Manage

```bash
bash ~/Whatsapp-scrapper/scripts/termux-service.sh status
bash ~/Whatsapp-scrapper/scripts/termux-service.sh logs
bash ~/Whatsapp-scrapper/scripts/termux-service.sh stop
bash ~/Whatsapp-scrapper/scripts/termux-service.sh restart
```

Logs and PID/stop state live under `~/.whatsapp-scrapper-termux/`. The project remains in `~/Whatsapp-scrapper`. Override the project directory with `WA_PROJECT_DIR=/path/to/project`; override the bind address/port with `HOST` and `PORT`.

## Android limitations

This is best-effort background operation, not a guarantee of 24/7 uptime. Android battery management, force-stop, reboot, low memory, network loss, or Termux process restrictions can stop it. Set Termux battery use to Unrestricted where available and run `termux-wake-lock` in the Termux session if installed. A reboot still requires starting the service again unless a separately configured boot integration is installed.

## Safety

Keep the service bound to `127.0.0.1` for phone-only access. Do not bind it to `0.0.0.0` on public or untrusted networks unless authentication and firewalling are verified. Use only WhatsApp accounts and recipient data you are authorized to access; sending workflows should honor explicit consent.
