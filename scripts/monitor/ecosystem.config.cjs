// PM2 config: pm2 start scripts/monitor/ecosystem.config.cjs  (run from stax-protocol root)
module.exports={apps:[{name:"stax-monitor",script:"scripts/monitor/basket-monitor.mjs",cwd:__dirname+"/../..",autorestart:true,max_restarts:50,restart_delay:10000,max_memory_restart:"300M",env:{NODE_ENV:"production"}},
 {name:"stax-epoch",script:"scripts/rewards/run-epoch.mjs",cwd:__dirname+"/../..",autorestart:true,max_restarts:50,restart_delay:60000,max_memory_restart:"300M",env:{NODE_ENV:"production"}}]};
