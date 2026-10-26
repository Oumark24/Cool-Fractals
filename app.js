const MIN_HALF_HEIGHT = 1e-7;
const MAX_HALF_HEIGHT = 3;
const DEFAULT_VIEW = Object.freeze({ centerRe: -0.5, centerIm: 0, halfHeight: 1.3 });
const MAX_SAVED_VIEWS = 24;
const STORAGE_KEY = 'mandelbrot-explorer:saved-views:v1';

export function screenToComplex(point, bounds, view) {
  const width = Number(bounds?.width) || 0;
  const height = Number(bounds?.height) || 0;
  if (width <= 0 || height <= 0) {
    return { re: view.centerRe, im: view.centerIm };
  }

  const aspect = width / height;
  return {
    re: view.centerRe + (point.x / width - 0.5) * 2 * view.halfHeight * aspect,
    im: view.centerIm + (0.5 - point.y / height) * 2 * view.halfHeight
  };
}

export function zoomViewAt(view, point, bounds, factor) {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(view.halfHeight)) {
    return { ...view };
  }

  const anchor = screenToComplex(point, bounds, view);
  const halfHeight = Math.min(MAX_HALF_HEIGHT, Math.max(MIN_HALF_HEIGHT, view.halfHeight / factor));
  const zoomed = { ...view, halfHeight };
  const after = screenToComplex(point, bounds, zoomed);

  return {
    ...zoomed,
    centerRe: view.centerRe + anchor.re - after.re,
    centerIm: view.centerIm + anchor.im - after.im
  };
}

export function panViewByPixels(view, delta, bounds) {
  const width = Number(bounds?.width) || 0;
  const height = Number(bounds?.height) || 0;
  if (width <= 0 || height <= 0) return { ...view };

  const dx = Number.isFinite(delta?.x) ? delta.x : 0;
  const dy = Number.isFinite(delta?.y) ? delta.y : 0;
  return {
    ...view,
    centerRe: view.centerRe - (dx / width) * 2 * view.halfHeight * (width / height),
    centerIm: view.centerIm + (dy / height) * 2 * view.halfHeight
  };
}

export function parseSavedViews(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .filter((entry) => typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 80)
    .filter((entry) => typeof entry.name === 'string' && entry.name.trim().length > 0 && entry.name.trim().length <= 40)
    .filter((entry) => Number.isFinite(entry.centerRe) && Number.isFinite(entry.centerIm))
    .filter((entry) => Number.isFinite(entry.halfHeight) && entry.halfHeight >= MIN_HALF_HEIGHT && entry.halfHeight <= MAX_HALF_HEIGHT)
    .slice(0, MAX_SAVED_VIEWS)
    .map((entry) => ({
      id: entry.id,
      name: entry.name.trim(),
      centerRe: entry.centerRe,
      centerIm: entry.centerIm,
      halfHeight: entry.halfHeight
    }));
}

export function mandelbrotSmoothCount(re, im, maxIterations = 220) {
  if (!Number.isFinite(re) || !Number.isFinite(im) || !Number.isFinite(maxIterations) || maxIterations < 1) return null;
  const shiftedReal = re - 0.25;
  const q = shiftedReal * shiftedReal + im * im;
  if (q * (q + shiftedReal) <= 0.25 * im * im) return null;
  if ((re + 1) * (re + 1) + im * im <= 0.0625) return null;

  let zReal = 0;
  let zImaginary = 0;
  for (let iteration = 1; iteration <= Math.floor(maxIterations); iteration += 1) {
    const nextReal = zReal * zReal - zImaginary * zImaginary + re;
    zImaginary = 2 * zReal * zImaginary + im;
    zReal = nextReal;
    const magnitudeSquared = zReal * zReal + zImaginary * zImaginary;
    if (magnitudeSquared > 4) {
      const magnitude = Math.sqrt(magnitudeSquared);
      return iteration + 1 - Math.log2(Math.log2(magnitude));
    }
  }
  return null;
}

const PRESETS = [
  { id: 'whole', name: 'The whole set', note: 'Start here', centerRe: -0.5, centerIm: 0, halfHeight: 1.3 },
  { id: 'seahorse', name: 'Seahorse Valley', note: 'Around −0.75 + 0.10i', centerRe: -0.75, centerIm: 0.1, halfHeight: 0.09 },
  { id: 'elephant', name: 'Elephant Valley', note: 'Around +0.28 + 0.01i', centerRe: 0.28, centerIm: 0.01, halfHeight: 0.11 },
  { id: 'mini', name: 'Miniature island', note: 'Around −1.75 + 0.00i', centerRe: -1.75, centerIm: 0, halfHeight: 0.045 }
];

const PALETTES = [
  { id: 'ember', label: 'Ember', index: 0 },
  { id: 'tide', label: 'Tide', index: 1 },
  { id: 'moss', label: 'Moss', index: 2 },
  { id: 'orchid', label: 'Orchid', index: 3 }
];

function formatCoordinate(value) {
  const formatted = Math.abs(value) < 0.0001 && value !== 0
    ? Math.abs(value).toExponential(3)
    : Math.abs(value).toFixed(5);
  return `${value < 0 ? '−' : '+'}${formatted}`;
}

function formatZoom(zoom) {
  if (zoom >= 1_000_000) return `${(zoom / 1_000_000).toFixed(1)}m×`;
  if (zoom >= 1_000) return `${(zoom / 1_000).toFixed(1)}k×`;
  return `${zoom.toFixed(1)}×`;
}

function makeFragmentShader(precision) {
  return `
    precision ${precision} float;
    uniform vec2 u_resolution;
    uniform vec2 u_center;
    uniform float u_halfHeight;
    uniform int u_iterations;
    uniform int u_palette;

    vec3 colorRamp(float position) {
      vec3 c0;
      vec3 c1;
      vec3 c2;
      vec3 c3;

      if (u_palette == 0) {
        c0 = vec3(0.035, 0.13, 0.22);
        c1 = vec3(0.08, 0.53, 0.64);
        c2 = vec3(0.96, 0.68, 0.31);
        c3 = vec3(0.81, 0.23, 0.18);
      } else if (u_palette == 1) {
        c0 = vec3(0.025, 0.10, 0.28);
        c1 = vec3(0.07, 0.36, 0.66);
        c2 = vec3(0.19, 0.77, 0.73);
        c3 = vec3(0.91, 0.85, 0.57);
      } else if (u_palette == 2) {
        c0 = vec3(0.08, 0.20, 0.16);
        c1 = vec3(0.28, 0.48, 0.28);
        c2 = vec3(0.78, 0.72, 0.34);
        c3 = vec3(0.80, 0.34, 0.18);
      } else {
        c0 = vec3(0.13, 0.10, 0.31);
        c1 = vec3(0.39, 0.26, 0.69);
        c2 = vec3(0.76, 0.36, 0.66);
        c3 = vec3(0.94, 0.67, 0.49);
      }

      float p = fract(position);
      if (p < 0.3333) return mix(c0, c1, p * 3.0);
      if (p < 0.6666) return mix(c1, c2, (p - 0.3333) * 3.0);
      return mix(c2, c3, (p - 0.6666) * 3.0);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;
      float aspect = u_resolution.x / u_resolution.y;
      vec2 c = vec2(
        u_center.x + (uv.x - 0.5) * 2.0 * u_halfHeight * aspect,
        u_center.y + (uv.y - 0.5) * 2.0 * u_halfHeight
      );
      vec2 z = vec2(0.0, 0.0);
      float magnitudeSquared = 0.0;
      int iteration = 0;

      for (int n = 0; n < 600; n++) {
        if (n >= u_iterations) break;
        float nextReal = z.x * z.x - z.y * z.y + c.x;
        float nextImaginary = 2.0 * z.x * z.y + c.y;
        z = vec2(nextReal, nextImaginary);
        iteration = n + 1;
        magnitudeSquared = dot(z, z);
        if (magnitudeSquared > 4.0) break;
      }

      if (iteration >= u_iterations && magnitudeSquared <= 4.0) {
        gl_FragColor = vec4(0.025, 0.055, 0.082, 1.0);
      } else {
        float magnitude = sqrt(max(magnitudeSquared, 4.00001));
        float smoothCount = float(iteration) + 1.0 - log2(max(log2(magnitude), 0.000001));
        float bands = smoothCount * 0.037;
        vec3 color = colorRamp(bands);
        float light = 0.90 + 0.10 * cos(6.28318 * fract(smoothCount * 0.012));
        gl_FragColor = vec4(color * light, 1.0);
      }
    }
  `;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('The browser could not allocate a shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(shader) || 'The shader did not compile.';
    gl.deleteShader(shader);
    throw new Error(reason);
  }
  return shader;
}

function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return createCanvas2DRenderer(canvas);

  const highPrecision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const precision = highPrecision && highPrecision.precision > 0 ? 'highp' : 'mediump';
  const vertexSource = `
    attribute vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
  `;
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, makeFragmentShader(precision));
  const program = gl.createProgram();
  if (!program) throw new Error('The browser could not create a drawing program.');
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(program) || 'The drawing program could not link.';
    gl.deleteProgram(program);
    throw new Error(reason);
  }

  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('The browser could not allocate the canvas buffer.');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW);

  gl.useProgram(program);
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  const uniforms = {
    resolution: gl.getUniformLocation(program, 'u_resolution'),
    center: gl.getUniformLocation(program, 'u_center'),
    halfHeight: gl.getUniformLocation(program, 'u_halfHeight'),
    iterations: gl.getUniformLocation(program, 'u_iterations'),
    palette: gl.getUniformLocation(program, 'u_palette')
  };

  return {
    mode: 'webgl',
    gl,
    draw(view, paletteIndex, zoom) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      const dpr = window.devicePixelRatio || 1;
      const maxPixels = 3_200_000;
      const pixelRatio = Math.min(dpr, 1.75, Math.sqrt(maxPixels / (rect.width * rect.height)));
      const width = Math.max(1, Math.floor(rect.width * pixelRatio));
      const height = Math.max(1, Math.floor(rect.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const iterations = Math.max(180, Math.min(560, Math.round(220 + Math.log10(Math.max(zoom, 1)) * 42)));
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform2f(uniforms.center, view.centerRe, view.centerIm);
      gl.uniform1f(uniforms.halfHeight, view.halfHeight);
      gl.uniform1i(uniforms.iterations, iterations);
      gl.uniform1i(uniforms.palette, paletteIndex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  };
}

function makeCpuColorLookup(paletteIndex) {
  const palettes = [
    [[9, 33, 56], [20, 135, 164], [245, 180, 79], [203, 57, 43]],
    [[7, 26, 65], [24, 100, 174], [42, 190, 171], [236, 226, 163]],
    [[21, 47, 38], [72, 124, 78], [188, 181, 71], [201, 83, 41]],
    [[34, 25, 75], [100, 67, 160], [190, 79, 147], [241, 168, 119]]
  ];
  const stops = palettes[paletteIndex] || palettes[0];
  const lookup = new Uint8ClampedArray(256 * 3);
  for (let index = 0; index < 256; index += 1) {
    const scaled = (index / 255) * (stops.length - 1);
    const segment = Math.min(stops.length - 2, Math.floor(scaled));
    const amount = scaled - segment;
    for (let channel = 0; channel < 3; channel += 1) {
      lookup[index * 3 + channel] = Math.round(
        stops[segment][channel] * (1 - amount) + stops[segment + 1][channel] * amount
      );
    }
  }
  return lookup;
}

function createCanvas2DRenderer(canvas) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Neither WebGL nor Canvas 2D is available in this browser.');
  let renderToken = 0;

  return {
    mode: 'canvas2d',
    draw(view, paletteIndex, zoom) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      const pixelRatio = Math.min(1, 620 / rect.width, 460 / rect.height);
      const width = Math.max(1, Math.floor(rect.width * pixelRatio));
      const height = Math.max(1, Math.floor(rect.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const image = context.createImageData(width, height);
      const pixels = image.data;
      const colors = makeCpuColorLookup(paletteIndex);
      const maxIterations = Math.max(160, Math.min(420, Math.round(185 + Math.log10(Math.max(zoom, 1)) * 34)));
      const aspect = width / height;
      const token = ++renderToken;
      let row = 0;

      const drawRows = () => {
        if (token !== renderToken) return;
        const startRow = row;
        const endRow = Math.min(height, startRow + 18);
        for (; row < endRow; row += 1) {
          const imaginary = view.centerIm + (0.5 - (row + 0.5) / height) * 2 * view.halfHeight;
          for (let column = 0; column < width; column += 1) {
            const real = view.centerRe + ((column + 0.5) / width - 0.5) * 2 * view.halfHeight * aspect;
            const smoothCount = mandelbrotSmoothCount(real, imaginary, maxIterations);
            const offset = (row * width + column) * 4;
            if (smoothCount === null) {
              pixels[offset] = 6;
              pixels[offset + 1] = 14;
              pixels[offset + 2] = 21;
            } else {
              const cycle = ((smoothCount * 0.037) % 1 + 1) % 1;
              const colorIndex = Math.min(255, Math.floor(cycle * 255));
              pixels[offset] = colors[colorIndex * 3];
              pixels[offset + 1] = colors[colorIndex * 3 + 1];
              pixels[offset + 2] = colors[colorIndex * 3 + 2];
            }
            pixels[offset + 3] = 255;
          }
        }

        context.putImageData(image, 0, 0, 0, startRow, width, endRow - startRow);
        if (row < height) window.requestAnimationFrame(drawRows);
      };

      drawRows();
    }
  };
}

function initApp() {
  const canvas = document.getElementById('fractal-canvas');
  if (!canvas) return;

  const errorBox = document.getElementById('render-error');
  const status = document.getElementById('status-message');
  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  let renderer;
  try {
    renderer = createRenderer(canvas);
  } catch (error) {
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = `The fractal could not start. ${error.message}`;
    }
    setStatus(`Rendering unavailable. ${error.message}`);
    document.querySelectorAll('[data-requires-renderer]').forEach((control) => { control.disabled = true; });
    return;
  }

  const rendererLabel = document.getElementById('renderer-label');
  if (rendererLabel) rendererLabel.textContent = renderer.mode === 'webgl' ? 'GPU render' : 'Software render';

  let view = { ...DEFAULT_VIEW };
  let palette = 'ember';
  let activeSavedId = null;
  let savedViews = loadSavedViews();
  let drag = null;
  let hasStorage = true;

  const coordinateReadout = document.getElementById('coordinate-readout');
  const zoomReadout = document.getElementById('zoom-readout');
  const depthReadout = document.getElementById('depth-readout');
  const precisionNote = document.getElementById('precision-note');
  const savedList = document.getElementById('saved-list');
  const savedEmpty = document.getElementById('saved-empty');
  const savedCount = document.getElementById('saved-count');
  const viewName = document.getElementById('view-name');
  const canvasWrap = document.getElementById('canvas-wrap');

  function canvasBounds() {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function currentZoom() {
    return DEFAULT_VIEW.halfHeight / view.halfHeight;
  }

  function updateReadouts() {
    const zoom = currentZoom();
    const coords = `Re ${formatCoordinate(view.centerRe)}  ·  Im ${formatCoordinate(view.centerIm)}`;
    if (coordinateReadout) coordinateReadout.textContent = coords;
    if (zoomReadout) zoomReadout.textContent = formatZoom(zoom);
    if (depthReadout) depthReadout.textContent = `${formatZoom(zoom)} from the whole set`;
    if (precisionNote) precisionNote.hidden = zoom < 100_000;
    canvas.setAttribute('aria-label', `Mandelbrot set, centered at real ${formatCoordinate(view.centerRe)} and imaginary ${formatCoordinate(view.centerIm)}, zoom ${formatZoom(zoom)}. Use arrow keys to pan and plus or minus to zoom.`);
  }

  function render() {
    renderer.draw(view, PALETTES.find((item) => item.id === palette)?.index ?? 0, currentZoom());
    updateReadouts();
  }

  function clearSelection() {
    activeSavedId = null;
    document.querySelectorAll('[data-preset]').forEach((button) => {
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
    });
    document.querySelectorAll('[data-view-id]').forEach((button) => {
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
    });
  }

  function selectPreset(preset, message = `Showing ${preset.name}.`) {
    view = { centerRe: preset.centerRe, centerIm: preset.centerIm, halfHeight: preset.halfHeight };
    activeSavedId = null;
    document.querySelectorAll('[data-preset]').forEach((button) => {
      const selected = button.dataset.preset === preset.id;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('[data-view-id]').forEach((button) => {
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
    });
    render();
    setStatus(message);
  }

  function zoomAt(point, factor, actionName = 'Zoom changed') {
    const previous = view;
    view = zoomViewAt(view, point, canvasBounds(), factor);
    clearSelection();
    render();
    if (Math.abs(view.halfHeight - previous.halfHeight) < 1e-14) {
      setStatus('You are at the practical precision limit. Pan to another area or reset the view.');
    } else {
      setStatus(`${actionName}. Current zoom ${formatZoom(currentZoom())}.`);
    }
  }

  function moveByPixels(delta, message = 'View moved.') {
    view = panViewByPixels(view, delta, canvasBounds());
    clearSelection();
    render();
    setStatus(message);
  }

  function saveToStorage() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedViews));
      hasStorage = true;
      return true;
    } catch {
      hasStorage = false;
      return false;
    }
  }

  function renderSavedViews() {
    if (!savedList || !savedEmpty) return;
    savedList.replaceChildren();
    savedEmpty.hidden = savedViews.length > 0;
    savedList.hidden = savedViews.length === 0;
    if (savedCount) {
      savedCount.textContent = savedViews.length === 0
        ? (hasStorage ? 'Stored on this device.' : 'Available until this page closes.')
        : `${savedViews.length} saved ${savedViews.length === 1 ? 'view' : 'views'} · ${hasStorage ? 'this device' : 'this session'}`;
    }

    savedViews.forEach((saved, index) => {
      const item = document.createElement('li');
      item.className = 'saved-item';

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'saved-select';
      select.dataset.viewId = saved.id;
      select.setAttribute('aria-pressed', String(activeSavedId === saved.id));
      select.classList.toggle('is-active', activeSavedId === saved.id);
      select.setAttribute('aria-label', `Open saved view ${saved.name}, real ${formatCoordinate(saved.centerRe)}, imaginary ${formatCoordinate(saved.centerIm)}`);

      const number = document.createElement('span');
      number.className = 'saved-number';
      number.textContent = String(index + 1).padStart(2, '0');

      const details = document.createElement('span');
      details.className = 'saved-details';
      const name = document.createElement('span');
      name.className = 'saved-name';
      name.textContent = saved.name;
      const coordinates = document.createElement('span');
      coordinates.className = 'saved-coordinates';
      coordinates.textContent = `Re ${formatCoordinate(saved.centerRe)} · Im ${formatCoordinate(saved.centerIm)}`;
      details.append(name, coordinates);
      select.append(number, details);
      select.addEventListener('click', () => {
        view = { centerRe: saved.centerRe, centerIm: saved.centerIm, halfHeight: saved.halfHeight };
        activeSavedId = saved.id;
        document.querySelectorAll('[data-preset]').forEach((button) => {
          button.classList.remove('is-active');
          button.setAttribute('aria-pressed', 'false');
        });
        renderSavedViews();
        render();
        setStatus(`Showing saved view ${saved.name}.`);
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-view';
      remove.setAttribute('aria-label', `Remove ${saved.name}`);
      remove.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 6h12M8 6V4h4v2m-6 0 .7 10h6.6L14 6m-5 3v4m2-4v4"/></svg>';
      remove.addEventListener('click', () => {
        savedViews = savedViews.filter((entry) => entry.id !== saved.id);
        if (activeSavedId === saved.id) activeSavedId = null;
        saveToStorage();
        renderSavedViews();
        setStatus(`Removed ${saved.name}.`);
      });

      item.append(select, remove);
      savedList.append(item);
    });
  }

  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = PRESETS.find((item) => item.id === button.dataset.preset);
      if (preset) selectPreset(preset);
    });
  });

  document.querySelectorAll('[data-palette]').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = PALETTES.find((item) => item.id === button.dataset.palette);
      if (!selected) return;
      palette = selected.id;
      document.querySelectorAll('[data-palette]').forEach((choice) => {
        const active = choice.dataset.palette === palette;
        choice.setAttribute('aria-pressed', String(active));
        choice.classList.toggle('is-active', active);
      });
      render();
      setStatus(`${selected.label} palette selected.`);
    });
  });

  document.getElementById('zoom-in')?.addEventListener('click', () => {
    const bounds = canvasBounds();
    zoomAt({ x: bounds.width / 2, y: bounds.height / 2 }, 1.7, 'Zoomed in');
  });
  document.getElementById('zoom-out')?.addEventListener('click', () => {
    const bounds = canvasBounds();
    zoomAt({ x: bounds.width / 2, y: bounds.height / 2 }, 1 / 1.7, 'Zoomed out');
  });
  document.getElementById('reset-view')?.addEventListener('click', () => {
    selectPreset(PRESETS[0], 'Reset to the whole set. Saved views are unchanged.');
  });

  document.getElementById('saved-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = viewName?.value.trim().slice(0, 40);
    if (!name) {
      viewName?.focus();
      setStatus('Give this view a name before saving it.');
      return;
    }
    if (savedViews.length >= MAX_SAVED_VIEWS) {
      setStatus(`You can keep up to ${MAX_SAVED_VIEWS} saved views. Remove one to make room.`);
      return;
    }

    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    savedViews = [{
      id,
      name,
      centerRe: view.centerRe,
      centerIm: view.centerIm,
      halfHeight: view.halfHeight
    }, ...savedViews];
    const persisted = saveToStorage();
    activeSavedId = id;
    renderSavedViews();
    viewName.value = '';
    render();
    setStatus(persisted ? `Saved ${name} on this device.` : `Saved ${name} for this session. Browser storage is unavailable.`);
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const amount = Math.max(-500, Math.min(500, event.deltaY));
    zoomAt(pointFromEvent(event), Math.exp(-amount * 0.0014), 'Zoom changed');
  }, { passive: false });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (drag) return;
    const point = pointFromEvent(event);
    drag = { pointerId: event.pointerId, start: point, view: { ...view }, moved: false };
    canvas.classList.add('is-dragging');
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
    if (Math.hypot(delta.x, delta.y) > 3) drag.moved = true;
    if (drag.moved) {
      view = panViewByPixels(drag.view, delta, canvasBounds());
      clearSelection();
      render();
    }
  });

  function finishPointer(event, cancelled = false) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const previousDrag = drag;
    drag = null;
    canvas.classList.remove('is-dragging');
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (cancelled) return;
    if (!previousDrag.moved) {
      zoomAt(pointFromEvent(event), 1.55, 'Zoomed toward the selected point');
    } else {
      setStatus('View moved. Coordinates updated.');
    }
  }

  canvas.addEventListener('pointerup', (event) => finishPointer(event));
  canvas.addEventListener('pointercancel', (event) => finishPointer(event, true));

  canvas.addEventListener('keydown', (event) => {
    const bounds = canvasBounds();
    const step = Math.max(24, bounds.width * 0.08);
    const verticalStep = Math.max(24, bounds.height * 0.08);
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomAt({ x: bounds.width / 2, y: bounds.height / 2 }, 1.55, 'Zoomed in');
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomAt({ x: bounds.width / 2, y: bounds.height / 2 }, 1 / 1.55, 'Zoomed out');
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveByPixels({ x: step, y: 0 }, 'Panned left.');
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveByPixels({ x: -step, y: 0 }, 'Panned right.');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveByPixels({ x: 0, y: verticalStep }, 'Panned up.');
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveByPixels({ x: 0, y: -verticalStep }, 'Panned down.');
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      selectPreset(PRESETS[0], 'Reset to the whole set.');
    }
  });

  const resizeTarget = canvas.parentElement;
  if ('ResizeObserver' in window && resizeTarget) {
    const observer = new ResizeObserver(() => render());
    observer.observe(resizeTarget);
  } else {
    window.addEventListener('resize', render, { passive: true });
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = 'The drawing context was interrupted. Reload the page to resume exploring.';
    }
    setStatus('The drawing context was interrupted. Reload the page to resume exploring.');
  });

  renderSavedViews();
  render();
  window.requestAnimationFrame(() => canvasWrap?.classList.add('is-ready'));
}

function loadSavedViews() {
  try {
    return parseSavedViews(window.localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp, { once: true });
  } else {
    initApp();
  }
}