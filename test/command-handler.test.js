const test = require('node:test');
const assert = require('node:assert/strict');
const { handleCommand } = require('../src/command-handler');

function createMessage({ withVoice = true } = {}) {
  const replies = [];
  let typingCalls = 0;

  const message = {
    author: { username: 'tester' },
    guild: { id: 'guild-1' },
    member: withVoice ? { voice: { channel: { id: 'voice-1' } } } : { voice: { channel: null } },
    channel: {
      async sendTyping() {
        typingCalls += 1;
      },
    },
    async reply(payload) {
      replies.push(payload);
    },
  };

  return {
    message,
    replies,
    getTypingCalls: () => typingCalls,
  };
}

function createQueue(overrides = {}) {
  let stopCalls = 0;
  let pauseCalls = 0;
  let unpauseCalls = 0;
  let destroyCalls = 0;

  const queue = {
    tracks: [],
    nowPlaying: null,
    history: [],
    playing: false,
    preserveConnectionOnEmpty: false,
    ignoreAbortErrors: false,
    suppressHistoryOnce: false,
    transitionInProgress: false,
    voiceChannel: { id: 'voice-1' },
    connection: {
      destroy() {
        destroyCalls += 1;
      },
    },
    player: {
      stop() {
        stopCalls += 1;
      },
      pause() {
        pauseCalls += 1;
      },
      unpause() {
        unpauseCalls += 1;
      },
    },
    ...overrides,
  };

  return {
    queue,
    counters: {
      get stopCalls() {
        return stopCalls;
      },
      get pauseCalls() {
        return pauseCalls;
      },
      get unpauseCalls() {
        return unpauseCalls;
      },
      get destroyCalls() {
        return destroyCalls;
      },
    },
  };
}

function createDeps(overrides = {}) {
  const calls = {
    connectToVoice: 0,
    getTracksFromQuery: 0,
    playNext: 0,
    prefetchNext: 0,
    askGemini: 0,
    splitForDiscord: 0,
    stopTranscoder: 0,
    getPlaybackPositionSeconds: 0,
    markPlaybackPaused: 0,
    markPlaybackResumed: 0,
  };

  const deps = {
    async connectToVoice() {
      calls.connectToVoice += 1;
    },
    async getTracksFromQuery() {
      calls.getTracksFromQuery += 1;
      return [];
    },
    async playNext() {
      calls.playNext += 1;
    },
    async prefetchNext() {
      calls.prefetchNext += 1;
    },
    async askGemini() {
      calls.askGemini += 1;
      return 'ok';
    },
    splitForDiscord() {
      calls.splitForDiscord += 1;
      return ['ok'];
    },
    stopTranscoder() {
      calls.stopTranscoder += 1;
    },
    getPlaybackPositionSeconds() {
      calls.getPlaybackPositionSeconds += 1;
      return 0;
    },
    markPlaybackPaused() {
      calls.markPlaybackPaused += 1;
    },
    markPlaybackResumed() {
      calls.markPlaybackResumed += 1;
    },
    cloneTrack(track) {
      return { ...track };
    },
    ...overrides,
  };

  return { deps, calls };
}

test('help command: returns command list', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue();
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'help',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.match(replies[0], /Comandos disponibles:/);
  assert.match(replies[0], /`!play <url\|busqueda>`/);
  assert.match(replies[0], /`!playnext <posicion>`/);
  assert.match(replies[0], /`!pokehelp`/);
});

test('play command: adds tracks and starts playback when idle', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue();
  const { deps, calls } = createDeps({
    async getTracksFromQuery() {
      calls.getTracksFromQuery += 1;
      return [{ title: 'Song A' }, { title: 'Song B' }];
    },
  });

  const handled = await handleCommand({
    command: 'play',
    args: 'bad bunny',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(calls.connectToVoice, 1);
  assert.equal(calls.getTracksFromQuery, 1);
  assert.equal(calls.playNext, 1);
  assert.equal(calls.prefetchNext, 0);
  assert.equal(queue.tracks.length, 2);
  assert.match(replies[0], /Agregadas 2 pista\(s\)/);
});

test('stream command: aliases play and prefetches when already playing', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({ playing: true, nowPlaying: { title: 'Song A' } });
  const { deps, calls } = createDeps({
    async getTracksFromQuery() {
      calls.getTracksFromQuery += 1;
      return [{ title: 'Live' }];
    },
  });

  const handled = await handleCommand({
    command: 'stream',
    args: 'https://twitch.tv/test',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(calls.playNext, 0);
  assert.equal(calls.prefetchNext, 1);
  assert.equal(queue.tracks.length, 1);
  assert.match(replies[0], /En cola ahora: 2\./);
});

test('ask command: responds in chunks and trims overflow', async () => {
  const { message, replies, getTypingCalls } = createMessage();
  const { queue } = createQueue();
  const { deps } = createDeps({
    async askGemini() {
      return 'long answer';
    },
    splitForDiscord() {
      return ['1', '2', '3', '4', '5'];
    },
  });

  const handled = await handleCommand({
    command: 'ask',
    args: 'hola?',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(getTypingCalls(), 1);
  assert.deepEqual(replies, ['1', '2', '3', '4', 'Respuesta recortada por longitud.']);
});

test('skip command: keeps connection and stops current track', async () => {
  const { message, replies } = createMessage();
  const { queue, counters } = createQueue({ nowPlaying: { title: 'Song A' } });
  const { deps, calls } = createDeps();

  const handled = await handleCommand({
    command: 'skip',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(queue.preserveConnectionOnEmpty, true);
  assert.equal(queue.ignoreAbortErrors, true);
  assert.equal(calls.stopTranscoder, 1);
  assert.equal(counters.stopCalls, 1);
  assert.equal(replies[0], 'Saltando pista...');
});

test('skipto command: jumps to target position while preserving pending order after target', async () => {
  const { message, replies } = createMessage();
  const { queue, counters } = createQueue({
    nowPlaying: { title: 'Song A' },
    tracks: [{ title: 'Song B' }, { title: 'Song C' }, { title: 'Song D' }],
  });
  const { deps, calls } = createDeps();

  const handled = await handleCommand({
    command: 'skipto',
    args: '4',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(calls.stopTranscoder, 1);
  assert.equal(counters.stopCalls, 1);
  assert.equal(queue.preserveConnectionOnEmpty, true);
  assert.equal(queue.ignoreAbortErrors, true);
  assert.deepEqual(queue.tracks.map((track) => track.title), ['Song D']);
  assert.match(replies[0], /Saltando a la posicion 4: \*\*Song D\*\*/);
});

test('skipto command: drops earlier pending tracks when nothing is playing', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    nowPlaying: null,
    playing: false,
    tracks: [{ title: 'Song A' }, { title: 'Song B' }, { title: 'Song C' }],
  });
  const { deps, calls } = createDeps();

  const handled = await handleCommand({
    command: 'skipto',
    args: '2',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(calls.playNext, 1);
  assert.deepEqual(queue.tracks.map((track) => track.title), ['Song B', 'Song C']);
  assert.match(replies[0], /Cola adelantada a la posicion 2: \*\*Song B\*\*/);
});

test('move command: reorders pending queue positions while a song is playing', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    nowPlaying: { title: 'Song A' },
    tracks: [{ title: 'Song B' }, { title: 'Song C' }, { title: 'Song D' }],
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'move',
    args: '4 2',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(queue.tracks.map((track) => track.title), ['Song D', 'Song B', 'Song C']);
  assert.equal(replies[0], 'Movi **Song D** de la posicion 4 a la 2.');
});

test('move command: blocks attempts to move current song (position 1)', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    nowPlaying: { title: 'Song A' },
    tracks: [{ title: 'Song B' }, { title: 'Song C' }],
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'move',
    args: '1 2',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(replies[0], 'No puedes mover la pista que ya esta sonando (posicion 1).');
});

test('remove command: removes pending track by queue position while playing', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    nowPlaying: { title: 'Song A' },
    tracks: [{ title: 'Song B' }, { title: 'Song C' }, { title: 'Song D' }],
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'remove',
    args: '3',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(queue.tracks.map((track) => track.title), ['Song B', 'Song D']);
  assert.equal(replies[0], 'Removida de la cola (posicion 3): **Song C**.');
});

test('remove command: blocks removing currently playing position', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    nowPlaying: { title: 'Song A' },
    tracks: [{ title: 'Song B' }],
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'remove',
    args: '1',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(queue.tracks.map((track) => track.title), ['Song B']);
  assert.equal(replies[0], 'No puedes remover la pista actual con `!remove`. Usa `!skip`.');
});

test('remove command: removes first pending track when idle', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    nowPlaying: null,
    tracks: [{ title: 'Song A' }, { title: 'Song B' }],
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'remove',
    args: '1',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(queue.tracks.map((track) => track.title), ['Song B']);
  assert.equal(replies[0], 'Removida de la cola (posicion 1): **Song A**.');
});

test('playnext command: promotes a later queue position to play immediately after current', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    nowPlaying: { title: 'Song 12' },
    tracks: [
      { title: 'Song 13' },
      { title: 'Song 14' },
      { title: 'Song 15' },
      { title: 'Song 20' },
    ],
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'playnext',
    args: '5',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.deepEqual(queue.tracks.map((track) => track.title), [
    'Song 20',
    'Song 13',
    'Song 14',
    'Song 15',
  ]);
  assert.equal(
    replies[0],
    'Listo: **Song 20** sonara justo despues de la actual (movida de 5 a 2).'
  );
});

test('playnext command: moves selected track to front when idle', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    nowPlaying: null,
    playing: false,
    tracks: [{ title: 'Song A' }, { title: 'Song B' }, { title: 'Song C' }],
  });
  const { deps, calls } = createDeps();

  const handled = await handleCommand({
    command: 'playnext',
    args: '3',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(calls.playNext, 1);
  assert.deepEqual(queue.tracks.map((track) => track.title), ['Song C', 'Song A', 'Song B']);
  assert.equal(
    replies[0],
    'Listo: **Song C** paso al frente de la cola (movida de 3 a 1).'
  );
});

test('timeskip command: seeks inside current track when target is within duration', async () => {
  const { message, replies } = createMessage();
  const { queue, counters } = createQueue({
    nowPlaying: { title: 'Song A', durationSec: 220 },
    tracks: [{ title: 'Next Song' }],
  });
  const { deps, calls } = createDeps({
    getPlaybackPositionSeconds() {
      calls.getPlaybackPositionSeconds += 1;
      return 40;
    },
  });

  const handled = await handleCommand({
    command: 'timeskip',
    args: '30',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(calls.getPlaybackPositionSeconds, 1);
  assert.equal(calls.stopTranscoder, 1);
  assert.equal(counters.stopCalls, 1);
  assert.equal(queue.suppressHistoryOnce, true);
  assert.equal(queue.preserveConnectionOnEmpty, true);
  assert.equal(queue.ignoreAbortErrors, true);
  assert.equal(queue.tracks[0].title, 'Song A');
  assert.equal(queue.tracks[0].startOffsetSec, 70);
  assert.equal(replies[0], 'Adelantando a 1:10 de 3:40.');
});

test('timeskip command: skips track if jump exceeds duration', async () => {
  const { message, replies } = createMessage();
  const { queue, counters } = createQueue({
    nowPlaying: { title: 'Song A', durationSec: 100 },
  });
  const { deps, calls } = createDeps({
    getPlaybackPositionSeconds() {
      calls.getPlaybackPositionSeconds += 1;
      return 90;
    },
  });

  const handled = await handleCommand({
    command: 'timeskip',
    args: '15',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(calls.getPlaybackPositionSeconds, 1);
  assert.equal(calls.stopTranscoder, 1);
  assert.equal(counters.stopCalls, 1);
  assert.equal(queue.tracks.length, 0);
  assert.equal(replies[0], 'El salto supera la duracion de la pista. Saltando cancion...');
});

test('prev command: loads previous track before current and triggers player stop', async () => {
  const { message, replies } = createMessage();
  const { queue, counters } = createQueue({
    playing: true,
    nowPlaying: { title: 'Song B' },
    history: [{ title: 'Song A' }],
    tracks: [{ title: 'Song C' }],
  });
  const { deps, calls } = createDeps();

  const handled = await handleCommand({
    command: 'prev',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(calls.stopTranscoder, 1);
  assert.equal(counters.stopCalls, 1);
  assert.equal(queue.suppressHistoryOnce, true);
  assert.equal(queue.tracks[0].title, 'Song A');
  assert.equal(queue.tracks[1].title, 'Song B');
  assert.equal(replies[0], 'Volviendo a: **Song A**');
});

test('stop command: clears state and disconnects', async () => {
  const { message, replies } = createMessage();
  const { queue, counters } = createQueue({
    tracks: [{ title: 'Song A' }],
    nowPlaying: { title: 'Song A' },
  });
  const { deps, calls } = createDeps();

  const handled = await handleCommand({
    command: 'stop',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(queue.tracks.length, 0);
  assert.equal(queue.nowPlaying, null);
  assert.equal(queue.connection, null);
  assert.equal(queue.voiceChannel, null);
  assert.equal(calls.stopTranscoder, 1);
  assert.equal(counters.stopCalls, 1);
  assert.equal(counters.destroyCalls, 1);
  assert.equal(replies[0], 'Reproduccion detenida y cola limpia.');
});

test('clear command: removes pending queue only', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    tracks: [{ title: 'Song A' }],
    nowPlaying: { title: 'Now' },
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'clear',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(queue.tracks.length, 0);
  assert.deepEqual(queue.nowPlaying, { title: 'Now' });
  assert.equal(replies[0], 'Cola limpia. La cancion actual sigue sonando.');
});

test('pause command: pauses player', async () => {
  const { message, replies } = createMessage();
  const { queue, counters } = createQueue();
  const { deps, calls } = createDeps();

  const handled = await handleCommand({
    command: 'pause',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(counters.pauseCalls, 1);
  assert.equal(calls.markPlaybackPaused, 1);
  assert.equal(replies[0], 'Pausa.');
});

test('resume command: unpauses player', async () => {
  const { message, replies } = createMessage();
  const { queue, counters } = createQueue();
  const { deps, calls } = createDeps();

  const handled = await handleCommand({
    command: 'resume',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(counters.unpauseCalls, 1);
  assert.equal(calls.markPlaybackResumed, 1);
  assert.equal(replies[0], 'Reanudado.');
});

test('queue command: prints current and pending tracks in one ordered list', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    nowPlaying: { title: 'Song A', isLive: false },
    tracks: [{ title: 'Song B', isLive: false }, { title: 'Song C', isLive: true }],
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'queue',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.match(replies[0], /Cola \(3\):/);
  assert.match(replies[0], /1\. \[SONANDO\] Song A/);
  assert.match(replies[0], /2\. Song B/);
  assert.match(replies[0], /3\. \[LIVE\] Song C/);
});

test('allqueue command: renders paginated card with history and current queue', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    history: [{ title: 'Song X', isLive: false }],
    nowPlaying: { title: 'Song A', isLive: false },
    tracks: [{ title: 'Song B', isLive: false }],
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'allqueue',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(typeof replies[0], 'object');
  const embeds = Array.isArray(replies[0]?.embeds) ? replies[0].embeds : [];
  assert.equal(embeds.length, 1);
  const title = String(embeds[0]?.data?.title || '');
  const description = String(embeds[0]?.data?.description || '');
  assert.match(title, /Historial \+ Cola Completa/i);
  assert.match(description, /H1\. Song X/i);
  assert.match(description, /Q1\. \[SONANDO\] Song A/i);
  assert.match(description, /Q2\. Song B/i);
  const components = Array.isArray(replies[0]?.components) ? replies[0].components : [];
  assert.ok(components.length > 0);
});

test('all queue alias: supports \"!all queue\" with paginated payload', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    history: [],
    nowPlaying: { title: 'Song A', isLive: false },
    tracks: [],
  });
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'all',
    args: 'queue',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  const embeds = Array.isArray(replies[0]?.embeds) ? replies[0].embeds : [];
  assert.equal(embeds.length, 1);
  const description = String(embeds[0]?.data?.description || '');
  assert.match(description, /Q1\. \[SONANDO\] Song A/i);
});
