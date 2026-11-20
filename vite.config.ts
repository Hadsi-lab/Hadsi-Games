import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (e.g. GitHub Pages at /<repo>/).
// Routing is hash-based, so no server rewrites are needed.
export default defineConfig({
  base: './',
});
