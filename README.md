# WAR JETS — P2P Multiplayer

**Works on GitHub Pages.** No server needed. Uses WebRTC (PeerJS) so players connect directly browser-to-browser.

---

## Deploy to GitHub Pages

### Step 1 — Set your repo name in next.config.ts

Open `next.config.ts` and uncomment + set the two lines to match your GitHub repo name:

```ts
basePath: '/your-repo-name',
assetPrefix: '/your-repo-name/',
```

For example, if your repo URL is `https://github.com/harshadhindlekar/war--jets-multiplayer`, set:
```ts
basePath: '/war--jets-multiplayer',
assetPrefix: '/war--jets-multiplayer/',
```

### Step 2 — Build

```bash
npm install
npm run build
```

This creates an `out/` folder with pure static HTML/JS/CSS.

### Step 3 — Push to GitHub Pages

**Option A — GitHub Actions (recommended)**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./out
```

**Option B — Manual**

```bash
npm run build
cd out
git init
git add .
git commit -m "deploy"
git push -f https://github.com/YOUR_USERNAME/YOUR_REPO.git main:gh-pages
```

Then in GitHub repo → Settings → Pages → set branch to `gh-pages`.

---

## How to Play

1. **Host:** Open the site, click **HOST GAME**
   - A big yellow **6-letter room code** appears (e.g. `AB3X7K`)
   
2. **Guests:** Open the same URL, click **JOIN GAME**
   - Enter the host's room code
   - Up to 4 players total

3. **Host presses START MISSION** when everyone is in the lobby

4. After game over / victory, host presses **RETRY / PLAY AGAIN**

### Controls

| Action    | Keys             |
|-----------|-----------------|
| Move      | WASD / Arrows   |
| Fire      | Space           |
| Weapon 1  | `1` — Cannon    |
| Weapon 2  | `2` — Missiles  |
| Weapon 3  | `3` — Laser     |
| Weapon 4  | `4` — Plasma    |
| Bomb      | `B`             |

Touch controls (D-pad + FIRE/WEAPON/BOMB buttons) appear on mobile.

---

## How the P2P Works

```
HOST browser                    GUEST browsers
────────────────                ──────────────────────
GameEngine.ts runs here         No game engine
Ticks at 30fps                  Just renders snapshots
                   ←──────────  Send: input events
                   ──────────→  Receive: full state (20fps)
                   ──────────→  Receive: explosion/sfx events
```

- Uses **PeerJS** (WebRTC DataChannel) — free public TURN/STUN servers included
- Room codes map to PeerJS IDs: `warjets-AB3X7K`
- Works on the same Wi-Fi AND across the internet (WebRTC handles NAT traversal)
- No backend, no database, no monthly cost

---

## Run Locally (dev mode)

```bash
npm install
npm run dev
# open http://localhost:3000
```

In dev mode, `basePath` is not set so the game runs at `/`.
