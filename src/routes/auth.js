    const express = require('express');
    const router = express.Router();
    const bcrypt = require('bcryptjs');
    const db = require('../config/database');
    const jwt = require('jsonwebtoken');
    const { authenticateToken, generateToken } = require('../middleware/auth');



    router.post('/login', async (req, res) => {
        try {
            const { email, password } = req.body;

            const userResult = await db.query(
                'SELECT * FROM users WHERE email = $1 AND is_active = true',
                [email]
            );

            if (userResult.rows.length === 0) {
                return res.status(401).json({ error: 'Пользователь не найден' });
            }

            const user = userResult.rows[0];
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Неверный пароль' });
            }

            const token = generateToken(user); 

            res.json({
                token,
                user: {
                    user_id: user.user_id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    user_role: user.user_role,
                    phone: user.phone
                }
            });

        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Ошибка аутентификации' });
        }
    });

    router.post('/register-simple', async (req, res) => {
        try {
            const { firstName, lastName, middleName, email, password, phone } = req.body;

            // Валидация обязательных полей
            if (!firstName || !lastName || !email || !password) {
                return res.status(400).json({ 
                    error: 'Все обязательные поля должны быть заполнены: имя, фамилия, email, пароль' 
                });
            }

            // Проверка email
            const existingUser = await db.query(
                'SELECT user_id FROM users WHERE email = $1',
                [email]
            );

            if (existingUser.rows.length > 0) {
                return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
            }

            // Хеширование пароля
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Создание пользователя с ролью customer
            const userResult = await db.query(
                `INSERT INTO users (first_name, last_name, middle_name, email, password_hash, user_role, phone) 
                VALUES ($1, $2, $3, $4, $5, $6, $7) 
                RETURNING user_id, first_name, last_name, middle_name, email, user_role, phone, created_at, is_active`,
                [firstName, lastName, middleName || null, email, hashedPassword, 'customer', phone || null]
            );

            const user = userResult.rows[0];

            // Генерация JWT токена
            const token = jwt.sign(
                { 
                    userId: user.user_id, 
                    email: user.email, 
                    role: user.user_role 
                },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.status(201).json({
                token,
                user: {
                    user_id: user.user_id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    middle_name: user.middle_name,
                    user_role: user.user_role,
                    phone: user.phone
                }
            });

        } catch (error) {
            console.error('Register user error:', error);
            res.status(500).json({ error: 'Ошибка регистрации пользователя' });
        }
    });

    //Регистрация клиента
    router.post('/register', async (req, res) => {
        try {
            const { firstName, lastName, middleName, email, password, phone } = req.body;

            // Валидация обязательных полей
            if (!firstName || !lastName || !email || !password) {
                return res.status(400).json({ 
                    error: 'Все обязательные поля должны быть заполнены: имя, фамилия, email, пароль' 
                });
            }

            // Проверка email
            const existingUser = await db.query(
                'SELECT user_id FROM users WHERE email = $1',
                [email]
            );

            if (existingUser.rows.length > 0) {
                return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
            }

            // Хеширование пароля
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Создание пользователя с ролью customer
            const userResult = await db.query(
                `INSERT INTO users (first_name, last_name, middle_name, email, password_hash, user_role, phone) 
                VALUES ($1, $2, $3, $4, $5, $6, $7) 
                RETURNING user_id, first_name, last_name, middle_name, email, user_role, phone, created_at, is_active`,
                [firstName, lastName, middleName || null, email, hashedPassword, 'customer', phone || null]
            );

            const user = userResult.rows[0];

            // Генерация JWT токена
            const token = jwt.sign(
                { 
                    userId: user.user_id, 
                    email: user.email, 
                    role: user.user_role 
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            console.log('🟢 REGISTER: User created successfully:', user.user_id); // ← Добавьте для отладки
            
            res.status(201).json({
                success: true,
                data: {
                    token,
                    user: {
                        user_id: user.user_id,
                        email: user.email,
                        first_name: user.first_name,
                        last_name: user.last_name,
                        middle_name: user.middle_name,
                        user_role: user.user_role,
                        phone: user.phone
                    }
                },
                message: 'Регистрация успешна'
            });

        } catch (error) {
            console.error(' REGISTER ERROR:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка регистрации пользователя'
            });
        }
    });
    // routes/auth.js
    router.get('/validate-token', authenticateToken, async (req, res) => {
        try {
            // Получаем актуальные данные пользователя из БД
            const userResult = await db.query(
                'SELECT user_id, email, first_name, last_name, middle_name, user_role, phone FROM users WHERE user_id = $1 AND is_active = true',
                [req.user.userId]
            );

            if (userResult.rows.length === 0) {
                return res.status(401).json({ error: 'Пользователь не найден' });
            }

            const user = userResult.rows[0];
            
            // Генерируем новый токен (или возвращаем существующий)
            const token = generateToken(user);
            
            // Возвращаем в формате AuthApiResponse (token + user)
            res.json({
                token: token,
                user: {
                    user_id: user.user_id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    middle_name: user.middle_name,
                    user_role: user.user_role,
                    phone: user.phone
                }
            });

        } catch (error) {
            console.error('Validate token error:', error);
            res.status(500).json({ error: 'Ошибка проверки токена' });
        }
    });

    module.exports = router;