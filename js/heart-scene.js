// Adapted from Valentine-Demo by thanhzkda. See ../LICENSE.
// ============================================================
// 3D Interactive Heart Scene — Three.js + MediaPipe
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ─── CONFIG ───────────────────────────────────────────────────
const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) < 768;
const MAX_FRAME_DELTA = 0.05; // Keeps animation stable when the frame rate drops
const HEART_PHOTO_COUNT = 16;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const CONFIG = {
    colors: {
        bg: 0x09070c,
        fog: 0x09070c,
    },
    particles: {
        dustCount: isSmallScreen ? 800 : 2000,
        sparkleCount: isSmallScreen ? 330 : 680,
        heartScale: 10,
    },
    camera: { z: 50 },
};

const STATE = {
    mode: 'HEART',
    focusTarget: null,
    hand: { detected: false, x: 0, y: 0 },
    rotation: { y: 0 },
    touch: { active: false, startX: 0, startY: 0, lastX: 0 },
    initialized: false,
};

let scene, camera, renderer, composer;
let mainGroup;
let clock = new THREE.Clock();
let particleSystem = [];
let photoMeshGroup = new THREE.Group();
let handLandmarker, video;
let sparkleSystem;
const sparkleOrbits = [];
let sparkleSpread = 0;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let isCameraRunning = false;
let isCameraStarting = false;
let animationId = null;
let instancedMeshes = [];
let qualityFrames = 0;
let qualityChecked = false;
let heartFlipPhase = 0;
const tempScale = new THREE.Vector3();
const photoTilt = new THREE.Euler();
const photoTiltRotation = new THREE.Quaternion();
const photoFacingRotation = new THREE.Quaternion();
const focusPosition = new THREE.Vector3();

// ─── PUBLIC API (called from main.js) ─────────────────────────
window.initHeartScene = function () {
    if (STATE.initialized) return;
    STATE.initialized = true;
    init();
};

// ─── HEART PARAMETRIC EQUATION ────────────────────────────────
function heartPosition(u, v, scale) {
    // 3D heart surface parametric equations
    const phi = u * Math.PI * 2;
    const theta = v * Math.PI;

    // Classic heart surface
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);


    // Classic 3D Heart Formula (Taubin/Parametric)
    // We map the "Shape" to X/Y and "Thickness" to Z to face the camera.

    // x = 16sin^3(t) style width
    // z term in original was the height (lobes)
    // y term in original was the thickness

    // We want:
    // X = Width (sinPhi terms)
    // Y = Height (cosPhi terms - the lobes + point)
    // Z = Depth/Thickness (cosTheta)

    const x_width = sinTheta * (16 * sinPhi * sinPhi * sinPhi); // Modified for nicer width
    const y_height = sinTheta * (13 * cosPhi - 5 * Math.cos(2 * phi) - 2 * Math.cos(3 * phi) - Math.cos(4 * phi));
    const z_depth = 10 * cosTheta; // Thickness

    // Combine and scale
    const vec = new THREE.Vector3(
        x_width * scale * 0.05,
        y_height * scale * 0.05,
        z_depth * scale * 0.05
    );

    return vec;
}

// Even spacing follows the perimeter rather than equal steps in the heart equation.
const heartOutline = new THREE.CatmullRomCurve3(
    Array.from({ length: 96 }, (_, i) => heartPosition(i / 96, 0.5, 14)),
    true,
);

// ─── INIT ─────────────────────────────────────────────────────
function init() {
    console.log("%c Heart Scene v2.0: Multi-Axis & Closer Orbit", "background: #ff0055; color: white; padding: 4px; border-radius: 4px;");
    initThree();
    mainGroup.add(photoMeshGroup);
    createDust();
    createSparkles();
    loadMediaPhotos();
    setupPostProcessing();
    setupEvents();
    setupTouchAndClick();

    // Hide loader
    const loader = document.getElementById('heart-loader');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 800);
    }

    animate();
}

// ─── THREE.JS SETUP ───────────────────────────────────────────
function initThree() {
    const container = document.getElementById('heart-canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.bg);
    scene.fog = new THREE.FogExp2(CONFIG.colors.fog, 0.012);

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, Math.max(CONFIG.camera.z, 29 / camera.aspect));

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 2.5;
    container.appendChild(renderer.domElement);

    mainGroup = new THREE.Group();
    scene.add(mainGroup);
}

function setupPostProcessing() {
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85
    );
    bloomPass.threshold = 0.5;
    bloomPass.strength = 0.6;
    bloomPass.radius = 0.5;

    composer = new EffectComposer(renderer);
    // The bloom pipeline draws to its own buffers, so renderer antialiasing alone misses these edges.
    if (renderer.capabilities.isWebGL2) {
        const gl = renderer.getContext();
        const supported = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
        const samples = Array.from(supported || []).find(count => count > 0 && count <= 4) || 0;
        composer.renderTarget1.samples = samples;
        composer.renderTarget2.samples = samples;
    }
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
}

// ─── PARTICLE CLASS ───────────────────────────────────────────
class Particle {
    constructor(mesh, type, isDust = false) {
        this.mesh = mesh;
        this.type = type;
        this.isDust = isDust;
        this.posHeart = new THREE.Vector3();
        this.posScatter = new THREE.Vector3();
        this.baseScale = mesh.scale.x;
        this.spread = 0;
        this.spreadVelocity = 0;
        this.motionRate = 1;
        this.scatterTilt = 0;
        this.flipDirection = 1;
        this.driftTurn = 0;
        this.flipOffset = 0;
        this.focusBlend = 0;
        const speedMult = type === 'PHOTO' ? 0.3 : 2.0;
        this.spinSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * speedMult,
            (Math.random() - 0.5) * speedMult,
            (Math.random() - 0.5) * speedMult
        );
        this.calculatePositions();
    }

    calculatePositions() {
        if (this.type === 'PHOTO') return; // updatePhotoLayout sets both destinations.

        // Use heart parametric surface for particle positions
        const u = Math.random();
        const v = Math.random();

        // Volume filling: distribute particles inside the shape, not just on surface
        // Power > 1 pushes points outward (shell-like), Power < 1 pulls inward. 
        // 0.5 gives a nice solid filled look.
        const volumeScale = Math.pow(Math.random(), 0.4);

        this.posHeart.copy(heartPosition(u, v, CONFIG.particles.heartScale)).multiplyScalar(volumeScale);

        // Add some jitter/fuzziness
        this.posHeart.x += (Math.random() - 0.5) * 0.2;
        this.posHeart.y += (Math.random() - 0.5) * 0.2;
        this.posHeart.z += (Math.random() - 0.5) * 0.2;

        // Position correction: Lift heart slightly so it's centered
        this.posHeart.y += 2;

        // Scatter position
        const rScatter = 12 + Math.random() * 20;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        this.posScatter.set(
            rScatter * Math.sin(phi) * Math.cos(theta),
            rScatter * Math.sin(phi) * Math.sin(theta),
            rScatter * Math.cos(phi)
        );
    }

    updatePhotoMotion(dt, expanded) {
        const destination = expanded ? 1 : 0;
        // Keep velocity when switching direction, so a quick reversal doesn't jump.
        const rate = (reducedMotion.matches ? 22 : expanded ? 10 : 7) * this.motionRate;
        const offset = this.spread - destination;
        const momentum = this.spreadVelocity + rate * offset;
        const decay = Math.exp(-rate * dt);
        this.spread = destination + (offset + momentum * dt) * decay;
        this.spreadVelocity = (this.spreadVelocity - rate * momentum * dt) * decay;

        const progress = THREE.MathUtils.clamp(this.spread, 0, 1);
        this.mesh.position.lerpVectors(this.posHeart, this.posScatter, progress);
        if (!reducedMotion.matches) {
            const phase = Math.sin(clock.elapsedTime * 0.75 + this.mesh.id);
            this.mesh.position.y += progress * 0.28 * phase;
            this.mesh.position.z += Math.sin(progress * Math.PI) * 2.4;
        }
    }

    update(dt, mode, focusTargetMesh) {
        const expanded = mode !== 'HEART';
        if (this.type === 'PHOTO') {
            this.updatePhotoMotion(dt, expanded);
            const isFocused = this.mesh === focusTargetMesh;
            this.focusBlend = THREE.MathUtils.damp(this.focusBlend, Number(isFocused), 7, dt);
            this.mesh.position.lerp(focusPosition, this.focusBlend);
            const spread = THREE.MathUtils.clamp(this.spread, 0, 1);
            const tilt = this.scatterTilt * spread;
            const fullTurn = 2 * Math.PI;
            let turn = 0;
            if (!reducedMotion.matches) {
                if (expanded) {
                    const orbitSpeed = (0.31 + 0.19 * this.motionRate) * this.flipDirection;
                    this.driftTurn += orbitSpeed * dt;
                } else {
                    // Align to one idle rotation clock via the shortest turn after the burst.
                    const targetPhase = heartFlipPhase + this.flipOffset;
                    const difference = THREE.MathUtils.euclideanModulo(targetPhase - this.driftTurn + Math.PI, fullTurn) - Math.PI;
                    this.driftTurn += difference * (1 - Math.exp(-7 * dt));
                }
                this.driftTurn = THREE.MathUtils.euclideanModulo(this.driftTurn + Math.PI, fullTurn) - Math.PI;
                turn = this.flipDirection * fullTurn * spread + this.driftTurn;
            } else {
                this.driftTurn = 0;
            }
            photoTilt.set(tilt * 0.48, turn + tilt * 0.72, tilt);
            const rotation = photoTiltRotation.setFromEuler(photoTilt);
            this.mesh.quaternion.identity().slerp(photoFacingRotation, spread).multiply(rotation).slerp(photoFacingRotation, this.focusBlend);
        } else {
            const lerpSpeed = mode === 'HEART' ? 4 : 6;
            this.mesh.position.lerp(expanded ? this.posScatter : this.posHeart, 1 - Math.exp(-lerpSpeed * dt));
        }

        // Rotation
        if (mode === 'SCATTER' && this.type !== 'PHOTO') {
            this.mesh.rotation.x += this.spinSpeed.x * dt;
            this.mesh.rotation.y += this.spinSpeed.y * dt;
            this.mesh.rotation.z += this.spinSpeed.z * dt;
        } else if (mode === 'HEART' && this.type !== 'PHOTO') {
            this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, dt);
            this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, 0, dt);
            this.mesh.rotation.y += 0.5 * dt;
        }

        // Scale
        let s = this.baseScale;
        if (this.isDust) {
            s = this.baseScale * (0.8 + 0.4 * Math.sin(clock.elapsedTime * 4 + this.mesh.id));
            if (mode === 'HEART') s = 0;
        } else if (this.type === 'PHOTO') {
            s = THREE.MathUtils.lerp(this.baseScale * (expanded ? 1.1 : 1), 5.1, this.focusBlend);
        }
        this.mesh.scale.lerp(tempScale.set(s, s, s), 4 * dt);

        // Instanced particles write their transform into the shared mesh
        if (this.instance) {
            this.mesh.updateMatrix();
            this.instance.setMatrixAt(this.instanceIndex, this.mesh.matrix);
        }
    }
}

// Draws many copies of one shape in a single GPU call
function createInstancedParticles(geometry, material, count, type, isDust, setup) {
    const instance = new THREE.InstancedMesh(geometry, material, count);
    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instance.frustumCulled = false;
    mainGroup.add(instance);
    instancedMeshes.push(instance);

    for (let i = 0; i < count; i++) {
        const transform = new THREE.Object3D();
        setup(transform);
        const particle = new Particle(transform, type, isDust);
        particle.instance = instance;
        particle.instanceIndex = i;
        particleSystem.push(particle);
    }
}

// ─── DUST PARTICLES ───────────────────────────────────────────
function createDust() {
    const geo = new THREE.TetrahedronGeometry(0.06, 0);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xffccdd,
        transparent: true,
        opacity: 0.7,
    });
    createInstancedParticles(geo, mat, CONFIG.particles.dustCount, 'DUST', true, (transform) => {
        transform.scale.setScalar(0.4 + Math.random());
    });
}

// ─── SPARKLE / SNOW REPLACEMENT ───────────────────────────────
function createSparkles() {
    const geometry = new THREE.BufferGeometry();
    const colors = [];
    const palette = [0xff91be, 0xffd29b, 0xfff2f5].map(color => new THREE.Color(color));

    // A tiny luminous square under a soft glow, shared by every point.
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, .8)');
    gradient.addColorStop(0.36, 'rgba(255, 255, 255, .26)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#fff';
    ctx.fillRect(12, 12, 8, 8);
    const sparkleTexture = new THREE.CanvasTexture(canvas);

    for (let i = 0; i < CONFIG.particles.sparkleCount; i++) {
        const inner = i % 4 === 0;
        sparkleOrbits.push({
            phase: Math.random() * 2 * Math.PI,
            radius: inner ? 2 + Math.random() * 13 : 10 + Math.sqrt(Math.random()) * 36,
            height: THREE.MathUtils.randFloatSpread(inner ? 22 : 46) + 2,
            speed: 0.13 + Math.random() * 0.09,
            burst: new THREE.Vector3(
                THREE.MathUtils.randFloatSpread(64),
                THREE.MathUtils.randFloatSpread(35) + 2,
                THREE.MathUtils.randFloatSpread(36),
            ),
        });
        const color = palette[i % palette.length];
        colors.push(color.r, color.g, color.b);
    }

    const position = new THREE.BufferAttribute(new Float32Array(sparkleOrbits.length * 3), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        vertexColors: true,
        size: 0.35,
        map: sparkleTexture,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });

    sparkleSystem = new THREE.Points(geometry, material);
    sparkleSystem.frustumCulled = false;
    mainGroup.add(sparkleSystem);
    updateSparkles(0);
}

function updateSparkles(dt) {
    if (!sparkleSystem) return;
    const expanded = STATE.mode !== 'HEART';
    const material = sparkleSystem.material;
    const position = sparkleSystem.geometry.attributes.position;
    const orbitDelta = reducedMotion.matches ? 0 : dt;
    sparkleSpread = THREE.MathUtils.damp(sparkleSpread, Number(expanded), 5, dt);
    material.size = THREE.MathUtils.damp(material.size, expanded ? 0.88 : 0.8, 6, dt);
    material.opacity = THREE.MathUtils.damp(material.opacity, expanded ? 1 : 0.96, 6, dt);
    sparkleOrbits.forEach((star, index) => {
        star.phase -= star.speed * orbitDelta;
        const x = Math.cos(star.phase) * star.radius;
        const z = Math.sin(star.phase) * star.radius * 0.56;
        position.setXYZ(
            index,
            THREE.MathUtils.lerp(x, star.burst.x, sparkleSpread),
            THREE.MathUtils.lerp(star.height, star.burst.y, sparkleSpread),
            THREE.MathUtils.lerp(z, star.burst.z, sparkleSpread),
        );
    });
    position.needsUpdate = true;
}

// ─── PHOTO LAYOUT & ORBITAL SYSTEM ────────────────────────────
function updatePhotoLayout() {
    const photos = particleSystem.filter(p => p.type === 'PHOTO');
    photos.forEach((photo) => {
        const index = photo.mesh.userData.slot;
        const fraction = index / HEART_PHOTO_COUNT;
        const angle = fraction * Math.PI * 2;
        photo.posHeart.copy(heartOutline.getPointAt(fraction));
        photo.posHeart.y += 2;
        photo.posHeart.z = 0;

        // Place the burst in screen space so portrait screens retain a clear center.
        const direction = angle - Math.PI / 2 + Math.sin(index * 2.4) * 0.16;
        const x = Math.cos(direction);
        const y = Math.sin(direction);
        const edge = Math.max(Math.abs(x), Math.abs(y));
        const reach = 0.47 + ((index * 7) % 11) * 0.04;
        const depth = Math.sin(index * 2.4 + 0.8) * 11;
        const halfHeight = (camera.position.z - depth) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const screenX = x / edge * reach;
        const screenY = Math.min(y / edge * reach * 0.83, Math.abs(screenX) < 0.28 ? 0.55 : 0.74);
        photo.posScatter.set(
            screenX * halfHeight * camera.aspect,
            camera.position.y + screenY * halfHeight,
            depth,
        );
        photo.scatterTilt = Math.sin(index * 2.1 + 0.65) * 0.43;
        photo.flipDirection = index % 2 ? -1 : 1;
        photo.motionRate = 0.82 + ((index * 5) % 7) * 0.06;
    });
}

// ─── ADD PHOTO TO SCENE ───────────────────────────────────────
function addPhotoToScene(texture, mediaItem, mediaIndex) {
    let width = 1.2, height = 1.2;
    if (texture.image) {
        const aspect = texture.image.width / texture.image.height;
        if (aspect > 1) height = width / aspect;
        else width = height * aspect;
    }

    const photoGeo = new THREE.PlaneGeometry(width, height);
    const photoMat = new THREE.MeshBasicMaterial({ map: texture });
    // Use one texture per image even when the same image fills multiple slots.
    for (let slot = mediaIndex; slot < HEART_PHOTO_COUNT; slot += window.mediaData.length) {
        const photo = new THREE.Mesh(photoGeo, photoMat);
        photo.position.z = 0.004;
        const back = new THREE.Mesh(photoGeo, photoMat);
        back.position.z = -0.004;
        back.rotation.y = Math.PI;

        const group = new THREE.Group();
        group.add(photo, back);
        group.scale.setScalar(2.35);
        group.userData.mediaItem = mediaItem;
        group.userData.slot = slot;

        photoMeshGroup.add(group);
        const particle = new Particle(group, 'PHOTO', false);
        particle.flipOffset = Math.sin(slot * 2.4) * 0.12;
        particle.driftTurn = heartFlipPhase + particle.flipOffset;
        particleSystem.push(particle);
    }
    updatePhotoLayout();
    document.querySelector('#focus').disabled = photoMeshGroup.children.length === 0;

}

// ─── LOAD MEDIA FROM window.mediaData ─────────────────────────
function loadMediaPhotos() {
    if (!window.mediaData || window.mediaData.length === 0) return;
    const loader = new THREE.TextureLoader();
    let errorCount = 0;

    window.mediaData.slice(0, HEART_PHOTO_COUNT).forEach((item, index) => {
        const imgSrc = item.thumbnail || item.src;
        loader.load(
            imgSrc,
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
                addPhotoToScene(texture, item, index);
            },
            undefined,
            (err) => {
                console.warn(`Failed to load thumbnail for "${item.title}":`, err);
                errorCount++;
                const debugInfo = document.getElementById('heart-debug-info');
                if (debugInfo) {
                    debugInfo.innerText = `⚠️ Error: Could not load ${errorCount} photo(s). Check filenames!`;
                    debugInfo.style.color = '#ff4444';
                }
            }
        );
    });
}

// ─── TOUCH + CLICK ────────────────────────────────────────────
function setupTouchAndClick() {
    const container = document.getElementById('heart-canvas-container');

    container.addEventListener('pointerdown', (e) => {
        STATE.touch.active = true;
        STATE.touch.startX = e.clientX;
        STATE.touch.startY = e.clientY;
        STATE.touch.lastX = e.clientX;
    });

    window.addEventListener('pointermove', (e) => {
        if (!STATE.touch.active) return;
        const dX = e.clientX - STATE.touch.lastX;
        STATE.rotation.y += dX * 0.005;
        STATE.touch.lastX = e.clientX;
    });

    const finishDrag = () => { STATE.touch.active = false; };
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);

    setupClickEventsOnly();
}

// Helper: find the photo under the current `mouse` position
function findPhotoUnderPointer() {
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(photoMeshGroup.children, true);
    if (intersects.length === 0) return null;

    let obj = intersects[0].object;
    while (obj.parent && obj.parent !== photoMeshGroup) {
        obj = obj.parent;
    }
    return particleSystem.find(p => p.mesh === obj && p.type === 'PHOTO') || null;
}

// Helper: Raycast from normalized coord (-1 to 1)
function attemptClickFromGesture(ndcX, ndcY) {
    // Note: MediaPipe Y is top-down (0->1), so ndcY is -1(top) to 1(bottom).
    // Three.js expects Y to be 1(top) to -1(bottom).
    // Video is mirrored (scaleX(-1)), so raw X(0) is Screen Right.
    // STATE.hand.x = (0-0.5)*2 = -1. We want +1. So negate X too.

    mouse.x = -ndcX;
    mouse.y = -ndcY;

    const clickedPhoto = findPhotoUnderPointer();

    if (clickedPhoto) {
        const mediaItem = clickedPhoto.mesh.userData.mediaItem;
        if (mediaItem) {
            openMediaViewer(mediaItem);
            return true;
        }
    }
    return false;
}

function setupClickEventsOnly() {
    const container = document.getElementById('heart-canvas-container');

    // Click on photo
    container.addEventListener('click', (e) => {
        const moveDist = Math.hypot(e.clientX - STATE.touch.startX, e.clientY - STATE.touch.startY);
        if (moveDist > 10) return; // Was a drag, not a click

        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

        const clickedPhoto = findPhotoUnderPointer();

        if (clickedPhoto) {
            const mediaItem = clickedPhoto.mesh.userData.mediaItem;
            if (mediaItem) {
                openMediaViewer(mediaItem);
            } else {
                // Focus mode if no media item
                STATE.mode = 'FOCUS';
                STATE.focusTarget = clickedPhoto.mesh;
            }
        } else {
            if (STATE.mode === 'FOCUS') {
                setArrangement('HEART');
            }
        }
    });

}

function setArrangement(mode, focusTarget = null) {
    STATE.mode = mode;
    STATE.focusTarget = focusTarget;
    const expanded = mode !== 'HEART';
    document.querySelector('#heart-screen').classList.toggle('is-scattered', mode === 'SCATTER');
    document.querySelector('#scatter').textContent = expanded ? '聚成爱心' : '散开照片';
    document.querySelector('#scatter').setAttribute('aria-pressed', String(expanded));
    const caption = document.querySelector('#heart-focus-caption');
    const item = focusTarget?.userData.mediaItem;
    caption.hidden = !item;
    caption.textContent = item ? [item.title, item.description].filter(Boolean).join('\n') : '';
}

function focusRandomPhoto() {
    const seen = new Set([STATE.focusTarget?.userData.mediaItem]);
    const photos = photoMeshGroup.children.filter(photo => {
        const item = photo.userData.mediaItem;
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
    });
    const candidates = photos.length ? photos : photoMeshGroup.children.filter(photo => photo !== STATE.focusTarget);
    if (candidates.length) {
        setArrangement('FOCUS', candidates[Math.floor(Math.random() * candidates.length)]);
    }
}

function stopCamera() {
    isCameraRunning = false;
    STATE.hand.detected = false;
    video?.srcObject?.getTracks().forEach(track => track.stop());
    if (video) video.srcObject = null;
    document.querySelector('#heart-webcam-wrapper').style.opacity = '0';
    document.querySelector('#heart-cam-btn').textContent = '开启手势';
    document.querySelector('#heart-debug-info').textContent = '拖动旋转 · 点照片放大';
    previousGesture = null;
}

async function initMediaPipe() {
    if (isCameraStarting) return;
    if (isCameraRunning) {
        stopCamera();
        return;
    }
    isCameraStarting = true;
    const button = document.querySelector('#heart-cam-btn');
    const status = document.querySelector('#heart-debug-info');
    button.disabled = true;
    button.textContent = '准备中…';
    video = document.querySelector('#heart-webcam');
    try {
        if (!handLandmarker) {
            const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
            const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm');
            handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                },
                runningMode: 'VIDEO',
                numHands: 1,
            });
        }
        video.srcObject = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
        });
        await video.play();
        isCameraRunning = true;
        lastVideoTime = -1;
        document.querySelector('#heart-webcam-wrapper').style.opacity = '1';
        button.textContent = '关闭手势';
        status.textContent = '张手散开 · 握拳聚合 · 🤟 随机聚焦';
        requestAnimationFrame(predictWebcam);
    } catch (error) {
        stopCamera();
        status.textContent = error.name === 'NotAllowedError' ? '摄像头未授权，仍可用按钮操作' : '手势暂不可用，仍可用按钮操作';
    } finally {
        button.disabled = false;
        isCameraStarting = false;
    }
}

let lastVideoTime = -1;
let previousGesture = null;
let gestureStartedAt = 0;
let gestureApplied = false;

function predictWebcam(time) {
    if (!isCameraRunning) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        try {
            processGestures(handLandmarker.detectForVideo(video, time), time);
        } catch (error) {
            stopCamera();
            document.querySelector('#heart-debug-info').textContent = '手势已停止，仍可用按钮操作';
            return;
        }
    }
    requestAnimationFrame(predictWebcam);
}

function processGestures(result, time) {
    const landmarks = result.landmarks?.[0];
    const wrist = landmarks?.[0];
    const middle = landmarks?.[9];
    const handSize = wrist && Math.hypot(middle.x - wrist.x, middle.y - wrist.y);
    let gesture = null;
    if (handSize > 0.02) {
        const fingerLengths = [8, 12, 16, 20].map(i => Math.hypot(landmarks[i].x - wrist.x, landmarks[i].y - wrist.y) / handSize);
        const extension = fingerLengths.reduce((total, distance) => total + distance, 0) / 4;
        const [index, middleFinger, ring, pinky] = fingerLengths;
        const thumb = Math.hypot(landmarks[4].x - landmarks[5].x, landmarks[4].y - landmarks[5].y) / handSize;
        if (extension < 1.04) gesture = 'HEART';
        if (extension > 1.34) gesture = 'SCATTER';
        if (index > 1.33 && pinky > 1.22 && middleFinger < 1.16 && ring < 1.16 && thumb > 0.52) gesture = 'FOCUS';
    }
    if (gesture !== previousGesture) {
        previousGesture = gesture;
        gestureStartedAt = time;
        gestureApplied = false;
    } else if (gesture && !gestureApplied && time - gestureStartedAt >= 180 && !document.querySelector('#media-viewer-overlay').open) {
        if (gesture === 'FOCUS') focusRandomPhoto();
        else if (gesture !== STATE.mode) setArrangement(gesture);
        gestureApplied = true;
    }
}

function setupEvents() {
    window.addEventListener('resize', () => {
        if (!renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.position.z = Math.max(CONFIG.camera.z, 29 / camera.aspect);
        camera.updateProjectionMatrix();
        updatePhotoLayout();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (composer) composer.setSize(window.innerWidth, window.innerHeight);
    });

    // Gesture button
    const camBtn = document.getElementById('heart-cam-btn');
    if (camBtn) camBtn.addEventListener('click', initMediaPipe);
    document.querySelector('#scatter').addEventListener('click', () => {
        setArrangement(STATE.mode === 'HEART' ? 'SCATTER' : 'HEART');
    });
    document.querySelector('#focus').addEventListener('click', focusRandomPhoto);
    window.addEventListener('pagehide', stopCamera);

    // H key to toggle UI
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'h') {
            const ui = document.getElementById('heart-ui-layer');
            const debug = document.getElementById('heart-debug-info');
            const camWrapper = document.getElementById('heart-webcam-wrapper');

            const isHidden = ui.style.display === 'none';
            const value = isHidden ? '' : 'none';
            const camValue = isHidden && isCameraRunning ? '1' : '0';

            if (ui) ui.style.display = value;
            if (debug) debug.style.display = value;
            // Optionally hide webcam preview too to act as wallpaper mode
            if (camWrapper) camWrapper.style.opacity = camValue;
        }
    });
}

function openMediaViewer(mediaItem) {
    const index = window.mediaData.indexOf(mediaItem);
    if (index >= 0) window.showPhoto(index);
}

function animate() {
    animationId = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
    if (!reducedMotion.matches) {
        heartFlipPhase = THREE.MathUtils.euclideanModulo(heartFlipPhase - 0.33 * dt, 2 * Math.PI);
    }

    if (!STATE.touch.active) {
        STATE.rotation.y *= Math.exp(-2.8 * dt);
    }
    STATE.rotation.y = THREE.MathUtils.euclideanModulo(STATE.rotation.y + Math.PI, 2 * Math.PI) - Math.PI;
    mainGroup.rotation.y = STATE.rotation.y;
    mainGroup.getWorldQuaternion(photoFacingRotation).invert();
    if (STATE.focusTarget) {
        const distance = Math.max(16, 12 / camera.aspect);
        mainGroup.worldToLocal(focusPosition.set(0, camera.position.y, camera.position.z - distance));
    }

    // Update all particles
    particleSystem.forEach(p => p.update(dt, STATE.mode, STATE.focusTarget));
    instancedMeshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });

    // Update sparkles
    updateSparkles(dt);

    // Render
    composer.render();
    adaptQuality();
}

// Lowers render resolution once if the device can't keep up
function adaptQuality() {
    if (qualityChecked) return;
    qualityFrames++;
    if (clock.elapsedTime < 3) return;

    qualityChecked = true;
    if (qualityFrames / clock.elapsedTime < 24) {
        renderer.setPixelRatio(1);
        composer.setPixelRatio(1);
    }
}


