# Структура базы данных

Файл `schema.sql` — экспорт структуры существующей базы PostgreSQL 18, созданный pg_dump в режиме schema-only. Он содержит таблицы, представления, функции, ограничения, индексы и триггеры, присутствовавшие на момент экспорта; записи таблиц не включены. Схема `public`.

## Таблицы

| Таблица | Назначение |
| --- | --- |
| `auth_group` | Группы прав |
| `auth_group_permissions` | Права групп |
| `auth_permission` | Права доступа |
| `brands` | Бренды |
| `business_rules` | Бизнес-правила |
| `cart` | Корзины |
| `cart_items` | Позиции корзин |
| `categories` | Категории |
| `colors` | Цвета |
| `employees` | Сотрудники |
| `notifications` | Уведомления |
| `order_items` | Позиции заказов |
| `orders` | Заказы |
| `user_addresses` | Адреса пользователей |
| `users` | Пользователи |
| `order_status_history` | История статусов заказов |
| `product_variants` | Варианты товаров |
| `products` | Товары |
| `quality_claims` | Претензии по качеству |
| `returns` | Возвраты |
| `shipments` | Доставки |
| `tasks` | Задачи |
| `sizes` | Размеры |
| `system_logs` | Системные журналы |

## Внешние ключи

Стрелка указывает от ссылающегося столбца к связанному столбцу.

| Откуда | Куда | Ограничение |
| --- | --- | --- |
| `auth_group_permissions.permission_id` | `auth_permission.id` | `auth_group_permissio_permission_id_84c5c92e_fk_auth_perm` |
| `auth_group_permissions.group_id` | `auth_group.id` | `auth_group_permissions_group_id_b120cbf9_fk_auth_group_id` |
| `cart_items.cart_id` | `cart.cart_id` | `cart_items_cart_id_fkey` |
| `cart_items.product_id` | `products.product_id` | `cart_items_product_id_fkey` |
| `cart_items.variant_id` | `product_variants.variant_id` | `cart_items_variant_id_fkey` |
| `cart.user_id` | `users.user_id` | `cart_user_id_fkey` |
| `categories.parent_id` | `categories.category_id` | `categories_parent_id_fkey` |
| `employees.user_id` | `users.user_id` | `employees_user_id_fkey` |
| `notifications.order_id` | `orders.order_id` | `notifications_order_id_fkey` |
| `notifications.user_id` | `users.user_id` | `notifications_user_id_fkey` |
| `order_items.order_id` | `orders.order_id` | `order_items_order_id_fkey` |
| `order_items.product_id` | `products.product_id` | `order_items_product_id_fkey` |
| `order_items.variant_id` | `product_variants.variant_id` | `order_items_variant_id_fkey` |
| `order_status_history.changed_by` | `users.user_id` | `order_status_history_changed_by_fkey` |
| `order_status_history.order_id` | `orders.order_id` | `order_status_history_order_id_fkey` |
| `orders.billing_address_id` | `user_addresses.address_id` | `orders_billing_address_id_fkey` |
| `orders.shipping_address_id` | `user_addresses.address_id` | `orders_shipping_address_id_fkey` |
| `orders.user_id` | `users.user_id` | `orders_user_id_fkey` |
| `product_variants.color_id` | `colors.color_id` | `product_variants_color_id_fkey` |
| `product_variants.product_id` | `products.product_id` | `product_variants_product_id_fkey` |
| `product_variants.size_id` | `sizes.size_id` | `product_variants_size_id_fkey` |
| `products.brand_id` | `brands.brand_id` | `products_brand_id_fkey` |
| `products.category_id` | `categories.category_id` | `products_category_id_fkey` |
| `quality_claims.assigned_to` | `users.user_id` | `quality_claims_assigned_to_fkey` |
| `quality_claims.order_id` | `orders.order_id` | `quality_claims_order_id_fkey` |
| `quality_claims.product_id` | `products.product_id` | `quality_claims_product_id_fkey` |
| `quality_claims.user_id` | `users.user_id` | `quality_claims_user_id_fkey` |
| `quality_claims.variant_id` | `product_variants.variant_id` | `quality_claims_variant_id_fkey` |
| `returns.business_rule_id` | `business_rules.rule_id` | `returns_business_rule_id_fkey` |
| `returns.order_id` | `orders.order_id` | `returns_order_id_fkey` |
| `returns.pickup_address_id` | `user_addresses.address_id` | `returns_pickup_address_id_fkey` |
| `returns.return_address_id` | `user_addresses.address_id` | `returns_return_address_id_fkey` |
| `returns.user_id` | `users.user_id` | `returns_user_id_fkey` |
| `returns.variant_id` | `product_variants.variant_id` | `returns_variant_id_fkey` |
| `shipments.assigned_employee_id` | `employees.employee_id` | `shipments_assigned_employee_id_fkey` |
| `shipments.business_rule_id` | `business_rules.rule_id` | `shipments_business_rule_id_fkey` |
| `shipments.delivery_address_id` | `user_addresses.address_id` | `shipments_delivery_address_id_fkey` |
| `shipments.order_id` | `orders.order_id` | `shipments_order_id_fkey` |
| `system_logs.user_id` | `users.user_id` | `system_logs_user_id_fkey` |
| `tasks.assigned_to` | `employees.employee_id` | `tasks_assigned_to_fkey` |
| `tasks.business_rule_id` | `business_rules.rule_id` | `tasks_business_rule_id_fkey` |
| `tasks.order_id` | `orders.order_id` | `tasks_order_id_fkey` |
| `tasks.quality_claim_id` | `quality_claims.claim_id` | `tasks_quality_claim_id_fkey` |
| `tasks.return_id` | `returns.return_id` | `tasks_return_id_fkey` |
| `tasks.shipment_id` | `shipments.shipment_id` | `tasks_shipment_id_fkey` |
| `user_addresses.user_id` | `users.user_id` | `user_addresses_user_id_fkey` |

## Восстановление

Создайте пустую базу PostgreSQL 18 и выполните `psql -U postgres -d ИМЯ_БАЗЫ -v ON_ERROR_STOP=1 -f schema.sql`. Используйте psql версии 18, так как экспорт содержит команды, специфичные для этой версии. Экспорт содержит назначения владельца `postgres`; для другой роли необходимо предварительно изменить их в копии файла или обеспечить наличие роли. Восстановление не создаёт пользователей приложения и не заполняет справочники.

В исходном экспорте сохранены функции и триггеры как есть; их работоспособность и наличие всех зависимостей необходимо проверять на целевой базе.
