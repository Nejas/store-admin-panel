const { Client } = require('pg');
let client;
beforeAll(async () => {
  client = new Client({ host:'127.0.0.1', port:55432, user:'postgres', password:'test-only-password', database:'store_test' });
  await client.connect();
});
afterAll(async () => { if (client) await client.end(); });
test('тест подключён к отдельной временной базе', async () => {
  const result = await client.query('SELECT current_database() AS name');
  expect(result.rows[0].name).toBe('store_test');
});

test('ограничение уникальности бренда работает в PostgreSQL', async () => {
  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO brands (name) VALUES ($1)', ['Автотестовый бренд']);
    await expect(client.query('INSERT INTO brands (name) VALUES ($1)', ['Автотестовый бренд'])).rejects.toMatchObject({ code: '23505' });
  } finally { await client.query('ROLLBACK'); }
});

test('граница резерва: остаток равен резерву допустим, меньше — отклоняется', async () => {
  await client.query('BEGIN');
  try {
    const cat=(await client.query("INSERT INTO categories (name) VALUES ('Тест') RETURNING category_id")).rows[0].category_id;
    const brand=(await client.query("INSERT INTO brands (name) VALUES ('Тест') RETURNING brand_id")).rows[0].brand_id;
    const size=(await client.query("INSERT INTO sizes (size_value) VALUES ('42') RETURNING size_id")).rows[0].size_id;
    const color=(await client.query("INSERT INTO colors (name) VALUES ('Тест') RETURNING color_id")).rows[0].color_id;
    const product=(await client.query("INSERT INTO products (sku,name,category_id,brand_id,base_price) VALUES ('test-sku','Тест',$1,$2,1) RETURNING product_id",[cat,brand])).rows[0].product_id;
    const variant=(await client.query("INSERT INTO product_variants (product_id,size_id,color_id,sku,stock_quantity,reserved_quantity) VALUES ($1,$2,$3,'variant-test',2,2) RETURNING variant_id",[product,size,color])).rows[0].variant_id;
    await client.query('UPDATE product_variants SET stock_quantity=2 WHERE variant_id=$1',[variant]);
    await expect(client.query('UPDATE product_variants SET stock_quantity=1 WHERE variant_id=$1',[variant])).rejects.toMatchObject({code:'23514'});
  } finally { await client.query('ROLLBACK'); }
});
