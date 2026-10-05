// PM2 Ecosystem Configuration for Open Project Manager
// Usage:
//   pm2 start deploy/ecosystem.config.js
//   pm2 save
//   pm2 startup
//
// The app's environment comes from the install directory's .env, read when PM2 loads
// this file. After editing .env, apply it without a rebuild:
//   pm2 restart deploy/ecosystem.config.js --update-env

const fs = require("fs");
const path = require("path");
const { parseEnv } = require("util");

const installDir = path.join(__dirname, "..");
const dotenv = parseEnv(fs.readFileSync(path.join(installDir, ".env"), "utf8"));

module.exports = {
  apps: [
    {
      name: "open-project-manager",
      cwd: installDir,
      // Point to the Next.js standalone entry point for minimal RAM footprint
      script: ".next/standalone/server.js",
      instances: 1, // Single instance recommended for SQLite to prevent file locks
      autorestart: true,
      watch: false,
      max_memory_restart: "500M", // Automatically restart if memory exceeds threshold
      env: {
        PORT: "3000",
        HOSTNAME: "0.0.0.0",
        ...dotenv,
        NODE_ENV: "production",
      },
    },
  ],
};
