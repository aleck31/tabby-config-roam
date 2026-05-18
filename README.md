# tabby-config-roam

Roam your [Tabby](https://github.com/Eugeny/tabby) config across devices via cloud storage.

## Features

- **Category-based sync** — choose what to sync: profiles, vault, appearance, SSH settings, app settings
- **AES-256-GCM encryption** — user-defined passphrase, PBKDF2 key derivation (100,000 iterations)
- **Auto sync** — detects config changes and uploads automatically; periodic pull from remote
- **Conflict detection** — timestamp + device ID based, prevents accidental overwrites
- **S3 compatible** — AWS S3, MinIO, Wasabi, DigitalOcean Spaces, Backblaze B2, Cloudflare R2, etc.

## Sync Categories

| Category | Data |
|----------|------|
| **Profiles** | SSH/Serial/Local Shell connections, groups, profile defaults |
| **Vault** | Private keys, saved passwords (encrypted blob) |
| **Appearance** | Theme, font, hotkeys, accessibility, language |
| **SSH** | Known hosts, agent configuration |
| **App** | Update settings, plugin blacklist, hacks, tray behavior |

Each category is stored as a separate encrypted file on S3. You can enable/disable any combination.

## S3 File Structure

```
<prefix>/
├── README.txt       ← created by Test Connection
├── master.key       ← Data Encryption Key (encrypted by passphrase)
├── profiles.enc     ← SSH connections & groups
├── vault.enc        ← private keys & passwords
├── appearance.enc   ← theme, hotkeys, font
├── ssh.enc          ← known hosts, agent settings
└── app.enc          ← app-level preferences
```

## Install

### From Tabby Plugin Manager

Search for `tabby-config-roam` in Settings → Plugins → Available.

### Manual Install

1. Build the plugin:

```bash
git clone https://github.com/aleck31/tabby-config-roam.git
cd tabby-config-roam
npm install
npm run build
```

2. Copy `package.json` and `dist/` to Tabby's plugin directory:

| OS | Path |
|----|------|
| Windows | `%APPDATA%\tabby\plugins\node_modules\tabby-config-roam\` |
| macOS | `~/Library/Application Support/tabby/plugins/node_modules/tabby-config-roam/` |
| Linux | `~/.config/tabby/plugins/node_modules/tabby-config-roam/` |

3. Restart Tabby.

## Configuration

1. Open Tabby → Settings → **Config Roam** tab
2. Fill in S3 credentials (Region, Bucket, Prefix, AK/SK)
3. Set an encryption passphrase (required)
4. Select which categories to sync
5. Click **Test Connection** → verify S3 is reachable
6. Click **Save Settings**
7. Click **Upload Now** (first device) or **Download Now** (second device)
8. Optionally enable **Auto Sync**

## How It Works

```
┌─────────────┐         ┌──────────────────────┐         ┌─────────────┐
│  Device A   │         │      S3 Bucket       │         │  Device B   │
│             │         │                      │         │             │
│ config.yaml │──parse──▶ profiles.enc         │         │             │
│   changed   │  split  │ vault.enc            ◀──pull───│ merge into  │
│             │ encrypt │ appearance.enc       │ decrypt │ config.yaml │
│             │ upload  │ ssh.enc              │         │             │
│             │         │ app.enc              │         │             │
└─────────────┘         └──────────────────────┘         └─────────────┘
```

## Security

Uses **envelope encryption** (same pattern as AWS KMS, 1Password, LUKS):

```
Passphrase → PBKDF2 → KEK (Key Encryption Key)
                         ↓
                    master.key (encrypts/decrypts the DEK)
                         ↓
                    DEK (Data Encryption Key, random, AES-256-GCM)
                         ↓
                    *.enc files (actual config data)
```

- **Changing passphrase** only re-encrypts `master.key` (~seconds), data files are untouched
- Passphrase never leaves your device — only the derived KEK is used
- Each category file is independently encrypted with AES-256-GCM
- Passphrase is optional — without it, data is uploaded in plain text (warning shown in UI)
- Works alongside Tabby's built-in vault encryption (double encryption for secrets)
- Plugin config (`configRoam` key) is never synced to remote

## S3-Compatible Services

Set the **Custom Endpoint** field:

| Service | Endpoint |
|---------|----------|
| MinIO | `http://localhost:9000` |
| Wasabi | `https://s3.wasabisys.com` |
| DigitalOcean Spaces | `https://nyc3.digitaloceanspaces.com` |
| Backblaze B2 | `https://s3.us-west-000.backblazeb2.com` |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` |

## Development

```bash
npm install
npm run build        # production build
npm run dev          # watch mode

# Test in Tabby with debug mode
TABBY_PLUGINS=/path/to/tabby-config-roam tabby --debug
```

## Roadmap

- [ ] Google Drive adapter
- [ ] Selective field-level sync within categories
- [ ] Manual conflict resolution UI
- [ ] Sync history / rollback

## License

MIT
