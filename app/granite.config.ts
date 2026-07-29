import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "today-outside",
  brand: {
    displayName: "오늘 나가도 되나",
    primaryColor: "#0C816A",
    icon: "https://static.toss.im/appsintoss/53451/0d4c2328-5d7d-43ea-80cd-1ff0d00de016.png",
  },
  web: {
    host: "localhost",
    port: 5173,
    commands: {
      dev: "vite dev",
      build: "vite build",
    },
  },
  permissions: [{ name: "geolocation", access: "access" }],
  outdir: "dist",
});
