import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { DayNightCycle } from './daynight.js';
import { registerAnimatedTexture } from './textures.js';
import { BLOCK_FACES, BLOCK_TYPES } from './blocks.js';

// Background music
const audioListener = new THREE.AudioListener();
const audioLoader = new THREE.AudioLoader();
const backgroundMusic = new THREE.Audio(audioListener);
let musicPlaying = false;
let musicLoaded = false;
const musicBtn = document.getElementById('music-btn');
const musicLoader = document.getElementById('music-loader');

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 120);

// Camera - reduced far plane for less overdraw
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0, 30, 0);
camera.add(audioListener);

// Renderer - optimized settings
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
  depth: true,
  alpha: false,
});
// Aggressively limit pixel ratio for performance
const maxPixelRatio = Math.min(window.devicePixelRatio, 1);
renderer.setPixelRatio(maxPixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.sortObjects = false;
document.body.appendChild(renderer.domElement);

// World — будет создан после нажатия кнопки "Играть"
let world;

// Player
const player = new Player(camera, scene, world, renderer.domElement);

// Day/Night cycle
const dayNight = new DayNightCycle(scene);

// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Register animated textures (water_still.png = 32 frames, 32x1024)
registerAnimatedTexture('water_still', 32);

// Water animation state
let waterAnimTime = 0;
const WATER_ANIM_SPEED = 8; // frames per second

// Start button
document.getElementById('start-btn').addEventListener('click', () => {
  const seedInput = document.getElementById('seed-input');
  let seed = parseInt(seedInput.value, 10);
  if (isNaN(seed)) {
    seed = Math.floor(Math.random() * 2147483647);
  }
  world = new World(scene, seed);
  player.world = world;

  // Спавн игрока на поверхности в центре загруженного региона
  const spawnX = 8;
  const spawnZ = 8;
  // Принудительно загружаем чанк со спавном, чтобы получить высоту
  const spawnCx = Math.floor(spawnX / world.getChunkSize());
  const spawnCz = Math.floor(spawnZ / world.getChunkSize());
  world.loadChunk(spawnCx, spawnCz);
  const height = world.getHeightAt(spawnX, spawnZ);
  if (height >= 0) {
    player.position.set(spawnX + 0.5, height + 1, spawnZ + 0.5);
  }

  // Start background music (показывает блокирующий лоадер поверх всего)
  loadMusic();

  document.getElementById('start-screen').style.display = 'none';
});

function toggleMusic() {
  if (!musicLoaded) return;
  if (musicPlaying) {
    backgroundMusic.pause();
    musicPlaying = false;
    musicBtn.textContent = '♪';
    musicBtn.classList.add('muted');
  } else {
    backgroundMusic.play();
    musicPlaying = true;
    musicBtn.textContent = '♫';
    musicBtn.classList.remove('muted');
  }
}

// Toggle music with M key
document.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    toggleMusic();
  }
});

// Toggle music with button click
musicBtn.addEventListener('click', toggleMusic);

function loadMusic() {
  // Показываем блокирующий лоадер
  musicLoader.classList.add('visible');

  // Resume AudioContext if suspended (required by browser autoplay policy)
  const ctx = THREE.AudioContext.getContext();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  audioLoader.load(
    'audio/echoes.ogg',
    (buffer) => {
      backgroundMusic.setBuffer(buffer);
      backgroundMusic.setLoop(true);
      backgroundMusic.setVolume(0.15);
      backgroundMusic.play();
      musicPlaying = true;
      musicLoaded = true;
      musicBtn.textContent = '♫';
      // Убираем лоадер и даём управление игроку
      musicLoader.classList.remove('visible');
      renderer.domElement.requestPointerLock();
      console.log('Music loaded and playing');
    },
    undefined,
    (err) => {
      console.error('Failed to load music:', err);
      // При ошибке тоже убираем лоадер и даём управление
      musicLoader.classList.remove('visible');
      renderer.domElement.requestPointerLock();
    }
  );
}

// Game loop with FPS limiter
const clock = new THREE.Clock();
const TARGET_FPS = 60;
const FRAME_TIME = 1 / TARGET_FPS;
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);
  accumulator += delta;

  // Skip rendering if we're ahead of schedule (FPS limiter)
  if (accumulator < FRAME_TIME * 0.9) return;
  accumulator = 0;

  if (world) {
    // Update world chunks based on player position (pass camera for frustum culling)
    world.update(player.position, camera);

    // Update player
    player.update(delta);

    // Update day/night cycle
    dayNight.update(delta);

    // Update water animation
    waterAnimTime += delta * WATER_ANIM_SPEED;
    const waterFrame = Math.floor(waterAnimTime) % 32;
    const waterOffset = waterFrame / 32;
    // Update all water materials' UV offset
    world.updateWaterAnimation(waterOffset);
  }

  // Render
  renderer.render(scene, camera);
}

animate();
