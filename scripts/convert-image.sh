#!/usr/bin/env bash
# convert-image.sh — optimize one phone photo for the fleet site.
# Produces images/NAME.webp (primary, ~1600px, WebP) + images/NAME.jpg (fallback).
#
#   ./scripts/convert-image.sh NAME path/to/source.jpg
#   e.g. ./scripts/convert-image.sh bug-hero ~/Desktop/IMG_2031.jpg
#
# Requirements (macOS):
#   - cwebp   ->  brew install webp
#   - sips    ->  built in
#
# NAME must be lowercase, no spaces, and match the "file" value in data/fleet.json.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 NAME path/to/source.jpg" >&2
  exit 1
fi

NAME="$1"
SRC="$2"
OUTDIR="$(cd "$(dirname "$0")/.." && pwd)/images"
MAXW=1600

if [ ! -f "$SRC" ]; then
  echo "error: source file not found: $SRC" >&2
  exit 1
fi
if ! command -v cwebp >/dev/null 2>&1; then
  echo "error: cwebp not found. Install with:  brew install webp" >&2
  exit 1
fi
mkdir -p "$OUTDIR"

# Normalize the source to a temp JPEG first, so HEIC (iPhone), PNG, etc. all work.
# `sips` is built into macOS and reads HEIC/PNG/JPG.
TMP="$(mktemp -t fleetimg).jpg"
trap 'rm -f "$TMP"' EXIT
sips -s format jpeg "$SRC" --out "$TMP" >/dev/null

# JPG fallback: resize longest side to MAXW (orientation-safe for portrait or landscape).
sips -Z "$MAXW" "$TMP" --out "$OUTDIR/$NAME.jpg" >/dev/null

# WebP primary: encode FROM the already-resized JPG so both files share identical
# dimensions regardless of orientation. Quality 80.
cwebp -quiet -q 80 "$OUTDIR/$NAME.jpg" -o "$OUTDIR/$NAME.webp"

echo "✓ wrote images/$NAME.webp and images/$NAME.jpg"
echo "  reference it in data/fleet.json as:  \"file\": \"$NAME\""
