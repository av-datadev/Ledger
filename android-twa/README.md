# Brick Flow — Android app (Trusted Web Activity)

This wraps the live PWA at `ledger-nu-ashen.vercel.app` in a Trusted Web
Activity (TWA) for the Play Store — a thin Android shell that opens the real
app inside Chrome's engine, full-screen, with no browser UI. There is no
separate Android codebase to maintain: everything the app does still lives in
`src/`. This directory is packaging only.

Generated with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
(`@bubblewrap/cli`) from the site's own `manifest.webmanifest`, driven
programmatically rather than through its interactive wizard so the result is
reproducible. `package_name`: `app.brickflow.twa`.

## The signing key — read this before doing anything else

`android-keystore.jks` is **not in this repo** (gitignored) and exists only on
the machine that generated it. It is the Play Store **upload key** — the
credential that proves updates to this app come from the same developer as
the original release. Google Play App Signing means losing it isn't fully
fatal (Play can reset the upload key on request, backed by identity
verification, taking several days) but it is a real outage to avoid.

**Back up immediately, before doing anything else with this project:**
- `android-twa/android-keystore.jks`
- The keystore + key passwords, saved on the generating machine at
  `~/.brickflow-secrets/play-signing.txt` (also not in git)

Put both somewhere durable — a password manager, encrypted drive — that
survives this machine being wiped.

## assetlinks.json

`public/.well-known/assetlinks.json` (in the main app, not here) is what lets
Android trust this app enough to hide the browser address bar. Its
`sha256_cert_fingerprints` must match this project's signing certificate,
reproduced in `signing-fingerprints.json` alongside this README (that file
itself is safe to commit — a public key fingerprint isn't a secret, it's what
you'd hand to a relying party).

**After the app exists in Play Console and has been uploaded once**, Google
re-signs the distributed build with its own **Play App Signing** key, whose
fingerprint differs from the local upload key's. Fetch it from
**Play Console → Setup → App signing → App signing key certificate** and add
it as a *second* entry in `sha256_cert_fingerprints`. Skipping this step is
why a TWA that works from a local sideload can still show a browser toolbar
once installed from the real Play Store — Android checks the certificate that
actually shipped, not the one used to build it.

## Rebuilding

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export BUBBLEWRAP_KEYSTORE_PASSWORD="<from the secrets file>"
export BUBBLEWRAP_KEY_PASSWORD="<same value — see below>"
cd android-twa
npx @bubblewrap/cli build --skipPwaValidation
```

Produces `app-release-bundle.aab` (upload this to Play Console) and
`app-release-signed.apk` (for sideloaded testing). Both are gitignored.

**Keystore and key password are intentionally identical.** PKCS12 — the
default Java keystore format since JDK 9, and what `keytool` produces here —
doesn't reliably honor a *different* per-key password from the store
password; setting them differently produced a keystore where `apksigner`
failed with "wrong password" even though the store password itself was
correct. Keep them equal on any future regeneration.

## Bumping the version for an update

Play requires `appVersionCode` to strictly increase on every upload. Edit
`twa-manifest.json` (`appVersionCode`, `appVersionName`), then either hand-run
`generateManifestChecksumFile` or just delete `manifest-checksum.txt` before
building — `bubblewrap build` refuses to run if the manifest's checksum
doesn't match what it saw last, as a guard against building from a
half-edited manifest.

## Toolchain this was built with

Android cmdline-tools, platform 36, build-tools 36.1.0, installed under
`~/Library/Android/sdk` — none of that is inside this repo, so a fresh
machine needs it reinstalled before `bubblewrap build` will run.
