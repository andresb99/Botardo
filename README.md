# Botardo (Discord Music + Pokemon Bot)

Discord bot built with Node.js to play music from YouTube/Spotify links, answer questions with Gemini, and run a Pokemon mini game with pulls and PvP battles.

## Features

- Prefix commands (`!play`, `!queue`, etc.).
- Music queue with skip, pause, resume, and clear.
- Spotify track/album/playlist support (resolved to YouTube audio).
- Twitch/YouTube stream URL support for voice audio.
- `!ask` command powered by Gemini.
- Pokemon mini-game with rarity pulls, visual cards/carousels, team setup, learn/forget systems, items, and turn-based PvP battle UI with competitive-style damage calc.

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
QUEUE_IDLE_DISCONNECT_SECONDS=180
POKEMON_START_PULLS=20
POKEMON_DAILY_PULLS=5
POKEMON_DAILY_COOLDOWN_MINUTES=
POKEMON_DAILY_COOLDOWN_HOURS=24
POKEMON_MAX_PULL_BATCH=10
POKEMON_TEAM_SIZE=6
POKEMON_BATTLE_LEVEL=50
POKEMON_CAPTURE_LEVEL=5
POKEMON_START_MONEY=3000
POKEMON_DAILY_MONEY=600
POKEMON_PVP_MONEY_WIN=500
POKEMON_PVP_MONEY_LOSS=200
POKEMON_PVP_XP_WIN=80
POKEMON_PVP_XP_LOSS=35
POKEMON_MAX_DEX_ID=1025
POKEMON_ITEM_API_LIMIT=2500
POKEMON_USE_FIREBASE=
FIREBASE_SERVICE_ACCOUNT_JSON=
FIREBASE_SERVICE_ACCOUNT_BASE64=
FIREBASE_DATABASE_URL=
FIREBASE_POKEMON_COLLECTION=pokemonGuilds
```

Notes:

- Spotify audio is not streamed directly; tracks are matched and played from YouTube.
- `SPOTIFY_REFRESH_TOKEN` is recommended for better playlist access.
- `SPOTIFY_MAX_TRACKS` limits how many Spotify tracks are imported per command.
- `QUEUE_IDLE_DISCONNECT_SECONDS` keeps the bot in voice after queue ends (default: 180s).
- Pokemon profiles are in-memory by default. For persistence, configure Firebase vars and install deps with `npm install`.
- For Firebase, use either `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_BASE64`.
- `POKEMON_DAILY_COOLDOWN_MINUTES` overrides `POKEMON_DAILY_COOLDOWN_HOURS` when set.
- `POKEMON_CAPTURE_LEVEL` defines the initial level for newly captured Pokemon.
- `POKEMON_START_MONEY` sets the initial balance for each player profile.
- `POKEMON_DAILY_MONEY` adds money rewards to `!pokedaily`.
- `POKEMON_PVP_MONEY_WIN` / `POKEMON_PVP_MONEY_LOSS` define PvP money rewards.
- `POKEMON_PVP_XP_WIN` / `POKEMON_PVP_XP_LOSS` define per-Pokemon XP gain after PvP battles.
- `POKEMON_ITEM_API_LIMIT` controls how many item entries are loaded from PokeAPI for `!pokestore`.

## Install and Run

```bash
npm install
npm start
```

Dev mode (auto-restart on file changes):

```bash
npm run dev
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

- `!help`: Show command summary (music, queue, AI, Pokemon entrypoint).
- `!play <url or search>`: Add a song, playlist, or stream URL to queue.
- `!stream <url>`: Alias of `!play` (useful for stream links).
- `!skip`: Skip current track.
- `!skipto <position>` (`!jump` / `!jumpto`): Skip directly to a queue position.
- `!playnext <position>` (`!upnext` / `!nextup`): Move a queued song to play immediately after the current song.
- `!timeskip <seconds>` (`!seek` / `!ts`): Jump forward inside current song. If it exceeds song duration, it skips to next track.
- `!move <from> <to>` (`!movetrack` / `!reorder`): Move a queued song to a new position (shifts others).
- `!remove <position>` (`!rm` / `!del`): Remove a queued song by position.
- `!prev`: Play the previously played track.
- `!stop`: Stop playback, clear queue, disconnect bot.
- `!clear`: Clear queue only (keep current track playing).
- `!pause`: Pause playback.
- `!resume`: Resume playback.
- `!queue`: Show current track and queued tracks.
- `!allqueue` / `!all queue`: Show full session list (history + current + pending) in a paginated card with buttons.
- `!ask <question>`: Ask Gemini and reply in chat.
- `!pokehelp`: Show Pokemon mini-game commands.
- `!pokepulls`: Show your available Pokemon pulls and daily cooldown.
- `!pokedaily`: Claim daily pulls.
- `!pokepull <amount>`: Roll random Pokemon with weighted rarity odds. Single pull shows image; multi-pull opens a button carousel.
- `!pokeinv [page|@user [page]]`: Show your inventory or inspect another user's Pokemon inventory in a visual carousel.
- `!poketeam`: Show current team slots.
- `!poketeam set <slot> <PKxxxx>`: Assign a captured Pokemon to team slot.
- `!poketeam clear <slot>`: Clear a team slot.
- `!pokeitems [page]`: Show your full item bag (all game items, unlimited capacity) and equipped items by team slot.
- `!pokestore [page] [filter]`: Browse the full game item catalog from PokeAPI with prices.
- `!pokebuy <item> [amount]`: Buy items with your money (no artificial stack cap).
- `!pokemoney`: Show your current money balance.
- `!pokeitem equip <slot> <item>`: Equip any valid game item to a Pokemon.
- `!pokeitem unequip <slot>`: Remove the currently held item from a Pokemon.
- `!pokeuse <item> <slot|PKxxxx|index> [amount]`: Use consumable items on a Pokemon (e.g., `rare-candy`, `exp-candy-*`, vitamins, EV berries, evolution items, ability items).
- `!pokeability <slot>`: Show ability loadout for the Pokemon in a team slot.
- `!pokeability set <slot> <ability>`: Set the active ability (must be unlocked).
- `!pokeability learn <slot> <ability>`: Learn/unlock an ability from species abilities.
- `!pokeability forget <slot> <ability>`: Forget an unlocked ability.
- `!pokemoves <slot>`: Show configured, known, and learnable moves in a visual card.
- `!pokemoves set <slot> <move1|move2|move3|move4>`: Configure up to 4 equipped battle moves.
- `!pokemoves learn <slot> <move>`: Learn a move from the Pokemon move pool.
- `!pokemoves forget <slot> <move>`: Forget a previously learned move.
- `!pokedex <number|name>` (`!dex` / `!pdex`): Show a full Pokedex card for a species using PokeAPI data.
- `!pokestat <slot|PKxxxx|index>` (`!pokestats` / `!pstats`): Inspect a specific Pokemon and view base stats, calculated battle stats, IVs, and EVs.
- `!evolve <slot|PKxxxx|index> [target=<species>]`: Evolve a Pokemon if it meets evolution requirements.
- `!pokebattle @user`: Challenge another player in the server.
- `!pokebattlecancel`: Cancel your pending challenge.

Queue position notes:
- When a song is already playing, position `1` is the current track and position `2` is the next pending track.
- `!move` cannot move position `1` (currently playing track).
- `!playnext` keeps the current song and only changes what comes next.

## Stream Behavior

- The bot can play stream audio in voice channels (e.g., Twitch/YouTube live links).
- Bots cannot start Discord video/screen-share sessions through the public bot API.

## Examples

```txt
!help
!play bad bunny titi me pregunto
!play https://www.youtube.com/watch?v=tmYIY3m7X2U
!stream https://www.twitch.tv/elxokas
!play https://open.spotify.com/playlist/37i9dQZF1DX2apWzyECwyZ
!skipto 27
!playnext 20
!move 27 2
!remove 14
!timeskip 45
!pokepull 3
!pokeinv @friend 2
!evolve PK0001
!pokestore 1 potion
!pokebuy potion 250
!pokeuse rare-candy PK0001
!pokedex 25
!pokedex bulbasaur
!pokestat PK0001
!poketeam set 1 PK0001
!pokebattle @friend
!queue
!ask explain closures in JavaScript with examples
```
