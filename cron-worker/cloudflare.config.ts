import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "taskflow-telegram-cron",
    compatibilityDate: "2026-11-20",
    entrypoint: "./src/index.js",
    observability: {
      enabled: true,
    },
    triggers: [
      // Runs at the top of every hour UTC to match each user's local timezone hour
      triggers.scheduled({ schedule: "0 * * * *" }),
    ],
    env: {
      DB: bindings.d1({
        id: "7636e439-489f-48c8-b24a-d8836533fa04",
        name: "taskflow-db",
      }),
      TELEGRAM_BOT_TOKEN: bindings.secret(),
    },
  },
});
