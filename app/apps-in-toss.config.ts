import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "today-outside",

  brand: {
    primaryColor: "#0C816A"
  },

  permissions: [{ name: "geolocation", access: "access" }],
  webBundleDir: "dist"
});
