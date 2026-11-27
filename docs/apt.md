# Debian and Ubuntu package repository

Install Papilot on amd64 Debian and Ubuntu systems from the official signed APT repository at `https://papilot.ai/apt`.

Published signing-key fingerprint:

```text
880137ACF48D4E8CA78CE9857A85E7B6DD990D51
```

Download and inspect the key before trusting it:

```sh
curl -fsSL https://papilot.ai/apt/gpg.key -o /tmp/papilot-signing.key
gpg --show-keys --with-fingerprint /tmp/papilot-signing.key
```

Confirm that the printed fingerprint matches `880137ACF48D4E8CA78CE9857A85E7B6DD990D51`, then add the repository with a scoped keyring and install Papilot:

```sh
sudo install -d -m 755 /etc/apt/keyrings
sudo gpg --dearmor --output /etc/apt/keyrings/papilot.gpg /tmp/papilot-signing.key
sudo chmod 644 /etc/apt/keyrings/papilot.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/papilot.gpg] https://papilot.ai/apt stable main" |
  sudo tee /etc/apt/sources.list.d/papilot.list
sudo apt update
sudo apt install papilot
```

The concrete package is `papilot-desktop`; it provides `papilot`. Upgrade it with `sudo apt update && sudo apt install --only-upgrade papilot-desktop`. The packaged app leaves application updates to APT and can still install agents into your user data. Projects and settings remain in the usual data directory.

## Maintainer architecture

Signed APT metadata (`gpg.key`, `papilot.gpg`, `dists/stable/*`, and `by-hash` indexes) lives in [PapilotAI/apt](https://github.com/PapilotAI/apt) and is served via `https://papilot.ai/apt` by `site/worker.mjs`. Package downloads under `/apt/pool/...` issue an HTTP 302 redirect to the exact verified `.deb` asset on GitHub Releases while APT verifies the signed SHA-256 checksum.

1. `PapilotAI/apt` holds `APT_GPG_PRIVATE_KEY` (Actions secret) and `APT_GPG_FINGERPRINT` (Actions variable) and syncs automatically every 30 minutes (or immediately when dispatched via `PACKAGES_DISPATCH_TOKEN`).
2. `PapilotAI/papilot`'s Release workflow calls **Publish APT package** after all desktop installers are uploaded to dispatch an immediate sync (when `PACKAGES_DISPATCH_TOKEN` is set) and verify the live signed APT metadata.
3. Older release entries are retained in `metadata/packages.json` so existing clients reading a slightly older index can still fetch verified packages. When rotating the signing key, publish the new fingerprint and keyring instructions before switching keys.
