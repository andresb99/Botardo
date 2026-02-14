function parseBoolean(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function parseJsonSafely(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

class FirestorePokemonStore {
  constructor({ db, rootCollection = 'pokemonGuilds' }) {
    this.db = db;
    this.rootCollection = rootCollection;
  }

  playerDoc(guildId, userId) {
    return this.db
      .collection(this.rootCollection)
      .doc(String(guildId))
      .collection('players')
      .doc(String(userId));
  }

  pokemonCollection(guildId, userId) {
    return this.playerDoc(guildId, userId).collection('pokemon');
  }

  async loadPlayer(guildId, userId) {
    const playerRef = this.playerDoc(guildId, userId);
    const playerSnap = await playerRef.get();
    if (!playerSnap.exists) return null;

    let pokemonSnap;
    try {
      pokemonSnap = await this.pokemonCollection(guildId, userId).orderBy('capturedAt', 'asc').get();
    } catch {
      pokemonSnap = await this.pokemonCollection(guildId, userId).get();
    }

    const collection = pokemonSnap.docs.map((doc) => doc.data());
    collection.sort((left, right) => (Number(left?.capturedAt || 0) - Number(right?.capturedAt || 0)));

    return {
      profile: playerSnap.data() || {},
      collection,
    };
  }

  async saveProfile(guildId, userId, profile) {
    const payload = {
      ...profile,
      updatedAt: Date.now(),
    };
    await this.playerDoc(guildId, userId).set(payload, { merge: true });
  }

  async savePokemon(guildId, userId, pokemon) {
    const instanceId = String(pokemon.instanceId || '').trim();
    if (!instanceId) return;
    await this.pokemonCollection(guildId, userId).doc(instanceId).set(pokemon, { merge: true });
  }

  async savePokemons(guildId, userId, pokemons) {
    const normalized = (pokemons || [])
      .map((pokemon) => ({ ...pokemon, instanceId: String(pokemon?.instanceId || '').trim() }))
      .filter((pokemon) => pokemon.instanceId);
    if (!normalized.length) return;

    const batch = this.db.batch();
    for (const pokemon of normalized) {
      const docRef = this.pokemonCollection(guildId, userId).doc(pokemon.instanceId);
      batch.set(docRef, pokemon, { merge: true });
    }
    await batch.commit();
  }
}

function createFirestorePokemonStoreFromEnv(options = {}) {
  const logger = options.logger || console;
  const rootCollection = process.env.FIREBASE_POKEMON_COLLECTION || 'pokemonGuilds';
  const enabledFlag = parseBoolean(process.env.POKEMON_USE_FIREBASE);

  const hasFirestoreConfig = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
      || process.env.GOOGLE_APPLICATION_CREDENTIALS
  );

  if (enabledFlag === false) {
    return null;
  }
  if (enabledFlag !== true && !hasFirestoreConfig) {
    return null;
  }

  let admin;
  try {
    admin = require('firebase-admin');
  } catch (error) {
    logger.warn('[Pokemon] Firebase no instalado. Ejecuta `npm install firebase-admin` para persistencia.');
    return null;
  }

  const jsonFromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const jsonFromBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
    ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    : null;
  const serviceAccount = jsonFromEnv
    ? parseJsonSafely(jsonFromEnv)
    : jsonFromBase64
      ? parseJsonSafely(jsonFromBase64)
      : null;

  const appName = 'pokemon-mini-game-store';
  let app = admin.apps.find((item) => item.name === appName);
  if (!app) {
    const config = {};
    if (serviceAccount) {
      config.credential = admin.credential.cert(serviceAccount);
    } else {
      config.credential = admin.credential.applicationDefault();
    }
    if (process.env.FIREBASE_DATABASE_URL) {
      config.databaseURL = process.env.FIREBASE_DATABASE_URL;
    }
    app = admin.initializeApp(config, appName);
  }

  const db = admin.firestore(app);
  logger.log(`[Pokemon] Firestore activo. Coleccion raiz: ${rootCollection}`);
  return new FirestorePokemonStore({ db, rootCollection });
}

module.exports = {
  FirestorePokemonStore,
  createFirestorePokemonStoreFromEnv,
};
