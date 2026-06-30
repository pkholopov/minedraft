import * as THREE from 'three';
import { BLOCK_TYPES, BLOCK_PROPERTIES, PLACEABLE_BLOCKS } from './blocks.js';
import { getBlockTexturePath, BASE } from './textures.js';

const PLAYER_SPEED = 4.5;
const SWIM_SPEED = 2.5;
const JUMP_SPEED = 8;
const SWIM_UP_SPEED = 4;
const GRAVITY = -25;
const WATER_GRAVITY = -5;
const REACH_DISTANCE = 6;
const MOUSE_SENSITIVITY = 0.002;

// Player collision box dimensions (width/depth = 0.6, height = 1.8)
const PLAYER_RADIUS = 0.3;
const PLAYER_EYE_HEIGHT = 1.6;
const PLAYER_BODY_HEIGHT = 1.8;

export class Player {
  constructor(camera, scene, world, domElement) {
    this.camera = camera;
    this.scene = scene;
    this.world = world;
    this.domElement = domElement;

    // Position and movement
    this.position = new THREE.Vector3(8, 35, 8);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.onGround = false;
    this.yaw = 0;
    this.pitch = 0;

    // Input state
    this.keys = { forward: false, backward: false, left: false, right: false, jump: false, sneak: false };
    this.isLocked = false;

    // Block interaction
    this.selectedSlot = 0;
    this.health = 20;

    // Hand model
    this.handGroup = new THREE.Group();
    this.createHandModel();
    this.camera.add(this.handGroup);

    // Raycaster
    this.raycaster = new THREE.Raycaster();

    // Block highlight (wireframe box around targeted block)
    this.highlightBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.005, 1.005, 1.005)),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: true, transparent: true, opacity: 0.5 })
    );
    this.highlightBox.visible = false;
    this.scene.add(this.highlightBox);

    // Setup controls
    this.setupControls();

    // Setup UI
    this.setupUI();

    // Pre-allocated reusable objects to avoid GC in update loop
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._quat = new THREE.Quaternion();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();
  }

  createHandModel() {
    // Main arm segment
    const armGeo = new THREE.BoxGeometry(0.18, 0.5, 0.18);
    const armMat = new THREE.MeshLambertMaterial({ color: 0xc4a882 });
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(0.35, -0.3, -0.4);
    this.handGroup.add(arm);

    // Forearm
    const forearmGeo = new THREE.BoxGeometry(0.16, 0.35, 0.16);
    const forearmMat = new THREE.MeshLambertMaterial({ color: 0xc4a882 });
    const forearm = new THREE.Mesh(forearmGeo, forearmMat);
    forearm.position.set(0.35, -0.7, -0.4);
    this.handGroup.add(forearm);

    // Hand/fist
    const handGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const handMat = new THREE.MeshLambertMaterial({ color: 0xc4a882 });
    const hand = new THREE.Mesh(handGeo, handMat);
    hand.position.set(0.35, -0.95, -0.4);
    this.handGroup.add(hand);

    // Position the whole hand in bottom-right of view
    this.handGroup.position.set(0.4, -0.35, -0.5);

    this.swingAngle = 0;
    this.isSwinging = false;
  }

  setupControls() {
    // Pointer lock on canvas click
    this.domElement.addEventListener('click', () => {
      if (!this.isLocked) {
        this.domElement.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
    });

    // Mouse move
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * MOUSE_SENSITIVITY;
      this.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.pitch));
    });

    // Mouse click - block interaction
    document.addEventListener('mousedown', (e) => {
      if (!this.isLocked) return;
      if (e.button === 0) {
        this.breakBlock();
        this.swingHand();
      } else if (e.button === 2) {
        this.placeBlock();
      }
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard
    document.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'KeyW': this.keys.forward = true; break;
        case 'KeyS': this.keys.backward = true; break;
        case 'KeyA': this.keys.left = true; break;
        case 'KeyD': this.keys.right = true; break;
        case 'Space': this.keys.jump = true; break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.sneak = true; break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
          const num = parseInt(e.code.replace('Digit', '')) - 1;
          if (num < PLACEABLE_BLOCKS.length) {
            this.selectedSlot = num;
            this.updateHotbar();
          }
          break;
      }
    });

    document.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW': this.keys.forward = false; break;
        case 'KeyS': this.keys.backward = false; break;
        case 'KeyA': this.keys.left = false; break;
        case 'KeyD': this.keys.right = false; break;
        case 'Space': this.keys.jump = false; break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.sneak = false; break;
      }
    });
  }

  setupUI() {
    this.hotbarEl = document.getElementById('hotbar');
    this.heartsEl = document.getElementById('hearts');
    this.blockCountEl = document.getElementById('block-count');
    this.targetCoordsEl = document.getElementById('target-coords');
    this.buildHotbar();
    this.updateHearts();
  }

  buildHotbar() {
    this.hotbarEl.innerHTML = '';
    PLACEABLE_BLOCKS.forEach((blockType, i) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot' + (i === this.selectedSlot ? ' selected' : '');
      const num = document.createElement('span');
      num.className = 'slot-number';
      num.textContent = i + 1;
      slot.appendChild(num);
      const img = document.createElement('img');
      img.src = getBlockTexturePath(blockType);
      img.alt = BLOCK_PROPERTIES[blockType].name;
      slot.appendChild(img);
      this.hotbarEl.appendChild(slot);
    });
  }

  updateHotbar() {
    const slots = this.hotbarEl.querySelectorAll('.hotbar-slot');
    slots.forEach((slot, i) => {
      slot.className = 'hotbar-slot' + (i === this.selectedSlot ? ' selected' : '');
    });
  }

  updateHearts() {
    this.heartsEl.innerHTML = '';
    const fullHearts = Math.floor(this.health / 2);
    const hasHalf = this.health % 2 === 1;
    for (let i = 0; i < 10; i++) {
      const img = document.createElement('img');
      if (i < fullHearts) {
        img.src = `${BASE}gui/heart/full.png`;
      } else if (i === fullHearts && hasHalf) {
        img.src = `${BASE}gui/heart/half.png`;
      } else {
        img.src = `${BASE}gui/heart/full.png`;
        img.style.opacity = '0.2';
      }
      this.heartsEl.appendChild(img);
    }
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    this.updateHearts();
  }

  swingHand() {
    if (this.isSwinging) return;
    this.isSwinging = true;
    this.swingAngle = 0;
  }

  // Compute look direction directly from yaw/pitch angles.
  // Convention: yaw=0 -> looking along -Z, positive yaw -> clockwise from above.
  // pitch: positive = looking DOWN (from mouse: pitch -= movementY).
  getLookDirection() {
    const dir = new THREE.Vector3();
    const yaw = this.yaw;
    const pitch = this.pitch;
    // Spherical to Cartesian: yaw around Y, pitch around X
    // pitch > 0 = looking down, so dir.y = sin(pitch) (positive = down)
    dir.x = -Math.sin(yaw) * Math.cos(pitch);
    dir.y = Math.sin(pitch);
    dir.z = -Math.cos(yaw) * Math.cos(pitch);
    return dir;
  }

  // Get target block using DDA ray marching.
  // Uses the camera direction for pixel-perfect alignment with the crosshair.
  getTargetBlock() {
    // Sync camera to player state (mousedown may fire between frames)
    this.camera.position.copy(this.position);
    this.camera.position.y += PLAYER_EYE_HEIGHT;
    this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);

    // Build ray from camera through center of screen
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const dir = this.raycaster.ray.direction;
    const origin = this.raycaster.ray.origin;

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x >= 0 ? 1 : -1;
    const stepY = dir.y >= 0 ? 1 : -1;
    const stepZ = dir.z >= 0 ? 1 : -1;

    const tDeltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x);
    const tDeltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y);
    const tDeltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z);

    let tMaxX = dir.x >= 0
      ? (x + 1 - origin.x) / dir.x
      : (origin.x - x) / -dir.x;
    let tMaxY = dir.y >= 0
      ? (y + 1 - origin.y) / dir.y
      : (origin.y - y) / -dir.y;
    let tMaxZ = dir.z >= 0
      ? (z + 1 - origin.z) / dir.z
      : (origin.z - z) / -dir.z;

    if (dir.x === 0) tMaxX = Infinity;
    if (dir.y === 0) tMaxY = Infinity;
    if (dir.z === 0) tMaxZ = Infinity;

    for (let i = 0; i < 80; i++) {
      const blockType = this.world.getBlock(x, y, z);
      if (blockType !== BLOCK_TYPES.AIR) {
        const props = BLOCK_PROPERTIES[blockType];
        // Water is not clickable — ray passes through it like air
        if (props && props.solid) {
          return { x, y, z, blockType };
        }
      }

      // Advance to next voxel along the ray.
      // Use strict < to always step along exactly one axis per iteration.
      // This prevents skipping blocks at diagonal corners.
      if (tMaxX < tMaxY) {
        if (tMaxX > REACH_DISTANCE) break;
        x += stepX;
        tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > REACH_DISTANCE) break;
        y += stepY;
        tMaxY += tDeltaY;
      } else {
        if (tMaxZ > REACH_DISTANCE) break;
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    return null;
  }

  getPlacePosition() {
    // Sync camera to player state
    this.camera.position.copy(this.position);
    this.camera.position.y += PLAYER_EYE_HEIGHT;
    this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);

    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const dir = this.raycaster.ray.direction;
    const origin = this.raycaster.ray.origin;

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x >= 0 ? 1 : -1;
    const stepY = dir.y >= 0 ? 1 : -1;
    const stepZ = dir.z >= 0 ? 1 : -1;

    const tDeltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x);
    const tDeltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y);
    const tDeltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z);

    let tMaxX = dir.x >= 0
      ? (x + 1 - origin.x) / dir.x
      : (origin.x - x) / -dir.x;
    let tMaxY = dir.y >= 0
      ? (y + 1 - origin.y) / dir.y
      : (origin.y - y) / -dir.y;
    let tMaxZ = dir.z >= 0
      ? (z + 1 - origin.z) / dir.z
      : (origin.z - z) / -dir.z;

    if (dir.x === 0) tMaxX = Infinity;
    if (dir.y === 0) tMaxY = Infinity;
    if (dir.z === 0) tMaxZ = Infinity;

    let lastAir = null;

    for (let i = 0; i < 80; i++) {
      const blockType = this.world.getBlock(x, y, z);
      if (blockType !== BLOCK_TYPES.AIR) {
        const props = BLOCK_PROPERTIES[blockType];
        // Water is not clickable — ray passes through it like air
        if (props && props.solid) {
          return lastAir;
        }
      } else {
        lastAir = { x, y, z };
      }

      // Advance to next voxel along the ray.
      // Use strict < to always step along exactly one axis per iteration.
      if (tMaxX < tMaxY) {
        if (tMaxX > REACH_DISTANCE) break;
        x += stepX;
        tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > REACH_DISTANCE) break;
        y += stepY;
        tMaxY += tDeltaY;
      } else {
        if (tMaxZ > REACH_DISTANCE) break;
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    return null;
  }

  breakBlock() {
    const target = this.getTargetBlock();
    if (!target) return;

    // Don't break blocks too close to player (check against AABB)
    const half = PLAYER_RADIUS;
    const px = this.position.x;
    const py = this.position.y;
    const pz = this.position.z;
    // Block AABB
    const bx = target.x;
    const by = target.y;
    const bz = target.z;
    // Check if block AABB overlaps player AABB expanded by 0.5 (too close)
    const overlapX = (px - half - 0.5) < (bx + 1) && (px + half + 0.5) > bx;
    const overlapY = (py - 0.5) < (by + 1) && (py + PLAYER_BODY_HEIGHT + 0.5) > by;
    const overlapZ = (pz - half - 0.5) < (bz + 1) && (pz + half + 0.5) > bz;
    if (overlapX && overlapY && overlapZ) return;

    this.world.setBlock(target.x, target.y, target.z, BLOCK_TYPES.AIR);
  }

  placeBlock() {
    const pos = this.getPlacePosition();
    if (!pos) return;

    // Don't place inside player (check against AABB)
    const half = PLAYER_RADIUS;
    const px = this.position.x;
    const py = this.position.y;
    const pz = this.position.z;
    // Block AABB
    const bx = pos.x;
    const by = pos.y;
    const bz = pos.z;
    // Check if block AABB overlaps player AABB
    const overlapX = (px - half) < (bx + 1) && (px + half) > bx;
    const overlapY = py < (by + 1) && (py + PLAYER_BODY_HEIGHT) > by;
    const overlapZ = (pz - half) < (bz + 1) && (pz + half) > bz;
    if (overlapX && overlapY && overlapZ) return;

    const blockType = PLACEABLE_BLOCKS[this.selectedSlot];
    this.world.setBlock(pos.x, pos.y, pos.z, blockType);
  }

  // Check if an AABB (axis-aligned bounding box) overlaps any solid blocks
  // Returns true if the box collides with a solid block
  _isColliding(minX, minY, minZ, maxX, maxY, maxZ) {
    const startX = Math.floor(minX);
    const endX = Math.floor(maxX);
    const startY = Math.floor(minY);
    const endY = Math.floor(maxY);
    const startZ = Math.floor(minZ);
    const endZ = Math.floor(maxZ);

    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        for (let z = startZ; z <= endZ; z++) {
          const blockType = this.world.getBlock(x, y, z);
          if (blockType !== BLOCK_TYPES.AIR) {
            const props = BLOCK_PROPERTIES[blockType];
            if (props && props.solid) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  // Check if the player's body is in water
  _isInWater() {
    if (!this.world) return false;
    // Check the block at the player's feet and at eye level
    const checkY = Math.floor(this.position.y);
    const checkY2 = Math.floor(this.position.y + PLAYER_EYE_HEIGHT);
    const px = Math.floor(this.position.x);
    const pz = Math.floor(this.position.z);
    const block1 = this.world.getBlock(px, checkY, pz);
    const block2 = this.world.getBlock(px, checkY2, pz);
    return block1 === BLOCK_TYPES.WATER || block2 === BLOCK_TYPES.WATER;
  }

  update(delta) {
    // Update camera rotation using pre-allocated objects
    this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);

    // Movement direction using pre-allocated objects
    this._quat.setFromEuler(this._euler.set(0, this.yaw, 0, 'YXZ'));
    this._forward.set(0, 0, -1).applyQuaternion(this._quat);
    this._right.set(1, 0, 0).applyQuaternion(this._quat);

    this._moveDir.set(0, 0, 0);
    if (this.keys.forward) this._moveDir.add(this._forward);
    if (this.keys.backward) this._moveDir.sub(this._forward);
    if (this.keys.left) this._moveDir.sub(this._right);
    if (this.keys.right) this._moveDir.add(this._right);
    this._moveDir.y = 0;
    if (this._moveDir.x !== 0 || this._moveDir.z !== 0) {
      this._moveDir.normalize();
    }

    // Check if player is in water
    const inWater = this._isInWater();

    // Apply horizontal velocity (slower in water)
    const speed = inWater ? SWIM_SPEED : PLAYER_SPEED;
    this.velocity.x = this._moveDir.x * speed;
    this.velocity.z = this._moveDir.z * speed;

    // Jump / swim up
    if (this.keys.jump) {
      if (inWater) {
        // Swim upward
        this.velocity.y = SWIM_UP_SPEED;
        this.onGround = false;
      } else if (this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    // Sink down with Shift (when in water)
    if (inWater && this.keys.sneak) {
      this.velocity.y = -SWIM_UP_SPEED;
    }

    // Gravity (reduced in water)
    const gravity = inWater ? WATER_GRAVITY : GRAVITY;
    this.velocity.y += gravity * delta;

    // --- AABB collision resolution ---
    // Player bounding box: centered at position.x/z, bottom at position.y
    const half = PLAYER_RADIUS;
    const bodyHeight = PLAYER_BODY_HEIGHT;

    // Current AABB
    const curMinX = this.position.x - half;
    const curMaxX = this.position.x + half;
    const curMinZ = this.position.z - half;
    const curMaxZ = this.position.z + half;
    const curMinY = this.position.y;
    const curMaxY = this.position.y + bodyHeight;

    // --- X axis movement ---
    const newX = this.position.x + this.velocity.x * delta;
    const xMin = Math.min(newX - half, curMinX);
    const xMax = Math.max(newX + half, curMaxX);
    if (this._isColliding(xMin, curMinY, curMinZ, xMax, curMaxY, curMaxZ)) {
      this.velocity.x = 0;
    } else {
      this.position.x = newX;
    }

    // --- Z axis movement ---
    const newZ = this.position.z + this.velocity.z * delta;
    const zMin = Math.min(newZ - half, curMinZ);
    const zMax = Math.max(newZ + half, curMaxZ);
    if (this._isColliding(curMinX, curMinY, zMin, curMaxX, curMaxY, zMax)) {
      this.velocity.z = 0;
    } else {
      this.position.z = newZ;
    }

    // --- Y axis movement ---
    const newY = this.position.y + this.velocity.y * delta;
    const yMin = Math.min(newY, curMinY);
    const yMax = Math.max(newY + bodyHeight, curMaxY);
    if (this._isColliding(this.position.x - half, yMin, this.position.z - half,
                          this.position.x + half, yMax, this.position.z + half)) {
      if (this.velocity.y < 0) {
        // Hit ground — snap to block top
        this.position.y = Math.floor(newY) + 1;
        this.velocity.y = 0;
        this.onGround = true;
      } else {
        // Hit ceiling
        this.velocity.y = 0;
      }
    } else {
      this.position.y = newY;
      if (this.velocity.y < 0) {
        this.onGround = false;
      }
    }

    // Update camera position
    this.camera.position.copy(this.position);
    this.camera.position.y += PLAYER_EYE_HEIGHT;

    // Hand swing animation
    if (this.isSwinging) {
      this.swingAngle += delta * 10;
      this.handGroup.rotation.x = -Math.sin(this.swingAngle) * 1.0;
      this.handGroup.position.x = 0.4 + Math.sin(this.swingAngle) * 0.15;
      if (this.swingAngle > Math.PI) {
        this.isSwinging = false;
        this.swingAngle = 0;
        this.handGroup.rotation.x = 0;
        this.handGroup.position.x = 0.4;
      }
    }

    // Update block count display
    this.updateBlockCount();

    // Update target block highlight and coordinates
    this.updateTargetHighlight();
  }

  updateBlockCount() {
    const blockType = PLACEABLE_BLOCKS[this.selectedSlot];
    const name = BLOCK_PROPERTIES[blockType].name;
    this.blockCountEl.textContent = name;
  }

  updateTargetHighlight() {
    const target = this.getTargetBlock();
    if (target) {
      // Block geometry now occupies [x..x+1] in world space,
      // so the block center is at (x + 0.5, y + 0.5, z + 0.5).
      this.highlightBox.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      this.highlightBox.visible = true;

      // Update coordinates display
      const name = BLOCK_PROPERTIES[target.blockType]?.name || 'Unknown';
      this.targetCoordsEl.textContent = `${name} (${target.x}, ${target.y}, ${target.z})`;
    } else {
      this.highlightBox.visible = false;
      this.targetCoordsEl.textContent = '';
    }
  }
}
