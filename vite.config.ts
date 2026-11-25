import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// VITE_BASE is "/<repo>/" on GitHub Pages; "./" works for the PC server.
export default defineConfig({
  base: process.env.VITE_BASE || "./",
  plugins: [react()],
});
