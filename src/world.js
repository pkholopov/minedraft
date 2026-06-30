import * as THREE from 'three';
import { BLOCK_TYPES, BLOCK_PROPERTIES, BLOCK_NAMES, BLOCK_FACES } from './blocks.js';
import { createBlockMaterial, loadTexture, BASE } from './textures.js';

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const RENDER_DISTANCE = 4;

const _neighborOffsets = [
  { dx: 1, dy: 0, dz: 0 },
  { dx: -1, dy: 0, dz: 0 },
  { dx: 0, dy: 1, dz: 0 },
  { dx: 0, dy: -1, dz: 0 },
  { dx: 0, dy: 0, dz: 1 },
  { dx: 0, dy: 0, dz: -1 },
];

// Face vertices in local block space [0..1] range.
// Order: CCW (counter-clockwise) when viewed from outside the block.
// This ensures FrontSide rendering works correctly.
// Side faces (right, left, front, back) use original CW order — they worked
// with FrontSide because the winding is consistent with how they're viewed.
// Top and bottom faces are CCW to be visible from above/below.
const FACE_VERTICES = [
  [[ 1, 0, 0], [ 1, 1, 0], [ 1, 1, 1], [ 1, 0, 1]],  // right (+x)
  [[ 0, 0, 1], [ 0, 1, 1], [ 0, 1, 0], [ 0, 0, 0]],  // left (-x)
  [[ 0, 1, 1], [ 1, 1, 1], [ 1, 1, 0], [ 0, 1, 0]],  // top (+y) — CCW
  [[ 0, 0, 0], [ 1, 0, 0], [ 1, 0, 1], [ 0, 0, 1]],  // bottom (-y) — CCW
  [[ 0, 0, 1], [ 1, 0, 1], [ 1, 1, 1], [ 0, 1, 1]],  // front (+z)
  [[ 1, 0, 0], [ 0, 0, 0], [ 0, 1, 0], [ 1, 1, 0]],  // back (-z)
];

const FACE_NORMALS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

const FACE_UVS = [
  [0, 0, 0, 1, 1, 1, 1, 0],
  [1, 0, 1, 1, 0, 1, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [0, 0, 1, 0, 1, 1, 0, 1],
  [0, 0, 1, 0, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
];

// Material index mapping
const MATERIAL_INDICES = new Map();
let _nextMatIndex = 0;

function getMaterialIndex(blockType, faceIndex) {
  const key = faceIndex >= 0 ? `${blockType}_f${faceIndex}` : `${blockType}`;
  if (!MATERIAL_INDICES.has(key)) {
    MATERIAL_INDICES.set(key, _nextMatIndex++);
  }
  return MATERIAL_INDICES.get(key);
}

let _seed = 0;

function setSeed(seed) {
  _seed = seed;
}

function hash(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 1274126177 + _seed * 123456789;
  h = (h ^ (h >> 13)) * 1274126177;
  return h ^ (h >> 16);
}

function smoothNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);

  const n00 = (hash(ix, 0, iz) & 0xffff) / 65536;
  const n10 = (hash(ix + 1, 0, iz) & 0xffff) / 65536;
  const n01 = (hash(ix, 0, iz + 1) & 0xffff) / 65536;
  const n11 = (hash(ix + 1, 0, iz + 1) & 0xffff) / 65536;

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sz;
}

function getTerrainHeight(x, z) {
  const h1 = smoothNoise(x * 0.03, z * 0.03);
  const h2 = smoothNoise(x * 0.06, z * 0.06) * 0.5;
  const h3 = smoothNoise(x * 0.015, z * 0.015) * 2;
  return Math.floor((h1 + h2 + h3) * 15 + 20);
}

function getBlockTypeAt(x, y, z, height) {
  if (y > height) return BLOCK_TYPES.AIR;
  if (y === height) {
    if (height < 18) return BLOCK_TYPES.SAND;
    return BLOCK_TYPES.GRASS;
  }
  if (y > height - 3) return BLOCK_TYPES.DIRT;
  const r = (hash(x, y, z) & 0xffff) / 65536;
  if (r < 0.005 && y < 30) return BLOCK_TYPES.GOLD_ORE;
  if (r < 0.015 && y < 40) return BLOCK_TYPES.IRON_ORE;
  if (r < 0.03 && y < 50) return BLOCK_TYPES.COAL_ORE;
  return BLOCK_TYPES.STONE;
}

const _transparentCache = new Map();
function isTransparent(blockType) {
  if (!_transparentCache.has(blockType)) {
    const props = BLOCK_PROPERTIES[blockType];
    _transparentCache.set(blockType, !props || !props.solid || !!props.transparent);
  }
  return _transparentCache.get(blockType);
}

// Check if a block type should be rendered in the mesh
// Returns true for solid blocks AND water (non-solid but visible)
function isRenderable(blockType) {
  if (blockType === BLOCK_TYPES.AIR) return false;
  if (blockType === BLOCK_TYPES.WATER) return true;
  const props = BLOCK_PROPERTIES[blockType];
  return props && props.solid;
}

export class World {
  constructor(scene, seed = 0) {
    setSeed(seed);
    this.scene = scene;
    this.chunks = new Map();
    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);
    this.loadedChunks = new Set();

    // Frustum culling
    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();
    this._chunkBox = new THREE.Box3();
    this._chunkCenter = new THREE.Vector3();
    this._chunkHalfSize = new THREE.Vector3(
      CHUNK_SIZE / 2 + 1,
      CHUNK_HEIGHT / 2 + 4,
      CHUNK_SIZE / 2 + 1
    );

    this._lastPcx = -999;
    this._lastPcz = -999;

    // Global material array for all chunk meshes
    this._materials = [];

    // Queue for chunks that need mesh rebuild after neighbors load
    this._rebuildQueue = new Set();

    // Pre-load water texture for animation
    this._waterTexture = loadTexture(`${BASE}blocks/water_still.png`);
  }

  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  // Get water level at a given world position using noise
  // Returns -1 if no water, otherwise the water surface height
  _getWaterLevel(wx, wz) {
    // Use noise to determine the base water level
    const waterNoise = smoothNoise(wx * 0.008, wz * 0.008);
    // Water level varies between 25 and 44
    const level = 25 + Math.floor(waterNoise * 19);

    // Only create water where terrain is below the water level
    const terrainHeight = getTerrainHeight(wx, wz);
    if (terrainHeight >= level) return -1;

    return level;
  }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    // Height map for each column - stores max Y with a solid block
    const heightMap = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = cx * CHUNK_SIZE + x;
        const wz = cz * CHUNK_SIZE + z;
        const height = getTerrainHeight(wx, wz);
        heightMap[z * CHUNK_SIZE + x] = height;
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
          blocks[idx] = getBlockTypeAt(wx, y, wz, height);
        }
      }
    }

    // Fill water in lake regions
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = cx * CHUNK_SIZE + x;
        const wz = cz * CHUNK_SIZE + z;
        const height = heightMap[z * CHUNK_SIZE + x];
        const waterLevel = this._getWaterLevel(wx, wz);
        if (waterLevel < 0) continue;
        // Only fill if terrain is below water level
        if (height >= waterLevel) continue;
        for (let y = height + 1; y <= waterLevel; y++) {
          if (y >= 0 && y < CHUNK_HEIGHT) {
            const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
            if (blocks[idx] === BLOCK_TYPES.AIR) {
              blocks[idx] = BLOCK_TYPES.WATER;
            }
          }
        }
      }
    }

    // Generate birch trees on grass
    this._generateTrees(cx, cz, blocks, heightMap);

    // Update heightMap with trees (solid blocks only, not water)
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
          if (blocks[idx] !== BLOCK_TYPES.AIR) {
            const props = BLOCK_PROPERTIES[blocks[idx]];
            if (props && props.solid) {
              heightMap[z * CHUNK_SIZE + x] = y;
              break;
            }
          }
        }
      }
    }

    return { blocks, heightMap };
  }

  // Place a square layer of leaves centered at (cx, cz) at height y
  _placeLeafLayer(cx, cz, y, size, blocks, chunkSize, randomSkip) {
    const half = Math.floor(size / 2);
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        const lx = cx + dx;
        const lz = cz + dz;
        if (lx < 0 || lx >= chunkSize || lz < 0 || lz >= chunkSize) continue;

        const isOuter = Math.abs(dx) === half || Math.abs(dz) === half;

        if (isOuter && randomSkip > 0) {
          const skipHash = (hash(cx + dx * 31, y * 7, cz + dz * 37) & 0xffff) / 65536;
          if (skipHash < randomSkip) continue;
        }

        const idx = (y * chunkSize + lz) * chunkSize + lx;
        if (blocks[idx] === BLOCK_TYPES.AIR || blocks[idx] === BLOCK_TYPES.WATER) {
          blocks[idx] = BLOCK_TYPES.BIRCH_LEAVES;
        }
      }
    }
  }

  _generateTrees(cx, cz, blocks, heightMap) {
    const margin = 2;
    for (let x = margin; x < CHUNK_SIZE - margin; x++) {
      for (let z = margin; z < CHUNK_SIZE - margin; z++) {
        const wx = cx * CHUNK_SIZE + x;
        const wz = cz * CHUNK_SIZE + z;
        const height = heightMap[z * CHUNK_SIZE + x];

        const surfaceIdx = (height * CHUNK_SIZE + z) * CHUNK_SIZE + x;
        if (blocks[surfaceIdx] !== BLOCK_TYPES.GRASS) continue;

        const r = (hash(wx, 7, wz) & 0xffff) / 65536;
        if (r > 0.01) continue;

        const trunkHeight = 4 + (hash(wx, 13, wz) & 3);
        const topY = height + trunkHeight;

        if (topY + 1 >= CHUNK_HEIGHT) continue;

        for (let dy = 1; dy <= trunkHeight; dy++) {
          const idx = ((height + dy) * CHUNK_SIZE + z) * CHUNK_SIZE + x;
          blocks[idx] = BLOCK_TYPES.BIRCH_LOG;
        }

        this._placeLeafLayer(x, z, topY + 1, 3, blocks, CHUNK_SIZE, 0);
        this._placeLeafLayer(x, z, topY, 5, blocks, CHUNK_SIZE, 0.3);
        this._placeLeafLayer(x, z, topY - 1, 5, blocks, CHUNK_SIZE, 0.3);
        this._placeLeafLayer(x, z, topY - 2, 5, blocks, CHUNK_SIZE, 1.0);
      }
    }
  }

  // Get block from any loaded chunk
  _getBlockAt(wx, wy, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = this.chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return BLOCK_TYPES.AIR;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BLOCK_TYPES.AIR;

    const idx = (wy * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
    return chunk.blocks[idx];
  }

  buildChunkMesh(cx, cz, blocks, heightMap) {
    const groupData = new Map();

    // Only iterate through Y range that actually has blocks
    let minHeight = CHUNK_HEIGHT;
    let maxHeight = 0;
    for (let i = 0; i < heightMap.length; i++) {
      const h = heightMap[i];
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
    }
    // Extend range to include possible water level (up to ~45)
    const yStart = Math.max(0, minHeight - 5);
    const yEnd = Math.min(CHUNK_HEIGHT, Math.max(maxHeight + 2, 46));

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let y = yStart; y < yEnd; y++) {
          const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
          const blockType = blocks[idx];
          if (!isRenderable(blockType)) continue;

          const props = BLOCK_PROPERTIES[blockType];
          const wx = cx * CHUNK_SIZE + x;
          const wz = cz * CHUNK_SIZE + z;
          const isMultiFace = !!BLOCK_FACES[blockType];

          for (let face = 0; face < 6; face++) {
            const n = _neighborOffsets[face];
            const nx = wx + n.dx;
            const ny = y + n.dy;
            const nz = wz + n.dz;

            // Check neighbor using all loaded chunks
            let neighborType = BLOCK_TYPES.AIR;
            if (ny >= 0 && ny < CHUNK_HEIGHT) {
              const ncx = Math.floor(nx / CHUNK_SIZE);
              const ncz = Math.floor(nz / CHUNK_SIZE);
              if (ncx === cx && ncz === cz) {
                const lx = nx - cx * CHUNK_SIZE;
                const lz = nz - cz * CHUNK_SIZE;
                const nidx = (ny * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
                neighborType = blocks[nidx];
              } else {
                neighborType = this._getBlockAt(nx, ny, nz);
              }
            }

            // Don't render face if neighbor is same type (water adjacent to water)
            if (neighborType === blockType) continue;
            if (!isTransparent(neighborType)) continue;

            const matIndex = getMaterialIndex(blockType, isMultiFace ? face : -1);

            let gd = groupData.get(matIndex);
            if (!gd) {
              gd = { positions: [], normals: [], uvs: [], indices: [], vCount: 0 };
              groupData.set(matIndex, gd);
            }

            const fv = FACE_VERTICES[face];
            const fn = FACE_NORMALS[face];

            gd.positions.push(
              x + fv[0][0], y + fv[0][1], z + fv[0][2],
              x + fv[1][0], y + fv[1][1], z + fv[1][2],
              x + fv[2][0], y + fv[2][1], z + fv[2][2],
              x + fv[3][0], y + fv[3][1], z + fv[3][2]
            );
            for (let i = 0; i < 4; i++) {
              gd.normals.push(fn[0], fn[1], fn[2]);
            }
            gd.uvs.push(...FACE_UVS[face]);

            const base = gd.vCount;
            gd.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            gd.vCount += 4;
          }
        }
      }
    }

    if (groupData.size === 0) return null;

    // Merge all groups into a single geometry
    let totalVerts = 0;
    let totalIndices = 0;
    const sortedGroups = [];
    for (const [matIndex, gd] of groupData) {
      sortedGroups.push({ matIndex, gd });
      totalVerts += gd.vCount;
      totalIndices += gd.indices.length;
    }
    sortedGroups.sort((a, b) => a.matIndex - b.matIndex);

    const mergedPos = new Float32Array(totalVerts * 3);
    const mergedNorm = new Float32Array(totalVerts * 3);
    const mergedUv = new Float32Array(totalVerts * 2);
    const mergedIdx = new Uint32Array(totalIndices);

    let vertOffset = 0;
    let idxOffset = 0;
    const groups = [];

    for (const { matIndex, gd } of sortedGroups) {
      const positions = new Float32Array(gd.positions);
      const normals = new Float32Array(gd.normals);
      const uvs = new Float32Array(gd.uvs);
      const indices = new Uint32Array(gd.indices);

      mergedPos.set(positions, vertOffset * 3);
      mergedNorm.set(normals, vertOffset * 3);
      mergedUv.set(uvs, vertOffset * 2);

      for (let i = 0; i < indices.length; i++) {
        mergedIdx[idxOffset + i] = indices[i] + vertOffset;
      }

      groups.push({
        start: idxOffset,
        count: indices.length,
        materialIndex: matIndex,
      });

      vertOffset += gd.vCount;
      idxOffset += indices.length;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
    geo.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
    geo.groups = groups;

    // Build material array
    const usedMatIndices = new Set();
    for (const g of groups) usedMatIndices.add(g.materialIndex);
    const maxIdx = Math.max(...usedMatIndices);
    const materials = [];
    for (let i = 0; i <= maxIdx; i++) {
      if (usedMatIndices.has(i)) {
        const mat = this._getOrCreateMaterial(i);
        materials[i] = mat || new THREE.MeshLambertMaterial({ color: 0xff00ff });
        if (!mat) console.warn(`Material ${i} is null, using fallback`);
      } else {
        materials[i] = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
      }
    }

    return { geometry: geo, materials };
  }

  _getOrCreateMaterial(matIndex) {
    if (this._materials[matIndex]) return this._materials[matIndex];

    let foundKey = null;
    for (const [key, idx] of MATERIAL_INDICES) {
      if (idx === matIndex) {
        foundKey = key;
        break;
      }
    }

    if (!foundKey) {
      console.warn(`Material index ${matIndex} not found in MATERIAL_INDICES (total entries: ${MATERIAL_INDICES.size})`);
      const fallback = new THREE.MeshLambertMaterial({ color: 0xff00ff });
      this._materials[matIndex] = fallback;
      return fallback;
    }

    const parts = foundKey.split('_f');
    const blockType = parseInt(parts[0]);
    const faceIndex = parts.length > 1 ? parseInt(parts[1]) : -1;

    const mat = createBlockMaterial(blockType);
    if (Array.isArray(mat)) {
      const idx = faceIndex >= 0 ? faceIndex : 0;
      const material = mat[idx];
      if (!material) {
        console.warn(`Material[${idx}] is null/undefined for blockType=${blockType}, key=${foundKey}, matIndex=${matIndex}. Array length=${mat.length}`);
        this._materials[matIndex] = mat[0] || new THREE.MeshLambertMaterial({ color: 0xff00ff });
      } else {
        this._materials[matIndex] = material;
      }
    } else if (mat) {
      this._materials[matIndex] = mat;
    } else {
      console.warn(`createBlockMaterial returned null for blockType=${blockType}, key=${foundKey}, matIndex=${matIndex}`);
      this._materials[matIndex] = new THREE.MeshLambertMaterial({ color: 0xff00ff });
    }
    return this._materials[matIndex];
  }

  _rebuildChunkMesh(cx, cz) {
    const key = this.chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    const result = this.buildChunkMesh(cx, cz, chunk.blocks, chunk.heightMap);
    if (!result) {
      return;
    }

    if (chunk.mesh) {
      this.meshGroup.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }

    const mesh = new THREE.Mesh(result.geometry, result.materials);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.frustumCulled = false;
    this.meshGroup.add(mesh);
    chunk.mesh = mesh;
  }

  loadChunk(cx, cz) {
    const key = this.chunkKey(cx, cz);
    if (this.loadedChunks.has(key)) return;

    const { blocks, heightMap } = this.generateChunk(cx, cz);
    const result = this.buildChunkMesh(cx, cz, blocks, heightMap);

    let mesh = null;
    if (result) {
      mesh = new THREE.Mesh(result.geometry, result.materials);
      mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
      mesh.frustumCulled = false;
      this.meshGroup.add(mesh);
    }
    this.chunks.set(key, { mesh, blocks, heightMap, cx, cz });
    this.loadedChunks.add(key);

    const neighbors = [
      [cx - 1, cz], [cx + 1, cz],
      [cx, cz - 1], [cx, cz + 1],
    ];
    for (const [ncx, ncz] of neighbors) {
      const nkey = this.chunkKey(ncx, ncz);
      if (this.loadedChunks.has(nkey)) {
        this._rebuildQueue.add(nkey);
      }
    }
  }

  unloadChunk(cx, cz) {
    const key = this.chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (chunk) {
      if (chunk.mesh) {
        this.meshGroup.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
      this.chunks.delete(key);
      this.loadedChunks.delete(key);
      this._rebuildQueue.delete(key);

      const neighbors = [
        [cx - 1, cz], [cx + 1, cz],
        [cx, cz - 1], [cx, cz + 1],
      ];
      for (const [ncx, ncz] of neighbors) {
        const nkey = this.chunkKey(ncx, ncz);
        if (this.loadedChunks.has(nkey)) {
          this._rebuildQueue.add(nkey);
        }
      }
    }
  }

  update(playerPos, camera) {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);

    if (pcx !== this._lastPcx || pcz !== this._lastPcz) {
      this._lastPcx = pcx;
      this._lastPcz = pcz;

      const toLoad = new Set();
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
        for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
          const distSq = dx * dx + dz * dz;
          if (distSq <= RENDER_DISTANCE * RENDER_DISTANCE) {
            toLoad.add(this.chunkKey(pcx + dx, pcz + dz));
          }
        }
      }

      for (const key of this.loadedChunks) {
        if (!toLoad.has(key)) {
          const [cx, cz] = key.split(',').map(Number);
          this.unloadChunk(cx, cz);
        }
      }

      for (const key of toLoad) {
        if (!this.loadedChunks.has(key)) {
          const [cx, cz] = key.split(',').map(Number);
          this.loadChunk(cx, cz);
        }
      }
    }

    // Process rebuild queue (max 2 per frame to avoid spikes)
    let rebuildCount = 0;
    for (const key of this._rebuildQueue) {
      if (rebuildCount >= 2) break;
      if (!this.loadedChunks.has(key)) {
        this._rebuildQueue.delete(key);
        continue;
      }
      const [cx, cz] = key.split(',').map(Number);
      this._rebuildChunkMesh(cx, cz);
      this._rebuildQueue.delete(key);
      rebuildCount++;
    }

    // Frustum culling every frame
    if (camera) {
      camera.updateMatrixWorld(true);
      this._projScreenMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      );
      this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

      for (const [, chunk] of this.chunks) {
        if (!chunk.mesh) continue;
        this._chunkCenter.set(
          chunk.cx * CHUNK_SIZE + CHUNK_SIZE / 2,
          CHUNK_HEIGHT / 2,
          chunk.cz * CHUNK_SIZE + CHUNK_SIZE / 2
        );
        this._chunkBox.setFromCenterAndSize(this._chunkCenter, this._chunkHalfSize);
        chunk.mesh.visible = this._frustum.intersectsBox(this._chunkBox);
      }
    }
  }

  getBlock(wx, wy, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = this.chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return BLOCK_TYPES.AIR;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BLOCK_TYPES.AIR;

    const idx = (wy * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
    return chunk.blocks[idx];
  }

  // Check if any neighbor block is water (used for water spreading)
  _hasWaterNeighbor(wx, wy, wz) {
    const directions = [
      { dx: 1, dy: 0, dz: 0 },
      { dx: -1, dy: 0, dz: 0 },
      { dx: 0, dy: 1, dz: 0 },
      { dx: 0, dy: -1, dz: 0 },
      { dx: 0, dy: 0, dz: 1 },
      { dx: 0, dy: 0, dz: -1 },
    ];
    for (const dir of directions) {
      if (this.getBlock(wx + dir.dx, wy + dir.dy, wz + dir.dz) === BLOCK_TYPES.WATER) {
        return true;
      }
    }
    return false;
  }

  // Spread water to neighboring empty spaces when a block is removed
  // Water fills empty spaces that are adjacent to existing water,
  // but only at or below the water source level
  _spreadWater(wx, wy, wz, _depth = 0) {
    // Prevent infinite recursion
    if (_depth > 16) return;
    // Find the water level by looking up for water blocks
    let waterLevel = -1;
    // Look upward from the removed block to find the water surface
    for (let y = wy; y <= 45; y++) {
      if (this.getBlock(wx, y, wz) === BLOCK_TYPES.WATER) {
        waterLevel = y;
        break;
      }
    }
    // Also check if there's water below
    if (waterLevel < 0) {
      for (let y = wy - 1; y >= 0; y--) {
        if (this.getBlock(wx, y, wz) === BLOCK_TYPES.WATER) {
          waterLevel = y;
          break;
        }
      }
    }
    // No water found in this column — check neighbors
    if (waterLevel < 0) {
      // Check if any neighbor is water
      if (!this._hasWaterNeighbor(wx, wy, wz)) return;
      // Use the removed block's Y as the water level
      waterLevel = wy;
    }

    // Don't spread above the water surface
    if (wy > waterLevel) return;

    // First, fill the current position (the removed block) if it's AIR
    const currentBlock = this.getBlock(wx, wy, wz);

    if (currentBlock === BLOCK_TYPES.AIR) {
      // Directly set the block data without triggering setBlock's rebuild/spread
      // to avoid infinite recursion. We'll rebuild the mesh after all spreading is done.
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cz = Math.floor(wz / CHUNK_SIZE);
      const key = this.chunkKey(cx, cz);
      const chunk = this.chunks.get(key);
      if (chunk) {
        const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const idx = (wy * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
        chunk.blocks[idx] = BLOCK_TYPES.WATER;
        // Continue to spread to neighbors below
      }
    }

    // Spread to horizontal neighbors and below
    const directions = [
      { dx: 1, dy: 0, dz: 0 },
      { dx: -1, dy: 0, dz: 0 },
      { dx: 0, dy: 0, dz: 1 },
      { dx: 0, dy: 0, dz: -1 },
      { dx: 0, dy: -1, dz: 0 }, // also spread downward
    ];

    for (const dir of directions) {
      const nx = wx + dir.dx;
      const ny = wy + dir.dy;
      const nz = wz + dir.dz;

      // Don't spread above water level
      if (ny > waterLevel) continue;

      const neighborType = this.getBlock(nx, ny, nz);
      if (neighborType === BLOCK_TYPES.AIR) {
        // Directly set block data without triggering setBlock
        const ncx = Math.floor(nx / CHUNK_SIZE);
        const ncz = Math.floor(nz / CHUNK_SIZE);
        const nkey = this.chunkKey(ncx, ncz);
        const nchunk = this.chunks.get(nkey);
        if (nchunk) {
          const nlx = ((nx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
          const nlz = ((nz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
          const nidx = (ny * CHUNK_SIZE + nlz) * CHUNK_SIZE + nlx;
          nchunk.blocks[nidx] = BLOCK_TYPES.WATER;
          // Recursively spread from the new water block
          this._spreadWater(nx, ny, nz, _depth + 1);
        }
      }
    }

    // After all spreading, rebuild the mesh for the affected chunks
    if (_depth === 0) {
      // Rebuild the chunk where the original block was removed
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cz = Math.floor(wz / CHUNK_SIZE);
      this._rebuildChunkMesh(cx, cz);
      // Also rebuild neighboring chunks that might have been affected
      const neighbors = [[cx-1,cz], [cx+1,cz], [cx,cz-1], [cx,cz+1]];
      for (const [ncx, ncz] of neighbors) {
        const nkey = this.chunkKey(ncx, ncz);
        if (this.loadedChunks.has(nkey)) {
          this._rebuildChunkMesh(ncx, ncz);
        }
      }
    }
  }

  setBlock(wx, wy, wz, blockType) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = this.chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;

    const idx = (wy * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
    const oldBlockType = chunk.blocks[idx];
    chunk.blocks[idx] = blockType;

    // Update height map for this column
    const hmIdx = lz * CHUNK_SIZE + lx;
    let newHeight = -1;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const checkIdx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
      if (chunk.blocks[checkIdx] !== BLOCK_TYPES.AIR) {
        const props = BLOCK_PROPERTIES[chunk.blocks[checkIdx]];
        if (props && props.solid) {
          newHeight = y;
          break;
        }
      }
    }
    chunk.heightMap[hmIdx] = newHeight;

    // Rebuild mesh for this chunk
    this._rebuildChunkMesh(cx, cz);

    // If a block was removed (set to AIR), try to spread water
    if (blockType === BLOCK_TYPES.AIR) {
      this._spreadWater(wx, wy, wz);
    }
  }

  // Update water animation UV offset
  // Since all water materials share the same cached texture, updating it once is enough
  updateWaterAnimation(offset) {
    if (this._waterTexture) {
      this._waterTexture.offset.y = offset;
    }
  }

  getHeightAt(wx, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = this.chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return -1;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.heightMap[lz * CHUNK_SIZE + lx];
  }

  getChunkSize() {
    return CHUNK_SIZE;
  }

  // Return all chunk meshes for raycasting
  getChunkMeshes() {
    const meshes = [];
    for (const [, chunk] of this.chunks) {
      if (chunk.mesh) meshes.push(chunk.mesh);
    }
    return meshes;
  }
}
