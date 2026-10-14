import { defineConfig } from "vite";

// @audio/neural-runtime picks onnxruntime-web with import(spec), a name only known at runtime, which a bundler leaves
// as a bare import that a browser can't load. Here it becomes two imports Vite can see (each its own lazy chunk, with
// its .wasm next to it): only the admin's guitar separation (src/separate.js) ever reaches them.
const ortImports = {
  name: "corde-ort-imports",
  transform(code, id) {
    if (!id.replace(/\\/g, "/").includes("/@audio/neural-runtime/runtime.js")) return null;
    const from = "p = import(spec)";
    if (!code.includes(from)) throw new Error("neural-runtime changed: check corde-ort-imports in vite.config.js");
    return code.replace(from, "p = (spec === 'onnxruntime-web/webgpu' ? import('onnxruntime-web/webgpu') : spec === 'onnxruntime-web' ? import('onnxruntime-web/wasm') : import(/* @vite-ignore */ spec))");
  },
};

export default defineConfig({
  plugins: [ortImports],
  // in dev, pre-bundling would skip the plugin above (and ort's .wasm lookups): those load as they are
  optimizeDeps: { exclude: ["@audio/neural-separate", "@audio/neural-runtime", "onnxruntime-web"] },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], supabase: ["@supabase/supabase-js"] },
        // onnxruntime's file under its own name: browsers that cached it before /assets/* carried the COEP header
        // (immutable, a year) would keep starting its threads without it, and the separation would hang there
        chunkFileNames: (c) => (c.name.startsWith("ort.") ? "assets/[name]-coep-[hash].js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
