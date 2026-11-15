const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { authenticateToken, requireRole, sameUser } = require('../middleware/auth');
const db = require('../config/database');

// ПОЛУЧЕНИЕ ПОЛЬЗОВАТЕЛЯ ПО ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;

        if (!sameUser(req.user.userId, userId) && !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Недостаточно прав' });
        }

        const userResult = await db.query(`
            SELECT 
                u.user_id, u.first_name, u.last_name, u.middle_name, 
                u.email, u.phone, u.user_role, u.created_at, u.is_active,
                e.department, e.position, e.hire_date
            FROM users u
            LEFT JOIN employees e ON u.user_id = e.user_id
            WHERE u.user_id = $1
        `, [userId]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Получаем адреса пользователя (убрали is_default_billing)
        const addressesResult = await db.query(`
            SELECT 
                address_id, address_type, is_default_shipping,
                recipient_name, recipient_phone, country, region, city, 
                postal_code, street, house, building, apartment,
                entrance, floor, intercom, landmark, delivery_instructions,
                created_at, updated_at, is_active
            FROM user_addresses 
            WHERE user_id = $1 AND is_active = true
            ORDER BY 
                is_default_shipping DESC,
                created_at DESC
        `, [userId]);

        const user = userResult.rows[0];
        user.addresses = addressesResult.rows;

        res.json({ user });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Ошибка получения пользователя' });
    }
});


router.get('/:id/addresses', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;

    if (!sameUser(req.user.userId, userId) && !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        data: null,
        message: null,
        error: 'Недостаточно прав'
      });
    }

    const addressesResult = await db.query(`
      SELECT 
        address_id, address_type, is_default_shipping,
        recipient_name, recipient_phone, country, region, city,
        postal_code, street, house, building, apartment,
        entrance, floor, intercom, landmark, delivery_instructions,
        created_at, updated_at, is_active
      FROM user_addresses 
      WHERE user_id = $1 AND is_active = true
      ORDER BY 
        is_default_shipping DESC,
        created_at DESC
    `, [userId]);

    res.json({
      success: true,
      data: addressesResult.rows,
      message: null,
      error: null
    });

  } catch (error) {
    console.error('Get user addresses error:', error);
    res.status(500).json({
      success: false,
      data: null,
      message: null,
      error: 'Ошибка получения адресов'
    });
  }
});


// ДОБАВЛЕНИЕ АДРЕСА ПОЛЬЗОВАТЕЛЯ
router.post('/:id/addresses', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const {
            address_type = 'shipping',
            is_default_shipping = false,
            // is_default_billing убрали
            recipient_name,
            recipient_phone,
            country = 'Россия',
            region,
            city,  
            postal_code,
            street,
            house,
            building,
            apartment,
            entrance,
            floor,
            intercom,
            landmark,
            delivery_instructions
        } = req.body;

        // Проверяем права доступа
        if (!sameUser(req.user.userId, userId) && !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Недостаточно прав' });
        }

        // Если устанавливается адрес по умолчанию, снимаем флаги с других адресов
        if (is_default_shipping) {
            await db.query(`
                UPDATE user_addresses 
                SET is_default_shipping = false 
                WHERE user_id = $1 AND is_default_shipping = true
            `, [userId]);
        }

        const result = await db.query(`
            INSERT INTO user_addresses (
                user_id, address_type, is_default_shipping,
                recipient_name, recipient_phone, country, region, city, 
                postal_code, street, house, building, apartment,
                entrance, floor, intercom, landmark, delivery_instructions
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING *
        `, [
            userId, address_type, is_default_shipping,
            recipient_name, recipient_phone, country, region, city,
            postal_code, street, house, building, apartment,
            entrance, floor, intercom, landmark, delivery_instructions
        ]);

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: null,
            error: null
        });

    } catch (error) {
        console.error('Add address error:', error);
        res.status(500).json({
            success: false,
            data: null,
            message: null,
            error: 'Ошибка добавления адреса'
        });
    }
});


// РЕДАКТИРОВАНИЕ АДРЕСА ПОЛЬЗОВАТЕЛЯ
router.put('/:id/addresses/:addressId', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const addressId = req.params.addressId;
        const updateData = req.body;

        // Проверяем права доступа
        if (!sameUser(req.user.userId, userId) && !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Недостаточно прав' });
        }

        // Проверяем существование адреса
        const addressCheck = await db.query(
            'SELECT address_id FROM user_addresses WHERE address_id = $1 AND user_id = $2',
            [addressId, userId]
        );

        if (addressCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Адрес не найден' });
        }

        // Если устанавливается адрес по умолчанию, снимаем флаг с других
        if (updateData.is_default_shipping === true) {
            await db.query(`
                UPDATE user_addresses 
                SET is_default_shipping = false 
                WHERE user_id = $1 AND address_id != $2 AND is_default_shipping = true
            `, [userId, addressId]);
        }

        // Формируем запрос на обновление
        const updateFields = [];
        const updateValues = [];
        let paramCount = 0;

        const fieldMapping = {
            address_type: 'address_type',
            is_default_shipping: 'is_default_shipping',
            // is_default_billing убрали
            recipient_name: 'recipient_name',
            recipient_phone: 'recipient_phone',
            country: 'country',
            region: 'region',
            city: 'city',
            district: 'district',
            postal_code: 'postal_code',
            street: 'street',
            house: 'house',
            building: 'building',
            apartment: 'apartment',
            entrance: 'entrance',
            floor: 'floor',
            intercom: 'intercom',
            landmark: 'landmark',
            delivery_instructions: 'delivery_instructions'
        };

        Object.keys(fieldMapping).forEach(field => {
            if (updateData[field] !== undefined) {
                paramCount++;
                updateFields.push(`${fieldMapping[field]} = $${paramCount}`);
                updateValues.push(updateData[field]);
            }
        });

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'Нет данных для обновления' });
        }

        updateValues.push(addressId, userId);
        paramCount += 2;

        const query = `
            UPDATE user_addresses 
            SET ${updateFields.join(', ')}, updated_at = NOW()
            WHERE address_id = $${paramCount - 1} AND user_id = $${paramCount}
            RETURNING *
        `;

        const result = await db.query(query, updateValues);

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: null,
            error: null
        });

    } catch (error) {
        console.error('Update address error:', error);
        res.status(500).json({
            success: false,
            data: null,
            message: null,
            error: 'Ошибка обновления адреса'
        });
    }
});


// УДАЛЕНИЕ АДРЕСА ПОЛЬЗОВАТЕЛЯ
router.delete('/:id/addresses/:addressId', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const addressId = req.params.addressId;

        // Проверяем права доступа
        if (!sameUser(req.user.userId, userId) && !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Недостаточно прав' });
        }

        // Проверяем, используется ли адрес в заказах
        const addressInUse = await db.query(`
            SELECT order_id FROM orders 
            WHERE (shipping_address_id = $1 OR billing_address_id = $1)
            LIMIT 1
        `, [addressId]);

        if (addressInUse.rows.length > 0) {
            return res.status(400).json({ 
                error: 'Адрес используется в заказах. Установите is_active = false вместо удаления.' 
            });
        }

        // Мягкое удаление
        const result = await db.query(`
            UPDATE user_addresses 
            SET is_active = false, updated_at = NOW()
            WHERE address_id = $1 AND user_id = $2
            RETURNING address_id
        `, [addressId, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Адрес не найден' });
        }

        res.json({ message: 'Адрес деактивирован' });

    } catch (error) {
        console.error('Delete address error:', error);
        res.status(500).json({ error: 'Ошибка удаления адреса' });
    }
});
// КЛИЕНТЫ (только customer роль) - ДОБАВЛЯЕМ ЭТОТ ЭНДПОИНТ
router.get('/role/customers', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const customersResult = await db.query(`
            SELECT user_id, first_name, last_name, middle_name, email, phone, created_at, is_active
            FROM users 
            WHERE user_role = 'customer'
            ORDER BY created_at DESC
        `);
        res.json({ customers: customersResult.rows });
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ error: 'Ошибка получения клиентов' });
    }
});

// ЗАКАЗЫ КОНКРЕТНОГО КЛИЕНТА - ДОБАВЛЯЕМ ЭТОТ ЭНДПОИНТ
router.get('/:id/orders', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;

        if (!sameUser(req.user.userId, userId) && !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Недостаточно прав' });
        }

        const ordersResult = await db.query(`
            SELECT 
                o.order_id, o.order_number, o.order_date, o.status, 
                o.final_amount, o.payment_status, o.payment_method,
                sa.city as shipping_city,
                sa.street as shipping_street
            FROM orders o
            LEFT JOIN user_addresses sa ON o.shipping_address_id = sa.address_id
            WHERE o.user_id = $1
            ORDER BY o.order_date DESC
        `, [userId]);

        res.json({ 
            success: true, 
            data: ordersResult.rows 
            });

    } catch (error) {
        console.error('Get customer orders error:', error);
        res.status(500).json({ error: 'Ошибка получения заказов клиента' });
    }
});

// ПЕРСОНАЛ (все кроме customer) - ДОБАВЛЯЕМ ЭТОТ ЭНДПОИНТ
router.get('/role/staff', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
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

// ОБНОВЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const {
            firstName, lastName, middleName, email, phone, role,
            is_active, department, position, hire_date
        } = req.body;

        console.log('Updating user:', userId, req.body);

        const userRoles = ['admin', 'manager'];
        if (!userRoles.includes(req.user.role) && !sameUser(req.user.userId, userId)) {
            return res.status(403).json({ error: 'Недостаточно прав для редактирования этого пользователя' });
        }

        if (sameUser(req.user.userId, userId) && role && req.user.role !== role) {
            return res.status(400).json({ error: 'Нельзя изменить собственную роль' });
        }

        if (email) {
            const existingUser = await db.query(
                'SELECT user_id FROM users WHERE email = $1 AND user_id != $2',
                [email, userId]
            );

            if (existingUser.rows.length > 0) {
                return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
            }
        }

        const updateFields = [];
        const updateValues = [];
        let paramCount = 0;

        if (firstName) { updateFields.push(`first_name = $${++paramCount}`); updateValues.push(firstName); }
        if (lastName) { updateFields.push(`last_name = $${++paramCount}`); updateValues.push(lastName); }
        if (middleName !== undefined) { updateFields.push(`middle_name = $${++paramCount}`); updateValues.push(middleName); }
        if (email) { updateFields.push(`email = $${++paramCount}`); updateValues.push(email); }
        if (phone !== undefined) { updateFields.push(`phone = $${++paramCount}`); updateValues.push(phone); }
        if (role && userRoles.includes(req.user.role)) { updateFields.push(`user_role = $${++paramCount}`); updateValues.push(role); }
        if (is_active !== undefined && userRoles.includes(req.user.role)) { updateFields.push(`is_active = $${++paramCount}`); updateValues.push(is_active); }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'Нет данных для обновления' });
        }

        updateValues.push(userId);
        const query = `
            UPDATE users 
            SET ${updateFields.join(', ')}
            WHERE user_id = $${paramCount + 1}
            RETURNING user_id, first_name, last_name, middle_name, email, user_role, phone, created_at, is_active
        `;

        const userResult = await db.query(query, updateValues);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const user = userResult.rows[0];
        const staffRoles = ['admin', 'manager', 'courier', 'content'];
        
        if (userRoles.includes(req.user.role) && role && staffRoles.includes(role)) {
            const employeeExists = await db.query(
                'SELECT employee_id FROM employees WHERE user_id = $1',
                [userId]
            );

            if (employeeExists.rows.length > 0) {
                await db.query(
                    `UPDATE employees 
                     SET department = COALESCE($1, department), 
                         position = COALESCE($2, position), 
                         hire_date = COALESCE($3, hire_date)
                     WHERE user_id = $4`,
                    [department, position, hire_date, userId]
                );
            } else {
                await db.query(
                    `INSERT INTO employees (user_id, department, position, hire_date) 
                     VALUES ($1, $2, $3, $4)`,
                    [userId, department || 'Не указан', position || 'Сотрудник', hire_date || new Date()]
                );
            }
        } else if (userRoles.includes(req.user.role) && role === 'customer') {
            await db.query('DELETE FROM employees WHERE user_id = $1', [userId]);
        }

        res.json({ user });

    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Ошибка обновления пользователя' });
    }
});

// СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ
router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { firstName, lastName, middleName, email, password, role, phone, department, position, hire_date } = req.body;

        const existingUser = await db.query(
            'SELECT user_id FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userResult = await db.query(
            `INSERT INTO users (first_name, last_name, middle_name, email, password_hash, user_role, phone) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING user_id, first_name, last_name, middle_name, email, user_role, phone, created_at, is_active`,
            [firstName, lastName, middleName, email, hashedPassword, role, phone]
        );

        const user = userResult.rows[0];
        const staffRoles = ['admin', 'manager', 'courier', 'content'];
        
        if (staffRoles.includes(role)) {
            await db.query(
                `INSERT INTO employees (user_id, department, position, hire_date) 
                 VALUES ($1, $2, $3, $4)`,
                [user.user_id, department || 'Не указан', position || 'Сотрудник', hire_date || new Date()]
            );
        }

        res.status(201).json({ user });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Ошибка создания пользователя' });
    }
});

// УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const userId = req.params.id;

        if (sameUser(req.user.userId, userId)) {
            return res.status(400).json({ error: 'Нельзя удалить собственный аккаунт' });
        }

        const userResult = await db.query(
            'SELECT user_role FROM users WHERE user_id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (userResult.rows[0].user_role === 'admin') {
            return res.status(400).json({ error: 'Нельзя удалить администратора' });
        }

        try {
            await db.query('DELETE FROM employees WHERE user_id = $1', [userId]);
            await db.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
            await db.query('DELETE FROM returns WHERE user_id = $1', [userId]);
            await db.query('DELETE FROM quality_claims WHERE user_id = $1', [userId]);
            await db.query('DELETE FROM system_logs WHERE user_id = $1', [userId]);
            await db.query(`
                DELETE FROM order_items 
                WHERE order_id IN (SELECT order_id FROM orders WHERE user_id = $1)
            `, [userId]);
            await db.query('DELETE FROM orders WHERE user_id = $1', [userId]);
        } catch (foreignKeyError) {
            console.error('Foreign key cleanup error:', foreignKeyError);
        }

        await db.query('DELETE FROM users WHERE user_id = $1', [userId]);
        res.json({ message: 'Пользователь полностью удален' });

    } catch (error) {
        console.error('Delete user error:', error);
        if (error.code === '23503') {
            res.status(400).json({
                error: 'Не удалось удалить пользователя. Существуют связанные данные.'
            });
        } else {
            res.status(500).json({ error: 'Ошибка при удалении пользователя' });
        }
    }
});

module.exports = router;