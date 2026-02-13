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
    cloneTrack(track) {
      return { ...track };
    },
    ...overrides,
  };

  return { deps, calls };
}

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
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'pause',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(counters.pauseCalls, 1);
  assert.equal(replies[0], 'Pausa.');
});

test('resume command: unpauses player', async () => {
  const { message, replies } = createMessage();
  const { queue, counters } = createQueue();
  const { deps } = createDeps();

  const handled = await handleCommand({
    command: 'resume',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.equal(counters.unpauseCalls, 1);
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

test('allqueue command: prints history plus full current queue', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    history: [{ title: 'Song X', isLive: false }],
    nowPlaying: { title: 'Song A', isLive: false },
    tracks: [{ title: 'Song B', isLive: false }],
  });
  const { deps } = createDeps({
    splitForDiscord(text) {
      return [text];
    },
  });

  const handled = await handleCommand({
    command: 'allqueue',
    args: '',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.match(replies[0], /Historial \(1\):/);
  assert.match(replies[0], /1\. Song X/);
  assert.match(replies[0], /Cola actual \(2\):/);
  assert.match(replies[0], /1\. \[SONANDO\] Song A/);
  assert.match(replies[0], /2\. Song B/);
});

test('all queue alias: supports \"!all queue\"', async () => {
  const { message, replies } = createMessage();
  const { queue } = createQueue({
    history: [],
    nowPlaying: { title: 'Song A', isLive: false },
    tracks: [],
  });
  const { deps } = createDeps({
    splitForDiscord(text) {
      return [text];
    },
  });

  const handled = await handleCommand({
    command: 'all',
    args: 'queue',
    message,
    queue,
    deps,
  });

  assert.equal(handled, true);
  assert.match(replies[0], /Cola actual \(1\):/);
});
