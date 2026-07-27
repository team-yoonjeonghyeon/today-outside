import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "today-outside",
  brand: {
    displayName: "오늘 나가도 되나",
    primaryColor: "#0E9F6E",
    icon: "", // TODO: 콘솔 업로드 로고 URL
  },
  web: {
    host: "localhost",
    port: 5173,
    commands: {
      dev: "vite dev",
      build: "vite build",
    },
  },
  permissions: ["location"],
  outdir: "dist",
});
