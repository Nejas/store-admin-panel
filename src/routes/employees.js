const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

// ПОЛУЧЕНИЕ ПЕРСОНАЛА
router.get('/', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
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
        res.json({ staff: staffResult.rows });
    } catch (error) {
        console.error('Get staff error:', error);
        res.status(500).json({ error: 'Ошибка получения персонала' });
    }
});

// ПОЛУЧЕНИЕ СОТРУДНИКОВ
router.get('/list', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const employeesResult = await db.query(`
            SELECT 
                e.employee_id, e.department, e.position, e.hire_date, e.is_active,
                u.first_name, u.last_name, u.email, u.user_role, u.phone
            FROM employees e
            JOIN users u ON e.user_id = u.user_id
            ORDER BY e.created_at DESC
        `);

        res.json({ employees: employeesResult.rows });

    } catch (error) {
        console.error('Employees error:', error);
        res.status(500).json({ error: 'Ошибка получения сотрудников' });
    }
});

module.exports = router;