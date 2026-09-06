/** Local WebGPU shade dispatch. Safe when navigator.gpu is missing. Apache-2.0. */
import { SHADE_AMBIENT, shadeMany } from "./shade.js";

const STORAGE = 0x80;
const COPY_SRC = 0x04;
const COPY_DST = 0x08;
const MAP_READ = 0x01;
const UNIFORM = 0x40;
const MAP_READ_MODE = 0x0001;

export const SHADE_WGSL = `struct Params {
  light : vec4<f32>,
  count : u32,
  _p0 : u32,
  _p1 : u32,
  _p2 : u32,
};

@group(0) @binding(0) var<storage, read> normals : array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params : Params;
@group(0) @binding(2) var<storage, read_write> shades : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }
  let nraw = normals[i].xyz;
  let nlen = length(nraw);
  let lraw = params.light.xyz;
  let llen = length(lraw);
  var s = 0.0;
  if (nlen > 0.0 && llen > 0.0) {
    let d = dot(nraw / nlen, lraw / llen);
    let ambient = params.light.w;
    s = ambient + (1.0 - ambient) * max(d, 0.0);
  }
  shades[i] = s;
}
`;

const deviceCache = new WeakMap();

export async function probeGpuLabel(gpu) {
  if (!gpu || typeof gpu.requestAdapter !== "function") return "Canvas 2D";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "WebGPU prêt" : "Canvas 2D";
  } catch {
    return "Canvas 2D";
  }
}

export async function acquireGpuDevice(gpu) {
  if (!gpu || typeof gpu.requestAdapter !== "function") return null;
  const cached = deviceCache.get(gpu);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter || typeof adapter.requestDevice !== "function") return null;
      const device = await adapter.requestDevice();
      return device || null;
    } catch {
      return null;
    }
  })();
  deviceCache.set(gpu, pending);
  return pending;
}

async function shadeWallsOnDevice(device, walls, light) {
  if (
    typeof device.createShaderModule !== "function" ||
    typeof device.createComputePipeline !== "function" ||
    typeof device.createBuffer !== "function" ||
    typeof device.createBindGroup !== "function" ||
    typeof device.createCommandEncoder !== "function" ||
    !device.queue ||
    typeof device.queue.writeBuffer !== "function" ||
    typeof device.queue.submit !== "function"
  ) {
    return null;
  }
  const count = walls.length;
  if (count === 0) return [];
  const normalBytes = count * 16;
  const shadeBytes = Math.max(16, count * 4);
  const normalData = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const n = walls[i];
    normalData[i * 4] = n.x;
    normalData[i * 4 + 1] = n.y;
    normalData[i * 4 + 2] = n.z;
    normalData[i * 4 + 3] = 0;
  }
  const paramData = new ArrayBuffer(32);
  const paramF = new Float32Array(paramData, 0, 4);
  const paramU = new Uint32Array(paramData, 16, 4);
  paramF[0] = light.x;
  paramF[1] = light.y;
  paramF[2] = light.z;
  paramF[3] = SHADE_AMBIENT;
  paramU[0] = count;
  try {
    const gpuModule = device.createShaderModule({ code: SHADE_WGSL });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: gpuModule, entryPoint: "main" },
    });
    const normalBuffer = device.createBuffer({ size: normalBytes, usage: STORAGE | COPY_DST });
    const paramBuffer = device.createBuffer({ size: 32, usage: UNIFORM | COPY_DST });
    const shadeBuffer = device.createBuffer({ size: shadeBytes, usage: STORAGE | COPY_SRC });
    const readBuffer = device.createBuffer({ size: shadeBytes, usage: MAP_READ | COPY_DST });
    if (!normalBuffer || !paramBuffer || !shadeBuffer || !readBuffer) return null;
    device.queue.writeBuffer(normalBuffer, 0, normalData);
    device.queue.writeBuffer(paramBuffer, 0, paramData);
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout ? pipeline.getBindGroupLayout(0) : undefined,
      entries: [
        { binding: 0, resource: { buffer: normalBuffer } },
        { binding: 1, resource: { buffer: paramBuffer } },
        { binding: 2, resource: { buffer: shadeBuffer } },
      ],
    });
    const encoder = device.createCommandEncoder();
    if (!encoder || typeof encoder.beginComputePass !== "function" || typeof encoder.finish !== "function") return null;
    const pass = encoder.beginComputePass();
    if (!pass || typeof pass.setPipeline !== "function" || typeof pass.dispatchWorkgroups !== "function" || typeof pass.end !== "function") {
      return null;
    }
    pass.setPipeline(pipeline);
    if (typeof pass.setBindGroup === "function") pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    if (typeof encoder.copyBufferToBuffer === "function") {
      encoder.copyBufferToBuffer(shadeBuffer, 0, readBuffer, 0, shadeBytes);
    }
    device.queue.submit([encoder.finish()]);
    if (typeof readBuffer.mapAsync !== "function" || typeof readBuffer.getMappedRange !== "function") return null;
    await readBuffer.mapAsync(MAP_READ_MODE);
    const copy = new Float32Array(readBuffer.getMappedRange().slice(0));
    if (typeof readBuffer.unmap === "function") readBuffer.unmap();
    return Array.from(copy.subarray(0, count));
  } catch {
    return null;
  }
}

function asLight(light) {
  if (!light || typeof light !== "object") return null;
  const x = Number(light.x);
  const y = Number(light.y);
  const z = Number(light.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function asWalls(walls) {
  if (!Array.isArray(walls)) return [];
  return walls.map((item) => {
    if (!item || typeof item !== "object") return { x: 0, y: 0, z: 0 };
    const x = Number(item.x);
    const y = Number(item.y);
    const z = Number(item.z);
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      z: Number.isFinite(z) ? z : 0,
    };
  });
}

function metalPendingMap() {
  if (!globalThis.__riveMetalShadePending) globalThis.__riveMetalShadePending = new Map();
  return globalThis.__riveMetalShadePending;
}

function nextMetalId() {
  globalThis.__riveMetalShadeSeq = (globalThis.__riveMetalShadeSeq || 0) + 1;
  return globalThis.__riveMetalShadeSeq;
}

function hostOf(bridge) {
  const host = bridge === undefined ? (typeof globalThis !== "undefined" ? globalThis : null) : bridge;
  if (!host || typeof host !== "object") return null;
  return host;
}

export function metalShadeAvailable(bridge) {
  const host = hostOf(bridge);
  const handler = host && host.webkit && host.webkit.messageHandlers ? host.webkit.messageHandlers.riveShade : null;
  return !!handler && typeof handler.postMessage === "function";
}

function installMetalResolve() {
  globalThis.__riveMetalShadeResolve = (id, payload) => {
    const pending = metalPendingMap();
    const done = pending.get(Number(id));
    if (!done) return;
    pending.delete(Number(id));
    done(payload);
  };
}

export async function shadeWallsMetal(walls, light, bridge) {
  const host = hostOf(bridge);
  const handler = host && host.webkit && host.webkit.messageHandlers ? host.webkit.messageHandlers.riveShade : null;
  if (!handler || typeof handler.postMessage !== "function") return null;
  installMetalResolve();
  const id = nextMetalId();
  const normals = [];
  for (const wall of walls) normals.push(wall.x, wall.y, wall.z);
  return new Promise((resolve) => {
    const pending = metalPendingMap();
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, 2000);
    pending.set(id, (payload) => {
      clearTimeout(timer);
      if (!payload || !Array.isArray(payload.shades) || payload.shades.length !== walls.length) {
        resolve(null);
        return;
      }
      const shades = payload.shades.map((n) => Number(n));
      if (shades.some((n) => !Number.isFinite(n))) {
        resolve(null);
        return;
      }
      resolve(shades);
    });
    try {
      handler.postMessage({ id, normals, light: [light.x, light.y, light.z] });
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      resolve(null);
    }
  });
}

export async function computeWallShades(gpu, walls, light, bridge) {
  const list = asWalls(walls);
  const dir = asLight(light);
  const cpu = shadeMany(dir, list);
  if (dir) {
    const metal = await shadeWallsMetal(list, dir, bridge);
    if (metal && metal.length === list.length) return { backend: "metal", shades: metal };
  }
  const device = await acquireGpuDevice(gpu);
  if (!device || !dir) return { backend: "cpu", shades: cpu };
  const gpuShades = await shadeWallsOnDevice(device, list, dir);
  if (!gpuShades || gpuShades.length !== list.length) return { backend: "cpu", shades: cpu };
  return { backend: "webgpu", shades: gpuShades };
}
