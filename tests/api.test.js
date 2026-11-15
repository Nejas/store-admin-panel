process.env.JWT_SECRET = 'test-only-secret';
jest.mock('../src/config/database', () => ({ query: jest.fn() }));
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/config/database');
const app = require('../src/app');
const token = (role, userId = 'user-1') => jwt.sign({ role, userId }, process.env.JWT_SECRET);
const auth = role => `Bearer ${token(role)}`;
beforeEach(() => db.query.mockReset());

describe('API и разграничение доступа', () => {
  test('health доступен без авторизации', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200); expect(res.body.status).toBe('ok');
  });
  test('закрытый маршрут отклоняет запрос без токена', async () => {
    expect((await request(app).get('/customers')).status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });
  test('клиент не может видеть клиентов и доставки', async () => {
    for (const path of ['/customers', '/shipments', '/dashboard/stats']) {
      expect((await request(app).get(path).set('Authorization', auth('customer'))).status).toBe(403);
    }
    expect(db.query).not.toHaveBeenCalled();
  });
  test('клиент не может получить данные другого пользователя', async () => {
    expect((await request(app).get('/users/other').set('Authorization', auth('customer'))).status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
  test('менеджер получает детали заказа с товарами и доставками', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ order_id: 'order-1' }] }).mockResolvedValueOnce({ rows: [{ quantity: 2 }] }).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/orders/order-1').set('Authorization', auth('manager'));
    expect(res.status).toBe(200); expect(res.body.data.items).toHaveLength(1); expect(res.body.data.shipments).toEqual([]);
  });
  test('изменение заказа проверяет статус оплаты', async () => {
    const res = await request(app).put('/orders/order-1').set('Authorization', auth('admin')).send({ payment_status: 'invalid' });
    expect(res.status).toBe(400); expect(db.query).not.toHaveBeenCalled();
  });
  test('клиент не может менять вариации товаров', async () => {
    const res = await request(app).delete('/products/product-1/variants/variant-1').set('Authorization', auth('customer'));
    expect(res.status).toBe(403); expect(db.query).not.toHaveBeenCalled();
  });
  test('изменение вариации отклоняет отрицательный остаток', async () => {
    const res = await request(app).put('/products/product-1/variants/variant-1').set('Authorization', auth('admin')).send({ sku:'sku',size_id:'size',color_id:'color',stock_quantity:-1,min_stock_level:0,price_adjustment:0,is_active:true });
    expect(res.status).toBe(400); expect(db.query).not.toHaveBeenCalled();
  });
});

describe('Классы эквивалентности и таблица решений', () => {
  test.each([
    ['нет токена', null, 401], ['повреждённый токен', 'Bearer invalid', 403],
    ['просроченный токен', `Bearer ${jwt.sign({role:'admin'}, process.env.JWT_SECRET, {expiresIn:-1})}`, 403]
  ])('авторизация: %s', async (_name, header, expected) => {
    let req = request(app).get('/customers'); if (header) req = req.set('Authorization', header);
    expect((await req).status).toBe(expected); expect(db.query).not.toHaveBeenCalled();
  });
  test.each([
    ['admin','user-1',200], ['manager','other',200], ['customer','user-1',200],
    ['customer','other',403], ['courier','other',403]
  ])('роль %s и пользователь %s: %s', async (role,id,expected) => {
    db.query.mockResolvedValue({rows:[]});
    const res=await request(app).get(`/users/${id}/addresses`).set('Authorization',auth(role));
    expect(res.status).toBe(expected);
    if(expected===403) expect(db.query).not.toHaveBeenCalled();
  });
  test.each(['pending','paid','failed','refunded'])('допустимый статус оплаты %s', async status=>{
    db.query.mockResolvedValue({rows:[{payment_status:status}]});
    const res=await request(app).put('/orders/order-1').set('Authorization',auth('admin')).send({payment_status:status});
    expect(res.status).toBe(200); expect(res.body.data.payment_status).toBe(status);
  });
  test.each([-1,0,1])('граница остатка %i', async stock=>{
    db.query.mockResolvedValue({rows:[{stock_quantity:stock}]});
    const res=await request(app).put('/products/p1/variants/v1').set('Authorization',auth('admin')).send({sku:'sku',size_id:'s',color_id:'c',stock_quantity:stock,min_stock_level:0,price_adjustment:0,is_active:true});
    expect(res.status).toBe(stock<0?400:200);
  });
  test('изменение статуса вызывает запись истории и обновление',async()=>{
    db.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{status:'delivered'}]});
    const res=await request(app).put('/orders/o1/status').set('Authorization',auth('manager')).send({status:'delivered'});
    expect(res.status).toBe(200); expect(res.body.data.status).toBe('delivered');
    expect(db.query.mock.calls[0][0]).toContain('INSERT INTO order_status_history');
    expect(db.query.mock.calls[1][0]).toContain('UPDATE orders');
  });
});

describe('Попарные сочетания роли, маршрута и токена', () => {
  test.each([
    ['admin','/customers',true,200], ['admin','/shipments',false,403],
    ['customer','/customers',false,403], ['customer','/shipments',true,403]
  ])('%s %s токен действителен=%s', async (role,path,valid,expected) => {
    db.query.mockResolvedValue({rows:[]});
    const header=valid?auth(role):'Bearer invalid';
    expect((await request(app).get(path).set('Authorization',header)).status).toBe(expected);
  });
});
