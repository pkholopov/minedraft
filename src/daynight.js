import * as THREE from 'three';
import { loadGenericTexture } from './textures.js';

const DAY_DURATION = 600; // seconds for full day/night cycle
const SUN_ANGLE_SPEED = (2 * Math.PI) / DAY_DURATION;

export class DayNightCycle {
  constructor(scene) {
    this.scene = scene;
    this.time = 0; // 0 = midnight, PI = noon
    this.clock = new THREE.Clock();

    // Sun
    const sunTex = loadGenericTexture('/environment/sun.png');
    const sunMat = new THREE.SpriteMaterial({
      map: sunTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.sun = new THREE.Sprite(sunMat);
    this.sun.scale.set(30, 30, 1);
    this.sun.position.set(0, 100, 0);
    this.scene.add(this.sun);

    // Moon
    const moonTex = loadGenericTexture('/environment/full_moon.png');
    const moonMat = new THREE.SpriteMaterial({
      map: moonTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.moon = new THREE.Sprite(moonMat);
    this.moon.scale.set(25, 25, 1);
    this.moon.position.set(0, -100, 0);
    this.scene.add(this.moon);

    // Ambient light
    this.ambientLight = new THREE.AmbientLight(0x8080a0, 0.5);
    this.scene.add(this.ambientLight);

    // Directional light (sun)
    this.sunLight = new THREE.DirectionalLight(0xffeedd, 1.5);
    this.sunLight.position.set(100, 100, 50);
    this.sunLight.castShadow = false;
    this.scene.add(this.sunLight);

    // Hemisphere light for sky color
    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x6a6a8a, 0.8);
    this.scene.add(this.hemiLight);

    // Pre-allocated reusable objects
    this._ambientColor = new THREE.Color(0x404060);
    this._targetAmbientColor = new THREE.Color(0x8080a0);
    this._skyColor = new THREE.Color(0x87ceeb);
    this._nightSkyColor = new THREE.Color(0x0a0a1a);
    this._tempColor = new THREE.Color();

    // Sky color
    this.scene.background = this._skyColor.clone();
  }

  update(delta) {
    this.time += delta * SUN_ANGLE_SPEED;
    if (this.time > Math.PI * 2) this.time -= Math.PI * 2;

    const angle = this.time;
    const height = Math.sin(angle);
    const horizontal = Math.cos(angle);

    // Sun position
    const sunRadius = 120;
    this.sun.position.set(
      horizontal * sunRadius,
      height * sunRadius,
      -Math.sin(angle * 0.5) * sunRadius * 0.5
    );

    // Moon opposite to sun
    this.moon.position.set(
      -horizontal * sunRadius,
      -height * sunRadius,
      Math.sin(angle * 0.5) * sunRadius * 0.5
    );

    // Day/night factor (0 = night, 1 = day)
    const dayFactor = Math.max(0, Math.min(1, (height + 0.3) / 0.8));

    // Update sun light
    this.sunLight.intensity = 0.2 + dayFactor * 1.2;
    this.sunLight.position.copy(this.sun.position);

    // Update ambient light - reuse pre-allocated colors
    this.ambientLight.intensity = 0.1 + dayFactor * 0.4;
    this._tempColor.copy(this._ambientColor);
    this._tempColor.lerp(this._targetAmbientColor, dayFactor);
    this.ambientLight.color.copy(this._tempColor);

    // Update sky color - reuse pre-allocated colors
    this._tempColor.copy(this._skyColor);
    this._tempColor.lerp(this._nightSkyColor, 1 - dayFactor);
    this.scene.background.copy(this._tempColor);

    // Update hemisphere light
    this.hemiLight.intensity = 0.2 + dayFactor * 0.6;

    // Sun/moon visibility
    this.sun.visible = height > -0.2;
    this.moon.visible = height < 0.2;

  }

  dispose() {
    this.scene.remove(this.sun);
    this.scene.remove(this.moon);
    this.scene.remove(this.sunLight);
    this.scene.remove(this.ambientLight);
    this.scene.remove(this.hemiLight);
    this.sun.material.dispose();
    this.moon.material.dispose();
  }
}
