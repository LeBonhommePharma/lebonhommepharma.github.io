/** Shipped WebGPU probe. Safe when navigator.gpu is missing. */
export async function probeGpuLabel(gpu) {
  if (!gpu || typeof gpu.requestAdapter !== "function") return "Canvas 2D";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "WebGPU prêt" : "Canvas 2D";
  } catch {
    return "Canvas 2D";
  }
}
