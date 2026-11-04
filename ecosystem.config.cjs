const path=require('node:path');
const cwd=path.join(__dirname,'apps/api');
module.exports={
 apps:[
  {name:'brnotify-api',cwd,script:'dist/index.js',instances:1,exec_mode:'fork',autorestart:true,max_memory_restart:'350M',time:true,env:{NODE_ENV:'production'}},
  {name:'brnotify-worker',cwd,script:'dist/worker.js',instances:1,exec_mode:'fork',autorestart:true,max_memory_restart:'400M',time:true,env:{NODE_ENV:'production'}}
 ]
};
