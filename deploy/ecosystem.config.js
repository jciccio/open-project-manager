// PM2 Ecosystem Configuration for Open Project Manager
// Usage:
//   pm2 start deploy/ecosystem.config.js
//   pm2 save
//   pm2 startup

module.exports = {
  apps: [
    {
      name: "open-project-manager",
      // Point to the Next.js standalone entry point for minimal RAM footprint
      script: ".next/standalone/server.js",
      instances: 1, // Single instance recommended for SQLite to prevent file locks
      autorestart: true,
      watch: false,
      max_memory_restart: "500M", // Automatically restart if memory exceeds threshold
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
    },
  ],
};
