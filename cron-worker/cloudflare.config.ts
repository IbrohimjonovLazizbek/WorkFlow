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
      // Runs every 5 minutes UTC for morning/evening digests, task-time pings, focus timer alerts, and Sunday weekly scorecard
      triggers.scheduled({ schedule: "*/5 * * * *" }),
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
