import * as THREE from 'three';
import { BLOCK_TYPES, BLOCK_NAMES, BLOCK_FACES, BLOCK_PROPERTIES } from './blocks.js';

// Base path for assets — used for GitHub Pages deployment (e.g. /minedraft/)
export const BASE = import.meta.env.BASE_URL || '/';

// Texture cache
const textureCache = new Map();

// Material cache - keyed by block type (and face index for multi-face)
const materialCache = new Map();

// Animated texture data: maps texture name -> { frames, frameHeight, totalHeight }
const animatedTextures = new Map();

export function loadTexture(path) {
  if (textureCache.has(path)) return textureCache.get(path);
  const loader = new THREE.TextureLoader();
  const tex = loader.load(path);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  textureCache.set(path, tex);
  return tex;
}

// Register an animated texture (atlas with multiple frames stacked vertically)
export function registerAnimatedTexture(textureName, frameCount) {
  animatedTextures.set(textureName, frameCount);
}

// Create a material for a block face
// faceConfig can be a string (texture name) or an object { texture, color }
function createFaceMaterial(faceConfig, transparent = false) {
  const textureName = typeof faceConfig === 'string' ? faceConfig : faceConfig.texture;
  const tintColor = typeof faceConfig === 'object' && faceConfig.color ? faceConfig.color : undefined;

  const path = `${BASE}blocks/${textureName}.png`;
  const map = loadTexture(path);

  // If this texture is animated, set up UV repeat on the texture itself
  const frameCount = animatedTextures.get(textureName);
  if (frameCount) {
    map.repeat.set(1, 1 / frameCount);
    map.offset.set(0, 0);
  }

  // Use DoubleSide only for transparent blocks (leaves, water, glass)
  // For opaque blocks, FrontSide (default) is correct — it avoids the dark
  // appearance on back faces caused by inverted normals in Lambert shading.
  const materialOptions = { map, side: transparent ? THREE.DoubleSide : THREE.FrontSide };
  if (tintColor !== undefined) {
    materialOptions.color = tintColor;
  }
  if (transparent) {
    materialOptions.transparent = true;
  }

  return new THREE.MeshLambertMaterial(materialOptions);
}

// Create a complete block mesh with per-face textures
export function createBlockMesh(blockType) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const materials = [];
  const props = BLOCK_PROPERTIES[blockType];
  const transparent = props && props.transparent;

  if (BLOCK_FACES[blockType]) {
    const faces = BLOCK_FACES[blockType];
    // Order: right, left, up, down, front, back
    materials.push(createFaceMaterial(faces.right, transparent));
    materials.push(createFaceMaterial(faces.left, transparent));
    materials.push(createFaceMaterial(faces.top, transparent));
    materials.push(createFaceMaterial(faces.bottom, transparent));
    materials.push(createFaceMaterial(faces.front, transparent));
    materials.push(createFaceMaterial(faces.back, transparent));
  } else {
    const texName = BLOCK_NAMES[blockType];
    const mat = createFaceMaterial(texName, transparent);
    for (let i = 0; i < 6; i++) materials.push(mat);
  }

  return new THREE.Mesh(geo, materials);
}

// Create a simple block mesh with a single material (for instanced rendering)
export function createBlockMaterial(blockType) {
  // Check material cache first
  const cacheKey = blockType;
  if (materialCache.has(cacheKey)) {
    const cached = materialCache.get(cacheKey);
    // Return a shallow copy for array materials (they're shared)
    if (Array.isArray(cached)) {
      return cached;
    }
    return cached;
  }

  const texName = BLOCK_NAMES[blockType];
  if (!texName) return null;

  const props = BLOCK_PROPERTIES[blockType];
  const transparent = props && props.transparent;

  let material;
  if (BLOCK_FACES[blockType]) {
    // For multi-face blocks, we need array materials
    const faces = BLOCK_FACES[blockType];
    material = [
      createFaceMaterial(faces.right, transparent),
      createFaceMaterial(faces.left, transparent),
      createFaceMaterial(faces.top, transparent),
      createFaceMaterial(faces.bottom, transparent),
      createFaceMaterial(faces.front, transparent),
      createFaceMaterial(faces.back, transparent),
    ];
  } else {
    const path = `${BASE}blocks/${texName}.png`;
    const map = loadTexture(path);
    const materialOptions = { map, side: transparent ? THREE.DoubleSide : THREE.FrontSide };
    if (transparent) {
      materialOptions.transparent = true;
    }
    material = new THREE.MeshLambertMaterial(materialOptions);
  }

  materialCache.set(cacheKey, material);
  return material;
}

// Get texture path for UI icons
export function getBlockTexturePath(blockType) {
  const texName = BLOCK_NAMES[blockType];
  if (!texName) return null;
  return `${BASE}blocks/${texName}.png`;
}

// Load a generic texture (for environment, items, etc.)
export function loadGenericTexture(path) {
  return loadTexture(path);
}
