const MODULE_ID = "diner-manager";
const SETTING_DB = "db";
const SETTING_MEAL_LEDGER = "mealLedger";
const MODULE_VERSION = "1.1.3";
const DB_VERSION = 5;
const MEAL_LEDGER_VERSION = 1;
const THEME_2077 = "#00FFF7";
const THEME_2045 = "#E64539";
const DEFAULT_ACCENT = THEME_2077;
const HOVER_ACCENT = "#FFDD00";
const DEFAULT_DINER_ICON = "systems/cyberpunk-red-core/icons/compendium/cargo-containers-and-cube-hotels/koff-popper.svg";
const DEFAULT_AUTO_TILE_KEYWORDS = "diner,restaurant,cafe,coffee,food truck,food stand,vendor";
const DEFAULT_COVERED_ORDERS_PER_DAY = 3;
const SOCKET_NAME = `module.${MODULE_ID}`;

const FOOD_TIERS = [
  {
    id: "none",
    label: "No Paid Food Lifestyle",
    rank: 0,
    monthly: 0,
    aliases: []
  },
  {
    id: "kibble",
    label: "Kibble",
    rank: 1,
    monthly: 100,
    aliases: ["kibble"]
  },
  {
    id: "generic-prepak",
    label: "Generic Prepak",
    rank: 2,
    monthly: 300,
    aliases: ["generic prepak", "generic pre-pack", "generic prepack"]
  },
  {
    id: "good-prepak",
    label: "Good Prepak",
    rank: 3,
    monthly: 600,
    aliases: ["good prepak", "good pre-pack", "good prepack"]
  },
  {
    id: "fresh-food",
    label: "Fresh Food",
    rank: 4,
    monthly: 1500,
    aliases: ["fresh food"]
  }
];

const HOUSING_PATTERNS = [
  "living on the street",
  "living in a vehicle",
  "cube hotel",
  "cargo container",
  "studio apartment",
  "two-bedroom apartment",
  "two bedroom apartment",
  "upscale conapt",
  "corporate conapt",
  "beaverville house",
  "beaverville mcmansion",
  "luxury penthouse"
];

const processedRequests = new Set();
const pendingRequests = new Map();
const actorOrderQueues = new Map();
let mealLedgerQueue = Promise.resolve();
let itemSuggestionCache = null;
let tableSuggestionCache = null;

function makeId(length = 16) {
  return foundry.utils.randomID(length);
}

function duplicate(value) {
  return foundry.utils.deepClone(value);
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value = "") {
  return normalize(value).replaceAll(" ", "-").replace(/^-+|-+$/g, "") || makeId();
}

function tierById(id) {
  return FOOD_TIERS.find((tier) => tier.id === id) ?? FOOD_TIERS[0];
}

function defaultCategory(label = "Kibble & Street Eats", requiredTier = "kibble") {
  return {
    id: makeId(),
    label,
    ruleType: "foodTier",
    requiredTier,
    minMonthly: tierById(requiredTier).monthly,
    tableRef: "",
    draws: 4
  };
}

function defaultDiner() {
  const id = makeId();
  return {
    id,
    name: "New Diner",
    subtitle: "Hot food. Questionable decisions.",
    img: DEFAULT_DINER_ICON,
    sceneOnly: false,
    sceneId: null,
    sceneName: "",
    deliveryMode: "inventory",
    publicChat: true,
    tileUuids: [],
    categories: [
      defaultCategory("Kibble & Street Eats", "kibble"),
      defaultCategory("Generic Prepak Meals", "generic-prepak"),
      defaultCategory("Good Prepak Meals", "good-prepak"),
      defaultCategory("Fresh Food", "fresh-food")
    ],
    items: []
  };
}

function defaultDB() {
  return {
    _ver: DB_VERSION,
    era2045: false,
    defaults: {
      packKey: "",
      publicChat: true,
      deliveryMode: "inventory",
      coveredOrdersPerDay: DEFAULT_COVERED_ORDERS_PER_DAY,
      coveredOrderScope: "global",
      coveredLimitAction: "block",
      requireConsumedCoveredServing: true,
      autoTiles: false,
      autoTileKeywords: DEFAULT_AUTO_TILE_KEYWORDS,
      autoTileTemplateId: ""
    },
    diners: {}
  };
}

function themeAccent(db) {
  return db?.era2045 ? THEME_2045 : THEME_2077;
}

function themeLabel(db) {
  return db?.era2045 ? "2045 Red" : "2077 Cyan";
}

function migrateDB(value) {
  const db = value && typeof value === "object" ? duplicate(value) : defaultDB();
  const previousVersion = Number(db._ver ?? 0);
  db.defaults ??= defaultDB().defaults;
  db.diners ??= {};

  if (previousVersion < 2) {
    if (!db.defaults.accent || String(db.defaults.accent).toUpperCase() === "#FFDD00") {
      db.defaults.accent = DEFAULT_ACCENT;
    }
  }

  if (previousVersion < 3) {
    db.era2045 = String(db.defaults?.accent ?? "").toUpperCase() === THEME_2045;
  }

  db.era2045 = Boolean(db.era2045);
  db.defaults.packKey ??= "";
  db.defaults.publicChat ??= true;
  db.defaults.deliveryMode ??= "inventory";
  db.defaults.coveredOrdersPerDay = Math.max(0, Number(db.defaults.coveredOrdersPerDay ?? DEFAULT_COVERED_ORDERS_PER_DAY) || 0);
  db.defaults.coveredOrderScope = db.defaults.coveredOrderScope === "diner" ? "diner" : "global";
  db.defaults.coveredLimitAction = db.defaults.coveredLimitAction === "charge" ? "charge" : "block";
  db.defaults.requireConsumedCoveredServing = db.defaults.requireConsumedCoveredServing !== false;
  db.defaults.autoTiles = Boolean(db.defaults.autoTiles);
  db.defaults.autoTileKeywords = String(db.defaults.autoTileKeywords || DEFAULT_AUTO_TILE_KEYWORDS);
  db.defaults.autoTileTemplateId = String(db.defaults.autoTileTemplateId || "");
  if (db.defaults.autoTileTemplateId && !db.diners[db.defaults.autoTileTemplateId]) db.defaults.autoTileTemplateId = "";
  for (const diner of Object.values(db.diners)) {
    diner.categories ??= [defaultCategory()];
    diner.items ??= [];
    diner.sceneOnly ??= false;
    diner.deliveryMode ??= "inventory";
    diner.publicChat ??= true;
    if (!diner.img || diner.img === "icons/consumables/food/bowl-stew-brown.webp") diner.img = DEFAULT_DINER_ICON;
    diner.tileUuids = Array.isArray(diner.tileUuids) ? [...new Set(diner.tileUuids.filter(Boolean).map(String))] : (diner.tileUuid ? [String(diner.tileUuid)] : []);
    delete diner.tileUuid;
    for (const category of diner.categories) {
      category.id ??= makeId();
      category.label ??= "Menu";
      category.ruleType ??= "foodTier";
      category.requiredTier ??= "kibble";
      category.minMonthly ??= tierById(category.requiredTier).monthly;
      category.tableRef ??= "";
      category.draws = Math.max(0, Number(category.draws ?? 0));
    }
  }
  db._ver = DB_VERSION;
  return db;
}

async function loadDB() {
  return migrateDB(game.settings.get(MODULE_ID, SETTING_DB));
}

async function saveDB(db) {
  db._ver = DB_VERSION;
  return game.settings.set(MODULE_ID, SETTING_DB, duplicate(db));
}

function defaultMealLedger() {
  return {
    _ver: MEAL_LEDGER_VERSION,
    actors: {}
  };
}

function loadMealLedger() {
  const raw = game.settings.get(MODULE_ID, SETTING_MEAL_LEDGER);
  const ledger = raw && typeof raw === "object" ? duplicate(raw) : defaultMealLedger();
  ledger._ver = MEAL_LEDGER_VERSION;
  ledger.actors ??= {};
  return ledger;
}

async function saveMealLedger(ledger) {
  ledger._ver = MEAL_LEDGER_VERSION;
  return game.settings.set(MODULE_ID, SETTING_MEAL_LEDGER, duplicate(ledger));
}

function withMealLedgerLock(task) {
  const run = mealLedgerQueue.catch(() => undefined).then(task);
  mealLedgerQueue = run.then(() => undefined, () => undefined);
  return run;
}

function getActorFromContext() {
  return canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
}

function getItemMarketValue(item) {
  const value = item?.system?.price?.market ?? item?.system?.price ?? 0;
  return Math.max(0, Number(value) || 0);
}

function parseMonthlyAmount(name = "") {
  const compact = String(name).replaceAll(",", "");
  const match = compact.match(/(\d+)\s*eb\s*\/\s*month/i);
  return match ? Math.max(0, Number(match[1]) || 0) : null;
}

function isHousingItem(item) {
  const name = normalize(item?.name);
  return HOUSING_PATTERNS.some((pattern) => name.includes(normalize(pattern)));
}

function itemFoodTier(item) {
  const explicit = item?.flags?.[MODULE_ID]?.foodTier;
  if (explicit && tierById(explicit).id === explicit) return tierById(explicit);

  const name = normalize(item?.name);
  let best = FOOD_TIERS[0];
  for (const tier of FOOD_TIERS) {
    if (tier.rank <= best.rank) continue;
    if (tier.aliases.some((alias) => name.includes(normalize(alias)))) best = tier;
  }
  return best;
}

function isActiveLifestyleGear(item) {
  if (String(item?.type ?? "").toLowerCase() !== "gear") return false;
  const state = normalize(item?.system?.equipped ?? "");
  return state === "equipped" || state === "carried";
}

function inspectLifestyle(actor) {
  if (!actor) {
    return {
      foodTier: FOOD_TIERS[0],
      foodSource: "No actor",
      housingName: "None detected",
      housingMonthly: 0,
      totalMonthly: 0,
      monthlyItems: [],
      warnings: []
    };
  }

  const override = actor.getFlag?.(MODULE_ID, "foodTier") ?? actor.flags?.[MODULE_ID]?.foodTier;
  const foodMatches = [];
  const housingMatches = [];

  for (const item of actor.items ?? []) {
    if (!isActiveLifestyleGear(item)) continue;

    const detectedFood = itemFoodTier(item);
    const housing = isHousingItem(item);
    const parsedMonthly = parseMonthlyAmount(item.name);

    if (detectedFood.rank > 0) {
      const marketValue = getItemMarketValue(item);
      foodMatches.push({
        item,
        tier: detectedFood,
        amount: parsedMonthly ?? (marketValue > 0 ? marketValue : detectedFood.monthly)
      });
    }

    if (housing) {
      housingMatches.push({
        item,
        amount: parsedMonthly ?? getItemMarketValue(item)
      });
    }
  }

  foodMatches.sort((a, b) => b.tier.rank - a.tier.rank || b.amount - a.amount);
  housingMatches.sort((a, b) => b.amount - a.amount);

  const selectedFood = foodMatches[0] ?? null;
  const selectedHousing = housingMatches[0] ?? null;
  const foodTier = override ? tierById(override) : (selectedFood?.tier ?? FOOD_TIERS[0]);
  const foodSource = override ? "GM override" : (selectedFood?.item?.name ?? "No paid food plan detected");
  const housingName = selectedHousing?.item?.name ?? "None detected";
  const housingMonthly = Math.max(0, Number(selectedHousing?.amount ?? 0) || 0);
  const foodMonthly = Math.max(0, Number(selectedFood?.amount ?? foodTier.monthly ?? 0) || 0);

  const monthlyItems = [];
  if (selectedFood) monthlyItems.push({ name: selectedFood.item.name, amount: foodMonthly, kind: "food" });
  if (selectedHousing) monthlyItems.push({ name: selectedHousing.item.name, amount: housingMonthly, kind: "housing" });

  const warnings = [];
  if (foodMatches.length > 1) warnings.push(`Multiple active food lifestyle Items detected; using ${selectedFood.item.name}.`);
  if (housingMatches.length > 1) warnings.push(`Multiple active housing Items detected; using ${selectedHousing.item.name}.`);

  return {
    foodTier,
    foodSource,
    housingName,
    housingMonthly,
    totalMonthly: foodMonthly + housingMonthly,
    monthlyItems,
    warnings
  };
}

function categoryCoverage(category, lifestyle) {
  const ruleType = category?.ruleType ?? "foodTier";

  if (ruleType === "alwaysIncluded") {
    return { covered: true, reason: "Included by vendor" };
  }
  if (ruleType === "alwaysPay") {
    return { covered: false, reason: "Always pay" };
  }
  if (ruleType === "monthlyBudget") {
    const minimum = Math.max(0, Number(category.minMonthly) || 0);
    return {
      covered: lifestyle.totalMonthly >= minimum,
      reason: `Monthly lifestyle budget ${lifestyle.totalMonthly} / ${minimum} eb`
    };
  }

  const required = tierById(category.requiredTier);
  return {
    covered: lifestyle.foodTier.rank >= required.rank,
    reason: `${required.label} lifestyle required`
  };
}

function categoryUsesCoveredAllowance(category) {
  const ruleType = category?.ruleType ?? "foodTier";
  return ruleType === "foodTier" || ruleType === "monthlyBudget";
}

function currentWorldDayKey() {
  try {
    const current = globalThis.SimpleCalendar?.api?.getCurrentDate?.();
    const year = Number(current?.year);
    const month = Number(current?.month);
    const day = Number(current?.day);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return `simple-calendar:${year}:${month}:${day}`;
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | Simple Calendar date lookup failed; using Foundry world time.`, error);
  }

  const worldTime = Math.floor(Number(game.time?.worldTime ?? 0));
  return `world-time:${Math.floor(worldTime / 86400)}`;
}

function coveredOrderConfig(db) {
  const defaults = db?.defaults ?? {};
  return {
    limit: Math.max(0, Math.floor(Number(defaults.coveredOrdersPerDay ?? DEFAULT_COVERED_ORDERS_PER_DAY) || 0)),
    scope: defaults.coveredOrderScope === "diner" ? "diner" : "global",
    action: defaults.coveredLimitAction === "charge" ? "charge" : "block",
    requireConsumedServing: defaults.requireConsumedCoveredServing !== false
  };
}

function coveredOrderScopeKey(config, dinerId) {
  return config.scope === "diner" ? `diner:${dinerId}` : "global";
}

function actorLedgerKey(actor) {
  return String(actor?.uuid ?? actor?.id ?? "unknown-actor");
}

function inspectCoveredAllowance(db, actor, dinerId, ledger = null) {
  const config = coveredOrderConfig(db);
  const dayKey = currentWorldDayKey();
  const scopeKey = coveredOrderScopeKey(config, dinerId);
  ledger ??= loadMealLedger();
  const actorRecord = ledger.actors?.[actorLedgerKey(actor)] ?? {};
  const record = actorRecord?.[scopeKey];
  const used = record?.dayKey === dayKey ? Math.max(0, Number(record.count) || 0) : 0;
  const remaining = config.limit <= 0 ? Infinity : Math.max(0, config.limit - used);
  return { ...config, dayKey, scopeKey, used, remaining, unlimited: config.limit <= 0 };
}

function getServingAmount(item) {
  const system = item?.system ?? {};
  const candidates = [
    system.amount,
    system.quantity,
    system.uses?.value,
    system.charges?.value
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const amount = Number(candidate);
    if (Number.isFinite(amount)) return Math.max(0, amount);
  }
  return null;
}

function isOutstandingCoveredServing(item) {
  if (item?.flags?.[MODULE_ID]?.coveredServing !== true) return false;

  // CPR Drug Items can remain embedded at 0/0 while their Active Effects stay
  // visible for roleplay. Once the consumable amount reaches zero, the serving
  // has been used and must no longer hold the Diner order lock.
  if (normalize(item?.type) === "drug") {
    const amount = getServingAmount(item);
    if (amount !== null) return amount > 0;
  }

  // Non-Drug deliveries and unusual Drug documents without a readable amount
  // remain conservative: their explicit covered-serving flag still holds lock.
  return true;
}

function findOutstandingCoveredServing(actor) {
  return actor?.items?.find?.((item) => isOutstandingCoveredServing(item)) ?? null;
}

async function authorizeOrder(db, diner, category, item, lifestyle, actor) {
  return withMealLedgerLock(async () => {
    const ledger = loadMealLedger();
    const state = resolveOrderState(db, diner, category, item, lifestyle, actor, ledger);
    if (state.blocked) {
      throw new Error(`Covered meal allowance exhausted for today (${state.allowance.limit} per day).`);
    }

    let reservation = null;
    let finalAllowance = state.allowance;
    if (state.covered && state.applies && !state.allowance.unlimited) {
      const actorKey = actorLedgerKey(actor);
      ledger.actors[actorKey] ??= {};
      ledger.actors[actorKey][state.allowance.scopeKey] = {
        dayKey: state.allowance.dayKey,
        count: state.allowance.used + 1,
        updatedAt: Number(game.time?.worldTime ?? 0)
      };
      await saveMealLedger(ledger);
      finalAllowance = {
        ...state.allowance,
        used: state.allowance.used + 1,
        remaining: Math.max(0, state.allowance.remaining - 1)
      };
      reservation = {
        actorKey,
        scopeKey: state.allowance.scopeKey,
        dayKey: state.allowance.dayKey
      };
    }

    return { state, finalAllowance, reservation };
  });
}

async function rollbackCoveredReservation(reservation) {
  if (!reservation) return;
  await withMealLedgerLock(async () => {
    const ledger = loadMealLedger();
    const record = ledger.actors?.[reservation.actorKey]?.[reservation.scopeKey];
    if (!record || record.dayKey !== reservation.dayKey) return;
    record.count = Math.max(0, Number(record.count || 0) - 1);
    if (record.count <= 0) delete ledger.actors[reservation.actorKey][reservation.scopeKey];
    if (!Object.keys(ledger.actors[reservation.actorKey] ?? {}).length) delete ledger.actors[reservation.actorKey];
    await saveMealLedger(ledger);
  });
}

async function resetCoveredOrders(actor) {
  if (!actor) return;
  await withMealLedgerLock(async () => {
    const ledger = loadMealLedger();
    delete ledger.actors[actorLedgerKey(actor)];
    await saveMealLedger(ledger);
  });
  try {
    await actor.unsetFlag(MODULE_ID, "coveredOrders");
  } catch {}
}

async function clearCoveredServingLocks(actor) {
  const lockedItems = actor?.items?.filter?.((item) => item.flags?.[MODULE_ID]?.coveredServing === true) ?? [];
  for (const item of lockedItems) {
    await item.unsetFlag(MODULE_ID, "coveredServing");
  }
  return lockedItems.length;
}

function resolveOrderState(db, diner, category, item, lifestyle, actor, ledger = null) {
  const baseCoverage = categoryCoverage(category, lifestyle);
  const allowance = inspectCoveredAllowance(db, actor, diner.id, ledger);
  const applies = baseCoverage.covered && categoryUsesCoveredAllowance(category);
  const exhausted = applies && !allowance.unlimited && allowance.remaining <= 0;
  const normalPrice = Math.max(0, Number(item?.price) || 0);

  if (exhausted && allowance.action === "block") {
    return { baseCoverage, allowance, applies, exhausted, covered: false, blocked: true, cost: 0 };
  }

  if (exhausted && allowance.action === "charge") {
    if (normalPrice <= 0) {
      return { baseCoverage, allowance, applies, exhausted, covered: false, blocked: true, cost: 0 };
    }
    return { baseCoverage, allowance, applies, exhausted, covered: false, blocked: false, cost: normalPrice };
  }

  return {
    baseCoverage,
    allowance,
    applies,
    exhausted: false,
    covered: baseCoverage.covered,
    blocked: false,
    cost: baseCoverage.covered ? 0 : normalPrice
  };
}

async function queueActorOrder(actorUuid, task) {
  const previous = actorOrderQueues.get(actorUuid) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  actorOrderQueues.set(actorUuid, current);
  try {
    return await current;
  } finally {
    if (actorOrderQueues.get(actorUuid) === current) actorOrderQueues.delete(actorUuid);
  }
}

async function adjustWealth(actor, delta, reason = "Diner Transaction") {
  const wealth = duplicate(actor.system?.wealth ?? {});
  const before = Number(wealth.value ?? 0);
  wealth.value = before + Number(delta || 0);
  wealth.transactions ??= [];
  const direction = delta >= 0 ? "Increased" : "Decreased";
  wealth.transactions.push([`${direction} by ${Math.abs(Number(delta || 0))} to ${wealth.value}`, reason]);
  return actor.update({ "system.wealth": wealth });
}

async function giveItem(actor, itemDoc, orderMetadata = {}) {
  const data = itemDoc.toObject();
  delete data._id;
  data.flags ??= {};
  data.flags[MODULE_ID] = {
    ...(data.flags[MODULE_ID] ?? {}),
    deliveredByDiner: true,
    sourceUuid: itemDoc.uuid,
    ...orderMetadata
  };
  const created = await actor.createEmbeddedDocuments("Item", [data]);
  const embedded = created?.[0] ?? null;
  // Re-point copied Active Effects at the new embedded Item. This preserves CPR
  // Drug effects while avoiding stale origins back to the world/compendium source.
  if (embedded?.effects?.size) {
    const updates = [...embedded.effects].map(effect => ({ _id: effect.id, origin: embedded.uuid }));
    if (updates.length) {
      try { await embedded.updateEmbeddedDocuments("ActiveEffect", updates); }
      catch (error) { console.warn(`${MODULE_ID} | Could not refresh copied Active Effect origins`, error); }
    }
  }
  return created;
}

async function resolveItem(uuid) {
  if (!uuid) return null;
  try {
    return await fromUuid(uuid);
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to resolve item`, uuid, error);
    return null;
  }
}


async function getOrCreateMenuItemFolder() {
  let folder = game.folders?.find?.(candidate => candidate.type === "Item" && candidate.name === "Diner™ Menu Items") ?? null;
  if (!folder) folder = await Folder.create({ name: "Diner™ Menu Items", type: "Item", sorting: "a" });
  return folder;
}

function buildDinerCreatedItemData(values = {}) {
  const itemType = values.type === "gear" ? "gear" : "drug";
  const amount = Math.max(0, Math.floor(Number(values.amount ?? 1) || 0));
  const price = Math.max(0, Math.floor(Number(values.price ?? 0) || 0));
  const base = {
    name: String(values.name || "Diner Menu Item").trim() || "Diner Menu Item",
    type: itemType,
    img: String(values.img || DEFAULT_DINER_ICON).trim() || DEFAULT_DINER_ICON,
    system: {
      description: { value: String(values.description || "") },
      favorite: false,
      source: { page: 0, book: "HB" },
      revealed: true,
      usage: String(values.usage || "toggled"),
      equipped: "owned",
      concealable: { concealable: itemType === "drug", isConcealed: false },
      amount,
      price: { market: price },
      brand: String(values.brand || "Various").trim() || "Various"
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        createdByDinerManager: true,
        createdItemType: itemType
      }
    }
  };

  if (itemType === "drug") {
    base.system.consumed = String(values.consumed || "None").trim() || "None";
  } else {
    base.system.isElectronic = false;
    base.system.providesHardening = false;
    base.system.installedItems = {
      allowedTypes: ["itemUpgrade"],
      allowed: true,
      list: [],
      usedSlots: 0,
      slots: 0
    };
  }
  return base;
}

async function createWorldMenuItem(values = {}) {
  if (!game.user?.isGM) throw new Error("Only a GM can create Diner menu Items.");
  const folder = await getOrCreateMenuItemFolder();
  const data = buildDinerCreatedItemData(values);
  const effectTemplateKeys = values.type === "gear" ? [] : [...new Set(values.effectTemplateKeys ?? [])].filter(Boolean);
  const effectCopies = [];
  const copiedNames = new Set();

  for (const key of effectTemplateKeys) {
    const resolved = await resolveActiveEffectTemplate(key);
    if (!resolved) continue;
    const effectName = String(resolved.effect.name || "").trim();
    if (!effectName || copiedNames.has(normalize(effectName))) continue;
    copiedNames.add(normalize(effectName));
    effectCopies.push({ key, effectName, sourceItemName: resolved.item.name, effect: resolved.effect });
  }

  if (data.type === "drug") {
    const requestedConsumedKey = String(values.consumedEffectKey || "");
    const consumedCopy = effectCopies.find(entry => entry.key === requestedConsumedKey) ?? null;
    data.system.consumed = consumedCopy?.effectName || "None";
    data.flags[MODULE_ID].copiedEffectTemplates = effectCopies.map(entry => ({
      sourceKey: entry.key,
      sourceItemName: entry.sourceItemName,
      effectName: entry.effectName
    }));
  }

  const item = await Item.create({ ...data, effects: [], folder: folder?.id ?? null });
  if (item?.type === "drug" && effectCopies.length) {
    const effectData = effectCopies.map(entry => activeEffectCopyData(entry.effect, item.uuid));
    await item.createEmbeddedDocuments("ActiveEffect", effectData);
  }
  itemSuggestionCache = null;
  return item;
}

function localFoundryAssetPath(value = "") {
  const path = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!path) return DEFAULT_DINER_ICON;
  if (/^(?:https?:|data:|javascript:|file:|blob:)/i.test(path) || path.includes("://")) {
    throw new Error("Choose an image from Foundry's file picker. External or browser URLs are not accepted here.");
  }
  if (path.split("/").includes("..")) throw new Error("Parent-directory paths are not allowed for Diner images.");
  return path;
}

function dinerCustomSelectMarkup(inputClass, options = [], selectedValue = "", extraClass = "") {
  const normalized = options.length ? options : [{ value: "", label: "None" }];
  const selected = normalized.find(option => String(option.value) === String(selectedValue)) ?? normalized[0];
  return `
    <div class="diner-custom-select ${esc(extraClass)}" data-diner-custom-select>
      <input type="hidden" class="${esc(inputClass)}" value="${esc(selected.value)}">
      <button type="button" class="diner-select-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="diner-select-trigger-label">${esc(selected.label)}</span>
        <i class="fas fa-chevron-down" aria-hidden="true"></i>
      </button>
      <div class="diner-select-menu" role="listbox">
        ${normalized.map(option => `
          <button type="button" class="diner-select-option ${String(option.value) === String(selected.value) ? "is-selected" : ""}" data-value="${esc(option.value)}" role="option" aria-selected="${String(option.value) === String(selected.value) ? "true" : "false"}">${esc(option.label)}</button>
        `).join("")}
      </div>
    </div>`;
}

function activateDinerCustomSelects(root) {
  if (!root) return;
  const selects = [...root.querySelectorAll("[data-diner-custom-select]")];
  const closeAll = except => {
    for (const select of selects) {
      if (select === except) continue;
      select.classList.remove("is-open");
      select.querySelector(".diner-select-trigger")?.setAttribute("aria-expanded", "false");
    }
  };

  for (const select of selects) {
    const input = select.querySelector('input[type="hidden"]');
    const trigger = select.querySelector(".diner-select-trigger");
    const label = select.querySelector(".diner-select-trigger-label");
    const options = [...select.querySelectorAll(".diner-select-option")];
    trigger?.addEventListener("click", event => {
      event.preventDefault();
      const opening = !select.classList.contains("is-open");
      closeAll(opening ? select : null);
      select.classList.toggle("is-open", opening);
      trigger.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    for (const option of options) {
      option.addEventListener("click", event => {
        event.preventDefault();
        const value = option.dataset.value ?? "";
        input.value = value;
        label.textContent = option.textContent.trim();
        for (const candidate of options) {
          const active = candidate === option;
          candidate.classList.toggle("is-selected", active);
          candidate.setAttribute("aria-selected", active ? "true" : "false");
        }
        select.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  }

  root.addEventListener("click", event => {
    if (!event.target.closest("[data-diner-custom-select]")) closeAll();
  });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") closeAll();
  });
}

async function collectActiveEffectTemplates(diner = null) {
  const templates = new Map();
  const inspect = item => {
    if (!item || item.type !== "drug") return;
    for (const effect of item.effects ?? []) {
      const effectName = String(effect?.name ?? "").trim();
      if (!effectName || !item.uuid || !effect?.id) continue;
      const key = `${item.uuid}#${effect.id}`;
      if (templates.has(key)) continue;
      templates.set(key, {
        key,
        itemUuid: item.uuid,
        itemName: String(item.name || "Drug Item"),
        effectId: effect.id,
        effectName,
        label: `${effectName} — ${item.name || "Drug Item"}`
      });
    }
  };

  for (const item of game.items ?? []) inspect(item);
  for (const entry of diner?.items ?? []) {
    try { inspect(await resolveItem(entry.uuid)); }
    catch (_) { /* Menu source may have been removed; ignore it here. */ }
  }

  return [...templates.values()].sort((a, b) =>
    a.effectName.localeCompare(b.effectName, undefined, { sensitivity: "base" })
    || a.itemName.localeCompare(b.itemName, undefined, { sensitivity: "base" })
  );
}

async function resolveActiveEffectTemplate(templateKey) {
  const raw = String(templateKey || "");
  const split = raw.lastIndexOf("#");
  if (split <= 0) return null;
  const itemUuid = raw.slice(0, split);
  const effectId = raw.slice(split + 1);
  const item = await resolveItem(itemUuid);
  if (!item || item.type !== "drug") return null;
  const effect = item.effects?.get?.(effectId) ?? [...(item.effects ?? [])].find(candidate => candidate.id === effectId);
  if (!effect) return null;
  return { item, effect };
}

function activeEffectCopyData(effect, origin) {
  const data = effect.toObject ? effect.toObject() : duplicate(effect);
  delete data._id;
  delete data._stats;
  data.origin = origin;
  return data;
}

function resolveFoundryFilePickerClass() {
  // Foundry V12 exposes FilePicker as a client-global lexical binding. Because this
  // module is loaded as an ES module, globalThis.FilePicker is not guaranteed to
  // contain that binding even though `FilePicker` itself is available.
  try {
    if (typeof FilePicker !== "undefined") return FilePicker;
  } catch (_) { /* Fall through to namespaced compatibility lookups. */ }

  return globalThis.FilePicker
    ?? globalThis.foundry?.applications?.apps?.FilePicker
    ?? globalThis.foundry?.applications?.apps?.FilePicker?.implementation
    ?? null;
}

async function browseForDinerImage(root) {
  const input = root?.querySelector(".diner-create-img");
  const preview = root?.querySelector(".diner-create-img-preview");
  if (!input) return;

  const Picker = resolveFoundryFilePickerClass();
  if (!Picker) {
    console.warn(`${MODULE_ID} | Could not resolve Foundry V12 FilePicker.`);
    return ui.notifications.warn("Foundry's image browser could not be opened in this client.");
  }

  const picker = new Picker({
    type: "image",
    current: input.value || DEFAULT_DINER_ICON,
    callback: path => {
      try {
        const safePath = localFoundryAssetPath(path);
        input.value = safePath;
        if (preview) preview.src = safePath;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (error) {
        ui.notifications.error(error.message);
      }
    }
  });

  // In Foundry V12, FilePicker#browse fetches directory data; Application#render
  // is what opens the actual picker window for the user.
  return picker.render(true);
}

async function openCreateMenuItem({ diner, db, categoryId = null, onCreated = null } = {}) {
  if (!game.user?.isGM) return;
  const selectedCategory = categoryId || diner?.categories?.[0]?.id || "";
  const categoryOptions = (diner?.categories ?? []).map(category => ({ value: category.id, label: category.label }));
  const effectTemplates = await collectActiveEffectTemplates(diner);
  const effectTemplateMap = new Map(effectTemplates.map(template => [template.key, template]));
  const effectOptions = [
    { value: "", label: effectTemplates.length ? "Choose an Active Effect…" : "No Active Effects discovered" },
    ...effectTemplates.map(template => ({ value: template.key, label: template.label }))
  ];
  const selectedEffectKeys = [];
  let consumedEffectKey = "";

  const content = `
    <div class="diner-shell diner-create-item-shell">
      <div class="diner-header diner-brand-header">
        <img class="diner-logo" src="${esc(DEFAULT_DINER_ICON)}">
        <div class="diner-brand-copy">
          <div class="diner-kicker">LOCAL MENU FABRICATOR</div>
          <div class="diner-title">Create Menu Item</div>
          <div class="diner-subtitle">Creates a real Cyberpunk RED world Item, then adds it to this Diner.</div>
        </div>
      </div>
      <div class="diner-section diner-create-item-section">
        <div class="diner-grid-2">
          <label>Name<input type="text" class="diner-create-name" value="New Meal"></label>
          <div class="diner-field">
            <div class="diner-field-label">Character-sheet Item type</div>
            ${dinerCustomSelectMarkup("diner-create-type", [
              { value: "drug", label: "Drug — consumable food/drink" },
              { value: "gear", label: "Gear — persistent inventory item" }
            ], "drug")}
          </div>
          <div class="diner-field">
            <div class="diner-field-label">Menu category</div>
            ${dinerCustomSelectMarkup("diner-create-category", categoryOptions, selectedCategory)}
          </div>
          <div class="diner-field">
            <div class="diner-field-label">Image</div>
            <div class="diner-image-picker-row">
              <img class="diner-create-img-preview" src="${esc(DEFAULT_DINER_ICON)}" alt="">
              <input type="text" class="diner-create-img" value="${esc(DEFAULT_DINER_ICON)}" spellcheck="false">
              <button type="button" class="diner-btn diner-image-browse" title="Browse Foundry image files"><i class="fas fa-folder-open"></i> Browse</button>
            </div>
          </div>
          <label>Price (eb)<input type="number" min="0" step="1" class="diner-create-price" value="5"></label>
          <label>Starting amount<input type="number" min="0" step="1" class="diner-create-amount" value="1"></label>
          <label>Brand<input type="text" class="diner-create-brand" value="Various"></label>
        </div>

        <div class="diner-effect-builder diner-create-effects-wrap">
          <div class="diner-toolbar diner-effect-toolbar">
            <div>
              <div class="diner-section-title">Active Effects</div>
              <div class="diner-muted">Choose an exact effect template by source Item. Add as many as this Drug needs, then mark which one CPR should use as the consumed effect.</div>
            </div>
          </div>
          <div class="diner-effect-add-row">
            ${dinerCustomSelectMarkup("diner-create-effect-template", effectOptions, "")}
            <button type="button" class="diner-btn" data-add-effect ${effectTemplates.length ? "" : "disabled"}><i class="fas fa-plus"></i> Add Effect</button>
          </div>
          <div class="diner-selected-effects" data-selected-effects></div>
        </div>

        <label>Description<textarea class="diner-create-description" placeholder="Menu description / roleplay text"></textarea></label>
        <div class="diner-note"><b>Drug</b> is recommended for food/drink that should use CPR's consumable workflow. <b>Gear</b> stays in inventory until removed. Usage is set internally to <b>toggled</b>. Active Effects are copied from the exact source Item you choose; Diner never guesses mechanics from an effect name alone.</div>
      </div>
    </div>`;

  return openDialog({
    title: "Diner™ — Create Menu Item",
    content,
    buttons: {
      create: {
        label: "Create & Add",
        callback: async html => {
          const root = html[0].querySelector(".diner-create-item-shell");
          let safeImage;
          try { safeImage = localFoundryAssetPath(root.querySelector(".diner-create-img").value); }
          catch (error) {
            ui.notifications.error(error.message);
            throw error;
          }
          const type = root.querySelector(".diner-create-type").value;
          const values = {
            name: root.querySelector(".diner-create-name").value,
            type,
            img: safeImage,
            price: root.querySelector(".diner-create-price").value,
            amount: root.querySelector(".diner-create-amount").value,
            brand: root.querySelector(".diner-create-brand").value,
            usage: "toggled",
            consumed: "None",
            consumedEffectKey: type === "drug" ? consumedEffectKey : "",
            effectTemplateKeys: type === "drug" ? [...selectedEffectKeys] : [],
            description: root.querySelector(".diner-create-description").value
          };
          const item = await createWorldMenuItem(values);
          if (diner) {
            diner.items ??= [];
            diner.items.push({
              id: makeId(),
              uuid: item.uuid,
              name: item.name,
              img: item.img,
              price: getItemMarketValue(item),
              itemType: item.type || values.type,
              categoryId: root.querySelector(".diner-create-category").value || diner.categories?.[0]?.id,
              generated: false
            });
            if (db) await saveDB(db);
          }
          const effectCount = item.effects?.size ?? item.effects?.length ?? 0;
          const suffix = effectCount ? ` with ${effectCount} Active Effect${effectCount === 1 ? "" : "s"}` : "";
          ui.notifications.info(`${item.name} created as CPR ${item.type}${suffix} and added to the menu.`);
          await onCreated?.(item);
        }
      },
      close: { label: "Close" }
    },
    render: html => {
      setDialogAccent(html[0].closest(".app"), themeAccent(db));
      const root = html[0].querySelector(".diner-create-item-shell");
      activateDinerCustomSelects(root);
      const type = root.querySelector(".diner-create-type");
      const effectsWrap = root.querySelector(".diner-create-effects-wrap");
      const effectSelect = root.querySelector(".diner-create-effect-template");
      const selectedEffectsEl = root.querySelector("[data-selected-effects]");
      const preview = root.querySelector(".diner-create-img-preview");
      const imageInput = root.querySelector(".diner-create-img");

      const refreshSelectedEffects = () => {
        if (!selectedEffectKeys.length) {
          selectedEffectsEl.innerHTML = `<div class="diner-muted diner-empty-effects">No Active Effects added. The Drug will use <b>Consumed: None</b>.</div>`;
          return;
        }
        selectedEffectsEl.innerHTML = selectedEffectKeys.map(key => {
          const template = effectTemplateMap.get(key);
          if (!template) return "";
          const consumed = consumedEffectKey === key;
          return `<div class="diner-effect-chip" data-effect-key="${esc(key)}">
            <div class="diner-effect-copy">
              <b>${esc(template.effectName)}</b>
              <span>${esc(template.itemName)}</span>
            </div>
            <div class="diner-effect-actions">
              <button type="button" class="diner-btn diner-effect-consumed ${consumed ? "is-consumed" : ""}" data-set-consumed="${esc(key)}" title="${consumed ? "This is the consumed effect" : "Use this as the consumed effect"}">
                <i class="fas ${consumed ? "fa-bolt" : "fa-circle"}"></i> ${consumed ? "Consumed" : "Set Consumed"}
              </button>
              <button type="button" class="diner-btn diner-icon-btn" data-remove-effect="${esc(key)}" title="Remove effect"><i class="fas fa-trash"></i></button>
            </div>
          </div>`;
        }).join("");
      };

      const refreshType = () => {
        const drug = type.value === "drug";
        effectsWrap.style.display = drug ? "block" : "none";
      };

      type.addEventListener("change", refreshType);
      root.querySelector(".diner-image-browse")?.addEventListener("click", event => {
        event.preventDefault();
        browseForDinerImage(root);
      });
      imageInput?.addEventListener("change", () => {
        try {
          const safePath = localFoundryAssetPath(imageInput.value);
          imageInput.value = safePath;
          if (preview) preview.src = safePath;
        } catch (error) {
          ui.notifications.error(error.message);
          imageInput.value = DEFAULT_DINER_ICON;
          if (preview) preview.src = DEFAULT_DINER_ICON;
        }
      });

      root.addEventListener("click", event => {
        if (event.target.closest("[data-add-effect]")) {
          event.preventDefault();
          const key = effectSelect.value;
          const template = effectTemplateMap.get(key);
          if (!template) return ui.notifications.warn("Choose an Active Effect first.");
          const sameNameKey = selectedEffectKeys.find(existingKey => normalize(effectTemplateMap.get(existingKey)?.effectName) === normalize(template.effectName));
          if (sameNameKey && sameNameKey !== key) {
            return ui.notifications.warn(`An effect named “${template.effectName}” is already attached. Remove it before choosing a different source with the same name.`);
          }
          if (!selectedEffectKeys.includes(key)) selectedEffectKeys.push(key);
          if (!consumedEffectKey) consumedEffectKey = key;
          refreshSelectedEffects();
          return;
        }

        const consumedKey = event.target.closest("[data-set-consumed]")?.dataset.setConsumed;
        if (consumedKey) {
          event.preventDefault();
          if (selectedEffectKeys.includes(consumedKey)) consumedEffectKey = consumedKey;
          refreshSelectedEffects();
          return;
        }

        const removeKey = event.target.closest("[data-remove-effect]")?.dataset.removeEffect;
        if (removeKey) {
          event.preventDefault();
          const index = selectedEffectKeys.indexOf(removeKey);
          if (index >= 0) selectedEffectKeys.splice(index, 1);
          if (consumedEffectKey === removeKey) consumedEffectKey = selectedEffectKeys[0] || "";
          refreshSelectedEffects();
        }
      });

      refreshSelectedEffects();
      refreshType();
    }
  }, { width: 820 });
}

async function findItemInPack(packKey, name) {
  const pack = game.packs.get(packKey);
  if (!pack || pack.documentName !== "Item") return null;
  const index = await pack.getIndex({ fields: ["name"] });
  const lower = name.toLowerCase();
  const hit = index.find((entry) => entry.name?.toLowerCase() === lower)
    ?? index.find((entry) => entry.name?.toLowerCase().includes(lower));
  return hit ? pack.getDocument(hit._id) : null;
}

async function findItemAnywhere(name, preferredPack = "") {
  if (!name) return null;
  if (preferredPack) {
    const preferred = await findItemInPack(preferredPack, name);
    if (preferred) return preferred;
  }

  const lower = name.toLowerCase();
  const world = game.items.getName(name)
    ?? game.items.find((item) => item.name?.toLowerCase().includes(lower));
  if (world) return world;

  for (const pack of game.packs.filter((candidate) => candidate.documentName === "Item")) {
    try {
      const index = await pack.getIndex({ fields: ["name"] });
      const hit = index.find((entry) => entry.name?.toLowerCase() === lower)
        ?? index.find((entry) => entry.name?.toLowerCase().includes(lower));
      if (hit) return pack.getDocument(hit._id);
    } catch (error) {
      console.warn(`${MODULE_ID} | Item index failed for ${pack.collection}`, error);
    }
  }
  return null;
}

async function buildItemSuggestions() {
  if (itemSuggestionCache) return itemSuggestionCache;
  const seen = new Set();
  const suggestions = [];

  for (const item of game.items) {
    const name = item.name?.trim();
    const key = name?.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(name);
  }

  for (const pack of game.packs.filter((candidate) => candidate.documentName === "Item")) {
    try {
      const index = await pack.getIndex({ fields: ["name"] });
      for (const entry of index) {
        const name = entry.name?.trim();
        const key = name?.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        suggestions.push(name);
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Item suggestions failed for ${pack.collection}`, error);
    }
  }

  itemSuggestionCache = suggestions.sort((a, b) => a.localeCompare(b));
  return itemSuggestionCache;
}

async function findRollTable(ref) {
  const trimmed = String(ref ?? "").trim();
  if (!trimmed) return null;

  try {
    const byUuid = await fromUuid(trimmed);
    if (byUuid?.documentName === "RollTable") return byUuid;
  } catch {}

  if (trimmed.includes("::")) {
    const [packKey, rawName] = trimmed.split("::");
    const pack = game.packs.get(packKey);
    if (pack?.documentName === "RollTable") {
      const index = await pack.getIndex({ fields: ["name"] });
      const target = String(rawName ?? "").trim().toLowerCase();
      const hit = index.find((entry) => entry._id === rawName)
        ?? index.find((entry) => entry.name?.toLowerCase() === target)
        ?? index.find((entry) => entry.name?.toLowerCase().includes(target));
      if (hit) return pack.getDocument(hit._id);
    }
  }

  const worldById = game.tables.get(trimmed);
  if (worldById) return worldById;
  const lower = trimmed.toLowerCase();
  const worldByName = game.tables.find((table) => table.name?.toLowerCase() === lower)
    ?? game.tables.find((table) => table.name?.toLowerCase().includes(lower));
  if (worldByName) return worldByName;

  for (const pack of game.packs.filter((candidate) => candidate.documentName === "RollTable")) {
    try {
      const index = await pack.getIndex({ fields: ["name"] });
      const hit = index.find((entry) => entry.name?.toLowerCase() === lower)
        ?? index.find((entry) => entry.name?.toLowerCase().includes(lower));
      if (hit) return pack.getDocument(hit._id);
    } catch (error) {
      console.warn(`${MODULE_ID} | RollTable index failed for ${pack.collection}`, error);
    }
  }

  return null;
}

async function buildTableSuggestions() {
  if (tableSuggestionCache) return tableSuggestionCache;
  const values = [];
  const seen = new Set();

  for (const table of game.tables) {
    const name = table.name?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    values.push(name);
  }

  for (const pack of game.packs.filter((candidate) => candidate.documentName === "RollTable")) {
    try {
      const index = await pack.getIndex({ fields: ["name"] });
      for (const entry of index) {
        const display = `${pack.collection}::${entry.name}`;
        if (seen.has(display.toLowerCase())) continue;
        seen.add(display.toLowerCase());
        values.push(display);
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Table suggestions failed for ${pack.collection}`, error);
    }
  }

  tableSuggestionCache = values.sort((a, b) => a.localeCompare(b));
  return tableSuggestionCache;
}

async function resolveTableResult(result) {
  if (!result) return null;
  try {
    if (result.document) return await result.document;
  } catch {}
  try {
    if (typeof result.getDocument === "function") {
      const document = await result.getDocument();
      if (document) return document;
    }
  } catch {}

  const uuid = result.flags?.core?.sourceId ?? result.flags?.core?.uuid;
  if (uuid) {
    const document = await resolveItem(uuid);
    if (document) return document;
  }

  if (result.documentCollection && result.documentId) {
    try {
      const collection = result.documentCollection;
      if (collection === "Item") return game.items.get(result.documentId) ?? null;
      if (collection.startsWith("Compendium.")) {
        return fromUuid(`${collection}.Item.${result.documentId}`);
      }
      const pack = game.packs.get(collection);
      if (pack?.documentName === "Item") return pack.getDocument(result.documentId);
    } catch {}
  }

  if (result.text) return findItemAnywhere(result.text);
  return null;
}

async function rollCategoryItems(category) {
  const table = await findRollTable(category.tableRef);
  if (!table) throw new Error(`RollTable not found: ${category.tableRef}`);

  const desired = Math.max(0, Number(category.draws) || 0);
  const output = [];
  const seen = new Set();
  const attempts = Math.max(desired * 4, desired);

  for (let index = 0; index < attempts && output.length < desired; index += 1) {
    let rolled;
    try {
      rolled = await table.roll();
    } catch {
      rolled = await table.draw({ displayChat: false });
    }
    for (const result of rolled?.results ?? []) {
      const item = await resolveTableResult(result);
      if (!item || item.documentName !== "Item") continue;
      const key = item.uuid ?? `${item.name}-${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        id: makeId(),
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        price: getItemMarketValue(item),
        itemType: item.type || "",
        categoryId: category.id,
        generated: true
      });
      if (output.length >= desired) break;
    }
  }

  return output;
}

async function regenerateDinerMenu(diner) {
  const manualItems = (diner.items ?? []).filter((item) => !item.generated);
  const generated = [];

  for (const category of diner.categories ?? []) {
    if (!category.tableRef || Number(category.draws) <= 0) continue;
    const categoryItems = await rollCategoryItems(category);
    generated.push(...categoryItems);
  }

  diner.items = [...manualItems, ...generated];
  return generated.length;
}

function ruleTypeOptions(selected) {
  const options = [
    ["foodTier", "Food lifestyle tier"],
    ["monthlyBudget", "Total monthly lifestyle budget"],
    ["alwaysPay", "Always pay"],
    ["alwaysIncluded", "Always included"]
  ];
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function foodTierOptions(selected, includeAuto = false) {
  const values = FOOD_TIERS.map((tier) => `<option value="${tier.id}" ${selected === tier.id ? "selected" : ""}>${tier.label} (${tier.monthly} eb/month)</option>`);
  if (includeAuto) values.unshift(`<option value="auto" ${selected === "auto" ? "selected" : ""}>Automatic detection</option>`);
  return values.join("");
}

function deliveryOptions(selected) {
  return [
    ["inventory", "Add ordered item to actor inventory"],
    ["chat", "Chat receipt only"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}


function getTileDocument(tileLike, depth = 0) {
  if (!tileLike || depth > 6) return null;
  if (tileLike.documentName === "Tile") return tileLike;
  if (typeof tileLike === "string") return null;
  if (Array.isArray(tileLike)) {
    for (const entry of tileLike) {
      const found = getTileDocument(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const directKeys = ["tile", "document", "object", "tileDocument", "triggeringTile", "source", "context", "trigger", "data"];
  for (const key of directKeys) {
    const found = getTileDocument(tileLike?.[key], depth + 1);
    if (found) return found;
  }
  return null;
}

async function resolveTileContext(context = {}) {
  const direct = getTileDocument(context);
  if (direct) return direct;
  const candidates = [];
  const collect = (value, depth = 0) => {
    if (value == null || depth > 5) return;
    if (typeof value === "string") {
      if (value.startsWith("Scene.") && value.includes(".Tile.")) candidates.push(value);
      return;
    }
    if (Array.isArray(value)) return value.forEach(entry => collect(entry, depth + 1));
    if (typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (/uuid|tile/i.test(key) && typeof nested === "string") candidates.push(nested);
      collect(nested, depth + 1);
    }
  };
  collect(context);
  for (const candidate of candidates) {
    try {
      const doc = await fromUuid(candidate);
      if (doc?.documentName === "Tile") return doc;
    } catch {}
  }
  return null;
}

function dinerIdFromTile(tileLike) {
  const tile = getTileDocument(tileLike);
  if (!tile) return null;
  return tile.getFlag?.(MODULE_ID, "dinerId") || tile.flags?.[MODULE_ID]?.dinerId || null;
}

function selectedTileDocuments() {
  return (canvas?.tiles?.controlled || []).map(tile => getTileDocument(tile)).filter(Boolean);
}

async function bindDinerToTile(diner, tileLike, db = null) {
  const tile = getTileDocument(tileLike);
  if (!tile) throw new Error("No Tile selected.");
  const oldId = dinerIdFromTile(tile);
  if (oldId && oldId !== diner.id) {
    const workingDb = db ?? await loadDB();
    const oldDiner = workingDb.diners?.[oldId];
    if (oldDiner) oldDiner.tileUuids = (oldDiner.tileUuids || []).filter(uuid => uuid !== tile.uuid);
    if (!db) await saveDB(workingDb);
  }
  diner.tileUuids ??= [];
  if (!diner.tileUuids.includes(tile.uuid)) diner.tileUuids.push(tile.uuid);
  await tile.setFlag(MODULE_ID, "dinerId", diner.id);
  return diner;
}

async function unbindDinerFromTile(diner, tileLike) {
  const tile = getTileDocument(tileLike);
  if (!tile) throw new Error("No Tile selected.");
  diner.tileUuids = (diner.tileUuids || []).filter(uuid => uuid !== tile.uuid);
  if (dinerIdFromTile(tile) === diner.id) await tile.unsetFlag(MODULE_ID, "dinerId");
  return diner;
}

async function unbindDinerFromTileUuid(diner, tileUuid) {
  const uuid = String(tileUuid || "");
  if (!uuid) return diner;
  diner.tileUuids = (diner.tileUuids || []).filter(candidate => candidate !== uuid);
  try {
    const tile = await fromUuid(uuid);
    if (tile?.documentName === "Tile" && dinerIdFromTile(tile) === diner.id) await tile.unsetFlag(MODULE_ID, "dinerId");
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not resolve bound Tile while unbinding ${uuid}`, error);
  }
  return diner;
}

async function boundTileInfo(diner) {
  const rows = [];
  for (const uuid of diner?.tileUuids || []) {
    try {
      const tile = await fromUuid(uuid);
      const scene = tile?.parent?.documentName === "Scene" ? tile.parent : game.scenes?.get?.(tile?.parent?.id);
      rows.push({
        uuid,
        exists: tile?.documentName === "Tile",
        tileName: tile?.documentName === "Tile" ? (tile?.name || `Tile ${tile?.id || ""}`) : "Missing Tile",
        sceneName: scene?.name || "Unknown Scene"
      });
    } catch (_) {
      rows.push({ uuid, exists: false, tileName: "Missing Tile", sceneName: "Unknown Scene" });
    }
  }
  return rows;
}


async function refreshDinerTileFlags(diner, oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  for (const uuid of diner?.tileUuids || []) {
    try {
      const tile = await fromUuid(uuid);
      if (tile?.documentName === "Tile" && dinerIdFromTile(tile) === oldId) await tile.setFlag(MODULE_ID, "dinerId", newId);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not refresh Tile binding ${uuid}`, error);
    }
  }
}

async function clearDinerTileBindings(diner) {
  for (const uuid of diner?.tileUuids || []) {
    try {
      const tile = await fromUuid(uuid);
      if (tile?.documentName === "Tile" && dinerIdFromTile(tile) === diner.id) await tile.unsetFlag(MODULE_ID, "dinerId");
    } catch {}
  }
  diner.tileUuids = [];
}

function tileMatchesAutoKeywords(tileLike, keywords) {
  const tile = getTileDocument(tileLike);
  if (!tile) return false;
  const haystack = [tile.name, tile.texture?.src, tile.img].filter(Boolean).join(" ").toLowerCase();
  return String(keywords || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean).some(value => haystack.includes(value));
}

async function createDinerForAutoTile(tileLike) {
  if (!game.user?.isGM) return null;
  const tile = getTileDocument(tileLike);
  if (!tile || dinerIdFromTile(tile)) return null;
  const db = await loadDB();
  if (!db.defaults.autoTiles || !tileMatchesAutoKeywords(tile, db.defaults.autoTileKeywords)) return null;
  const template = db.diners?.[db.defaults.autoTileTemplateId] || null;
  const diner = template ? duplicate(template) : defaultDiner();
  const oldId = diner.id;
  diner.id = `diner-${makeId(10).toLowerCase()}`;
  diner.name = tile.name?.trim() || (template ? `${template.name} — ${tile.parent?.name || "Night City"}` : "New Diner");
  diner.sceneOnly = true;
  diner.sceneId = tile.parent?.id || canvas?.scene?.id || null;
  diner.sceneName = tile.parent?.name || canvas?.scene?.name || "";
  diner.tileUuids = [tile.uuid];
  // A cloned template must never inherit another Tile's binding list.
  if (oldId === diner.id) diner.id = `diner-${makeId(12).toLowerCase()}`;
  db.diners[diner.id] = diner;
  await tile.setFlag(MODULE_ID, "dinerId", diner.id);
  await saveDB(db);
  ui.notifications.info(`Auto-created Diner: ${diner.name}`);
  return diner;
}

function bindAutoTileHook() {
  Hooks.on("createTile", async (tile, options, userId) => {
    if (!game.user?.isGM || userId !== game.user.id) return;
    try { await createDinerForAutoTile(tile); }
    catch (error) { console.error(`${MODULE_ID} | Auto Tile binding failed`, error); }
  });
}

async function openFromTileContext(context = {}) {
  const tile = await resolveTileContext(context);
  if (!tile) return ui.notifications.warn("Diner™ could not identify the triggering Tile.");
  const dinerId = dinerIdFromTile(tile);
  if (!dinerId) return ui.notifications.warn("This Tile is not bound to a Diner.");
  return openDiner(dinerId, { actor: context?.actor ?? null });
}

function forceDialogChrome(app, accent) {
  const element = app?.element?.[0] ?? app;
  if (!element) return;
  const form = element.querySelector(".window-content > form");
  const footer = element.querySelector(".dialog-buttons");
  if (form) {
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.height = "auto";
    form.style.minHeight = "0";
  }
  if (footer) {
    footer.style.display = "flex";
    footer.style.flex = "0 0 52px";
    footer.style.height = "52px";
    footer.style.minHeight = "52px";
    footer.style.maxHeight = "52px";
    footer.style.alignItems = "center";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
  }
  for (const button of element.querySelectorAll(".dialog-buttons .dialog-button")) {
    Object.assign(button.style, {
      background: "rgba(0,0,0,.5)",
      color: accent,
      border: `1px solid ${accent}`,
      borderRadius: "10px",
      padding: "6px 12px",
      fontWeight: "800",
      fontFamily: "inherit",
      fontSize: "14px",
      height: "36px",
      minHeight: "36px",
      maxHeight: "36px",
      width: "auto",
      minWidth: "96px",
      lineHeight: "1.2",
      flex: "0 0 auto"
    });
  }
}

function setDialogAccent(app, accent) {
  const element = app?.element?.[0] ?? app;
  if (!element) return;
  element.classList.add("diner-manager-dialog");
  element.style.setProperty("--diner-accent", accent || DEFAULT_ACCENT);
  forceDialogChrome(element, accent || DEFAULT_ACCENT);
}

function applyThemeToOpenDialogs(accent) {
  for (const app of document.querySelectorAll(".diner-manager-dialog")) setDialogAccent(app, accent);
}

function openDialog(config, options = {}) {
  const dialog = new Dialog(config, { resizable: true, ...options });
  dialog.render(true);
  return dialog;
}

async function confirmDialog(title, content) {
  return Dialog.confirm({ title, content, yes: () => true, no: () => false, defaultYes: false });
}

async function openLifestyleOverride(actor = getActorFromContext()) {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can set lifestyle overrides.");
  if (!actor) return ui.notifications.warn("Select a token or set a User Character first.");

  const db = await loadDB();
  const lifestyle = inspectLifestyle(actor);
  const allowance = inspectCoveredAllowance(db, actor, "inspector");
  const outstandingServing = findOutstandingCoveredServing(actor);
  const current = actor.getFlag(MODULE_ID, "foodTier") ?? "auto";
  const content = `
    <div class="diner-shell">
      <div class="diner-header">
        <img class="diner-logo" src="${esc(actor.img ?? "icons/svg/mystery-man.svg")}">
        <div>
          <div class="diner-title">${esc(actor.name)}</div>
          <div class="diner-subtitle">Lifestyle coverage inspector</div>
        </div>
      </div>
      <div class="diner-section">
        <div class="diner-lifestyle-summary">
          <div class="diner-pill"><b>Food:</b><br>${esc(lifestyle.foodTier.label)}</div>
          <div class="diner-pill"><b>Housing:</b><br>${esc(lifestyle.housingName)}</div>
          <div class="diner-pill"><b>Total:</b><br>${lifestyle.totalMonthly} eb/month</div>
          <div class="diner-pill"><b>Covered Meals:</b><br>${allowance.unlimited ? "Unlimited" : `${allowance.remaining}/${allowance.limit} remaining`}</div>
          <div class="diner-pill"><b>Serving Lock:</b><br>${outstandingServing ? esc(outstandingServing.name) : "Clear"}</div>
        </div>
      </div>
      <label>Food lifestyle override
        <select class="diner-tier-override">${foodTierOptions(current, true)}</select>
      </label>
      <div class="diner-muted">Automatic detection reads active Gear Items marked carried or equipped. The stale actor-level lifestyle block is ignored.</div>
      ${lifestyle.warnings?.length ? `<div class="diner-card diner-warning">${lifestyle.warnings.map((warning) => `<div><i class="fas fa-exclamation-triangle"></i> ${esc(warning)}</div>`).join("")}</div>` : ""}
    </div>`;

  openDialog({
    title: `Diner™ Lifestyle — ${actor.name}`,
    content,
    buttons: {
      save: {
        label: "Save",
        callback: async (html) => {
          const value = html[0].querySelector(".diner-tier-override")?.value ?? "auto";
          if (value === "auto") await actor.unsetFlag(MODULE_ID, "foodTier");
          else await actor.setFlag(MODULE_ID, "foodTier", value);
          ui.notifications.info(`Diner lifestyle setting saved for ${actor.name}.`);
        }
      },
      reset: {
        label: "Reset Meal Count",
        callback: async () => {
          await resetCoveredOrders(actor);
          ui.notifications.info(`Covered meal count reset for ${actor.name}.`);
        }
      },
      clearServing: {
        label: "Clear Serving Lock",
        callback: async () => {
          const count = await clearCoveredServingLocks(actor);
          ui.notifications.info(count ? `Cleared ${count} serving lock${count === 1 ? "" : "s"} for ${actor.name}.` : `${actor.name} has no serving lock.`);
        }
      },
      close: { label: "Close" }
    },
    render: (html) => setDialogAccent(html[0].closest(".app"), themeAccent(db))
  }, { width: 660 });
}

function renderManagerList(db) {
  const diners = Object.values(db.diners).sort((a, b) => a.name.localeCompare(b.name));
  if (!diners.length) return `<div class="diner-card diner-muted">No diners yet. Create one for a restaurant, bar, food truck, cart, or street vendor.</div>`;

  return diners.map((diner) => {
    const availability = diner.sceneOnly ? (diner.sceneName || diner.sceneId || "Scene locked") : "Any scene / mobile";
    const tileCount = Array.isArray(diner.tileUuids) ? diner.tileUuids.length : 0;
    return `
      <div class="diner-card diner-manager-entry" data-diner-id="${esc(diner.id)}">
        <div>
          <div class="diner-entry-name">${esc(diner.name)}</div>
          <div><span class="diner-entry-id">${esc(diner.id)}</span> · <span class="diner-muted">${esc(availability)} · ${(diner.items ?? []).length} menu item(s) · ${tileCount ? `${tileCount} Tile${tileCount === 1 ? "" : "s"} bound` : "No Tile bound"}</span></div>
        </div>
        <div class="diner-row">
          <button type="button" class="diner-btn diner-icon-btn" data-bind-manager="${esc(diner.id)}" title="Bind selected Tile"><i class="fas fa-link"></i></button>
          <button type="button" class="diner-btn" data-preview="${esc(diner.id)}"><i class="fas fa-eye"></i> Preview</button>
          <button type="button" class="diner-btn" data-edit="${esc(diner.id)}"><i class="fas fa-edit"></i> Edit</button>
          <button type="button" class="diner-btn" data-delete="${esc(diner.id)}"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
  }).join("");
}

async function openManager() {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can open Diner™ Manager.");
  const db = await loadDB();
  const accent = themeAccent(db);

  const content = `
    <div class="diner-shell">
      <div class="diner-header diner-brand-header">
        <img class="diner-logo" src="${esc(DEFAULT_DINER_ICON)}">
        <div class="diner-brand-copy" style="flex:1">
          <div class="diner-kicker">LOCAL FOOD EXCHANGE // NIGHT CITY</div>
          <div class="diner-title">DINER™ <span>MANAGER</span></div>
          <div class="diner-brand-rule"></div>
          <div class="diner-subtitle">Persistent menus · lifestyle coverage · direct inventory delivery</div>
        </div>
        <button type="button" class="diner-btn" data-lifestyle><i class="fas fa-id-card"></i> Actor Lifestyle</button>
      </div>
      <div class="diner-toolbar">
        <div class="diner-row">
          <button type="button" class="diner-btn" data-new><i class="fas fa-plus"></i> New Diner</button>
          <button type="button" class="diner-btn" data-options><i class="fas fa-sliders-h"></i> Options</button>
        </div>
        <div class="diner-muted">Tile helper: <span class="diner-code">return game.dinerManager.openTile({args, tile, token, actor});</span></div>
      </div>
      <div class="diner-list" data-manager-list>${renderManagerList(db)}</div>
    </div>`;

  const dialog = openDialog({
    title: "Diner™ Manager",
    content,
    buttons: { close: { label: "Close" } },
    render: (html) => {
      const app = html[0].closest(".app");
      setDialogAccent(app, accent);
      const root = html[0].querySelector(".diner-shell");
      const list = root.querySelector("[data-manager-list]");

      const refresh = () => {
        list.innerHTML = renderManagerList(db);
      };

      root.addEventListener("click", async (event) => {
        if (event.target.closest("[data-new]")) {
          const diner = defaultDiner();
          diner.publicChat = db.defaults.publicChat;
          diner.deliveryMode = db.defaults.deliveryMode;
          db.diners[diner.id] = diner;
          await saveDB(db);
          refresh();
          return openDinerEditor(diner.id, { parentRefresh: refresh, sharedDb: db });
        }

        if (event.target.closest("[data-options]")) return openOptions({ db, parentRefresh: refresh });
        if (event.target.closest("[data-lifestyle]")) return openLifestyleOverride();

        const bindId = event.target.closest("[data-bind-manager]")?.dataset.bindManager;
        if (bindId) {
          const diner = db.diners[bindId];
          const tiles = selectedTileDocuments();
          if (!diner) return ui.notifications.warn(`Diner not found: ${bindId}`);
          if (tiles.length !== 1) return ui.notifications.warn("Select exactly one Tile first.");
          await bindDinerToTile(diner, tiles[0], db);
          await saveDB(db);
          refresh();
          return ui.notifications.info(`${diner.name} bound to ${tiles[0].name || "selected Tile"}.`);
        }

        const editId = event.target.closest("[data-edit]")?.dataset.edit;
        if (editId) return openDinerEditor(editId, { parentRefresh: refresh, sharedDb: db });

        const previewId = event.target.closest("[data-preview]")?.dataset.preview;
        if (previewId) return openDiner(previewId, { preview: true });

        const deleteId = event.target.closest("[data-delete]")?.dataset.delete;
        if (deleteId) {
          const diner = db.diners[deleteId];
          const confirmed = await confirmDialog("Delete Diner", `<p>Delete <b>${esc(diner?.name ?? deleteId)}</b>?</p>`);
          if (!confirmed) return;
          if (diner) await clearDinerTileBindings(diner);
          delete db.diners[deleteId];
          if (db.defaults.autoTileTemplateId === deleteId) db.defaults.autoTileTemplateId = "";
          await saveDB(db);
          refresh();
        }
      });
    }
  }, { width: 920 });

  return dialog;
}

async function openOptions({ db = null, parentRefresh = null } = {}) {
  if (!game.user.isGM) return;
  db ??= await loadDB();
  const defaults = db.defaults ?? defaultDB().defaults;
  const content = `
    <div class="diner-shell">
      <div class="diner-section">
        <div class="diner-section-title">Diner™ Options</div>
        <div class="diner-grid-2">
          <label>Preferred Item compendium pack key<input type="text" class="diner-default-pack" value="${esc(defaults.packKey ?? "")}" placeholder="local-cpr.local-cpr-item"></label>
          <label>Default delivery mode<select class="diner-default-delivery">${deliveryOptions(defaults.deliveryMode)}</select></label>
          <label class="diner-inline-label"><input type="checkbox" class="diner-default-chat" ${defaults.publicChat ? "checked" : ""}> Post orders publicly to chat</label>
          <label class="diner-inline-label"><input type="checkbox" class="diner-era-2045" ${db.era2045 ? "checked" : ""}> Use <b>2045 red</b> theme (#E64539)</label>
        </div>
        <div class="diner-muted">Unchecked uses the 2077 cyan theme (#00FFF7), matching Bodega™ and Vendit™ Manager.</div>
      </div>
      <div class="diner-section">
        <div class="diner-section-title">Lifestyle-Covered Meal Allowance</div>
        <div class="diner-grid-3">
          <label>Covered orders per in-game day<input type="number" min="0" step="1" class="diner-covered-limit" value="${Math.max(0, Number(defaults.coveredOrdersPerDay ?? DEFAULT_COVERED_ORDERS_PER_DAY) || 0)}"></label>
          <label>Allowance scope<select class="diner-covered-scope">
            <option value="global" ${defaults.coveredOrderScope !== "diner" ? "selected" : ""}>Shared across all diners</option>
            <option value="diner" ${defaults.coveredOrderScope === "diner" ? "selected" : ""}>Separate allowance per diner</option>
          </select></label>
          <label>When allowance is exhausted<select class="diner-covered-action">
            <option value="block" ${defaults.coveredLimitAction !== "charge" ? "selected" : ""}>Block additional covered orders</option>
            <option value="charge" ${defaults.coveredLimitAction === "charge" ? "selected" : ""}>Charge normal menu price</option>
          </select></label>
        </div>
        <label class="diner-inline-label"><input type="checkbox" class="diner-require-consumed-serving" ${defaults.requireConsumedCoveredServing !== false ? "checked" : ""}> Require the previous covered serving to be consumed to 0 or removed before another covered order</label>
        <div class="diner-muted">The authoritative count is stored in the Diner™ world ledger and resets with the Simple Calendar date when available. A delivered covered serving is tagged in the inventory. CPR Drug Items stop holding the lock when their remaining amount reaches 0, even if the spent 0/0 Item and its Active Effects remain on the sheet for roleplay. Set the daily limit to 0 for unlimited daily coverage. Paid items and Always Included categories do not consume this allowance.</div>
      </div>
      <div class="diner-section">
        <div class="diner-section-title">Auto Tile Binder</div>
        <label class="diner-inline-label"><input type="checkbox" class="diner-auto-tiles" ${defaults.autoTiles ? "checked" : ""}> Auto-create and bind a Diner when a newly created Tile matches a keyword</label>
        <label>Tile name / image keywords<input type="text" class="diner-auto-keywords" value="${esc(defaults.autoTileKeywords || DEFAULT_AUTO_TILE_KEYWORDS)}"></label>
        <div class="diner-row diner-auto-template-row">
          <div class="diner-muted" style="flex:1">Auto-Tile Template: <b>${esc(db.diners?.[defaults.autoTileTemplateId]?.name || "None")}</b>. Open a Diner editor and choose <b>Use as Auto-Tile Template</b>.</div>
          <button type="button" class="diner-btn" data-clear-auto-template><i class="fas fa-unlink"></i> Clear Template</button>
        </div>
      </div>
      <div class="diner-section">
        <div class="diner-section-title">Built-in Food Lifestyle Ladder</div>
        <div class="diner-lifestyle-summary">
          ${FOOD_TIERS.slice(1).map((tier) => `<div class="diner-pill"><b>${tier.label}</b><br>${tier.monthly} eb/month</div>`).join("")}
        </div>
      </div>
    </div>`;

  openDialog({
    title: "Diner™ Options",
    content,
    buttons: {
      save: {
        label: "Save",
        callback: async (html) => {
          const root = html[0].querySelector(".diner-shell");
          db.era2045 = root.querySelector(".diner-era-2045").checked;
          db.defaults = {
            ...db.defaults,
            packKey: root.querySelector(".diner-default-pack").value.trim(),
            deliveryMode: root.querySelector(".diner-default-delivery").value,
            publicChat: root.querySelector(".diner-default-chat").checked,
            coveredOrdersPerDay: Math.max(0, Math.floor(Number(root.querySelector(".diner-covered-limit").value) || 0)),
            coveredOrderScope: root.querySelector(".diner-covered-scope").value === "diner" ? "diner" : "global",
            coveredLimitAction: root.querySelector(".diner-covered-action").value === "charge" ? "charge" : "block",
            requireConsumedCoveredServing: root.querySelector(".diner-require-consumed-serving").checked,
            autoTiles: root.querySelector(".diner-auto-tiles").checked,
            autoTileKeywords: root.querySelector(".diner-auto-keywords").value.trim() || DEFAULT_AUTO_TILE_KEYWORDS,
            autoTileTemplateId: db.defaults.autoTileTemplateId || ""
          };
          await saveDB(db);
          applyThemeToOpenDialogs(themeAccent(db));
          parentRefresh?.();
          ui.notifications.info(`Diner™ options saved — ${themeLabel(db)} theme.`);
        }
      },
      close: { label: "Close" }
    },
    render: (html) => {
      setDialogAccent(html[0].closest(".app"), themeAccent(db));
      const root = html[0].querySelector(".diner-shell");
      root.querySelector("[data-clear-auto-template]")?.addEventListener("click", async () => {
        db.defaults.autoTileTemplateId = "";
        await saveDB(db);
        root.querySelector(".diner-auto-template-row .diner-muted").innerHTML = `Auto-Tile Template: <b>None</b>. Open a Diner editor and choose <b>Use as Auto-Tile Template</b>.`;
        ui.notifications.info("Diner™ Auto-Tile template cleared.");
      });
    }
  }, { width: 760 });
}

function renderCategoryEditors(diner) {
  return (diner.categories ?? []).map((category) => `
    <div class="diner-card diner-category-editor" data-category-id="${esc(category.id)}">
      <label>Category label<input type="text" data-field="label" value="${esc(category.label)}"></label>
      <label>Coverage rule<select data-field="ruleType">${ruleTypeOptions(category.ruleType)}</select></label>
      <label>Required food tier<select data-field="requiredTier">${foodTierOptions(category.requiredTier)}</select></label>
      <label>Budget minimum<input type="number" min="0" step="1" data-field="minMonthly" value="${Number(category.minMonthly) || 0}"></label>
      <label>RollTable (UUID / name / pack::name)<input type="text" list="diner-table-suggestions" data-field="tableRef" value="${esc(category.tableRef)}"></label>
      <div class="diner-row" style="flex-wrap:nowrap">
        <label style="width:68px">Draws<input type="number" min="0" step="1" data-field="draws" value="${Number(category.draws) || 0}"></label>
        <button type="button" class="diner-btn" data-test-table="${esc(category.id)}" title="Test table"><i class="fas fa-dice"></i></button>
        <button type="button" class="diner-btn" data-remove-category="${esc(category.id)}" title="Remove category"><i class="fas fa-times"></i></button>
      </div>
    </div>`).join("");
}

function renderItemEditors(diner) {
  const categoryOptions = (selected) => diner.categories.map((category) => `<option value="${category.id}" ${selected === category.id ? "selected" : ""}>${esc(category.label)}</option>`).join("");
  const items = diner.items ?? [];
  if (!items.length) return `<div class="diner-card diner-muted">No menu items yet. Quick Add, drag an Item, or generate from category RollTables.</div>`;

  return items.map((item) => `
    <div class="diner-card diner-item-editor" data-item-id="${esc(item.id)}">
      <img class="diner-thumb" src="${esc(item.img || "icons/svg/box.svg")}">
      <div>
        <div class="diner-entry-name">${esc(item.name)}</div>
        <div class="diner-muted">${item.generated ? "Generated from RollTable" : "Manually added"}${item.itemType ? ` · <span class="diner-type-badge">${esc(String(item.itemType).toUpperCase())}</span>` : ""}</div>
      </div>
      <label>Category<select data-item-field="categoryId">${categoryOptions(item.categoryId)}</select></label>
      <label>Price<input type="number" min="0" step="1" data-item-field="price" value="${Number(item.price) || 0}"></label>
      <button type="button" class="diner-btn" data-remove-item="${esc(item.id)}"><i class="fas fa-times"></i></button>
    </div>`).join("");
}

async function openDinerEditor(dinerId, { parentRefresh = null, sharedDb = null } = {}) {
  if (!game.user.isGM) return;
  const db = sharedDb ?? await loadDB();
  const diner = db.diners[dinerId];
  if (!diner) return ui.notifications.warn(`Diner not found: ${dinerId}`);

  const itemSuggestions = await buildItemSuggestions();
  const tableSuggestions = await buildTableSuggestions();

  const content = `
    <div class="diner-shell" data-diner-editor="${esc(diner.id)}">
      <div class="diner-header diner-brand-header">
        <img class="diner-logo" src="${esc(diner.img || DEFAULT_DINER_ICON)}">
        <div class="diner-brand-copy" style="flex:1">
          <div class="diner-kicker">DINER CONFIGURATION // ${esc(themeLabel(db))}</div>
          <div class="diner-title">EDIT <span>${esc(diner.name)}</span></div>
          <div class="diner-brand-rule"></div>
          <div class="diner-subtitle">World-persistent menu and lifestyle service configuration.</div>
        </div>
        <button type="button" class="diner-btn" data-preview><i class="fas fa-eye"></i> Preview</button>
      </div>

      <div class="diner-section">
        <div class="diner-section-title">Vendor</div>
        <div class="diner-grid-2">
          <label>Name<input type="text" class="diner-name" value="${esc(diner.name)}"></label>
          <label>ID for tiles<input type="text" class="diner-id" value="${esc(diner.id)}"></label>
        </div>
        <div class="diner-grid-2">
          <label>Subtitle<input type="text" class="diner-subtitle-input" value="${esc(diner.subtitle ?? "")}"></label>
          <label>Image path<input type="text" class="diner-img" value="${esc(diner.img ?? "")}"></label>
          <label>Delivery<select class="diner-delivery">${deliveryOptions(diner.deliveryMode)}</select></label>
          <div class="diner-row">
            <label class="diner-inline-label"><input type="checkbox" class="diner-public-chat" ${diner.publicChat ? "checked" : ""}> Public order receipts</label>
            <label class="diner-inline-label"><input type="checkbox" class="diner-scene-only" ${diner.sceneOnly ? "checked" : ""}> Lock to current scene</label>
          </div>
        </div>
        <div class="diner-muted">Mobile food trucks and street vendors should leave scene lock unchecked. Reuse the same Diner ID across scenes or bind multiple Tiles.</div>
      </div>

      <div class="diner-section diner-tile-panel">
        <div class="diner-toolbar">
          <div>
            <div class="diner-section-title">Tile Binding</div>
            <div class="diner-muted">Select one Foundry Tile to bind it. To unbind, select one or more Tiles on this canvas or use the bound-Tile list below. Monk's Active Tile Triggers only needs the helper script below.</div>
          </div>
          <div class="diner-row">
            <button type="button" class="diner-btn" data-bind-tile><i class="fas fa-link"></i> Bind Selected Tile</button>
            <button type="button" class="diner-btn" data-unbind-tile><i class="fas fa-unlink"></i> Unbind Selected Tile(s)</button>
            <button type="button" class="diner-btn" data-auto-template><i class="fas fa-clone"></i> Use as Auto-Tile Template</button>
          </div>
        </div>
        <div class="diner-tile-status">
          <div class="diner-toolbar diner-bound-toolbar">
            <span>Bound Tiles: <b data-bound-tile-count>${(diner.tileUuids || []).length}</b></span>
            <button type="button" class="diner-btn diner-danger-btn" data-unbind-all-tiles ${(diner.tileUuids || []).length ? "" : "disabled"}><i class="fas fa-unlink"></i> Unbind All</button>
          </div>
          <div class="diner-bound-tile-list" data-bound-tile-list><div class="diner-muted">Loading bound Tiles…</div></div>
        </div>
        <div class="diner-script-row"><span>Monk helper</span><span class="diner-code diner-tile-code">return game.dinerManager.openTile({args: typeof args === "undefined" ? null : args, tile: typeof tile === "undefined" ? null : tile, token: typeof token === "undefined" ? null : token, actor: typeof actor === "undefined" ? null : actor});</span></div>
      </div>

      <div class="diner-section">
        <div class="diner-toolbar">
          <div>
            <div class="diner-section-title">Menu Categories & Coverage</div>
            <div class="diner-muted">Food tier compares only the paid food plan. Monthly budget can deliberately include rent plus food.</div>
          </div>
          <button type="button" class="diner-btn" data-add-category><i class="fas fa-plus"></i> Category</button>
        </div>
        <datalist id="diner-table-suggestions">${tableSuggestions.map((value) => `<option value="${esc(value)}"></option>`).join("")}</datalist>
        <div class="diner-list" data-categories>${renderCategoryEditors(diner)}</div>
      </div>

      <div class="diner-section">
        <div class="diner-toolbar">
          <div>
            <div class="diner-section-title">Menu Items</div>
            <div class="diner-muted">Manual items survive menu regeneration. Generated items are rebuilt from the category tables.</div>
          </div>
          <div class="diner-row"><button type="button" class="diner-btn" data-create-item><i class="fas fa-hamburger"></i> Create Meal / Drink</button><button type="button" class="diner-btn" data-regenerate><i class="fas fa-sync"></i> Generate / Refresh Menu</button></div>
        </div>
        <div class="diner-row">
          <input type="text" class="diner-quick-item" list="diner-item-suggestions" placeholder="Search world Items and Item compendiums…" style="flex:1">
          <datalist id="diner-item-suggestions">${itemSuggestions.map((value) => `<option value="${esc(value)}"></option>`).join("")}</datalist>
          <select class="diner-quick-category" style="max-width:230px">${diner.categories.map((category) => `<option value="${category.id}">${esc(category.label)}</option>`).join("")}</select>
          <button type="button" class="diner-btn" data-quick-add><i class="fas fa-plus"></i> Add</button>
        </div>
        <div class="diner-drop" data-drop>Drag an Item here to add it to the selected category</div>
        <div class="diner-list" data-items>${renderItemEditors(diner)}</div>
      </div>

      <div class="diner-section diner-muted">
        Direct script: <span class="diner-code diner-direct-code">game.dinerManager.open("${esc(diner.id)}")</span>
      </div>
    </div>`;

  let collectEditorFields = null;

  const commit = async ({ notify = false } = {}) => {
    db.diners[diner.id] = diner;
    await saveDB(db);
    parentRefresh?.();
    if (notify) ui.notifications.info(`${diner.name} saved.`);
  };

  const dialog = openDialog({
    title: `Diner™ — ${diner.name}`,
    content,
    buttons: {
      save: {
        label: "Save",
        callback: async () => {
          try {
            await collectEditorFields?.();
            await commit({ notify: true });
          } catch (error) {
            console.error(`${MODULE_ID} | Diner save failed`, error);
            ui.notifications.error(error.message || "Diner could not be saved.");
          }
        }
      },
      close: { label: "Close" }
    },
    render: (html) => {
      const app = html[0].closest(".app");
      setDialogAccent(app, themeAccent(db));
      const root = html[0].querySelector("[data-diner-editor]");
      const categoriesEl = root.querySelector("[data-categories]");
      const itemsEl = root.querySelector("[data-items]");
      const quickCategory = root.querySelector(".diner-quick-category");
      const drop = root.querySelector("[data-drop]");

      const refreshCategories = () => {
        categoriesEl.innerHTML = renderCategoryEditors(diner);
        quickCategory.innerHTML = diner.categories.map((category) => `<option value="${category.id}">${esc(category.label)}</option>`).join("");
      };
      const refreshItems = () => {
        itemsEl.innerHTML = renderItemEditors(diner);
      };
      const refreshTileScript = () => {
        const code = root.querySelector(".diner-direct-code");
        if (code) code.textContent = `game.dinerManager.open("${diner.id}")`;
      };

      const refreshBoundTiles = async () => {
        const list = root.querySelector("[data-bound-tile-list]");
        const count = root.querySelector("[data-bound-tile-count]");
        const unbindAll = root.querySelector("[data-unbind-all-tiles]");
        if (count) count.textContent = String((diner.tileUuids || []).length);
        if (unbindAll) unbindAll.disabled = !(diner.tileUuids || []).length;
        if (!list) return;
        const rows = await boundTileInfo(diner);
        if (!rows.length) {
          list.innerHTML = `<div class="diner-muted">No Tiles are bound to this Diner.</div>`;
          return;
        }
        list.innerHTML = rows.map(row => `<div class="diner-bound-tile-row ${row.exists ? "" : "is-missing"}">
          <div class="diner-bound-tile-copy">
            <b>${esc(row.tileName)}</b>
            <span>${esc(row.sceneName)}</span>
            <code>${esc(row.uuid)}</code>
          </div>
          <button type="button" class="diner-btn diner-icon-btn" data-unbind-tile-uuid="${esc(row.uuid)}" title="Unbind this Tile"><i class="fas fa-unlink"></i></button>
        </div>`).join("");
      };

      refreshBoundTiles();

      const pullCategoryFields = () => {
        for (const card of categoriesEl.querySelectorAll("[data-category-id]")) {
          const category = diner.categories.find((candidate) => candidate.id === card.dataset.categoryId);
          if (!category) continue;
          for (const input of card.querySelectorAll("[data-field]")) {
            const field = input.dataset.field;
            category[field] = input.type === "number" ? Math.max(0, Number(input.value) || 0) : input.value;
          }
        }
      };

      const pullItemFields = () => {
        for (const card of itemsEl.querySelectorAll("[data-item-id]")) {
          const item = diner.items.find((candidate) => candidate.id === card.dataset.itemId);
          if (!item) continue;
          for (const input of card.querySelectorAll("[data-item-field]")) {
            const field = input.dataset.itemField;
            item[field] = input.type === "number" ? Math.max(0, Number(input.value) || 0) : input.value;
          }
        }
      };

      collectEditorFields = async () => {
        const oldId = diner.id;
        const requestedId = slugify(root.querySelector(".diner-id").value.trim() || oldId);
        if (requestedId !== oldId && db.diners[requestedId]) {
          throw new Error(`A diner already uses the ID “${requestedId}”.`);
        }

        diner.name = root.querySelector(".diner-name").value.trim() || "New Diner";
        diner.subtitle = root.querySelector(".diner-subtitle-input").value.trim();
        diner.img = root.querySelector(".diner-img").value.trim() || diner.img;
        diner.deliveryMode = root.querySelector(".diner-delivery").value;
        diner.publicChat = root.querySelector(".diner-public-chat").checked;
        diner.sceneOnly = root.querySelector(".diner-scene-only").checked;
        if (diner.sceneOnly) {
          diner.sceneId = canvas?.scene?.id ?? diner.sceneId;
          diner.sceneName = canvas?.scene?.name ?? diner.sceneName;
        } else {
          diner.sceneId = null;
          diner.sceneName = "";
        }
        pullCategoryFields();
        pullItemFields();

        if (requestedId !== oldId) {
          await refreshDinerTileFlags(diner, oldId, requestedId);
          delete db.diners[oldId];
          diner.id = requestedId;
          root.dataset.dinerEditor = requestedId;
          root.querySelector(".diner-id").value = requestedId;
          refreshTileScript();
        }
      };

      root.addEventListener("input", (event) => {
        if (event.target.matches("[data-field]")) pullCategoryFields();
        if (event.target.matches("[data-item-field]")) pullItemFields();
      });

      root.addEventListener("click", async (event) => {
        if (event.target.closest("[data-bind-tile]")) {
          await collectEditorFields();
          const tiles = selectedTileDocuments();
          if (tiles.length !== 1) return ui.notifications.warn("Select exactly one Tile first.");
          await bindDinerToTile(diner, tiles[0], db);
          await commit();
          await refreshBoundTiles();
          return ui.notifications.info(`${diner.name} bound to ${tiles[0].name || "selected Tile"}.`);
        }

        if (event.target.closest("[data-unbind-tile]")) {
          await collectEditorFields();
          const tiles = selectedTileDocuments();
          if (!tiles.length) return ui.notifications.warn("Select one or more Tiles first, or use the bound-Tile list below.");
          let removed = 0;
          for (const tile of tiles) {
            if (!(diner.tileUuids || []).includes(tile.uuid)) continue;
            await unbindDinerFromTile(diner, tile);
            removed += 1;
          }
          await commit();
          await refreshBoundTiles();
          if (!removed) return ui.notifications.warn("None of the selected Tiles were bound to this Diner.");
          return ui.notifications.info(`${diner.name} unbound from ${removed} selected Tile${removed === 1 ? "" : "s"}.`);
        }

        const unbindUuid = event.target.closest("[data-unbind-tile-uuid]")?.dataset.unbindTileUuid;
        if (unbindUuid) {
          await collectEditorFields();
          await unbindDinerFromTileUuid(diner, unbindUuid);
          await commit();
          await refreshBoundTiles();
          return ui.notifications.info(`Tile unbound from ${diner.name}.`);
        }

        if (event.target.closest("[data-unbind-all-tiles]")) {
          await collectEditorFields();
          const total = (diner.tileUuids || []).length;
          if (!total) return ui.notifications.warn("This Diner has no bound Tiles.");
          await clearDinerTileBindings(diner);
          await commit();
          await refreshBoundTiles();
          return ui.notifications.info(`${diner.name} unbound from all ${total} Tile${total === 1 ? "" : "s"}.`);
        }

        if (event.target.closest("[data-auto-template]")) {
          await collectEditorFields();
          await commit();
          db.defaults.autoTileTemplateId = diner.id;
          await saveDB(db);
          return ui.notifications.info(`${diner.name} is now the Auto-Tile template.`);
        }

        if (event.target.closest("[data-create-item]")) {
          await collectEditorFields();
          await commit();
          return openCreateMenuItem({
            diner,
            db,
            categoryId: quickCategory.value || diner.categories[0]?.id,
            onCreated: async () => {
              refreshItems();
              parentRefresh?.();
            }
          });
        }

        if (event.target.closest("[data-add-category]")) {
          await collectEditorFields();
          diner.categories.push(defaultCategory(`Menu ${diner.categories.length + 1}`, "kibble"));
          refreshCategories();
          refreshItems();
          return commit();
        }

        const removeCategoryId = event.target.closest("[data-remove-category]")?.dataset.removeCategory;
        if (removeCategoryId) {
          await collectEditorFields();
          if (diner.categories.length <= 1) return ui.notifications.warn("A diner needs at least one category.");
          diner.categories = diner.categories.filter((category) => category.id !== removeCategoryId);
          const fallback = diner.categories[0]?.id;
          for (const item of diner.items) if (item.categoryId === removeCategoryId) item.categoryId = fallback;
          refreshCategories();
          refreshItems();
          return commit();
        }

        const testCategoryId = event.target.closest("[data-test-table]")?.dataset.testTable;
        if (testCategoryId) {
          await collectEditorFields();
          const category = diner.categories.find((candidate) => candidate.id === testCategoryId);
          const table = await findRollTable(category?.tableRef);
          if (!table) return ui.notifications.warn("RollTable not found.");
          return table.draw({ displayChat: true });
        }

        const removeItemId = event.target.closest("[data-remove-item]")?.dataset.removeItem;
        if (removeItemId) {
          await collectEditorFields();
          diner.items = diner.items.filter((item) => item.id !== removeItemId);
          refreshItems();
          return commit();
        }

        if (event.target.closest("[data-quick-add]")) {
          await collectEditorFields();
          const input = root.querySelector(".diner-quick-item");
          const name = input.value.trim();
          if (!name) return;
          const item = await findItemAnywhere(name, db.defaults.packKey);
          if (!item) return ui.notifications.warn(`Item not found: ${name}`);
          diner.items.push({
            id: makeId(),
            uuid: item.uuid,
            name: item.name,
            img: item.img,
            price: getItemMarketValue(item),
            itemType: item.type || "",
            categoryId: quickCategory.value || diner.categories[0]?.id,
            generated: false
          });
          input.value = "";
          refreshItems();
          return commit();
        }

        if (event.target.closest("[data-regenerate]")) {
          await collectEditorFields();
          try {
            const count = await regenerateDinerMenu(diner);
            await commit();
            refreshItems();
            ui.notifications.info(`Generated ${count} menu item(s) for ${diner.name}.`);
          } catch (error) {
            console.error(`${MODULE_ID} | Menu generation failed`, error);
            ui.notifications.error(error.message || "Menu generation failed.");
          }
          return;
        }

        if (event.target.closest("[data-preview]")) {
          await collectEditorFields();
          await commit();
          return openDiner(diner.id, { preview: true });
        }
      });

      const dragOver = (event) => {
        event.preventDefault();
        drop.classList.add("is-dragging");
      };
      const dragLeave = (event) => {
        event.preventDefault();
        drop.classList.remove("is-dragging");
      };
      const onDrop = async (event) => {
        event.preventDefault();
        drop.classList.remove("is-dragging");
        let data;
        try {
          data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch {
          return;
        }
        if (data?.type !== "Item") return;
        await collectEditorFields();
        const uuid = data.uuid ?? (data.pack ? `Compendium.${data.pack}.Item.${data.id}` : `Item.${data.id}`);
        const item = await resolveItem(uuid);
        if (!item) return ui.notifications.warn("Dropped Item could not be resolved.");
        diner.items.push({
          id: makeId(),
          uuid: item.uuid,
          name: item.name,
          img: item.img,
          price: getItemMarketValue(item),
          itemType: item.type || "",
          categoryId: quickCategory.value || diner.categories[0]?.id,
          generated: false
        });
        refreshItems();
        await commit();
      };

      drop.addEventListener("dragover", dragOver);
      drop.addEventListener("dragleave", dragLeave);
      drop.addEventListener("drop", onDrop);
    }
  }, { width: 1180, height: 900 });

  return dialog;
}

function categoryRuleLabel(category) {
  if (category.ruleType === "alwaysIncluded") return "Included for everyone";
  if (category.ruleType === "alwaysPay") return "Always paid separately";
  if (category.ruleType === "monthlyBudget") return `Included at ${Number(category.minMonthly) || 0}+ eb/month total lifestyle`;
  return `Included with ${tierById(category.requiredTier).label} or better`;
}

function renderPlayerMenu(db, diner, actor, lifestyle) {
  const allowance = inspectCoveredAllowance(db, actor, diner.id);
  const outstandingServing = findOutstandingCoveredServing(actor);
  const requireConsumedServing = coveredOrderConfig(db).requireConsumedServing;
  const grouped = diner.categories.map((category) => ({
    category,
    items: (diner.items ?? []).filter((item) => item.categoryId === category.id)
  }));
  const ungrouped = (diner.items ?? []).filter((item) => !diner.categories.some((category) => category.id === item.categoryId));
  if (ungrouped.length) grouped.push({ category: { id: "other", label: "Other", ruleType: "alwaysPay" }, items: ungrouped });

  const categoryHtml = grouped.map(({ category, items }) => {
    const baseCoverage = categoryCoverage(category, lifestyle);
    const rows = items.length ? items.map((item) => {
      const state = resolveOrderState(db, diner, category, item, lifestyle, actor);
      const affordable = Number(actor.system?.wealth?.value ?? 0) >= state.cost;
      const servingBlocked = Boolean(requireConsumedServing && outstandingServing && state.covered && state.applies);
      const disabled = state.blocked || servingBlocked || !affordable;
      let priceText;
      let buttonText;
      if (servingBlocked) {
        priceText = `Use ${esc(outstandingServing.name)} first`;
        buttonText = "Serving Held";
      } else if (state.blocked) {
        priceText = "Covered allowance exhausted";
        buttonText = "Daily Limit";
      } else if (state.covered) {
        priceText = `Covered · ${esc(lifestyle.foodTier.label)}`;
        buttonText = "Order";
      } else if (state.exhausted && state.allowance.action === "charge") {
        priceText = `${state.cost} eb · coverage used`;
        buttonText = affordable ? "Buy" : "Too Poor";
      } else {
        priceText = `${state.cost} eb`;
        buttonText = affordable ? "Buy" : "Too Poor";
      }
      return `
        <div class="diner-menu-item" data-menu-item="${esc(item.id)}">
          <img class="diner-thumb" src="${esc(item.img || "icons/svg/box.svg")}">
          <div style="min-width:0">
            <div class="diner-menu-name" title="${esc(item.name)}">${esc(item.name)}</div>
            <div class="${state.covered ? "diner-price-covered" : "diner-price-paid"}">${priceText}</div>
          </div>
          <button type="button" class="diner-btn" data-order="${esc(item.id)}" ${disabled ? "disabled" : ""}>
            <i class="fas fa-utensils"></i> ${buttonText}
          </button>
        </div>`;
    }).join("") : `<div class="diner-menu-item diner-muted">No items in this category.</div>`;

    return `
      <div class="diner-menu-category">
        <div class="diner-menu-category-header">
          <span>${esc(category.label)}</span>
          <span class="diner-muted">${esc(categoryRuleLabel(category))}</span>
        </div>
        ${rows}
      </div>`;
  }).join("");

  const allowanceText = allowance.unlimited
    ? "Unlimited"
    : `${allowance.remaining}/${allowance.limit} remaining`;
  const allowanceScope = allowance.scope === "diner" ? "at this diner" : "across all diners";

  return `
    <div class="diner-shell diner-player-shell" data-player-diner="${esc(diner.id)}">
      <div class="diner-header">
        <img class="diner-logo" src="${esc(diner.img || DEFAULT_DINER_ICON)}">
        <div style="flex:1">
          <div class="diner-title">${esc(diner.name)}</div>
          <div class="diner-subtitle">${esc(diner.subtitle ?? "")}</div>
        </div>
        <div class="diner-customer">
          <div class="diner-entry-name">${esc(actor.name)}</div>
          <div class="diner-muted">${Number(actor.system?.wealth?.value ?? 0)} eb</div>
        </div>
      </div>
      <div class="diner-lifestyle-summary">
        <div class="diner-pill"><b>Food Plan</b><br>${esc(lifestyle.foodTier.label)}</div>
        <div class="diner-pill"><b>Housing</b><br>${esc(lifestyle.housingName)}</div>
        <div class="diner-pill"><b>Monthly Total</b><br>${lifestyle.totalMonthly} eb</div>
        <div class="diner-pill"><b>Covered Meals Today</b><br>${allowanceText}<span class="diner-pill-note">${allowanceScope}</span></div>
      </div>
      ${requireConsumedServing && outstandingServing ? `<div class="diner-card diner-warning"><i class="fas fa-hourglass-half"></i> Consume or remove <b>${esc(outstandingServing.name)}</b> before requesting another lifestyle-covered serving.</div>` : ""}
      <div class="diner-list">${categoryHtml || `<div class="diner-card diner-muted">This menu is empty.</div>`}</div>
    </div>`;
}

async function executeOrder(payload) {
  const db = await loadDB();
  const diner = db.diners[payload.dinerId];
  if (!diner) throw new Error("Diner not found.");
  const item = (diner.items ?? []).find((candidate) => candidate.id === payload.itemId);
  if (!item) throw new Error("Menu item not found.");
  const category = diner.categories.find((candidate) => candidate.id === item.categoryId) ?? { ruleType: "alwaysPay", label: "Other" };
  const actor = await fromUuid(payload.actorUuid);
  if (!actor) throw new Error("Ordering actor not found.");

  const lifestyle = inspectLifestyle(actor);
  const itemDoc = await resolveItem(item.uuid);
  if (diner.deliveryMode === "inventory" && !itemDoc) throw new Error("The menu Item no longer exists.");

  const provisionalState = resolveOrderState(db, diner, category, item, lifestyle, actor, loadMealLedger());
  const config = coveredOrderConfig(db);
  const outstandingServing = findOutstandingCoveredServing(actor);
  if (config.requireConsumedServing && outstandingServing && provisionalState.covered && provisionalState.applies) {
    throw new Error(`Use or remove ${outstandingServing.name} before ordering another covered serving.`);
  }

  const authorization = await authorizeOrder(db, diner, category, item, lifestyle, actor);
  const state = authorization.state;
  let finalAllowance = authorization.finalAllowance;
  const reservation = authorization.reservation;
  const funds = Number(actor.system?.wealth?.value ?? 0);

  if (funds < state.cost) {
    await rollbackCoveredReservation(reservation);
    throw new Error(`${actor.name} cannot afford ${item.name} (${state.cost} eb).`);
  }

  let debited = false;
  try {
    if (state.cost > 0) {
      await adjustWealth(actor, -state.cost, `Diner: ${diner.name} — ${item.name}`);
      debited = true;
    }

    if (diner.deliveryMode === "inventory") {
      await giveItem(actor, itemDoc, {
        coveredServing: Boolean(state.covered && state.applies),
        dinerId: diner.id,
        dinerName: diner.name,
        menuItemId: item.id,
        orderedDayKey: finalAllowance.dayKey,
        requestId: payload.requestId
      });
    }
  } catch (error) {
    if (debited) {
      try {
        await adjustWealth(actor, state.cost, `Diner refund: ${diner.name} — ${item.name}`);
      } catch (refundError) {
        console.error(`${MODULE_ID} | Failed to refund a failed order`, refundError);
      }
    }
    await rollbackCoveredReservation(reservation);
    throw error;
  }

  if (diner.publicChat) {
    const payment = state.covered
      ? `covered by <b>${esc(lifestyle.foodTier.label)}</b>`
      : `paid <b>${state.cost} eb</b>`;
    const remaining = state.covered && state.applies && !finalAllowance.unlimited
      ? ` <span style="opacity:.75">(${finalAllowance.remaining} covered meal${finalAllowance.remaining === 1 ? "" : "s"} remaining today)</span>`
      : "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ alias: diner.name }),
      content: `<b>${esc(actor.name)}</b> ordered <i>${esc(item.name)}</i> from <b>${esc(diner.name)}</b> — ${payment}.${remaining}`
    });
  }

  return {
    ok: true,
    cost: state.cost,
    covered: state.covered,
    itemName: item.name,
    funds: funds - state.cost,
    remaining: state.applies && !finalAllowance.unlimited ? finalAllowance.remaining : null,
    limit: finalAllowance.limit,
    consumedAllowance: state.covered && state.applies
  };
}

async function processOrder(payload) {
  if (processedRequests.has(payload.requestId)) return;
  processedRequests.add(payload.requestId);

  try {
    const response = await queueActorOrder(payload.actorUuid, () => executeOrder(payload));
    sendOrderResponse(payload, response);
  } catch (error) {
    console.error(`${MODULE_ID} | Order failed`, error);
    sendOrderResponse(payload, { ok: false, error: error.message || "Order failed." });
  } finally {
    setTimeout(() => processedRequests.delete(payload.requestId), 30000);
  }
}

function sendOrderResponse(payload, response) {
  const message = {
    op: "order-response",
    requestId: payload.requestId,
    userId: payload.userId,
    ...response
  };
  game.socket.emit(SOCKET_NAME, message);
  handleOrderResponse(message);
}

function handleOrderResponse(message) {
  if (message.userId !== game.user.id) return;
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  pendingRequests.delete(message.requestId);
  clearTimeout(pending.timeout);
  if (message.ok) pending.resolve(message);
  else pending.reject(new Error(message.error || "Order failed."));
}

async function requestOrder(dinerId, itemId, actor) {
  const requestId = `${Date.now()}-${makeId()}`;
  const payload = {
    op: "order",
    requestId,
    userId: game.user.id,
    dinerId,
    itemId,
    actorUuid: actor.uuid
  };

  const activeGM = game.users.activeGM;
  if (game.user.isGM && (!activeGM || activeGM.id === game.user.id)) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error("Diner order timed out."));
      }, 10000);
      pendingRequests.set(requestId, { resolve, reject, timeout });
      processOrder(payload);
    });
  }

  if (!activeGM) throw new Error("A GM must be online to process diner orders.");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("The GM did not process the diner order."));
    }, 10000);
    pendingRequests.set(requestId, { resolve, reject, timeout });
    game.socket.emit(SOCKET_NAME, payload);
  });
}

async function openDiner(dinerId, { actor = null, preview = false } = {}) {
  const db = await loadDB();
  const diner = db.diners[dinerId];
  if (!diner) return ui.notifications.warn(`Diner not found: ${dinerId}`);

  if (diner.sceneOnly && diner.sceneId && canvas?.scene?.id !== diner.sceneId && !game.user.isGM) {
    return ui.notifications.warn(`${diner.name} is not available on this scene.`);
  }

  actor ??= getActorFromContext();
  if (!actor) return ui.notifications.warn("Select a token or set a User Character first.");
  const lifestyle = inspectLifestyle(actor);
  const content = renderPlayerMenu(db, diner, actor, lifestyle);

  const dialog = openDialog({
    title: `${diner.name}${preview ? " — Preview" : ""}`,
    content,
    buttons: {
      ...(game.user.isGM ? {
        lifestyle: {
          label: "Lifestyle Override",
          callback: () => openLifestyleOverride(actor)
        }
      } : {}),
      close: { label: "Close" }
    },
    render: (html) => {
      const app = html[0].closest(".app");
      setDialogAccent(app, themeAccent(db));
      const root = html[0].querySelector("[data-player-diner]");
      root.addEventListener("click", async (event) => {
        const itemId = event.target.closest("[data-order]")?.dataset.order;
        if (!itemId) return;
        const button = event.target.closest("[data-order]");
        button.disabled = true;
        const previous = button.innerHTML;
        button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Ordering`;
        try {
          const response = await requestOrder(diner.id, itemId, actor);
          const remaining = response.consumedAllowance && response.remaining != null ? ` — ${response.remaining} covered meal${response.remaining === 1 ? "" : "s"} remaining today` : "";
          ui.notifications.info(`${response.itemName} ordered${response.covered ? " — lifestyle covered" : ` — ${response.cost} eb`}${remaining}.`);
          dialog.close();
          if (!preview) openDiner(diner.id, { actor, preview: false });
        } catch (error) {
          ui.notifications.error(error.message || "Order failed.");
          button.disabled = false;
          button.innerHTML = previous;
        }
      });
    }
  }, { width: 820 });

  return dialog;
}

async function ensureWorldMacros() {
  if (!game.user.isGM) return;
  const activeGM = game.users.activeGM;
  if (activeGM && activeGM.id !== game.user.id) return;

  const macroSpecs = [
    {
      name: "Diner™ Manager",
      img: DEFAULT_DINER_ICON,
      command: "game.dinerManager.openManager();"
    },
    {
      name: "Diner™ Launcher",
      img: DEFAULT_DINER_ICON,
      command: `let dinerId = null;\ntry {\n  if (Array.isArray(args) && args[0]?.id) dinerId = String(args[0].id);\n  else if (Array.isArray(args) && typeof args[0] === "string") dinerId = String(args[0]).replace(/^id\\s*=\\s*/i, "");\n  else if (!Array.isArray(args) && args?.id) dinerId = String(args.id);\n} catch {}\nif (!dinerId) return ui.notifications.warn("Diner ID missing. Use id=YOUR-DINER-ID.");\ngame.dinerManager.open(dinerId.replace(/[<>"'()\\[\\]\\s]/g, ""));`
    },
    {
      name: "Diner™ Tile Launcher",
      img: DEFAULT_DINER_ICON,
      command: `return game.dinerManager.openTile({\n  args: typeof args === "undefined" ? null : args,\n  tile: typeof tile === "undefined" ? null : tile,\n  token: typeof token === "undefined" ? null : token,\n  actor: typeof actor === "undefined" ? null : actor\n});`
    }
  ];

  for (const spec of macroSpecs) {
    const existing = game.macros.getName(spec.name);
    if (!existing) {
      await Macro.create({ name: spec.name, type: "script", scope: "global", img: spec.img, command: spec.command });
      continue;
    }
    const changes = {};
    if (existing.img !== spec.img) changes.img = spec.img;
    // Preserve any GM customization to an existing macro command. The generated
    // command is only authoritative when Diner creates the macro for the first time.
    if (Object.keys(changes).length) {
      try { await existing.update(changes); }
      catch (error) { console.warn(`${MODULE_ID} | Could not refresh ${spec.name}`, error); }
    }
  }
}

function bindSocket() {
  game.socket.on(SOCKET_NAME, async (message) => {
    if (!message) return;
    if (message.op === "order-response") return handleOrderResponse(message);
    if (message.op === "order") {
      if (!game.user.isGM) return;
      const activeGM = game.users.activeGM;
      if (activeGM && activeGM.id !== game.user.id) return;
      return processOrder(message);
    }
  });
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_DB, {
    name: "Diner Manager Database",
    scope: "world",
    config: false,
    type: Object,
    default: defaultDB()
  });

  game.settings.register(MODULE_ID, SETTING_MEAL_LEDGER, {
    name: "Diner Manager Covered Meal Ledger",
    scope: "world",
    config: false,
    type: Object,
    default: defaultMealLedger()
  });
});

Hooks.once("ready", async () => {
  bindSocket();
  bindAutoTileHook();

  const rawDb = game.settings.get(MODULE_ID, SETTING_DB);
  const activeGM = game.users.activeGM;
  if (game.user.isGM && (!activeGM || activeGM.id === game.user.id) && Number(rawDb?._ver ?? 0) < DB_VERSION) {
    await saveDB(migrateDB(rawDb));
  }

  game.dinerManager = {
    openManager,
    open: openDiner,
    openDiner,
    openTile: openFromTileContext,
    edit: openDinerEditor,
    createMenuItem: createWorldMenuItem,
    inspectLifestyle,
    openLifestyleOverride,
    inspectCoveredAllowance: (actor, dinerId = "global") => inspectCoveredAllowance(migrateDB(game.settings.get(MODULE_ID, SETTING_DB)), actor, dinerId, loadMealLedger()),
    findOutstandingCoveredServing,
    isOutstandingCoveredServing,
    getServingAmount,
    resetCoveredOrders: async (actor = getActorFromContext()) => {
      if (!game.user.isGM) throw new Error("Only a GM can reset covered meal counts.");
      if (!actor) throw new Error("No actor selected.");
      await resetCoveredOrders(actor);
      return true;
    },
    clearCoveredServingLocks: async (actor = getActorFromContext()) => {
      if (!game.user.isGM) throw new Error("Only a GM can clear covered serving locks.");
      if (!actor) throw new Error("No actor selected.");
      return clearCoveredServingLocks(actor);
    },
    bindSelectedTile: async (dinerId) => {
      if (!game.user.isGM) throw new Error("Only a GM can bind Diner Tiles.");
      const db = await loadDB();
      const diner = db.diners[dinerId];
      const tiles = selectedTileDocuments();
      if (!diner) throw new Error(`Diner not found: ${dinerId}`);
      if (tiles.length !== 1) throw new Error("Select exactly one Tile first.");
      await bindDinerToTile(diner, tiles[0], db);
      await saveDB(db);
      return diner;
    },
    unbindSelectedTiles: async (dinerId) => {
      if (!game.user.isGM) throw new Error("Only a GM can unbind Diner Tiles.");
      const db = await loadDB();
      const diner = db.diners[dinerId];
      const tiles = selectedTileDocuments();
      if (!diner) throw new Error(`Diner not found: ${dinerId}`);
      if (!tiles.length) throw new Error("Select one or more Tiles first.");
      for (const tile of tiles) {
        if ((diner.tileUuids || []).includes(tile.uuid)) await unbindDinerFromTile(diner, tile);
      }
      await saveDB(db);
      return diner;
    },
    unbindAllTiles: async (dinerId) => {
      if (!game.user.isGM) throw new Error("Only a GM can unbind Diner Tiles.");
      const db = await loadDB();
      const diner = db.diners[dinerId];
      if (!diner) throw new Error(`Diner not found: ${dinerId}`);
      await clearDinerTileBindings(diner);
      await saveDB(db);
      return diner;
    },
    regenerate: async (dinerId) => {
      if (!game.user.isGM) throw new Error("Only a GM can regenerate diner menus.");
      const db = await loadDB();
      const diner = db.diners[dinerId];
      if (!diner) throw new Error(`Diner not found: ${dinerId}`);
      const count = await regenerateDinerMenu(diner);
      await saveDB(db);
      return count;
    },
    clearCaches: () => {
      itemSuggestionCache = null;
      tableSuggestionCache = null;
    }
  };

  await ensureWorldMacros();
  console.log(`${MODULE_ID} | Ready v${MODULE_VERSION}. Use game.dinerManager.openManager()`);
});



Hooks.on("deleteTile", async (tile, options, userId) => {
  if (!game.user?.isGM || userId !== game.user.id) return;
  const dinerId = dinerIdFromTile(tile);
  if (!dinerId) return;
  try {
    const db = await loadDB();
    const diner = db.diners?.[dinerId];
    if (!diner) return;
    diner.tileUuids = (diner.tileUuids || []).filter(uuid => uuid !== tile.uuid);
    await saveDB(db);
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not clean deleted Tile binding`, error);
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return;
  const tokenControls = controls.find(control => control.name === "token");
  if (!tokenControls) return;
  tokenControls.tools ||= [];
  if (tokenControls.tools.some(tool => tool.name === "diner-manager")) return;
  tokenControls.tools.push({
    name: "diner-manager",
    title: "Diner™ Manager",
    icon: "fas fa-mug-hot",
    button: true,
    visible: true,
    onClick: () => openManager()
  });
});
