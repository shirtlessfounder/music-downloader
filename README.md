# music-downloader

Bootstrap repository for the Forge-managed `music-downloader` product.

## Commands

- `npm install`
- `npm test`
- `npm run test:e2e`
- `npm run build`

## SoundCloudDL Provider

`soundclouddl` is a browser-backed MP3 fallback.
It runs after stronger free sources like `hypeddit` and `reddit`.
The planner first resolves a SoundCloud track candidate, then sends that chosen URL into the converter provider.
