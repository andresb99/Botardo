require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const playdl = require('play-dl');
const ytDlp = require('yt-dlp-exec');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { handleCommand } = require('./src/command-handler');
const { PokemonMiniGame } = require('./src/pokemon-game');
const { createFirestorePokemonStoreFromEnv } = require('./src/pokemon-firestore-store');

const PREFIX = '!';
const TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || 'US';
const SPOTIFY_MAX_TRACKS = Math.max(1, Math.min(1000, Number(process.env.SPOTIFY_MAX_TRACKS || 500)));
const HISTORY_LIMIT = 50;
const QUEUE_IDLE_DISCONNECT_MS = Math.max(0, Number(process.env.QUEUE_IDLE_DISCONNECT_SECONDS || 180)) * 1000;
const SYSTEM_FFMPEG_PATH = process.env.FFMPEG_PATH || ffmpegPath || 'ffmpeg';

if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

const queues = new Map();
const pokemonStore = createFirestorePokemonStoreFromEnv();
if (!pokemonStore) {
  console.log('[Pokemon] Persistencia en memoria activa (sin Firestore).');
}
const pokemonGame = new PokemonMiniGame({
  persistence: pokemonStore,
});
const spotifyCache = {
  user: { accessToken: null, expiresAt: 0 },
  app: { accessToken: null, expiresAt: 0 },
};

function isValidUrl(value) {
  if (!value || value === 'undefined') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeQueryInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^<(.+)>$/, '$1')
    .replace(/^`(.+)`$/, '$1')
    .replace(/^"(.+)"$/, '$1')
    .replace(/^'(.+)'$/, '$1')
    .trim();
}

function isSpotifyUrl(value) {
  const cleaned = sanitizeQueryInput(value);
  if (!isValidUrl(cleaned)) return false;
  const host = new URL(cleaned).hostname.toLowerCase();
  return host.includes('spotify.com');
}

function isSpotifyShortUrl(value) {
  const cleaned = sanitizeQueryInput(value);
  if (!isValidUrl(cleaned)) return false;
  const host = new URL(cleaned).hostname.toLowerCase();
  return host.includes('spotify.link') || host.includes('spoti.fi');
}

function isYouTubeUrl(value) {
  const cleaned = sanitizeQueryInput(value);
  if (!isValidUrl(cleaned)) return false;
  const host = new URL(cleaned).hostname.toLowerCase();
  return (
    host === 'youtu.be' ||
    host.endsWith('youtube.com') ||
    host.endsWith('youtube-nocookie.com')
  );
}

function isYouTubePlaylistLikeUrl(value) {
  const cleaned = sanitizeQueryInput(value);
  if (!isValidUrl(cleaned) || !isYouTubeUrl(cleaned)) return false;
  const parsed = new URL(cleaned);
  if (parsed.searchParams.get('list')) return true;
  return /^\/playlist(?:\/|$)/i.test(parsed.pathname);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveSpotifyRedirect(url) {
  if (!isSpotifyShortUrl(url)) return url;
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)',
      },
    });
    if (isValidUrl(response.url)) {
      return response.url;
    }
  } catch {
    // ignore redirect resolution errors and keep original URL
  }
  return url;
}

function normalizeSpotifyInput(value) {
  const raw = sanitizeQueryInput(value);
  const uriMatch = raw.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)$/i);
  if (uriMatch) {
    const type = uriMatch[1].toLowerCase();
    const id = uriMatch[2];
    return {
      isSpotify: true,
      url: `https://open.spotify.com/${type}/${id}`,
      type,
      id,
      kind: `sp_${type}`,
    };
  }

  if (!isValidUrl(raw)) {
    return { isSpotify: false, url: raw, kind: null };
  }

  const parsed = new URL(raw);
  if (!parsed.hostname.toLowerCase().includes('spotify.com')) {
    return { isSpotify: false, url: raw, kind: null };
  }

  const path = parsed.pathname
    .replace(/^\/intl-[^/]+/i, '')
    .replace(/^\/embed\//i, '/');
  let match = path.match(/^\/(track|album|playlist)\/([A-Za-z0-9]+)\/?$/i);

  if (!match) {
    // Legacy URL format: /user/<name>/playlist/<id>
    const legacy = path.match(/^\/user\/[^/]+\/playlist\/([A-Za-z0-9]+)\/?$/i);
    if (legacy) {
      match = ['playlist', 'playlist', legacy[1]];
    }
  }

  if (!match) {
    const loose = raw.match(/(?:track|album|playlist)[/:]([A-Za-z0-9]{22})/i);
    if (loose) {
      const typeMatch = raw.match(/(track|album|playlist)/i);
      if (typeMatch) {
        match = [typeMatch[1], typeMatch[1], loose[1]];
      }
    }
  }

  if (!match) {
    return { isSpotify: true, url: raw, type: null, id: null, kind: null };
  }

  const type = match[1].toLowerCase();
  const id = match[2];
  return {
    isSpotify: true,
    url: `https://open.spotify.com/${type}/${id}`,
    type,
    id,
    kind: `sp_${type}`,
  };
}

function sourceLabel(source) {
  if (source === 'twitch') return 'Twitch';
  if (source === 'spotify') return 'Spotify';
  if (source === 'youtube') return 'YouTube';
  return 'Link';
}

function parseDurationSeconds(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.includes(':')) return null;

  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;

  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + part;
  }
  return seconds > 0 ? seconds : null;
}

function cloneTrack(track) {
  if (!track) return null;
  return {
    ...track,
    prefetching: false,
    prefetchedUrl: null,
    attempts: 0,
    playbackRetries: 0,
  };
}

function resetPlaybackTiming(queue) {
  queue.currentTrackStartedAt = 0;
  queue.currentTrackPausedAt = 0;
  queue.currentTrackPausedMs = 0;
}

function getPlaybackPositionSeconds(queue) {
  if (!queue?.nowPlaying) return 0;

  const baseOffset = Math.max(0, Number(queue.nowPlaying.startOffsetSec) || 0);
  if (!queue.currentTrackStartedAt) return baseOffset;

  const pausedAt = queue.currentTrackPausedAt || Date.now();
  const elapsedMs = pausedAt - queue.currentTrackStartedAt - (queue.currentTrackPausedMs || 0);
  return baseOffset + Math.max(0, elapsedMs) / 1000;
}

function markPlaybackPaused(queue) {
  if (!queue?.nowPlaying) return;
  if (queue.currentTrackPausedAt) return;
  queue.currentTrackPausedAt = Date.now();
}

function markPlaybackResumed(queue) {
  if (!queue?.nowPlaying) return;
  if (!queue.currentTrackPausedAt) return;
  queue.currentTrackPausedMs += Date.now() - queue.currentTrackPausedAt;
  queue.currentTrackPausedAt = 0;
}

function buildNowPlayingPayload(track, pendingCount) {
  const embed = new EmbedBuilder()
    .setColor(track.isLive ? 0x9146ff : 0x2f3136)
    .setTitle((track.title || 'Sin titulo').slice(0, 256))
    .addFields(
      { name: 'Fuente', value: sourceLabel(track.source), inline: true },
      { name: 'Estado', value: track.isLive ? 'EN VIVO' : 'Audio', inline: true },
      { name: 'En cola', value: String(pendingCount), inline: true }
    );

  if (isValidUrl(track.url)) {
    embed.setURL(track.url);
    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(track.isLive ? 'Abrir stream' : 'Abrir enlace')
            .setURL(track.url)
        ),
      ],
    };
  }

  return { embeds: [embed] };
}

function stopTranscoder(queue) {
  if (!queue?.transcoder) return;
  try {
    queue.transcoder.kill('SIGKILL');
  } catch {
    // no-op
  }
  queue.transcoder = null;
}

function clearIdleDisconnectTimer(queue) {
  if (!queue?.idleDisconnectTimer) return;
  clearTimeout(queue.idleDisconnectTimer);
  queue.idleDisconnectTimer = null;
  queue.idleDisconnectAt = 0;
}

function scheduleIdleDisconnect(guildId, queue) {
  if (!queue) return;
  clearIdleDisconnectTimer(queue);
  if (!queue.connection) return;

  if (QUEUE_IDLE_DISCONNECT_MS <= 0) {
    queue.connection?.destroy();
    queue.connection = null;
    queue.voiceChannel = null;
    return;
  }

  queue.idleDisconnectAt = Date.now() + QUEUE_IDLE_DISCONNECT_MS;
  const minutes = Math.ceil(QUEUE_IDLE_DISCONNECT_MS / 60_000);
  queue.textChannel?.send(
    `Cola terminada. Me quedo **${minutes} minuto(s)** en el canal por si agregan mas musica.`
  ).catch(() => {});

  queue.idleDisconnectTimer = setTimeout(() => {
    queue.idleDisconnectTimer = null;
    queue.idleDisconnectAt = 0;
    const current = queues.get(guildId);
    if (!current || current !== queue) return;
    if (!queue.connection) return;
    if (queue.playing || queue.nowPlaying || queue.tracks.length > 0) return;
    queue.connection.destroy();
    queue.connection = null;
    queue.voiceChannel = null;
    queue.textChannel?.send('Sali del canal por inactividad de cola.').catch(() => {});
  }, QUEUE_IDLE_DISCONNECT_MS);

  if (typeof queue.idleDisconnectTimer?.unref === 'function') {
    queue.idleDisconnectTimer.unref();
  }
}

function createTranscoder(inputUrl, startOffsetSec = 0) {
  const ffmpegBinary = SYSTEM_FFMPEG_PATH;

  const offset = Number(startOffsetSec);
  const args = [
    '-nostdin',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
  ];

  if (Number.isFinite(offset) && offset > 0) {
    args.push('-ss', offset.toFixed(3));
  }

  args.push(
    '-i', inputUrl,
    '-vn',
    '-ac', '2',
    '-ar', '48000',
    '-f', 's16le',
    'pipe:1'
  );

  return spawn(
    ffmpegBinary,
    args,
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

async function getDirectAudioUrl(videoUrl) {
  const output = await ytDlp(videoUrl, {
    g: true,
    f: 'bestaudio/best',
    noPlaylist: true,
    noWarnings: true,
  });
  const directUrl = String(output).split(/\r?\n/).find((line) => line.trim());
  if (isValidUrl(directUrl)) {
    return directUrl.trim();
  }

  throw new Error('No se pudo obtener una URL directa valida.');
}

function buildPlaybackErrorHint(error) {
  const raw = String(error?.message || '').toLowerCase();
  if (
    raw.includes('yt-dlp')
    || raw.includes('youtube-dl')
    || raw.includes('spawn')
    || raw.includes('enoent')
  ) {
    return 'Parece que falta `yt-dlp` en el host o no esta en PATH.';
  }
  if (raw.includes('ffmpeg') || raw.includes('invalid data found') || raw.includes('error while decoding')) {
    return 'Parece que `ffmpeg` no esta disponible correctamente.';
  }
  if (raw.includes('403') || raw.includes('429')) {
    return 'La fuente rechazo temporalmente la reproduccion (rate limit o bloqueo).';
  }
  return 'Revisa logs para el detalle tecnico.';
}

function splitForDiscord(text, maxLength = 1900) {
  if (!text) return [];
  const chunks = [];
  let rest = text.trim();

  while (rest.length > maxLength) {
    let splitAt = rest.lastIndexOf('\n', maxLength);
    if (splitAt < 1) splitAt = rest.lastIndexOf(' ', maxLength);
    if (splitAt < 1) splitAt = maxLength;
    chunks.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }

  if (rest.length) chunks.push(rest);
  return chunks;
}

async function postJson(url, body, headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${response.status}: ${errorText.slice(0, 400)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function askGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('Falta GEMINI_API_KEY en .env');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const data = await postJson(url, {
    contents: [{ parts: [{ text: prompt }] }],
  });

  const text = (data.candidates || [])
    .flatMap((candidate) => (candidate.content?.parts || []))
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('La respuesta de Gemini vino vacia.');
  }
  return text;
}

function getSpotifyCreds() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('Spotify requiere SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en .env');
  }
  return { id, secret };
}

async function getSpotifyAccessToken(options = {}) {
  const forceClientCredentials = Boolean(options.forceClientCredentials);
  const { id, secret } = getSpotifyCreds();
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  const useUserToken = !forceClientCredentials && Boolean(refreshToken);
  const cacheBucket = useUserToken ? spotifyCache.user : spotifyCache.app;

  if (cacheBucket.accessToken && Date.now() < cacheBucket.expiresAt) {
    return cacheBucket.accessToken;
  }

  const form = new URLSearchParams();
  if (useUserToken) {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', refreshToken);
  } else {
    form.set('grant_type', 'client_credentials');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    if (useUserToken) {
      spotifyCache.user.accessToken = null;
      spotifyCache.user.expiresAt = 0;
      // If refresh token fails, fallback transparently to app token flow.
      return await getSpotifyAccessToken({ forceClientCredentials: true });
    }
    const error = new Error(`Spotify auth ${response.status}: ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  cacheBucket.accessToken = data.access_token;
  cacheBucket.expiresAt = Date.now() + Math.max((data.expires_in || 3600) - 30, 60) * 1000;
  return cacheBucket.accessToken;
}

async function spotifyApiGet(path, options = {}) {
  const retry = options.retry ?? true;
  const forceClientCredentials = Boolean(options.forceClientCredentials);
  const token = await getSpotifyAccessToken({ forceClientCredentials });
  const fullPath = path.startsWith('http')
    ? path
    : `https://api.spotify.com/v1${path}`;

  const response = await fetch(fullPath, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401 && retry) {
    if (forceClientCredentials) {
      spotifyCache.app.accessToken = null;
      spotifyCache.app.expiresAt = 0;
    } else {
      spotifyCache.user.accessToken = null;
      spotifyCache.user.expiresAt = 0;
    }
    return await spotifyApiGet(path, { retry: false, forceClientCredentials });
  }

  if (response.status === 429 && retry) {
    const retryAfterHeader = response.headers.get('retry-after');
    const waitMs = Math.max(1000, Math.min(10_000, Number(retryAfterHeader || 1) * 1000));
    await sleep(waitMs);
    return await spotifyApiGet(path, { retry: false, forceClientCredentials });
  }

  if (!response.ok) {
    const text = await response.text();
    if (
      response.status === 403 &&
      !forceClientCredentials &&
      /user may not be registered/i.test(text)
    ) {
      return await spotifyApiGet(path, { retry, forceClientCredentials: true });
    }
    if (response.status === 403 && /user may not be registered/i.test(text)) {
      const error = new Error(
        'Spotify rechazo el acceso de esta app (usuario no registrado en dashboard). ' +
        'Agrega tu cuenta en User Management de Spotify Developer o habilita acceso Web API para la app.'
      );
      error.status = response.status;
      throw error;
    }
    const error = new Error(`Spotify API ${response.status}: ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }

  return await response.json();
}

async function getSpotifyTrackById(trackId) {
  try {
    return await spotifyApiGet(`/tracks/${trackId}?market=${encodeURIComponent(SPOTIFY_MARKET)}`);
  } catch (error) {
    if (error.status === 404) {
      return await spotifyApiGet(`/tracks/${trackId}`);
    }
    throw error;
  }
}

async function getSpotifyPlaylistTracks(playlistId) {
  const tracks = [];
  const withMarket = SPOTIFY_MARKET
    ? `/playlists/${playlistId}/tracks?limit=100&market=${encodeURIComponent(SPOTIFY_MARKET)}`
    : null;
  let next = `/playlists/${playlistId}/tracks?limit=100`;
  let triedWithMarket = false;

  while (tracks.length < SPOTIFY_MAX_TRACKS) {
    if (!next) break;

    let data;
    try {
      data = await spotifyApiGet(next);
    } catch (error) {
      if ((error.status === 400 || error.status === 404) && withMarket && !triedWithMarket) {
        triedWithMarket = true;
        next = withMarket;
        continue;
      }
      throw error;
    }

    for (const item of data.items || []) {
      const track = item?.track;
      if (track && track.type === 'track' && !track.is_local) {
        tracks.push(track);
      }
      if (tracks.length >= SPOTIFY_MAX_TRACKS) break;
    }
    next = data.next || null;
  }

  return tracks;
}

async function getSpotifyPlaylistTracksFromHtml(playlistId) {
  const response = await fetch(`https://open.spotify.com/playlist/${playlistId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) {
    throw new Error(`Spotify web ${response.status}: no pude leer la playlist`);
  }

  const html = await response.text();
  const ids = [];
  const seen = new Set();
  const patterns = [
    /spotify:track:([A-Za-z0-9]{22})/g,
    /"uri":"spotify:track:([A-Za-z0-9]{22})"/g,
    /"trackUri":"spotify:track:([A-Za-z0-9]{22})"/g,
    /"id":"([A-Za-z0-9]{22})","type":"track"/g,
  ];

  for (const matcher of patterns) {
    let match;
    while ((match = matcher.exec(html)) !== null) {
      const id = match[1];
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
      if (ids.length >= SPOTIFY_MAX_TRACKS) break;
    }
    if (ids.length >= SPOTIFY_MAX_TRACKS) break;
  }

  const tracks = [];
  for (const trackId of ids) {
    try {
      const track = await getSpotifyTrackById(trackId);
      if (track && track.type === 'track' && !track.is_local) {
        tracks.push(track);
      }
    } catch {
      // ignore individual track failures
    }
  }

  return tracks;
}

async function getSpotifyAlbumTracks(albumId) {
  let album;
  try {
    album = await spotifyApiGet(`/albums/${albumId}`);
  } catch (error) {
    if ((error.status === 400 || error.status === 404) && SPOTIFY_MARKET) {
      album = await spotifyApiGet(`/albums/${albumId}?market=${encodeURIComponent(SPOTIFY_MARKET)}`);
    } else {
      throw error;
    }
  }
  const tracks = [];
  let page = album.tracks || null;

  while (page && tracks.length < SPOTIFY_MAX_TRACKS) {
    for (const item of page.items || []) {
      if (item && item.type === 'track' && !item.is_local) {
        tracks.push(item);
      }
      if (tracks.length >= SPOTIFY_MAX_TRACKS) break;
    }
    page = page.next ? await spotifyApiGet(page.next) : null;
  }

  return tracks;
}

function spotifyTrackToSearchText(track) {
  const name = track?.name || '';
  const artists = (track?.artists || []).map((artist) => artist.name).filter(Boolean).join(' ');
  return `${name} ${artists}`.trim();
}

async function prefetchNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;
  const next = queue.tracks[0];
  if (!next || next.prefetching || next.prefetchedUrl) return;
  if (next.isLive) return;
  if (!isValidUrl(next.url)) return;

  next.prefetching = true;
  try {
    next.prefetchedUrl = await getDirectAudioUrl(next.url);
  } catch {
    // Ignore prefetch errors; we'll try again on actual play.
  } finally {
    next.prefetching = false;
  }
}

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });

    const state = {
      player,
      connection: null,
      textChannel: null,
      voiceChannel: null,
      transcoder: null,
      nowPlaying: null,
      tracks: [],
      playing: false,
      history: [],
      preserveConnectionOnEmpty: false,
      ignoreAbortErrors: false,
      suppressHistoryOnce: false,
      transitionInProgress: false,
      currentTrackStartedAt: 0,
      currentTrackPausedAt: 0,
      currentTrackPausedMs: 0,
      idleDisconnectTimer: null,
      idleDisconnectAt: 0,
    };

    player.on(AudioPlayerStatus.Idle, () => {
      state.playing = false;
      stopTranscoder(state);
      resetPlaybackTiming(state);
      void playNext(guildId);
    });

    player.on('error', (err) => {
      state.playing = false;
      stopTranscoder(state);
      resetPlaybackTiming(state);
      const isAbortLike = /aborted|premature close|ECONNRESET|socket hang up|EPIPE/i.test(err?.message || '');
      if (state.nowPlaying && isAbortLike && !state.ignoreAbortErrors) {
        state.nowPlaying.playbackRetries = (state.nowPlaying.playbackRetries || 0) + 1;
        if (state.nowPlaying.playbackRetries <= 2) {
          state.nowPlaying.prefetchedUrl = null;
          state.tracks.unshift(state.nowPlaying);
          state.textChannel?.send(
            `Se corto el stream, reintentando: **${state.nowPlaying.title}** (${state.nowPlaying.playbackRetries}/2)`
          );
        }
      }
      state.ignoreAbortErrors = false;
      state.nowPlaying = null;
      console.error('Audio player error:', err.message);
      void playNext(guildId);
    });

    queues.set(guildId, state);
  }

  return queues.get(guildId);
}

async function resolveYoutubeTrack(query, requestedBy) {
  const result = await playdl.search(query, { limit: 1 });
  if (!result.length) return null;
  const video = result[0];
  const url = video.url || (video.id ? `https://www.youtube.com/watch?v=${video.id}` : null);
  if (!isValidUrl(url)) return null;
  return {
    title: video.title ?? query,
    url,
    requestedBy,
    source: 'youtube',
    isLive: Boolean(video.live),
    durationSec: parseDurationSeconds(video.durationInSec || video.durationRaw || video.duration_raw),
  };
}

async function resolveSpotifyTracks(spotifyInput, requestedBy) {
  const normalized = typeof spotifyInput === 'string'
    ? normalizeSpotifyInput(spotifyInput)
    : spotifyInput;
  if (!normalized?.kind || !normalized?.id) return [];

  let spotifyTracks = [];
  let lastError = null;
  if (normalized.kind === 'sp_track') {
    const track = await getSpotifyTrackById(normalized.id);
    if (track && track.type === 'track' && !track.is_local) {
      spotifyTracks = [track];
    }
  } else if (normalized.kind === 'sp_album') {
    spotifyTracks = await getSpotifyAlbumTracks(normalized.id);
  } else if (normalized.kind === 'sp_playlist') {
    try {
      spotifyTracks = await getSpotifyPlaylistTracks(normalized.id);
    } catch (error) {
      lastError = error;
      if (
        error.status === 400 ||
        error.status === 401 ||
        error.status === 403 ||
        error.status === 404 ||
        error.status === 429
      ) {
        try {
          spotifyTracks = await getSpotifyPlaylistTracksFromHtml(normalized.id);
        } catch (htmlError) {
          lastError = htmlError;
        }
      } else {
        throw error;
      }
    }

    if (!spotifyTracks.length && lastError) {
      console.warn('[Spotify] Playlist import failed:', lastError.message);
    }
  }

  if (normalized.kind === 'sp_track' && !spotifyTracks.length) {
    throw new Error('No pude leer ese track de Spotify. Revisa que el enlace sea valido.');
  }
  if (normalized.kind === 'sp_album' && !spotifyTracks.length) {
    throw new Error('No pude leer ese album de Spotify o no tiene tracks accesibles.');
  }
  if (normalized.kind === 'sp_playlist' && !spotifyTracks.length) {
    if (lastError?.message && /usuario no registrado|user may not be registered/i.test(lastError.message)) {
      throw new Error(
        'Spotify bloqueo la lectura de playlists para esta app. Ve a Spotify Developer Dashboard y agrega tu cuenta en User Management. No hace falta refresh token para playlists publicas.'
      );
    }
    throw new Error(
      'No pude leer esa playlist de Spotify. Verifica que sea publica y que SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET sean validos.'
    );
  }

  const resolved = [];
  for (const item of spotifyTracks) {
    const baseQuery = spotifyTrackToSearchText(item);
    const fallbackQuery = `${item?.name || ''} official audio`.trim();
    const queryCandidates = [baseQuery, fallbackQuery].filter(Boolean);
    let added = false;

    for (const query of queryCandidates) {
      try {
        const track = await resolveYoutubeTrack(query, requestedBy);
        if (!track || !isValidUrl(track.url)) continue;
        resolved.push({ ...track, source: 'spotify' });
        added = true;
        break;
      } catch {
        // Try next query candidate.
      }
    }

    if (!added) {
      // Keep order of successful tracks; unresolvable tracks are skipped.
    }
  }

  if (!resolved.length && spotifyTracks.length) {
    throw new Error(
      'Leí la playlist/album en Spotify pero no pude encontrar versiones reproducibles en YouTube para esas canciones.'
    );
  }

  return resolved;
}

async function resolveYouTubeTracks(url, requestedBy) {
  const validate = playdl.validate(url);

  if (validate === 'yt_video') {
    const info = await playdl.video_info(url);
    const resolvedUrl = info.video_details.url || `https://www.youtube.com/watch?v=${info.video_details.id}`;
    if (!isValidUrl(resolvedUrl)) return [];
    return [
      {
        title: info.video_details.title,
        url: resolvedUrl,
        requestedBy,
        source: 'youtube',
        isLive: Boolean(info.video_details.live),
        durationSec: parseDurationSeconds(
          info.video_details.durationInSec
            || info.video_details.durationRaw
            || info.video_details.duration_raw
            || info.video_details.duration
        ),
      },
    ];
  }

  if (validate === 'yt_playlist') {
    try {
      const playlist = await playdl.playlist_info(url, { incomplete: true });
      const videos = await playlist.all_videos();
      const tracks = videos.map((video) => ({
        title: video.title,
        url: video.url || (video.id ? `https://www.youtube.com/watch?v=${video.id}` : null),
        requestedBy,
        source: 'youtube',
        isLive: Boolean(video.live),
        durationSec: parseDurationSeconds(video.durationInSec || video.durationRaw || video.duration_raw),
      })).filter((t) => isValidUrl(t.url));
      if (tracks.length) return tracks;
    } catch {
      // Fallback below.
    }

    return await resolveYouTubePlaylistTracksViaYtDlp(url, requestedBy);
  }

  return [];
}

async function resolveYouTubePlaylistTracksViaYtDlp(url, requestedBy) {
  if (!isYouTubePlaylistLikeUrl(url)) return [];

  try {
    const output = await ytDlp(url, {
      dumpSingleJson: true,
      flatPlaylist: true,
      skipDownload: true,
      noWarnings: true,
    });
    const info = typeof output === 'string' ? JSON.parse(output) : output;
    const entries = Array.isArray(info?.entries) ? info.entries : [];
    if (!entries.length) return [];

    return entries
      .map((entry) => {
        const webpageUrl = typeof entry?.webpage_url === 'string' ? entry.webpage_url : null;
        const entryUrl = typeof entry?.url === 'string' ? entry.url : null;
        const id = typeof entry?.id === 'string' ? entry.id : null;
        const resolvedUrl = isValidUrl(webpageUrl)
          ? webpageUrl
          : isValidUrl(entryUrl)
            ? entryUrl
            : id
              ? `https://www.youtube.com/watch?v=${id}`
              : null;

        return {
          title: entry?.title || resolvedUrl || 'Video de YouTube',
          url: resolvedUrl,
          requestedBy,
          source: 'youtube',
          isLive: String(entry?.live_status || '').toLowerCase() === 'is_live' || Boolean(entry?.is_live),
          durationSec: parseDurationSeconds(entry?.duration || entry?.duration_string),
        };
      })
      .filter((track) => isValidUrl(track.url));
  } catch {
    return [];
  }
}

async function resolveDirectMediaTrack(url, requestedBy) {
  if (!isValidUrl(url) || isSpotifyUrl(url)) return [];

  try {
    const output = await ytDlp(url, {
      dumpSingleJson: true,
      skipDownload: true,
      noWarnings: true,
      noPlaylist: true,
    });
    const info = typeof output === 'string' ? JSON.parse(output) : output;
    const extractor = String(info?.extractor_key || info?.extractor || '').toLowerCase();
    const source = extractor.includes('twitch')
      ? 'twitch'
      : extractor.includes('youtube')
        ? 'youtube'
        : 'url';

    return [
      {
        title: info?.title || url,
        url,
        requestedBy,
        source,
        isLive: Boolean(info?.is_live),
        durationSec: parseDurationSeconds(info?.duration),
      },
    ];
  } catch {
    return [
      {
        title: url,
        url,
        requestedBy,
        source: 'url',
        isLive: false,
        durationSec: null,
      },
    ];
  }
}

async function getTracksFromQuery(query, requestedBy) {
  const rawQuery = sanitizeQueryInput(query);
  const normalizedQuery = isSpotifyShortUrl(rawQuery)
    ? await resolveSpotifyRedirect(rawQuery)
    : rawQuery;

  const spotifyInput = normalizeSpotifyInput(normalizedQuery);
  if (spotifyInput.isSpotify) {
    if (
      spotifyInput.kind === 'sp_track' ||
      spotifyInput.kind === 'sp_album' ||
      spotifyInput.kind === 'sp_playlist'
    ) {
      return await resolveSpotifyTracks(spotifyInput, requestedBy);
    }
    return [];
  }

  const youtubePlaylistLike = isYouTubePlaylistLikeUrl(normalizedQuery);
  if (youtubePlaylistLike) {
    const playlistTracks = await resolveYouTubePlaylistTracksViaYtDlp(normalizedQuery, requestedBy);
    if (playlistTracks.length) return playlistTracks;
  }

  const validate = playdl.validate(normalizedQuery);

  if (validate === 'sp_track' || validate === 'sp_album' || validate === 'sp_playlist') {
    return await resolveSpotifyTracks(normalizedQuery, requestedBy);
  }

  if (validate === 'yt_video' || validate === 'yt_playlist') {
    return await resolveYouTubeTracks(normalizedQuery, requestedBy);
  }

  if (isValidUrl(normalizedQuery)) {
    if (youtubePlaylistLike) {
      return [];
    }
    return await resolveDirectMediaTrack(normalizedQuery, requestedBy);
  }

  return await resolveYoutubeTrack(normalizedQuery, requestedBy).then((t) => (t ? [t] : []));
}

async function connectToVoice(queue, voiceChannel) {
  if (queue.connection && queue.voiceChannel?.id === voiceChannel.id) {
    return queue.connection;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  connection.subscribe(queue.player);

  queue.connection = connection;
  queue.voiceChannel = voiceChannel;
  clearIdleDisconnectTimer(queue);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    // If the bot is kicked/disconnected, reset state so future plays work.
    queue.tracks = [];
    queue.nowPlaying = null;
    queue.playing = false;
    queue.transitionInProgress = false;
    queue.suppressHistoryOnce = false;
    resetPlaybackTiming(queue);
    stopTranscoder(queue);
    clearIdleDisconnectTimer(queue);
    queue.connection?.destroy();
    queue.connection = null;
    queue.voiceChannel = null;
  });

  return connection;
}

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;

  if (queue.playing || queue.transitionInProgress) return;
  queue.transitionInProgress = true;

  if (queue.nowPlaying) {
    if (queue.suppressHistoryOnce) {
      queue.suppressHistoryOnce = false;
    } else {
      queue.history.push(cloneTrack(queue.nowPlaying));
      if (queue.history.length > HISTORY_LIMIT) {
        queue.history.shift();
      }
    }
  }

  const next = queue.tracks.shift();
  if (!next) {
    queue.preserveConnectionOnEmpty = false;
    stopTranscoder(queue);
    resetPlaybackTiming(queue);
    queue.nowPlaying = null;
    queue.playing = false;
    queue.transitionInProgress = false;
    scheduleIdleDisconnect(guildId, queue);
    return;
  }

  clearIdleDisconnectTimer(queue);
  queue.preserveConnectionOnEmpty = false;

  try {
    if (!isValidUrl(next.url)) {
      queue.textChannel?.send('No encontre una URL valida para esa pista.');
      queue.transitionInProgress = false;
      await playNext(guildId);
      return;
    }
    next.attempts = (next.attempts || 0) + 1;
    const startOffsetSec = Math.max(0, Number(next.startOffsetSec) || 0);
    const directUrl = (!next.isLive && next.prefetchedUrl)
      ? next.prefetchedUrl
      : await getDirectAudioUrl(next.url);
    stopTranscoder(queue);
    const transcoder = createTranscoder(directUrl, startOffsetSec);
    queue.transcoder = transcoder;

    transcoder.on('error', (err) => {
      if (queue.transcoder !== transcoder) return;
      console.error('Transcoder error:', err.message);
      queue.player.stop();
    });

    transcoder.stderr.on('data', () => {
      // stderr is noisy in ffmpeg; keep process alive and rely on close/error events.
    });

    transcoder.on('close', (code) => {
      if (queue.transcoder !== transcoder) return;
      if (queue.playing && code !== 0) {
        if (!queue.ignoreAbortErrors) {
          const snapshot = queue.nowPlaying ? cloneTrack(queue.nowPlaying) : cloneTrack(next);
          const attempts = Number(snapshot?.attempts || next?.attempts || 1);
          if (snapshot && attempts < 2) {
            snapshot.prefetchedUrl = null;
            queue.tracks.unshift(snapshot);
            queue.suppressHistoryOnce = true;
            queue.textChannel?.send(
              `ffmpeg corto la reproduccion, reintentando: **${snapshot.title}** (${attempts}/2)`
            ).catch(() => {});
          } else {
            queue.textChannel?.send(
              `No pude decodificar el audio (${code}).`
            ).catch(() => {});
          }
        }
        queue.player.stop();
      }
    });

    const resource = createAudioResource(transcoder.stdout, {
      inputType: StreamType.Raw,
    });
    queue.ignoreAbortErrors = false;
    queue.player.play(resource);
    queue.playing = true;
    queue.transitionInProgress = false;
    queue.currentTrackStartedAt = Date.now();
    queue.currentTrackPausedAt = 0;
    queue.currentTrackPausedMs = 0;
    next.startOffsetSec = startOffsetSec;
    next.playbackRetries = 0;
    queue.nowPlaying = next;

    if (queue.textChannel) {
      const payload = buildNowPlayingPayload(next, queue.tracks.length);
      queue.textChannel.send(payload).catch(() => {
        queue.textChannel.send(`Ahora suena: **${next.title}**`);
      });
    }
    void prefetchNext(guildId);
  } catch (err) {
    console.error('Error reproduciendo:', err);
    queue.playing = false;
    resetPlaybackTiming(queue);
    queue.nowPlaying = null;
    queue.transitionInProgress = false;
    if ((next.attempts || 0) < 2) {
      // retry once with a fresh direct URL
      next.prefetchedUrl = null;
      queue.tracks.unshift(next);
      await playNext(guildId);
      return;
    }
    const hint = buildPlaybackErrorHint(err);
    const detail = String(err?.message || err || 'sin detalle').replace(/\s+/g, ' ').trim().slice(0, 220);
    queue.textChannel?.send(
      `No pude reproducir **${next?.title || 'esa pista'}**. ${hint}\nDetalle: \`${detail}\``
    );
    await playNext(guildId);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;
  if (!message.guild) return;

  const [rawCommand, ...rest] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = String(rawCommand || '').toLowerCase();
  const args = rest.join(' ').trim();

  const pokemonHandled = await pokemonGame.handleMessageCommand({
    command,
    args,
    message,
  });
  if (pokemonHandled) return;

  const queue = getQueue(message.guild.id);
  queue.textChannel = message.channel;

  const handled = await handleCommand({
    command,
    args,
    message,
    queue,
    deps: {
      connectToVoice,
      getTracksFromQuery,
      playNext,
      prefetchNext,
      askGemini,
      splitForDiscord,
      stopTranscoder,
      cloneTrack,
      getPlaybackPositionSeconds,
      markPlaybackPaused,
      markPlaybackResumed,
      maxAskChunks: 4,
    },
  });

  if (handled) {
    if (command === 'stop' || command === 'play' || command === 'stream' || command === 'prev') {
      clearIdleDisconnectTimer(queue);
    }
    return;
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    const handled = await pokemonGame.handleInteraction(interaction);
    if (handled) return;
  } catch (error) {
    console.error('Pokemon interaction error:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Error procesando la accion Pokemon.', ephemeral: true });
    }
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  const botId = client.user?.id;
  if (!botId) return;

  // If the bot left a voice channel, clear its queue so it can be used again.
  if (oldState.id === botId && oldState.channelId && !newState.channelId) {
    const queue = queues.get(oldState.guild.id);
    if (!queue) return;
    queue.tracks = [];
    queue.nowPlaying = null;
    queue.playing = false;
    queue.transitionInProgress = false;
    queue.suppressHistoryOnce = false;
    resetPlaybackTiming(queue);
    stopTranscoder(queue);
    clearIdleDisconnectTimer(queue);
    queue.connection?.destroy();
    queue.connection = null;
    queue.voiceChannel = null;
  }
});

client.once('clientReady', () => {
  console.log(`Conectado como ${client.user.tag}`);
});

client.login(TOKEN);
