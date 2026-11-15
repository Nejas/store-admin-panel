const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

// ПОЛУЧЕНИЕ ДОСТАВОК С АДРЕСАМИ
router.get('/', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const shipmentsResult = await db.query(`
            SELECT 
                s.shipment_id, s.tracking_number, s.status, s.shipment_date,
                s.estimated_delivery, s.actual_delivery, s.shipping_cost,
                s.carrier, s.courier_notes, s.created_at, s.updated_at,
                o.order_number,
                u.first_name || ' ' || u.last_name as courier_name,
                
                -- Адрес доставки
                ua.recipient_name as delivery_recipient,
                ua.recipient_phone as delivery_phone,
                ua.city as delivery_city,
                ua.street as delivery_street,
                ua.house as delivery_house,
                ua.apartment as delivery_apartment
                
            FROM shipments s
            LEFT JOIN orders o ON s.order_id = o.order_id
            LEFT JOIN employees e ON s.assigned_employee_id = e.employee_id
            LEFT JOIN users u ON e.user_id = u.user_id
            LEFT JOIN user_addresses ua ON s.delivery_address_id = ua.address_id
            ORDER BY s.created_at DESC
            LIMIT 50
        `);

        res.json({ shipments: shipmentsResult.rows });

    } catch (error) {
        console.error('Shipments error:', error);
        res.status(500).json({ error: 'Ошибка получения доставок' });
    }
});

// ОБНОВЛЕНИЕ СТАТУСА ДОСТАВКИ
router.put('/:id/status', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, actual_delivery } = req.body;

        let updateQuery = 'UPDATE shipments SET status = $1, updated_at = NOW()';
        let params = [status];

        if (actual_delivery && status === 'delivered') {
            updateQuery += ', actual_delivery = $2';
            params.push(actual_delivery);
        }

        updateQuery += ' WHERE shipment_id = $' + (params.length + 1) + ' RETURNING *';
        params.push(id);

        const result = await db.query(updateQuery, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Доставка не найдена' });
        }

        res.json({ shipment: result.rows[0] });

    } catch (error) {
        console.error('Update shipment error:', error);
        res.status(500).json({ error: 'Ошибка обновления доставки' });
    }
});

// СОЗДАНИЕ ДОСТАВКИ С АДРЕСОМ
router.post('/', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const {
            order_id,
            delivery_address_id,
            carrier,
            tracking_number,
            shipping_cost,
            estimated_delivery,
            assigned_employee_id
        } = req.body;

        // Проверяем существование заказа
        const orderCheck = await db.query(
            'SELECT order_id FROM orders WHERE order_id = $1',
            [order_id]
        );
        if (orderCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }

        // Проверяем существование адреса
        const addressCheck = await db.query(
            'SELECT address_id FROM user_addresses WHERE address_id = $1 AND is_active = true',
            [delivery_address_id]
        );
        if (addressCheck.rows.length === 0) {
            return res.status(400).json({ error: 'Адрес доставки не найден или не активен' });
        }

        const result = await db.query(`
            INSERT INTO shipments (
                order_id, delivery_address_id, carrier, tracking_number,
                shipping_cost, estimated_delivery, assigned_employee_id,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
            RETURNING *
        `, [
            order_id, delivery_address_id, carrier, tracking_number,
            shipping_cost, estimated_delivery, assigned_employee_id
        ]);

        res.status(201).json({ shipment: result.rows[0] });

    } catch (error) {
        console.error('Create shipment error:', error);
        res.status(500).json({ error: 'Ошибка создания доставки' });
    }
});

module.exports = router;
