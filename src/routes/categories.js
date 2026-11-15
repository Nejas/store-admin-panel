const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

// ПОЛУЧЕНИЕ КАТЕГОРИЙ
router.get('/', authenticateToken, async (req, res) => {
    try {
        const categoriesResult = await db.query(`
            SELECT c.*, p.name as parent_name 
            FROM categories c 
            LEFT JOIN categories p ON c.parent_id = p.category_id 
            ORDER BY c.sort_order, c.name
        `);
        res.json({ categories: categoriesResult.rows });
    } catch (error) {
        console.error('Categories error:', error);
        res.status(500).json({ error: 'Ошибка получения категорий' });
    }
});

// ПОЛУЧЕНИЕ ДЕТАЛЕЙ КАТЕГОРИИ
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const categoryId = req.params.id;

        const categoryResult = await db.query(`
            SELECT c.*, p.name as parent_name 
            FROM categories c 
            LEFT JOIN categories p ON c.parent_id = p.category_id 
            WHERE c.category_id = $1
        `, [categoryId]);

        if (categoryResult.rows.length === 0) {
            return res.status(404).json({ error: 'Категория не найдена' });
        }

        res.json({ category: categoryResult.rows[0] });

    } catch (error) {
        console.error('Get category error:', error);
        res.status(500).json({ error: 'Ошибка получения категории' });
    }
});

// ОБНОВЛЕНИЕ КАТЕГОРИИ
router.put('/:id', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { name, description, parent_id, image_url, sort_order, is_active } = req.body;

        console.log('Updating category:', categoryId, req.body);

        if (name) {
            const existingCategory = await db.query(
                'SELECT category_id FROM categories WHERE name = $1 AND category_id != $2',
                [name, categoryId]
            );

            if (existingCategory.rows.length > 0) {
                return res.status(400).json({ error: 'Категория с таким названием уже существует' });
            }
        }

        const result = await db.query(
            `UPDATE categories 
             SET name = COALESCE($1, name),
                 description = COALESCE($2, description),
                 parent_id = $3,
                 image_url = COALESCE($4, image_url),
                 sort_order = COALESCE($5, sort_order),
                 is_active = COALESCE($6, is_active)
             WHERE category_id = $7 
             RETURNING *`,
            [name, description, parent_id, image_url, sort_order, is_active, categoryId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Категория не найдена' });
        }

        res.json({ category: result.rows[0] });

    } catch (error) {
        console.error('Update category error:', error);
        res.status(500).json({ error: 'Ошибка обновления категории' });
    }
});

// СОЗДАНИЕ КАТЕГОРИИ
router.post('/', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const { name, description, parent_id, image_url, sort_order, is_active } = req.body;

        const existingCategory = await db.query(
            'SELECT category_id FROM categories WHERE name = $1',
            [name]
        );

        if (existingCategory.rows.length > 0) {
            return res.status(400).json({ error: 'Категория с таким названием уже существует' });
        }

        const result = await db.query(
            `INSERT INTO categories (name, description, parent_id, image_url, sort_order, is_active) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name, description, parent_id, image_url, sort_order || 0, is_active !== false]
        );
        res.json({ category: result.rows[0] });
    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({ error: 'Ошибка создания категории' });
    }
});

// УДАЛЕНИЕ КАТЕГОРИИ
router.delete('/:id', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const categoryId = req.params.id;

        const productsCount = await db.query(
            'SELECT COUNT(*) FROM products WHERE category_id = $1',
            [categoryId]
        );

        if (parseInt(productsCount.rows[0].count) > 0) {
            return res.status(400).json({
                error: 'Нельзя удалить категорию, в которой есть товары. Сначала переместите или удалите товары.'
            });
        }

        const childCategoriesCount = await db.query(
            'SELECT COUNT(*) FROM categories WHERE parent_id = $1',
            [categoryId]
        );

        if (parseInt(childCategoriesCount.rows[0].count) > 0) {
            return res.status(400).json({
                error: 'Нельзя удалить категорию, у которой есть дочерние категории. Сначала удалите или переместите дочерние категории.'
            });
        }

        await db.query('DELETE FROM categories WHERE category_id = $1', [categoryId]);
        res.json({ message: 'Категория полностью удалена' });

    } catch (error) {
        console.error('Delete category error:', error);
        if (error.code === '23503') {
            res.status(400).json({
                error: 'Не удалось удалить категорию. Существуют связанные данные.'
            });
        } else {
            res.status(500).json({ error: 'Ошибка удаления категории' });
        }
    }
});

module.exports = router;