// Block type definitions
export const BLOCK_TYPES = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  BIRCH_LOG: 5,
  BIRCH_LEAVES: 6,
  BIRCH_PLANKS: 7,
  COAL_ORE: 8,
  IRON_ORE: 9,
  GOLD_ORE: 10,
  GLASS: 11,
  WATER: 12,
};

export const BLOCK_NAMES = {
  [BLOCK_TYPES.AIR]: 'air',
  [BLOCK_TYPES.GRASS]: 'grass_block',
  [BLOCK_TYPES.DIRT]: 'dirt',
  [BLOCK_TYPES.STONE]: 'stone',
  [BLOCK_TYPES.SAND]: 'sand',
  [BLOCK_TYPES.BIRCH_LOG]: 'birch_log',
  [BLOCK_TYPES.BIRCH_LEAVES]: 'birch_leaves',
  [BLOCK_TYPES.BIRCH_PLANKS]: 'birch_planks',
  [BLOCK_TYPES.COAL_ORE]: 'coal_ore',
  [BLOCK_TYPES.IRON_ORE]: 'iron_ore',
  [BLOCK_TYPES.GOLD_ORE]: 'gold_ore',
  [BLOCK_TYPES.GLASS]: 'glass',
  [BLOCK_TYPES.WATER]: 'water_still',
};

// Which blocks have different textures per face
// Each face can have: texture name, and optional tint color
export const BLOCK_FACES = {
  [BLOCK_TYPES.GRASS]: {
    top: { texture: 'grass_block_top', color: 0x8fc870 },
    bottom: { texture: 'dirt' },
    front: { texture: 'grass_block_side' },
    back: { texture: 'grass_block_side' },
    left: { texture: 'grass_block_side' },
    right: { texture: 'grass_block_side' },
  },
  [BLOCK_TYPES.BIRCH_LOG]: {
    top: { texture: 'birch_log_top' },
    bottom: { texture: 'birch_log_top' },
    front: { texture: 'birch_log' },
    back: { texture: 'birch_log' },
    left: { texture: 'birch_log' },
    right: { texture: 'birch_log' },
  },
  [BLOCK_TYPES.BIRCH_LEAVES]: {
    top: { texture: 'birch_leaves', color: 0x7ec850 },
    bottom: { texture: 'birch_leaves', color: 0x7ec850 },
    front: { texture: 'birch_leaves', color: 0x7ec850 },
    back: { texture: 'birch_leaves', color: 0x7ec850 },
    left: { texture: 'birch_leaves', color: 0x7ec850 },
    right: { texture: 'birch_leaves', color: 0x7ec850 },
  },
  [BLOCK_TYPES.WATER]: {
    top: { texture: 'water_still', color: 0x8888ff },
    bottom: { texture: 'water_still', color: 0x8888ff },
    front: { texture: 'water_still', color: 0x8888ff },
    back: { texture: 'water_still', color: 0x8888ff },
    left: { texture: 'water_still', color: 0x8888ff },
    right: { texture: 'water_still', color: 0x8888ff },
  },
};

// Block properties
export const BLOCK_PROPERTIES = {
  [BLOCK_TYPES.AIR]: { solid: false, transparent: true, name: 'Air' },
  [BLOCK_TYPES.GRASS]: { solid: true, transparent: false, name: 'Grass Block' },
  [BLOCK_TYPES.DIRT]: { solid: true, transparent: false, name: 'Dirt' },
  [BLOCK_TYPES.STONE]: { solid: true, transparent: false, name: 'Stone' },
  [BLOCK_TYPES.SAND]: { solid: true, transparent: false, name: 'Sand' },
  [BLOCK_TYPES.BIRCH_LOG]: { solid: true, transparent: false, name: 'Birch Log' },
  [BLOCK_TYPES.BIRCH_LEAVES]: { solid: true, transparent: true, name: 'Birch Leaves' },
  [BLOCK_TYPES.BIRCH_PLANKS]: { solid: true, transparent: false, name: 'Birch Planks' },
  [BLOCK_TYPES.COAL_ORE]: { solid: true, transparent: false, name: 'Coal Ore' },
  [BLOCK_TYPES.IRON_ORE]: { solid: true, transparent: false, name: 'Iron Ore' },
  [BLOCK_TYPES.GOLD_ORE]: { solid: true, transparent: false, name: 'Gold Ore' },
  [BLOCK_TYPES.GLASS]: { solid: true, transparent: true, name: 'Glass' },
  [BLOCK_TYPES.WATER]: { solid: false, transparent: true, name: 'Water' },
};

// Blocks that can be placed by player (in hotbar order)
export const PLACEABLE_BLOCKS = [
  BLOCK_TYPES.DIRT,
  BLOCK_TYPES.STONE,
  BLOCK_TYPES.SAND,
  BLOCK_TYPES.BIRCH_LOG,
  BLOCK_TYPES.BIRCH_LEAVES,
  BLOCK_TYPES.BIRCH_PLANKS,
  BLOCK_TYPES.COAL_ORE,
  BLOCK_TYPES.IRON_ORE,
  BLOCK_TYPES.GOLD_ORE,
  BLOCK_TYPES.GLASS,
];
