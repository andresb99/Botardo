const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PokemonMiniGame,
  classifyRarity,
  buildBattleStats,
  calculateDamage,
} = require('../src/pokemon-game');

function buildMockResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function buildPokemonPayload(id, name, statsOverride = null) {
  const stats = statsOverride || {
    hp: 45,
    attack: 49,
    defense: 49,
    specialAttack: 65,
    specialDefense: 65,
    speed: 45,
  };
  return {
    id,
    name,
    species: {
      url: `https://pokeapi.co/api/v2/pokemon-species/${id}`,
    },
    stats: [
      { stat: { name: 'hp' }, base_stat: stats.hp },
      { stat: { name: 'attack' }, base_stat: stats.attack },
      { stat: { name: 'defense' }, base_stat: stats.defense },
      { stat: { name: 'special-attack' }, base_stat: stats.specialAttack },
      { stat: { name: 'special-defense' }, base_stat: stats.specialDefense },
      { stat: { name: 'speed' }, base_stat: stats.speed },
    ],
    sprites: {
      front_default: null,
      other: { 'official-artwork': { front_default: null } },
    },
    types: [{ slot: 1, type: { name: 'grass' } }],
    abilities: [{ ability: { name: 'overgrow' } }],
    moves: [{ move: { name: 'tackle' } }],
  };
}

function createPokemonCommandMessage({ userId = 'user-1', username = 'tester', guildId = 'guild-1' } = {}) {
  const replies = [];
  const typingCalls = { value: 0 };
  return {
    message: {
      author: { id: userId, username },
      guild: { id: guildId },
      channel: {
        async sendTyping() {
          typingCalls.value += 1;
        },
      },
      async reply(payload) {
        replies.push(payload);
      },
    },
    replies,
    typingCalls,
  };
}

function buildEvolutionChainPayload() {
  return {
    chain: {
      species: { name: 'bulbasaur' },
      evolution_details: [],
      evolves_to: [
        {
          species: { name: 'ivysaur' },
          evolution_details: [
            {
              trigger: { name: 'level-up' },
              min_level: 16,
              item: null,
              held_item: null,
              known_move: null,
              known_move_type: null,
              location: null,
              min_happiness: null,
              min_beauty: null,
              min_affection: null,
              party_species: null,
              party_type: null,
              relative_physical_stats: null,
              time_of_day: '',
              trade_species: null,
              needs_overworld_rain: false,
              turn_upside_down: false,
              gender: null,
            },
          ],
          evolves_to: [],
        },
      ],
    },
  };
}

function buildEvolutionFetchMock() {
  const pokemonById = new Map([
    [1, buildPokemonPayload(1, 'bulbasaur')],
    [2, buildPokemonPayload(2, 'ivysaur', {
      hp: 60,
      attack: 62,
      defense: 63,
      specialAttack: 80,
      specialDefense: 80,
      speed: 60,
    })],
  ]);
  const pokemonByName = new Map([
    ['bulbasaur', pokemonById.get(1)],
    ['ivysaur', pokemonById.get(2)],
  ]);
  const speciesById = new Map([
    [1, {
      id: 1,
      name: 'bulbasaur',
      capture_rate: 45,
      base_happiness: 70,
      gender_rate: 1,
      is_legendary: false,
      is_mythical: false,
      evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/1' },
    }],
    [2, {
      id: 2,
      name: 'ivysaur',
      capture_rate: 45,
      base_happiness: 70,
      gender_rate: 1,
      is_legendary: false,
      is_mythical: false,
      evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/1' },
    }],
  ]);
  const speciesByName = new Map([
    ['bulbasaur', speciesById.get(1)],
    ['ivysaur', speciesById.get(2)],
  ]);
  const evolutionChain = buildEvolutionChainPayload();

  return async (url) => {
    const target = String(url || '');

    if (/\/item\/rare-candy\/?$/i.test(target)) {
      return buildMockResponse({
        name: 'rare-candy',
        cost: 0,
        names: [{ language: { name: 'en' }, name: 'Rare Candy' }],
        effect_entries: [{ language: { name: 'en' }, short_effect: 'Raises a Pokemon level by one.' }],
        flavor_text_entries: [{ language: { name: 'en' }, text: 'A candy that is packed with energy.' }],
        category: { name: 'vitamins' },
        sprites: { default: null },
        attributes: [],
      });
    }

    if (/\/item\/exp-candy-l\/?$/i.test(target)) {
      return buildMockResponse({
        name: 'exp-candy-l',
        cost: 0,
        names: [{ language: { name: 'en' }, name: 'Exp. Candy L' }],
        effect_entries: [{ language: { name: 'en' }, short_effect: 'Gives experience points.' }],
        flavor_text_entries: [{ language: { name: 'en' }, text: 'A candy that is packed with energy.' }],
        category: { name: 'vitamins' },
        sprites: { default: null },
        attributes: [],
      });
    }

    if (/\/move\/tackle\/?$/i.test(target)) {
      return buildMockResponse({
        name: 'tackle',
        power: 40,
        accuracy: 100,
        pp: 35,
        type: { name: 'normal' },
        damage_class: { name: 'physical' },
        priority: 0,
      });
    }

    if (/\/evolution-chain\/1\/?$/i.test(target)) {
      return buildMockResponse(evolutionChain);
    }

    const pokemonMatch = target.match(/\/pokemon\/([^/?#]+)\/?$/i);
    if (pokemonMatch) {
      const key = pokemonMatch[1];
      const asId = Number(key);
      const payload = Number.isInteger(asId) && asId > 0
        ? pokemonById.get(asId)
        : pokemonByName.get(String(key).toLowerCase());
      if (!payload) return buildMockResponse({}, 404);
      return buildMockResponse(payload);
    }

    const speciesMatch = target.match(/\/pokemon-species\/([^/?#]+)\/?$/i);
    if (speciesMatch) {
      const key = speciesMatch[1];
      const asId = Number(key);
      const payload = Number.isInteger(asId) && asId > 0
        ? speciesById.get(asId)
        : speciesByName.get(String(key).toLowerCase());
      if (!payload) return buildMockResponse({}, 404);
      return buildMockResponse(payload);
    }

    return buildMockResponse({}, 404);
  };
}

function buildItemFetchMock() {
  return async (url) => {
    const target = String(url || '');

    if (/\/item\?limit=/i.test(target)) {
      return buildMockResponse({
        results: [
          { name: 'potion' },
          { name: 'leftovers' },
        ],
      });
    }

    if (/\/item\/potion\/?$/i.test(target)) {
      return buildMockResponse({
        name: 'potion',
        cost: 300,
        names: [{ language: { name: 'en' }, name: 'Potion' }],
        effect_entries: [{ language: { name: 'en' }, short_effect: 'Restores HP.' }],
        flavor_text_entries: [{ language: { name: 'en' }, text: 'A spray-type medicine.' }],
        category: { name: 'medicine' },
        sprites: { default: null },
        attributes: [],
      });
    }

    if (/\/item\/leftovers\/?$/i.test(target)) {
      return buildMockResponse({
        name: 'leftovers',
        cost: 4000,
        names: [{ language: { name: 'en' }, name: 'Leftovers' }],
        effect_entries: [{ language: { name: 'en' }, short_effect: 'Heals every turn.' }],
        flavor_text_entries: [{ language: { name: 'en' }, text: 'An item to be held.' }],
        category: { name: 'held-items' },
        sprites: { default: null },
        attributes: [],
      });
    }

    return buildMockResponse({}, 404);
  };
}

test('classifyRarity: legendary species are always legendary tier', () => {
  const rarity = classifyRarity({
    captureRate: 255,
    baseStatTotal: 350,
    isLegendary: true,
  });
  assert.equal(rarity, 'legendary');
});

test('buildBattleStats: computes deterministic level 50 battle stats', () => {
  const stats = buildBattleStats(
    {
      hp: 100,
      attack: 100,
      defense: 100,
      specialAttack: 100,
      specialDefense: 100,
      speed: 100,
    },
    50
  );

  assert.deepEqual(stats, {
    hp: 175,
    attack: 120,
    defense: 120,
    specialAttack: 120,
    specialDefense: 120,
    speed: 120,
  });
});

test('buildBattleStats: clamps IV/EV values to official limits', () => {
  const baseStats = {
    hp: 100,
    attack: 100,
    defense: 100,
    specialAttack: 100,
    specialDefense: 100,
    speed: 100,
  };

  const overflow = buildBattleStats(baseStats, 50, {
    ivs: {
      hp: 999,
      attack: 999,
      defense: 999,
      specialAttack: 999,
      specialDefense: 999,
      speed: 999,
    },
    evs: {
      hp: 999,
      attack: 999,
      defense: 999,
      specialAttack: 999,
      specialDefense: 999,
      speed: 999,
    },
    nature: 'hardy',
  });

  const officialCap = buildBattleStats(baseStats, 50, {
    ivs: {
      hp: 31,
      attack: 31,
      defense: 31,
      specialAttack: 31,
      specialDefense: 31,
      speed: 31,
    },
    evs: {
      hp: 252,
      attack: 252,
      defense: 6,
      specialAttack: 0,
      specialDefense: 0,
      speed: 0,
    },
    nature: 'hardy',
  });

  assert.deepEqual(overflow, officialCap);
});

test('buildBattleStats: keeps Shedinja HP at 1', () => {
  const stats = buildBattleStats(
    {
      hp: 1,
      attack: 90,
      defense: 45,
      specialAttack: 30,
      specialDefense: 30,
      speed: 40,
    },
    50,
    {
      ivs: { hp: 31, attack: 31, defense: 31, specialAttack: 31, specialDefense: 31, speed: 31 },
      evs: { hp: 252, attack: 252, defense: 4, specialAttack: 0, specialDefense: 0, speed: 2 },
      nature: 'adamant',
      dexId: 292,
      speciesName: 'shedinja',
    }
  );

  assert.equal(stats.hp, 1);
});

test('calculateDamage: applies type effectiveness and deals positive damage', () => {
  const attacker = {
    level: 50,
    types: ['fire'],
    ability: 'blaze',
    stats: {
      attack: 100,
      defense: 80,
      specialAttack: 120,
      specialDefense: 80,
      speed: 90,
    },
    currentHp: 150,
    maxHp: 150,
  };
  const defender = {
    types: ['grass'],
    ability: '',
    stats: {
      attack: 80,
      defense: 90,
      specialAttack: 80,
      specialDefense: 90,
      speed: 70,
    },
    currentHp: 150,
    maxHp: 150,
  };
  const move = {
    power: 90,
    accuracy: 100,
    type: 'fire',
    category: 'special',
    priority: 0,
  };
  const constantRng = () => 0.5;

  const result = calculateDamage({
    attacker,
    defender,
    move,
    rng: constantRng,
  });

  assert.equal(result.typeMultiplier, 2);
  assert.equal(result.critical, false);
  assert.ok(result.damage > 0);
});

test('calculateDamage: levitate blocks ground moves', () => {
  const result = calculateDamage({
    attacker: {
      level: 50,
      types: ['ground'],
      ability: '',
      stats: { attack: 100, defense: 100, specialAttack: 100, specialDefense: 100, speed: 100 },
      currentHp: 100,
      maxHp: 100,
    },
    defender: {
      types: ['electric'],
      ability: 'levitate',
      stats: { attack: 100, defense: 100, specialAttack: 100, specialDefense: 100, speed: 100 },
      currentHp: 100,
      maxHp: 100,
    },
    move: {
      power: 100,
      type: 'ground',
      category: 'physical',
      priority: 0,
      accuracy: 100,
    },
    rng: () => 0.5,
  });

  assert.equal(result.damage, 0);
  assert.equal(result.typeMultiplier, 0);
  assert.equal(result.immuneReason, 'levitate');
});

test('drawRandomPokemonByRarity: does not lock pulls to first cached species', async () => {
  const pokemonPayloads = new Map([
    [1, buildPokemonPayload(1, 'bulbasaur')],
    [2, buildPokemonPayload(2, 'ivysaur')],
  ]);
  const speciesPayload = {
    capture_rate: 255,
    is_legendary: false,
    is_mythical: false,
  };

  const fetchImpl = async (url) => {
    const target = String(url);
    const pokemonMatch = target.match(/\/pokemon\/(\d+)\/?$/i);
    if (pokemonMatch) {
      const id = Number(pokemonMatch[1]);
      const payload = pokemonPayloads.get(id);
      if (!payload) return buildMockResponse({}, 404);
      return buildMockResponse(payload);
    }

    const speciesMatch = target.match(/\/pokemon-species\/(\d+)\/?$/i);
    if (speciesMatch) {
      const id = Number(speciesMatch[1]);
      if (!pokemonPayloads.has(id)) return buildMockResponse({}, 404);
      return buildMockResponse(speciesPayload);
    }

    return buildMockResponse({}, 404);
  };

  const game = new PokemonMiniGame({ fetchImpl });
  await game.getPokemonTemplate(1);

  const rngValues = [0, 0.0015];
  const rng = () => (rngValues.length ? rngValues.shift() : 0.0015);
  const pulled = await game.drawRandomPokemonByRarity({ rng });

  assert.equal(pulled.dexId, 2);
});

test('evolve command: evolves Pokemon when requirements are met', async () => {
  const fetchImpl = buildEvolutionFetchMock();
  const game = new PokemonMiniGame({ fetchImpl });
  const { message, replies, typingCalls } = createPokemonCommandMessage();
  const profile = game.createEmptyProfile(message.author);
  const baseTemplate = await game.getPokemonTemplate('bulbasaur');
  const captured = game.capturePokemon(profile, baseTemplate);
  captured.level = 16;
  captured.experience = 4096;
  captured.nextLevelExperience = 4913;
  captured.gender = 'male';
  captured.knownMoves = ['tackle'];
  captured.selectedMoves = ['tackle'];
  const preEvolutionBaseStats = { ...captured.baseStats };
  const preEvolutionCalculated = buildBattleStats(preEvolutionBaseStats, captured.level, {
    evs: captured.evs,
    ivs: captured.ivs,
    nature: captured.nature,
  });
  profile.teamSlots[0] = captured.instanceId;
  game.ensureGuildStore(message.guild.id).set(message.author.id, profile);

  const handled = await game.handleMessageCommand({
    command: 'evolve',
    args: captured.instanceId,
    message,
  });

  assert.equal(handled, true);
  assert.equal(typingCalls.value, 1);
  assert.equal(captured.dexId, 2);
  assert.equal(captured.name, 'ivysaur');
  assert.equal(captured.speciesName, 'ivysaur');
  assert.deepEqual(captured.baseStats, {
    hp: 60,
    attack: 62,
    defense: 63,
    specialAttack: 80,
    specialDefense: 80,
    speed: 60,
  });
  const postEvolutionCalculated = buildBattleStats(captured.baseStats, captured.level, {
    evs: captured.evs,
    ivs: captured.ivs,
    nature: captured.nature,
  });
  assert.ok(postEvolutionCalculated.hp > preEvolutionCalculated.hp);
  assert.ok(postEvolutionCalculated.attack > preEvolutionCalculated.attack);
  assert.ok(postEvolutionCalculated.defense > preEvolutionCalculated.defense);
  assert.ok(postEvolutionCalculated.specialAttack > preEvolutionCalculated.specialAttack);
  assert.ok(postEvolutionCalculated.specialDefense > preEvolutionCalculated.specialDefense);
  assert.ok(postEvolutionCalculated.speed > preEvolutionCalculated.speed);
  assert.ok(replies.length > 0);
  const embeds = Array.isArray(replies[0]?.embeds) ? replies[0].embeds : [];
  const fields = embeds[0]?.data?.fields || [];
  assert.ok(fields.some((field) => /Stats recalculadas/i.test(String(field?.name || ''))));
});

test('evolve command: blocks evolution when requirements are not met', async () => {
  const fetchImpl = buildEvolutionFetchMock();
  const game = new PokemonMiniGame({ fetchImpl });
  const { message, replies } = createPokemonCommandMessage();
  const profile = game.createEmptyProfile(message.author);
  const baseTemplate = await game.getPokemonTemplate('bulbasaur');
  const captured = game.capturePokemon(profile, baseTemplate);
  captured.level = 10;
  captured.experience = 1000;
  captured.nextLevelExperience = 1331;
  captured.gender = 'male';
  captured.knownMoves = ['tackle'];
  captured.selectedMoves = ['tackle'];
  profile.teamSlots[0] = captured.instanceId;
  game.ensureGuildStore(message.guild.id).set(message.author.id, profile);

  const handled = await game.handleMessageCommand({
    command: 'evolve',
    args: captured.instanceId,
    message,
  });

  assert.equal(handled, true);
  assert.equal(captured.dexId, 1);
  assert.ok(replies.length > 0);
  const reply = replies[0];
  const embeds = Array.isArray(reply?.embeds) ? reply.embeds : [];
  const title = String(embeds[0]?.data?.title || '');
  assert.match(title, /Evolucion bloqueada/i);
  const requirementsFieldValue = String(embeds[0]?.data?.fields?.[0]?.value || '');
  assert.match(requirementsFieldValue, /nivel minimo 16/i);
});

test('pokedex command: shows a detailed pokedex card for dex number', async () => {
  const fetchImpl = buildEvolutionFetchMock();
  const game = new PokemonMiniGame({ fetchImpl });
  const { message, replies, typingCalls } = createPokemonCommandMessage();

  const handled = await game.handleMessageCommand({
    command: 'pokedex',
    args: '1',
    message,
  });

  assert.equal(handled, true);
  assert.equal(typingCalls.value, 1);
  assert.ok(replies.length > 0);

  const embeds = Array.isArray(replies[0]?.embeds) ? replies[0].embeds : [];
  assert.equal(embeds.length, 1);
  const title = String(embeds[0]?.data?.title || '');
  assert.match(title, /#0001/i);
  assert.match(title, /Bulbasaur/i);
  const fieldNames = (embeds[0]?.data?.fields || []).map((field) => String(field?.name || ''));
  assert.ok(fieldNames.some((name) => /Base stats/i.test(name)));
  assert.ok(fieldNames.some((name) => /Clasificacion/i.test(name)));
});

test('pokedex command: accepts pokemon name input', async () => {
  const fetchImpl = buildEvolutionFetchMock();
  const game = new PokemonMiniGame({ fetchImpl });
  const { message, replies, typingCalls } = createPokemonCommandMessage();

  const handled = await game.handleMessageCommand({
    command: 'pokedex',
    args: 'bulbasaur',
    message,
  });

  assert.equal(handled, true);
  assert.equal(typingCalls.value, 1);
  assert.ok(replies.length > 0);

  const embeds = Array.isArray(replies[0]?.embeds) ? replies[0].embeds : [];
  assert.equal(embeds.length, 1);
  const title = String(embeds[0]?.data?.title || '');
  assert.match(title, /#0001/i);
  assert.match(title, /Bulbasaur/i);
});

test('pokeuse command: uses rare candy and consumes item from bag', async () => {
  const fetchImpl = buildEvolutionFetchMock();
  const game = new PokemonMiniGame({ fetchImpl });
  const { message, replies, typingCalls } = createPokemonCommandMessage();
  const profile = game.createEmptyProfile(message.author);
  const baseTemplate = await game.getPokemonTemplate('bulbasaur');
  const captured = game.capturePokemon(profile, baseTemplate);
  captured.level = 5;
  captured.experience = 125;
  captured.nextLevelExperience = 216;
  profile.teamSlots[0] = captured.instanceId;
  profile.items['rare-candy'] = 2;
  game.ensureGuildStore(message.guild.id).set(message.author.id, profile);

  const handled = await game.handleMessageCommand({
    command: 'pokeuse',
    args: `rare-candy ${captured.instanceId}`,
    message,
  });

  assert.equal(handled, true);
  assert.equal(typingCalls.value, 1);
  assert.equal(captured.level, 6);
  assert.equal(profile.items['rare-candy'], 1);
  assert.ok(replies.length > 0);
  const embeds = Array.isArray(replies[0]?.embeds) ? replies[0].embeds : [];
  const title = String(embeds[0]?.data?.title || '');
  assert.match(title, /Objeto usado/i);
});

test('pokestat command: shows embed with base and calculated stats', async () => {
  const fetchImpl = buildEvolutionFetchMock();
  const game = new PokemonMiniGame({ fetchImpl });
  const { message, replies } = createPokemonCommandMessage();
  const profile = game.createEmptyProfile(message.author);
  const baseTemplate = await game.getPokemonTemplate('bulbasaur');
  const captured = game.capturePokemon(profile, baseTemplate);
  captured.level = 12;
  captured.experience = 1728;
  captured.nextLevelExperience = 2197;
  profile.teamSlots[0] = captured.instanceId;
  game.ensureGuildStore(message.guild.id).set(message.author.id, profile);

  const handled = await game.handleMessageCommand({
    command: 'pokestat',
    args: captured.instanceId,
    message,
  });

  assert.equal(handled, true);
  assert.ok(replies.length > 0);
  const reply = replies[0];
  const embeds = Array.isArray(reply?.embeds) ? reply.embeds : [];
  assert.equal(embeds.length, 1);
  const title = String(embeds[0]?.data?.title || '');
  assert.match(title, /Stats:/i);
  const fieldNames = (embeds[0]?.data?.fields || []).map((field) => String(field?.name || ''));
  assert.ok(fieldNames.some((name) => /Base stats/i.test(name)));
  assert.ok(fieldNames.some((name) => /Stats calculadas/i.test(name)));
  assert.ok(fieldNames.some((name) => /^IVs$/i.test(name)));
  assert.ok(fieldNames.some((name) => /^EVs$/i.test(name)));
});

test('pokebuy command: supports large quantities without 99-cap', async () => {
  const game = new PokemonMiniGame({ fetchImpl: buildItemFetchMock() });
  const { message } = createPokemonCommandMessage();
  const profile = game.createEmptyProfile(message.author);
  profile.money = 500_000;
  game.ensureGuildStore(message.guild.id).set(message.author.id, profile);

  const handled = await game.handleMessageCommand({
    command: 'pokebuy',
    args: 'potion 250',
    message,
  });

  assert.equal(handled, true);
  assert.equal(profile.items.potion, 250);
  assert.equal(profile.money, 500_000 - (300 * 250));
});

test('normalizeItemBag: keeps arbitrary game items with positive amounts', () => {
  const game = new PokemonMiniGame({ fetchImpl: async () => buildMockResponse({}, 404) });
  const normalized = game.normalizeItemBag({
    potion: 3,
    'master-ball': 1,
    'x-attack': 2000,
    invalid: 0,
  });

  assert.deepEqual(normalized, {
    potion: 3,
    'master-ball': 1,
    'x-attack': 2000,
  });
});
