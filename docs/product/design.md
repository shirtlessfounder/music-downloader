# Music Downloader Product Design

This file is the repo-local copy of the approved product design.

## Goal

Build a local web app that:

1. accepts one Spotify playlist URL or SoundCloud playlist URL
2. runs a resumable background acquisition job
3. produces:
   - `downloads.zip`
   - `misses.txt`
   - `manifest.json`
   - a run report page

## Core Rules

- authorized download sources only
- optimize for DJ/electronic sources first
- modular provider architecture
- free sources run automatically
- Beatport is the last-resort paid fallback
- Beatport purchases are reviewed as one aggregated queue
- prefer `Extended Mix`
- then prefer `Original Mix`
- if no exact preferred mix exists, accept a high-confidence non-extended version only when it is longer than 4 minutes
- otherwise mark as miss
- prefer MP3
- accept WAV when MP3 is unavailable

## Architecture Shape

- local web app
- resumable background jobs
- canonical track catalog
- provider registry
- shared browser/session layer
- explicit matching and rejection rules
- artifact packaging for zip, miss list, manifest, and run report

## Scope Notes

- provider research is part of product scope
- planner should decompose the whole scope into worker-sized issues
- implementation should stay modular so additional providers can be added later
