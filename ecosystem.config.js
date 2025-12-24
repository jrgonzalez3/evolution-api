module.exports = {
  apps: [
    {
      name: 'ApiEvolution',
      script: 'npm',
      args: 'start',
      cwd: '/www/wwwroot/botwsp.saastech.cloud',
      env: {
        NODE_OPTIONS: '--max-old-space-size=4096'
      },
      max_memory_restart: '4G',
      watch: false,
    }
  ]
};
