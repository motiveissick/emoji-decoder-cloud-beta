const fs=require('node:fs'),path=require('node:path');const{Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined});
pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8')).then(()=>{console.log('Database migration complete');return pool.end()}).catch(error=>{console.error(error);process.exit(1)});
