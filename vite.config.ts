import { defineConfig } from "vite";

// GitHub Pages project site serves from /AudioFineTuning/, not the domain root.
export default defineConfig({
  base: "/AudioFineTuning/",
});
