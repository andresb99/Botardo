function formatTrackLine(track, index, options = {}) {
  const isNowPlaying = Boolean(options.isNowPlaying);
  const nowFlag = isNowPlaying ? '[SONANDO] ' : '';
  const liveFlag = track?.isLive ? '[LIVE] ' : '';
  return `${index}. ${nowFlag}${liveFlag}${track?.title || 'Sin titulo'}`;
}

function buildQueueItems(queue) {
  const items = [];
  if (queue.nowPlaying) {
    items.push({ track: queue.nowPlaying, isNowPlaying: true });
  }
  for (const track of queue.tracks) {
    items.push({ track, isNowPlaying: false });
  }
  return items;
}

function buildAllQueueReport(queue) {
  const history = queue.history || [];
  const currentItems = buildQueueItems(queue);

  if (!history.length && !currentItems.length) {
    return null;
  }

  const lines = [];
  lines.push(`Historial (${history.length}):`);
  if (history.length) {
    const historyLines = history.map((track, i) => formatTrackLine(track, i + 1));
    lines.push(...historyLines);
  } else {
    lines.push('Sin pistas anteriores.');
  }

  lines.push('');
  lines.push(`Cola actual (${currentItems.length}):`);
  if (currentItems.length) {
    const currentLines = currentItems.map((item, i) =>
      formatTrackLine(item.track, i + 1, { isNowPlaying: item.isNowPlaying })
    );
    lines.push(...currentLines);
  } else {
    lines.push('Sin canciones en cola.');
  }

  return lines.join('\n');
}

async function handleCommand({ command, args, message, queue, deps }) {
  const {
    connectToVoice,
    getTracksFromQuery,
    playNext,
    prefetchNext,
    askGemini,
    splitForDiscord,
    stopTranscoder,
    cloneTrack,
    maxAskChunks = 4,
  } = deps;

  if (command === 'play' || command === 'stream') {
    if (!args) {
      await message.reply('Uso: `!play <url o busqueda>`');
      return true;
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      await message.reply('Entra a un canal de voz primero.');
      return true;
    }

    try {
      await connectToVoice(queue, voiceChannel);
      const tracks = await getTracksFromQuery(args, message.author.username);

      if (!tracks.length) {
        await message.reply('No encontre resultados.');
        return true;
      }

      queue.tracks.push(...tracks);
      const queueCount = queue.tracks.length + (queue.nowPlaying ? 1 : 0);
      await message.reply(
        `Agregadas ${tracks.length} pista(s). En cola ahora: ${queueCount}.`
      );

      if (!queue.playing) {
        await playNext(message.guild.id);
      } else {
        void prefetchNext(message.guild.id);
      }
    } catch (err) {
      console.error(err);
      await message.reply(`Error: ${err.message}`);
    }

    return true;
  }

  if (command === 'ask') {
    if (!args) {
      await message.reply('Uso: `!ask <tu pregunta>`');
      return true;
    }

    try {
      await message.channel.sendTyping();
      const answer = await askGemini(args);
      const chunks = splitForDiscord(answer);
      if (!chunks.length) {
        await message.reply('No recibi texto para responder.');
        return true;
      }
      for (const chunk of chunks.slice(0, maxAskChunks)) {
        await message.reply(chunk);
      }
      if (chunks.length > maxAskChunks) {
        await message.reply('Respuesta recortada por longitud.');
      }
    } catch (err) {
      console.error('Error AI:', err.message);
      await message.reply(`Error en !ask: ${err.message}`);
    }
    return true;
  }

  if (command === 'skip') {
    if (!queue.nowPlaying) {
      await message.reply('No hay ninguna pista sonando.');
      return true;
    }
    queue.preserveConnectionOnEmpty = true;
    queue.ignoreAbortErrors = true;
    stopTranscoder(queue);
    queue.player.stop(true);
    await message.reply('Saltando pista...');
    return true;
  }

  if (command === 'prev') {
    if (!queue.history.length) {
      await message.reply('No hay una pista anterior en el historial.');
      return true;
    }

    try {
      if (!queue.connection) {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
          await message.reply('Entra a un canal de voz primero.');
          return true;
        }
        await connectToVoice(queue, voiceChannel);
      }

      const previous = cloneTrack(queue.history.pop());

      if (queue.nowPlaying) {
        queue.tracks.unshift(cloneTrack(queue.nowPlaying));
      }
      queue.tracks.unshift(previous);

      if (queue.nowPlaying || queue.playing) {
        queue.suppressHistoryOnce = true;
        queue.preserveConnectionOnEmpty = true;
        queue.ignoreAbortErrors = true;
        stopTranscoder(queue);
        queue.player.stop(true);
      } else {
        await playNext(message.guild.id);
      }

      await message.reply(`Volviendo a: **${previous.title}**`);
    } catch (err) {
      console.error(err);
      await message.reply(`Error: ${err.message}`);
    }
    return true;
  }

  if (command === 'stop') {
    queue.tracks = [];
    queue.preserveConnectionOnEmpty = false;
    queue.ignoreAbortErrors = true;
    queue.transitionInProgress = false;
    queue.suppressHistoryOnce = false;
    stopTranscoder(queue);
    queue.player.stop(true);
    queue.connection?.destroy();
    queue.connection = null;
    queue.voiceChannel = null;
    queue.nowPlaying = null;
    await message.reply('Reproduccion detenida y cola limpia.');
    return true;
  }

  if (command === 'clear') {
    queue.tracks = [];
    await message.reply('Cola limpia. La cancion actual sigue sonando.');
    return true;
  }

  if (command === 'pause') {
    queue.player.pause();
    await message.reply('Pausa.');
    return true;
  }

  if (command === 'resume') {
    queue.player.unpause();
    await message.reply('Reanudado.');
    return true;
  }

  if (command === 'queue') {
    if (!queue.tracks.length && !queue.nowPlaying) {
      await message.reply('La cola esta vacia.');
      return true;
    }

    const items = buildQueueItems(queue);

    const list = items
      .slice(0, 10)
      .map((item, i) => formatTrackLine(item.track, i + 1, { isNowPlaying: item.isNowPlaying }));
    const footer =
      items.length > 10 ? `\n...y ${items.length - 10} mas` : '';
    const body = list.length ? `Cola (${items.length}):\n${list.join('\n')}` : 'Sin canciones en cola.';
    await message.reply(`${body}${footer}`);
    return true;
  }

  if (command === 'allqueue' || (command === 'all' && args.toLowerCase() === 'queue')) {
    const report = buildAllQueueReport(queue);
    if (!report) {
      await message.reply('La cola esta vacia.');
      return true;
    }

    const chunks = splitForDiscord(report, 1900);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
    return true;
  }

  return false;
}

module.exports = {
  handleCommand,
};
