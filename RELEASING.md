# Releasing

Installers are built by GitHub Actions on GitHub's own Mac and Windows machines,
so you don't need either computer.

## Publish a version

1. Set the version in **both** `package.json` and `src-tauri/tauri.conf.json`
   (for example `0.2.0`).
2. Commit, then tag and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. Open **Actions → Release** and wait for both jobs (about 15–20 minutes).
4. Open **Releases**. A **draft** release has the `.dmg` (Mac, Apple silicon and
   Intel) and the `-setup.exe` (Windows). Check them, then press **Publish**.

To test a build without publishing anything: **Actions → Release → Run workflow**.
The installers appear as downloadable artifacts on that run's page.

## Optional: remove the security warnings (code signing)

Without signing, the installers work but warn on first open:

- **macOS** says the app "can't be opened because Apple cannot check it".
  Users get past it with right-click → **Open** → **Open**.
- **Windows** SmartScreen says "Windows protected your PC". Users press
  **More info** → **Run anyway**.

### macOS (Apple Developer Program, $99/year)

Add these under **Settings → Secrets and variables → Actions → Secrets**. The
next release is then signed and notarized automatically, with no warning.

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | Your *Developer ID Application* certificate exported as `.p12`, then base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | An *app-specific password* from appleid.apple.com |
| `APPLE_TEAM_ID` | Your 10-character team ID |

### Windows

Windows signing needs a code-signing certificate from a certificate authority,
or Azure Trusted Signing. It is not wired into the workflow yet, because the
setup depends on which one you choose.

## Optional: automatic updates

When this is set up, installed copies find new releases themselves and update
from **Settings → Updates**. Updates are verified with a key only you hold, so
nobody else can push one.

1. On your own computer, run:
   ```bash
   npx tauri signer generate -w ~/.tauri/ai-control-center.key
   ```
   It prints a **public key** and saves the **private key** to that file. Keep
   the private key secret and backed up: if you lose it, existing installs can
   never be updated again.
2. In **Settings → Secrets and variables → Actions**:
   - **Variables** tab: add `UPDATER_PUBKEY` = the public key.
   - **Secrets** tab: add `TAURI_SIGNING_PRIVATE_KEY` = the contents of the
     private key file, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you set one.
3. Publish a release as above. From then on, every release also uploads
   `latest.json`, which installed copies check.

Only copies installed **after** step 2 can update themselves. Anything installed
before that has to be downloaded once more by hand.
