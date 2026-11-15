const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

//  ПОЛУЧЕНИЕ ЦВЕТОВ
router.get('/', authenticateToken, async (req, res) => {
    try {
        const colorsResult = await db.query(`
            SELECT * FROM colors 
            WHERE is_active = true 
            ORDER BY sort_order, name
        `);
        res.json({ colors: colorsResult.rows });
    } catch (error) {
        console.error('Colors error:', error);
        res.status(500).json({ error: 'Ошибка получения цветов' });
    }
});

// СОЗДАНИЕ ЦВЕТА
router.post('/', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const { name, hex_code, sort_order = 0, is_active = true } = req.body;

        const existingColor = await db.query(
            'SELECT color_id FROM colors WHERE name = $1',
            [name]
        );

        if (existingColor.rows.length > 0) {
            return res.status(400).json({ error: 'Цвет с таким названием уже существует' });
        }

        if (hex_code) {
            const existingHex = await db.query(
                'SELECT color_id FROM colors WHERE hex_code = $1',
                [hex_code]
            );

            if (existingHex.rows.length > 0) {
                return res.status(400).json({ error: 'Цвет с таким HEX кодом уже существует' });
            }
        }

        const result = await db.query(
            `INSERT INTO colors (name, hex_code, sort_order, is_active) 
             VALUES ($1, $2, $3, $4) 
             RETURNING *`,
            [name, hex_code, sort_order, is_active]
        );

        res.status(201).json({ color: result.rows[0] });

    } catch (error) {
        console.error('Create color error:', error);
        res.status(500).json({ error: 'Ошибка создания цвета' });
    }
});

module.exports = router;