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

const PREFIX = '!';
const TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || 'US';
const SPOTIFY_MAX_TRACKS = Number(process.env.SPOTIFY_MAX_TRACKS || 500);
const HISTORY_LIMIT = 50;

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

function isSpotifyUrl(value) {
  if (!isValidUrl(value)) return false;
  const host = new URL(value).hostname.toLowerCase();
  return host.includes('spotify.com');
}

function normalizeSpotifyInput(value) {
  const raw = String(value || '').trim();
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

  const path = parsed.pathname.replace(/^\/intl-[^/]+/i, '');
  let match = path.match(/^\/(track|album|playlist)\/([A-Za-z0-9]+)\/?$/i);

  if (!match) {
    // Legacy URL format: /user/<name>/playlist/<id>
    const legacy = path.match(/^\/user\/[^/]+\/playlist\/([A-Za-z0-9]+)\/?$/i);
    if (legacy) {
      match = ['playlist', 'playlist', legacy[1]];
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

function createTranscoder(inputUrl) {
  if (!ffmpegPath) {
    throw new Error('No se encontro ffmpeg. Verifica ffmpeg-static.');
  }

  return spawn(
    ffmpegPath,
    [
      '-nostdin',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', inputUrl,
      '-vn',
      '-ac', '2',
      '-ar', '48000',
      '-f', 's16le',
      'pipe:1',
    ],
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
  if (!isValidUrl(directUrl)) {
    throw new Error('No se pudo obtener una URL directa valida.');
  }
  return directUrl.trim();
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

  if (!response.ok) {
    const text = await response.text();
    if (
      response.status === 403 &&
      !forceClientCredentials &&
      /user may not be registered/i.test(text)
    ) {
      return await spotifyApiGet(path, { retry, forceClientCredentials: true });
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
  let next = `/playlists/${playlistId}/tracks?market=${encodeURIComponent(SPOTIFY_MARKET)}&limit=100`;
  let triedWithoutMarket = false;

  while (tracks.length < SPOTIFY_MAX_TRACKS) {
    if (!next) break;

    let data;
    try {
      data = await spotifyApiGet(next);
    } catch (error) {
      if (error.status === 404 && !triedWithoutMarket) {
        triedWithoutMarket = true;
        next = `/playlists/${playlistId}/tracks?limit=100`;
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
  const response = await fetch(`https://open.spotify.com/playlist/${playlistId}`);
  if (!response.ok) {
    throw new Error(`Spotify web ${response.status}: no pude leer la playlist`);
  }

  const html = await response.text();
  const ids = [];
  const seen = new Set();
  const matcher = /spotify:track:([A-Za-z0-9]{22})/g;
  let match;

  while ((match = matcher.exec(html)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
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
    album = await spotifyApiGet(`/albums/${albumId}?market=${encodeURIComponent(SPOTIFY_MARKET)}`);
  } catch (error) {
    if (error.status === 404) {
      album = await spotifyApiGet(`/albums/${albumId}`);
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
    };

    player.on(AudioPlayerStatus.Idle, () => {
      state.playing = false;
      stopTranscoder(state);
      void playNext(guildId);
    });

    player.on('error', (err) => {
      state.playing = false;
      stopTranscoder(state);
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
  };
}

async function resolveSpotifyTracks(spotifyInput, requestedBy) {
  const normalized = typeof spotifyInput === 'string'
    ? normalizeSpotifyInput(spotifyInput)
    : spotifyInput;
  if (!normalized?.kind || !normalized?.id) return [];

  let spotifyTracks = [];
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
      if (error.status === 404) {
        spotifyTracks = await getSpotifyPlaylistTracksFromHtml(normalized.id);
      } else {
        throw error;
      }
    }
  }

  const resolved = [];
  for (const item of spotifyTracks) {
    const query = spotifyTrackToSearchText(item);
    if (!query) continue;
    const track = await resolveYoutubeTrack(query, requestedBy);
    if (track) resolved.push({ ...track, source: 'spotify' });
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
      },
    ];
  }

  if (validate === 'yt_playlist') {
    const playlist = await playdl.playlist_info(url, { incomplete: true });
    const videos = await playlist.all_videos();
    return videos.map((video) => ({
      title: video.title,
      url: video.url || (video.id ? `https://www.youtube.com/watch?v=${video.id}` : null),
      requestedBy,
      source: 'youtube',
      isLive: Boolean(video.live),
    })).filter((t) => isValidUrl(t.url));
  }

  return [];
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
      },
    ];
  }
}

async function getTracksFromQuery(query, requestedBy) {
  const spotifyInput = normalizeSpotifyInput(query);
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

  const validate = playdl.validate(query);

  if (validate === 'sp_track' || validate === 'sp_album' || validate === 'sp_playlist') {
    return await resolveSpotifyTracks(query, requestedBy);
  }

  if (validate === 'yt_video' || validate === 'yt_playlist') {
    return await resolveYouTubeTracks(query, requestedBy);
  }

  if (isValidUrl(query)) {
    return await resolveDirectMediaTrack(query, requestedBy);
  }

  return await resolveYoutubeTrack(query, requestedBy).then((t) => (t ? [t] : []));
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

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    // If the bot is kicked/disconnected, reset state so future plays work.
    queue.tracks = [];
    queue.nowPlaying = null;
    queue.playing = false;
    queue.transitionInProgress = false;
    queue.suppressHistoryOnce = false;
    stopTranscoder(queue);
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
    const preserveConnection = queue.preserveConnectionOnEmpty;
    queue.preserveConnectionOnEmpty = false;
    stopTranscoder(queue);
    queue.nowPlaying = null;
    queue.playing = false;
    queue.transitionInProgress = false;

    if (!preserveConnection) {
      queue.connection?.destroy();
      queue.connection = null;
      queue.voiceChannel = null;
    }
    return;
  }

  queue.preserveConnectionOnEmpty = false;

  try {
    if (!isValidUrl(next.url)) {
      queue.textChannel?.send('No encontre una URL valida para esa pista.');
      queue.transitionInProgress = false;
      await playNext(guildId);
      return;
    }
    next.attempts = (next.attempts || 0) + 1;
    const directUrl = (!next.isLive && next.prefetchedUrl)
      ? next.prefetchedUrl
      : await getDirectAudioUrl(next.url);
    stopTranscoder(queue);
    const transcoder = createTranscoder(directUrl);
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
    queue.nowPlaying = null;
    queue.transitionInProgress = false;
    if ((next.attempts || 0) < 2) {
      // retry once with a fresh direct URL
      next.prefetchedUrl = null;
      queue.tracks.unshift(next);
      await playNext(guildId);
      return;
    }
    queue.textChannel?.send('No pude reproducir esa pista.');
    await playNext(guildId);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const [command, ...rest] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const args = rest.join(' ').trim();

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
      maxAskChunks: 4,
    },
  });

  if (handled) return;
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
    stopTranscoder(queue);
    queue.connection?.destroy();
    queue.connection = null;
    queue.voiceChannel = null;
  }
});

client.once('clientReady', () => {
  console.log(`Conectado como ${client.user.tag}`);
});

client.login(TOKEN);
