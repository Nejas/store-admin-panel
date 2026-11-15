const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const express = require('express');
const path = require('path');
let server, driver, base;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.post('/auth/login', (req, res) => res.status(401).json({ error: 'Неверный пароль' }));
  app.use(express.static(path.resolve(__dirname, '../../public')));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  driver = await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new', '--no-sandbox')).build();
}, 60000);
afterAll(async () => { if (driver) await driver.quit(); if (server) await new Promise(resolve => server.close(resolve)); });
test('ошибка входа отображается пользователю', async () => {
  await driver.get(`${base}/admin.html`);
  await driver.findElement(By.id('email')).sendKeys('test@example.com');
  await driver.findElement(By.id('password')).sendKeys('wrong');
  await driver.findElement(By.css('#loginForm button[type=submit]')).click();
  const error = await driver.wait(until.elementLocated(By.id('loginError')), 5000);
  await driver.wait(async () => (await error.getText()).includes('Неверный пароль'), 5000);
  expect(await error.getText()).toContain('Неверный пароль');
}, 20000);
