// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const canvas = document.getElementById('solar-canvas');
const dateLabel = document.getElementById('date-label');
const offsetLabel = document.getElementById('offset-label');
const speedSlider = document.getElementById('speed-slider');
const speedLabel = document.getElementById('speed-label');
const planetList = document.getElementById('planet-list');
const loadError = document.getElementById('load-error');

const DAY_MS = 24 * 60 * 60 * 1000;
const J2000_UTC = Date.UTC(2000, 0, 1, 12, 0, 0);
const today = new Date();
const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
const speedSteps = [-360, -180, -60, -7, -1, 0, 1, 7, 60, 180, 360];

const planets = [
  { name: '水星', au: 0.387, period: 87.969, longitude: 252.3, size: 1.5, color: 0xb9b2a8 },
  { name: '金星', au: 0.723, period: 224.701, longitude: 181.9, size: 2.3, color: 0xe7c27d },
  { name: '地球', au: 1.000, period: 365.256, longitude: 100.5, size: 2.5, color: 0x4aa8ff, moon: true },
  { name: '火星', au: 1.524, period: 686.980, longitude: 355.4, size: 1.9, color: 0xe46b4f },
  { name: '木星', au: 5.203, period: 4332.589, longitude: 34.4, size: 6.6, color: 0xd2aa7d },
  { name: '土星', au: 9.537, period: 10759.22, longitude: 50.1, size: 5.7, color: 0xe2c98e, ring: true },
  { name: '天王星', au: 19.191, period: 30685.4, longitude: 314.1, size: 4.2, color: 0x8ee9ee },
  { name: '海王星', au: 30.069, period: 60189.0, longitude: 304.3, size: 4.1, color: 0x5d83ff },
];

let dayOffset = 0;
let speedDaysPerSecond = 0;
let lastFrameAt = 0;
let renderedListDay = null;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030611, 0.0009);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 3000);
camera.position.set(0, 92, 178);

const solarGroup = new THREE.Group();
scene.add(solarGroup);

const planetMeshes = [];
const orbitLines = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degToRad = (deg) => deg * Math.PI / 180;

const orbitRadius = (au) => 12 + Math.sqrt(au / 30.069) * 112;

const getSimulationDate = () => new Date(todayUtc + dayOffset * DAY_MS);

const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return `${year}年${month}月${day}日 (${weekday})`;
};

const formatOffset = () => {
  const roundedOffset = Math.round(dayOffset);
  if (roundedOffset === 0) return '今日';
  const absDays = Math.abs(roundedOffset);
  const direction = roundedOffset > 0 ? '後' : '前';
  if (absDays >= 365) {
    const years = Math.floor(absDays / 365);
    const days = absDays % 365;
    return days === 0 ? `${years}年${direction}` : `${years}年${days}日${direction}`;
  }
  return `${absDays}日${direction}`;
};

const daysFromJ2000 = () => (todayUtc + dayOffset * DAY_MS - J2000_UTC) / DAY_MS;

const planetState = (planet) => {
  const days = daysFromJ2000();
  const angle = degToRad(planet.longitude + days / planet.period * 360);
  return {
    ...planet,
    angle,
    degrees: ((angle * 180 / Math.PI) % 360 + 360) % 360,
  };
};

const makeLabel = (text, color) => {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 96;
  const ctx = labelCanvas.getContext('2d');
  ctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  ctx.font = '700 38px "Yu Gothic UI", "Meiryo", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 48);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(17, 6.4, 1);
  return sprite;
};

const colorToCss = (color) => `#${color.toString(16).padStart(6, '0')}`;

const createSkyTexture = () => {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 2048;
  textureCanvas.height = 1024;
  const ctx = textureCanvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

  const randomNormal = () => {
    const u = Math.max(Math.random(), 0.0001);
    const v = Math.max(Math.random(), 0.0001);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  for (let i = 0; i < 13000; i += 1) {
    const x = Math.random() * textureCanvas.width;
    const bandCenter = textureCanvas.height * (
      0.52
      + Math.sin((x / textureCanvas.width) * Math.PI * 2.1 + 0.65) * 0.13
      + (x / textureCanvas.width - 0.5) * 0.22
    );
    const y = bandCenter + randomNormal() * (28 + Math.random() * 34);
    if (y < 0 || y > textureCanvas.height) continue;

    const core = Math.abs(y - bandCenter) < 22;
    const brightness = core ? 0.52 + Math.random() * 0.42 : 0.34 + Math.random() * 0.34;
    const radius = Math.random() < 0.992 ? 0.12 + Math.random() * 0.18 : 0.28 + Math.random() * 0.18;
    const hue = [204, 218, 238, 44, 18, 285][Math.floor(Math.random() * 6)];
    ctx.fillStyle = `hsla(${hue}, 96%, ${68 + brightness * 24}%, ${brightness})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 3600; i += 1) {
    const x = Math.random() * textureCanvas.width;
    const bandCenter = textureCanvas.height * (
      0.52
      + Math.sin((x / textureCanvas.width) * Math.PI * 2.1 + 0.65) * 0.13
      + (x / textureCanvas.width - 0.5) * 0.22
    );
    const y = bandCenter + randomNormal() * (55 + Math.random() * 48);
    if (y < 0 || y > textureCanvas.height) continue;
    const radius = 0.18 + Math.random() * 0.36;
    ctx.fillStyle = `hsla(${210 + Math.random() * 55}, 90%, 74%, ${0.10 + Math.random() * 0.15})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 7600; i += 1) {
    const x = Math.random() * textureCanvas.width;
    const y = Math.random() * textureCanvas.height;
    const brightness = 0.55 + Math.random() * 0.43;
    const radius = Math.random() < 0.985 ? 0.16 + Math.random() * 0.22 : 0.42 + Math.random() * 0.22;
    const hue = [205, 220, 245, 52, 18, 285][Math.floor(Math.random() * 6)];
    ctx.fillStyle = `hsla(${hue}, 95%, ${66 + brightness * 28}%, ${brightness})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
};

const createSkyDome = () => {
  const geometry = new THREE.SphereGeometry(1200, 64, 48);
  const material = new THREE.MeshBasicMaterial({
    map: createSkyTexture(),
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.renderOrder = -1000;
  scene.add(dome);
  return dome;
};

const createOrbit = (radius) => {
  const points = [];
  const segments = 192;
  for (let i = 0; i <= segments; i += 1) {
    const angle = i / segments * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0x8fb8ff,
    transparent: true,
    opacity: 0.36,
    linewidth: 0.6,
  });
  const line = new THREE.Line(geometry, material);
  solarGroup.add(line);
  orbitLines.push(line);
};

const createSun = () => {
  const sunGeometry = new THREE.SphereGeometry(7.5, 48, 48);
  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffc85c });
  const sun = new THREE.Mesh(sunGeometry, sunMaterial);
  solarGroup.add(sun);

  const glowGeometry = new THREE.SphereGeometry(13, 48, 48);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8c32,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  solarGroup.add(glow);

  scene.add(new THREE.PointLight(0xffd18a, 520, 420, 1.5));
  scene.add(new THREE.AmbientLight(0x7b8aa4, 0.58));
  return { sun, glow };
};

const createPlanets = () => {
  planets.forEach((planet) => {
    const radius = orbitRadius(planet.au);
    createOrbit(radius);

    const geometry = new THREE.SphereGeometry(planet.size, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color: planet.color,
      roughness: 0.58,
      metalness: 0.04,
      emissive: planet.color,
      emissiveIntensity: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.planet = planet;
    solarGroup.add(mesh);

    let ring = null;
    if (planet.ring) {
      const ringGeometry = new THREE.RingGeometry(planet.size * 1.45, planet.size * 2.25, 80);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xf3d58d,
        transparent: true,
        opacity: 0.58,
        side: THREE.DoubleSide,
      });
      ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      solarGroup.add(ring);
    }

    let moon = null;
    if (planet.moon) {
      moon = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xdde3ef, roughness: 0.6 }),
      );
      solarGroup.add(moon);
    }

    const label = makeLabel(planet.name, colorToCss(planet.color));
    solarGroup.add(label);
    planetMeshes.push({ planet, mesh, ring, moon, label, orbit: radius });
  });
};

const updateDateLabels = () => {
  dateLabel.textContent = formatDate(getSimulationDate());
  offsetLabel.textContent = formatOffset();
};

const setSpeedFromSlider = () => {
  const sliderIndex = Number(speedSlider.value);
  speedDaysPerSecond = speedSteps[sliderIndex] ?? 0;
  if (speedDaysPerSecond === 0) {
    speedLabel.textContent = '停止';
    return;
  }
  const sign = speedDaysPerSecond > 0 ? '+' : '';
  speedLabel.textContent = `${sign}${speedDaysPerSecond} 日/秒`;
};

const renderPlanetList = (states) => {
  planetList.innerHTML = states.map((state) => `
    <li class="planet-item">
      <span class="planet-dot" style="background:${colorToCss(state.color)}; color:${colorToCss(state.color)}"></span>
      <span class="planet-name">${state.name}</span>
      <span class="planet-meta">${state.au.toFixed(2)} AU / ${Math.round(state.degrees)}°</span>
    </li>
  `).join('');
};

const updatePlanets = (time) => {
  const states = planetMeshes.map(({ planet }) => planetState(planet));
  planetMeshes.forEach((entry, index) => {
    const state = states[index];
    const x = Math.cos(state.angle) * entry.orbit;
    const z = Math.sin(state.angle) * entry.orbit;
    const y = Math.sin(state.angle * 2.0) * 2.2;
    entry.mesh.position.set(x, y, z);
    entry.mesh.rotation.y = time * 0.0012 + state.angle;

    if (entry.ring) {
      entry.ring.position.copy(entry.mesh.position);
      entry.ring.rotation.z = state.angle * 0.22;
    }

    if (entry.moon) {
      const moonAngle = state.angle * 13.37;
      entry.moon.position.set(
        x + Math.cos(moonAngle) * 5,
        y + Math.sin(moonAngle * 0.6) * 1.2,
        z + Math.sin(moonAngle) * 5,
      );
    }

    entry.label.position.set(x, y + state.size + 5.2, z);
  });

  const renderedDay = Math.round(dayOffset);
  if (renderedListDay !== renderedDay) {
    renderPlanetList(states);
    renderedListDay = renderedDay;
  }
  return states;
};

const resize = () => {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};

const updateCamera = (time) => {
  const narrowScreen = window.innerWidth < 760;
  const neptuneOrbit = orbitRadius(30.069);
  const earthOrbit = orbitRadius(1);
  const perihelion = earthOrbit * 1.18;
  const aphelion = neptuneOrbit * (narrowScreen ? 1.38 : 1.55);
  const ellipseCenterX = (aphelion - perihelion) * 0.5;
  const ellipseX = (aphelion + perihelion) * 0.5;
  const ellipseZ = Math.sqrt(Math.max(ellipseX * ellipseX - ellipseCenterX * ellipseCenterX, 1));
  const verticalAmplitude = narrowScreen ? 76 : 64;
  const cameraAngle = time * 0.000058;

  camera.position.set(
    ellipseCenterX + Math.cos(cameraAngle) * ellipseX,
    Math.sin(time * 0.000028) * verticalAmplitude,
    Math.sin(cameraAngle) * ellipseZ,
  );

  camera.lookAt(0, 0, 0);
};

const focusPlanetFromPointer = (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(planetMeshes.map((entry) => entry.mesh), false);
  if (!hits.length) return;
  const planet = hits[0].object.userData.planet;
  const item = Array.from(planetList.querySelectorAll('.planet-item'))
    .find((element) => element.textContent.includes(planet.name));
  if (!item) return;
  item.classList.add('active');
  window.setTimeout(() => item.classList.remove('active'), 700);
};

const skyDome = createSkyDome();
const { sun, glow } = createSun();
createPlanets();
resize();
updateDateLabels();
setSpeedFromSlider();
loadError.classList.add('hidden');

speedSlider.addEventListener('input', setSpeedFromSlider);
canvas.addEventListener('pointerdown', focusPlanetFromPointer);
window.addEventListener('resize', resize);

const animate = (time) => {
  if (lastFrameAt > 0 && speedDaysPerSecond !== 0) {
    const dtSeconds = Math.min((time - lastFrameAt) / 1000, 0.12);
    dayOffset += speedDaysPerSecond * dtSeconds;
    updateDateLabels();
  }
  lastFrameAt = time;

  skyDome.position.copy(camera.position);
  skyDome.rotation.y = time * 0.000006;
  sun.rotation.y = time * 0.00035;
  glow.scale.setScalar(1 + Math.sin(time * 0.002) * 0.06);
  orbitLines.forEach((line, index) => {
    line.material.opacity = 0.34 + Math.sin(time * 0.001 + index) * 0.04;
  });

  updatePlanets(time);
  updateCamera(time);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

requestAnimationFrame(animate);
