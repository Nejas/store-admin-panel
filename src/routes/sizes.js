const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

// ПОЛУЧЕНИЕ РАЗМЕРОВ
router.get('/', authenticateToken, async (req, res) => {
    try {
        console.log('Fetching sizes from database...');
        
        // Простая проверка - если ошибка, возвращаем пустой массив
        const sizesResult = await db.query(`
            SELECT * FROM sizes 
            WHERE is_active = true 
            ORDER BY sort_order, size_value
        `);
        
        console.log('Sizes fetched successfully:', sizesResult.rows.length);
        res.json({ sizes: sizesResult.rows });
        
    } catch (error) {
        console.error('Sizes error:', error);
        // ВОЗВРАЩАЕМ ПУСТОЙ МАССИВ ВМЕСТО ОШИБКИ
        res.json({ sizes: [] });
    }
});

// СОЗДАНИЕ РАЗМЕРА
router.post('/', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const { size_value, size_type = 'clothing', description, sort_order = 0 } = req.body;

        const result = await db.query(
            `INSERT INTO sizes (size_value, size_type, description, sort_order) 
             VALUES ($1, $2, $3, $4) 
             RETURNING *`,
            [size_value, size_type, description, sort_order]
        );

        res.status(201).json({ size: result.rows[0] });

    } catch (error) {
        console.error('Create size error:', error);
        res.status(500).json({ error: 'Ошибка создания размера' });
    }
});

module.exports = router;