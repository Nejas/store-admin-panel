const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../config/database');

const getUserCart = async (userId) => {
    const cartResult = await db.query(
        'SELECT cart_id FROM cart WHERE user_id = $1',
        [userId]
    );
    
    if (cartResult.rows.length === 0) {
        const newCart = await db.query(
            'INSERT INTO cart (user_id) VALUES ($1) RETURNING cart_id',
            [userId]
        );
        return newCart.rows[0].cart_id;
    }
    
    return cartResult.rows[0].cart_id;
};

// ПОЛУЧЕНИЕ ТОВАРОВ В КОРЗИНЕ ПОЛЬЗОВАТЕЛЯ
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const cartId = await getUserCart(userId);

        const cartItemsResult = await db.query(`
            SELECT 
                ci.cart_item_id,
                ci.quantity,
                ci.added_at,
                ci.updated_at,
                p.product_id,
                p.sku as product_sku,
                p.name as product_name,
                p.short_description,
                p.base_price,
                p.old_price,
                p.main_image_url,
                p.is_active as product_active,
                pv.variant_id,
                pv.sku as variant_sku,
                pv.price_adjustment,
                pv.stock_quantity,
                pv.reserved_quantity,
                pv.is_active as variant_active,
                pv.is_default,
                s.size_id,
                s.size_value,
                s.description as size_description,
                col.color_id,
                col.name as color_name,
                col.hex_code,
                c.name as category_name,
                b.name as brand_name
            FROM cart_items ci
            INNER JOIN products p ON ci.product_id = p.product_id
            LEFT JOIN product_variants pv ON ci.variant_id = pv.variant_id
            LEFT JOIN sizes s ON pv.size_id = s.size_id
            LEFT JOIN colors col ON pv.color_id = col.color_id
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            WHERE ci.cart_id = $1
            ORDER BY ci.added_at DESC
        `, [cartId]);

        let totalItems = 0;
        let subtotal = 0;
        
        const items = cartItemsResult.rows.map(item => {
            const unitPrice = parseFloat(item.base_price) + parseFloat(item.price_adjustment || 0);
            const itemTotal = unitPrice * item.quantity;
            
            totalItems += item.quantity;
            subtotal += itemTotal;
            
            return {
                cart_item_id: item.cart_item_id,
                quantity: item.quantity,
                added_at: item.added_at,
                updated_at: item.updated_at,
                product: {
                    product_id: item.product_id,
                    sku: item.product_sku,
                    name: item.product_name,
                    short_description: item.short_description,
                    base_price: parseFloat(item.base_price),
                    old_price: item.old_price ? parseFloat(item.old_price) : null,
                    main_image_url: item.main_image_url,
                    is_active: item.product_active,
                    category_name: item.category_name,
                    brand_name: item.brand_name
                },
                variant: item.variant_id ? {
                    variant_id: item.variant_id,
                    sku: item.variant_sku,
                    size: {
                        size_id: item.size_id,
                        size_value: item.size_value,
                        description: item.size_description
                    },
                    color: {
                        color_id: item.color_id,
                        name: item.color_name,
                        hex_code: item.hex_code
                    },
                    price_adjustment: parseFloat(item.price_adjustment) || 0,
                    stock_quantity: item.stock_quantity,
                    available_quantity: item.stock_quantity - item.reserved_quantity,
                    is_default: item.is_default,
                    is_active: item.variant_active
                } : null,
                pricing: {
                    unit_price: unitPrice,
                    item_total: itemTotal
                }
            };
        });

        const finalAmount = subtotal;
        const estimatedTax = subtotal * 0.20; 
        const shippingCost = items.length > 0 ? 500 : 0; 
        res.json({
            success: true,
            cart: {
                cart_id: cartId,
                user_id: userId,
                items: items,
                summary: {
                    total_items: totalItems,
                    total_unique_items: items.length,
                    subtotal: parseFloat(subtotal.toFixed(2)),
                    estimated_tax: parseFloat(estimatedTax.toFixed(2)),
                    shipping_cost: parseFloat(shippingCost.toFixed(2)),
                    final_amount: parseFloat(finalAmount.toFixed(2))
                }
            }
        });

    } catch (error) {
        console.error('Get cart error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка получения корзины' 
        });
    }
});

// ДОБАВЛЕНИЕ ТОВАРА В КОРЗИНУ
router.post('/items', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { product_id, variant_id, quantity = 1 } = req.body;

        if (!product_id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Не указан ID товара' 
            });
        }

        if (quantity <= 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Количество должно быть больше 0' 
            });
        }

        const productResult = await db.query(`
            SELECT 
                p.product_id, 
                p.is_active as product_active,
                pv.variant_id,
                pv.is_active as variant_active,
                pv.stock_quantity,
                pv.reserved_quantity,
                EXISTS (
                    SELECT 1 FROM product_variants 
                    WHERE product_id = p.product_id
                ) as has_variants
            FROM products p
            LEFT JOIN product_variants pv ON p.product_id = pv.product_id 
                AND pv.variant_id = $2
            WHERE p.product_id = $1
        `, [product_id, variant_id]);

        if (productResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Товар не найден' 
            });
        }

        const product = productResult.rows[0];
        
        // Проверка доступности товара
        if (!product.product_active) {
            return res.status(400).json({ 
                success: false, 
                error: 'Товар временно недоступен' 
            });
        }

        // // Проверка необходимости выбора вариации
        // if (product.has_variants && !variant_id) {
        //     return res.status(400).json({ 
        //         success: false, 
        //         error: 'Для этого товара необходимо выбрать вариацию (размер/цвет)' 
        //     });
        // }

        // Проверка доступности вариации
        if (variant_id) {
            if (!product.variant_id) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Выбранная вариация не найдена' 
                });
            }
            
            if (!product.variant_active) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Выбранная вариация временно недоступна' 
                });
            }

            // Проверка остатков
            const availableStock = product.stock_quantity - product.reserved_quantity;
            if (availableStock < quantity) {
                return res.status(400).json({ 
                    success: false, 
                    error: `Недостаточно товара в наличии. Доступно: ${availableStock}` 
                });
            }
        }

        // Получаем корзину пользователя
        const cartId = await getUserCart(userId);

        // Добавляем или обновляем товар в корзине
        const result = await db.query(`
            INSERT INTO cart_items (cart_id, product_id, variant_id, quantity)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (cart_id, product_id, variant_id) 
            DO UPDATE SET 
                quantity = cart_items.quantity + EXCLUDED.quantity,
                updated_at = NOW()
            RETURNING *
        `, [cartId, product_id, variant_id, quantity]);

        await db.query(
            'UPDATE cart SET updated_at = NOW() WHERE cart_id = $1',
            [cartId]
        );

        // Получаем полную информацию о добавленном товаре
        const fullItemResult = await db.query(`
            SELECT 
                ci.cart_item_id,
                ci.quantity,
                ci.added_at,
                ci.updated_at,
                ci.product_id,
                ci.variant_id,
                p.name as product_name,
                p.short_description,
                p.base_price,
                p.old_price,
                p.main_image_url,
                p.is_active as product_active,
                pv.price_adjustment,
                s.size_value,
                col.name as color_name
            FROM cart_items ci
            INNER JOIN products p ON ci.product_id = p.product_id
            LEFT JOIN product_variants pv ON ci.variant_id = pv.variant_id
            LEFT JOIN sizes s ON pv.size_id = s.size_id
            LEFT JOIN colors col ON pv.color_id = col.color_id
            WHERE ci.cart_item_id = $1
        `, [result.rows[0].cart_item_id]);

        const fullItem = fullItemResult.rows[0];
        const unitPrice = parseFloat(fullItem.base_price) + parseFloat(fullItem.price_adjustment || 0);
        const itemTotal = unitPrice * fullItem.quantity;

        res.json({
            success: true,
            message: 'Товар добавлен в корзину',
            cart_item: {
                cart_item_id: fullItem.cart_item_id,
                quantity: fullItem.quantity,
                added_at: fullItem.added_at,
                updated_at: fullItem.updated_at,
                product: {
                    product_id: fullItem.product_id,
                    name: fullItem.product_name,
                    short_description: fullItem.short_description,
                    base_price: parseFloat(fullItem.base_price),
                    old_price: fullItem.old_price ? parseFloat(fullItem.old_price) : null,
                    main_image_url: fullItem.main_image_url,
                    is_active: fullItem.product_active
                },
                variant: fullItem.variant_id ? {
                    variant_id: fullItem.variant_id,
                    size: fullItem.size_value ? { 
                        size_value: fullItem.size_value 
                    } : null,
                    color: fullItem.color_name ? { 
                        name: fullItem.color_name 
                    } : null,
                    price_adjustment: parseFloat(fullItem.price_adjustment) || 0
                } : null,
                pricing: {
                    unit_price: unitPrice,
                    item_total: itemTotal
                }
            },
            cart_id: cartId
        });

    } catch (error) {
        console.error('Add to cart error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка добавления товара в корзину' 
        });
    }
});

// ОБНОВЛЕНИЕ КОЛИЧЕСТВА ТОВАРА В КОРЗИНЕ
router.put('/items/:cart_item_id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { cart_item_id } = req.params;
        const { quantity } = req.body;

        // Валидация
        if (!quantity || quantity <= 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Количество должно быть больше 0' 
            });
        }

        // Проверяем, что товар принадлежит корзине пользователя
        const cartResult = await db.query(`
            SELECT ci.cart_item_id, ci.variant_id, 
                   pv.stock_quantity, pv.reserved_quantity,
                   c.cart_id
            FROM cart_items ci
            INNER JOIN cart c ON ci.cart_id = c.cart_id
            LEFT JOIN product_variants pv ON ci.variant_id = pv.variant_id
            WHERE ci.cart_item_id = $1 AND c.user_id = $2
        `, [cart_item_id, userId]);

        if (cartResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Товар не найден в вашей корзине' 
            });
        }

        const item = cartResult.rows[0];
        const cartId = item.cart_id;

        // Проверка остатков для вариации
        if (item.variant_id) {
            const availableStock = item.stock_quantity - item.reserved_quantity;
            if (availableStock < quantity) {
                return res.status(400).json({ 
                    success: false, 
                    error: `Недостаточно товара в наличии. Доступно: ${availableStock}` 
                });
            }
        }

        // Обновляем количество
        const result = await db.query(`
            UPDATE cart_items 
            SET quantity = $1, updated_at = NOW()
            WHERE cart_item_id = $2
            RETURNING *
        `, [quantity, cart_item_id]);

        // Обновляем время обновления корзины
        await db.query(
            'UPDATE cart SET updated_at = NOW() WHERE cart_id = $1',
            [cartId]
        );

        // Получаем полную информацию об обновленном товаре
        const fullItemResult = await db.query(`
            SELECT 
                ci.cart_item_id,
                ci.quantity,
                ci.added_at,
                ci.updated_at,
                ci.product_id,
                ci.variant_id,
                p.name as product_name,
                p.short_description,
                p.base_price,
                p.old_price,
                p.main_image_url,
                p.is_active as product_active,
                pv.price_adjustment,
                s.size_value,
                col.name as color_name
            FROM cart_items ci
            INNER JOIN products p ON ci.product_id = p.product_id
            LEFT JOIN product_variants pv ON ci.variant_id = pv.variant_id
            LEFT JOIN sizes s ON pv.size_id = s.size_id
            LEFT JOIN colors col ON pv.color_id = col.color_id
            WHERE ci.cart_item_id = $1
        `, [cart_item_id]);

        const fullItem = fullItemResult.rows[0];
        const unitPrice = parseFloat(fullItem.base_price) + parseFloat(fullItem.price_adjustment || 0);
        const itemTotal = unitPrice * fullItem.quantity;

        res.json({
            success: true,
            message: 'Количество товара обновлено',
            cart_item: {
                cart_item_id: fullItem.cart_item_id,
                quantity: fullItem.quantity,
                added_at: fullItem.added_at,
                updated_at: fullItem.updated_at,
                product: {
                    product_id: fullItem.product_id,
                    name: fullItem.product_name,
                    short_description: fullItem.short_description,
                    base_price: parseFloat(fullItem.base_price),
                    old_price: fullItem.old_price ? parseFloat(fullItem.old_price) : null,
                    main_image_url: fullItem.main_image_url,
                    is_active: fullItem.product_active
                },
                variant: fullItem.variant_id ? {
                    variant_id: fullItem.variant_id,
                    size: fullItem.size_value ? { 
                        size_value: fullItem.size_value 
                    } : null,
                    color: fullItem.color_name ? { 
                        name: fullItem.color_name 
                    } : null,
                    price_adjustment: parseFloat(fullItem.price_adjustment) || 0
                } : null,
                pricing: {
                    unit_price: unitPrice,
                    item_total: itemTotal
                }
            }
        });

    } catch (error) {
        console.error('Update cart item error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка обновления товара в корзине' 
        });
    }
});

// УДАЛЕНИЕ ТОВАРА ИЗ КОРЗИНЫ
router.delete('/items/:cart_item_id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { cart_item_id } = req.params;

        // Проверяем принадлежность товара пользователю
        const cartResult = await db.query(`
            SELECT c.cart_id
            FROM cart_items ci
            INNER JOIN cart c ON ci.cart_id = c.cart_id
            WHERE ci.cart_item_id = $1 AND c.user_id = $2
        `, [cart_item_id, userId]);

        if (cartResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Товар не найден в вашей корзине' 
            });
        }

        const cartId = cartResult.rows[0].cart_id;

        // Удаляем товар
        const result = await db.query(`
            DELETE FROM cart_items 
            WHERE cart_item_id = $1
            RETURNING *
        `, [cart_item_id]);

        // Обновляем время обновления корзины
        await db.query(
            'UPDATE cart SET updated_at = NOW() WHERE cart_id = $1',
            [cartId]
        );

        res.json({
            success: true,
            message: 'Товар удален из корзины',
            deleted_item: result.rows[0]
        });

    } catch (error) {
        console.error('Remove from cart error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка удаления товара из корзины' 
        });
    }
});

// ОЧИСТКА ВСЕЙ КОРЗИНЫ
router.delete('/clear', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        // Находим корзину пользователя
        const cartResult = await db.query(
            'SELECT cart_id FROM cart WHERE user_id = $1',
            [userId]
        );

        if (cartResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Корзина не найдена' 
            });
        }

        const cartId = cartResult.rows[0].cart_id;

        // Очищаем корзину
        await db.query(
            'DELETE FROM cart_items WHERE cart_id = $1',
            [cartId]
        );

        // Обновляем время обновления корзины
        await db.query(
            'UPDATE cart SET updated_at = NOW() WHERE cart_id = $1',
            [cartId]
        );

        res.json({
            success: true,
            message: 'Корзина успешно очищена'
        });

    } catch (error) {
        console.error('Clear cart error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка очистки корзины' 
        });
    }
});

// ПРОВЕРКА ДОСТУПНОСТИ ТОВАРОВ В КОРЗИНЕ
router.get('/check-availability', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const cartId = await getUserCart(userId);

        const itemsResult = await db.query(`
            SELECT 
                ci.cart_item_id,
                ci.product_id,
                ci.variant_id,
                ci.quantity,
                p.name as product_name,
                pv.stock_quantity,
                pv.reserved_quantity,
                (pv.stock_quantity - pv.reserved_quantity) as available_quantity,
                CASE 
                    WHEN ci.variant_id IS NULL THEN TRUE
                    WHEN (pv.stock_quantity - pv.reserved_quantity) >= ci.quantity THEN TRUE
                    ELSE FALSE
                END as is_available,
                CASE 
                    WHEN ci.variant_id IS NULL THEN 'Товар доступен'
                    WHEN (pv.stock_quantity - pv.reserved_quantity) >= ci.quantity THEN 'Достаточно на складе'
                    ELSE CONCAT('Недостаточно. Доступно: ', pv.stock_quantity - pv.reserved_quantity)
                END as availability_message
            FROM cart_items ci
            LEFT JOIN product_variants pv ON ci.variant_id = pv.variant_id
            INNER JOIN products p ON ci.product_id = p.product_id
            WHERE ci.cart_id = $1
        `, [cartId]);

        const allAvailable = itemsResult.rows.every(item => item.is_available);
        
        res.json({
            success: true,
            availability_check: {
                all_available: allAvailable,
                items: itemsResult.rows,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Check availability error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка проверки доступности товаров' 
        });
    }
});

module.exports = router;