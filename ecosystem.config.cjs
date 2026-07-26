module.exports = {
  apps: [{
    name: 'vrc2link',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: { PORT: 8889 },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    max_memory_restart: '256M',
  }],
};
