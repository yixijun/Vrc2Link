module.exports = {
  apps: [{
    name: 'vrc2link',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      PORT: process.env.PORT || 7890,
      API_KEY: process.env.API_KEY || '',
      BILIBILI_COOKIE: process.env.BILIBILI_COOKIE || '',
      NETEASE_COOKIE: process.env.NETEASE_COOKIE || '',
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    max_memory_restart: '256M',
  }],
};
