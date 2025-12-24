module.exports = {
  apps: [
    {
      name: 'ApiEvolution',
      script: 'npm',
      args: 'run start:prod',
      cwd: '/home/deploy/evolution-api',
      interpreter: '/usr/bin/node',
      env: {
        NODE_OPTIONS: '--max-old-space-size=4096'
      },
      max_memory_restart: '4G',
      watch: false,
    }
  ]
};
