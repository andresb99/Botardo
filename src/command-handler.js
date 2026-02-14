const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} = require('discord.js');

const ALL_QUEUE_PAGE_SIZE = 12;
const ALL_QUEUE_TTL_MS = 5 * 60 * 1000;
const ALL_QUEUE_BUTTONS = Object.freeze({
  FIRST: 'allq:first',
  PREV_TEN: 'allq:prev10',
  PREV: 'allq:prev',
  NEXT: 'allq:next',
  NEXT_TEN: 'allq:next10',
});

function trimText(value, max = 180) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}...`;
}

function formatTrackLabel(track, options = {}) {
  const isNowPlaying = Boolean(options.isNowPlaying);
  const nowFlag = isNowPlaying ? '[SONANDO] ' : '';
  const liveFlag = track?.isLive ? '[LIVE] ' : '';
  return `${nowFlag}${liveFlag}${trimText(track?.title || 'Sin titulo', 180)}`;
}

function formatTrackLine(track, index, options = {}) {
  return `${index}. ${formatTrackLabel(track, options)}`;
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

function clampPage(value, totalPages) {
  if (totalPages <= 1) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 0;
  return Math.max(0, Math.min(parsed, totalPages - 1));
}

function buildAllQueueButtons(page, totalPages, forceDisabled = false) {
  const atStart = page <= 0;
  const atEnd = page >= totalPages - 1;
  const disabled = forceDisabled || totalPages <= 1;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(ALL_QUEUE_BUTTONS.FIRST)
        .setEmoji('⏮️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || atStart),
      new ButtonBuilder()
        .setCustomId(ALL_QUEUE_BUTTONS.PREV_TEN)
        .setLabel('-10')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || atStart),
      new ButtonBuilder()
        .setCustomId(ALL_QUEUE_BUTTONS.PREV)
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || atStart),
      new ButtonBuilder()
        .setCustomId(ALL_QUEUE_BUTTONS.NEXT)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || atEnd),
      new ButtonBuilder()
        .setCustomId(ALL_QUEUE_BUTTONS.NEXT_TEN)
        .setLabel('+10')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || atEnd)
    ),
  ];
}

function buildAllQueuePagePayload(queue, page, options = {}) {
  const history = Array.isArray(queue?.history) ? queue.history : [];
  const currentItems = buildQueueItems(queue || {});
  const totalItems = history.length + currentItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ALL_QUEUE_PAGE_SIZE));
  const safePage = clampPage(page, totalPages);
  const start = safePage * ALL_QUEUE_PAGE_SIZE;
  const endExclusive = Math.min(totalItems, start + ALL_QUEUE_PAGE_SIZE);

  const lines = [];
  for (let index = start; index < endExclusive; index += 1) {
    if (index < history.length) {
      const historyTrack = history[index];
      lines.push(`H${index + 1}. ${formatTrackLabel(historyTrack)}`);
      continue;
    }

    const currentIndex = index - history.length;
    const item = currentItems[currentIndex];
    lines.push(`Q${currentIndex + 1}. ${formatTrackLabel(item?.track, { isNowPlaying: item?.isNowPlaying })}`);
  }

  const startLabel = totalItems ? start + 1 : 0;
  const endLabel = totalItems ? endExclusive : 0;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Historial + Cola Completa')
    .setDescription(
      totalItems
        ? `Mostrando **${startLabel}-${endLabel}** de **${totalItems}** pistas.\nPrefijos: **H** = historial, **Q** = cola actual.\n\n${lines.join('\n')}`
        : 'La cola esta vacia ahora mismo.'
    )
    .addFields(
      { name: 'Historial', value: String(history.length), inline: true },
      { name: 'Cola actual', value: String(currentItems.length), inline: true },
      { name: 'Pagina', value: `${safePage + 1}/${totalPages}`, inline: true }
    );

  const components = buildAllQueueButtons(safePage, totalPages, Boolean(options.disabled));
  return {
    page: safePage,
    totalPages,
    payload: {
      embeds: [embed],
      components,
    },
  };
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
    '`!allqueue` (`!all queue`) - ver historial + cola completa (paginada)',
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
    const totalItems =
      (Array.isArray(queue.history) ? queue.history.length : 0)
      + buildQueueItems(queue).length;
    if (!totalItems) {
      await message.reply('La cola esta vacia.');
      return true;
    }

    let currentPage = 0;
    const first = buildAllQueuePagePayload(queue, currentPage);
    currentPage = first.page;
    const sent = await message.reply(first.payload);

    if (!sent || typeof sent.createMessageComponentCollector !== 'function') {
      return true;
    }

    const collector = sent.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: ALL_QUEUE_TTL_MS,
    });

    collector.on('collect', async (interaction) => {
      try {
        if (interaction.user?.id !== message.author?.id) {
          await interaction.reply({
            content: 'Este panel de cola lo controla quien ejecuto el comando.',
            ephemeral: true,
          });
          return;
        }

        switch (interaction.customId) {
          case ALL_QUEUE_BUTTONS.FIRST:
            currentPage = 0;
            break;
          case ALL_QUEUE_BUTTONS.PREV_TEN:
            currentPage = Math.max(0, currentPage - 10);
            break;
          case ALL_QUEUE_BUTTONS.PREV:
            currentPage = Math.max(0, currentPage - 1);
            break;
          case ALL_QUEUE_BUTTONS.NEXT:
            currentPage += 1;
            break;
          case ALL_QUEUE_BUTTONS.NEXT_TEN:
            currentPage += 10;
            break;
          default:
            await interaction.deferUpdate();
            return;
        }

        const next = buildAllQueuePagePayload(queue, currentPage);
        currentPage = next.page;
        await interaction.update(next.payload);
      } catch {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.deferUpdate().catch(() => {});
        }
      }
    });

    collector.on('end', async () => {
      try {
        const finalPage = buildAllQueuePagePayload(queue, currentPage, { disabled: true });
        await sent.edit(finalPage.payload);
      } catch {
        // no-op
      }
    });

    return true;
  }

  return false;
}

module.exports = {
  handleCommand,
};
