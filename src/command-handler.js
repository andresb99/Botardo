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

function formatSeconds(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function buildHelpText() {
  return [
    'Comandos disponibles:',
    '`!help` - mostrar esta ayuda',
    '`!play <url|busqueda>` / `!stream <url|busqueda>` - agregar pista(s)',
    '`!skip` - saltar pista actual',
    '`!skipto <posicion>` (`!jump`) - saltar a una posicion de cola',
    '`!playnext <posicion>` (`!upnext`) - poner una pista como siguiente',
    '`!move <desde> <hacia>` - reordenar cola',
    '`!remove <posicion>` (`!rm`, `!del`) - quitar una pista de la cola',
    '`!timeskip <segundos>` (`!seek`, `!ts`) - adelantar dentro de la pista',
    '`!prev` - volver a la pista anterior',
    '`!pause` / `!resume` - pausar o reanudar',
    '`!queue` - ver cola resumida',
    '`!allqueue` (`!all queue`) - ver historial + cola completa',
    '`!clear` - limpiar pendientes',
    '`!stop` - detener y desconectar',
    '`!ask <pregunta>` - consultar Gemini',
    '`!pokehelp` - comandos del mini-juego Pokemon',
    '`!evolve <slot|PKxxxx|indice>` - evolucionar Pokemon (ver requisitos en pokehelp)',
    'Nota de posiciones: si hay cancion sonando, la posicion 1 es la actual.',
  ].join('\n');
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
    getPlaybackPositionSeconds = () => 0,
    markPlaybackPaused = () => {},
    markPlaybackResumed = () => {},
    maxAskChunks = 4,
  } = deps;

  if (command === 'help' || command === 'commands' || command === 'ayuda') {
    await message.reply(buildHelpText());
    return true;
  }

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

  if (command === 'skipto' || command === 'jump' || command === 'jumpto') {
    const targetPosition = parsePositiveInt(args?.trim());
    if (!targetPosition) {
      await message.reply('Uso: `!skipto <posicion>`');
      return true;
    }

    if (!queue.nowPlaying && !queue.tracks.length) {
      await message.reply('La cola esta vacia.');
      return true;
    }

    if (queue.nowPlaying) {
      const maxPosition = queue.tracks.length + 1;
      if (targetPosition < 1 || targetPosition > maxPosition) {
        await message.reply(`Posicion invalida. Debe estar entre 1 y ${maxPosition}.`);
        return true;
      }

      if (targetPosition === 1) {
        await message.reply('Esa pista ya esta sonando.');
        return true;
      }

      const beforeTarget = targetPosition - 2;
      const skippedPending = queue.tracks.splice(0, beforeTarget);
      const targetTrack = queue.tracks[0];
      if (!targetTrack) {
        await message.reply('No pude encontrar esa pista en la cola.');
        return true;
      }

      queue.preserveConnectionOnEmpty = true;
      queue.ignoreAbortErrors = true;
      stopTranscoder(queue);
      queue.player.stop(true);
      await message.reply(
        `Saltando a la posicion ${targetPosition}: **${targetTrack.title}**. ` +
        `Se omitieron ${skippedPending.length + 1} pista(s).`
      );
      return true;
    }

    const maxPosition = queue.tracks.length;
    if (targetPosition < 1 || targetPosition > maxPosition) {
      await message.reply(`Posicion invalida. Debe estar entre 1 y ${maxPosition}.`);
      return true;
    }

    if (targetPosition === 1) {
      await message.reply('Esa pista ya es la siguiente en la cola.');
      return true;
    }

    const skipped = queue.tracks.splice(0, targetPosition - 1);
    const targetTrack = queue.tracks[0];
    if (queue.connection && !queue.playing && !queue.nowPlaying && queue.tracks.length) {
      await playNext(message.guild.id);
    }
    await message.reply(
      `Cola adelantada a la posicion ${targetPosition}: **${targetTrack?.title || 'Sin titulo'}**. ` +
      `Se omitieron ${skipped.length} pista(s).`
    );
    return true;
  }

  if (command === 'playnext' || command === 'upnext' || command === 'nextup') {
    const targetPosition = parsePositiveInt(args?.trim());
    if (!targetPosition) {
      await message.reply('Uso: `!playnext <posicion>`');
      return true;
    }

    if (!queue.nowPlaying && !queue.tracks.length) {
      await message.reply('La cola esta vacia.');
      return true;
    }

    if (queue.nowPlaying) {
      const maxPosition = queue.tracks.length + 1;
      if (targetPosition < 2 || targetPosition > maxPosition) {
        await message.reply(`Posicion invalida. Debe estar entre 2 y ${maxPosition}.`);
        return true;
      }
      if (targetPosition === 2) {
        await message.reply('Esa pista ya esta programada como siguiente.');
        return true;
      }

      const fromIndex = targetPosition - 2;
      const [track] = queue.tracks.splice(fromIndex, 1);
      queue.tracks.unshift(track);
      await message.reply(
        `Listo: **${track?.title || 'Sin titulo'}** sonara justo despues de la actual ` +
        `(movida de ${targetPosition} a 2).`
      );
      return true;
    }

    const maxPosition = queue.tracks.length;
    if (targetPosition < 1 || targetPosition > maxPosition) {
      await message.reply(`Posicion invalida. Debe estar entre 1 y ${maxPosition}.`);
      return true;
    }
    if (targetPosition === 1) {
      await message.reply('Esa pista ya esta al frente de la cola.');
      return true;
    }

    const fromIndex = targetPosition - 1;
    const [track] = queue.tracks.splice(fromIndex, 1);
    queue.tracks.unshift(track);
    if (queue.connection && !queue.playing && !queue.nowPlaying && queue.tracks.length) {
      await playNext(message.guild.id);
    }
    await message.reply(
      `Listo: **${track?.title || 'Sin titulo'}** paso al frente de la cola ` +
      `(movida de ${targetPosition} a 1).`
    );
    return true;
  }

  if (command === 'move' || command === 'movetrack' || command === 'reorder') {
    const [fromRaw, toRaw] = String(args || '').trim().split(/\s+/);
    const fromPosition = parsePositiveInt(fromRaw);
    const toPosition = parsePositiveInt(toRaw);
    if (!fromPosition || !toPosition) {
      await message.reply('Uso: `!move <desde> <hacia>`');
      return true;
    }

    if (!queue.nowPlaying && queue.tracks.length < 2) {
      await message.reply('No hay suficientes pistas para reordenar.');
      return true;
    }

    if (queue.nowPlaying) {
      const maxPosition = queue.tracks.length + 1;
      if (fromPosition === 1 || toPosition === 1) {
        await message.reply('No puedes mover la pista que ya esta sonando (posicion 1).');
        return true;
      }
      if (
        fromPosition < 2 ||
        fromPosition > maxPosition ||
        toPosition < 2 ||
        toPosition > maxPosition
      ) {
        await message.reply(`Posiciones invalidas. Deben estar entre 2 y ${maxPosition}.`);
        return true;
      }
      if (fromPosition === toPosition) {
        await message.reply('La pista ya esta en esa posicion.');
        return true;
      }

      const fromIndex = fromPosition - 2;
      const toIndex = toPosition - 2;
      const [track] = queue.tracks.splice(fromIndex, 1);
      queue.tracks.splice(toIndex, 0, track);
      await message.reply(
        `Movi **${track?.title || 'Sin titulo'}** de la posicion ${fromPosition} a la ${toPosition}.`
      );
      return true;
    }

    const maxPosition = queue.tracks.length;
    if (
      fromPosition < 1 ||
      fromPosition > maxPosition ||
      toPosition < 1 ||
      toPosition > maxPosition
    ) {
      await message.reply(`Posiciones invalidas. Deben estar entre 1 y ${maxPosition}.`);
      return true;
    }
    if (fromPosition === toPosition) {
      await message.reply('La pista ya esta en esa posicion.');
      return true;
    }

    const fromIndex = fromPosition - 1;
    const toIndex = toPosition - 1;
    const [track] = queue.tracks.splice(fromIndex, 1);
    queue.tracks.splice(toIndex, 0, track);
    await message.reply(
      `Movi **${track?.title || 'Sin titulo'}** de la posicion ${fromPosition} a la ${toPosition}.`
    );
    return true;
  }

  if (command === 'remove' || command === 'rm' || command === 'del') {
    const targetPosition = parsePositiveInt(args?.trim());
    if (!targetPosition) {
      await message.reply('Uso: `!remove <posicion>`');
      return true;
    }

    if (!queue.nowPlaying && !queue.tracks.length) {
      await message.reply('La cola esta vacia.');
      return true;
    }

    if (queue.nowPlaying) {
      const maxPosition = queue.tracks.length + 1;
      if (targetPosition < 1 || targetPosition > maxPosition) {
        await message.reply(`Posicion invalida. Debe estar entre 1 y ${maxPosition}.`);
        return true;
      }
      if (targetPosition === 1) {
        await message.reply('No puedes remover la pista actual con `!remove`. Usa `!skip`.');
        return true;
      }

      const removeIndex = targetPosition - 2;
      const [removed] = queue.tracks.splice(removeIndex, 1);
      await message.reply(
        `Removida de la cola (posicion ${targetPosition}): **${removed?.title || 'Sin titulo'}**.`
      );
      return true;
    }

    const maxPosition = queue.tracks.length;
    if (targetPosition < 1 || targetPosition > maxPosition) {
      await message.reply(`Posicion invalida. Debe estar entre 1 y ${maxPosition}.`);
      return true;
    }

    const removeIndex = targetPosition - 1;
    const [removed] = queue.tracks.splice(removeIndex, 1);
    await message.reply(
      `Removida de la cola (posicion ${targetPosition}): **${removed?.title || 'Sin titulo'}**.`
    );
    return true;
  }

  if (command === 'timeskip' || command === 'seek' || command === 'ts') {
    if (!args) {
      await message.reply('Uso: `!timeskip <segundos>`');
      return true;
    }

    if (!queue.nowPlaying) {
      await message.reply('No hay ninguna pista sonando.');
      return true;
    }

    if (queue.nowPlaying.isLive) {
      await message.reply('No se puede adelantar una transmision en vivo.');
      return true;
    }

    const jumpSeconds = Number(args);
    if (!Number.isFinite(jumpSeconds) || jumpSeconds <= 0) {
      await message.reply('Ingresa una cantidad de segundos valida (mayor a 0).');
      return true;
    }

    const currentPosition = Math.max(0, Number(getPlaybackPositionSeconds(queue)) || 0);
    const targetPosition = currentPosition + jumpSeconds;
    const durationSec = Number(queue.nowPlaying.durationSec);
    const hasDuration = Number.isFinite(durationSec) && durationSec > 0;

    if (hasDuration && targetPosition >= durationSec) {
      queue.preserveConnectionOnEmpty = true;
      queue.ignoreAbortErrors = true;
      stopTranscoder(queue);
      queue.player.stop(true);
      await message.reply('El salto supera la duracion de la pista. Saltando cancion...');
      return true;
    }

    const resumedTrack = cloneTrack(queue.nowPlaying);
    resumedTrack.startOffsetSec = targetPosition;
    resumedTrack.prefetchedUrl = null;
    queue.tracks.unshift(resumedTrack);
    queue.suppressHistoryOnce = true;
    queue.preserveConnectionOnEmpty = true;
    queue.ignoreAbortErrors = true;
    stopTranscoder(queue);
    queue.player.stop(true);

    const durationNote = hasDuration
      ? ` de ${formatSeconds(durationSec)}`
      : '';
    await message.reply(
      `Adelantando a ${formatSeconds(targetPosition)}${durationNote}.`
    );
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
    markPlaybackPaused(queue);
    queue.player.pause();
    await message.reply('Pausa.');
    return true;
  }

  if (command === 'resume') {
    markPlaybackResumed(queue);
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
