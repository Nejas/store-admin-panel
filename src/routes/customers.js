const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

// КЛИЕНТЫ (только customer роль)
router.get('/', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        console.log('🔄 Fetching customers...');
        const customersResult = await db.query(`
            SELECT user_id, first_name, last_name, middle_name, email, phone, created_at, is_active
            FROM users 
            WHERE user_role = 'customer'
            ORDER BY created_at DESC
        `);
        console.log('✅ Customers fetched:', customersResult.rows.length);
        res.json({ customers: customersResult.rows });
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ error: 'Ошибка получения клиентов' });
    }
});

module.exports = router;