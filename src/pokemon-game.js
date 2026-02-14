const crypto = require('node:crypto');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
let competitiveCalc = null;
try {
  competitiveCalc = require('@smogon/calc');
} catch {
  competitiveCalc = null;
}

const POKE_API_BASE = 'https://pokeapi.co/api/v2';
const MAX_DEX_ID = Math.max(1, Number(process.env.POKEMON_MAX_DEX_ID || 1025));
const START_PULLS = Math.max(1, Number(process.env.POKEMON_START_PULLS || 20));
const DAILY_PULLS = Math.max(1, Number(process.env.POKEMON_DAILY_PULLS || 5));
const DAILY_COOLDOWN_MINUTES_RAW = Number(process.env.POKEMON_DAILY_COOLDOWN_MINUTES || '');
const DAILY_COOLDOWN_HOURS_RAW = Number(process.env.POKEMON_DAILY_COOLDOWN_HOURS || 24);
const DAILY_COOLDOWN_MS =
  (Number.isFinite(DAILY_COOLDOWN_MINUTES_RAW) && DAILY_COOLDOWN_MINUTES_RAW > 0)
    ? Math.floor(DAILY_COOLDOWN_MINUTES_RAW * 60 * 1000)
    : Math.max(1, DAILY_COOLDOWN_HOURS_RAW) * 60 * 60 * 1000;
const MAX_PULL_BATCH = Math.max(1, Math.min(20, Number(process.env.POKEMON_MAX_PULL_BATCH || 10)));
const TEAM_SIZE = Math.max(1, Math.min(6, Number(process.env.POKEMON_TEAM_SIZE || 6)));
const BATTLE_LEVEL = Math.max(1, Math.min(100, Number(process.env.POKEMON_BATTLE_LEVEL || 50)));
const CAPTURE_LEVEL = Math.max(1, Math.min(100, Number(process.env.POKEMON_CAPTURE_LEVEL || 5)));
const START_MONEY = Math.max(0, Math.floor(Number(process.env.POKEMON_START_MONEY || 3000)));
const DAILY_MONEY = Math.max(0, Math.floor(Number(process.env.POKEMON_DAILY_MONEY || 600)));
const PVP_MONEY_WIN = Math.max(0, Math.floor(Number(process.env.POKEMON_PVP_MONEY_WIN || 500)));
const PVP_MONEY_LOSS = Math.max(0, Math.floor(Number(process.env.POKEMON_PVP_MONEY_LOSS || 200)));
const PVP_XP_WIN = Math.max(10, Number(process.env.POKEMON_PVP_XP_WIN || 80));
const PVP_XP_LOSS = Math.max(5, Number(process.env.POKEMON_PVP_XP_LOSS || 35));
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const PULL_CAROUSEL_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const LOG_LIMIT = 8;

const STRUGGLE_MOVE = Object.freeze({
  name: 'struggle',
  displayName: 'Struggle',
  power: 50,
  accuracy: 100,
  pp: 1,
  type: 'normal',
  category: 'physical',
  priority: 0,
});

const RARITY_WEIGHTS = [
  { tier: 'common', weight: 6500, label: 'Common' },
  { tier: 'uncommon', weight: 2200, label: 'Uncommon' },
  { tier: 'rare', weight: 1000, label: 'Rare' },
  { tier: 'epic', weight: 250, label: 'Epic' },
  { tier: 'legendary', weight: 50, label: 'Legendary' },
];

const RARITY_LABELS = Object.freeze(
  RARITY_WEIGHTS.reduce((acc, item) => {
    acc[item.tier] = item.label;
    return acc;
  }, {})
);

const RARITY_COLORS = Object.freeze({
  common: 0x7f8c8d,
  uncommon: 0x2ecc71,
  rare: 0x3498db,
  epic: 0x9b59b6,
  legendary: 0xf1c40f,
});

const DEFAULT_POKEMON_PLACEHOLDER_IMAGE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png';
const SHOWDOWN_ANIMATED_SPRITE_BASE = 'https://play.pokemonshowdown.com/sprites/ani';
const SHOWDOWN_FORM_SUFFIXES = new Set([
  'alola',
  'galar',
  'hisui',
  'paldea',
  'mega',
  'mega-x',
  'mega-y',
  'gmax',
  'totem',
  'therian',
  'incarnate',
  'origin',
  'altered',
  'sky',
  'zen',
  'ash',
  'school',
  'busted',
  'lowkey',
  'amped',
  'dusk',
  'dawn',
  'midnight',
  'attack',
  'defense',
  'speed',
  'blade',
  'shield',
  'f',
  'm',
  'female',
  'male',
  'sandy',
  'trash',
  'plant',
  'heat',
  'wash',
  'frost',
  'fan',
  'mow',
]);

const COMPETITIVE_ITEM_DEX = Object.freeze({
  'leftovers': { displayName: 'Leftovers', description: 'Recupera PS cada turno.', price: 1400 },
  'life-orb': { displayName: 'Life Orb', description: 'Aumenta danio, pero hiere al usuario.', price: 1800 },
  'choice-band': { displayName: 'Choice Band', description: 'Mas Ataque, bloquea movimiento.', price: 2200 },
  'choice-specs': { displayName: 'Choice Specs', description: 'Mas At. Esp., bloquea movimiento.', price: 2200 },
  'choice-scarf': { displayName: 'Choice Scarf', description: 'Mas Velocidad, bloquea movimiento.', price: 2200 },
  'assault-vest': { displayName: 'Assault Vest', description: 'Sube Def. Esp., sin movimientos de estado.', price: 1600 },
  'focus-sash': { displayName: 'Focus Sash', description: 'Sobrevive a un golpe a PS completos.', price: 1200 },
  'expert-belt': { displayName: 'Expert Belt', description: 'Sube danio super efectivo.', price: 1300 },
  'eviolite': { displayName: 'Eviolite', description: 'Sube defensas si puede evolucionar.', price: 1100 },
  'sitrus-berry': { displayName: 'Sitrus Berry', description: 'Recupera PS al bajar de cierto umbral.', price: 350 },
  'black-sludge': { displayName: 'Black Sludge', description: 'Recupera PS a tipo Veneno.', price: 1200 },
  'muscle-band': { displayName: 'Muscle Band', description: 'Sube movimientos fisicos.', price: 900 },
  'wise-glasses': { displayName: 'Wise Glasses', description: 'Sube movimientos especiales.', price: 900 },
});

const EXP_CANDY_XP = Object.freeze({
  'exp-candy-xs': 100,
  'exp-candy-s': 800,
  'exp-candy-m': 3000,
  'exp-candy-l': 10_000,
  'exp-candy-xl': 30_000,
});

const VITAMIN_EV_ITEMS = Object.freeze({
  'hp-up': 'hp',
  protein: 'attack',
  iron: 'defense',
  calcium: 'specialAttack',
  zinc: 'specialDefense',
  carbos: 'speed',
});

const EV_REDUCE_BERRIES = Object.freeze({
  'pomeg-berry': 'hp',
  'kelpsy-berry': 'attack',
  'qualot-berry': 'defense',
  'hondew-berry': 'specialAttack',
  'grepa-berry': 'specialDefense',
  'tamato-berry': 'speed',
});

const DEFAULT_ITEM_BAG = Object.freeze({});
const ITEM_API_LIMIT = Math.max(1, Number(process.env.POKEMON_ITEM_API_LIMIT || 2500));
const ITEM_STORE_PAGE_SIZE = 10;
const ITEM_BAG_PAGE_SIZE = 10;
const ITEM_LABEL_CACHE = new Map();
const ITEM_PRICE_CACHE = new Map();
const ITEM_DESCRIPTION_CACHE = new Map();

const TYPE_CHART = Object.freeze({
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: {
    fire: 0.5,
    water: 0.5,
    grass: 2,
    ice: 2,
    bug: 2,
    rock: 0.5,
    dragon: 0.5,
    steel: 2,
  },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: {
    fire: 0.5,
    water: 2,
    grass: 0.5,
    poison: 0.5,
    ground: 2,
    flying: 0.5,
    bug: 0.5,
    rock: 2,
    dragon: 0.5,
    steel: 0.5,
  },
  ice: {
    fire: 0.5,
    water: 0.5,
    grass: 2,
    ground: 2,
    flying: 2,
    dragon: 2,
    steel: 0.5,
    ice: 0.5,
  },
  fighting: {
    normal: 2,
    ice: 2,
    poison: 0.5,
    flying: 0.5,
    psychic: 0.5,
    bug: 0.5,
    rock: 2,
    ghost: 0,
    dark: 2,
    steel: 2,
    fairy: 0.5,
  },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: {
    fire: 0.5,
    grass: 2,
    fighting: 0.5,
    poison: 0.5,
    flying: 0.5,
    psychic: 2,
    ghost: 0.5,
    dark: 2,
    steel: 0.5,
    fairy: 0.5,
  },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
});

const STAT_KEYS = Object.freeze([
  'hp',
  'attack',
  'defense',
  'specialAttack',
  'specialDefense',
  'speed',
]);

const DEFAULT_GROWTH_RATE = 'medium-fast';
const VALID_GROWTH_RATES = new Set([
  'erratic',
  'fast',
  'medium-fast',
  'medium-slow',
  'slow',
  'fluctuating',
]);

function normalizeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[.'"]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function displayNameFromSlug(value) {
  const cleaned = normalizeSlug(value);
  if (!cleaned) return 'Unknown';
  return cleaned
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function randomIntInclusive(min, max, rng = Math.random) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function weightedPick(items, rng = Math.random) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return items[0];
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatMoney(value) {
  const amount = Math.max(0, Math.floor(Number(value) || 0));
  return `$${amount.toLocaleString('es-ES')}`;
}

function hpBar(current, max, width = 14) {
  if (!max || max <= 0) return '[--------------]';
  const ratio = clamp(current / max, 0, 1);
  const filled = Math.round(ratio * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}]`;
}

function getTypeMultiplier(moveType, defenderType) {
  const atkType = normalizeSlug(moveType);
  const defType = normalizeSlug(defenderType);
  return TYPE_CHART[atkType]?.[defType] ?? 1;
}

function classifyRarity({ captureRate, baseStatTotal, isLegendary }) {
  if (isLegendary) return 'legendary';
  const capture = Number.isFinite(captureRate) ? captureRate : 120;
  const bst = Number.isFinite(baseStatTotal) ? baseStatTotal : 400;

  if (bst >= 600 || capture <= 20) return 'epic';
  if (bst >= 530 || capture <= 45) return 'rare';
  if (bst >= 430 || capture <= 100) return 'uncommon';
  return 'common';
}

function statFromPokemonStats(stats, name) {
  const row = (stats || []).find((entry) => entry?.stat?.name === name);
  return Number(row?.base_stat || 0);
}

function buildBattleStats(baseStats, level = BATTLE_LEVEL, options = {}) {
  const normalizedLevel = clamp(Math.floor(Number(level) || 1), 1, 100);
  const ivs = normalizeIvSpread(options.ivs, {
    hp: 31,
    attack: 31,
    defense: 31,
    specialAttack: 31,
    specialDefense: 31,
    speed: 31,
  });
  const evs = normalizeEvSpread(options.evs, {
    hp: 0,
    attack: 0,
    defense: 0,
    specialAttack: 0,
    specialDefense: 0,
    speed: 0,
  });
  const nature = normalizeNature(options.nature || 'hardy');
  const natureRule = NATURE_MODIFIERS[nature] || NATURE_MODIFIERS.hardy;
  const natureMultiplier = (statName) => {
    if (natureRule.up === statName) return 1.1;
    if (natureRule.down === statName) return 0.9;
    return 1;
  };

  const hp = isShedinjaPokemon(options)
    ? 1
    : Math.floor(
      ((2 * baseStats.hp + ivs.hp + Math.floor(evs.hp / 4)) * normalizedLevel) / 100
    ) + normalizedLevel + 10;
  const attack = Math.floor((
    Math.floor(((2 * baseStats.attack + ivs.attack + Math.floor(evs.attack / 4)) * normalizedLevel) / 100) + 5
  ) * natureMultiplier('attack'));
  const defense = Math.floor((
    Math.floor(((2 * baseStats.defense + ivs.defense + Math.floor(evs.defense / 4)) * normalizedLevel) / 100) + 5
  ) * natureMultiplier('defense'));
  const specialAttack = Math.floor((
    Math.floor(((2 * baseStats.specialAttack + ivs.specialAttack + Math.floor(evs.specialAttack / 4)) * normalizedLevel) / 100) + 5
  ) * natureMultiplier('specialAttack'));
  const specialDefense = Math.floor((
    Math.floor(((2 * baseStats.specialDefense + ivs.specialDefense + Math.floor(evs.specialDefense / 4)) * normalizedLevel) / 100) + 5
  ) * natureMultiplier('specialDefense'));
  const speed = Math.floor((
    Math.floor(((2 * baseStats.speed + ivs.speed + Math.floor(evs.speed / 4)) * normalizedLevel) / 100) + 5
  ) * natureMultiplier('speed'));

  return {
    hp,
    attack,
    defense,
    specialAttack,
    specialDefense,
    speed,
  };
}

function calculateDamage({ attacker, defender, move, rng = Math.random }) {
  // Ability-based immunities/recovery are resolved here so battle flow can show the right message.
  const result = {
    damage: 0,
    critical: false,
    typeMultiplier: 1,
    absorbed: false,
    healRatio: 0,
    immuneReason: null,
  };

  if (!move || move.category === 'status' || !move.power) {
    return result;
  }

  const moveType = normalizeSlug(move.type || 'normal');
  const defenderAbility = normalizeSlug(defender.ability || '');
  if (defenderAbility === 'water-absorb' && moveType === 'water') {
    result.typeMultiplier = 0;
    result.absorbed = true;
    result.healRatio = 0.25;
    return result;
  }

  if (defenderAbility === 'volt-absorb' && moveType === 'electric') {
    result.typeMultiplier = 0;
    result.absorbed = true;
    result.healRatio = 0.25;
    return result;
  }

  if (defenderAbility === 'levitate' && moveType === 'ground') {
    result.typeMultiplier = 0;
    result.immuneReason = 'levitate';
    return result;
  }

  if (defenderAbility === 'flash-fire' && moveType === 'fire') {
    result.typeMultiplier = 0;
    result.immuneReason = 'flash-fire';
    return result;
  }

  if (competitiveCalc) {
    try {
      const { Generations, calculate, Pokemon, Move, Field } = competitiveCalc;
      const gen = Generations.get(9);

      const toCalcStats = (stats) => ({
        hp: Math.max(0, Math.floor(Number(stats?.hp ?? 0))),
        atk: Math.max(0, Math.floor(Number(stats?.attack ?? 0))),
        def: Math.max(0, Math.floor(Number(stats?.defense ?? 0))),
        spa: Math.max(0, Math.floor(Number(stats?.specialAttack ?? 0))),
        spd: Math.max(0, Math.floor(Number(stats?.specialDefense ?? 0))),
        spe: Math.max(0, Math.floor(Number(stats?.speed ?? 0))),
      });

      const attackerLevel = clamp(Math.floor(Number(attacker.level || BATTLE_LEVEL)), 1, 100);
      const defenderLevel = clamp(Math.floor(Number(defender.level || BATTLE_LEVEL)), 1, 100);
      const attackerEvs = toCalcStats(normalizeEvSpread(attacker.evs, {
        hp: 0,
        attack: 0,
        defense: 0,
        specialAttack: 0,
        specialDefense: 0,
        speed: 0,
      }));
      const defenderEvs = toCalcStats(normalizeEvSpread(defender.evs, {
        hp: 0,
        attack: 0,
        defense: 0,
        specialAttack: 0,
        specialDefense: 0,
        speed: 0,
      }));
      const attackerIvs = toCalcStats(normalizeIvSpread(attacker.ivs, {
        hp: 31,
        attack: 31,
        defense: 31,
        specialAttack: 31,
        specialDefense: 31,
        speed: 31,
      }));
      const defenderIvs = toCalcStats(normalizeIvSpread(defender.ivs, {
        hp: 31,
        attack: 31,
        defense: 31,
        specialAttack: 31,
        specialDefense: 31,
        speed: 31,
      }));
      const attackerNature = getCalcDisplayName(attacker.nature || 'hardy');
      const defenderNature = getCalcDisplayName(defender.nature || 'hardy');
      const attackerSpecies = getCalcDisplayName(attacker.speciesName || attacker.name || attacker.displayName || 'pikachu');
      const defenderSpecies = getCalcDisplayName(defender.speciesName || defender.name || defender.displayName || 'pikachu');
      const attackerItem = attacker.heldItem ? getCompetitiveItem(attacker.heldItem)?.displayName : null;
      const defenderItem = defender.heldItem ? getCompetitiveItem(defender.heldItem)?.displayName : null;
      const critical = rng() < 1 / 24;

      const calcAttacker = new Pokemon(gen, String(attackerSpecies), {
        level: attackerLevel,
        ability: getCalcDisplayName(attacker.ability || ''),
        item: attackerItem || undefined,
        nature: attackerNature,
        evs: attackerEvs,
        ivs: attackerIvs,
        boosts: attacker.boosts || {},
        status: attacker.status || undefined,
      });
      const calcDefender = new Pokemon(gen, String(defenderSpecies), {
        level: defenderLevel,
        ability: getCalcDisplayName(defender.ability || ''),
        item: defenderItem || undefined,
        nature: defenderNature,
        evs: defenderEvs,
        ivs: defenderIvs,
        boosts: defender.boosts || {},
        status: defender.status || undefined,
      });

      const calcMove = new Move(gen, getCalcDisplayName(move.name || move.displayName || 'Tackle'), {
        isCrit: critical,
        bp: Math.max(0, Number(move.power || 0)),
        type: getCalcDisplayName(moveType || 'normal'),
        category: normalizeSlug(move.category) === 'special' ? 'Special' : 'Physical',
        priority: Number(move.priority || 0),
      });
      const calcField = new Field({});
      const damageResult = calculate(gen, calcAttacker, calcDefender, calcMove, calcField);

      const rawDamage = damageResult?.damage;
      let damage = 0;
      if (Array.isArray(rawDamage)) {
        const values = rawDamage
          .flatMap((item) => Array.isArray(item) ? item : [item])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value));
        if (values.length) {
          const rollIndex = clamp(Math.floor(rng() * values.length), 0, values.length - 1);
          damage = values[rollIndex];
        }
      } else if (Number.isFinite(Number(rawDamage))) {
        damage = Number(rawDamage);
      }

      let typeMultiplier = 1;
      for (const type of defender.types || []) {
        typeMultiplier *= getTypeMultiplier(moveType, type);
      }
      result.critical = critical;
      result.typeMultiplier = typeMultiplier;
      result.damage = Math.max(0, Math.floor(Number(damage) || 0));
      if (result.damage <= 0 && typeMultiplier > 0 && Number(move.power || 0) > 0) {
        return calculateDamageFallback({ attacker, defender, move, rng, result });
      }
      return result;
    } catch {
      // Fallback handled below.
    }
  }

  return calculateDamageFallback({ attacker, defender, move, rng, result });
}

function calculateDamageFallback({ attacker, defender, move, rng = Math.random, result = null }) {
  const baseResult = result || {
    damage: 0,
    critical: false,
    typeMultiplier: 1,
    absorbed: false,
    healRatio: 0,
    immuneReason: null,
  };

  if (!move || move.category === 'status' || !move.power) {
    return baseResult;
  }

  const moveType = normalizeSlug(move.type || 'normal');
  const defenderAbility = normalizeSlug(defender.ability || '');

  if (defenderAbility === 'levitate' && moveType === 'ground') {
    baseResult.typeMultiplier = 0;
    baseResult.immuneReason = 'levitate';
    return baseResult;
  }
  if (defenderAbility === 'flash-fire' && moveType === 'fire') {
    baseResult.typeMultiplier = 0;
    baseResult.immuneReason = 'flash-fire';
    return baseResult;
  }

  let typeMultiplier = 1;
  for (const type of defender.types || []) {
    typeMultiplier *= getTypeMultiplier(moveType, type);
  }
  baseResult.typeMultiplier = typeMultiplier;
  if (typeMultiplier === 0) return baseResult;

  const attackStat = move.category === 'special'
    ? attacker.stats.specialAttack
    : attacker.stats.attack;
  const defenseStat = move.category === 'special'
    ? defender.stats.specialDefense
    : defender.stats.defense;
  const attackerItem = normalizeItemId(attacker.heldItem || '');
  const defenderItem = normalizeItemId(defender.heldItem || '');
  let adjustedAttackStat = attackStat;
  let adjustedDefenseStat = defenseStat;

  if (attackerItem === 'choice-band' && move.category === 'physical') adjustedAttackStat = Math.floor(adjustedAttackStat * 1.5);
  if (attackerItem === 'choice-specs' && move.category === 'special') adjustedAttackStat = Math.floor(adjustedAttackStat * 1.5);
  if (defenderItem === 'assault-vest' && move.category === 'special') adjustedDefenseStat = Math.floor(adjustedDefenseStat * 1.5);

  const level = Number(attacker.level || BATTLE_LEVEL);

  const baseDamage = Math.floor(
    Math.floor(
      Math.floor((((2 * level) / 5 + 2) * move.power * Math.max(1, adjustedAttackStat)) / Math.max(1, adjustedDefenseStat)) / 50
    ) + 2
  );

  const critical = rng() < 1 / 24;
  baseResult.critical = critical;
  const randomFactor = 0.85 + rng() * 0.15;

  let stab = (attacker.types || []).includes(moveType) ? 1.5 : 1;
  const attackerAbility = normalizeSlug(attacker.ability || '');
  if (stab > 1 && attackerAbility === 'adaptability') {
    stab = 2;
  }

  let offensiveAbilityMultiplier = 1;
  const hpRatio = attacker.maxHp > 0 ? attacker.currentHp / attacker.maxHp : 1;
  if (hpRatio <= 1 / 3) {
    if (attackerAbility === 'blaze' && moveType === 'fire') offensiveAbilityMultiplier *= 1.5;
    if (attackerAbility === 'torrent' && moveType === 'water') offensiveAbilityMultiplier *= 1.5;
    if (attackerAbility === 'overgrow' && moveType === 'grass') offensiveAbilityMultiplier *= 1.5;
    if (attackerAbility === 'swarm' && moveType === 'bug') offensiveAbilityMultiplier *= 1.5;
  }

  let defensiveAbilityMultiplier = 1;
  if (defenderAbility === 'thick-fat' && (moveType === 'fire' || moveType === 'ice')) {
    defensiveAbilityMultiplier *= 0.5;
  }

  const criticalMultiplier = critical ? 1.5 : 1;
  let itemMultiplier = 1;
  if (attackerItem === 'life-orb') itemMultiplier *= 1.3;
  if (attackerItem === 'muscle-band' && move.category === 'physical') itemMultiplier *= 1.1;
  if (attackerItem === 'wise-glasses' && move.category === 'special') itemMultiplier *= 1.1;
  if (attackerItem === 'expert-belt' && typeMultiplier > 1) itemMultiplier *= 1.2;
  const modifier =
    criticalMultiplier
    * randomFactor
    * stab
    * typeMultiplier
    * offensiveAbilityMultiplier
    * defensiveAbilityMultiplier
    * itemMultiplier;

  let damage = Math.floor(baseDamage * modifier);
  damage = Math.max(1, damage);
  baseResult.damage = damage;
  return baseResult;
}

function trimText(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}...` : text;
}

function rarityColor(tier) {
  return RARITY_COLORS[normalizeSlug(tier)] || 0x2f3136;
}

function getOfficialArtworkUrl(dexId) {
  const parsed = Number(dexId);
  if (!Number.isInteger(parsed) || parsed <= 0) return '';
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${parsed}.png`;
}

function getDefaultSpriteUrl(dexId) {
  const parsed = Number(dexId);
  if (!Number.isInteger(parsed) || parsed <= 0) return '';
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${parsed}.png`;
}

function getPokeApiAnimatedSpriteUrl(dexId) {
  const parsed = Number(dexId);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 649) return '';
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${parsed}.gif`;
}

function buildShowdownSpriteNameCandidates(nameOrSlug) {
  const normalized = normalizeSlug(
    String(nameOrSlug || '')
      .replace(/\u2640/g, '-f')
      .replace(/\u2642/g, '-m')
      .replace(/:/g, '-')
  );
  if (!normalized) return [];

  const parts = normalized.split('-').filter(Boolean);
  if (!parts.length) return [];

  const candidates = [];
  const push = (value) => {
    const cleaned = String(value || '').trim().toLowerCase();
    if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned);
  };

  const fused = parts.join('');
  let splitIndex = -1;
  for (let i = 1; i < parts.length; i += 1) {
    const suffix = parts.slice(i).join('-');
    if (SHOWDOWN_FORM_SUFFIXES.has(suffix) || SHOWDOWN_FORM_SUFFIXES.has(parts[i])) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex > 0) {
    const base = parts.slice(0, splitIndex).join('');
    const form = parts.slice(splitIndex).join('-');
    push(`${base}-${form}`);
    push(`${base}${form.replace(/-/g, '')}`);
  }

  if (parts.length > 1 && SHOWDOWN_FORM_SUFFIXES.has(parts[parts.length - 1])) {
    push(parts.join('-'));
    push(fused);
  } else {
    push(fused);
    push(parts.join('-'));
  }

  return candidates;
}

function getShowdownAnimatedSpriteUrl(nameOrSlug) {
  const [first] = buildShowdownSpriteNameCandidates(nameOrSlug);
  if (!first) return '';
  return `${SHOWDOWN_ANIMATED_SPRITE_BASE}/${first}.gif`;
}

function getAnimatedSpriteFromPokemonPayload(pokemonPayload) {
  const animated = pokemonPayload?.sprites?.versions?.['generation-v']?.['black-white']?.animated;
  const candidates = [
    getShowdownAnimatedSpriteUrl(pokemonPayload?.name || pokemonPayload?.species?.name),
    animated?.front_default,
    animated?.front_female,
    getPokeApiAnimatedSpriteUrl(pokemonPayload?.id),
  ];
  for (const candidate of candidates) {
    const url = typeof candidate === 'string' ? candidate.trim() : '';
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return '';
}

function resolvePokemonImageUrl(pokemon) {
  const showdownGif = getShowdownAnimatedSpriteUrl(
    pokemon?.speciesName || pokemon?.name || pokemon?.displayName
  );
  if (showdownGif) return showdownGif;

  const spriteGif = typeof pokemon?.spriteGif === 'string' ? pokemon.spriteGif.trim() : '';
  if (spriteGif && /^https?:\/\//i.test(spriteGif)) return spriteGif;

  const fallbackGif = getPokeApiAnimatedSpriteUrl(pokemon?.dexId);
  if (fallbackGif) return fallbackGif;

  const staticSprite = getDefaultSpriteUrl(pokemon?.dexId);
  if (staticSprite) return staticSprite;

  const sprite = typeof pokemon?.sprite === 'string' ? pokemon.sprite.trim() : '';
  if (sprite && /^https?:\/\//i.test(sprite)) return sprite;

  const artwork = getOfficialArtworkUrl(pokemon?.dexId);
  if (artwork) return artwork;
  return DEFAULT_POKEMON_PLACEHOLDER_IMAGE;
}

function formatDexNumber(dexId) {
  const parsed = Number(dexId);
  if (!Number.isInteger(parsed) || parsed <= 0) return '#???';
  return `#${String(parsed).padStart(4, '0')}`;
}

const NATURE_MODIFIERS = Object.freeze({
  hardy: { up: null, down: null },
  lonely: { up: 'attack', down: 'defense' },
  brave: { up: 'attack', down: 'speed' },
  adamant: { up: 'attack', down: 'specialAttack' },
  naughty: { up: 'attack', down: 'specialDefense' },
  bold: { up: 'defense', down: 'attack' },
  docile: { up: null, down: null },
  relaxed: { up: 'defense', down: 'speed' },
  impish: { up: 'defense', down: 'specialAttack' },
  lax: { up: 'defense', down: 'specialDefense' },
  timid: { up: 'speed', down: 'attack' },
  hasty: { up: 'speed', down: 'defense' },
  serious: { up: null, down: null },
  jolly: { up: 'speed', down: 'specialAttack' },
  naive: { up: 'speed', down: 'specialDefense' },
  modest: { up: 'specialAttack', down: 'attack' },
  mild: { up: 'specialAttack', down: 'defense' },
  quiet: { up: 'specialAttack', down: 'speed' },
  bashful: { up: null, down: null },
  rash: { up: 'specialAttack', down: 'specialDefense' },
  calm: { up: 'specialDefense', down: 'attack' },
  gentle: { up: 'specialDefense', down: 'defense' },
  sassy: { up: 'specialDefense', down: 'speed' },
  careful: { up: 'specialDefense', down: 'specialAttack' },
  quirky: { up: null, down: null },
});

function normalizeGrowthRate(value) {
  const slug = normalizeSlug(value || DEFAULT_GROWTH_RATE);
  if (VALID_GROWTH_RATES.has(slug)) return slug;
  return DEFAULT_GROWTH_RATE;
}

function getExperienceForLevel(level, growthRate = DEFAULT_GROWTH_RATE) {
  const normalizedLevel = clamp(Math.floor(Number(level) || 1), 1, 100);
  const normalizedGrowth = normalizeGrowthRate(growthRate);
  let experience = normalizedLevel ** 3;

  switch (normalizedGrowth) {
    case 'erratic':
      if (normalizedLevel <= 50) {
        experience = (normalizedLevel ** 3 * (100 - normalizedLevel)) / 50;
      } else if (normalizedLevel <= 68) {
        experience = (normalizedLevel ** 3 * (150 - normalizedLevel)) / 100;
      } else if (normalizedLevel <= 98) {
        experience = (normalizedLevel ** 3 * (1911 - 10 * normalizedLevel)) / 1500;
      } else {
        experience = (normalizedLevel ** 3 * (160 - normalizedLevel)) / 100;
      }
      break;
    case 'fast':
      experience = (4 * normalizedLevel ** 3) / 5;
      break;
    case 'medium-slow':
      experience = ((6 * normalizedLevel ** 3) / 5) - (15 * normalizedLevel ** 2) + (100 * normalizedLevel) - 140;
      break;
    case 'slow':
      experience = (5 * normalizedLevel ** 3) / 4;
      break;
    case 'fluctuating':
      if (normalizedLevel <= 15) {
        experience = (normalizedLevel ** 3 * (Math.floor((normalizedLevel + 1) / 3) + 24)) / 50;
      } else if (normalizedLevel <= 36) {
        experience = (normalizedLevel ** 3 * (normalizedLevel + 14)) / 50;
      } else {
        experience = (normalizedLevel ** 3 * (Math.floor(normalizedLevel / 2) + 32)) / 50;
      }
      break;
    case 'medium-fast':
    default:
      experience = normalizedLevel ** 3;
      break;
  }

  return Math.max(0, Math.floor(experience));
}

function getLevelFromExperience(experience, growthRate = DEFAULT_GROWTH_RATE) {
  const exp = Math.max(0, Math.floor(Number(experience) || 0));
  const normalizedGrowth = normalizeGrowthRate(growthRate);
  let level = 1;
  while (level < 100 && getExperienceForLevel(level + 1, normalizedGrowth) <= exp) {
    level += 1;
  }
  return level;
}

function getNextLevelExperience(level, growthRate = DEFAULT_GROWTH_RATE) {
  const normalizedLevel = clamp(Math.floor(Number(level) || 1), 1, 100);
  const normalizedGrowth = normalizeGrowthRate(growthRate);
  if (normalizedLevel >= 100) return getExperienceForLevel(100, normalizedGrowth);
  return getExperienceForLevel(normalizedLevel + 1, normalizedGrowth);
}

function normalizeNature(value) {
  const slug = normalizeSlug(value || 'hardy');
  if (NATURE_MODIFIERS[slug]) return slug;
  return 'hardy';
}

function clampStatValue(rawValue, fallbackValue, options = {}) {
  const min = Number.isFinite(Number(options.min)) ? Number(options.min) : Number.NEGATIVE_INFINITY;
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : Number.POSITIVE_INFINITY;
  const parsed = Number(rawValue);
  const normalized = Number.isFinite(parsed) ? parsed : Number(fallbackValue || 0);
  return clamp(Math.floor(normalized), min, max);
}

function normalizeStatSpread(value, fallback, options = {}) {
  const min = Number.isFinite(Number(options.min)) ? Number(options.min) : Number.NEGATIVE_INFINITY;
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : Number.POSITIVE_INFINITY;
  const totalCap = Number.isFinite(Number(options.totalCap)) ? Math.max(0, Math.floor(Number(options.totalCap))) : null;
  const source = value && typeof value === 'object' ? value : {};

  const spread = {};
  for (const key of STAT_KEYS) {
    spread[key] = clampStatValue(source[key], fallback?.[key], { min, max });
  }

  if (!Number.isFinite(totalCap)) return spread;

  const currentTotal = STAT_KEYS.reduce((sum, key) => sum + spread[key], 0);
  if (currentTotal <= totalCap) return spread;

  let overflow = currentTotal - totalCap;
  for (const key of [...STAT_KEYS].reverse()) {
    if (overflow <= 0) break;
    const reducible = Math.min(spread[key], overflow);
    spread[key] -= reducible;
    overflow -= reducible;
  }

  if (overflow > 0) {
    spread.hp = Math.max(0, spread.hp - overflow);
  }
  return spread;
}

function normalizeIvSpread(value, fallback) {
  return normalizeStatSpread(value, fallback, { min: 0, max: 31 });
}

function normalizeEvSpread(value, fallback) {
  return normalizeStatSpread(value, fallback, { min: 0, max: 252, totalCap: 510 });
}

function randomIvSpread() {
  const spread = {};
  for (const key of STAT_KEYS) {
    spread[key] = randomIntInclusive(0, 31);
  }
  return spread;
}

function isShedinjaPokemon(options = {}) {
  const dexId = Number(options.dexId || 0);
  if (dexId === 292) return true;
  const speciesName = normalizeSlug(options.speciesName || options.name || '');
  return speciesName === 'shedinja';
}

function normalizeItemId(value) {
  return normalizeSlug(value);
}

function getCompetitiveItem(itemId) {
  const id = normalizeItemId(itemId);
  return COMPETITIVE_ITEM_DEX[id] || null;
}

function getItemPrice(itemId) {
  const id = normalizeItemId(itemId);
  if (ITEM_PRICE_CACHE.has(id)) {
    return Math.max(0, Math.floor(Number(ITEM_PRICE_CACHE.get(id) || 0)));
  }
  const item = getCompetitiveItem(itemId);
  return Math.max(0, Math.floor(Number(item?.price || 0)));
}

function getItemDescription(itemId) {
  const id = normalizeItemId(itemId);
  const competitive = getCompetitiveItem(id);
  if (competitive?.description) return competitive.description;
  if (ITEM_DESCRIPTION_CACHE.has(id)) {
    return String(ITEM_DESCRIPTION_CACHE.get(id) || '');
  }
  return '';
}

function getCalcDisplayName(value) {
  return displayNameFromSlug(String(value || '').replace(/[^a-z0-9\s-]/gi, ' '));
}

function randomChoice(items) {
  if (!Array.isArray(items) || !items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function isChoiceItem(itemId) {
  const id = normalizeItemId(itemId);
  return id === 'choice-band' || id === 'choice-specs' || id === 'choice-scarf';
}

function formatItemName(itemId) {
  const id = normalizeItemId(itemId);
  if (ITEM_LABEL_CACHE.has(id)) {
    return ITEM_LABEL_CACHE.get(id);
  }
  const item = getCompetitiveItem(itemId);
  if (item) return item.displayName;
  return itemId ? displayNameFromSlug(itemId) : 'Sin objeto';
}

function formatExperienceText(pokemon) {
  const level = clamp(Math.floor(Number(pokemon?.level || 1)), 1, 100);
  const experience = Math.max(0, Math.floor(Number(pokemon?.experience || 0)));
  const growthRate = normalizeGrowthRate(pokemon?.growthRate);
  const nextLevelExperience = Math.max(
    experience,
    Number(pokemon?.nextLevelExperience || getNextLevelExperience(level, growthRate))
  );
  if (level >= 100) {
    return `Lv.100 (MAX) - XP ${experience}`;
  }
  return `Lv.${level} - XP ${experience}/${nextLevelExperience}`;
}

function ensureArrayUnique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = normalizeSlug(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizePokemonGender(value) {
  const normalized = normalizeSlug(value);
  if (normalized === 'male' || normalized === 'female' || normalized === 'genderless') {
    return normalized;
  }
  return 'unknown';
}

function resolveGenderFromRate(genderRate, rng = Math.random) {
  const rate = Number(genderRate);
  if (rate === -1) return 'genderless';
  const clampedRate = Math.max(0, Math.min(8, Number.isFinite(rate) ? rate : 4));
  const femaleChance = clampedRate / 8;
  return rng() < femaleChance ? 'female' : 'male';
}

function parseBooleanInput(value) {
  const normalized = normalizeSlug(value);
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'si';
}

function inferTimeOfDayFromDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const hour = date.getHours();
  return hour >= 6 && hour < 18 ? 'day' : 'night';
}

function normalizeTimeOfDay(value) {
  const normalized = normalizeSlug(value);
  if (normalized === 'day' || normalized === 'night' || normalized === 'dusk') return normalized;
  return '';
}

function formatGenderRateText(genderRate) {
  const rate = Number(genderRate);
  if (rate === -1) return 'Genderless';
  if (!Number.isFinite(rate)) return 'Unknown';
  const clampedRate = clamp(rate, 0, 8);
  const female = (clampedRate / 8) * 100;
  const male = 100 - female;
  return `M ${male.toFixed(1)}% | F ${female.toFixed(1)}%`;
}

function pickLocalizedSpeciesText(entries, languages = ['es', 'en']) {
  const rows = Array.isArray(entries) ? entries : [];
  for (const lang of languages) {
    const match = rows.find((entry) => normalizeSlug(entry?.language?.name) === normalizeSlug(lang));
    if (match) return String(match.flavor_text || match.genus || '').replace(/\s+/g, ' ').trim();
  }
  const fallback = rows.find((entry) => entry?.flavor_text || entry?.genus);
  if (!fallback) return '';
  return String(fallback.flavor_text || fallback.genus || '').replace(/\s+/g, ' ').trim();
}

function parsePokedexInputToLookup(input) {
  const raw = String(input || '').trim().replace(/^#/, '');
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const dexId = Number(raw);
    if (!Number.isInteger(dexId) || dexId <= 0) return null;
    return String(dexId);
  }

  const normalized = normalizeSlug(
    raw
      .replace(/\u2640/g, '-f')
      .replace(/\u2642/g, '-m')
      .replace(/:/g, '-')
  );
  if (!normalized) return null;
  return normalized;
}

class PokemonMiniGame {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.persistence = options.persistence || null;
    this.guildProfiles = new Map();
    this.pokemonById = new Map();
    this.pokemonByName = new Map();
    this.speciesById = new Map();
    this.speciesByName = new Map();
    this.evolutionChainByUrl = new Map();
    this.itemCatalogById = new Map();
    this.itemCatalogLoaded = false;
    this.moveCache = new Map();
    this.rarityPools = {
      common: new Set(),
      uncommon: new Set(),
      rare: new Set(),
      epic: new Set(),
      legendary: new Set(),
    };
    this.pullCarousels = new Map();
    this.teamCarousels = new Map();
    this.inventoryCarousels = new Map();
    this.challenges = new Map();
    this.battles = new Map();
  }

  supportsCommand(command) {
    const normalized = normalizeSlug(command);
    return [
      'pokehelp',
      'pokebattlehelp',
      'pokepulls',
      'pokedaily',
      'pokepull',
      'pull',
      'pokeinv',
      'poketeam',
      'pokeitems',
      'pokeitem',
      'pokeuse',
      'useitem',
      'pokestore',
      'pokebuy',
      'pokemoney',
      'pokeability',
      'pokemoves',
      'pokedex',
      'dex',
      'pdex',
      'pokestat',
      'pokestats',
      'pstats',
      'evolve',
      'pokeevolve',
      'pokebattle',
      'pokebattlecancel',
    ].includes(normalized);
  }

  async handleMessageCommand({ command, args, message }) {
    const normalizedCommand = normalizeSlug(command);
    if (!this.supportsCommand(normalizedCommand)) return false;

    this.cleanupExpiredPullCarousels();
    this.cleanupExpiredTeamCarousels();
    this.cleanupExpiredInventoryCarousels();
    this.cleanupExpiredChallenges();

    try {
      if (normalizedCommand === 'pokehelp' || normalizedCommand === 'pokebattlehelp') {
        await this.handlePokeHelp(message);
        return true;
      }
      if (normalizedCommand === 'pokepulls') {
        await this.handlePokePulls(message);
        return true;
      }
      if (normalizedCommand === 'pokedaily') {
        await this.handlePokeDaily(message);
        return true;
      }
      if (normalizedCommand === 'pokepull' || normalizedCommand === 'pull') {
        await this.handlePokePull({ args, message });
        return true;
      }
      if (normalizedCommand === 'pokeinv') {
        await this.handlePokeInventory({ args, message });
        return true;
      }
      if (normalizedCommand === 'poketeam') {
        await this.handlePokeTeam({ args, message });
        return true;
      }
      if (normalizedCommand === 'pokeitems') {
        await this.handlePokeItems({ args, message });
        return true;
      }
      if (normalizedCommand === 'pokeitem') {
        await this.handlePokeItem({ args, message });
        return true;
      }
      if (normalizedCommand === 'pokeuse' || normalizedCommand === 'useitem') {
        await this.handlePokeUse({ args, message });
        return true;
      }
      if (normalizedCommand === 'pokestore') {
        await this.handlePokeStore({ args, message });
        return true;
      }
      if (normalizedCommand === 'pokebuy') {
        await this.handlePokeBuy({ args, message });
        return true;
      }
      if (normalizedCommand === 'pokemoney') {
        await this.handlePokeMoney({ message });
        return true;
      }
      if (normalizedCommand === 'pokeability') {
        await this.handlePokeAbility({ args, message });
        return true;
      }
      if (normalizedCommand === 'pokemoves') {
        await this.handlePokeMoves({ args, message });
        return true;
      }
      if (
        normalizedCommand === 'pokedex' ||
        normalizedCommand === 'dex' ||
        normalizedCommand === 'pdex'
      ) {
        await this.handlePokedex({ args, message });
        return true;
      }
      if (
        normalizedCommand === 'pokestat' ||
        normalizedCommand === 'pokestats' ||
        normalizedCommand === 'pstats'
      ) {
        await this.handlePokeStats({ args, message });
        return true;
      }
      if (normalizedCommand === 'evolve' || normalizedCommand === 'pokeevolve') {
        await this.handlePokeEvolve({ args, message });
        return true;
      }
      if (normalizedCommand === 'pokebattle') {
        await this.handlePokeBattle({ message });
        return true;
      }
      if (normalizedCommand === 'pokebattlecancel') {
        await this.handlePokeBattleCancel({ message });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Pokemon game error:', error);
      await message.reply(`Error en minijuego Pokemon: ${error.message}`);
      return true;
    }
  }

  async handleInteraction(interaction) {
    if (!interaction.isButton()) return false;
    if (!interaction.customId.startsWith('pk')) return false;

    this.cleanupExpiredPullCarousels();
    this.cleanupExpiredTeamCarousels();
    this.cleanupExpiredInventoryCarousels();
    this.cleanupExpiredChallenges();

    if (interaction.customId.startsWith('pkpull:')) {
      await this.handlePullCarouselInteraction(interaction);
      return true;
    }
    if (interaction.customId.startsWith('pkteam:')) {
      await this.handleTeamCarouselInteraction(interaction);
      return true;
    }
    if (interaction.customId.startsWith('pkinv:')) {
      await this.handleInventoryCarouselInteraction(interaction);
      return true;
    }

    if (interaction.customId.startsWith('pkaccept:')) {
      await this.handleChallengeInteraction({ interaction, accepted: true });
      return true;
    }
    if (interaction.customId.startsWith('pkdecline:')) {
      await this.handleChallengeInteraction({ interaction, accepted: false });
      return true;
    }
    if (interaction.customId.startsWith('pkmove:')) {
      await this.handleMoveInteraction(interaction);
      return true;
    }
    return false;
  }

  ensureGuildStore(guildId) {
    if (!this.guildProfiles.has(guildId)) {
      this.guildProfiles.set(guildId, new Map());
    }
    return this.guildProfiles.get(guildId);
  }

  createEmptyProfile(user) {
    return {
      userId: user.id,
      username: user.username,
      pulls: START_PULLS,
      money: START_MONEY,
      lastDailyAt: 0,
      nextInstanceNumber: 1,
      collection: [],
      teamSlots: Array.from({ length: TEAM_SIZE }, () => null),
      items: { ...DEFAULT_ITEM_BAG },
      wins: 0,
      losses: 0,
    };
  }

  normalizeItemBag(items) {
    const bag = {};
    for (const [rawId, rawAmount] of Object.entries(items || {})) {
      const itemId = normalizeItemId(rawId);
      if (!itemId) continue;
      const amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      bag[itemId] = Math.floor(amount);
    }
    return bag;
  }

  normalizeTeamSlots(teamSlots) {
    const normalized = Array.isArray(teamSlots) ? [...teamSlots] : [];
    while (normalized.length < TEAM_SIZE) normalized.push(null);
    return normalized.slice(0, TEAM_SIZE).map((slot) => (slot ? String(slot) : null));
  }

  normalizePokemonRecord(record) {
    const instanceId = String(record?.instanceId || '').trim();
    if (!instanceId) return null;
    const dexId = Number(record?.dexId || 0);
    const growthRate = normalizeGrowthRate(record?.growthRate);
    const spriteGifRaw = typeof record?.spriteGif === 'string' ? record.spriteGif.trim() : '';
    const spriteGif = spriteGifRaw && /^https?:\/\//i.test(spriteGifRaw)
      ? spriteGifRaw
      : (
        getShowdownAnimatedSpriteUrl(record?.speciesName || record?.name)
        || getPokeApiAnimatedSpriteUrl(dexId)
      );
    const spriteRaw = typeof record?.sprite === 'string' ? record.sprite.trim() : '';
    const sprite = spriteRaw && /^https?:\/\//i.test(spriteRaw)
      ? spriteRaw
      : getDefaultSpriteUrl(dexId) || getOfficialArtworkUrl(dexId) || DEFAULT_POKEMON_PLACEHOLDER_IMAGE;

    const level = clamp(Math.floor(Number(record?.level ?? CAPTURE_LEVEL)), 1, 100);
    const storedExp = Number(record?.experience);
    const computedExp = Number.isFinite(storedExp)
      ? Math.max(0, Math.floor(storedExp))
      : getExperienceForLevel(level, growthRate);
    const effectiveLevel = getLevelFromExperience(computedExp, growthRate);

    const normalized = {
      instanceId,
      dexId,
      name: String(record?.name || ''),
      displayName: String(record?.displayName || displayNameFromSlug(record?.name || 'unknown')),
      speciesName: String(record?.speciesName || record?.name || ''),
      rarity: String(record?.rarity || 'common'),
      types: Array.isArray(record?.types) ? record.types.map((t) => normalizeSlug(t)).filter(Boolean) : [],
      spriteGif,
      sprite,
      abilities: Array.isArray(record?.abilities) ? record.abilities.map((a) => normalizeSlug(a)).filter(Boolean) : [],
      unlockedAbilities: Array.isArray(record?.unlockedAbilities)
        ? record.unlockedAbilities.map((a) => normalizeSlug(a)).filter(Boolean)
        : [],
      ability: record?.ability ? normalizeSlug(record.ability) : null,
      movePool: Array.isArray(record?.movePool) ? record.movePool.map((m) => normalizeSlug(m)).filter(Boolean) : [],
      knownMoves: Array.isArray(record?.knownMoves)
        ? record.knownMoves.map((m) => normalizeSlug(m)).filter(Boolean)
        : [],
      selectedMoves: Array.isArray(record?.selectedMoves)
        ? record.selectedMoves.map((m) => normalizeSlug(m)).filter(Boolean).slice(0, 4)
        : [],
      baseStats: {
        hp: Number(record?.baseStats?.hp || 0),
        attack: Number(record?.baseStats?.attack || 0),
        defense: Number(record?.baseStats?.defense || 0),
        specialAttack: Number(record?.baseStats?.specialAttack || 0),
        specialDefense: Number(record?.baseStats?.specialDefense || 0),
        speed: Number(record?.baseStats?.speed || 0),
      },
      evs: normalizeEvSpread(record?.evs, {
        hp: 0,
        attack: 0,
        defense: 0,
        specialAttack: 0,
        specialDefense: 0,
        speed: 0,
      }),
      ivs: normalizeIvSpread(record?.ivs, {
        hp: 31,
        attack: 31,
        defense: 31,
        specialAttack: 31,
        specialDefense: 31,
        speed: 31,
      }),
      nature: normalizeNature(record?.nature || 'hardy'),
      growthRate,
      heldItem: record?.heldItem ? normalizeItemId(record.heldItem) : null,
      gender: normalizePokemonGender(record?.gender),
      happiness: clamp(Math.floor(Number(record?.happiness ?? 70)), 0, 255),
      beauty: clamp(Math.floor(Number(record?.beauty ?? 0)), 0, 255),
      affection: clamp(Math.floor(Number(record?.affection ?? 0)), 0, 255),
      level: effectiveLevel,
      experience: computedExp,
      nextLevelExperience: getNextLevelExperience(effectiveLevel, growthRate),
      capturedAt: Number(record?.capturedAt || Date.now()),
    };

    if (!normalized.unlockedAbilities.length && normalized.abilities.length) {
      normalized.unlockedAbilities = [normalized.abilities[0]];
    }
    if (!normalized.ability && normalized.unlockedAbilities.length) {
      normalized.ability = normalized.unlockedAbilities[0];
    }
    if (!normalized.knownMoves.length) {
      if (normalized.selectedMoves.length) {
        normalized.knownMoves = [...normalized.selectedMoves];
      } else {
        normalized.knownMoves = normalized.movePool.slice(0, 4);
      }
    }
    if (!normalized.selectedMoves.length) {
      normalized.selectedMoves = normalized.knownMoves.slice(0, 4);
    }
    normalized.selectedMoves = normalized.selectedMoves.filter((move) => normalized.knownMoves.includes(move));
    if (!normalized.selectedMoves.length) {
      normalized.selectedMoves = normalized.knownMoves.slice(0, 4);
    }
    return normalized;
  }

  hydrateProfile(user, rawProfile = {}, rawCollection = []) {
    const profile = this.createEmptyProfile(user);
    profile.username = String(rawProfile?.username || user.username);
    profile.pulls = Math.max(0, Number(rawProfile?.pulls ?? profile.pulls));
    profile.money = Math.max(0, Math.floor(Number(rawProfile?.money ?? profile.money)));
    profile.lastDailyAt = Math.max(0, Number(rawProfile?.lastDailyAt || 0));
    profile.nextInstanceNumber = Math.max(1, Number(rawProfile?.nextInstanceNumber || 1));
    profile.wins = Math.max(0, Number(rawProfile?.wins || 0));
    profile.losses = Math.max(0, Number(rawProfile?.losses || 0));
    profile.teamSlots = this.normalizeTeamSlots(rawProfile?.teamSlots);
    profile.items = this.normalizeItemBag(rawProfile?.items);

    const collection = [];
    for (const item of Array.isArray(rawCollection) ? rawCollection : []) {
      const normalized = this.normalizePokemonRecord(item);
      if (!normalized) continue;
      collection.push(normalized);
    }
    collection.sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
    profile.collection = collection;

    const maxInstanceNumber = collection.reduce((maxValue, mon) => {
      const match = /^PK(\d+)$/i.exec(mon.instanceId);
      if (!match) return maxValue;
      return Math.max(maxValue, Number(match[1]));
    }, 0);
    profile.nextInstanceNumber = Math.max(profile.nextInstanceNumber, maxInstanceNumber + 1);
    return profile;
  }

  profileToPersistence(profile) {
    return {
      userId: profile.userId,
      username: profile.username,
      pulls: Math.max(0, Number(profile.pulls || 0)),
      money: Math.max(0, Math.floor(Number(profile.money || 0))),
      lastDailyAt: Math.max(0, Number(profile.lastDailyAt || 0)),
      nextInstanceNumber: Math.max(1, Number(profile.nextInstanceNumber || 1)),
      teamSlots: this.normalizeTeamSlots(profile.teamSlots),
      items: this.normalizeItemBag(profile.items),
      wins: Math.max(0, Number(profile.wins || 0)),
      losses: Math.max(0, Number(profile.losses || 0)),
    };
  }

  async ensureProfileLoaded(guildId, user) {
    const store = this.ensureGuildStore(guildId);
    if (store.has(user.id)) {
      const profile = store.get(user.id);
      profile.username = user.username;
      return profile;
    }

    let loadedProfile = null;
    if (this.persistence) {
      const snapshot = await this.persistence.loadPlayer(guildId, user.id);
      if (snapshot) {
        loadedProfile = this.hydrateProfile(user, snapshot.profile, snapshot.collection);
      }
    }

    const profile = loadedProfile || this.createEmptyProfile(user);
    profile.username = user.username;
    store.set(user.id, profile);
    return profile;
  }

  getProfile(guildId, userId) {
    return this.guildProfiles.get(guildId)?.get(userId) || null;
  }

  async persistProfile(guildId, profile) {
    if (!this.persistence) return;
    await this.persistence.saveProfile(guildId, profile.userId, this.profileToPersistence(profile));
  }

  async persistPokemon(guildId, userId, pokemon) {
    if (!this.persistence) return;
    const normalized = this.normalizePokemonRecord(pokemon);
    if (!normalized) return;
    await this.persistence.savePokemon(guildId, userId, normalized);
  }

  async persistPokemons(guildId, userId, pokemons) {
    if (!this.persistence) return;
    const normalized = (pokemons || [])
      .map((pokemon) => this.normalizePokemonRecord(pokemon))
      .filter(Boolean);
    if (!normalized.length) return;

    if (typeof this.persistence.savePokemons === 'function') {
      await this.persistence.savePokemons(guildId, userId, normalized);
      return;
    }

    for (const pokemon of normalized) {
      await this.persistence.savePokemon(guildId, userId, pokemon);
    }
  }

  makeInstanceId(profile) {
    const value = profile.nextInstanceNumber++;
    return `PK${String(value).padStart(4, '0')}`;
  }

  async fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} en ${url}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  cacheSpeciesData(species) {
    if (!species || typeof species !== 'object') return;
    const speciesId = Number(species.id || 0);
    const speciesName = normalizeSlug(species.name || '');
    if (Number.isInteger(speciesId) && speciesId > 0) {
      this.speciesById.set(speciesId, species);
    }
    if (speciesName) {
      this.speciesByName.set(speciesName, species);
    }
  }

  async getSpeciesData(idOrName) {
    const normalized = normalizeSlug(idOrName);
    const numericId = Number(normalized);

    if (Number.isInteger(numericId) && numericId > 0 && this.speciesById.has(numericId)) {
      return this.speciesById.get(numericId);
    }
    if (normalized && this.speciesByName.has(normalized)) {
      return this.speciesByName.get(normalized);
    }

    const endpoint = Number.isInteger(numericId) && numericId > 0
      ? `${POKE_API_BASE}/pokemon-species/${numericId}`
      : `${POKE_API_BASE}/pokemon-species/${encodeURIComponent(normalized)}`;
    const species = await this.fetchJson(endpoint);
    this.cacheSpeciesData(species);
    return species;
  }

  async getEvolutionChainByUrl(url) {
    const chainUrl = String(url || '').trim();
    if (!chainUrl) return null;
    if (this.evolutionChainByUrl.has(chainUrl)) {
      return this.evolutionChainByUrl.get(chainUrl);
    }

    const chainData = await this.fetchJson(chainUrl);
    this.evolutionChainByUrl.set(chainUrl, chainData);
    return chainData;
  }

  cacheItemDataFromApi(itemData) {
    if (!itemData || typeof itemData !== 'object') return null;
    const itemId = normalizeItemId(itemData.name || '');
    if (!itemId) return null;

    const englishName = Array.isArray(itemData.names)
      ? itemData.names.find((entry) => entry?.language?.name === 'en')?.name
      : '';
    const shortEffect = Array.isArray(itemData.effect_entries)
      ? itemData.effect_entries.find((entry) => entry?.language?.name === 'en')?.short_effect
      : '';
    const flavor = Array.isArray(itemData.flavor_text_entries)
      ? itemData.flavor_text_entries.find((entry) => entry?.language?.name === 'en')?.text
      : '';
    const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const competitive = getCompetitiveItem(itemId);
    const snapshot = {
      id: itemId,
      displayName: String(englishName || competitive?.displayName || displayNameFromSlug(itemId)),
      description: cleanText(competitive?.description || shortEffect || flavor || ''),
      price: Math.max(0, Math.floor(Number(itemData.cost ?? 0))),
      sprite: String(itemData?.sprites?.default || ''),
      category: normalizeSlug(itemData?.category?.name || ''),
      attributes: Array.isArray(itemData?.attributes)
        ? itemData.attributes.map((entry) => normalizeSlug(entry?.name)).filter(Boolean)
        : [],
      hydrated: true,
    };

    this.itemCatalogById.set(itemId, snapshot);
    ITEM_LABEL_CACHE.set(itemId, snapshot.displayName);
    ITEM_PRICE_CACHE.set(itemId, snapshot.price);
    ITEM_DESCRIPTION_CACHE.set(itemId, snapshot.description);
    return snapshot;
  }

  cacheItemPlaceholder(itemId) {
    const normalized = normalizeItemId(itemId);
    if (!normalized) return null;
    if (this.itemCatalogById.has(normalized)) {
      const existing = this.itemCatalogById.get(normalized);
      if (existing) {
        if (existing.displayName) ITEM_LABEL_CACHE.set(normalized, existing.displayName);
        if (Number.isFinite(Number(existing.price))) ITEM_PRICE_CACHE.set(normalized, Math.max(0, Math.floor(Number(existing.price))));
        if (existing.description) ITEM_DESCRIPTION_CACHE.set(normalized, String(existing.description));
      }
      return existing;
    }

    const competitive = getCompetitiveItem(normalized);
    const snapshot = {
      id: normalized,
      displayName: String(competitive?.displayName || displayNameFromSlug(normalized)),
      description: String(competitive?.description || ''),
      price: Math.max(0, Math.floor(Number(competitive?.price || 0))),
      sprite: '',
      category: '',
      attributes: [],
      hydrated: false,
    };
    this.itemCatalogById.set(normalized, snapshot);
    ITEM_LABEL_CACHE.set(normalized, snapshot.displayName);
    ITEM_PRICE_CACHE.set(normalized, snapshot.price);
    if (snapshot.description) ITEM_DESCRIPTION_CACHE.set(normalized, snapshot.description);
    return snapshot;
  }

  async ensureItemCatalogLoaded() {
    if (this.itemCatalogLoaded) return;
    const payload = await this.fetchJson(`${POKE_API_BASE}/item?limit=${ITEM_API_LIMIT}`);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    for (const result of results) {
      const id = normalizeItemId(result?.name || '');
      if (!id) continue;
      this.cacheItemPlaceholder(id);
    }

    // Ensure battle-effect items always exist in the catalog even if API list limits change.
    for (const itemId of Object.keys(COMPETITIVE_ITEM_DEX)) {
      this.cacheItemPlaceholder(itemId);
    }
    this.itemCatalogLoaded = true;
  }

  async getItemData(itemId) {
    const normalized = normalizeItemId(itemId);
    if (!normalized) return null;

    if (!this.itemCatalogLoaded) {
      try {
        await this.ensureItemCatalogLoaded();
      } catch {
        // Fallback to direct item fetch below.
      }
    }

    const cached = this.itemCatalogById.get(normalized);
    if (cached?.hydrated) return cached;

    const numericId = Number(normalized);
    const endpoint = Number.isInteger(numericId) && numericId > 0
      ? `${POKE_API_BASE}/item/${numericId}`
      : `${POKE_API_BASE}/item/${encodeURIComponent(normalized)}`;
    try {
      const itemData = await this.fetchJson(endpoint);
      return this.cacheItemDataFromApi(itemData);
    } catch {
      if (cached) return cached;
      return null;
    }
  }

  getKnownItemIds() {
    return Array.from(this.itemCatalogById.keys()).sort((left, right) => left.localeCompare(right));
  }

  async getPokemonTemplate(idOrName) {
    const normalized = normalizeSlug(idOrName);
    const numericId = Number(normalized);

    if (Number.isInteger(numericId) && numericId > 0 && this.pokemonById.has(numericId)) {
      return this.pokemonById.get(numericId);
    }
    if (this.pokemonByName.has(normalized)) {
      return this.pokemonByName.get(normalized);
    }

    const endpoint = Number.isInteger(numericId) && numericId > 0
      ? `${POKE_API_BASE}/pokemon/${numericId}`
      : `${POKE_API_BASE}/pokemon/${encodeURIComponent(normalized)}`;
    const pokemon = await this.fetchJson(endpoint);
    const speciesName = normalizeSlug(pokemon.species?.name || '');
    const speciesIdFromUrl = Number(String(pokemon.species?.url || '').match(/\/(\d+)\/?$/)?.[1] || 0);
    const speciesKey = speciesName || (Number.isInteger(speciesIdFromUrl) && speciesIdFromUrl > 0 ? speciesIdFromUrl : pokemon.id);
    const species = await this.getSpeciesData(speciesKey);

    const baseStats = {
      hp: statFromPokemonStats(pokemon.stats, 'hp'),
      attack: statFromPokemonStats(pokemon.stats, 'attack'),
      defense: statFromPokemonStats(pokemon.stats, 'defense'),
      specialAttack: statFromPokemonStats(pokemon.stats, 'special-attack'),
      specialDefense: statFromPokemonStats(pokemon.stats, 'special-defense'),
      speed: statFromPokemonStats(pokemon.stats, 'speed'),
    };
    const baseStatTotal = Object.values(baseStats).reduce((sum, value) => sum + value, 0);
    const rarity = classifyRarity({
      captureRate: species.capture_rate,
      baseStatTotal,
      isLegendary: Boolean(species.is_legendary || species.is_mythical),
    });

    const template = {
      dexId: pokemon.id,
      name: pokemon.name,
      displayName: displayNameFromSlug(pokemon.name),
      spriteGif:
        getAnimatedSpriteFromPokemonPayload(pokemon)
        || getShowdownAnimatedSpriteUrl(pokemon.name || pokemon.species?.name)
        || getPokeApiAnimatedSpriteUrl(pokemon.id),
      sprite:
        pokemon.sprites?.front_default
        || getDefaultSpriteUrl(pokemon.id)
        || pokemon.sprites?.other?.['official-artwork']?.front_default
        || getOfficialArtworkUrl(pokemon.id)
        || DEFAULT_POKEMON_PLACEHOLDER_IMAGE,
      types: (pokemon.types || [])
        .sort((a, b) => a.slot - b.slot)
        .map((type) => normalizeSlug(type.type.name)),
      abilities: (pokemon.abilities || []).map((entry) => normalizeSlug(entry.ability?.name)).filter(Boolean),
      movePool: (pokemon.moves || []).map((entry) => normalizeSlug(entry.move?.name)).filter(Boolean),
      baseStats,
      baseStatTotal,
      captureRate: Number(species.capture_rate || 0),
      speciesId: Number(species.id || 0),
      growthRate: normalizeGrowthRate(species.growth_rate?.name),
      baseHappiness: Math.max(0, Math.floor(Number(species.base_happiness ?? 70))),
      genderRate: Number.isFinite(Number(species.gender_rate)) ? Number(species.gender_rate) : -1,
      evolutionChainUrl: String(species.evolution_chain?.url || ''),
      rarity,
    };

    this.pokemonById.set(template.dexId, template);
    this.pokemonByName.set(normalizeSlug(template.name), template);
    if (this.rarityPools[template.rarity]) {
      this.rarityPools[template.rarity].add(template.dexId);
    }
    return template;
  }

  async drawRandomPokemonByRarity(options = {}) {
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    const chosenTier = weightedPick(RARITY_WEIGHTS, rng).tier;
    const attempts = 64;
    let fallback = null;

    // Full random on the whole dex: pick random IDs until one matches the rarity tier.
    // This avoids early-cache bias where one cached species could dominate all pulls.
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidateId = randomIntInclusive(1, MAX_DEX_ID, rng);
      try {
        const template = await this.getPokemonTemplate(candidateId);
        if (!fallback) fallback = template;
        if (template.rarity === chosenTier) {
          return template;
        }
      } catch {
        // Ignore transient lookup failures and keep sampling.
      }
    }

    const tierPool = Array.from(this.rarityPools[chosenTier] || []);
    if (tierPool.length) {
      const sampledId = tierPool[randomIntInclusive(0, tierPool.length - 1, rng)];
      try {
        return await this.getPokemonTemplate(sampledId);
      } catch {
        // Continue to fallback below.
      }
    }

    if (fallback) return fallback;

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const rescueId = randomIntInclusive(1, MAX_DEX_ID, rng);
      try {
        return await this.getPokemonTemplate(rescueId);
      } catch {
        // keep trying
      }
    }

    throw new Error('No pude seleccionar un Pokemon aleatorio en este momento.');
  }

  capturePokemon(profile, template) {
    const baseLevel = CAPTURE_LEVEL;
    const growthRate = normalizeGrowthRate(template?.growthRate);
    const baseExperience = getExperienceForLevel(baseLevel, growthRate);
    const nature = randomChoice(Object.keys(NATURE_MODIFIERS)) || 'hardy';
    const knownMoves = template.movePool.slice(0, 8);
    const selectedMoves = knownMoves.slice(0, 4);
    const gender = resolveGenderFromRate(template.genderRate);
    const happiness = clamp(Math.floor(Number(template.baseHappiness ?? 70)), 0, 255);
    const captured = {
      instanceId: this.makeInstanceId(profile),
      dexId: template.dexId,
      name: template.name,
      speciesName: template.name,
      displayName: template.displayName,
      rarity: template.rarity,
      types: [...template.types],
      spriteGif: template.spriteGif || getShowdownAnimatedSpriteUrl(template.name) || getPokeApiAnimatedSpriteUrl(template.dexId),
      sprite: template.sprite,
      abilities: [...template.abilities],
      unlockedAbilities: template.abilities.length ? [template.abilities[0]] : [],
      ability: template.abilities[0] || null,
      movePool: [...template.movePool],
      knownMoves,
      selectedMoves,
      baseStats: { ...template.baseStats },
      evs: {
        hp: 0,
        attack: 0,
        defense: 0,
        specialAttack: 0,
        specialDefense: 0,
        speed: 0,
      },
      ivs: randomIvSpread(),
      nature,
      heldItem: null,
      gender,
      happiness,
      beauty: 0,
      affection: 0,
      growthRate,
      level: baseLevel,
      experience: baseExperience,
      nextLevelExperience: getNextLevelExperience(baseLevel, growthRate),
      capturedAt: Date.now(),
    };

    profile.collection.push(captured);

    const emptySlot = profile.teamSlots.findIndex((slot) => !slot);
    if (emptySlot >= 0) {
      profile.teamSlots[emptySlot] = captured.instanceId;
    }

    return captured;
  }

  getPokemonByInstance(profile, instanceId) {
    const normalized = normalizeSlug(instanceId);
    return profile.collection.find((item) => normalizeSlug(item.instanceId) === normalized) || null;
  }

  getTeamInstances(profile) {
    const byId = new Map(profile.collection.map((item) => [item.instanceId, item]));
    const team = [];
    const seen = new Set();

    for (const slot of profile.teamSlots) {
      if (!slot) continue;
      const mon = byId.get(slot);
      if (!mon) continue;
      if (seen.has(mon.instanceId)) continue;
      seen.add(mon.instanceId);
      team.push(mon);
    }

    if (!team.length) {
      for (const mon of profile.collection.slice(-TEAM_SIZE)) {
        if (seen.has(mon.instanceId)) continue;
        seen.add(mon.instanceId);
        team.push(mon);
      }
    }

    return team.slice(0, TEAM_SIZE);
  }

  formatTeam(profile) {
    const byId = new Map(profile.collection.map((item) => [item.instanceId, item]));
    return profile.teamSlots
      .map((instanceId, index) => {
        if (!instanceId) return `${index + 1}. (vacio)`;
        const mon = byId.get(instanceId);
        if (!mon) return `${index + 1}. (invalido: ${instanceId})`;
        const ability = mon.ability ? displayNameFromSlug(mon.ability) : 'Sin habilidad';
        const moves = mon.selectedMoves.length
          ? mon.selectedMoves.map((move) => displayNameFromSlug(move)).join(', ')
          : 'Auto';
        return `${index + 1}. ${mon.displayName} [${mon.instanceId}] - Hab: ${ability} - Moves: ${moves}`;
      })
      .join('\n');
  }

  buildSystemEmbed({ title, description, color = 0x2f3136, imageUrl = null }) {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description);
    if (imageUrl) {
      embed.setImage(imageUrl);
    }
    return embed;
  }

  buildPokemonConfigEmbed({
    pokemon,
    ownerName,
    titlePrefix,
    detailTitle,
    detailValue,
    colorOverride = null,
  }) {
    const tier = normalizeSlug(pokemon?.rarity || 'common');
    const rarityLabel = RARITY_LABELS[tier] || displayNameFromSlug(tier);
    const types = (pokemon?.types || []).map((type) => displayNameFromSlug(type)).join(' / ') || 'Unknown';
    const dexNumber = formatDexNumber(pokemon?.dexId);
    const imageUrl = resolvePokemonImageUrl(pokemon);
    const ability = displayNameFromSlug(pokemon?.ability || pokemon?.abilities?.[0] || 'none');
    const itemName = formatItemName(pokemon?.heldItem);
    const nature = displayNameFromSlug(pokemon?.nature || 'hardy');
    const gender = displayNameFromSlug(normalizePokemonGender(pokemon?.gender || 'unknown'));
    const happiness = clamp(Math.floor(Number(pokemon?.happiness ?? 70)), 0, 255);
    const selectedMoves = (pokemon?.selectedMoves || [])
      .map((move) => displayNameFromSlug(move))
      .slice(0, 4);

    const descriptionLines = [
      `Entrenador: **${ownerName || 'N/A'}**`,
      `Pokedex: **${dexNumber}**`,
      `Rareza: **${rarityLabel}**`,
      `Tipos: **${types}**`,
      `Nivel: **${formatExperienceText(pokemon)}**`,
      `Genero: **${gender}**`,
      `Felicidad: **${happiness}/255**`,
      `Habilidad activa: **${ability}**`,
      `Objeto: **${itemName}**`,
      `Naturaleza: **${nature}**`,
      `Moves equipados: **${selectedMoves.length ? selectedMoves.join(' | ') : 'Sin configurar'}**`,
    ];
    if (detailTitle && detailValue) {
      descriptionLines.push(`${detailTitle}: ${detailValue}`);
    }

    return new EmbedBuilder()
      .setColor(colorOverride || rarityColor(tier))
      .setTitle(`${titlePrefix || ''}${dexNumber} ${pokemon?.displayName || 'Pokemon'} (${pokemon?.instanceId || 'N/A'})`)
      .setDescription(descriptionLines.join('\n'))
      .setImage(imageUrl);
  }

  buildPokemonStatsEmbed({ pokemon, ownerName, reference = '' }) {
    const level = clamp(Math.floor(Number(pokemon?.level || 1)), 1, 100);
    const baseStats = {
      hp: Math.max(0, Number(pokemon?.baseStats?.hp || 0)),
      attack: Math.max(0, Number(pokemon?.baseStats?.attack || 0)),
      defense: Math.max(0, Number(pokemon?.baseStats?.defense || 0)),
      specialAttack: Math.max(0, Number(pokemon?.baseStats?.specialAttack || 0)),
      specialDefense: Math.max(0, Number(pokemon?.baseStats?.specialDefense || 0)),
      speed: Math.max(0, Number(pokemon?.baseStats?.speed || 0)),
    };
    const calculated = buildBattleStats(baseStats, level, {
      evs: pokemon?.evs,
      ivs: pokemon?.ivs,
      nature: pokemon?.nature,
      speciesName: pokemon?.speciesName || pokemon?.name,
      dexId: pokemon?.dexId,
    });
    const baseTotal = Object.values(baseStats).reduce((sum, value) => sum + Number(value || 0), 0);
    const calcTotal = Object.values(calculated).reduce((sum, value) => sum + Number(value || 0), 0);

    const formatSpread = (spread) => (
      `HP ${Math.max(0, Number(spread?.hp || 0))} | ` +
      `Atk ${Math.max(0, Number(spread?.attack || 0))} | ` +
      `Def ${Math.max(0, Number(spread?.defense || 0))} | ` +
      `SpA ${Math.max(0, Number(spread?.specialAttack || 0))} | ` +
      `SpD ${Math.max(0, Number(spread?.specialDefense || 0))} | ` +
      `Spe ${Math.max(0, Number(spread?.speed || 0))}`
    );

    const embed = this.buildPokemonConfigEmbed({
      pokemon,
      ownerName,
      titlePrefix: 'Stats: ',
      detailTitle: 'Referencia',
      detailValue: reference || pokemon?.instanceId || 'N/A',
      colorOverride: 0x3498db,
    });

    embed.addFields(
      {
        name: `Base stats (BST ${baseTotal})`,
        value: formatSpread(baseStats),
      },
      {
        name: `Stats calculadas Lv.${level} (Total ${calcTotal})`,
        value: formatSpread(calculated),
      },
      {
        name: 'IVs',
        value: formatSpread(pokemon?.ivs || {}),
      },
      {
        name: 'EVs',
        value: formatSpread(pokemon?.evs || {}),
      },
    );
    return embed;
  }

  getTeamPokemonBySlot(profile, slot) {
    if (!Number.isInteger(slot) || slot < 1 || slot > TEAM_SIZE) {
      return { error: `Slot invalido. Debe ser entre 1 y ${TEAM_SIZE}.`, pokemon: null, instanceId: null };
    }
    const instanceId = profile.teamSlots[slot - 1];
    if (!instanceId) {
      return { error: `El slot ${slot} esta vacio.`, pokemon: null, instanceId: null };
    }
    const pokemon = this.getPokemonByInstance(profile, instanceId);
    if (!pokemon) {
      return { error: `No encontre el Pokemon del slot ${slot} en tu inventario.`, pokemon: null, instanceId };
    }
    return { error: null, pokemon, instanceId };
  }

  resolvePokemonForEvolution(profile, reference) {
    const rawReference = String(reference || '').trim();
    if (!rawReference) {
      return { error: 'Debes indicar un slot, PKxxxx o indice de inventario.', pokemon: null, label: '' };
    }

    const slot = Number(rawReference);
    if (Number.isInteger(slot) && slot >= 1 && slot <= TEAM_SIZE) {
      const fromSlot = this.getTeamPokemonBySlot(profile, slot);
      if (!fromSlot.error && fromSlot.pokemon) {
        return {
          error: null,
          pokemon: fromSlot.pokemon,
          label: `slot ${slot}`,
        };
      }
    }

    const byInstance = this.getPokemonByInstance(profile, rawReference);
    if (byInstance) {
      return {
        error: null,
        pokemon: byInstance,
        label: byInstance.instanceId,
      };
    }

    const inventoryIndex = Number(rawReference);
    if (Number.isInteger(inventoryIndex) && inventoryIndex >= 1 && inventoryIndex <= profile.collection.length) {
      const collectionByRecent = profile.collection.slice().reverse();
      const byIndex = collectionByRecent[inventoryIndex - 1];
      if (byIndex) {
        return {
          error: null,
          pokemon: byIndex,
          label: `inventario #${inventoryIndex}`,
        };
      }
    }

    return {
      error: `No encontre un Pokemon para **${rawReference}**. Usa slot, PKxxxx o indice del inventario.`,
      pokemon: null,
      label: rawReference,
    };
  }

  parseEvolutionRequestArgs(args) {
    const chunks = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (!chunks.length) return null;

    const reference = chunks.shift();
    const options = {
      targetSpecies: '',
      usedItem: '',
      location: '',
      timeOfDay: '',
      trade: false,
      tradeWith: '',
      rain: false,
      upsideDown: false,
    };

    for (const chunkRaw of chunks) {
      const chunk = String(chunkRaw || '').trim();
      if (!chunk) continue;

      const cleaned = chunk.startsWith('--') ? chunk.slice(2) : chunk;
      const eqIndex = cleaned.indexOf('=');
      if (eqIndex > 0) {
        const key = normalizeSlug(cleaned.slice(0, eqIndex));
        const valueRaw = cleaned.slice(eqIndex + 1).trim();
        const value = normalizeSlug(valueRaw);

        if (key === 'target' || key === 'to' || key === 'evo') {
          options.targetSpecies = value;
          continue;
        }
        if (key === 'item' || key === 'use') {
          options.usedItem = value;
          continue;
        }
        if (key === 'location' || key === 'loc') {
          options.location = value;
          continue;
        }
        if (key === 'time') {
          options.timeOfDay = normalizeTimeOfDay(value);
          continue;
        }
        if (key === 'with' || key === 'tradewith') {
          options.tradeWith = value;
          continue;
        }
        if (key === 'trade') {
          options.trade = parseBooleanInput(valueRaw);
          continue;
        }
        if (key === 'rain') {
          options.rain = parseBooleanInput(valueRaw);
          continue;
        }
        if (key === 'upside' || key === 'upside-down' || key === 'invert') {
          options.upsideDown = parseBooleanInput(valueRaw);
        }
        continue;
      }

      const flag = normalizeSlug(cleaned);
      if (flag === 'trade') {
        options.trade = true;
        continue;
      }
      if (flag === 'rain') {
        options.rain = true;
        continue;
      }
      if (flag === 'upside' || flag === 'upside-down' || flag === 'invert') {
        options.upsideDown = true;
        continue;
      }
      if (flag === 'day' || flag === 'night' || flag === 'dusk') {
        options.timeOfDay = flag;
        continue;
      }
      if (!options.targetSpecies) {
        options.targetSpecies = flag;
      }
    }

    return { reference, options };
  }

  findEvolutionNode(chainNode, speciesSlug) {
    if (!chainNode || typeof chainNode !== 'object') return null;
    const chainSpecies = normalizeSlug(chainNode?.species?.name || '');
    if (chainSpecies && chainSpecies === speciesSlug) {
      return chainNode;
    }
    for (const child of chainNode.evolves_to || []) {
      const found = this.findEvolutionNode(child, speciesSlug);
      if (found) return found;
    }
    return null;
  }

  async getEvolutionCandidatesForPokemon(pokemon) {
    const speciesKey = pokemon?.speciesName || pokemon?.name || pokemon?.dexId;
    const species = await this.getSpeciesData(speciesKey);
    const chainData = await this.getEvolutionChainByUrl(species?.evolution_chain?.url);
    const currentSpeciesSlug = normalizeSlug(species?.name || speciesKey || '');
    const currentNode = this.findEvolutionNode(chainData?.chain, currentSpeciesSlug);
    if (!currentNode) return [];

    return (currentNode.evolves_to || []).map((child) => ({
      targetSpeciesName: normalizeSlug(child?.species?.name || ''),
      targetDisplayName: displayNameFromSlug(child?.species?.name || ''),
      details: Array.isArray(child?.evolution_details) && child.evolution_details.length
        ? child.evolution_details
        : [{}],
    })).filter((candidate) => candidate.targetSpeciesName);
  }

  async resolveKnownMoveTypes(moves) {
    const knownMoveTypes = new Set();
    const uniqueMoves = ensureArrayUnique(moves || []);
    for (const moveName of uniqueMoves.slice(0, 40)) {
      const move = await this.getMoveData(moveName);
      if (move?.type) {
        knownMoveTypes.add(normalizeSlug(move.type));
      }
    }
    return knownMoveTypes;
  }

  async buildEvolutionContext(profile, pokemon, options = {}) {
    const knownMoves = ensureArrayUnique(pokemon?.knownMoves || []);
    const knownMoveTypes = await this.resolveKnownMoveTypes(knownMoves);
    const team = this.getTeamInstances(profile);
    if (!team.some((member) => member.instanceId === pokemon.instanceId)) {
      team.push(pokemon);
    }

    let resolvedGender = normalizePokemonGender(pokemon.gender);
    if (resolvedGender === 'unknown') {
      try {
        const currentTemplate = await this.getPokemonTemplate(pokemon.speciesName || pokemon.name || pokemon.dexId);
        const seedSource = `${pokemon.instanceId || ''}:${pokemon.dexId || 0}`;
        let hash = 0;
        for (let i = 0; i < seedSource.length; i += 1) {
          hash = (hash * 31 + seedSource.charCodeAt(i)) >>> 0;
        }
        const pseudo = (hash % 10_000) / 10_000;
        resolvedGender = resolveGenderFromRate(currentTemplate.genderRate, () => pseudo);
        pokemon.gender = resolvedGender;
      } catch {
        // Keep unknown if template lookup fails.
      }
    }

    const partySpecies = new Set(
      team
        .map((member) => normalizeSlug(member?.speciesName || member?.name || ''))
        .filter(Boolean)
    );
    const partyTypes = new Set(
      team
        .flatMap((member) => Array.isArray(member?.types) ? member.types : [])
        .map((type) => normalizeSlug(type))
        .filter(Boolean)
    );

    const stats = buildBattleStats(pokemon.baseStats, pokemon.level, {
      evs: pokemon.evs,
      ivs: pokemon.ivs,
      nature: pokemon.nature,
      speciesName: pokemon.speciesName || pokemon.name,
      dexId: pokemon.dexId,
    });

    return {
      level: clamp(Math.floor(Number(pokemon.level || 1)), 1, 100),
      gender: resolvedGender,
      happiness: clamp(Math.floor(Number(pokemon.happiness ?? 70)), 0, 255),
      beauty: clamp(Math.floor(Number(pokemon.beauty ?? 0)), 0, 255),
      affection: clamp(Math.floor(Number(pokemon.affection ?? 0)), 0, 255),
      heldItem: normalizeItemId(pokemon.heldItem || ''),
      knownMoves: new Set(knownMoves),
      knownMoveTypes,
      partySpecies,
      partyTypes,
      location: normalizeSlug(options.location || ''),
      timeOfDay: normalizeTimeOfDay(options.timeOfDay) || inferTimeOfDayFromDate(),
      trade: Boolean(options.trade),
      tradeWith: normalizeSlug(options.tradeWith || ''),
      rain: Boolean(options.rain),
      upsideDown: Boolean(options.upsideDown),
      usedItem: normalizeItemId(options.usedItem || ''),
      attackStat: Math.max(0, Number(stats.attack || pokemon?.baseStats?.attack || 0)),
      defenseStat: Math.max(0, Number(stats.defense || pokemon?.baseStats?.defense || 0)),
    };
  }

  describeEvolutionDetail(detail = {}) {
    const parts = [];
    const trigger = normalizeSlug(detail?.trigger?.name || '');
    if (trigger === 'level-up') parts.push('level-up');
    if (trigger === 'trade') parts.push('trade');
    if (trigger === 'use-item') parts.push('use-item');

    if (Number.isFinite(Number(detail?.min_level)) && Number(detail.min_level) > 0) {
      parts.push(`Lv ${Number(detail.min_level)}+`);
    }
    if (detail?.item?.name) {
      parts.push(`item ${displayNameFromSlug(detail.item.name)}`);
    }
    if (detail?.held_item?.name) {
      parts.push(`held ${displayNameFromSlug(detail.held_item.name)}`);
    }
    if (Number.isFinite(Number(detail?.min_happiness)) && Number(detail.min_happiness) > 0) {
      parts.push(`happiness ${Number(detail.min_happiness)}+`);
    }
    if (Number.isFinite(Number(detail?.min_beauty)) && Number(detail.min_beauty) > 0) {
      parts.push(`beauty ${Number(detail.min_beauty)}+`);
    }
    if (Number.isFinite(Number(detail?.min_affection)) && Number(detail.min_affection) > 0) {
      parts.push(`affection ${Number(detail.min_affection)}+`);
    }
    if (detail?.known_move?.name) {
      parts.push(`move ${displayNameFromSlug(detail.known_move.name)}`);
    }
    if (detail?.known_move_type?.name) {
      parts.push(`move type ${displayNameFromSlug(detail.known_move_type.name)}`);
    }
    if (detail?.party_species?.name) {
      parts.push(`party species ${displayNameFromSlug(detail.party_species.name)}`);
    }
    if (detail?.party_type?.name) {
      parts.push(`party type ${displayNameFromSlug(detail.party_type.name)}`);
    }
    if (detail?.trade_species?.name) {
      parts.push(`trade with ${displayNameFromSlug(detail.trade_species.name)}`);
    }
    if (detail?.location?.name) {
      parts.push(`location ${displayNameFromSlug(detail.location.name)}`);
    }
    const time = normalizeTimeOfDay(detail?.time_of_day || '');
    if (time) {
      parts.push(`time ${time}`);
    }
    if (detail?.needs_overworld_rain) {
      parts.push('rain');
    }
    if (detail?.turn_upside_down) {
      parts.push('upside-down');
    }
    if (Number(detail?.gender) === 1) {
      parts.push('female');
    } else if (Number(detail?.gender) === 2) {
      parts.push('male');
    }
    if (detail?.relative_physical_stats != null && Number.isFinite(Number(detail.relative_physical_stats))) {
      const relation = Number(detail.relative_physical_stats);
      if (relation > 0) parts.push('Atk > Def');
      if (relation === 0) parts.push('Atk = Def');
      if (relation < 0) parts.push('Atk < Def');
    }

    return parts.length ? parts.join(', ') : 'Sin requisitos especiales';
  }

  async evaluateEvolutionDetail(detail, context) {
    const missing = [];
    const trigger = normalizeSlug(detail?.trigger?.name || '');
    const triggerRequiresTrade = trigger === 'trade';
    if (triggerRequiresTrade && !context.trade) {
      missing.push('Requiere intercambio (`trade`).');
    }

    const requiredItem = normalizeItemId(detail?.item?.name || '');
    if (requiredItem && context.usedItem !== requiredItem) {
      missing.push(`Requiere usar ${displayNameFromSlug(requiredItem)} (\`item=${requiredItem}\`).`);
    }

    const requiredHeldItem = normalizeItemId(detail?.held_item?.name || '');
    if (requiredHeldItem && context.heldItem !== requiredHeldItem) {
      missing.push(`Requiere tener equipado ${displayNameFromSlug(requiredHeldItem)}.`);
    }

    const minLevel = Number(detail?.min_level);
    if (Number.isFinite(minLevel) && minLevel > 0 && context.level < minLevel) {
      missing.push(`Requiere nivel minimo ${minLevel}.`);
    }

    const minHappiness = Number(detail?.min_happiness);
    if (Number.isFinite(minHappiness) && minHappiness > 0 && context.happiness < minHappiness) {
      missing.push(`Requiere felicidad ${minHappiness}+.`);
    }

    const minBeauty = Number(detail?.min_beauty);
    if (Number.isFinite(minBeauty) && minBeauty > 0 && context.beauty < minBeauty) {
      missing.push(`Requiere belleza ${minBeauty}+.`);
    }

    const minAffection = Number(detail?.min_affection);
    if (Number.isFinite(minAffection) && minAffection > 0 && context.affection < minAffection) {
      missing.push(`Requiere afecto ${minAffection}+.`);
    }

    const requiredGender = Number(detail?.gender) === 1
      ? 'female'
      : Number(detail?.gender) === 2
        ? 'male'
        : '';
    if (requiredGender && context.gender !== requiredGender) {
      missing.push(`Requiere genero ${displayNameFromSlug(requiredGender)}.`);
    }

    const requiredKnownMove = normalizeSlug(detail?.known_move?.name || '');
    if (requiredKnownMove && !context.knownMoves.has(requiredKnownMove)) {
      missing.push(`Requiere conocer ${displayNameFromSlug(requiredKnownMove)}.`);
    }

    const requiredKnownMoveType = normalizeSlug(detail?.known_move_type?.name || '');
    if (requiredKnownMoveType && !context.knownMoveTypes.has(requiredKnownMoveType)) {
      missing.push(`Requiere movimiento de tipo ${displayNameFromSlug(requiredKnownMoveType)}.`);
    }

    const requiredPartySpecies = normalizeSlug(detail?.party_species?.name || '');
    if (requiredPartySpecies && !context.partySpecies.has(requiredPartySpecies)) {
      missing.push(`Requiere ${displayNameFromSlug(requiredPartySpecies)} en el equipo.`);
    }

    const requiredPartyType = normalizeSlug(detail?.party_type?.name || '');
    if (requiredPartyType && !context.partyTypes.has(requiredPartyType)) {
      missing.push(`Requiere tipo ${displayNameFromSlug(requiredPartyType)} en el equipo.`);
    }

    const requiredTradeWith = normalizeSlug(detail?.trade_species?.name || '');
    if (requiredTradeWith && context.tradeWith !== requiredTradeWith) {
      missing.push(`Requiere intercambio con ${displayNameFromSlug(requiredTradeWith)} (\`with=${requiredTradeWith}\`).`);
    }

    const requiredLocation = normalizeSlug(detail?.location?.name || '');
    if (requiredLocation && context.location !== requiredLocation) {
      missing.push(`Requiere ubicacion ${displayNameFromSlug(requiredLocation)} (\`location=${requiredLocation}\`).`);
    }

    const requiredTime = normalizeTimeOfDay(detail?.time_of_day || '');
    if (requiredTime && context.timeOfDay !== requiredTime) {
      missing.push(`Requiere evolucionar de ${requiredTime}.`);
    }

    if (detail?.needs_overworld_rain && !context.rain) {
      missing.push('Requiere lluvia (`rain`).');
    }

    if (detail?.turn_upside_down && !context.upsideDown) {
      missing.push('Requiere modo invertido (`upside`).');
    }

    const relative = detail?.relative_physical_stats != null
      ? Number(detail.relative_physical_stats)
      : Number.NaN;
    if (Number.isFinite(relative)) {
      if (relative > 0 && !(context.attackStat > context.defenseStat)) {
        missing.push('Requiere Atk > Def.');
      } else if (relative === 0 && context.attackStat !== context.defenseStat) {
        missing.push('Requiere Atk = Def.');
      } else if (relative < 0 && !(context.attackStat < context.defenseStat)) {
        missing.push('Requiere Atk < Def.');
      }
    }

    return {
      ok: missing.length === 0,
      missing,
      trigger,
    };
  }

  async evaluateEvolutionCandidate(candidate, context) {
    const details = Array.isArray(candidate?.details) && candidate.details.length
      ? candidate.details
      : [{}];

    let bestFailure = null;
    for (const detail of details) {
      const evaluation = await this.evaluateEvolutionDetail(detail, context);
      if (evaluation.ok) {
        return {
          eligible: true,
          detail,
          missing: [],
        };
      }
      if (!bestFailure || evaluation.missing.length < bestFailure.missing.length) {
        bestFailure = {
          detail,
          missing: evaluation.missing,
        };
      }
    }

    return {
      eligible: false,
      detail: bestFailure?.detail || details[0] || {},
      missing: bestFailure?.missing || ['Requisitos no cumplidos.'],
    };
  }

  applyEvolutionTemplate(pokemon, template) {
    const previous = {
      dexId: pokemon.dexId,
      displayName: pokemon.displayName,
      speciesName: pokemon.speciesName || pokemon.name,
      baseStats: { ...pokemon.baseStats },
      growthRate: normalizeGrowthRate(pokemon.growthRate),
    };

    pokemon.dexId = template.dexId;
    pokemon.name = template.name;
    pokemon.speciesName = template.name;
    pokemon.displayName = template.displayName;
    pokemon.rarity = template.rarity;
    pokemon.types = [...template.types];
    pokemon.spriteGif = template.spriteGif || getShowdownAnimatedSpriteUrl(template.name) || getPokeApiAnimatedSpriteUrl(template.dexId);
    pokemon.sprite = template.sprite;
    pokemon.baseStats = { ...template.baseStats };
    pokemon.abilities = ensureArrayUnique(template.abilities);
    pokemon.movePool = ensureArrayUnique(template.movePool);
    pokemon.growthRate = normalizeGrowthRate(template.growthRate || pokemon.growthRate);

    const previousUnlocked = ensureArrayUnique(pokemon.unlockedAbilities || []);
    const preservedUnlocked = previousUnlocked.filter((ability) => pokemon.abilities.includes(ability));
    pokemon.unlockedAbilities = preservedUnlocked.length
      ? preservedUnlocked
      : (pokemon.abilities.length ? [pokemon.abilities[0]] : []);

    const activeAbility = normalizeSlug(pokemon.ability || '');
    if (!activeAbility || !pokemon.unlockedAbilities.includes(activeAbility)) {
      pokemon.ability = pokemon.unlockedAbilities[0] || pokemon.abilities[0] || null;
    } else {
      pokemon.ability = activeAbility;
    }

    pokemon.knownMoves = ensureArrayUnique(pokemon.knownMoves || []);
    if (!pokemon.knownMoves.length) {
      pokemon.knownMoves = pokemon.movePool.slice(0, 4);
    }
    if (!pokemon.knownMoves.length) {
      pokemon.knownMoves = ['struggle'];
    }

    pokemon.selectedMoves = ensureArrayUnique(pokemon.selectedMoves || [])
      .filter((move) => pokemon.knownMoves.includes(move))
      .slice(0, 4);
    if (!pokemon.selectedMoves.length) {
      pokemon.selectedMoves = pokemon.knownMoves.slice(0, 4);
    }

    const currentExp = Math.max(
      0,
      Math.floor(
        Number(
          pokemon.experience
          ?? getExperienceForLevel(
            clamp(Math.floor(Number(pokemon.level || 1)), 1, 100),
            pokemon.growthRate
          )
        )
      )
    );
    pokemon.experience = currentExp;
    pokemon.level = clamp(
      Math.floor(Number(pokemon.level || getLevelFromExperience(currentExp, pokemon.growthRate))),
      1,
      100
    );
    pokemon.nextLevelExperience = getNextLevelExperience(pokemon.level, pokemon.growthRate);

    return previous;
  }

  getPokemonMovePoolSet(pokemon) {
    return new Set((pokemon?.movePool || []).map((move) => normalizeSlug(move)).filter(Boolean));
  }

  async getMoveData(moveName) {
    const normalized = normalizeSlug(moveName);
    if (!normalized) return null;
    if (normalized === 'struggle') return STRUGGLE_MOVE;
    if (this.moveCache.has(normalized)) {
      return this.moveCache.get(normalized);
    }

    try {
      const data = await this.fetchJson(`${POKE_API_BASE}/move/${encodeURIComponent(normalized)}`);
      const mapped = {
        name: normalizeSlug(data.name),
        displayName: displayNameFromSlug(data.name),
        power: Number.isFinite(data.power) ? data.power : 0,
        accuracy: Number.isFinite(data.accuracy) ? data.accuracy : 100,
        pp: Number.isFinite(data.pp) ? data.pp : 5,
        type: normalizeSlug(data.type?.name || 'normal'),
        category: normalizeSlug(data.damage_class?.name || 'status'),
        priority: Number.isFinite(data.priority) ? data.priority : 0,
      };
      this.moveCache.set(normalized, mapped);
      return mapped;
    } catch {
      return null;
    }
  }

  async pickDefaultMoveSet(movePool) {
    const available = Array.isArray(movePool) ? movePool : [];
    const damaging = [];
    for (const moveName of available.slice(0, 80)) {
      if (damaging.length >= 4) break;
      const move = await this.getMoveData(moveName);
      if (!move) continue;
      if (move.category === 'status') continue;
      damaging.push(move.name);
    }

    if (damaging.length >= 2) {
      return damaging.slice(0, 4);
    }

    const mixed = [...damaging];
    for (const moveName of available.slice(0, 40)) {
      if (mixed.length >= 4) break;
      const move = await this.getMoveData(moveName);
      if (!move) continue;
      if (mixed.includes(move.name)) continue;
      mixed.push(move.name);
    }

    if (!mixed.length) {
      mixed.push('struggle');
    }
    return mixed.slice(0, 4);
  }

  async resolveBattleMoves(instance) {
    if (!instance.selectedMoves.length) {
      instance.selectedMoves = await this.pickDefaultMoveSet(instance.movePool);
    }

    const resolved = [];
    for (const moveName of instance.selectedMoves.slice(0, 4)) {
      const move = await this.getMoveData(moveName);
      if (!move) continue;
      resolved.push(move);
    }

    if (!resolved.length) {
      resolved.push(STRUGGLE_MOVE);
    }
    return resolved.slice(0, 4);
  }

  async handlePokeHelp(message) {
    const embed = new EmbedBuilder()
      .setColor(0xffcb05)
      .setTitle('Mini-juego Pokemon')
      .setDescription(
        [
          '`!pokepulls` - ver tiradas disponibles',
          '`!pokedaily` - reclamar tiradas diarias',
          '`!pokepull <cantidad>` - tirar Pokemon al azar con rarezas',
          '`!pokeinv [pagina|@usuario [pagina]]` - ver inventario visual',
          `\`!poketeam\` - ver equipo (${TEAM_SIZE} slots)`,
          '`!poketeam set <slot> <PKxxxx>` - asignar Pokemon al equipo',
          '`!poketeam clear <slot>` - limpiar slot',
          '`!pokeitems [pagina]` - ver inventario completo de objetos',
          '`!pokeitem equip <slot> <objeto>` - equipar objeto al Pokemon',
          '`!pokeitem unequip <slot>` - quitar objeto equipado',
          '`!pokeuse <objeto> <slot|PKxxxx|indice> [cantidad]` - usar objetos consumibles',
          '`!pokestore [pagina] [filtro]` - ver catalogo completo de objetos',
          '`!pokebuy <objeto> [cantidad]` - comprar objetos (sin limite de stack)',
          '`!pokemoney` - ver saldo actual',
          '`!pokeability <slot>` - ver habilidades (activa/desbloqueadas)',
          '`!pokeability set|learn|forget <slot> <habilidad>` - gestionar habilidades',
          '`!pokemoves <slot>` - ver moves configurados y conocidos',
          '`!pokemoves set|learn|forget <slot> ...` - gestionar moves',
          '`!pokedex <numero|nombre>` - ver ficha Pokedex completa de una especie',
          '`!pokestat <slot|PKxxxx|indice>` - ver ficha de stats base, calculadas, IVs y EVs',
          '`!evolve <slot|PKxxxx|indice> [target=<especie>]` - evolucionar Pokemon segun requisitos',
          '`!pokebattle @usuario` - retar a otro jugador',
          '`!pokebattlecancel` - cancelar tu reto pendiente',
        ].join('\n')
      );
    await message.reply({ embeds: [embed] });
  }

  async handlePokePulls(message) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const remaining = Math.max(0, DAILY_COOLDOWN_MS - (Date.now() - profile.lastDailyAt));
    const dailyText = remaining > 0
      ? `Proximo daily en ${formatDuration(remaining)}.`
      : 'Daily disponible ahora.';
    const embed = this.buildSystemEmbed({
      title: 'Tiradas Pokemon',
      description:
        `Tienes **${profile.pulls}** tirada(s).\n` +
        `Saldo: **${formatMoney(profile.money)}**\n` +
        `${dailyText}\n` +
        'Usa `!pokepull <cantidad>`.',
      color: 0x3498db,
    });
    await message.reply({ embeds: [embed] });
  }

  async handlePokeDaily(message) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const now = Date.now();
    const elapsed = now - profile.lastDailyAt;
    if (elapsed < DAILY_COOLDOWN_MS) {
      const embed = this.buildSystemEmbed({
        title: 'Daily no disponible',
        description: `Falta **${formatDuration(DAILY_COOLDOWN_MS - elapsed)}** para reclamarlo.`,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    profile.lastDailyAt = now;
    profile.pulls += DAILY_PULLS;
    profile.money = Math.max(0, Math.floor(Number(profile.money || 0))) + DAILY_MONEY;
    await this.persistProfile(message.guild.id, profile);
    const embed = this.buildSystemEmbed({
      title: 'Daily reclamado',
      description:
        `Ganaste **+${DAILY_PULLS}** tiradas y **+${formatMoney(DAILY_MONEY)}**.\n` +
        `Total tiradas: **${profile.pulls}**\n` +
        `Saldo actual: **${formatMoney(profile.money)}**.`,
      color: 0x1abc9c,
    });
    await message.reply({ embeds: [embed] });
  }

  async handlePokePull({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const requested = args ? Number(args.trim()) : 1;
    if (!Number.isInteger(requested) || requested <= 0) {
      await message.reply(`Uso: \`!pokepull <cantidad>\` (1-${MAX_PULL_BATCH}).`);
      return;
    }

    const amount = clamp(requested, 1, MAX_PULL_BATCH);
    if (profile.pulls < amount) {
      await message.reply(
        `No tienes suficientes tiradas. Tienes ${profile.pulls}, pediste ${amount}. Usa \`!pokedaily\`.`
      );
      return;
    }

    await message.channel.sendTyping();
    profile.pulls -= amount;

    const captured = [];
    for (let i = 0; i < amount; i += 1) {
      const template = await this.drawRandomPokemonByRarity();
      const mon = this.capturePokemon(profile, template);
      captured.push(mon);
    }

    await this.persistProfile(message.guild.id, profile);
    await this.persistPokemons(message.guild.id, profile.userId, captured);

    if (captured.length === 1) {
      const embed = this.buildPullEmbed({
        pokemon: captured[0],
        index: 0,
        total: 1,
        ownerName: message.author.username,
        pullsRemaining: profile.pulls,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    const carouselId = crypto.randomUUID().slice(0, 8);
    const carousel = {
      id: carouselId,
      ownerId: message.author.id,
      ownerName: message.author.username,
      guildId: message.guild.id,
      channelId: message.channel.id,
      items: captured,
      index: 0,
      pullsRemaining: profile.pulls,
      expiresAt: Date.now() + PULL_CAROUSEL_TTL_MS,
      messageId: null,
    };
    this.pullCarousels.set(carouselId, carousel);

    const sent = await message.reply(this.buildPullCarouselPayload(carousel));
    carousel.messageId = sent.id;
  }

  buildPullEmbed({ pokemon, index, total, ownerName, pullsRemaining }) {
    const tier = normalizeSlug(pokemon?.rarity || 'common');
    const rarityLabel = RARITY_LABELS[tier] || displayNameFromSlug(tier);
    const types = (pokemon?.types || []).map((type) => displayNameFromSlug(type)).join(' / ') || 'Unknown';
    const dexNumber = formatDexNumber(pokemon?.dexId);
    const imageUrl = resolvePokemonImageUrl(pokemon);

    const embed = new EmbedBuilder()
      .setColor(rarityColor(tier))
      .setTitle(`${dexNumber} ${pokemon?.displayName || 'Pokemon'} (${pokemon?.instanceId || 'N/A'})`)
      .setDescription(
        `Entrenador: **${ownerName || 'N/A'}**\n` +
        `Pokedex: **${dexNumber}**\n` +
        `Rareza: **${rarityLabel}**\n` +
        `Tipos: **${types}**\n` +
        `Nivel: **${formatExperienceText(pokemon)}**\n` +
        `Tirada: **${index + 1}/${total}**`
      )
      .setFooter({ text: `Tiradas restantes: ${pullsRemaining}` })
      .setImage(imageUrl);
    return embed;
  }

  buildPullCarouselPayload(carousel) {
    const current = carousel.items[carousel.index];
    const embed = this.buildPullEmbed({
      pokemon: current,
      index: carousel.index,
      total: carousel.items.length,
      ownerName: carousel.ownerName,
      pullsRemaining: carousel.pullsRemaining,
    }).setAuthor({ name: `Resultados de tirada (${carousel.items.length})` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pkpull:prev:${carousel.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Anterior'),
      new ButtonBuilder()
        .setCustomId(`pkpull:next:${carousel.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Siguiente'),
      new ButtonBuilder()
        .setCustomId(`pkpull:close:${carousel.id}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Cerrar')
    );

    return {
      content: `Tiradas completadas (${carousel.items.length}).`,
      embeds: [embed],
      components: [row],
    };
  }

  cleanupExpiredPullCarousels() {
    const now = Date.now();
    for (const [id, carousel] of this.pullCarousels.entries()) {
      if (carousel.expiresAt <= now) {
        this.pullCarousels.delete(id);
      }
    }
  }

  async handlePullCarouselInteraction(interaction) {
    const [, action, carouselId] = interaction.customId.split(':');
    const carousel = this.pullCarousels.get(carouselId);
    if (!carousel) {
      await interaction.reply({ content: 'Este carrusel ya expiro o fue cerrado.', ephemeral: true });
      return;
    }

    if (Date.now() > carousel.expiresAt) {
      this.pullCarousels.delete(carousel.id);
      await interaction.update({ components: [] });
      return;
    }

    if (interaction.guildId !== carousel.guildId || interaction.channelId !== carousel.channelId) {
      await interaction.reply({ content: 'Este carrusel no pertenece a este canal.', ephemeral: true });
      return;
    }

    if (interaction.user.id !== carousel.ownerId) {
      await interaction.reply({ content: 'Solo quien hizo la tirada puede usar este carrusel.', ephemeral: true });
      return;
    }

    if (action === 'close') {
      this.pullCarousels.delete(carousel.id);
      await interaction.update({
        content: 'Carrusel cerrado.',
        embeds: interaction.message.embeds,
        components: [],
      });
      return;
    }

    if (action === 'next') {
      carousel.index = (carousel.index + 1) % carousel.items.length;
    } else if (action === 'prev') {
      carousel.index = (carousel.index - 1 + carousel.items.length) % carousel.items.length;
    } else {
      await interaction.reply({ content: 'Accion invalida para carrusel.', ephemeral: true });
      return;
    }

    await interaction.update(this.buildPullCarouselPayload(carousel));
  }

  buildTeamSlotEmbed({ slotNumber, pokemon, index, total, ownerName }) {
    const tier = normalizeSlug(pokemon?.rarity || 'common');
    const rarityLabel = RARITY_LABELS[tier] || displayNameFromSlug(tier);
    const types = (pokemon?.types || []).map((type) => displayNameFromSlug(type)).join(' / ') || 'Unknown';
    const dexNumber = formatDexNumber(pokemon?.dexId);
    const imageUrl = resolvePokemonImageUrl(pokemon);
    const selectedMoves = Array.isArray(pokemon?.selectedMoves) && pokemon.selectedMoves.length
      ? pokemon.selectedMoves.map((move) => displayNameFromSlug(move)).join(', ')
      : 'Auto';

    return new EmbedBuilder()
      .setColor(rarityColor(tier))
      .setTitle(`Slot ${slotNumber}: ${dexNumber} ${pokemon?.displayName || 'Pokemon'} (${pokemon?.instanceId || 'N/A'})`)
      .setDescription(
        `Entrenador: **${ownerName || 'N/A'}**\n` +
        `Pokedex: **${dexNumber}**\n` +
        `Rareza: **${rarityLabel}**\n` +
        `Tipos: **${types}**\n` +
        `Nivel: **${formatExperienceText(pokemon)}**\n` +
        `Naturaleza: **${displayNameFromSlug(pokemon?.nature || 'hardy')}**\n` +
        `Habilidad: **${displayNameFromSlug(pokemon?.ability || pokemon?.abilities?.[0] || 'none')}**\n` +
        `Objeto: **${formatItemName(pokemon?.heldItem)}**\n` +
        `Moves: **${selectedMoves}**\n` +
        `Vista: **${index + 1}/${total}**`
      )
      .setImage(imageUrl);
  }

  buildTeamCarouselPayload(carousel) {
    const current = carousel.items[carousel.index];
    const embed = this.buildTeamSlotEmbed({
      slotNumber: current.slotNumber,
      pokemon: current.pokemon,
      index: carousel.index,
      total: carousel.items.length,
      ownerName: carousel.ownerName,
    }).setAuthor({ name: `Equipo Pokemon (${carousel.items.length}/${TEAM_SIZE})` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pkteam:prev:${carousel.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Anterior'),
      new ButtonBuilder()
        .setCustomId(`pkteam:next:${carousel.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Siguiente'),
      new ButtonBuilder()
        .setCustomId(`pkteam:close:${carousel.id}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Cerrar')
    );

    return {
      content: `Equipo actual (${carousel.items.length}/${TEAM_SIZE})${carousel.notesText || ''}`,
      embeds: [embed],
      components: [row],
    };
  }

  cleanupExpiredTeamCarousels() {
    const now = Date.now();
    for (const [id, carousel] of this.teamCarousels.entries()) {
      if (carousel.expiresAt <= now) {
        this.teamCarousels.delete(id);
      }
    }
  }

  async handleTeamCarouselInteraction(interaction) {
    const [, action, carouselId] = interaction.customId.split(':');
    const carousel = this.teamCarousels.get(carouselId);
    if (!carousel) {
      await interaction.reply({ content: 'Este carrusel de equipo ya expiro o fue cerrado.', ephemeral: true });
      return;
    }

    if (Date.now() > carousel.expiresAt) {
      this.teamCarousels.delete(carousel.id);
      await interaction.update({ components: [] });
      return;
    }

    if (interaction.guildId !== carousel.guildId || interaction.channelId !== carousel.channelId) {
      await interaction.reply({ content: 'Este carrusel no pertenece a este canal.', ephemeral: true });
      return;
    }

    if (interaction.user.id !== carousel.ownerId) {
      await interaction.reply({ content: 'Solo el dueno del equipo puede usar este carrusel.', ephemeral: true });
      return;
    }

    if (action === 'close') {
      this.teamCarousels.delete(carousel.id);
      await interaction.update({
        content: 'Carrusel de equipo cerrado.',
        embeds: interaction.message.embeds,
        components: [],
      });
      return;
    }

    if (action === 'next') {
      carousel.index = (carousel.index + 1) % carousel.items.length;
    } else if (action === 'prev') {
      carousel.index = (carousel.index - 1 + carousel.items.length) % carousel.items.length;
    } else {
      await interaction.reply({ content: 'Accion invalida para carrusel de equipo.', ephemeral: true });
      return;
    }

    await interaction.update(this.buildTeamCarouselPayload(carousel));
  }

  buildInventoryEmbed({ pokemon, index, total, ownerName }) {
    const tier = normalizeSlug(pokemon?.rarity || 'common');
    const rarityLabel = RARITY_LABELS[tier] || displayNameFromSlug(tier);
    const types = (pokemon?.types || []).map((type) => displayNameFromSlug(type)).join(' / ') || 'Unknown';
    const dexNumber = formatDexNumber(pokemon?.dexId);
    const imageUrl = resolvePokemonImageUrl(pokemon);
    const ability = displayNameFromSlug(pokemon?.ability || pokemon?.abilities?.[0] || 'none');
    const capturedAt = Number(pokemon?.capturedAt || 0);
    const capturedText = capturedAt > 0
      ? new Date(capturedAt).toLocaleString('es-ES')
      : 'N/A';

    return new EmbedBuilder()
      .setColor(rarityColor(tier))
      .setTitle(`${dexNumber} ${pokemon?.displayName || 'Pokemon'} (${pokemon?.instanceId || 'N/A'})`)
      .setDescription(
        `Entrenador: **${ownerName || 'N/A'}**\n` +
        `Pokedex: **${dexNumber}**\n` +
        `Rareza: **${rarityLabel}**\n` +
        `Tipos: **${types}**\n` +
        `Nivel: **${formatExperienceText(pokemon)}**\n` +
        `Naturaleza: **${displayNameFromSlug(pokemon?.nature || 'hardy')}**\n` +
        `Habilidad: **${ability}**\n` +
        `Objeto: **${formatItemName(pokemon?.heldItem)}**\n` +
        `Capturado: **${capturedText}**\n` +
        `Vista: **${index + 1}/${total}**`
      )
      .setImage(imageUrl);
  }

  buildInventoryCarouselPayload(carousel) {
    const current = carousel.items[carousel.index];
    const embed = this.buildInventoryEmbed({
      pokemon: current,
      index: carousel.index,
      total: carousel.items.length,
      ownerName: carousel.ownerName,
    }).setAuthor({ name: `Inventario Pokemon (${carousel.items.length})` });

    const currentPage = Math.floor(carousel.index / carousel.pageSize) + 1;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pkinv:prev10:${carousel.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('-10'),
      new ButtonBuilder()
        .setCustomId(`pkinv:prev:${carousel.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Anterior'),
      new ButtonBuilder()
        .setCustomId(`pkinv:next:${carousel.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Siguiente'),
      new ButtonBuilder()
        .setCustomId(`pkinv:next10:${carousel.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('+10')
    );

    return {
      content: `Inventario Pokemon (${carousel.items.length}) - Pag ${currentPage}/${carousel.totalPages} | Atajos: -10 / +10`,
      embeds: [embed],
      components: [row],
    };
  }

  cleanupExpiredInventoryCarousels() {
    const now = Date.now();
    for (const [id, carousel] of this.inventoryCarousels.entries()) {
      if (carousel.expiresAt <= now) {
        this.inventoryCarousels.delete(id);
      }
    }
  }

  async handleInventoryCarouselInteraction(interaction) {
    const [, action, carouselId] = interaction.customId.split(':');
    const carousel = this.inventoryCarousels.get(carouselId);
    if (!carousel) {
      await interaction.reply({ content: 'Este carrusel de inventario ya expiro o fue cerrado.', ephemeral: true });
      return;
    }

    if (Date.now() > carousel.expiresAt) {
      this.inventoryCarousels.delete(carousel.id);
      await interaction.update({ components: [] });
      return;
    }

    if (interaction.guildId !== carousel.guildId || interaction.channelId !== carousel.channelId) {
      await interaction.reply({ content: 'Este carrusel no pertenece a este canal.', ephemeral: true });
      return;
    }

    if (interaction.user.id !== carousel.ownerId) {
      await interaction.reply({ content: 'Solo quien abrio este inventario puede usar este carrusel.', ephemeral: true });
      return;
    }

    if (action === 'close') {
      this.inventoryCarousels.delete(carousel.id);
      await interaction.update({
        content: 'Carrusel de inventario cerrado.',
        embeds: interaction.message.embeds,
        components: [],
      });
      return;
    }

    if (action === 'next') {
      carousel.index = (carousel.index + 1) % carousel.items.length;
    } else if (action === 'prev') {
      carousel.index = (carousel.index - 1 + carousel.items.length) % carousel.items.length;
    } else if (action === 'next10') {
      carousel.index = (carousel.index + carousel.pageSize) % carousel.items.length;
    } else if (action === 'prev10') {
      const jump = carousel.pageSize % carousel.items.length;
      carousel.index = (carousel.index - jump + carousel.items.length) % carousel.items.length;
    } else {
      await interaction.reply({ content: 'Accion invalida para carrusel de inventario.', ephemeral: true });
      return;
    }

    await interaction.update(this.buildInventoryCarouselPayload(carousel));
  }

  resolveGuildUserByReference(message, reference) {
    const raw = String(reference || '').trim();
    if (!raw) return null;

    const mentionMatch = raw.match(/^<@!?(\d+)>$/);
    const idCandidate = mentionMatch?.[1]
      || (/^\d{15,25}$/.test(raw) ? raw : '');

    if (idCandidate) {
      const fromMention = message?.mentions?.users?.first?.();
      if (fromMention && String(fromMention.id) === String(idCandidate)) {
        return fromMention;
      }

      const fromMembers = message?.guild?.members?.cache?.get?.(idCandidate)?.user;
      if (fromMembers) return fromMembers;

      const fromClient = message?.client?.users?.cache?.get?.(idCandidate);
      if (fromClient) return fromClient;
    }

    const query = normalizeSlug(raw.replace(/^@/, ''));
    if (!query) return null;
    const membersCache = message?.guild?.members?.cache;
    if (!membersCache || typeof membersCache.values !== 'function') return null;

    for (const member of membersCache.values()) {
      const user = member?.user;
      if (!user) continue;
      const username = normalizeSlug(user.username || '');
      const globalName = normalizeSlug(user.globalName || '');
      const displayName = normalizeSlug(member.displayName || member.nickname || '');
      if (query === username || query === globalName || query === displayName) {
        return user;
      }
    }
    return null;
  }

  parseInventoryViewArgs(args, message) {
    const tokens = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      return { targetUser: message.author, page: 1, targetReference: '' };
    }

    let page = 1;
    let reference = '';

    const mentionIndex = tokens.findIndex((token) => /^<@!?\d+>$/.test(token));
    const idIndex = mentionIndex >= 0
      ? mentionIndex
      : tokens.findIndex((token) => /^\d{15,25}$/.test(token));

    if (idIndex >= 0) {
      reference = tokens[idIndex];
      const remaining = tokens.filter((_, index) => index !== idIndex);
      const pageToken = remaining.find((token) => /^\d+$/.test(token) && token.length < 15);
      if (pageToken) page = Math.max(1, Math.floor(Number(pageToken)));
    } else if (tokens.length === 1 && /^\d+$/.test(tokens[0]) && tokens[0].length < 15) {
      page = Math.max(1, Math.floor(Number(tokens[0])));
      reference = '';
    } else if (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1]) && tokens[tokens.length - 1].length < 15) {
      page = Math.max(1, Math.floor(Number(tokens[tokens.length - 1])));
      reference = tokens.slice(0, -1).join(' ');
    } else if (tokens.length === 2 && /^\d+$/.test(tokens[0]) && tokens[0].length < 15) {
      page = Math.max(1, Math.floor(Number(tokens[0])));
      reference = tokens[1];
    } else {
      reference = tokens.join(' ');
    }

    if (!reference) {
      return { targetUser: message.author, page, targetReference: '' };
    }

    const targetUser = this.resolveGuildUserByReference(message, reference);
    if (!targetUser) {
      return {
        targetUser: null,
        page,
        targetReference: reference,
        error: `No encontre a **${trimText(reference, 80)}** en este servidor.`,
      };
    }

    return { targetUser, page, targetReference: reference };
  }

  async handlePokeInventory({ args, message }) {
    const parsed = this.parseInventoryViewArgs(args, message);
    if (parsed.error || !parsed.targetUser) {
      const invalid = this.buildSystemEmbed({
        title: 'Usuario no encontrado',
        description: parsed.error || 'No pude resolver ese usuario.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [invalid] });
      return;
    }

    const targetUser = parsed.targetUser;
    const isOwnInventory = targetUser.id === message.author.id;
    const profile = await this.ensureProfileLoaded(message.guild.id, targetUser);
    if (!profile.collection.length) {
      await message.reply(
        isOwnInventory
          ? 'Tu inventario Pokemon esta vacio. Usa `!pokepull`.'
          : `El inventario Pokemon de **${targetUser.username}** esta vacio.`
      );
      return;
    }

    const page = Number.isInteger(parsed.page) && parsed.page > 0 ? parsed.page : 1;
    const perPage = 10;
    const items = profile.collection.slice().reverse();
    const maxPage = Math.max(1, Math.ceil(items.length / perPage));
    const safePage = clamp(page, 1, maxPage);
    const startIndex = clamp((safePage - 1) * perPage, 0, Math.max(0, items.length - 1));

    if (items.length === 1) {
      const embed = this.buildInventoryEmbed({
        pokemon: items[0],
        index: 0,
        total: 1,
        ownerName: targetUser.username,
      });
      await message.reply({
        content: `Inventario Pokemon de ${targetUser.username} (1)`,
        embeds: [embed],
      });
      return;
    }

    const carouselId = crypto.randomUUID().slice(0, 8);
    const carousel = {
      id: carouselId,
      ownerId: message.author.id,
      ownerName: targetUser.username,
      guildId: message.guild.id,
      channelId: message.channel.id,
      items,
      index: startIndex,
      totalPages: maxPage,
      startPage: safePage,
      pageSize: perPage,
      expiresAt: Date.now() + PULL_CAROUSEL_TTL_MS,
      messageId: null,
    };
    this.inventoryCarousels.set(carouselId, carousel);

    const sent = await message.reply(this.buildInventoryCarouselPayload(carousel));
    carousel.messageId = sent?.id || null;
  }

  async handlePokeTeam({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const chunks = String(args || '').trim().split(/\s+/).filter(Boolean);

    if (!chunks.length) {
      const byId = new Map(profile.collection.map((item) => [item.instanceId, item]));
      const teamItems = [];
      const slotNotes = [];

      for (let index = 0; index < TEAM_SIZE; index += 1) {
        const instanceId = profile.teamSlots[index];
        if (!instanceId) {
          slotNotes.push(`Slot ${index + 1}: vacio`);
          continue;
        }

        const mon = byId.get(instanceId);
        if (!mon) {
          slotNotes.push(`Slot ${index + 1}: invalido (${instanceId})`);
          continue;
        }

        teamItems.push({
          slotNumber: index + 1,
          pokemon: mon,
        });
      }

      if (!teamItems.length) {
        const embed = this.buildSystemEmbed({
          title: 'Equipo Pokemon vacio',
          description: 'No tienes Pokemon asignados. Usa `!pokepull` y luego `!poketeam set <slot> <PKxxxx>`.',
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      const notesText = slotNotes.length ? `\n${slotNotes.join('\n')}` : '';
      if (teamItems.length === 1) {
        const embed = this.buildTeamSlotEmbed({
          slotNumber: teamItems[0].slotNumber,
          pokemon: teamItems[0].pokemon,
          index: 0,
          total: 1,
          ownerName: message.author.username,
        });
        await message.reply({
          content: `Equipo actual (1/${TEAM_SIZE})${notesText}`,
          embeds: [embed],
        });
        return;
      }

      const carouselId = crypto.randomUUID().slice(0, 8);
      const carousel = {
        id: carouselId,
        ownerId: message.author.id,
        ownerName: message.author.username,
        guildId: message.guild.id,
        channelId: message.channel.id,
        items: teamItems,
        index: 0,
        notesText,
        expiresAt: Date.now() + PULL_CAROUSEL_TTL_MS,
        messageId: null,
      };
      this.teamCarousels.set(carouselId, carousel);

      const sent = await message.reply(this.buildTeamCarouselPayload(carousel));
      carousel.messageId = sent.id;
      return;
    }

    const sub = normalizeSlug(chunks[0]);
    if (sub === 'set') {
      const slot = Number(chunks[1]);
      const instanceId = chunks[2];
      if (!Number.isInteger(slot) || slot < 1 || slot > TEAM_SIZE || !instanceId) {
        const embed = this.buildSystemEmbed({
          title: 'Uso de poketeam set',
          description: `\`!poketeam set <slot 1-${TEAM_SIZE}> <PKxxxx>\``,
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }
      const mon = this.getPokemonByInstance(profile, instanceId);
      if (!mon) {
        const embed = this.buildSystemEmbed({
          title: 'Pokemon no encontrado',
          description: `No encontre Pokemon con id **${instanceId}** en tu inventario.`,
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }
      profile.teamSlots[slot - 1] = mon.instanceId;
      await this.persistProfile(message.guild.id, profile);
      const embed = this.buildPokemonConfigEmbed({
        pokemon: mon,
        ownerName: message.author.username,
        titlePrefix: `Slot ${slot} actualizado: `,
        detailTitle: 'Estado',
        detailValue: '**Asignado al equipo**',
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'clear') {
      const slot = Number(chunks[1]);
      if (!Number.isInteger(slot) || slot < 1 || slot > TEAM_SIZE) {
        const embed = this.buildSystemEmbed({
          title: 'Uso de poketeam clear',
          description: `\`!poketeam clear <slot 1-${TEAM_SIZE}>\``,
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }
      profile.teamSlots[slot - 1] = null;
      await this.persistProfile(message.guild.id, profile);
      const embed = this.buildSystemEmbed({
        title: `Slot ${slot} limpiado`,
        description: 'El espacio del equipo quedo vacio.',
        color: 0x3498db,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    const embed = this.buildSystemEmbed({
      title: 'Subcomando invalido',
      description: 'Usa `!poketeam`, `!poketeam set` o `!poketeam clear`.',
      color: 0xff6b6b,
    });
    await message.reply({ embeds: [embed] });
  }

  parsePageAndQueryArgs(args, defaultPage = 1) {
    const chunks = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (!chunks.length) {
      return { page: defaultPage, query: '' };
    }

    const maybePage = Number(chunks[0]);
    if (Number.isInteger(maybePage) && maybePage > 0) {
      return {
        page: maybePage,
        query: chunks.slice(1).join(' ').trim(),
      };
    }

    return {
      page: defaultPage,
      query: chunks.join(' ').trim(),
    };
  }

  async buildStoreEmbed({
    profile,
    ownerName,
    title = 'Tienda Pokemon',
    note = '',
    page = 1,
    query = '',
  }) {
    await this.ensureItemCatalogLoaded();
    const normalizedQuery = normalizeSlug(query || '');
    const allIds = this.getKnownItemIds();
    const filteredIds = normalizedQuery
      ? allIds.filter((itemId) => {
        const label = formatItemName(itemId);
        return itemId.includes(normalizedQuery) || normalizeSlug(label).includes(normalizedQuery);
      })
      : allIds;

    const totalItems = filteredIds.length;
    const totalPages = Math.max(1, Math.ceil(Math.max(1, totalItems) / ITEM_STORE_PAGE_SIZE));
    const safePage = clamp(page, 1, totalPages);
    const start = (safePage - 1) * ITEM_STORE_PAGE_SIZE;
    const pageIds = filteredIds.slice(start, start + ITEM_STORE_PAGE_SIZE);

    const snapshots = [];
    for (const itemId of pageIds) {
      const entry = await this.getItemData(itemId);
      snapshots.push(entry || this.cacheItemPlaceholder(itemId));
    }

    const lines = snapshots.length
      ? snapshots.map((item) => {
        const owned = Math.max(0, Math.floor(Number(profile.items?.[item.id] || 0)));
        const price = getItemPrice(item.id);
        const effectTag = getCompetitiveItem(item.id) ? ' [Combate]' : '';
        const priceText = price > 0 ? formatMoney(price) : 'No se vende';
        const description = getItemDescription(item.id) || (item.category ? `Categoria: ${displayNameFromSlug(item.category)}` : 'Sin descripcion.');
        return `- **${formatItemName(item.id)}**${effectTag} (${priceText}) | Tienes: ${owned}\n  ${trimText(description, 120)}`;
      }).join('\n')
      : 'No hay objetos que coincidan con ese filtro.';

    const queryText = normalizedQuery ? `\nFiltro: **${displayNameFromSlug(normalizedQuery)}**` : '';
    return new EmbedBuilder()
      .setColor(0x16a085)
      .setTitle(title)
      .setDescription(
        `Entrenador: **${ownerName}**\n` +
        `Saldo actual: **${formatMoney(profile.money)}**\n` +
        `Catalogo: **${totalItems}** objeto(s) | Pag **${safePage}/${totalPages}**${queryText}\n` +
        `${note ? `${note}\n\n` : '\n'}` +
        `${lines}`
      );
  }

  async handlePokeStore({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const parsed = this.parsePageAndQueryArgs(args, 1);
    const embed = await this.buildStoreEmbed({
      profile,
      ownerName: message.author.username,
      page: parsed.page,
      query: parsed.query,
      note: 'Compra con `!pokebuy <objeto> [cantidad]`. Puedes filtrar: `!pokestore 1 potion`.',
    });
    await message.reply({ embeds: [embed] });
  }

  async handlePokeBuy({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const chunks = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (!chunks.length) {
      const usage = this.buildSystemEmbed({
        title: 'Uso de pokebuy',
        description: '`!pokebuy <objeto> [cantidad]`\nEjemplo: `!pokebuy leftovers 1`',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [usage] });
      return;
    }

    const maybeAmount = Number(chunks[chunks.length - 1]);
    const hasAmount = Number.isInteger(maybeAmount) && maybeAmount > 0;
    const amount = hasAmount ? Math.max(1, Math.floor(maybeAmount)) : 1;
    if (amount > 1_000_000_000) {
      const tooBig = this.buildSystemEmbed({
        title: 'Cantidad invalida',
        description: 'La cantidad es demasiado grande.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [tooBig] });
      return;
    }
    const itemRaw = hasAmount ? chunks.slice(0, -1).join(' ') : chunks.join(' ');
    const itemId = normalizeItemId(itemRaw);
    const item = await this.getItemData(itemId);
    if (!item) {
      const invalid = await this.buildStoreEmbed({
        profile,
        ownerName: message.author.username,
        title: 'Objeto invalido',
        note: `No existe **${displayNameFromSlug(itemId)}** en la tienda.`,
      });
      await message.reply({ embeds: [invalid] });
      return;
    }

    const unitPrice = getItemPrice(itemId);
    if (unitPrice <= 0) {
      const notForSale = await this.buildStoreEmbed({
        profile,
        ownerName: message.author.username,
        title: 'Objeto no disponible',
        note: `**${formatItemName(itemId)}** no se vende en la tienda.`,
      });
      await message.reply({ embeds: [notForSale] });
      return;
    }
    const maxSafeAmount = Math.floor(Number.MAX_SAFE_INTEGER / Math.max(1, unitPrice));
    if (amount > maxSafeAmount) {
      const invalid = this.buildSystemEmbed({
        title: 'Cantidad invalida',
        description: 'La cantidad excede el limite numerico seguro.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [invalid] });
      return;
    }
    const totalPrice = unitPrice * amount;
    const money = Math.max(0, Math.floor(Number(profile.money || 0)));
    if (money < totalPrice) {
      const insufficient = await this.buildStoreEmbed({
        profile,
        ownerName: message.author.username,
        title: 'Saldo insuficiente',
        note: `Necesitas **${formatMoney(totalPrice)}** para comprar ${amount}x ${formatItemName(itemId)}.`,
      });
      await message.reply({ embeds: [insufficient] });
      return;
    }

    profile.money = money - totalPrice;
    const currentAmount = Math.max(0, Math.floor(Number(profile.items?.[itemId] || 0)));
    profile.items[itemId] = currentAmount + amount;
    await this.persistProfile(message.guild.id, profile);

    const bought = await this.buildStoreEmbed({
      profile,
      ownerName: message.author.username,
      title: 'Compra completada',
      note: `Compraste **${amount}x ${formatItemName(itemId)}** por **${formatMoney(totalPrice)}**.`,
    });
    await message.reply({ embeds: [bought] });
  }

  async handlePokeMoney({ message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const embed = this.buildSystemEmbed({
      title: 'Saldo Pokemon',
      description:
        `Dinero: **${formatMoney(profile.money)}**\n` +
        `Tiradas: **${profile.pulls}**\n` +
        'Usa `!pokestore` para ver precios y `!pokebuy` para comprar.',
      color: 0x16a085,
    });
    await message.reply({ embeds: [embed] });
  }

  async buildItemsEmbed({ profile, ownerName, title = 'Inventario de objetos', note = '', page = 1 }) {
    const bagEntries = Object.entries(profile.items || {})
      .filter(([, amount]) => Number(amount) > 0)
      .sort((left, right) => Number(right[1]) - Number(left[1]));
    const totalPages = Math.max(1, Math.ceil(Math.max(1, bagEntries.length) / ITEM_BAG_PAGE_SIZE));
    const safePage = clamp(page, 1, totalPages);
    const start = (safePage - 1) * ITEM_BAG_PAGE_SIZE;
    const pageEntries = bagEntries.slice(start, start + ITEM_BAG_PAGE_SIZE);

    for (const [itemId] of pageEntries) {
      await this.getItemData(itemId);
    }

    const bagText = pageEntries.length
      ? pageEntries.map(([itemId, amount]) => {
        const lineDescription = getItemDescription(itemId);
        const descriptionSuffix = lineDescription ? `\n  ${trimText(lineDescription, 90)}` : '';
        return `- **${formatItemName(itemId)}** x${Number(amount)}${descriptionSuffix}`;
      }).join('\n')
      : 'Sin objetos disponibles.';

    const byId = new Map((profile.collection || []).map((pokemon) => [pokemon.instanceId, pokemon]));
    const equippedLines = [];
    for (let i = 0; i < TEAM_SIZE; i += 1) {
      const instanceId = profile.teamSlots?.[i];
      if (!instanceId) {
        equippedLines.push(`Slot ${i + 1}: (vacio)`);
        continue;
      }
      const mon = byId.get(instanceId);
      if (!mon) {
        equippedLines.push(`Slot ${i + 1}: (invalido ${instanceId})`);
        continue;
      }
      if (mon.heldItem) {
        await this.getItemData(mon.heldItem);
      }
      equippedLines.push(
        `Slot ${i + 1}: **${mon.displayName}** (${mon.instanceId}) - ${formatItemName(mon.heldItem)}`
      );
    }

    return new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle(title)
      .setDescription(
        `Entrenador: **${ownerName}**\n` +
        `Saldo: **${formatMoney(profile.money)}**${note ? `\n${note}` : ''}\n` +
        `Objetos: **${bagEntries.length}** tipo(s) | Pag **${safePage}/${totalPages}**\n\n` +
        `**Bolsa**\n${bagText}\n\n` +
        `**Equipo (${TEAM_SIZE} slots)**\n${equippedLines.join('\n')}`
      );
  }

  async handlePokeItems({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const parsed = this.parsePageAndQueryArgs(args, 1);
    const embed = await this.buildItemsEmbed({
      profile,
      ownerName: message.author.username,
      page: parsed.page,
      note: 'Usa `!pokeitem equip`, `!pokeitem unequip` o `!pokeuse <objeto> <slot|PKxxxx|indice> [cantidad]`.',
    });
    await message.reply({ embeds: [embed] });
  }

  async handlePokeItem({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const chunks = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (!chunks.length) {
      const embed = this.buildSystemEmbed({
        title: 'Uso de pokeitem',
        description:
          `\`!pokeitem equip <slot 1-${TEAM_SIZE}> <objeto>\`\n` +
          `\`!pokeitem unequip <slot 1-${TEAM_SIZE}>\`\n` +
          '`!pokeitems` para ver objetos disponibles.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    const sub = normalizeSlug(chunks[0]);
    if (sub === 'equip' || sub === 'give') {
      const slot = Number(chunks[1]);
      const itemId = normalizeItemId(chunks.slice(2).join(' '));
      if (!Number.isInteger(slot) || slot < 1 || slot > TEAM_SIZE || !itemId) {
        const embed = this.buildSystemEmbed({
          title: 'Uso de pokeitem equip',
          description: `\`!pokeitem equip <slot 1-${TEAM_SIZE}> <objeto>\``,
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      const item = await this.getItemData(itemId);
      if (!item) {
        const embed = this.buildSystemEmbed({
          title: 'Objeto invalido',
          description: `No reconozco el objeto **${displayNameFromSlug(itemId)}** en PokeAPI.`,
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      const { error, pokemon } = this.getTeamPokemonBySlot(profile, slot);
      if (error || !pokemon) {
        const embed = this.buildSystemEmbed({
          title: 'No se puede equipar objeto',
          description: error || 'Pokemon no encontrado.',
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      const available = Math.floor(Number(profile.items?.[itemId] || 0));
      if (available <= 0) {
        const embed = await this.buildItemsEmbed({
          profile,
          ownerName: message.author.username,
          title: 'No tienes ese objeto en la bolsa',
          note: `Necesitas **${formatItemName(itemId)}** para equiparlo.`,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      const previousItem = normalizeItemId(pokemon.heldItem || '');
      if (previousItem && previousItem === itemId) {
        const embed = this.buildPokemonConfigEmbed({
          pokemon,
          ownerName: message.author.username,
          titlePrefix: `Slot ${slot}: `,
          detailTitle: 'Estado',
          detailValue: `Ya tenia equipado **${formatItemName(itemId)}**.`,
          colorOverride: 0x3498db,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      profile.items[itemId] = available - 1;
      if (profile.items[itemId] <= 0) {
        delete profile.items[itemId];
      }
      if (previousItem) {
        profile.items[previousItem] = Math.floor(Number(profile.items[previousItem] || 0)) + 1;
      }
      pokemon.heldItem = itemId;

      await this.persistProfile(message.guild.id, profile);
      await this.persistPokemon(message.guild.id, profile.userId, pokemon);

      const note = previousItem
        ? `Equipado **${formatItemName(itemId)}**. Se devolvio **${formatItemName(previousItem)}** a la bolsa.`
        : `Equipado **${formatItemName(itemId)}**.`;
      const embed = this.buildPokemonConfigEmbed({
        pokemon,
        ownerName: message.author.username,
        titlePrefix: `Slot ${slot}: `,
        detailTitle: 'Estado',
        detailValue: note,
        colorOverride: 0x1abc9c,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'unequip' || sub === 'remove' || sub === 'clear') {
      const slot = Number(chunks[1]);
      if (!Number.isInteger(slot) || slot < 1 || slot > TEAM_SIZE) {
        const embed = this.buildSystemEmbed({
          title: 'Uso de pokeitem unequip',
          description: `\`!pokeitem unequip <slot 1-${TEAM_SIZE}>\``,
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      const { error, pokemon } = this.getTeamPokemonBySlot(profile, slot);
      if (error || !pokemon) {
        const embed = this.buildSystemEmbed({
          title: 'No se puede quitar objeto',
          description: error || 'Pokemon no encontrado.',
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      const previousItem = normalizeItemId(pokemon.heldItem || '');
      if (!previousItem) {
        const embed = this.buildPokemonConfigEmbed({
          pokemon,
          ownerName: message.author.username,
          titlePrefix: `Slot ${slot}: `,
          detailTitle: 'Estado',
          detailValue: 'No tenia objeto equipado.',
          colorOverride: 0x3498db,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      pokemon.heldItem = null;
      profile.items[previousItem] = Math.floor(Number(profile.items[previousItem] || 0)) + 1;

      await this.persistProfile(message.guild.id, profile);
      await this.persistPokemon(message.guild.id, profile.userId, pokemon);

      const embed = this.buildPokemonConfigEmbed({
        pokemon,
        ownerName: message.author.username,
        titlePrefix: `Slot ${slot}: `,
        detailTitle: 'Estado',
        detailValue: `Objeto retirado: **${formatItemName(previousItem)}**.`,
        colorOverride: 0x1abc9c,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    const fallback = this.buildSystemEmbed({
      title: 'Subcomando invalido',
      description: 'Usa `!pokeitem equip`, `!pokeitem unequip`, `!pokeuse` o `!pokeitems`.',
      color: 0xff6b6b,
    });
    await message.reply({ embeds: [fallback] });
  }

  consumeItemFromBag(profile, itemId, amount = 1) {
    const safeAmount = Math.max(1, Math.floor(Number(amount) || 1));
    const current = Math.max(0, Math.floor(Number(profile.items?.[itemId] || 0)));
    if (current < safeAmount) {
      return false;
    }
    const remaining = current - safeAmount;
    if (remaining > 0) {
      profile.items[itemId] = remaining;
    } else {
      delete profile.items[itemId];
    }
    return true;
  }

  normalizePokemonGrowthState(pokemon) {
    const growthRate = normalizeGrowthRate(pokemon.growthRate);
    const level = clamp(Math.floor(Number(pokemon.level || 1)), 1, 100);
    const experience = Math.max(
      0,
      Math.floor(Number(pokemon.experience ?? getExperienceForLevel(level, growthRate)))
    );
    const levelFromExp = getLevelFromExperience(experience, growthRate);
    const effectiveLevel = clamp(Math.max(level, levelFromExp), 1, 100);
    pokemon.growthRate = growthRate;
    pokemon.level = effectiveLevel;
    pokemon.experience = experience;
    pokemon.nextLevelExperience = getNextLevelExperience(effectiveLevel, growthRate);
    pokemon.evs = normalizeEvSpread(pokemon.evs, {
      hp: 0,
      attack: 0,
      defense: 0,
      specialAttack: 0,
      specialDefense: 0,
      speed: 0,
    });
    pokemon.ivs = normalizeIvSpread(pokemon.ivs, {
      hp: 31,
      attack: 31,
      defense: 31,
      specialAttack: 31,
      specialDefense: 31,
      speed: 31,
    });
  }

  applyRareCandyEffect(pokemon, quantity) {
    this.normalizePokemonGrowthState(pokemon);
    const cap = Math.max(1, Math.floor(Number(quantity) || 1));
    const beforeLevel = pokemon.level;
    const growthRate = pokemon.growthRate;
    let consumed = 0;
    let currentLevel = beforeLevel;
    let currentExp = pokemon.experience;

    while (consumed < cap && currentLevel < 100) {
      currentLevel += 1;
      consumed += 1;
      currentExp = Math.max(currentExp, getExperienceForLevel(currentLevel, growthRate));
    }

    if (consumed <= 0) {
      return {
        consumed: 0,
        summary: `${pokemon.displayName} ya esta en Lv.100.`,
      };
    }

    pokemon.level = currentLevel;
    pokemon.experience = currentExp;
    pokemon.nextLevelExperience = getNextLevelExperience(currentLevel, growthRate);

    return {
      consumed,
      summary: `Rare Candy: Lv.${beforeLevel} -> Lv.${currentLevel}.`,
      details: `Caramelos usados: **${consumed}**`,
    };
  }

  applyExpCandyEffect(pokemon, quantity, xpPerCandy) {
    this.normalizePokemonGrowthState(pokemon);
    const cap = Math.max(1, Math.floor(Number(quantity) || 1));
    const unitXp = Math.max(1, Math.floor(Number(xpPerCandy) || 0));
    const beforeLevel = pokemon.level;
    const beforeExp = pokemon.experience;
    const growthRate = pokemon.growthRate;

    if (beforeLevel >= 100) {
      return {
        consumed: 0,
        summary: `${pokemon.displayName} ya esta en Lv.100.`,
      };
    }

    const totalGain = unitXp * cap;
    const newExp = Math.max(0, beforeExp + totalGain);
    const newLevel = getLevelFromExperience(newExp, growthRate);
    pokemon.experience = newExp;
    pokemon.level = newLevel;
    pokemon.nextLevelExperience = getNextLevelExperience(newLevel, growthRate);

    return {
      consumed: cap,
      summary: `EXP Candy: +${totalGain.toLocaleString('es-ES')} XP (Lv.${beforeLevel} -> Lv.${newLevel}).`,
      details: `XP actual: **${pokemon.experience.toLocaleString('es-ES')}**`,
    };
  }

  applyVitaminEffect(pokemon, quantity, statKey) {
    this.normalizePokemonGrowthState(pokemon);
    const cap = Math.max(1, Math.floor(Number(quantity) || 1));
    const beforeTotal = STAT_KEYS.reduce((sum, key) => sum + Number(pokemon.evs?.[key] || 0), 0);
    let consumed = 0;
    let added = 0;

    for (let i = 0; i < cap; i += 1) {
      const currentStat = Math.max(0, Math.floor(Number(pokemon.evs?.[statKey] || 0)));
      const currentTotal = STAT_KEYS.reduce((sum, key) => sum + Number(pokemon.evs?.[key] || 0), 0);
      const roomStat = Math.max(0, 252 - currentStat);
      const roomTotal = Math.max(0, 510 - currentTotal);
      const delta = Math.min(10, roomStat, roomTotal);
      if (delta <= 0) break;
      pokemon.evs[statKey] = currentStat + delta;
      consumed += 1;
      added += delta;
    }

    if (consumed <= 0) {
      return {
        consumed: 0,
        summary: `No se puede subir mas el EV de ${displayNameFromSlug(statKey)}.`,
      };
    }

    const afterTotal = STAT_KEYS.reduce((sum, key) => sum + Number(pokemon.evs?.[key] || 0), 0);
    return {
      consumed,
      summary: `${displayNameFromSlug(statKey)} EV +${added} (${beforeTotal} -> ${afterTotal} totales).`,
      details: `${displayNameFromSlug(statKey)} EV actual: **${pokemon.evs[statKey]}/252**`,
    };
  }

  applyEvBerryEffect(pokemon, quantity, statKey) {
    this.normalizePokemonGrowthState(pokemon);
    const cap = Math.max(1, Math.floor(Number(quantity) || 1));
    let consumed = 0;
    let reduced = 0;
    let happinessGain = 0;

    for (let i = 0; i < cap; i += 1) {
      const currentStat = Math.max(0, Math.floor(Number(pokemon.evs?.[statKey] || 0)));
      const beforeHappiness = clamp(Math.floor(Number(pokemon.happiness ?? 70)), 0, 255);
      const reducible = Math.min(10, currentStat);
      const canGainHappiness = beforeHappiness < 255;
      if (reducible <= 0 && !canGainHappiness) break;

      if (reducible > 0) {
        pokemon.evs[statKey] = currentStat - reducible;
        reduced += reducible;
      }
      if (canGainHappiness) {
        const afterHappiness = clamp(beforeHappiness + 10, 0, 255);
        happinessGain += (afterHappiness - beforeHappiness);
        pokemon.happiness = afterHappiness;
      } else {
        pokemon.happiness = beforeHappiness;
      }
      consumed += 1;
    }

    if (consumed <= 0) {
      return {
        consumed: 0,
        summary: `No tuvo efecto en ${pokemon.displayName}.`,
      };
    }

    return {
      consumed,
      summary:
        `${displayNameFromSlug(statKey)} EV -${reduced}. ` +
        `Felicidad +${happinessGain} (actual ${clamp(Math.floor(Number(pokemon.happiness ?? 70)), 0, 255)}).`,
    };
  }

  async getAbilityBucketsForPokemon(pokemon) {
    const dexId = Number(pokemon?.dexId || 0);
    if (!Number.isInteger(dexId) || dexId <= 0) {
      return {
        regular: ensureArrayUnique(pokemon.abilities || []),
        hidden: [],
      };
    }
    try {
      const payload = await this.fetchJson(`${POKE_API_BASE}/pokemon/${dexId}`);
      const regular = [];
      const hidden = [];
      for (const row of payload?.abilities || []) {
        const ability = normalizeSlug(row?.ability?.name || '');
        if (!ability) continue;
        if (row?.is_hidden) hidden.push(ability);
        else regular.push(ability);
      }
      return {
        regular: ensureArrayUnique(regular),
        hidden: ensureArrayUnique(hidden),
      };
    } catch {
      return {
        regular: ensureArrayUnique(pokemon.abilities || []),
        hidden: [],
      };
    }
  }

  async applyAbilityItemEffect(pokemon, itemId) {
    this.normalizePokemonGrowthState(pokemon);
    const buckets = await this.getAbilityBucketsForPokemon(pokemon);
    const regular = buckets.regular;
    const hidden = buckets.hidden;
    const current = normalizeSlug(pokemon.ability || pokemon.unlockedAbilities?.[0] || regular[0] || hidden[0] || '');

    pokemon.abilities = ensureArrayUnique([...(pokemon.abilities || []), ...regular, ...hidden]);
    pokemon.unlockedAbilities = ensureArrayUnique(pokemon.unlockedAbilities || []);

    if (itemId === 'ability-capsule') {
      if (!regular.length || regular.length < 2) {
        return {
          consumed: 0,
          summary: `${pokemon.displayName} no tiene dos habilidades normales para intercambiar.`,
        };
      }
      if (!regular.includes(current)) {
        return {
          consumed: 0,
          summary: 'Ability Capsule no funciona cuando la habilidad activa es oculta.',
        };
      }
      const target = regular.find((ability) => ability !== current) || '';
      if (!target) {
        return {
          consumed: 0,
          summary: `${pokemon.displayName} no tiene habilidad alternativa.`,
        };
      }
      pokemon.unlockedAbilities = ensureArrayUnique([...pokemon.unlockedAbilities, ...regular]);
      pokemon.ability = target;
      return {
        consumed: 1,
        summary: `Habilidad activa cambiada a **${displayNameFromSlug(target)}**.`,
      };
    }

    if (itemId === 'ability-patch') {
      const hiddenAbility = hidden[0] || '';
      if (!hiddenAbility) {
        return {
          consumed: 0,
          summary: `${pokemon.displayName} no tiene habilidad oculta.`,
        };
      }
      if (current === hiddenAbility) {
        return {
          consumed: 0,
          summary: `${pokemon.displayName} ya tiene activa su habilidad oculta.`,
        };
      }
      pokemon.unlockedAbilities = ensureArrayUnique([...pokemon.unlockedAbilities, hiddenAbility]);
      pokemon.ability = hiddenAbility;
      return {
        consumed: 1,
        summary: `Habilidad oculta activada: **${displayNameFromSlug(hiddenAbility)}**.`,
      };
    }

    return {
      consumed: 0,
      summary: 'Objeto de habilidad no soportado.',
    };
  }

  async findEligibleEvolutionWithContext(profile, pokemon, options = {}) {
    const candidates = await this.getEvolutionCandidatesForPokemon(pokemon);
    if (!candidates.length) return null;

    const usedItem = normalizeItemId(options.usedItem || '');
    const scopedCandidates = usedItem
      ? candidates.filter((candidate) =>
        (candidate.details || []).some((detail) => normalizeItemId(detail?.item?.name || '') === usedItem)
      )
      : candidates;
    const list = scopedCandidates.length ? scopedCandidates : candidates;

    const context = await this.buildEvolutionContext(profile, pokemon, options);
    for (const candidate of list) {
      const evaluation = await this.evaluateEvolutionCandidate(candidate, context);
      if (evaluation?.eligible) {
        return { candidate, evaluation };
      }
    }
    return null;
  }

  async applyEvolutionItemEffect(profile, pokemon, itemId) {
    const match = await this.findEligibleEvolutionWithContext(profile, pokemon, {
      usedItem: itemId,
    });
    if (!match) {
      return {
        consumed: 0,
        summary: `${formatItemName(itemId)} no tuvo efecto sobre ${pokemon.displayName}.`,
      };
    }

    const targetTemplate = await this.getPokemonTemplate(match.candidate.targetSpeciesName);
    const previous = this.applyEvolutionTemplate(pokemon, targetTemplate);
    return {
      consumed: 1,
      summary:
        `Evolucion: **${previous.displayName}** (${formatDexNumber(previous.dexId)}) -> ` +
        `**${pokemon.displayName}** (${formatDexNumber(pokemon.dexId)}).`,
      details: `Condicion: ${this.describeEvolutionDetail(match.evaluation.detail)}`,
    };
  }

  async handlePokeUse({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const chunks = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (chunks.length < 2) {
      const usage = this.buildSystemEmbed({
        title: 'Uso de pokeuse',
        description:
          '`!pokeuse <objeto> <slot|PKxxxx|indice> [cantidad]`\n' +
          'Ejemplos:\n' +
          '`!pokeuse rare-candy PK0001`\n' +
          '`!pokeuse exp-candy-l 1 3`\n' +
          '`!pokeuse moon-stone 2`',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [usage] });
      return;
    }

    const maybeAmount = Number(chunks[chunks.length - 1]);
    const hasAmount = Number.isInteger(maybeAmount) && maybeAmount > 0;
    const requested = hasAmount ? Math.max(1, Math.floor(maybeAmount)) : 1;
    if (requested > 1000) {
      const tooBig = this.buildSystemEmbed({
        title: 'Cantidad invalida',
        description: 'La cantidad maxima por uso es 1000.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [tooBig] });
      return;
    }

    const referenceIndex = hasAmount ? chunks.length - 2 : chunks.length - 1;
    const reference = String(chunks[referenceIndex] || '').trim();
    const itemRaw = chunks.slice(0, referenceIndex).join(' ');
    const itemId = normalizeItemId(itemRaw);

    if (!itemId || !reference) {
      const usage = this.buildSystemEmbed({
        title: 'Uso de pokeuse',
        description: '`!pokeuse <objeto> <slot|PKxxxx|indice> [cantidad]`',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [usage] });
      return;
    }

    const item = await this.getItemData(itemId);
    if (!item) {
      const invalidItem = this.buildSystemEmbed({
        title: 'Objeto invalido',
        description: `No reconozco **${displayNameFromSlug(itemId)}** en PokeAPI.`,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [invalidItem] });
      return;
    }

    const { pokemon, error, label } = this.resolvePokemonForEvolution(profile, reference);
    if (error || !pokemon) {
      const invalidTarget = this.buildSystemEmbed({
        title: 'Pokemon no encontrado',
        description: error || `No encontre el Pokemon para **${reference}**.`,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [invalidTarget] });
      return;
    }

    const available = Math.max(0, Math.floor(Number(profile.items?.[itemId] || 0)));
    if (available <= 0) {
      const noItem = await this.buildItemsEmbed({
        profile,
        ownerName: message.author.username,
        title: 'No tienes ese objeto',
        note: `Necesitas **${formatItemName(itemId)}** en la bolsa para usarlo.`,
      });
      await message.reply({ embeds: [noItem] });
      return;
    }

    const amount = Math.min(requested, available);
    await message.channel.sendTyping();

    let result = null;
    if (itemId === 'rare-candy') {
      result = this.applyRareCandyEffect(pokemon, amount);
    } else if (EXP_CANDY_XP[itemId]) {
      result = this.applyExpCandyEffect(pokemon, amount, EXP_CANDY_XP[itemId]);
    } else if (VITAMIN_EV_ITEMS[itemId]) {
      result = this.applyVitaminEffect(pokemon, amount, VITAMIN_EV_ITEMS[itemId]);
    } else if (EV_REDUCE_BERRIES[itemId]) {
      result = this.applyEvBerryEffect(pokemon, amount, EV_REDUCE_BERRIES[itemId]);
    } else if (itemId === 'ability-capsule' || itemId === 'ability-patch') {
      result = await this.applyAbilityItemEffect(pokemon, itemId);
    } else {
      result = await this.applyEvolutionItemEffect(profile, pokemon, itemId);
    }

    const consumed = Math.max(0, Math.floor(Number(result?.consumed || 0)));
    if (consumed <= 0) {
      const noEffect = this.buildPokemonConfigEmbed({
        pokemon,
        ownerName: message.author.username,
        titlePrefix: 'Sin efecto: ',
        detailTitle: 'Resultado',
        detailValue: result?.summary || `${formatItemName(itemId)} no tuvo efecto.`,
        colorOverride: 0xff6b6b,
      });
      await message.reply({ embeds: [noEffect] });
      return;
    }

    const removed = this.consumeItemFromBag(profile, itemId, consumed);
    if (!removed) {
      const inconsistent = this.buildSystemEmbed({
        title: 'Inventario desactualizado',
        description: 'No pude descontar el objeto de la bolsa. Intenta de nuevo.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [inconsistent] });
      return;
    }

    await this.persistProfile(message.guild.id, profile);
    await this.persistPokemon(message.guild.id, profile.userId, pokemon);

    const remaining = Math.max(0, Math.floor(Number(profile.items?.[itemId] || 0)));
    const details = [
      result.summary || 'Objeto aplicado.',
      result.details || null,
      `Consumido: **${consumed}x ${formatItemName(itemId)}**`,
      `En bolsa: **${remaining}**`,
      `Referencia: **${label || pokemon.instanceId || reference}**`,
    ].filter(Boolean).join('\n');

    const success = this.buildPokemonConfigEmbed({
      pokemon,
      ownerName: message.author.username,
      titlePrefix: 'Objeto usado: ',
      detailTitle: 'Resultado',
      detailValue: details,
      colorOverride: 0x1abc9c,
    });
    await message.reply({ embeds: [success] });
  }

  buildAbilityConfigEmbed({ slot, pokemon, ownerName, note = '', colorOverride = null }) {
    const allAbilities = ensureArrayUnique(pokemon.abilities || []);
    const unlocked = ensureArrayUnique(
      (pokemon.unlockedAbilities && pokemon.unlockedAbilities.length)
        ? pokemon.unlockedAbilities
        : allAbilities.slice(0, 1)
    );
    const active = normalizeSlug(pokemon.ability || unlocked[0] || allAbilities[0] || '');

    const allText = allAbilities.length
      ? allAbilities
        .map((ability) => {
          const marker = ability === active ? ' [ACTIVA]' : unlocked.includes(ability) ? ' [UNLOCKED]' : '';
          return `${displayNameFromSlug(ability)}${marker}`;
        })
        .join(' | ')
      : 'Sin habilidades registradas.';
    const unlockedText = unlocked.length
      ? unlocked.map((ability) => displayNameFromSlug(ability)).join(' | ')
      : 'Ninguna';

    const embed = this.buildPokemonConfigEmbed({
      pokemon,
      ownerName,
      titlePrefix: `Slot ${slot}: `,
      detailTitle: 'Estado',
      detailValue: note || 'Gestiona habilidades con `set`, `learn`, `forget`.',
      colorOverride,
    });
    embed.addFields(
      { name: 'Habilidades desbloqueadas', value: unlockedText },
      { name: 'Todas las habilidades', value: trimText(allText, 1024) }
    );
    return embed;
  }

  async handlePokeAbility({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const raw = String(args || '').trim();
    if (!raw) {
      const embed = this.buildSystemEmbed({
        title: 'Uso de pokeability',
        description:
          `\`!pokeability <slot 1-${TEAM_SIZE}>\`\n` +
          `\`!pokeability set <slot> <habilidad>\`\n` +
          `\`!pokeability learn <slot> <habilidad>\`\n` +
          `\`!pokeability forget <slot> <habilidad>\``,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    const chunks = raw.split(/\s+/).filter(Boolean);
    const explicitSub = normalizeSlug(chunks[0]);
    const hasSub = ['set', 'learn', 'forget', 'show', 'list'].includes(explicitSub);
    const sub = hasSub ? explicitSub : 'set';
    const slotIndex = hasSub ? 1 : 0;
    const slot = Number(chunks[slotIndex]);
    const abilityInput = normalizeSlug(chunks.slice(slotIndex + 1).join(' '));

    const { error, pokemon: mon } = this.getTeamPokemonBySlot(profile, slot);
    if (error || !mon) {
      const embed = this.buildSystemEmbed({
        title: 'No se pudo abrir pokeability',
        description: error || 'Pokemon no encontrado.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    mon.abilities = ensureArrayUnique(mon.abilities);
    mon.unlockedAbilities = ensureArrayUnique(mon.unlockedAbilities);
    if (!mon.unlockedAbilities.length && mon.abilities.length) {
      mon.unlockedAbilities = [mon.abilities[0]];
    }
    if (!mon.ability || !mon.unlockedAbilities.includes(normalizeSlug(mon.ability))) {
      mon.ability = mon.unlockedAbilities[0] || mon.abilities[0] || null;
    }

    if (sub === 'show' || sub === 'list') {
      const embed = this.buildAbilityConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: 'Vista de habilidades.',
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (!abilityInput) {
      const embed = this.buildSystemEmbed({
        title: 'Falta habilidad',
        description: `Debes indicar la habilidad.\nEjemplo: \`!pokeability ${sub} ${slot} pressure\``,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (!mon.abilities.includes(abilityInput)) {
      const embed = this.buildAbilityConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: `La habilidad **${displayNameFromSlug(abilityInput)}** no pertenece a este Pokemon.`,
        colorOverride: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'learn') {
      if (mon.unlockedAbilities.includes(abilityInput)) {
        const embed = this.buildAbilityConfigEmbed({
          slot,
          pokemon: mon,
          ownerName: message.author.username,
          note: `**${displayNameFromSlug(abilityInput)}** ya estaba desbloqueada.`,
          colorOverride: 0x3498db,
        });
        await message.reply({ embeds: [embed] });
        return;
      }
      mon.unlockedAbilities.push(abilityInput);
      mon.unlockedAbilities = ensureArrayUnique(mon.unlockedAbilities);
      await this.persistPokemon(message.guild.id, profile.userId, mon);
      const embed = this.buildAbilityConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: `Desbloqueaste **${displayNameFromSlug(abilityInput)}**.`,
        colorOverride: 0x1abc9c,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'forget') {
      if (!mon.unlockedAbilities.includes(abilityInput)) {
        const embed = this.buildAbilityConfigEmbed({
          slot,
          pokemon: mon,
          ownerName: message.author.username,
          note: `No puedes olvidar **${displayNameFromSlug(abilityInput)}** porque no esta desbloqueada.`,
          colorOverride: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }
      if (mon.unlockedAbilities.length <= 1) {
        const embed = this.buildAbilityConfigEmbed({
          slot,
          pokemon: mon,
          ownerName: message.author.username,
          note: 'No puedes olvidar la ultima habilidad desbloqueada.',
          colorOverride: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }
      mon.unlockedAbilities = mon.unlockedAbilities.filter((ability) => ability !== abilityInput);
      if (normalizeSlug(mon.ability) === abilityInput) {
        mon.ability = mon.unlockedAbilities[0];
      }
      await this.persistPokemon(message.guild.id, profile.userId, mon);
      const embed = this.buildAbilityConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: `Olvidaste **${displayNameFromSlug(abilityInput)}**.`,
        colorOverride: 0x1abc9c,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (!mon.unlockedAbilities.includes(abilityInput)) {
      const embed = this.buildAbilityConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: `Esa habilidad no esta desbloqueada. Usa \`!pokeability learn ${slot} ${abilityInput}\`.`,
        colorOverride: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    mon.ability = abilityInput;
    await this.persistPokemon(message.guild.id, profile.userId, mon);
    const embed = this.buildAbilityConfigEmbed({
      slot,
      pokemon: mon,
      ownerName: message.author.username,
      note: `Habilidad activa cambiada a **${displayNameFromSlug(abilityInput)}**.`,
      colorOverride: 0x1abc9c,
    });
    await message.reply({ embeds: [embed] });
  }

  buildMovesConfigEmbed({ slot, pokemon, ownerName, note = '', colorOverride = null }) {
    const knownMoves = ensureArrayUnique(pokemon.knownMoves || []);
    const selectedMoves = ensureArrayUnique((pokemon.selectedMoves || []).filter((move) => knownMoves.includes(move)));
    const learnableMoves = ensureArrayUnique((pokemon.movePool || []).filter((move) => !knownMoves.includes(normalizeSlug(move))));

    const knownText = knownMoves.length
      ? `${knownMoves.slice(0, 12).map((move) => displayNameFromSlug(move)).join(', ')}${knownMoves.length > 12 ? ` ...(+${knownMoves.length - 12})` : ''}`
      : 'Ninguno';
    const selectedText = selectedMoves.length
      ? selectedMoves.map((move) => displayNameFromSlug(move)).join(' | ')
      : 'Sin moves equipados';
    const learnableText = learnableMoves.length
      ? `${learnableMoves.slice(0, 10).map((move) => displayNameFromSlug(move)).join(', ')}${learnableMoves.length > 10 ? ` ...(+${learnableMoves.length - 10})` : ''}`
      : 'No hay mas movimientos por aprender.';

    const embed = this.buildPokemonConfigEmbed({
      pokemon,
      ownerName,
      titlePrefix: `Slot ${slot}: `,
      detailTitle: 'Estado',
      detailValue: note || 'Gestiona moves con `set`, `learn`, `forget`.',
      colorOverride,
    });
    embed.addFields(
      { name: 'Moves equipados (max 4)', value: selectedText },
      { name: `Moves conocidos (${knownMoves.length})`, value: trimText(knownText, 1024) },
      { name: 'Moves aprendibles (muestra)', value: trimText(learnableText, 1024) }
    );
    return embed;
  }

  async handlePokeMoves({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const raw = String(args || '').trim();
    if (!raw) {
      const embed = this.buildSystemEmbed({
        title: 'Uso de pokemoves',
        description:
          `\`!pokemoves <slot 1-${TEAM_SIZE}>\`\n` +
          `\`!pokemoves set <slot> <move1|move2|move3|move4>\`\n` +
          `\`!pokemoves learn <slot> <move>\`\n` +
          `\`!pokemoves forget <slot> <move>\``,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    const chunks = raw.split(/\s+/).filter(Boolean);
    const explicitSub = normalizeSlug(chunks[0]);
    const hasSub = ['set', 'learn', 'forget', 'show', 'list'].includes(explicitSub);
    const sub = hasSub ? explicitSub : 'show';
    const slotIndex = hasSub ? 1 : 0;
    const slot = Number(chunks[slotIndex]);

    const { error, pokemon: mon } = this.getTeamPokemonBySlot(profile, slot);
    if (error || !mon) {
      const embed = this.buildSystemEmbed({
        title: 'No se pudo abrir pokemoves',
        description: error || 'Pokemon no encontrado.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    mon.movePool = ensureArrayUnique(mon.movePool);
    mon.knownMoves = ensureArrayUnique(mon.knownMoves);
    if (!mon.knownMoves.length) {
      mon.knownMoves = mon.movePool.slice(0, 4);
    }
    if (!mon.knownMoves.length) {
      mon.knownMoves = ['struggle'];
    }
    mon.selectedMoves = ensureArrayUnique(mon.selectedMoves)
      .filter((move) => mon.knownMoves.includes(move))
      .slice(0, 4);
    if (!mon.selectedMoves.length) {
      mon.selectedMoves = mon.knownMoves.slice(0, 4);
    }

    if (sub === 'show' || sub === 'list') {
      const embed = this.buildMovesConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: 'Vista de movimientos.',
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'set') {
      const joinedMoves = chunks.slice(slotIndex + 1).join(' ').trim();
      if (!joinedMoves) {
        const embed = this.buildSystemEmbed({
          title: 'Faltan movimientos',
          description: `Uso: \`!pokemoves set <slot> <move1|move2|move3|move4>\``,
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      const requestedMoves = ensureArrayUnique(
        joinedMoves
          .split('|')
          .map((name) => normalizeSlug(name))
          .filter(Boolean)
      );
      if (!requestedMoves.length || requestedMoves.length > 4) {
        const embed = this.buildSystemEmbed({
          title: 'Cantidad de movimientos invalida',
          description: 'Debes indicar entre 1 y 4 movimientos separados por `|`.',
          color: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      for (const move of requestedMoves) {
        if (!mon.knownMoves.includes(move)) {
          const invalidEmbed = this.buildMovesConfigEmbed({
            slot,
            pokemon: mon,
            ownerName: message.author.username,
            note: `No puedes equipar **${displayNameFromSlug(move)}** porque no esta aprendido.`,
            colorOverride: 0xff6b6b,
          });
          await message.reply({ embeds: [invalidEmbed] });
          return;
        }
      }

      const verifiedMoves = [];
      for (const move of requestedMoves) {
        const data = await this.getMoveData(move);
        if (!data) {
          const invalidEmbed = this.buildMovesConfigEmbed({
            slot,
            pokemon: mon,
            ownerName: message.author.username,
            note: `No pude validar **${displayNameFromSlug(move)}** en PokeAPI.`,
            colorOverride: 0xff6b6b,
          });
          await message.reply({ embeds: [invalidEmbed] });
          return;
        }
        verifiedMoves.push(data.name);
      }

      mon.selectedMoves = ensureArrayUnique(verifiedMoves).slice(0, 4);
      await this.persistPokemon(message.guild.id, profile.userId, mon);
      const embed = this.buildMovesConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: 'Moves equipados actualizados.',
        colorOverride: 0x1abc9c,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    const moveInput = normalizeSlug(chunks.slice(slotIndex + 1).join(' '));
    if (!moveInput) {
      const embed = this.buildSystemEmbed({
        title: 'Falta movimiento',
        description: `Debes indicar el movimiento.\nEjemplo: \`!pokemoves ${sub} ${slot} thunderbolt\``,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'learn') {
      const pool = this.getPokemonMovePoolSet(mon);
      if (!pool.has(moveInput)) {
        const embed = this.buildMovesConfigEmbed({
          slot,
          pokemon: mon,
          ownerName: message.author.username,
          note: `**${displayNameFromSlug(moveInput)}** no existe en el move pool de ${mon.displayName}.`,
          colorOverride: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }
      if (mon.knownMoves.includes(moveInput)) {
        const embed = this.buildMovesConfigEmbed({
          slot,
          pokemon: mon,
          ownerName: message.author.username,
          note: `**${displayNameFromSlug(moveInput)}** ya estaba aprendido.`,
          colorOverride: 0x3498db,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      const data = await this.getMoveData(moveInput);
      if (!data) {
        const embed = this.buildMovesConfigEmbed({
          slot,
          pokemon: mon,
          ownerName: message.author.username,
          note: `No pude validar **${displayNameFromSlug(moveInput)}** en PokeAPI.`,
          colorOverride: 0xff6b6b,
        });
        await message.reply({ embeds: [embed] });
        return;
      }

      mon.knownMoves.push(data.name);
      mon.knownMoves = ensureArrayUnique(mon.knownMoves);
      if (mon.selectedMoves.length < 4) {
        mon.selectedMoves.push(data.name);
        mon.selectedMoves = ensureArrayUnique(mon.selectedMoves).slice(0, 4);
      }

      await this.persistPokemon(message.guild.id, profile.userId, mon);
      const embed = this.buildMovesConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: `Aprendiste **${displayNameFromSlug(data.name)}**.`,
        colorOverride: 0x1abc9c,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (!mon.knownMoves.includes(moveInput)) {
      const embed = this.buildMovesConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: `No puedes olvidar **${displayNameFromSlug(moveInput)}** porque no esta aprendido.`,
        colorOverride: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }
    if (mon.knownMoves.length <= 1) {
      const embed = this.buildMovesConfigEmbed({
        slot,
        pokemon: mon,
        ownerName: message.author.username,
        note: 'No puedes olvidar el ultimo movimiento conocido.',
        colorOverride: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    mon.knownMoves = mon.knownMoves.filter((move) => move !== moveInput);
    mon.selectedMoves = mon.selectedMoves.filter((move) => move !== moveInput).slice(0, 4);
    if (!mon.selectedMoves.length) {
      mon.selectedMoves = mon.knownMoves.slice(0, 4);
    }
    await this.persistPokemon(message.guild.id, profile.userId, mon);
    const embed = this.buildMovesConfigEmbed({
      slot,
      pokemon: mon,
      ownerName: message.author.username,
      note: `Olvidaste **${displayNameFromSlug(moveInput)}**.`,
      colorOverride: 0x1abc9c,
    });
    await message.reply({ embeds: [embed] });
  }

  async handlePokedex({ args, message }) {
    const raw = String(args || '').trim();
    if (!raw) {
      const usage = this.buildSystemEmbed({
        title: 'Uso de pokedex',
        description:
          '`!pokedex <numero|nombre>`\n' +
          '`!dex <numero|nombre>`\n' +
          '`!pdex <numero|nombre>`\n' +
          'Ejemplos: `!pokedex 25`, `!pokedex pikachu`',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [usage] });
      return;
    }

    const lookupKey = parsePokedexInputToLookup(raw);
    if (!lookupKey) {
      const invalid = this.buildSystemEmbed({
        title: 'Entrada de Pokedex invalida',
        description: `Debes indicar un numero positivo o nombre valido.\nEjemplo: \`!pokedex 1\`, \`!pokedex pikachu\``,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [invalid] });
      return;
    }

    await message.channel.sendTyping();

    try {
      const pokemon = await this.fetchJson(`${POKE_API_BASE}/pokemon/${encodeURIComponent(lookupKey)}`);
      const speciesIdFromUrl = Number(String(pokemon?.species?.url || '').match(/\/(\d+)\/?$/)?.[1] || 0);
      const speciesLookup = (Number.isInteger(speciesIdFromUrl) && speciesIdFromUrl > 0)
        ? speciesIdFromUrl
        : (pokemon?.species?.name || pokemon?.id || lookupKey);
      const species = await this.getSpeciesData(speciesLookup);
      const dexId = Number(pokemon?.id || species?.id || 0);

      const pokeGif =
        getAnimatedSpriteFromPokemonPayload(pokemon)
        || getShowdownAnimatedSpriteUrl(pokemon?.name || species?.name)
        || getPokeApiAnimatedSpriteUrl(dexId);
      const imageUrl =
        pokeGif
        || pokemon?.sprites?.front_default
        || getDefaultSpriteUrl(dexId)
        || pokemon?.sprites?.other?.['official-artwork']?.front_default
        || getOfficialArtworkUrl(dexId)
        || DEFAULT_POKEMON_PLACEHOLDER_IMAGE;
      const displayName = displayNameFromSlug(pokemon?.name || species?.name || String(dexId));
      const dexNumber = formatDexNumber(pokemon?.id || dexId);
      const types = (pokemon?.types || [])
        .slice()
        .sort((a, b) => Number(a?.slot || 0) - Number(b?.slot || 0))
        .map((entry) => displayNameFromSlug(entry?.type?.name))
        .filter(Boolean);
      const abilityRows = (pokemon?.abilities || []).slice().sort((a, b) => Number(a?.slot || 0) - Number(b?.slot || 0));
      const abilities = abilityRows
        .filter((entry) => !entry?.is_hidden)
        .map((entry) => displayNameFromSlug(entry?.ability?.name))
        .filter(Boolean);
      const hiddenAbilities = abilityRows
        .filter((entry) => entry?.is_hidden)
        .map((entry) => displayNameFromSlug(entry?.ability?.name))
        .filter(Boolean);

      const baseStats = {
        hp: statFromPokemonStats(pokemon?.stats, 'hp'),
        attack: statFromPokemonStats(pokemon?.stats, 'attack'),
        defense: statFromPokemonStats(pokemon?.stats, 'defense'),
        specialAttack: statFromPokemonStats(pokemon?.stats, 'special-attack'),
        specialDefense: statFromPokemonStats(pokemon?.stats, 'special-defense'),
        speed: statFromPokemonStats(pokemon?.stats, 'speed'),
      };
      const baseStatTotal = Object.values(baseStats).reduce((sum, value) => sum + Number(value || 0), 0);
      const effortYield = (pokemon?.stats || [])
        .filter((entry) => Number(entry?.effort || 0) > 0)
        .map((entry) => `${Number(entry.effort)} ${displayNameFromSlug(entry?.stat?.name)}`)
        .join(' | ') || 'Ninguno';

      const captureRate = Number(species?.capture_rate ?? 0);
      const isLegendary = Boolean(species?.is_legendary || species?.is_mythical);
      const tier = classifyRarity({
        captureRate,
        baseStatTotal,
        isLegendary,
      });
      const genderText = formatGenderRateText(species?.gender_rate);
      const heightMeters = Number.isFinite(Number(pokemon?.height)) ? `${(Number(pokemon.height) / 10).toFixed(1)} m` : 'Unknown';
      const weightKg = Number.isFinite(Number(pokemon?.weight)) ? `${(Number(pokemon.weight) / 10).toFixed(1)} kg` : 'Unknown';
      const hatchCounter = Number(species?.hatch_counter);
      const hatchText = Number.isFinite(hatchCounter)
        ? `${hatchCounter} ciclos (~${Math.max(0, Math.floor((hatchCounter + 1) * 255))} pasos)`
        : 'Unknown';
      const eggGroups = (species?.egg_groups || [])
        .map((entry) => displayNameFromSlug(entry?.name))
        .filter(Boolean)
        .join(' / ') || 'Unknown';
      const flavorText = pickLocalizedSpeciesText(species?.flavor_text_entries, ['es', 'en']) || 'Sin descripcion disponible.';
      const genusText = pickLocalizedSpeciesText(species?.genera, ['es', 'en']) || 'Unknown';
      const growthRate = displayNameFromSlug(species?.growth_rate?.name || '');
      const generation = displayNameFromSlug(species?.generation?.name || '');
      const habitat = displayNameFromSlug(species?.habitat?.name || '');
      const color = displayNameFromSlug(species?.color?.name || '');
      const shape = displayNameFromSlug(species?.shape?.name || '');
      const evolvesFrom = displayNameFromSlug(species?.evolves_from_species?.name || '');
      const formsCount = Array.isArray(pokemon?.forms) ? pokemon.forms.length : 0;
      const movesCount = Array.isArray(pokemon?.moves) ? pokemon.moves.length : 0;
      const varietiesCount = Array.isArray(species?.varieties) ? species.varieties.length : 0;
      const baseExperience = Number.isFinite(Number(pokemon?.base_experience)) ? Math.floor(Number(pokemon.base_experience)) : 0;
      const flags = [
        species?.is_baby ? 'Baby' : null,
        species?.is_legendary ? 'Legendary' : null,
        species?.is_mythical ? 'Mythical' : null,
      ].filter(Boolean);

      const embed = new EmbedBuilder()
        .setColor(rarityColor(tier))
        .setTitle(`${dexNumber} ${displayName} - Pokedex`)
        .setDescription(`**${genusText}**\n${trimText(flavorText, 700)}`)
        .setImage(imageUrl)
        .addFields(
          {
            name: 'Clasificacion',
            value:
              `Tipo(s): **${types.length ? types.join(' / ') : 'Unknown'}**\n` +
              `Habilidades: **${abilities.length ? abilities.join(' | ') : 'Unknown'}**\n` +
              `Habilidad oculta: **${hiddenAbilities.length ? hiddenAbilities.join(' | ') : 'Ninguna'}**`,
          },
          {
            name: `Base stats (BST ${baseStatTotal})`,
            value:
              `HP ${baseStats.hp} | Atk ${baseStats.attack} | Def ${baseStats.defense} | ` +
              `SpA ${baseStats.specialAttack} | SpD ${baseStats.specialDefense} | Spe ${baseStats.speed}\n` +
              `EV yield: **${effortYield}**`,
          },
          {
            name: 'Biologia',
            value:
              `Altura: **${heightMeters}**\n` +
              `Peso: **${weightKg}**\n` +
              `Genero: **${genderText}**\n` +
              `Grupos huevo: **${eggGroups}**`,
          },
          {
            name: 'Datos de especie',
            value:
              `Generacion: **${generation || 'Unknown'}**\n` +
              `Habitat: **${habitat || 'Unknown'}**\n` +
              `Color: **${color || 'Unknown'}** | Forma: **${shape || 'Unknown'}**\n` +
              `Growth rate: **${growthRate || 'Unknown'}**`,
          },
          {
            name: 'Captura y crianza',
            value:
              `Capture rate: **${captureRate}**\n` +
              `Felicidad base: **${Math.max(0, Math.floor(Number(species?.base_happiness ?? 0)))}**\n` +
              `Hatch: **${hatchText}**\n` +
              `Base EXP: **${baseExperience}**`,
          },
          {
            name: 'Evolucion y variantes',
            value:
              `Evoluciona de: **${evolvesFrom || 'No aplica'}**\n` +
              `Flags: **${flags.length ? flags.join(' | ') : 'Normal'}**\n` +
              `Variedades: **${Math.max(1, varietiesCount)}** | Formas: **${Math.max(1, formsCount)}** | Moves: **${movesCount}**`,
          }
        )
        .setFooter({ text: `Orden interno: ${Math.max(0, Math.floor(Number(pokemon?.order || 0)))}` });

      await message.reply({ embeds: [embed] });
    } catch (error) {
      const text = String(error?.message || '');
      const notFound = /HTTP 404/i.test(text);
      const embed = this.buildSystemEmbed({
        title: notFound ? 'Pokemon no encontrado' : 'Error al consultar Pokedex',
        description: notFound
          ? `No existe Pokemon para **${trimText(raw, 100)}**.`
          : `No pude consultar la Pokedex ahora mismo: ${trimText(text, 300)}`,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [embed] });
    }
  }

  async handlePokeStats({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const raw = String(args || '').trim();
    if (!raw) {
      const usage = this.buildSystemEmbed({
        title: 'Uso de pokestat',
        description:
          '`!pokestat <slot|PKxxxx|indice>`\n' +
          '`!pokestats <slot|PKxxxx|indice>`\n' +
          '`!pstats <slot|PKxxxx|indice>`',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [usage] });
      return;
    }

    const { pokemon, error, label } = this.resolvePokemonForEvolution(profile, raw);
    if (error || !pokemon) {
      const notFound = this.buildSystemEmbed({
        title: 'Pokemon no encontrado',
        description: error || `No encontre el Pokemon para **${raw}**.`,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [notFound] });
      return;
    }

    const embed = this.buildPokemonStatsEmbed({
      pokemon,
      ownerName: message.author.username,
      reference: label || pokemon.instanceId || raw,
    });
    await message.reply({ embeds: [embed] });
  }

  async handlePokeEvolve({ args, message }) {
    const profile = await this.ensureProfileLoaded(message.guild.id, message.author);
    const parsed = this.parseEvolutionRequestArgs(args);
    if (!parsed) {
      const usage = this.buildSystemEmbed({
        title: 'Uso de evolve',
        description:
          `\`!evolve <slot|PKxxxx|indice>\`\n` +
          `\`!evolve <ref> <objetivo>\`\n` +
          `\`!evolve <ref> target=<especie> item=<item> trade with=<especie>\`\n` +
          'Flags opcionales: `rain`, `upside`, `time=day|night`, `location=<slug>`.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [usage] });
      return;
    }

    const { pokemon, error, label } = this.resolvePokemonForEvolution(profile, parsed.reference);
    if (error || !pokemon) {
      const notFound = this.buildSystemEmbed({
        title: 'Pokemon no encontrado',
        description: error || 'No encontre el Pokemon para evolucionar.',
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [notFound] });
      return;
    }

    await message.channel.sendTyping();
    const allCandidates = await this.getEvolutionCandidatesForPokemon(pokemon);
    if (!allCandidates.length) {
      const noEvolution = this.buildPokemonConfigEmbed({
        pokemon,
        ownerName: message.author.username,
        titlePrefix: 'Sin evolucion: ',
        detailTitle: 'Estado',
        detailValue: `**${pokemon.displayName}** no tiene evoluciones disponibles.`,
        colorOverride: 0x3498db,
      });
      await message.reply({ embeds: [noEvolution] });
      return;
    }

    const targetFilter = normalizeSlug(parsed.options.targetSpecies || '');
    const candidates = targetFilter
      ? allCandidates.filter((candidate) => candidate.targetSpeciesName === targetFilter)
      : allCandidates;

    if (!candidates.length) {
      const available = allCandidates.map((candidate) => `- ${candidate.targetDisplayName}`).join('\n');
      const wrongTarget = this.buildSystemEmbed({
        title: 'Objetivo invalido',
        description:
          `No existe evolucion objetivo **${displayNameFromSlug(targetFilter)}** para ${pokemon.displayName}.\n\n` +
          `Opciones:\n${available}`,
        color: 0xff6b6b,
      });
      await message.reply({ embeds: [wrongTarget] });
      return;
    }

    const context = await this.buildEvolutionContext(profile, pokemon, parsed.options);
    const evaluated = [];
    for (const candidate of candidates) {
      const evaluation = await this.evaluateEvolutionCandidate(candidate, context);
      evaluated.push({ ...candidate, evaluation });
    }

    const eligible = evaluated.filter((entry) => entry.evaluation.eligible);
    if (!eligible.length) {
      const lines = evaluated.map((entry) => {
        const requirements = this.describeEvolutionDetail(entry.evaluation.detail);
        const missing = (entry.evaluation.missing || []).slice(0, 3).join(' ');
        return `- **${entry.targetDisplayName}**\n  Req: ${requirements}\n  Falta: ${missing || 'N/A'}`;
      }).join('\n');

      const blocked = this.buildPokemonConfigEmbed({
        pokemon,
        ownerName: message.author.username,
        titlePrefix: 'Evolucion bloqueada: ',
        detailTitle: 'Referencia',
        detailValue: `Seleccion: **${label || pokemon.instanceId}**`,
        colorOverride: 0xff6b6b,
      }).addFields({
        name: 'Requisitos pendientes',
        value: trimText(lines, 1024),
      });
      await message.reply({ embeds: [blocked] });
      return;
    }

    if (eligible.length > 1 && !targetFilter) {
      const optionsText = eligible.map((entry) => {
        const summary = this.describeEvolutionDetail(entry.evaluation.detail);
        return `- **${entry.targetDisplayName}** (${summary})`;
      }).join('\n');
      const chooseOne = this.buildPokemonConfigEmbed({
        pokemon,
        ownerName: message.author.username,
        titlePrefix: 'Elige evolucion: ',
        detailTitle: 'Accion requerida',
        detailValue: 'Hay multiples evoluciones posibles. Especifica objetivo con `target=<especie>`.',
        colorOverride: 0x3498db,
      }).addFields({
        name: 'Opciones elegibles',
        value: trimText(optionsText, 1024),
      });
      await message.reply({ embeds: [chooseOne] });
      return;
    }

    const chosen = eligible[0];
    const targetTemplate = await this.getPokemonTemplate(chosen.targetSpeciesName);
    const previous = this.applyEvolutionTemplate(pokemon, targetTemplate);
    await this.persistPokemon(message.guild.id, profile.userId, pokemon);

    const detailSummary = this.describeEvolutionDetail(chosen.evaluation.detail);
    const level = clamp(Math.floor(Number(pokemon.level || 1)), 1, 100);
    const beforeStats = buildBattleStats(previous.baseStats, level, {
      evs: pokemon.evs,
      ivs: pokemon.ivs,
      nature: pokemon.nature,
      speciesName: previous.speciesName,
      dexId: previous.dexId,
    });
    const afterStats = buildBattleStats(pokemon.baseStats, level, {
      evs: pokemon.evs,
      ivs: pokemon.ivs,
      nature: pokemon.nature,
      speciesName: pokemon.speciesName || pokemon.name,
      dexId: pokemon.dexId,
    });
    const statsLine = (stats) => (
      `HP ${stats.hp} | Atk ${stats.attack} | Def ${stats.defense} | ` +
      `SpA ${stats.specialAttack} | SpD ${stats.specialDefense} | Spe ${stats.speed}`
    );
    const evolved = this.buildPokemonConfigEmbed({
      pokemon,
      ownerName: message.author.username,
      titlePrefix: 'Evolucion completada: ',
      detailTitle: 'Resultado',
      detailValue:
        `**${previous.displayName}** (${formatDexNumber(previous.dexId)}) -> ` +
        `**${pokemon.displayName}** (${formatDexNumber(pokemon.dexId)})`,
      colorOverride: 0x1abc9c,
    }).addFields({
      name: 'Condicion aplicada',
      value: trimText(detailSummary, 1024),
    }, {
      name: `Stats recalculadas (Lv.${level})`,
      value: `Antes: ${statsLine(beforeStats)}\nAhora: ${statsLine(afterStats)}`,
    });

    await message.reply({ embeds: [evolved] });
  }

  hasActiveBattleForUser(guildId, userId) {
    for (const battle of this.battles.values()) {
      if (battle.guildId !== guildId) continue;
      if (battle.players.some((player) => player.userId === userId)) {
        return true;
      }
    }
    return false;
  }

  findPendingChallengeByUser(guildId, userId) {
    for (const challenge of this.challenges.values()) {
      if (challenge.guildId !== guildId) continue;
      if (challenge.challengerId === userId || challenge.challengedId === userId) {
        return challenge;
      }
    }
    return null;
  }

  async handlePokeBattle({ message }) {
    const guildId = message.guild.id;
    const challenger = message.author;
    const opponent = message.mentions.users.first();

    if (!opponent) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'Uso de pokebattle',
            description: '`!pokebattle @usuario`',
            color: 0xff6b6b,
          }),
        ],
      });
      return;
    }
    if (opponent.bot) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'Reto invalido',
            description: 'No puedes iniciar combate contra un bot.',
            color: 0xff6b6b,
          }),
        ],
      });
      return;
    }
    if (opponent.id === challenger.id) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'Reto invalido',
            description: 'No puedes pelear contra ti mismo.',
            color: 0xff6b6b,
          }),
        ],
      });
      return;
    }

    if (this.hasActiveBattleForUser(guildId, challenger.id) || this.hasActiveBattleForUser(guildId, opponent.id)) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'Combate no disponible',
            description: 'Uno de los dos ya esta en combate.',
            color: 0xff6b6b,
          }),
        ],
      });
      return;
    }

    if (this.findPendingChallengeByUser(guildId, challenger.id)) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'Reto pendiente',
            description: 'Ya tienes un reto pendiente. Usa `!pokebattlecancel` para cancelarlo.',
            color: 0xff6b6b,
          }),
        ],
      });
      return;
    }
    if (this.findPendingChallengeByUser(guildId, opponent.id)) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'Reto no disponible',
            description: 'Ese usuario ya tiene un reto pendiente.',
            color: 0xff6b6b,
          }),
        ],
      });
      return;
    }

    const challengerProfile = await this.ensureProfileLoaded(guildId, challenger);
    const opponentProfile = await this.ensureProfileLoaded(guildId, opponent);
    if (!this.getTeamInstances(challengerProfile).length) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'Equipo incompleto',
            description: 'No tienes Pokemon en tu equipo. Usa `!poketeam` primero.',
            color: 0xff6b6b,
          }),
        ],
      });
      return;
    }
    if (!this.getTeamInstances(opponentProfile).length) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'Rival sin equipo',
            description: 'Tu rival no tiene Pokemon en su equipo.',
            color: 0xff6b6b,
          }),
        ],
      });
      return;
    }

    const challengeId = crypto.randomUUID().slice(0, 8);
    const challenge = {
      id: challengeId,
      guildId,
      channelId: message.channel.id,
      challengerId: challenger.id,
      challengerName: challenger.username,
      challengedId: opponent.id,
      challengedName: opponent.username,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
      messageId: null,
    };
    this.challenges.set(challengeId, challenge);

    const embed = new EmbedBuilder()
      .setColor(0xffcb05)
      .setTitle('Reto Pokemon')
      .setDescription(
        `**${challenger.username}** reto a **${opponent.username}**.\n` +
        `Expira en ${formatDuration(CHALLENGE_TTL_MS)}.`
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pkaccept:${challengeId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel('Aceptar combate'),
      new ButtonBuilder()
        .setCustomId(`pkdecline:${challengeId}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Rechazar')
    );

    const sent = await message.reply({ embeds: [embed], components: [row] });
    challenge.messageId = sent.id;
  }

  async handlePokeBattleCancel({ message }) {
    const challenge = this.findPendingChallengeByUser(message.guild.id, message.author.id);
    if (!challenge) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'Sin retos pendientes',
            description: 'No tienes retos pendientes.',
            color: 0x3498db,
          }),
        ],
      });
      return;
    }
    if (challenge.challengerId !== message.author.id) {
      await message.reply({
        embeds: [
          this.buildSystemEmbed({
            title: 'No autorizado',
            description: 'Solo quien crea el reto puede cancelarlo.',
            color: 0xff6b6b,
          }),
        ],
      });
      return;
    }
    this.challenges.delete(challenge.id);
    await message.reply({
      embeds: [
        this.buildSystemEmbed({
          title: 'Reto cancelado',
          description: 'Se cerro tu reto pendiente.',
          color: 0x3498db,
        }),
      ],
    });
  }

  cleanupExpiredChallenges() {
    const now = Date.now();
    for (const [id, challenge] of this.challenges.entries()) {
      if (challenge.expiresAt <= now) {
        this.challenges.delete(id);
      }
    }
  }

  async handleChallengeInteraction({ interaction, accepted }) {
    const [, challengeId] = interaction.customId.split(':');
    const challenge = this.challenges.get(challengeId);

    if (!challenge) {
      await interaction.reply({ content: 'Este reto ya no existe o expiro.', ephemeral: true });
      return;
    }

    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(challenge.id);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x808080)
            .setTitle('Reto Pokemon expirado')
            .setDescription('El reto caduco y fue cerrado.'),
        ],
        components: [],
      });
      return;
    }

    const isChallenger = interaction.user.id === challenge.challengerId;
    const isChallenged = interaction.user.id === challenge.challengedId;
    if (!isChallenger && !isChallenged) {
      await interaction.reply({ content: 'No formas parte de este reto.', ephemeral: true });
      return;
    }

    if (!accepted) {
      this.challenges.delete(challenge.id);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('Reto Pokemon rechazado')
            .setDescription(
              `**${challenge.challengerName}** vs **${challenge.challengedName}**\n` +
              `Rechazado por ${interaction.user.username}.`
            ),
        ],
        components: [],
      });
      return;
    }

    if (!isChallenged) {
      await interaction.reply({ content: 'Solo el jugador retado puede aceptar.', ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    this.challenges.delete(challenge.id);

    try {
      const battle = await this.createBattleFromChallenge(challenge);
      battle.messageId = interaction.message.id;
      this.battles.set(battle.id, battle);
      await interaction.message.edit(this.buildBattlePayload(battle));
    } catch (error) {
      await interaction.message.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('No se pudo iniciar el combate')
            .setDescription(error.message),
        ],
        components: [],
      });
    }
  }

  async createBattleFromChallenge(challenge) {
    const guildId = challenge.guildId;
    const challengerUser = { id: challenge.challengerId, username: challenge.challengerName };
    const challengedUser = { id: challenge.challengedId, username: challenge.challengedName };

    const first = await this.buildBattlePlayer(guildId, challengerUser);
    const second = await this.buildBattlePlayer(guildId, challengedUser);
    if (!first.team.length || !second.team.length) {
      throw new Error('Ambos jugadores deben tener al menos 1 Pokemon en su equipo.');
    }

    return {
      id: crypto.randomUUID().slice(0, 8),
      guildId: challenge.guildId,
      channelId: challenge.channelId,
      createdAt: Date.now(),
      turn: 1,
      players: [first, second],
      log: ['Combate iniciado. Seleccionen movimientos.'],
      winnerUserId: null,
      processing: false,
      messageId: null,
    };
  }

  async buildBattlePlayer(guildId, user) {
    const profile = await this.ensureProfileLoaded(guildId, user);
    if (!profile) {
      throw new Error(`El jugador ${user.username} no tiene perfil Pokemon.`);
    }

    const teamSource = this.getTeamInstances(profile);
    if (!teamSource.length) {
      throw new Error(`El jugador ${user.username} no tiene equipo configurado.`);
    }

    const team = [];
    for (const instance of teamSource) {
      const level = clamp(Math.floor(Number(instance.level || BATTLE_LEVEL)), 1, 100);
      const stats = buildBattleStats(instance.baseStats, level, {
        evs: instance.evs,
        ivs: instance.ivs,
        nature: instance.nature,
        speciesName: instance.speciesName || instance.name || instance.displayName,
        dexId: instance.dexId,
      });
      const moves = await this.resolveBattleMoves(instance);
      team.push({
        instanceId: instance.instanceId,
        displayName: instance.displayName,
        name: instance.name || instance.speciesName || instance.displayName,
        speciesName: instance.speciesName || instance.name || instance.displayName,
        dexId: instance.dexId,
        sprite: resolvePokemonImageUrl(instance),
        level,
        types: [...instance.types],
        ability: normalizeSlug(instance.ability || instance.abilities[0] || ''),
        heldItem: normalizeItemId(instance.heldItem || ''),
        nature: normalizeNature(instance.nature || 'hardy'),
        evs: normalizeEvSpread(instance.evs, {
          hp: 0,
          attack: 0,
          defense: 0,
          specialAttack: 0,
          specialDefense: 0,
          speed: 0,
        }),
        ivs: normalizeIvSpread(instance.ivs, {
          hp: 31,
          attack: 31,
          defense: 31,
          specialAttack: 31,
          specialDefense: 31,
          speed: 31,
        }),
        stats,
        maxHp: stats.hp,
        currentHp: stats.hp,
        moves,
        choiceLockedMove: null,
      });
    }

    return {
      userId: user.id,
      username: user.username,
      team,
      activeIndex: 0,
      selectedMoveIndex: null,
    };
  }

  getActivePokemon(player) {
    return player.team[player.activeIndex] || null;
  }

  countAlive(player) {
    return player.team.filter((mon) => mon.currentHp > 0).length;
  }

  switchToNextAlive(player, logs) {
    const nextIndex = player.team.findIndex((mon) => mon.currentHp > 0);
    if (nextIndex < 0) return false;
    player.activeIndex = nextIndex;
    const mon = this.getActivePokemon(player);
    logs.push(`${player.username} envia a ${mon.displayName}.`);
    return true;
  }

  resolveMoveForTurn({ player, logs }) {
    const active = this.getActivePokemon(player);
    if (!active) return STRUGGLE_MOVE;

    let selected = active.moves[player.selectedMoveIndex] || active.moves[0] || STRUGGLE_MOVE;
    const heldItem = normalizeItemId(active.heldItem || '');
    if (isChoiceItem(heldItem) && active.choiceLockedMove) {
      const locked = active.moves.find((move) => normalizeSlug(move.name) === normalizeSlug(active.choiceLockedMove));
      if (locked) {
        if (normalizeSlug(selected.name) !== normalizeSlug(locked.name)) {
          logs.push(`${active.displayName} queda bloqueado en ${locked.displayName} por ${formatItemName(heldItem)}.`);
        }
        selected = locked;
      }
    }

    if (heldItem === 'assault-vest' && normalizeSlug(selected.category) === 'status') {
      const replacement = active.moves.find((move) => normalizeSlug(move.category) !== 'status');
      if (replacement) {
        logs.push(`${active.displayName} no puede usar movimientos de estado por Assault Vest.`);
        selected = replacement;
      }
    }

    return selected || STRUGGLE_MOVE;
  }

  applyPostAttackItemEffects({ attacker, defender, move, dealtDamage, logs }) {
    const attackerItem = normalizeItemId(attacker.heldItem || '');
    const defenderItem = normalizeItemId(defender.heldItem || '');
    const moveCategory = normalizeSlug(move?.category || '');
    let damageToApply = Math.max(0, Math.floor(Number(dealtDamage) || 0));

    if (defenderItem === 'focus-sash' && defender.currentHp === defender.maxHp && damageToApply >= defender.currentHp) {
      damageToApply = Math.max(0, defender.currentHp - 1);
      defender.heldItem = null;
      logs.push(`${defender.displayName} aguanta con Focus Sash.`);
    }

    if (attackerItem === 'life-orb' && damageToApply > 0 && moveCategory !== 'status' && attacker.currentHp > 0) {
      const recoil = Math.max(1, Math.floor(attacker.maxHp * 0.1));
      attacker.currentHp = Math.max(0, attacker.currentHp - recoil);
      logs.push(`${attacker.displayName} recibe ${recoil} de recoil por Life Orb.`);
    }

    return damageToApply;
  }

  applyEndTurnEffects(players, logs) {
    for (const player of players) {
      const active = this.getActivePokemon(player);
      if (!active || active.currentHp <= 0) continue;
      const heldItem = normalizeItemId(active.heldItem || '');

      if (heldItem === 'leftovers') {
        const heal = Math.max(1, Math.floor(active.maxHp / 16));
        const before = active.currentHp;
        active.currentHp = Math.min(active.maxHp, active.currentHp + heal);
        if (active.currentHp > before) {
          logs.push(`${active.displayName} recupera PS con Leftovers.`);
        }
      }

      if (heldItem === 'black-sludge') {
        const isPoisonType = (active.types || []).includes('poison');
        if (isPoisonType) {
          const heal = Math.max(1, Math.floor(active.maxHp / 16));
          const before = active.currentHp;
          active.currentHp = Math.min(active.maxHp, active.currentHp + heal);
          if (active.currentHp > before) {
            logs.push(`${active.displayName} recupera PS con Black Sludge.`);
          }
        } else {
          const damage = Math.max(1, Math.floor(active.maxHp / 8));
          active.currentHp = Math.max(0, active.currentHp - damage);
          logs.push(`${active.displayName} recibe dano por Black Sludge.`);
        }
      }

      if (heldItem === 'sitrus-berry' && active.currentHp > 0 && active.currentHp <= Math.floor(active.maxHp / 2)) {
        const heal = Math.max(1, Math.floor(active.maxHp / 4));
        active.currentHp = Math.min(active.maxHp, active.currentHp + heal);
        active.heldItem = null;
        logs.push(`${active.displayName} consume Sitrus Berry y recupera PS.`);
      }

      if (active.currentHp <= 0) {
        logs.push(`${active.displayName} se debilito por efecto de objeto.`);
        const switched = this.switchToNextAlive(player, logs);
        if (!switched) {
          logs.push(`${player.username} se queda sin Pokemon.`);
        }
      }
    }
  }

  applyBattleExperience(profile, battlePlayer, amount) {
    const changes = [];
    if (!profile || !battlePlayer || !Number.isFinite(amount) || amount <= 0) {
      return changes;
    }

    for (const battleMon of battlePlayer.team || []) {
      const source = this.getPokemonByInstance(profile, battleMon.instanceId);
      if (!source) continue;

      const beforeLevel = clamp(Math.floor(Number(source.level || 1)), 1, 100);
      const growthRate = normalizeGrowthRate(source.growthRate);
      const beforeExp = Math.max(
        0,
        Math.floor(Number(source.experience ?? getExperienceForLevel(beforeLevel, growthRate)))
      );
      const gained = beforeLevel >= 100 ? 0 : Math.max(0, Math.floor(amount));
      const newExp = beforeExp + gained;
      const newLevel = getLevelFromExperience(newExp, growthRate);

      source.experience = newExp;
      source.level = newLevel;
      source.growthRate = growthRate;
      source.nextLevelExperience = getNextLevelExperience(newLevel, growthRate);
      source.heldItem = battleMon.heldItem ? normalizeItemId(battleMon.heldItem) : null;
      if (newLevel > beforeLevel) {
        const gainedLevels = newLevel - beforeLevel;
        source.happiness = clamp(
          Math.floor(Number(source.happiness ?? 70)) + gainedLevels * 2,
          0,
          255
        );
      }

      if (newLevel > beforeLevel || gained > 0) {
        changes.push({
          displayName: source.displayName,
          instanceId: source.instanceId,
          oldLevel: beforeLevel,
          newLevel,
          gained,
        });
      }
    }
    return changes;
  }

  buildBattleOverviewEmbed({ battle, ended, waiting }) {
    const [playerA, playerB] = battle.players;
    const aliveA = this.countAlive(playerA);
    const aliveB = this.countAlive(playerB);
    const winner = ended
      ? battle.players.find((player) => player.userId === battle.winnerUserId) || null
      : null;

    const title = ended ? 'Combate Pokemon - Finalizado' : `Combate Pokemon - Turno ${battle.turn}`;
    const descriptionLines = [];
    if (winner) {
      descriptionLines.push(`Ganador: **${winner.username}**`);
      descriptionLines.push('');
    }
    if (!ended) {
      descriptionLines.push(waiting ? `Esperando movimientos de: ${waiting}` : 'Procesando turno...');
      descriptionLines.push('');
    }
    if (battle.log.length) {
      descriptionLines.push('Registro reciente:');
      descriptionLines.push(...battle.log.slice(-LOG_LIMIT).map((line) => `- ${line}`));
    }

    return new EmbedBuilder()
      .setColor(ended ? 0x2f3136 : 0xffcb05)
      .setTitle(title)
      .setDescription(descriptionLines.join('\n'))
      .addFields({
        name: 'Marcador',
        value: `**${playerA.username}** (${aliveA} vivos) vs **${playerB.username}** (${aliveB} vivos)`,
      });
  }

  buildBattleActivePokemonEmbed({ player, active, selectedMoveIndex }) {
    if (!active) {
      return new EmbedBuilder()
        .setColor(0x555555)
        .setTitle(`${player.username}`)
        .setDescription('Sin Pokemon activo.');
    }

    const types = (active.types || []).map((type) => displayNameFromSlug(type)).join(' / ') || 'Unknown';
    const selectedMove = Number.isInteger(selectedMoveIndex)
      ? active.moves?.[selectedMoveIndex] || null
      : null;
    const selectedMoveText = selectedMove
      ? selectedMove.displayName
      : 'Pendiente';
    const lockedText = active.choiceLockedMove
      ? displayNameFromSlug(active.choiceLockedMove)
      : 'No';

    const embed = new EmbedBuilder()
      .setColor(active.currentHp > 0 ? 0x1abc9c : 0x7f8c8d)
      .setTitle(`${player.username} - ${active.displayName}`)
      .setDescription(
        `**${formatDexNumber(active.dexId)}** | Lv.${active.level}\n` +
        `HP: **${active.currentHp}/${active.maxHp}**\n` +
        `${hpBar(active.currentHp, active.maxHp)}\n` +
        `Tipo: **${types}**\n` +
        `Habilidad: **${displayNameFromSlug(active.ability)}**\n` +
        `Objeto: **${formatItemName(active.heldItem)}**\n` +
        `Move seleccionado: **${selectedMoveText}**\n` +
        `Choice lock: **${lockedText}**`
      )
      .setThumbnail(resolvePokemonImageUrl(active))
      .setFooter({ text: `${this.countAlive(player)} Pokemon en pie` });

    return embed;
  }

  buildBattlePayload(battle, options = {}) {
    const ended = Boolean(options.ended || battle.winnerUserId);
    const [playerA, playerB] = battle.players;
    const activeA = this.getActivePokemon(playerA);
    const activeB = this.getActivePokemon(playerB);

    const waiting = ended
      ? ''
      : battle.players
        .filter((player) => !Number.isInteger(player.selectedMoveIndex))
        .map((player) => player.username)
        .join(', ');

    const overviewEmbed = this.buildBattleOverviewEmbed({ battle, ended, waiting });
    const activeAEmbed = this.buildBattleActivePokemonEmbed({
      player: playerA,
      active: activeA,
      selectedMoveIndex: playerA.selectedMoveIndex,
    });
    const activeBEmbed = this.buildBattleActivePokemonEmbed({
      player: playerB,
      active: activeB,
      selectedMoveIndex: playerB.selectedMoveIndex,
    });

    if (ended) {
      return { embeds: [overviewEmbed, activeAEmbed, activeBEmbed], components: [] };
    }

    const components = battle.players.map((player) => {
      const active = this.getActivePokemon(player);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pklabel:${battle.id}:${player.userId}`)
          .setLabel(trimText(player.username, 14))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      for (let i = 0; i < 4; i += 1) {
        const move = active?.moves?.[i];
        const categoryTag = move?.category ? String(move.category).charAt(0).toUpperCase() : '-';
        const label = move ? trimText(`${categoryTag}:${move.displayName}`, 20) : '-';
        const button = new ButtonBuilder()
          .setCustomId(`pkmove:${battle.id}:${player.userId}:${i}`)
          .setLabel(label)
          .setStyle(player.selectedMoveIndex === i ? ButtonStyle.Success : ButtonStyle.Primary)
          .setDisabled(!move);
        row.addComponents(button);
      }

      return row;
    });

    return { embeds: [overviewEmbed, activeAEmbed, activeBEmbed], components };
  }

  compareTurnOrder(a, b) {
    if (b.move.priority !== a.move.priority) {
      return b.move.priority - a.move.priority;
    }
    const aMon = this.getActivePokemon(a.player);
    const bMon = this.getActivePokemon(b.player);
    const speedA = Math.floor((aMon?.stats?.speed || 0) * (normalizeItemId(aMon?.heldItem) === 'choice-scarf' ? 1.5 : 1));
    const speedB = Math.floor((bMon?.stats?.speed || 0) * (normalizeItemId(bMon?.heldItem) === 'choice-scarf' ? 1.5 : 1));
    if (speedB !== speedA) {
      return speedB - speedA;
    }
    return Math.random() < 0.5 ? -1 : 1;
  }

  runMove({ attackerPlayer, defenderPlayer, move, logs }) {
    const attacker = this.getActivePokemon(attackerPlayer);
    const defender = this.getActivePokemon(defenderPlayer);
    if (!attacker || !defender) return;
    if (attacker.currentHp <= 0) return;

    const attackerItem = normalizeItemId(attacker.heldItem || '');
    if (isChoiceItem(attackerItem) && !attacker.choiceLockedMove) {
      attacker.choiceLockedMove = normalizeSlug(move.name || move.displayName);
    }

    logs.push(`${attackerPlayer.username}: ${attacker.displayName} usa ${move.displayName}.`);

    const accuracy = Number.isFinite(move.accuracy) ? move.accuracy : 100;
    if (Math.random() * 100 > accuracy) {
      logs.push('El movimiento fallo.');
      return;
    }

    const outcome = calculateDamage({
      attacker,
      defender,
      move,
      rng: Math.random,
    });

    if (outcome.absorbed) {
      const heal = Math.max(1, Math.floor(defender.maxHp * outcome.healRatio));
      defender.currentHp = Math.min(defender.maxHp, defender.currentHp + heal);
      logs.push(`${defender.displayName} absorbio el ataque (${displayNameFromSlug(defender.ability)}).`);
      return;
    }

    if (outcome.typeMultiplier === 0) {
      logs.push('No afecta al objetivo.');
      return;
    }

    if (outcome.damage <= 0) {
      logs.push('No hizo dano.');
      return;
    }

    const appliedDamage = this.applyPostAttackItemEffects({
      attacker,
      defender,
      move,
      dealtDamage: outcome.damage,
      logs,
    });
    const cappedDamage = Math.max(0, Math.min(appliedDamage, defender.currentHp));
    defender.currentHp = Math.max(0, defender.currentHp - cappedDamage);

    const extras = [];
    if (outcome.critical) extras.push('critico');
    if (outcome.typeMultiplier >= 2) extras.push('super efectivo');
    if (outcome.typeMultiplier > 0 && outcome.typeMultiplier < 1) extras.push('poco efectivo');
    const suffix = extras.length ? ` (${extras.join(', ')})` : '';
    logs.push(`Dano: ${cappedDamage}${suffix}.`);

    if (attacker.currentHp <= 0) {
      logs.push(`${attacker.displayName} se debilito.`);
      const switchedAttacker = this.switchToNextAlive(attackerPlayer, logs);
      if (!switchedAttacker) {
        logs.push(`${attackerPlayer.username} se queda sin Pokemon.`);
      }
    }

    if (defender.currentHp <= 0) {
      logs.push(`${defender.displayName} se debilito.`);
      const switched = this.switchToNextAlive(defenderPlayer, logs);
      if (!switched) {
        logs.push(`${defenderPlayer.username} se queda sin Pokemon.`);
      }
    }
  }

  executeTurn(battle) {
    const [playerA, playerB] = battle.players;
    const activeA = this.getActivePokemon(playerA);
    const activeB = this.getActivePokemon(playerB);
    if (!activeA || !activeB) return;

    const logs = [`Turno ${battle.turn}`];
    const moveA = this.resolveMoveForTurn({ player: playerA, logs });
    const moveB = this.resolveMoveForTurn({ player: playerB, logs });
    const actions = [
      { player: playerA, opponent: playerB, move: moveA },
      { player: playerB, opponent: playerA, move: moveB },
    ].sort((left, right) => this.compareTurnOrder(left, right));

    for (const action of actions) {
      const attackerAlive = this.countAlive(action.player);
      const defenderAlive = this.countAlive(action.opponent);
      if (!attackerAlive || !defenderAlive) break;
      this.runMove({
        attackerPlayer: action.player,
        defenderPlayer: action.opponent,
        move: action.move,
        logs,
      });
    }

    if (this.countAlive(playerA) > 0 && this.countAlive(playerB) > 0) {
      this.applyEndTurnEffects([playerA, playerB], logs);
    }

    battle.log.push(...logs);
    battle.log = battle.log.slice(-LOG_LIMIT);
    if (this.countAlive(playerA) === 0 || this.countAlive(playerB) === 0) {
      battle.winnerUserId = this.countAlive(playerA) > 0 ? playerA.userId : playerB.userId;
    }

    for (const player of battle.players) {
      player.selectedMoveIndex = null;
    }
    battle.turn += 1;
  }

  async finalizeBattle(battle) {
    const winner = battle.players.find((player) => player.userId === battle.winnerUserId) || null;
    const loser = battle.players.find((player) => player.userId !== battle.winnerUserId) || null;
    if (!winner || !loser) return;

    const winnerProfile = this.getProfile(battle.guildId, winner.userId);
    const loserProfile = this.getProfile(battle.guildId, loser.userId);
    if (winnerProfile) {
      winnerProfile.wins += 1;
      winnerProfile.pulls += 2;
      winnerProfile.money = Math.max(0, Math.floor(Number(winnerProfile.money || 0))) + PVP_MONEY_WIN;
    }
    if (loserProfile) {
      loserProfile.losses += 1;
      loserProfile.pulls += 1;
      loserProfile.money = Math.max(0, Math.floor(Number(loserProfile.money || 0))) + PVP_MONEY_LOSS;
    }

    const winnerXpChanges = winnerProfile
      ? this.applyBattleExperience(winnerProfile, winner, PVP_XP_WIN)
      : [];
    const loserXpChanges = loserProfile
      ? this.applyBattleExperience(loserProfile, loser, PVP_XP_LOSS)
      : [];

    if (winnerProfile) {
      await this.persistProfile(battle.guildId, winnerProfile);
      await this.persistPokemons(
        battle.guildId,
        winnerProfile.userId,
        winnerProfile.collection.filter((pokemon) => winner.team.some((battleMon) => battleMon.instanceId === pokemon.instanceId))
      );
    }
    if (loserProfile) {
      await this.persistProfile(battle.guildId, loserProfile);
      await this.persistPokemons(
        battle.guildId,
        loserProfile.userId,
        loserProfile.collection.filter((pokemon) => loser.team.some((battleMon) => battleMon.instanceId === pokemon.instanceId))
      );
    }

    battle.log.push(
      `Ganador: ${winner.username}. +2 tiradas y +${formatMoney(PVP_MONEY_WIN)} para ${winner.username}. ` +
      `+1 tirada y +${formatMoney(PVP_MONEY_LOSS)} para ${loser.username}.`
    );
    if (winnerXpChanges.length) {
      const levelUps = winnerXpChanges.filter((entry) => entry.newLevel > entry.oldLevel);
      const summary = `XP ganador: +${PVP_XP_WIN} por Pokemon (${winnerXpChanges.length} miembros).`;
      battle.log.push(summary);
      if (levelUps.length) {
        const line = levelUps
          .slice(0, 2)
          .map((entry) => `${entry.displayName} ${entry.oldLevel}->${entry.newLevel}`)
          .join(' | ');
        battle.log.push(`Subidas de nivel (${winner.username}): ${line}${levelUps.length > 2 ? ' ...' : ''}`);
      }
    }
    if (loserXpChanges.length) {
      const levelUps = loserXpChanges.filter((entry) => entry.newLevel > entry.oldLevel);
      const summary = `XP rival: +${PVP_XP_LOSS} por Pokemon (${loserXpChanges.length} miembros).`;
      battle.log.push(summary);
      if (levelUps.length) {
        const line = levelUps
          .slice(0, 2)
          .map((entry) => `${entry.displayName} ${entry.oldLevel}->${entry.newLevel}`)
          .join(' | ');
        battle.log.push(`Subidas de nivel (${loser.username}): ${line}${levelUps.length > 2 ? ' ...' : ''}`);
      }
    }
    battle.log = battle.log.slice(-LOG_LIMIT);
  }

  async handleMoveInteraction(interaction) {
    const parts = interaction.customId.split(':');
    if (parts.length !== 4) {
      await interaction.reply({ content: 'Accion invalida.', ephemeral: true });
      return;
    }

    const [, battleId, targetUserId, moveIndexRaw] = parts;
    const battle = this.battles.get(battleId);
    if (!battle) {
      await interaction.reply({ content: 'Este combate ya termino o no existe.', ephemeral: true });
      return;
    }

    if (interaction.guildId !== battle.guildId || interaction.channelId !== battle.channelId) {
      await interaction.reply({ content: 'Este boton no pertenece a este canal.', ephemeral: true });
      return;
    }

    if (interaction.user.id !== targetUserId) {
      await interaction.reply({ content: 'Solo el jugador asignado puede usar este boton.', ephemeral: true });
      return;
    }

    if (battle.winnerUserId) {
      await interaction.reply({ content: 'El combate ya finalizo.', ephemeral: true });
      return;
    }

    if (battle.processing) {
      await interaction.reply({ content: 'El turno se esta resolviendo, espera un momento.', ephemeral: true });
      return;
    }

    const player = battle.players.find((item) => item.userId === targetUserId);
    if (!player) {
      await interaction.reply({ content: 'Jugador no encontrado en este combate.', ephemeral: true });
      return;
    }

    const active = this.getActivePokemon(player);
    if (!active || active.currentHp <= 0) {
      await interaction.reply({ content: 'Tu Pokemon activo esta debilitado.', ephemeral: true });
      return;
    }

    const moveIndex = Number(moveIndexRaw);
    if (!Number.isInteger(moveIndex) || moveIndex < 0 || moveIndex >= active.moves.length) {
      await interaction.reply({ content: 'Movimiento invalido.', ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    player.selectedMoveIndex = moveIndex;

    const allReady = battle.players.every((item) => Number.isInteger(item.selectedMoveIndex));
    if (!allReady) {
      await interaction.message.edit(this.buildBattlePayload(battle));
      return;
    }

    battle.processing = true;
    try {
      this.executeTurn(battle);
      if (battle.winnerUserId) {
        await this.finalizeBattle(battle);
        await interaction.message.edit(this.buildBattlePayload(battle, { ended: true }));
        this.battles.delete(battle.id);
        return;
      }
      await interaction.message.edit(this.buildBattlePayload(battle));
    } finally {
      battle.processing = false;
    }
  }
}

module.exports = {
  PokemonMiniGame,
  classifyRarity,
  buildBattleStats,
  calculateDamage,
};
