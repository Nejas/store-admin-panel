const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

// ПЕРСОНАЛ (все кроме customer)
router.get('/', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        console.log(' Fetching staff...');
        const staffResult = await db.query(`
            SELECT 
                u.user_id, u.first_name, u.last_name, u.middle_name, u.email, u.phone, u.user_role,
                u.created_at, u.is_active,
                e.department, e.position, e.hire_date
            FROM users u
            LEFT JOIN employees e ON u.user_id = e.user_id
            WHERE u.user_role IN ('admin', 'manager', 'courier', 'content')
            ORDER BY u.created_at DESC
        `);
        console.log(' Staff fetched:', staffResult.rows.length);
        res.json({ staff: staffResult.rows });
    } catch (error) {
        console.error('Get staff error:', error);
        res.status(500).json({ error: 'Ошибка получения персонала' });
    }
});

module.exports = router;