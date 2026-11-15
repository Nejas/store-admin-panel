const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole, sameUser } = require('../middleware/auth');
const db = require('../config/database');


// ПОЛУЧЕНИЕ ЗАКАЗОВ С АДРЕСАМИ
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, page = 1, limit = 10, user_id } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT 
                o.order_id, o.order_number, o.order_date, o.status, 
                o.final_amount, o.payment_status, o.payment_method,
                o.customer_notes, o.internal_notes, o.created_at, o.updated_at,
                u.first_name || ' ' || u.last_name as customer_name,
                u.email as customer_email,
                u.phone as customer_phone,
                
                -- Адрес доставки
                sa.recipient_name as shipping_recipient,
                sa.city as shipping_city,
                sa.street as shipping_street,
                sa.house as shipping_house,
                sa.apartment as shipping_apartment
            FROM orders o
            JOIN users u ON o.user_id = u.user_id
            LEFT JOIN user_addresses sa ON o.shipping_address_id = sa.address_id
        `;

        let whereConditions = [];
        let params = [];
        let paramCount = 0;

        if (status && status !== 'all') {
            paramCount++;
            whereConditions.push(`o.status = $${paramCount}`);
            params.push(status);
        }

        if (user_id) {
            paramCount++;
            whereConditions.push(`o.user_id = $${paramCount}`);
            params.push(user_id);
        }

        if (!['admin', 'manager'].includes(req.user.role)) {
            paramCount++;
            whereConditions.push(`o.user_id = $${paramCount}`);
            params.push(req.user.userId);
        }

        if (whereConditions.length > 0) {
            query += ' WHERE ' + whereConditions.join(' AND ');
        }

        query += ` ORDER BY o.order_date DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limit, offset);

        const ordersResult = await db.query(query, params);

        let countQuery = `
            SELECT COUNT(*) FROM orders o
            JOIN users u ON o.user_id = u.user_id
        `;
        let countParams = [];

        if (whereConditions.length > 0) {
            countQuery += ' WHERE ' + whereConditions.join(' AND ');
            countParams = params.slice(0, whereConditions.length);
        }

        const countResult = await db.query(countQuery, countParams);
        const totalCount = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            data: {
                orders: ordersResult.rows,
                page: parseInt(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount: totalCount
            },
            message: null,
            error: null
        });
    } catch (error) {
        console.error('Orders error:', error);
        res.status(500).json({
            success: false,
            data: null,
            message: null,
            error: 'Ошибка получения заказов'
        });
    }
});


// ПОЛУЧЕНИЕ ДЕТАЛЕЙ ЗАКАЗА С АДРЕСОМ ДОСТАВКИ
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const orderId = req.params.id;

        let whereCondition = 'o.order_id = $1';
        const params = [orderId];

        if (!['admin', 'manager'].includes(req.user.role)) {
            whereCondition += ' AND o.user_id = $2';
            params.push(req.user.userId);
        }

        const orderResult = await db.query(`
            SELECT 
                o.*,
                u.first_name || ' ' || u.last_name as customer_name,
                u.email as customer_email,
                u.phone as customer_phone,
                
                -- Полная информация об адресе доставки
                sa.address_id as shipping_address_id,
                sa.address_type as shipping_address_type,
                sa.recipient_name as shipping_recipient_name,
                sa.recipient_phone as shipping_recipient_phone,
                sa.country as shipping_country,
                sa.region as shipping_region,
                sa.city as shipping_city,
                sa.postal_code as shipping_postal_code,
                sa.street as shipping_street,
                sa.house as shipping_house,
                sa.building as shipping_building,
                sa.apartment as shipping_apartment,
                sa.entrance as shipping_entrance,
                sa.floor as shipping_floor,
                sa.intercom as shipping_intercom,
                sa.landmark as shipping_landmark,
                sa.delivery_instructions as shipping_delivery_instructions
            FROM orders o
            JOIN users u ON o.user_id = u.user_id
            LEFT JOIN user_addresses sa ON o.shipping_address_id = sa.address_id
            WHERE ${whereCondition}
        `, params);

        if (orderResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                data: null,
                message: null,
                error: 'Заказ не найден или нет доступа'
            });
        }

        const order = orderResult.rows[0];

        const itemsResult = await db.query(`
            SELECT 
                oi.*,
                p.name as product_name,
                p.sku as product_sku,
                p.main_image_url,
                s.size_value,
                col.name as color_name,
                col.hex_code as color_hex
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.product_id
            LEFT JOIN product_variants pv ON oi.variant_id = pv.variant_id
            LEFT JOIN sizes s ON pv.size_id = s.size_id
            LEFT JOIN colors col ON pv.color_id = col.color_id
            WHERE oi.order_id = $1
            ORDER BY oi.created_at
        `, [orderId]);

        order.items = itemsResult.rows;

        const shipmentsResult = await db.query(`
            SELECT 
                s.*,
                u.first_name || ' ' || u.last_name as courier_name
            FROM shipments s
            LEFT JOIN employees e ON s.assigned_employee_id = e.employee_id
            LEFT JOIN users u ON e.user_id = u.user_id
            WHERE s.order_id = $1
            ORDER BY s.created_at DESC
        `, [orderId]);

        order.shipments = shipmentsResult.rows;

        res.json({
            success: true,
            data: order,
            message: null,
            error: null
        });
    } catch (error) {
        console.error('Get order details error:', error);
        res.status(500).json({
            success: false,
            data: null,
            message: null,
            error: 'Ошибка получения деталей заказа'
        });
    }
});


// СОЗДАНИЕ ЗАКАЗА (ТОЛЬКО АДРЕС ДОСТАВКИ)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const {
            user_id,
            shipping_address_id,
            items,
            customer_notes,
            payment_method = 'card',
            shipping_amount = 0
        } = req.body;

        if (!['admin', 'manager'].includes(req.user.role) && !sameUser(req.user.userId, user_id)) {
            return res.status(403).json({
                success: false,
                data: null,
                message: null,
                error: 'Недостаточно прав'
            });
        }

        const shippingAddress = await db.query(
            'SELECT address_id FROM user_addresses WHERE address_id = $1 AND user_id = $2 AND is_active = true',
            [shipping_address_id, user_id]
        );
        if (shippingAddress.rows.length === 0) {
            return res.status(400).json({
                success: false,
                data: null,
                message: null,
                error: 'Адрес доставки не найден или не активен'
            });
        }

        const shortTs = Date.now().toString().slice(-8);
        const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        const orderNumber = `ORD-${shortTs}-${rand}`;

        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const productResult = await db.query(
                'SELECT base_price FROM products WHERE product_id = $1 AND is_active = true',
                [item.product_id]
            );
            if (productResult.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    data: null,
                    message: null,
                    error: `Товар ${item.product_id} не найден`
                });
            }

            const unitPrice = productResult.rows[0].base_price;
            const itemTotal = unitPrice * item.quantity;
            totalAmount += itemTotal;

            orderItems.push({
                product_id: item.product_id,
                variant_id: item.variant_id,
                quantity: item.quantity,
                unit_price: unitPrice,
                total_price: itemTotal
            });
        }

        const finalAmount = totalAmount + shipping_amount;

        const insertOrderResult = await db.query(`
            INSERT INTO orders (
                order_number, user_id, shipping_address_id, billing_address_id,
                status, payment_status, payment_method,
                total_amount, discount_amount, shipping_amount, final_amount,
                customer_notes
            ) VALUES ($1, $2, $3, $3, 'processing', 'pending', $4, $5, 0, $6, $7, $8)
            RETURNING *
        `, [
            orderNumber,
            user_id,
            shipping_address_id,
            payment_method,
            totalAmount,
            shipping_amount,
            finalAmount,
            customer_notes
        ]);

        const insertedOrder = insertOrderResult.rows[0];

        for (const item of orderItems) {
            await db.query(`
                INSERT INTO order_items (
                    order_id, product_id, variant_id, quantity,
                    unit_price, total_price
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                insertedOrder.order_id,
                item.product_id,
                item.variant_id,
                item.quantity,
                item.unit_price,
                item.total_price
            ]);

            if (item.variant_id) {
                await db.query(`
                    UPDATE product_variants
                    SET reserved_quantity = reserved_quantity + $1
                    WHERE variant_id = $2 AND stock_quantity >= (reserved_quantity + $1)
                `, [item.quantity, item.variant_id]);
            }
        }

        const orderResult = await db.query(`
            SELECT 
                o.*,
                u.first_name || ' ' || u.last_name as customer_name,
                u.email as customer_email,
                u.phone as customer_phone
            FROM orders o
            JOIN users u ON o.user_id = u.user_id
            WHERE o.order_id = $1
        `, [insertedOrder.order_id]);

        const orderWithCustomer = orderResult.rows[0];

        res.status(201).json({
            success: true,
            data: orderWithCustomer,
            message: null,
            error: null
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({
            success: false,
            data: null,
            message: null,
            error: 'Ошибка создания заказа'
        });
    }
});


// Редактирование оплаты и примечаний заказа
router.put('/:id', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    const allowed = ['payment_status', 'payment_method', 'customer_notes', 'internal_notes'];
    const fields = allowed.filter(key => Object.prototype.hasOwnProperty.call(req.body, key));
    if (!fields.length || fields.some(key => req.body[key] !== null && typeof req.body[key] !== 'string') || (fields.includes('payment_status') && !['pending', 'paid', 'failed', 'refunded'].includes(req.body.payment_status))) return res.status(400).json({ error: 'Проверьте поля заказа' });
    try {
        const values = fields.map(key => req.body[key]); values.push(req.params.id);
        const result = await db.query(`UPDATE orders SET ${fields.map((key, index) => key + '=$' + (index + 1)).join(', ')}, updated_at=NOW() WHERE order_id=$${values.length} RETURNING *`, values);
        if (!result.rows.length) return res.status(404).json({ error: 'Заказ не найден' });
        res.json({ success: true, data: result.rows[0], message: null, error: null });
    } catch (error) { console.error('Update order error:', error); res.status(500).json({ error: 'Ошибка изменения заказа' }); }
});

// ОБНОВЛЕНИЕ СТАТУСА ЗАКАЗА
router.put('/:id/status', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const orderId = req.params.id;
        const { status } = req.body;

        await db.query(
            'INSERT INTO order_status_history (order_id, old_status, new_status) VALUES ($1, (SELECT status FROM orders WHERE order_id = $1), $2)',
            [orderId, status]
        );

        const result = await db.query(
            'UPDATE orders SET status = $1, updated_at = NOW() WHERE order_id = $2 RETURNING *',
            [status, orderId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                data: null,
                message: null,
                error: 'Заказ не найден'
            });
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: null,
            error: null
        });
    } catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({
            success: false,
            data: null,
            message: null,
            error: 'Ошибка обновления статуса заказа'
        });
    }
});


// ПОЛУЧЕНИЕ ИСТОРИИ СТАТУСОВ ЗАКАЗА
router.get('/:id/status-history', authenticateToken, async (req, res) => {
    try {
        const orderId = req.params.id;

        let whereCondition = 'osh.order_id = $1';
        const params = [orderId];

        if (!['admin', 'manager'].includes(req.user.role)) {
            whereCondition += ' AND o.user_id = $2';
            params.push(req.user.userId);

            const checkResult = await db.query(
                'SELECT user_id FROM orders WHERE order_id = $1',
                [orderId]
            );

            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    data: null,
                    message: null,
                    error: 'Заказ не найден'
                });
            }

            if (!sameUser(checkResult.rows[0].user_id, req.user.userId)) {
                return res.status(403).json({
                    success: false,
                    data: null,
                    message: null,
                    error: 'Недостаточно прав'
                });
            }
        }

        const historyResult = await db.query(`
            SELECT 
                osh.*,
                u.first_name || ' ' || u.last_name as changed_by_name
            FROM order_status_history osh
            LEFT JOIN orders o ON osh.order_id = o.order_id
            LEFT JOIN users u ON osh.changed_by = u.user_id
            WHERE ${whereCondition}
            ORDER BY osh.created_at DESC
        `, params);

        res.json({
            success: true,
            data: historyResult.rows,
            message: null,
            error: null
        });
    } catch (error) {
        console.error('Get status history error:', error);
        res.status(500).json({
            success: false,
            data: null,
            message: null,
            error: 'Ошибка получения истории статусов'
        });
    }
});

// ЗАКАЗЫ КЛИЕНТА (с адресом доставки и товарами)
router.get('/customers/:id/orders', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;

    if (!['admin', 'manager'].includes(req.user.role) && !sameUser(req.user.userId, userId)) {
      return res.status(403).json({
        success: false,
        data: null,
        message: null,
        error: 'Недостаточно прав'
      });
    }

    const ordersResult = await db.query(`
      SELECT 
        o.order_id,
        o.order_number,
        o.order_date,
        o.status,
        o.final_amount,
        o.payment_status,
        o.payment_method,
        u.first_name || ' ' || u.last_name AS customer_name,
        u.email            AS customer_email,
        u.phone            AS customer_phone,
        sa.city            AS shipping_city,
        sa.street          AS shipping_street,
        sa.house           AS shipping_house,
        sa.apartment       AS shipping_apartment,

        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.order_item_id,
              'product_id', oi.product_id,
              'variant_id', oi.variant_id,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'total_price', oi.total_price,
              'product_name', p.name,
              'product_sku', p.sku,
              'product_image', p.main_image_url,
              'size', s.size_value,
              'color', col.name
            )
          ) FILTER (WHERE oi.order_item_id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN users u            ON o.user_id = u.user_id
      LEFT JOIN user_addresses sa  ON o.shipping_address_id = sa.address_id
      LEFT JOIN order_items oi     ON oi.order_id = o.order_id
      LEFT JOIN products p         ON oi.product_id = p.product_id
      LEFT JOIN product_variants pv ON oi.variant_id = pv.variant_id
      LEFT JOIN sizes s            ON pv.size_id = s.size_id
      LEFT JOIN colors col         ON pv.color_id = col.color_id
      WHERE o.user_id = $1
      GROUP BY
        o.order_id,
        o.order_number,
        o.order_date,
        o.status,
        o.final_amount,
        o.payment_status,
        o.payment_method,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        sa.city,
        sa.street,
        sa.house,
        sa.apartment
      ORDER BY o.order_date DESC
    `, [userId]);

    const orders = ordersResult.rows.map(row => {
      const formattedAddress = [
        row.shipping_city,
        row.shipping_street,
        row.shipping_house,
        row.shipping_apartment
      ].filter(Boolean).join(', ');

      return {
        order_id: row.order_id,
        order_number: row.order_number,
        order_date: row.order_date,
        status: row.status,
        final_amount: Number(row.final_amount),
        payment_status: row.payment_status,
        payment_method: row.payment_method,
        customer_name: row.customer_name || '',
        customer_email: row.customer_email || '',
        customer_phone: row.customer_phone || null,
        customer_notes: null,
        shipping_address: {
          formattedAddress: formattedAddress || 'Адрес не указан'
        },
        items: row.items || [],
        shipments: []
      };
    });

    res.json({
      success: true,
      data: {
        orders,
        page: 1,
        totalPages: 1,
        totalCount: orders.length
      },
      message: null,
      error: null
    });
  } catch (error) {
    console.error('Get customer orders error:', error);
    res.status(500).json({
      success: false,
      data: null,
      message: null,
      error: 'Ошибка получения заказов клиента'
    });
  }
});






module.exports = router;
