const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../config/database');

// СТАТИСТИКА ДАШБОРДА
router.get('/stats', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
        const [
            ordersCount,
            totalRevenue,
            productsCount,
            customersCount,
            lowStockProducts,
            recentOrders
        ] = await Promise.all([
            db.query("SELECT COUNT(*) FROM orders"),
            db.query("SELECT COALESCE(SUM(final_amount), 0) as revenue FROM orders WHERE status = 'delivered'"),
            db.query("SELECT COUNT(*) FROM products WHERE is_active = true"),
            db.query("SELECT COUNT(*) FROM users WHERE user_role = 'customer'"),
            db.query(`
                SELECT p.name, pv.stock_quantity, pv.sku 
                FROM product_variants pv
                JOIN products p ON pv.product_id = p.product_id
                WHERE pv.stock_quantity <= pv.min_stock_level 
                AND pv.is_active = true
                LIMIT 10
            `),
            db.query(`
                SELECT o.order_number, o.order_date, o.final_amount, o.status,
                       u.first_name || ' ' || u.last_name as customer_name
                FROM orders o
                JOIN users u ON o.user_id = u.user_id
                ORDER BY o.order_date DESC
                LIMIT 5
            `)
        ]);

        res.json({
            orders: parseInt(ordersCount.rows[0].count),
            revenue: parseFloat(totalRevenue.rows[0].revenue),
            products: parseInt(productsCount.rows[0].count),
            customers: parseInt(customersCount.rows[0].count),
            lowStock: lowStockProducts.rows,
            recentOrders: recentOrders.rows
        });

    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

module.exports = router;