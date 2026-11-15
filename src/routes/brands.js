const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

// ПОЛУЧЕНИЕ БРЕНДОВ
router.get('/', authenticateToken, async (req, res) => {
    try {
        const brandsResult = await db.query('SELECT * FROM brands ORDER BY name');
        res.json({ brands: brandsResult.rows });
    } catch (error) {
        console.error('Brands error:', error);
        res.status(500).json({ error: 'Ошибка получения брендов' });
    }
});

// ПОЛУЧЕНИЕ ДЕТАЛЕЙ БРЕНДА
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const brandId = req.params.id;

        const brandResult = await db.query(`
            SELECT * FROM brands WHERE brand_id = $1
        `, [brandId]);

        if (brandResult.rows.length === 0) {
            return res.status(404).json({ error: 'Бренд не найден' });
        }

        res.json({ brand: brandResult.rows[0] });

    } catch (error) {
        console.error('Get brand error:', error);
        res.status(500).json({ error: 'Ошибка получения бренда' });
    }
});

// ОБНОВЛЕНИЕ БРЕНДА
router.put('/:id', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const brandId = req.params.id;
        const { name, description, logo_url, website, is_active } = req.body;

        console.log('Updating brand:', brandId, req.body);

        if (name) {
            const existingBrand = await db.query(
                'SELECT brand_id FROM brands WHERE name = $1 AND brand_id != $2',
                [name, brandId]
            );

            if (existingBrand.rows.length > 0) {
                return res.status(400).json({ error: 'Бренд с таким названием уже существует' });
            }
        }

        const result = await db.query(
            `UPDATE brands 
             SET name = COALESCE($1, name),
                 description = COALESCE($2, description),
                 logo_url = COALESCE($3, logo_url),
                 website = COALESCE($4, website),
                 is_active = COALESCE($5, is_active)
             WHERE brand_id = $6 
             RETURNING *`,
            [name, description, logo_url, website, is_active, brandId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Бренд не найден' });
        }

        res.json({ brand: result.rows[0] });

    } catch (error) {
        console.error('Update brand error:', error);
        res.status(500).json({ error: 'Ошибка обновления бренда' });
    }
});

// СОЗДАНИЕ БРЕНДА
router.post('/', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const { name, description, logo_url, website, is_active } = req.body;

        const existingBrand = await db.query(
            'SELECT brand_id FROM brands WHERE name = $1',
            [name]
        );

        if (existingBrand.rows.length > 0) {
            return res.status(400).json({ error: 'Бренд с таким названием уже существует' });
        }

        const result = await db.query(
            `INSERT INTO brands (name, description, logo_url, website, is_active) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, description, logo_url, website, is_active !== false]
        );
        res.json({ brand: result.rows[0] });
    } catch (error) {
        console.error('Create brand error:', error);
        res.status(500).json({ error: 'Ошибка создания бренда' });
    }
});

// УДАЛЕНИЕ БРЕНДА
router.delete('/:id', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const brandId = req.params.id;

        const productsCount = await db.query(
            'SELECT COUNT(*) FROM products WHERE brand_id = $1',
            [brandId]
        );

        if (parseInt(productsCount.rows[0].count) > 0) {
            return res.status(400).json({
                error: 'Нельзя удалить бренд, у которого есть товары. Сначала удалите или переместите товары.'
            });
        }

        await db.query('DELETE FROM brands WHERE brand_id = $1', [brandId]);
        res.json({ message: 'Бренд полностью удален' });

    } catch (error) {
        console.error('Delete brand error:', error);
        if (error.code === '23503') {
            res.status(400).json({
                error: 'Не удалось удалить бренд. Существуют связанные данные.'
            });
        } else {
            res.status(500).json({ error: 'Ошибка удаления бренда' });
        }
    }
});

module.exports = router;