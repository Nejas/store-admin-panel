const { spawn, spawnSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const project = `store-postman-${crypto.randomBytes(5).toString('hex')}`;
const compose = ['compose', '-p', project, '-f', path.join(__dirname, 'compose.yml')];
function docker(args, capture = false) {
  const result = spawnSync('docker', [...compose, ...args], { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error(`docker compose ${args[0]} завершился с кодом ${result.status}`);
  return result.stdout;
}
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve('postman-cli/bin/postman.js'), ...args], { stdio: 'inherit' });
    child.on('error', reject); child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Postman CLI завершился: ${code ?? signal}`)));
  });
}
(async () => {
  let started = false, client, server, pool;
  try {
    started = true; docker(['up', '-d', '--wait']);
    const address = docker(['port', 'database', '5432'], true).trim().split(/\r?\n/)[0];
    const port = Number(address.match(/:(\d+)$/)?.[1]); if (!port) throw new Error('Не удалось определить порт тестовой базы');
    const config = { host:'127.0.0.1', port, user:'postgres', password:'postman-test-only', database:'store_postman_test' };
    client = new Client(config); await client.connect();
    const hash = await bcrypt.hash('test-password-only', 10);
    for (const [email, role] of [['admin@example.test','admin'], ['customer@example.test','customer']]) {
      await client.query('INSERT INTO users (email,password_hash,first_name,last_name,user_role,is_active) VALUES ($1,$2,$3,$4,$5,true)', [email,hash,'Test','User',role]);
    }
    await client.end(); client = null;
    Object.assign(process.env, { DB_HOST:config.host, DB_PORT:String(port), DB_USER:config.user, DB_PASSWORD:config.password, DB_NAME:config.database, JWT_SECRET:'postman-test-only-secret' });
    const app = require('../../src/app'); pool = require('../../src/config/database').pool;
    server = await new Promise((resolve,reject) => { const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await cli(['collection','run',path.join(__dirname,'store.collection.json'),'--environment',path.join(__dirname,'environment.json'),'--env-var',`baseUrl=${baseUrl}`]);
  } catch (error) { console.error(error.message); process.exitCode=1; }
  finally {
    if (client) await client.end();
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (started) { try { docker(['down']); } catch (e) { console.error('Не удалось удалить тестовый контейнер:',e.message); process.exitCode=1; } }
  }
})();
