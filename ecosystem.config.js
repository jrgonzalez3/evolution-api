module.exports = {
  apps: [
    {
      name: 'ApiEvolution',
      script: 'npm',
      args: 'start',
      cwd: '/www/wwwroot/botwsp.saastech.cloud',
      env: {
        NODE_OPTIONS: '--max-old-space-size=1024'
      },
      max_memory_restart: '1G',
      watch: false,
    }
  ]
};
