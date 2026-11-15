const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '../../uploads/products');
        require('fs').mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Можно загружать только изображения'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});
// ПОЛУЧЕНИЕ ТОВАРОВ
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '' } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT 
                p.product_id, p.sku, p.name, p.base_price, p.old_price, p.is_active,
                p.main_image_url, p.created_at, p.description, p.short_description,
                c.name as category_name,
                b.name as brand_name,
                p.gender, p.material, p.care_instructions, p.season,
                p.weight_grams, p.dimensions, p.tags,
                p.is_active, p.is_featured,
                COALESCE(SUM(pv.stock_quantity), 0) as total_stock
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            LEFT JOIN product_variants pv ON p.product_id = pv.product_id
        `;
        let params = [];
        let paramCount = 0;

        if (search) {
            paramCount++;
            query += ` WHERE (p.name ILIKE $${paramCount} OR p.sku ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        query += ` GROUP BY p.product_id, c.name, b.name 
                   ORDER BY p.created_at DESC 
                   LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limit, offset);

        const productsResult = await db.query(query, params);

        res.json({
            products: productsResult.rows,
            page: parseInt(page),
            totalPages: Math.ceil(productsResult.rows.length / limit)
        });

    } catch (error) {
        console.error('Products error:', error);
        res.status(500).json({ error: 'Ошибка получения товаров' });
    }
});

// ПОЛУЧЕНИЕ ДЕТАЛЕЙ ТОВАРА
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const productId = req.params.id;

        const productResult = await db.query(`
            SELECT 
                p.*,
                c.name as category_name,
                b.name as brand_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            WHERE p.product_id = $1
        `, [productId]);

        if (productResult.rows.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }

        const product = productResult.rows[0];

        const variantsResult = await db.query(`
            SELECT 
                pv.*,
                s.size_value,
                col.name as color_name,
                col.hex_code
            FROM product_variants pv
            LEFT JOIN sizes s ON pv.size_id = s.size_id
            LEFT JOIN colors col ON pv.color_id = col.color_id
            WHERE pv.product_id = $1
        `, [productId]);

        product.variants = variantsResult.rows;

        res.json({ product });

    } catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({ error: 'Ошибка получения товара' });
    }
});

// ОБНОВЛЕНИЕ ТОВАРА С ФАЙЛАМИ
router.put('/:id', authenticateToken, requireRole(['admin', 'manager']), upload.single('main_image_file'), async (req, res) => {
    try {
        const productId = req.params.id;
        const {
            sku, name, description, short_description, category_id, brand_id,
            base_price, old_price, gender, material, care_instructions, season,
            weight_grams, dimensions, main_image_url, tags,
            is_active, is_featured
        } = req.body;

        console.log('Updating product:', productId, req.body);

        let finalMainImageUrl = main_image_url;
        
        if (req.file) {
            finalMainImageUrl = `/uploads/products/${req.file.filename}`;
            console.log('Новый файл загружен:', finalMainImageUrl);
        }

        if (sku) {
            const existingProduct = await db.query(
                'SELECT product_id FROM products WHERE sku = $1 AND product_id != $2',
                [sku, productId]
            );

            if (existingProduct.rows.length > 0) {
                if (req.file) {
                    const fs = require('fs');
                    fs.unlink(req.file.path, (err) => {
                        if (err) console.error('Error deleting file:', err);
                    });
                }
                return res.status(400).json({ error: 'Товар с таким SKU уже существует' });
            }
        }

        let processedTags = tags;

        if (typeof tags === 'string') {
            processedTags = tags.split(',')
                .map(tag => tag.trim())
                .filter(tag => tag);
        }

        const result = await db.query(
            `UPDATE products 
             SET sku = COALESCE($1, sku),
                 name = COALESCE($2, name),
                 description = COALESCE($3, description),
                 short_description = COALESCE($4, short_description),
                 category_id = COALESCE($5, category_id),
                 brand_id = COALESCE($6, brand_id),
                 base_price = COALESCE($7, base_price),
                 old_price = $8,
                 gender = COALESCE($9, gender),
                 material = COALESCE($10, material),
                 care_instructions = COALESCE($11, care_instructions),
                 season = COALESCE($12, season),
                 weight_grams = $13,
                 dimensions = COALESCE($14, dimensions),
                 main_image_url = COALESCE($15, main_image_url),
                 tags = COALESCE($16, tags),
                 is_active = COALESCE($17, is_active),
                 is_featured = COALESCE($18, is_featured),
                 updated_at = NOW()
             WHERE product_id = $19 
             RETURNING *`,
            [
                sku, name, description, short_description, category_id, brand_id,
                base_price, old_price, gender, material, care_instructions, season,
                weight_grams, dimensions, finalMainImageUrl,
                processedTags ? JSON.stringify(processedTags) : null,
                is_active, is_featured, productId
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }

        res.json({ product: result.rows[0] });

    } catch (error) {
        console.error('Update product error:', error);
        
        if (req.file) {
            const fs = require('fs');
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting file:', err);
            });
        }
        
        res.status(500).json({ error: 'Ошибка обновления товара' });
    }
});
// СОЗДАНИЕ ТОВАРА С ФАЙЛАМИ
router.post('/', authenticateToken, requireRole(['admin', 'manager']), upload.single('main_image_file'), async (req, res) => {
    try {
        console.log('🔄 Запрос на создание товара:', {
            body: req.body,
            file: req.file ? {
                originalname: req.file.originalname,
                filename: req.file.filename,
                size: req.file.size,
                mimetype: req.file.mimetype
            } : 'No file'
        });

        const {
            sku, name, description, short_description, category_id, brand_id,
            base_price, old_price, gender, material, care_instructions, season,
            weight_grams, dimensions, main_image_url, tags,
            is_active, is_featured
        } = req.body;

        if (!sku || !name || !base_price || !category_id) {
            return res.status(400).json({ 
                error: 'Обязательные поля: sku, name, base_price, category_id' 
            });
        }

        let finalMainImageUrl = main_image_url;
        
        if (req.file) {
            finalMainImageUrl = `/uploads/products/${req.file.filename}`;
            console.log('📁 Файл загружен:', finalMainImageUrl);
        }

        const tagsArray = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

        const existingProduct = await db.query(
            'SELECT product_id FROM products WHERE sku = $1',
            [sku]
        );

        if (existingProduct.rows.length > 0) {
            return res.status(400).json({ error: 'Товар с таким SKU уже существует' });
        }
        
        console.log('🔄 Вставка в базу данных...');
        
        const result = await db.query(
            `INSERT INTO products (
                sku, name, description, short_description, category_id, brand_id,
                base_price, old_price, gender, material, care_instructions, season,
                weight_grams, dimensions, main_image_url, tags,
                is_active, is_featured, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()) 
             RETURNING *`,
            [
                sku, name, description, short_description, category_id, brand_id,
                base_price, old_price || null, gender, material, care_instructions, season,
                weight_grams || null, dimensions, finalMainImageUrl, 
                JSON.stringify(tagsArray), 
                is_active !== 'false', 
                is_featured === 'true'
            ]
        );

        console.log(' Товар создан:', result.rows[0]);
        res.status(201).json({ product: result.rows[0] });

    } catch (error) {
        console.error('Ошибка создания товара:', error);
        
        if (req.file) {
            const fs = require('fs');
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting file:', err);
            });
        }
        
        res.status(500).json({ error: 'Ошибка создания товара' });
    }
});

//  УДАЛЕНИЕ ТОВАРА
router.delete('/:id', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const productId = req.params.id;

        // Удаляем в правильном порядке из-за внешних ключей
        await db.query('DELETE FROM order_items WHERE product_id = $1', [productId]);
        await db.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);
        await db.query('DELETE FROM products WHERE product_id = $1', [productId]);

        res.json({ message: 'Товар полностью удален' });

    } catch (error) {
        console.error('Delete product error:', error);

        if (error.code === '23503') {
            res.status(400).json({
                error: 'Не удалось удалить товар. Существуют связанные заказы.'
            });
        } else {
            res.status(500).json({ error: 'Ошибка удаления товара' });
        }
    }
});

//  ОБНОВЛЕНИЕ ОСТАТКОВ
router.put('/:id/stock', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const productId = req.params.id;
        const { stock_quantity } = req.body;

        console.log('Simple stock update:', productId, stock_quantity);

        const variantResult = await db.query(
            `INSERT INTO product_variants 
             (product_id, size_id, color_id, sku, stock_quantity, is_default, is_active)
             VALUES ($1, 
                     (SELECT size_id FROM sizes WHERE size_value = 'Универсальный' LIMIT 1),
                     (SELECT color_id FROM colors WHERE name = 'Универсальный' LIMIT 1),
                     $2, $3, true, true)
             ON CONFLICT (product_id, size_id, color_id) 
             DO UPDATE SET stock_quantity = $3, updated_at = NOW()
             RETURNING *`,
            [
                productId,
                `stock-${productId}`,
                stock_quantity
            ]
        );

        res.json({
            success: true,
            message: 'Остатки обновлены',
            stock_quantity: stock_quantity,
            variant: variantResult.rows[0]
        });

    } catch (error) {
        console.error(' Simple stock update error:', error);
        res.status(500).json({ error: 'Ошибка обновления остатков' });
    }
});

// СОЗДАНИЕ ВАРИАЦИИ ТОВАРА
router.post('/:id/variants', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const productId = req.params.id;
        const { size_id, color_id, sku, price_adjustment = 0, stock_quantity = 0, min_stock_level = 5, is_default = false } = req.body;

        // Проверяем уникальность комбинации размер-цвет
        const existingVariant = await db.query(
            'SELECT variant_id FROM product_variants WHERE product_id = $1 AND size_id = $2 AND color_id = $3',
            [productId, size_id, color_id]
        );

        if (existingVariant.rows.length > 0) {
            return res.status(400).json({ error: 'Вариация с таким размером и цветом уже существует' });
        }

        // Проверяем уникальность SKU вариации
        const existingSku = await db.query(
            'SELECT variant_id FROM product_variants WHERE sku = $1',
            [sku]
        );

        if (existingSku.rows.length > 0) {
            return res.status(400).json({ error: 'Вариация с таким SKU уже существует' });
        }

        const result = await db.query(
            `INSERT INTO product_variants 
             (product_id, size_id, color_id, sku, price_adjustment, stock_quantity, min_stock_level, is_default) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
             RETURNING *`,
            [productId, size_id, color_id, sku, price_adjustment, stock_quantity, min_stock_level, is_default]
        );

        res.status(201).json({ variant: result.rows[0] });

    } catch (error) {
        console.error('Create variant error:', error);
        res.status(500).json({ error: 'Ошибка создания вариации' });
    }
});

// Изменение и удаление вариации конкретного товара
router.put('/:id/variants/:variantId', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    const { sku, size_id, color_id, price_adjustment, stock_quantity, min_stock_level, is_active } = req.body;
    if (!sku || !size_id || !color_id || !Number.isInteger(Number(stock_quantity)) || Number(stock_quantity) < 0 || !Number.isInteger(Number(min_stock_level)) || Number(min_stock_level) < 0 || !Number.isFinite(Number(price_adjustment)) || typeof is_active !== 'boolean') return res.status(400).json({ error: 'Проверьте поля вариации' });
    try {
        const result = await db.query(`UPDATE product_variants SET sku=$1, size_id=$2, color_id=$3, price_adjustment=$4, stock_quantity=$5, min_stock_level=$6, is_active=$7, updated_at=NOW() WHERE product_id=$8 AND variant_id=$9 AND reserved_quantity <= $5 RETURNING *`, [sku, size_id, color_id, price_adjustment, stock_quantity, min_stock_level, is_active, req.params.id, req.params.variantId]);
        if (!result.rows.length) {
            const existing = await db.query('SELECT variant_id FROM product_variants WHERE product_id=$1 AND variant_id=$2', [req.params.id, req.params.variantId]);
            return res.status(existing.rows.length ? 400 : 404).json({ error: existing.rows.length ? 'Остаток меньше зарезервированного количества' : 'Вариация не найдена' });
        }
        res.json({ variant: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'SKU или сочетание размера и цвета уже используется' });
        if (error.code === '23503') return res.status(400).json({ error: 'Размер или цвет не найден' });
        console.error('Update variant error:', error); res.status(500).json({ error: 'Ошибка изменения вариации' });
    }
});
router.delete('/:id/variants/:variantId', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const result = await db.query(`DELETE FROM product_variants v WHERE v.product_id=$1 AND v.variant_id=$2 AND COALESCE(v.reserved_quantity, 0)=0 AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id=v.variant_id) RETURNING v.variant_id`, [req.params.id, req.params.variantId]);
        if (!result.rows.length) {
            const existing = await db.query('SELECT variant_id FROM product_variants WHERE product_id=$1 AND variant_id=$2', [req.params.id, req.params.variantId]);
            return res.status(existing.rows.length ? 400 : 404).json({ error: existing.rows.length ? 'Вариация зарезервирована или связана с заказом' : 'Вариация не найдена' });
        }
        res.json({ message: 'Вариация удалена' });
    } catch (error) { if (error.code === '23503') return res.status(400).json({ error: 'Вариация используется в связанных данных' }); console.error('Delete variant error:', error); res.status(500).json({ error: 'Ошибка удаления вариации' }); }
});

module.exports = router;