# Botardo (Discord Music Bot)

Discord bot built with Node.js to play music from YouTube/Spotify links and answer questions with Gemini.

## Features

- Prefix commands (`!play`, `!queue`, etc.).
- Music queue with skip, pause, resume, and clear.
- Spotify track/album/playlist support (resolved to YouTube audio).
- Twitch/YouTube stream URL support for voice audio.
- `!ask` command powered by Gemini.

## Requirements

- Node.js 20+ (22+ recommended).
- A Discord bot application and token.
- `Message Content Intent` enabled in Discord Developer Portal.
- Spotify app credentials (optional but recommended for Spotify links).
- Gemini API key for `!ask`.

## Environment Variables

Create `.env` based on `.env.example`:

```env
DISCORD_TOKEN=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REFRESH_TOKEN=
SPOTIFY_MARKET=US
SPOTIFY_MAX_TRACKS=500
```

Notes:

- Spotify audio is not streamed directly; tracks are matched and played from YouTube.
- `SPOTIFY_REFRESH_TOKEN` is recommended for better playlist access.
- `SPOTIFY_MAX_TRACKS` limits how many Spotify tracks are imported per command.

## Install and Run

```bash
npm install
npm start
```

If PowerShell blocks `npm`, run:

```bash
npm.cmd start
```

Run tests:

```bash
npm test
```

## Commands

- `!play <url or search>`: Add a song, playlist, or stream URL to queue.
- `!stream <url>`: Alias of `!play` (useful for stream links).
- `!skip`: Skip current track.
- `!timeskip <seconds>` (`!seek` / `!ts`): Jump forward inside current song. If it exceeds song duration, it skips to next track.
- `!prev`: Play the previously played track.
- `!stop`: Stop playback, clear queue, disconnect bot.
- `!clear`: Clear queue only (keep current track playing).
- `!pause`: Pause playback.
- `!resume`: Resume playback.
- `!queue`: Show current track and queued tracks.
- `!allqueue` / `!all queue`: Show full session list (history + current + pending).
- `!ask <question>`: Ask Gemini and reply in chat.

## Stream Behavior

- The bot can play stream audio in voice channels (e.g., Twitch/YouTube live links).
- Bots cannot start Discord video/screen-share sessions through the public bot API.

## Examples

```txt
!play bad bunny titi me pregunto
!play https://www.youtube.com/watch?v=tmYIY3m7X2U
!stream https://www.twitch.tv/elxokas
!play https://open.spotify.com/playlist/37i9dQZF1DX2apWzyECwyZ
!timeskip 45
!queue
!ask explain closures in JavaScript with examples
```
