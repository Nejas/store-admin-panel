const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());


app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use(express.static(path.join(__dirname, '..', 'public')));

// Логирование для отладки
console.log('Uploads path:', path.join(__dirname, '..', 'uploads'));
console.log('Public path:', path.join(__dirname, '..', 'public'));

app.use('/cart', require('./routes/cart'));
app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/products', require('./routes/products'));
app.use('/orders', require('./routes/orders'));
app.use('/categories', require('./routes/categories'));
app.use('/brands', require('./routes/brands'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/shipments', require('./routes/shipments'));
app.use('/employees', require('./routes/employees'));
app.use('/sizes', require('./routes/sizes'));
app.use('/colors', require('./routes/colors'));
app.use('/customers', require('./routes/customers'));
app.use('/staff', require('./routes/staff'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        message: 'Server is running'
    });
});

// Админ-панель
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/', (req, res) => {
    res.redirect('/admin');
});

module.exports = app;