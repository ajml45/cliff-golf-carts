# Cliff Island Fleet Status

A static, mobile-first status page for the McLaughlin estate fleet: two aging golf carts
and one alarmingly reliable 1991 motorcycle. Tracks cart availability, per-vehicle uptime,
and a leaderboard the motorcycle always wins. All statuses and numbers are **derived** from
one hand-edited data file — `data/fleet.json`.

No framework, no build step. Plain HTML/CSS/JS.

## Edit the fleet
Everything lives in **`data/fleet.json`**. Add an outage by appending to the `outages`
array and committing — Cloudflare Pages re-publishes automatically. An open (ongoing)
outage uses `"end": null`. Dates are `YYYY-MM-DD`; `end` is the **last full day down**
(operational again the next day). Times are America/New_York.

## Add a photo
1. Optimize it (creates a ~1600px WebP + JPG fallback in `images/`):
   ```sh
   ./scripts/convert-image.sh bug-hero ~/Desktop/your-photo.jpg
   ```
   (needs `brew install webp` for `cwebp`; `sips` is built into macOS.)
2. Reference it in `data/fleet.json` under the vehicle's `photos`:
   `{ "file": "bug-hero", "alt": "…", "caption": "…" }` (no file extension).
- Filenames: lowercase, no spaces, hyphenated, ending in the vehicle id.
- **Do not** add VIN/emission-label photos — they're spec reference only.

## Run locally
`fetch()` needs http (not `file://`):
```sh
python3 -m http.server 8000
```
Then open <http://localhost:8000/> and <http://localhost:8000/tests.html> (metric self-tests).

## Deploy (Cloudflare Pages)
Connect this repo with **no build command** and output directory = repo root, or use Direct
Upload. Add the custom domain `carts.<yourdomain>`.
