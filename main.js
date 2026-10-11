
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/+esm';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js/+esm';

const $ = (id) => document.getElementById(id);
const fileInput = $('worldFile');
const dropzone = $('dropzone');
const loadButton = $('loadButton');
const viewport = $('viewport');
const statusBox = $('status');
const loading = $('loading');

let selectedFile = null;
let isLoading = false;
let scene, camera, renderer, controls, worldGroup, resizeObserver;
let initialCamera = null;
let coordinateReadout = null;
let raycaster = null;
let pointerNdc = null;
let coordinateFramePending = false;
let worldCenter = new THREE.Vector3();
let loadedDimensions = new Map();
let activeFileName = "";
let needsRender = true;

function setStatus(message, type = '') {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
}

function setLoading(
  show,
  title = '読み込み中…',
  message = 'ワールドのデータを確認しています。'
) {
  loading.classList.toggle('hidden', !show);
  $('loadingTitle').textContent = title;
  $('loadingText').textContent = message;
}

function chooseFile(file) {
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.mcworld')) {
    selectedFile = null;
    $('fileName').textContent =
      `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    loadButton.disabled = true;
    fileInput.value = '';
    setStatus(
      '拡張子が .mcworld のファイルを選択してください。',
      'error'
    );
    return;
  }

  selectedFile = file;

  $('fileName').textContent =
    `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;

  loadButton.disabled = isLoading;
  setStatus('ファイルを選択しました。3D表示を開始できます。');
}

fileInput.addEventListener('change', () => {
  chooseFile(fileInput.files?.[0]);
});

dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

for (const name of ['dragenter', 'dragover']) {
  dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragging');
  });
}

for (const name of ['dragleave', 'drop']) {
  dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragging');
  });
}

dropzone.addEventListener('drop', (event) => {
  chooseFile(event.dataTransfer?.files?.[0]);
});

$('resetView').addEventListener('click', resetCamera);

$('fullscreen').addEventListener('click', () => {
  document.body.classList.toggle('viewer-fullscreen');
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.body.classList.remove('viewer-fullscreen');
  }
});

function initScene() {
  if (renderer) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#f7faf9');

  camera = new THREE.PerspectiveCamera(48, 1, 0.1, 10000);
  camera.position.set(90, 75, 90);

  renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'low-power'
  });

  // 低解像度で描画してGPU負荷を大幅に下げる（CSS上の表示サイズは維持）
  renderer.setPixelRatio(1);

  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  viewport.appendChild(renderer.domElement);

  coordinateReadout = document.createElement('div');
  coordinateReadout.textContent =
    '座標: ブロックにカーソルを合わせる';

  Object.assign(coordinateReadout.style, {
    position: 'absolute',
    left: '12px',
    bottom: '12px',
    zIndex: '5',
    padding: '7px 10px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.92)',
    color: '#25312c',
    border: '1px solid rgba(30,50,40,0.14)',
    font: '12px/1.4 system-ui, sans-serif',
    pointerEvents: 'none',
    maxWidth: 'calc(100% - 24px)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  });

  if (getComputedStyle(viewport).position === 'static') {
    viewport.style.position = 'relative';
  }

  viewport.appendChild(coordinateReadout);

  raycaster = new THREE.Raycaster();
  raycaster.params.Mesh.threshold = 0.1;
  pointerNdc = new THREE.Vector2();

  renderer.domElement.addEventListener(
    'pointermove',
    updateHoveredCoordinate,
    { passive: true }
  );

  renderer.domElement.addEventListener(
    'pointerup',
    updateHoveredCoordinate,
    { passive: true }
  );

  renderer.domElement.addEventListener(
    'pointerleave',
    () => {
      if (coordinateReadout) {
        coordinateReadout.textContent =
          '座標: ブロックにカーソルを合わせる';
      }
    },
    { passive: true }
  );

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.screenSpacePanning = true;
  controls.minDistance = 4;
  controls.maxDistance = 2500;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x83928b, 2.15));

  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(120, 180, 100);
  scene.add(sun);

  worldGroup = new THREE.Group();
  scene.add(worldGroup);

  resizeObserver = new ResizeObserver(() => resizeRenderer());
  resizeObserver.observe(viewport);

  let lastRenderTime = 0;
  let previousCameraPosition = camera.position.clone();
  let previousTarget = controls.target.clone();

  renderer.setAnimationLoop((time) => {
    // 描画は最大約30FPS。カメラが動いていない間はGPUで再描画しない。
    controls.update();

    if (
      !camera.position.equals(previousCameraPosition) ||
      !controls.target.equals(previousTarget)
    ) {
      needsRender = true;
      previousCameraPosition.copy(camera.position);
      previousTarget.copy(controls.target);
    }

    if (!needsRender || time - lastRenderTime < 33) return;
    lastRenderTime = time;
    needsRender = false;
    renderer.render(scene, camera);
  });
}

function resizeRenderer() {
  if (!renderer || !camera) return;

  const w = Math.max(1, viewport.clientWidth);
  const h = Math.max(1, viewport.clientHeight);

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h);
  needsRender = true;
}

function resetCamera() {
  if (!controls || !initialCamera) return;

  camera.position.copy(initialCamera.position);
  controls.target.copy(initialCamera.target);
  controls.update();
  needsRender = true;
}

function updateHoveredCoordinate(event) {
  if (coordinateFramePending) return;
  if (
    !renderer ||
    !camera ||
    !worldGroup ||
    !raycaster ||
    !pointerNdc ||
    !coordinateReadout ||
    !worldGroup.children.length
  ) {
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();

  if (!rect.width || !rect.height) return;

  pointerNdc.x =
    ((event.clientX - rect.left) / rect.width) * 2 - 1;

  pointerNdc.y =
    -((event.clientY - rect.top) / rect.height) * 2 + 1;

  coordinateFramePending = true;
  requestAnimationFrame(() => {
    coordinateFramePending = false;
    if (!worldGroup || !worldGroup.children.length) return;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(worldGroup.children, false);
    const hit = hits[0];
    if (!hit) {
      coordinateReadout.textContent = '座標: ブロックにカーソルを合わせる';
      return;
    }
    const position = hit.point.clone().add(worldCenter);
    coordinateReadout.textContent =
      `座標 X ${Math.floor(position.x + 0.5)} · ` +
      `Y ${Math.floor(position.y + 0.5)} · ` +
      `Z ${Math.floor(position.z + 0.5)}`;
  });
}

function keyByte(key, index) {
  return key.charCodeAt(index) & 255;
}

function int32LEFromKey(key, offset) {
  const b = new Uint8Array([
    keyByte(key, offset),
    keyByte(key, offset + 1),
    keyByte(key, offset + 2),
    keyByte(key, offset + 3)
  ]);

  return new DataView(b.buffer).getInt32(0, true);
}

function signedByte(n) {
  return n > 127 ? n - 256 : n;
}

function isAir(name) {
  return !name ||
    name === 'minecraft:air' ||
    name === 'minecraft:cave_air' ||
    name === 'minecraft:void_air';
}

function parseNbtCompound(bytes, state) {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );

  const readU8 = () => {
    if (state.p >= bytes.length) {
      throw new Error('NBTデータが途中で終わっています');
    }

    return bytes[state.p++];
  };

  const readI16 = () => {
    const v = view.getInt16(state.p, true);
    state.p += 2;
    return v;
  };

  const readU16 = () => {
    const v = view.getUint16(state.p, true);
    state.p += 2;
    return v;
  };

  const readI32 = () => {
    const v = view.getInt32(state.p, true);
    state.p += 4;
    return v;
  };

  const readI64 = () => {
    const v = view.getBigInt64(state.p, true);
    state.p += 8;
    return v;
  };

  const readF32 = () => {
    const v = view.getFloat32(state.p, true);
    state.p += 4;
    return v;
  };

  const readF64 = () => {
    const v = view.getFloat64(state.p, true);
    state.p += 8;
    return v;
  };

  const readString = () => {
    const length = readU16();

    if (state.p + length > bytes.length) {
      throw new Error('NBT文字列の長さが不正です');
    }

    const s = new TextDecoder().decode(
      bytes.subarray(state.p, state.p + length)
    );

    state.p += length;
    return s;
  };

  const payload = (type, depth = 0) => {
    if (depth > 40) {
      throw new Error('NBTの階層が深すぎます');
    }

    switch (type) {
      case 1:
        return (readU8() << 24) >> 24;

      case 2:
        return readI16();

      case 3:
        return readI32();

      case 4:
        return readI64().toString();

      case 5:
        return readF32();

      case 6:
        return readF64();

      case 7: {
        const n = readI32();

        if (n < 0 || n > 10000000) {
          throw new Error('NBT byte array length is invalid');
        }

        const a = bytes.slice(state.p, state.p + n);
        state.p += n;
        return a;
      }

      case 8:
        return readString();

      case 9: {
        const childType = readU8();
        const n = readI32();

        if (n < 0 || n > 1000000) {
          throw new Error('NBT list length is invalid');
        }

        const a = [];

        for (let i = 0; i < n; i++) {
          a.push(payload(childType, depth + 1));
        }

        return a;
      }

      case 10: {
        const o = {};

        while (state.p < bytes.length) {
          const t = readU8();

          if (t === 0) break;

          const name = readString();
          o[name] = payload(t, depth + 1);
        }

        return o;
      }

      case 11: {
        const n = readI32();

        if (n < 0 || n > 1000000) {
          throw new Error('NBT int array length is invalid');
        }

        const a = [];

        for (let i = 0; i < n; i++) {
          a.push(readI32());
        }

        return a;
      }

      case 12: {
        const n = readI32();

        if (n < 0 || n > 1000000) {
          throw new Error('NBT long array length is invalid');
        }

        const a = [];

        for (let i = 0; i < n; i++) {
          a.push(readI64().toString());
        }

        return a;
      }

      default:
        throw new Error(`未対応のNBTタグ: ${type}`);
    }
  };

  const rootType = readU8();

  if (rootType !== 10) {
    throw new Error('ブロックパレットがNBT Compoundではありません');
  }

  readString();

  return payload(10);
}

function readPalette(bytes, cursor) {
  const state = { p: cursor };
  const palette = parseNbtCompound(bytes, state);

  return {
    palette,
    cursor: state.p
  };
}

function parseStorage(bytes, cursor) {
  if (cursor >= bytes.length) {
    throw new Error('サブチャンクのストレージデータがありません');
  }

  const header = bytes[cursor++];
  const bits = header >> 1;

  let indices = null;
  let palette = [];

  if (bits === 0) {
    const result = readPalette(bytes, cursor);

    palette = [result.palette];
    cursor = result.cursor;
  } else {
    const perWord = Math.floor(32 / bits);
    const wordCount = Math.ceil(4096 / perWord);

    if (cursor + wordCount * 4 + 4 > bytes.length) {
      throw new Error('ブロックインデックスのデータが不足しています');
    }

    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );

    const words = new Uint32Array(wordCount);

    for (let i = 0; i < wordCount; i++) {
      words[i] = view.getUint32(cursor + i * 4, true);
    }

    cursor += wordCount * 4;

    indices = new Uint16Array(4096);

    const mask = (2 ** bits) - 1;

    for (let i = 0; i < 4096; i++) {
      const word = words[Math.floor(i / perWord)];

      indices[i] =
        (word >>> ((i % perWord) * bits)) & mask;
    }

    const count = view.getInt32(cursor, true);
    cursor += 4;

    if (count < 1 || count > 65536) {
      throw new Error(`パレット数が不正です: ${count}`);
    }

    for (let i = 0; i < count; i++) {
      const result = readPalette(bytes, cursor);

      palette.push(result.palette);
      cursor = result.cursor;
    }
  }

  return {
    indices,
    palette,
    cursor
  };
}

function parseSubchunk(bytes, keyY) {
  if (!bytes || bytes.length < 2) return null;

  const version = bytes[0];

  if (version !== 8 && version !== 9) {
    return { unsupported: version };
  }

  let cursor = 1;
  const storageCount = bytes[cursor++];

  let subY = keyY;

  if (version === 9) {
    if (cursor >= bytes.length) return null;
    subY = signedByte(bytes[cursor++]);
  }

  if (storageCount < 1 || storageCount > 8) {
    return null;
  }

  const layers = [];

  for (let layer = 0; layer < storageCount; layer++) {
    const storage = parseStorage(bytes, cursor);

    layers.push(storage);
    cursor = storage.cursor;
  }

  return {
    subY,
    layers
  };
}

function paletteName(paletteEntry) {
  if (typeof paletteEntry === 'string') {
    return paletteEntry;
  }

  return paletteEntry?.name ||
    paletteEntry?.Name ||
    'unknown';
}

function blockColor(name) {
  const n = (name || '').replace('minecraft:', '');

  if (n.includes('water') || n.includes('bubble_column')) return 0x5a9fe8;
  if (n.includes('lava') || n.includes('magma')) return 0xe77935;

  if (
    n.includes('grass') ||
    n.includes('leaves') ||
    n.includes('moss') ||
    n.includes('fern') ||
    n.includes('vine')
  ) {
    return n.includes('leaves') ? 0x4e9a53 : 0x70ad59;
  }

  if (
    n.includes('dirt') ||
    n.includes('mud') ||
    n.includes('farmland') ||
    n.includes('podzol')
  ) {
    return 0x8b6548;
  }

  if (
    n.includes('sand') ||
    n.includes('sandstone') ||
    n.includes('end_stone')
  ) {
    return 0xd9c58b;
  }

  if (
    n.includes('snow') ||
    n.includes('quartz') ||
    n.includes('calcite') ||
    n.includes('diorite')
  ) {
    return 0xe5e9e8;
  }

  if (
    n.includes('stone') ||
    n.includes('deepslate') ||
    n.includes('andesite') ||
    n.includes('granite') ||
    n.includes('tuff')
  ) {
    return 0x858b90;
  }

  if (
    n.includes('log') ||
    n.includes('wood') ||
    n.includes('planks') ||
    n.includes('stem') ||
    n.includes('hyphae')
  ) {
    return 0x9b7049;
  }

  if (
    n.includes('brick') ||
    n.includes('terracotta') ||
    n.includes('copper')
  ) {
    return 0xb96e54;
  }

  if (n.includes('glass')) return 0x9bd8d9;

  if (
    n.includes('wool') ||
    n.includes('concrete') ||
    n.includes('shulker')
  ) {
    return 0xb3a5d8;
  }

  if (
    n.includes('iron') ||
    n.includes('chain') ||
    n.includes('metal')
  ) {
    return 0xb8c1c7;
  }

  if (n.includes('gold')) return 0xe3bf4f;

  if (
    n.includes('diamond') ||
    n.includes('prismarine')
  ) {
    return 0x59c5ad;
  }

  if (
    n.includes('coal') ||
    n.includes('obsidian') ||
    n.includes('blackstone')
  ) {
    return 0x45434f;
  }

  if (
    n.includes('flower') ||
    n.includes('tulip') ||
    n.includes('rose') ||
    n.includes('torchflower')
  ) {
    return 0xd88bb5;
  }

  return 0x9da8a0;
}

function isTransparentLike(name) {
  return isAir(name) ||
    /water|lava|glass|leaves|flower|tallgrass|short_grass|fern|vine|torch|rail|ladder|seagrass|kelp|fire|snow_layer|carpet|button|pressure_plate/.test(name || '');
}

const YIELD_EVERY_SUBCHUNKS = 8;
const FACE_DEFS = [
  { n: [ 1, 0, 0], c: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { n: [-1, 0, 0], c: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { n: [ 0, 1, 0], c: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
  { n: [ 0,-1, 0], c: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  { n: [ 0, 0, 1], c: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
  { n: [ 0, 0,-1], c: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }
];

function chunkKey(x, y, z) {
  return `${x},${y},${z}`;
}

function localIndex(x, y, z) {
  return x * 256 + z * 16 + y;
}

function packBlock(name) {
  if (isAir(name)) return 0;
  return (blockColor(name) | (isTransparentLike(name) ? 0x80000000 : 0)) >>> 0;
}

function packedPalette(layer) {
  if (!layer) return null;
  return layer.palette.map(entry => packBlock(paletteName(entry)));
}

function clearWorldMeshes() {
  if (!worldGroup) return;
  for (const child of worldGroup.children) {
    child.geometry?.dispose?.();
    if (child.material && child.material !== surfaceMaterial) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.());
      else child.material.dispose?.();
    }
  }
  worldGroup.clear();
}

let surfaceMaterial = null;
function createSurfaceMaterial() {
  if (!surfaceMaterial) {
    surfaceMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.FrontSide
    });
  }
  return surfaceMaterial;
}

function getVoxel(chunks, chunk, lx, ly, lz) {
  if (lx >= 0 && lx < 16 && ly >= 0 && ly < 16 && lz >= 0 && lz < 16) {
    return chunk.voxels[localIndex(lx, ly, lz)];
  }
  let nx = chunk.cx, ny = chunk.cy, nz = chunk.cz;
  if (lx < 0) { nx--; lx = 15; } else if (lx > 15) { nx++; lx = 0; }
  if (ly < 0) { ny--; ly = 15; } else if (ly > 15) { ny++; ly = 0; }
  if (lz < 0) { nz--; lz = 15; } else if (lz > 15) { nz++; lz = 0; }
  const neighbor = chunks.get(chunkKey(nx, ny, nz));
  return neighbor ? neighbor.voxels[localIndex(lx, ly, lz)] : 0;
}

function faceIsVisible(chunks, chunk, x, y, z, face) {
  const n = face.n;
  const packed = getVoxel(chunks, chunk, x + n[0], y + n[1], z + n[2]);
  return packed === 0 || (packed >>> 31) === 1;
}

function faceAxes(faceIndex) {
  if (faceIndex < 2) return { axis: 0, u: 2, v: 1 };
  if (faceIndex < 4) return { axis: 1, u: 0, v: 2 };
  return { axis: 2, u: 0, v: 1 };
}

function voxelAtAxis(x, y, z, axis, value) {
  if (axis === 0) x = value;
  else if (axis === 1) y = value;
  else z = value;
  return [x, y, z];
}

function walkGreedyFaces(chunks, chunk, visit) {
  const voxels = chunk.voxels;
  for (let f = 0; f < 6; f++) {
    const def = FACE_DEFS[f];
    const { axis, u, v } = faceAxes(f);
    const mask = new Uint32Array(256);
    for (let slice = 0; slice < 16; slice++) {
      mask.fill(0);
      for (let vv = 0; vv < 16; vv++) {
        for (let uu = 0; uu < 16; uu++) {
          const c = [0, 0, 0];
          c[axis] = slice; c[u] = uu; c[v] = vv;
          const packed = voxels[localIndex(c[0], c[1], c[2])];
          if (!packed) continue;
          if (faceIsVisible(chunks, chunk, c[0], c[1], c[2], def)) {
            mask[vv * 16 + uu] = packed;
          }
        }
      }
      for (let vv = 0; vv < 16; vv++) {
        for (let uu = 0; uu < 16;) {
          const packed = mask[vv * 16 + uu];
          if (!packed) { uu++; continue; }
          let width = 1;
          while (uu + width < 16 && mask[vv * 16 + uu + width] === packed) width++;
          let height = 1, canGrow = true;
          while (vv + height < 16 && canGrow) {
            for (let k = 0; k < width; k++) {
              if (mask[(vv + height) * 16 + uu + k] !== packed) { canGrow = false; break; }
            }
            if (canGrow) height++;
          }
          for (let dy = 0; dy < height; dy++) {
            for (let dx = 0; dx < width; dx++) mask[(vv + dy) * 16 + uu + dx] = 0;
          }
          visit(f, axis, u, v, slice, uu, vv, width, height, packed, def);
          uu += width;
        }
      }
    }
  }
}

function buildChunkSurface(chunks, chunk, center) {
  // 面の走査は1回だけ行う。従来は同じチャンクを2回走査していたため、
  // 大きなワールドほどメッシュ生成時間が増えていた。
  const faces = [];
  walkGreedyFaces(chunks, chunk, (...faceData) => faces.push(faceData));
  const faceCount = faces.length;
  if (!faceCount) return null;

  const positions = new Float32Array(faceCount * 12);
  const colors = new Uint8Array(faceCount * 12);
  const indices = new (faceCount * 4 > 65535 ? Uint32Array : Uint16Array)(faceCount * 6);

  for (let face = 0; face < faceCount; face++) {
    const [f, axis, u, v, slice, uu, vv, width, height, packed, def] = faces[face];
    const vStart = face * 4;
    const r = (packed >>> 16) & 0xff;
    const g = (packed >>> 8) & 0xff;
    const b = packed & 0xff;

    for (let c = 0; c < 4; c++) {
      const corner = def.c[c];
      let x = 0, y = 0, z = 0;
      const axisValue = slice + (def.n[axis] > 0 ? 1 : 0);
      if (axis === 0) x = axisValue * 2 - 1;
      else if (axis === 1) y = axisValue * 2 - 1;
      else z = axisValue * 2 - 1;
      const uValue = (uu + corner[u] * width) * 2 - 1;
      const vValue = (vv + corner[v] * height) * 2 - 1;
      if (u === 0) x = uValue;
      else if (u === 1) y = uValue;
      else z = uValue;
      if (v === 0) x = vValue;
      else if (v === 1) y = vValue;
      else z = vValue;

      const p = (vStart + c) * 3;
      positions[p] = x;
      positions[p + 1] = y;
      positions[p + 2] = z;
      colors[p] = r;
      colors[p + 1] = g;
      colors[p + 2] = b;
    }

    const ii = face * 6;
    indices[ii] = vStart;
    indices[ii + 1] = vStart + 1;
    indices[ii + 2] = vStart + 2;
    indices[ii + 3] = vStart;
    indices[ii + 4] = vStart + 2;
    indices[ii + 5] = vStart + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

window.startWorldViewer = async (file) => {
  if (file) chooseFile(file);
  else if (!selectedFile) chooseFile(fileInput.files?.[0]);
  if (!selectedFile) {
    setStatus('.mcworld ファイルを先に選択してください。', 'error');
    return;
  }
  await loadWorld();
};

async function loadWorld() {
  if (!selectedFile || isLoading) return;
  const fileToLoad = selectedFile;
  isLoading = true;
  loadButton.disabled = true;
  $('emptyState').classList.add('hidden');
  setLoading(true, 'ワールドを解析中…', 'LevelDBとチャンクデータを読み込んでいます。');
  setStatus('LevelDBを読み込んでいます…');
  $('chunkCount').textContent = '…';
  $('blockCount').textContent = '…';
  $('renderCount').textContent = '…';

  try {
    initScene();
    clearWorldMeshes();
    setStatus('3D描画を開始しました。ライブラリを読み込んでいます…');
    const readerModule = await import('https://cdn.jsdelivr.net/npm/mcbe-leveldb-reader@5.0.1/+esm');
    const readMcworld = readerModule.readMcworld || readerModule.default?.readMcworld;
    if (typeof readMcworld !== 'function') throw new Error('ワールド読み込みライブラリの初期化に失敗しました。ページを再読み込みしてください。');
    const entries = await readMcworld(fileToLoad);
    if (!(entries instanceof Map)) throw new Error('LevelDBの読み込み結果が想定と異なります');

    setLoading(true, 'チャンクを解析中…', `${entries.size.toLocaleString()} 個のLevelDBキーを確認しました。`);
    const dimensions = new Map();
    let unsupported = 0, processed = 0, candidateCount = 0;
    for (const [key, entry] of entries) {
      const length = key.length;
      if ((length !== 10 && length !== 14) || keyByte(key, length - 2) !== 0x2f) continue;
      const cx = int32LEFromKey(key, 0);
      const cz = int32LEFromKey(key, 4);
      const dimension = length === 14 ? int32LEFromKey(key, 8) : 0;
      const keyY = signedByte(keyByte(key, length - 1));
      if (!(entry?.value instanceof Uint8Array)) continue;
      candidateCount++;
      let parsed;
      try { parsed = parseSubchunk(entry.value, keyY); }
      catch (error) { console.warn('Subchunk parse failed:', key, error); continue; }
      if (!parsed || parsed.unsupported) { if (parsed?.unsupported) unsupported++; continue; }
      const solid = parsed.layers[0], fluid = parsed.layers[1];
      const solidPalette = packedPalette(solid), fluidPalette = packedPalette(fluid);
      const voxels = new Uint32Array(4096);
      let chunkBlocks = 0;
      let data = dimensions.get(dimension);
      if (!data) {
        data = { chunks: new Map(), blockCount: 0, minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, parsedCount: 0 };
        dimensions.set(dimension, data);
      }
      for (let i = 0; i < 4096; i++) {
        const solidIndex = solid?.indices ? solid.indices[i] : 0;
        let packed = solidPalette?.[solidIndex] || 0;
        if (!packed && fluidPalette) {
          const fluidIndex = fluid?.indices ? fluid.indices[i] : 0;
          packed = fluidPalette[fluidIndex] || 0;
        }
        if (!packed) continue;
        voxels[i] = packed; chunkBlocks++; data.blockCount++;
        const lx = Math.floor(i / 256), lz = Math.floor(i / 16) % 16, ly = i % 16;
        const wx = cx * 16 + lx, wy = parsed.subY * 16 + ly, wz = cz * 16 + lz;
        if (wx < data.minX) data.minX = wx; if (wy < data.minY) data.minY = wy; if (wz < data.minZ) data.minZ = wz;
        if (wx > data.maxX) data.maxX = wx; if (wy > data.maxY) data.maxY = wy; if (wz > data.maxZ) data.maxZ = wz;
      }
      if (chunkBlocks) {
        data.chunks.set(chunkKey(cx, parsed.subY, cz), { cx, cy: parsed.subY, cz, voxels });
        data.parsedCount++;
      }
      processed++;
      if (processed % YIELD_EVERY_SUBCHUNKS === 0) {
        $('loadingText').textContent = `サブチャンク ${processed.toLocaleString()} / ${candidateCount.toLocaleString()}`;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    entries.clear();
    const available = [...dimensions.entries()].filter(([, d]) => d.chunks.size && d.blockCount);
    if (!available.length) throw new Error('ブロックを復元できませんでした。旧形式または未対応形式の可能性があります。');
    loadedDimensions = new Map(available);
    activeFileName = fileToLoad.name;
    const select = document.getElementById('dimensionSelect');
    const dimensionControl = select?.closest('.dimension-control');
    const dimensionName = id => id === 0 ? 'Overworld' : id === 1 ? 'Nether' : id === 2 ? 'The End' : `Custom (${id})`;
    const initialId = available.some(([id]) => id === 0) ? 0 : available[0][0];

    // ディメンションが1つだけでも正常に読み込む。選択欄が存在しない場合もエラーにしない。
    if (select instanceof HTMLSelectElement) {
      select.options.length = 0;
      for (const [id] of available) {
        const option = document.createElement('option');
        option.value = String(id);
        option.textContent = dimensionName(id);
        select.add(option);
      }
      select.disabled = available.length < 2;
      select.onchange = () => showDimension(Number(select.value));
      select.value = String(initialId);
      if (dimensionControl) dimensionControl.hidden = available.length < 2;
    } else if (dimensionControl) {
      dimensionControl.hidden = true;
    }
    await showDimension(initialId);
    const warnings = unsupported ? `${unsupported} 個の未対応形式サブチャンクをスキップしました。` : '';
    setStatus(`読み込み完了。${available.length} 個のディメンションを検出。${warnings || 'マウスや指で回転・ズームできます。'}`, 'success');
    setLoading(false);
  } catch (error) {
    console.error(error);
    clearWorldMeshes();
    setLoading(false);
    $('emptyState').classList.remove('hidden');
    setStatus(`${fileToLoad.name} の読み込みエラー: ${error?.message || error}`, 'error');
  } finally {
    isLoading = false;
    loadButton.disabled = !selectedFile;
  }
}

async function showDimension(id) {
  const data = loadedDimensions.get(id);
  if (!data) return;
  setLoading(true, 'ディメンションを切り替え中…', '3Dモデルを作成しています。');
  await new Promise(resolve => setTimeout(resolve, 0));
  const renderedCount = await renderCompactChunks(data.chunks, data);
  $('chunkCount').textContent = data.parsedCount.toLocaleString();
  $('blockCount').textContent = data.blockCount.toLocaleString();
  $('renderCount').textContent = renderedCount.toLocaleString();
  const name = id === 0 ? 'Overworld' : id === 1 ? 'Nether' : id === 2 ? 'The End' : `Custom (${id})`;
  $('viewerHint').textContent = `${activeFileName} · ${name}`;
  const dimensionLabel = $('dimensionLabel');
  if (dimensionLabel) dimensionLabel.textContent = name;
  setLoading(false);
}

async function renderCompactChunks(chunks, bounds) {
  clearWorldMeshes();
  createSurfaceMaterial();
  const center = new THREE.Vector3(
    (bounds.minX + bounds.maxX + 1) / 2,
    (bounds.minY + bounds.maxY + 1) / 2,
    (bounds.minZ + bounds.maxZ + 1) / 2
  );
  worldCenter.copy(center);
  worldGroup.position.set(0, 0, 0);
  let renderedFaces = 0;
  let processed = 0;
  const total = chunks.size;

  // 初期視点（ワールド原点付近）に近いチャンクから作り、
  // 巨大ワールドでも最初の表示が出るまでの待ち時間を短くする。
  const orderedChunks = [...chunks.values()].sort((a, b) => {
    const adx = a.cx * 16 + 8;
    const adz = a.cz * 16 + 8;
    const bdx = b.cx * 16 + 8;
    const bdz = b.cz * 16 + 8;
    return (adx * adx + adz * adz) - (bdx * bdx + bdz * bdz);
  });

  // 小さなバッチ単位で生成する。毎サブチャンクごとのタイマーとDOM更新を減らし、
  // 生成中は定期的にブラウザへ制御を返して操作不能になる時間を抑える。
  const CHUNKS_PER_BATCH = 4;
  for (let start = 0; start < orderedChunks.length; start += CHUNKS_PER_BATCH) {
    const end = Math.min(start + CHUNKS_PER_BATCH, orderedChunks.length);

    for (let i = start; i < end; i++) {
      const chunk = orderedChunks[i];
      const geometry = buildChunkSurface(chunks, chunk, center);
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, surfaceMaterial);
        mesh.position.set(
          chunk.cx * 16 - center.x,
          chunk.cy * 16 - center.y,
          chunk.cz * 16 - center.z
        );
        mesh.scale.setScalar(0.5);
        mesh.frustumCulled = true;
        worldGroup.add(mesh);
        renderedFaces += geometry.index ? geometry.index.count / 6 : 0;
      }
      processed++;
    }

    $('loadingText').textContent = `可視面を生成中… ${processed.toLocaleString()} / ${total.toLocaleString()} サブチャンク · ${renderedFaces.toLocaleString()} 面`;
    needsRender = true;
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  // 初期視点はワールド座標 (0, 0) 付近に固定し、ワールドサイズからズームを自動計算しない。
  // 表示用モデルは center 分だけ原点移動しているため、座標変換した原点を注視点にする。
  const originTarget = new THREE.Vector3(-center.x, -center.y, -center.z);
  controls.target.copy(originTarget);
  camera.position.set(
    originTarget.x + 90,
    originTarget.y + 75,
    originTarget.z + 90
  );
  camera.near = 0.1;
  camera.far = 10000;
  camera.updateProjectionMatrix();
  controls.minDistance = 1;
  controls.maxDistance = 2500;
  controls.update();
  needsRender = true;
  initialCamera = { position: camera.position.clone(), target: controls.target.clone() };
  $('emptyState').classList.add('hidden');
  return renderedFaces;
}

document.documentElement.dataset.viewerReady = 'true';
