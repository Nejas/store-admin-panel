// public/script.js - КЛИЕНТСКИЙ JavaScript
console.log(' script.js загружен');

const API_BASE = window.location.origin;
let currentUser = null;
let authToken = null;
let referencesLoaded = false;
let currentEditingProductId = null;

// API функции
async function apiRequest(endpoint, options = {}) {
    const config = {
        headers: {
            // НЕ устанавливаем Content-Type по умолчанию!
            ...options.headers
        },
        ...options
    };

    if (authToken) {
        config.headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Обрабатываем body в зависимости от типа
    if (options.body) {
        if (options.body instanceof FormData) {
            // Для FormData НЕ устанавливаем Content-Type и НЕ преобразуем в JSON
            // Браузер сам установит правильный Content-Type с boundary
            console.log('📤 Отправка FormData');
        } else if (typeof options.body === 'object') {
            // Для обычных объектов преобразуем в JSON
            config.body = JSON.stringify(options.body);
            config.headers['Content-Type'] = 'application/json';
            console.log('📤 Отправка JSON');
        }
    }

    try {
        console.log(` API Request: ${endpoint}`, {
            method: config.method,
            authenticated: Boolean(authToken)
        });

        const response = await fetch(`${API_BASE}${endpoint}`, config);

        if (!response.ok) {
            let errorMessage = `HTTP error! status: ${response.status}`;

            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
                console.error(' API Error Details:', errorData);
            } catch (e) {
                // Если не удалось распарсить JSON, используем стандартное сообщение
            }

            throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log(' API Success:', data);
        return data;
        
    } catch (error) {
        console.error(`API Error for ${endpoint}:`, error);

        // Показываем пользователю понятное сообщение
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Ошибка соединения с сервером');
        } else if (error.message.includes('500')) {
            throw new Error('Ошибка на сервере. Попробуйте позже.');
        } else {
            throw error;
        }
    }
}

// Утилиты
const utils = {
    formatCurrency(amount) {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB'
        }).format(amount);
    },

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('ru-RU');
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// UI функции
const ui = {
    showLoginPage() {
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('adminPanel').style.display = 'none';
    },

    showAdminPanel() {
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'flex';
        this.updateUserInfo();

        // Загружаем справочники при первом показе админ-панели
        if (!referencesLoaded) {
            this.loadAllReferences();
        }
    },

updateUserInfo() {
    if (!currentUser) return;

    // Формируем ФИО с отчеством если есть
    const nameParts = [
        currentUser.last_name,
        currentUser.first_name, 
        currentUser.middle_name
    ].filter(name => name && name.trim());
    
    const fullName = nameParts.join(' ').trim();
    const displayName = fullName || currentUser.email || 'Пользователь';
    
    // Должность (приоритет: position > user_role)
    const position = currentUser.position || 
                    this.getRoleName(currentUser.user_role) || 
                    'Сотрудник';

    document.getElementById('currentUserName').textContent = displayName;
    document.getElementById('currentUserRole').textContent = position;
    document.getElementById('headerUserName').textContent = displayName;
    document.getElementById('headerUserRole').textContent = position;
},

    // ЗАГРУЗКА ВСЕХ СПРАВОЧНИКОВ ПРИ ЗАПУСКЕ
    async loadAllReferences() {
        try {
            console.log('🔄 Загрузка справочников...');
            const [categoriesData, brandsData, sizesData, colorsData] = await Promise.all([
                apiRequest('/categories'),
                apiRequest('/brands'),
                apiRequest('/sizes'),
                apiRequest('/colors')
            ]);

            this.categories = categoriesData.categories || [];
            this.brands = brandsData.brands || [];
            this.sizes = sizesData.sizes || [];
            this.colors = colorsData.colors || [];

            referencesLoaded = true;
            console.log(' Справочники загружены');

            // Заполняем селекты
            this.fillAllSelects();

        } catch (error) {
            console.error(' Ошибка загрузки справочников:', error);
        }
    },

    // ЗАПОЛНЕНИЕ ВСЕХ СЕЛЕКТОВ
    fillAllSelects() {
        this.fillCategorySelect(this.categories);
        this.fillBrandSelect(this.brands);
        this.fillSizeSelect(this.sizes);
        this.fillColorSelect(this.colors);
        this.fillParentCategorySelect(this.categories);
    },

    fillCategorySelect(categories, targetSelect = null) {
        const select = targetSelect || document.querySelector('select[name="category_id"]');
        if (select) {
            select.innerHTML = '<option value="">Выберите категорию</option>' +
                categories.filter(cat => cat.is_active).map(cat =>
                    `<option value="${cat.category_id}">${cat.name}</option>`
                ).join('');
        }
    },

    fillBrandSelect(brands, targetSelect = null) {
        const select = targetSelect || document.querySelector('select[name="brand_id"]');
        if (select) {
            select.innerHTML = '<option value="">Выберите бренд</option>' +
                brands.filter(brand => brand.is_active).map(brand =>
                    `<option value="${brand.brand_id}">${brand.name}</option>`
                ).join('');
        }
    },

    fillSizeSelect(sizes, targetSelect = null) {
        const select = targetSelect || document.querySelector('select[name="default_size_id"]');
        if (select) {
            select.innerHTML = '<option value="">Выберите размер</option>' +
                sizes.filter(size => size.is_active !== false).map(size =>
                    `<option value="${size.size_id}">${size.size_value} ${size.description ? `- ${size.description}` : ''} ${size.size_type ? `(${size.size_type})` : ''}</option>`
                ).join('');
        }
    },

    fillColorSelect(colors, targetSelect = null) {
        const select = targetSelect || document.querySelector('select[name="default_color_id"]');
        if (select) {
            select.innerHTML = '<option value="">Выберите цвет</option>' +
                colors.filter(color => color.is_active).map(color =>
                    `<option value="${color.color_id}">${color.name} ${color.hex_code ? `<span style="color:${color.hex_code}">■</span> (${color.hex_code})` : ''}</option>`
                ).join('');
        }
    },

    fillParentCategorySelect(categories) {
        const select = document.querySelector('select[name="parent_id"]');
        if (select) {
            select.innerHTML = '<option value="">Без родительской категории</option>' +
                categories.filter(cat => cat.is_active).map(cat =>
                    `<option value="${cat.category_id}">${cat.name}</option>`
                ).join('');
        }
    },
    showTab(tabName) {
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

        const targetTab = document.getElementById(tabName);
        if (targetTab) targetTab.classList.add('active');

        const menuItem = document.querySelector(`[data-tab="${tabName}"]`);
        if (menuItem) menuItem.classList.add('active');

        const titles = {
            dashboard: 'Дашборд',
            products: 'Товары',
            orders: 'Заказы',
            customers: 'Клиенты',
            staff: 'Персонал',
            shipments: 'Доставки',
            categories: 'Категории'
        };
        document.getElementById('page-title').textContent = titles[tabName] || tabName;

        this.loadTabData(tabName);
    },

    async loadTabData(tabName) {
        try {
            switch (tabName) {
                case 'dashboard':
                    await this.loadDashboard();
                    break;
                case 'customers':
                    await this.loadCustomers();
                    break;
                case 'staff':
                    await this.loadStaff();
                    break;
                case 'products':
                    await this.loadProducts();
                    break;
                case 'orders':
                    await this.loadOrders();
                    break;
                case 'shipments':
                    await this.loadShipments();
                    break;
                case 'categories':
                    await this.loadCategories();
                    break;
            }
        } catch (error) {
            this.showError(`Ошибка загрузки: ${error.message}`);
        }
    },

    async loadDashboard() {
        try {
            const data = await apiRequest('/dashboard/stats');
            this.updateDashboard(data);
        } catch (error) {
            this.showError('Ошибка загрузки статистики');
        }
    },

    updateDashboard(stats) {
        document.getElementById('totalOrders').textContent = stats.orders.toLocaleString();
        document.getElementById('totalRevenue').textContent = `₽${stats.revenue.toLocaleString()}`;
        document.getElementById('totalProducts').textContent = stats.products.toLocaleString();
        document.getElementById('totalCustomers').textContent = stats.customers.toLocaleString();

        this.renderLowStockTable(stats.lowStock);
        this.renderRecentOrders(stats.recentOrders);
    },

    renderLowStockTable(products) {
        const tbody = document.getElementById('lowStockTableBody');
        if (!tbody) return;

        if (products.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Нет товаров с низким остатком</td></tr>';
            return;
        }

        tbody.innerHTML = products.map(product => `
            <tr>
                <td>${product.name}</td>
                <td>${product.sku}</td>
                <td>${product.stock_quantity} шт</td>
                <td><span class="status status-pending">Мало</span></td>
            </tr>
        `).join('');
    },

    renderRecentOrders(orders) {
        const tbody = document.getElementById('recentOrdersTableBody');
        if (!tbody) return;

        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Нет заказов</td></tr>';
            return;
        }

        tbody.innerHTML = orders.map(order => `
            <tr>
                <td>${order.order_number}</td>
                <td>${order.customer_name}</td>
                <td>${utils.formatDate(order.order_date)}</td>
                <td>₽${order.final_amount}</td>
                <td><span class="status status-${order.status}">${this.getOrderStatusText(order.status)}</span></td>
            </tr>
        `).join('');
    },

    async loadProducts(search = '') {
        try {
            const data = await apiRequest(`/products?search=${encodeURIComponent(search)}`);
            this.renderProductsTable(data.products);
        } catch (error) {
            this.showError('Ошибка загрузки товаров');
        }
    },

    renderProductsTable(products) {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    if (products.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">
                    <div>🛍️</div>
                    <p>Товары не найдены</p>
                    <button class="btn btn-primary btn-sm" onclick="showModal('addProductModal')">
                        Добавить первый товар
                    </button>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = products.map(product => {
        // Формируем правильный URL для изображения
        let imageUrl = product.main_image_url;
        
        // Если это локальный путь (начинается с /uploads), добавляем базовый URL
        if (imageUrl && imageUrl.startsWith('/uploads/')) {
            imageUrl = `${window.location.origin}${imageUrl}`;
        }
        
        // Если URL невалидный или пустой, показываем заглушку
        const imageHtml = imageUrl ? 
            `<img src="${imageUrl}" 
                  alt="${product.name}" 
                  class="product-image"
                  onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjRjhGOUZBIi8+CjxwYXRoIGQ9Ik0zMCAyMEgzMlYyNkgzMFYyMFpNMzAgMjhIMzJWMzRIMzBWMjhaTTE2IDIwSDE4VjI2SDE2VjIwWk0xNiAyOEgxOFYzNEgxNlYyOFpNMjMgMTZIMjdWMThIMjNWMTZaTTIzIDM2SDI3VjM4SDIzVjM2WiIgZmlsbD0iIzlBOEE5QSIvPgo8L3N2Zz4K'; this.alt='Ошибка загрузки изображения';">` :
            `<div class="no-image-placeholder">🖼️</div>`;

        return `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; justify-content: center; width: 60px; height: 60px;">
                        ${imageHtml}
                    </div>
                </td>
                <td><strong>${product.sku}</strong></td>
                <td>
                    <div class="product-name">${product.name}</div>
                    ${product.description ? `<small class="text-muted">${product.description.substring(0, 50)}...</small>` : ''}
                </td>
                <td>${product.category_name || '-'}</td>
                <td>${product.brand_name || '-'}</td>
                <td><strong>₽${parseFloat(product.base_price).toFixed(2)}</strong></td>
                <td>
                    <input type="number" 
                           value="${product.total_stock || 0}" 
                           onchange="actions.updateProductStock('${product.product_id}', this.value)"
                           onkeypress="if(event.key==='Enter') { actions.updateProductStock('${product.product_id}', this.value); this.blur(); }"
                           class="stock-input"
                           min="0"
                           style="width: 80px; padding: 6px 8px; border: 2px solid #e1e8ed; border-radius: 4px; text-align: center;">
                </td>
                <td>
                    <span class="status status-${product.is_active ? 'active' : 'inactive'}">
                        ${product.is_active ? 'Активен' : 'Неактивен'}
                    </span>
                </td>
                <td class="action-buttons">
                    <button class="btn btn-primary btn-sm" onclick="actions.editProduct('${product.product_id}')">✏️</button>
                    <button class="btn btn-info btn-sm" onclick="actions.showProductVariants('${product.product_id}')">📦</button>
                    <button class="btn btn-danger btn-sm" onclick="actions.deleteProduct('${product.product_id}')">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
},

    async loadOrders(status = 'all') {
        try {
            const data = await apiRequest(`/orders?status=${status}`);
            this.renderOrdersTable(data.data.orders);
        } catch (error) {
            this.showError('Ошибка загрузки заказов');
        }
    },

    renderOrdersTable(orders) {
        const tbody = document.getElementById('ordersTableBody');
        if (!tbody) return;

        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Заказы не найдены</td></tr>';
            return;
        }

        tbody.innerHTML = orders.map(order => `
        <tr>
            <td><strong>${order.order_number}</strong></td>
            <td>${order.customer_name}</td>
            <td>${utils.formatDate(order.order_date)}</td>
            <td>₽${order.final_amount}</td>
            <td>
                <span class="status status-${order.payment_status === 'paid' ? 'paid' : 'unpaid'}">
                    ${order.payment_status === 'paid' ? 'Оплачен' : 'Не оплачен'}
                </span>
            </td>
            <td>
                <span class="status status-${order.status}">
                    ${this.getOrderStatusText(order.status)}
                </span>
            </td>
            <td>${order.payment_method || '-'}</td>
            <td class="action-buttons">
                <button class="btn btn-primary btn-sm" onclick="actions.viewOrder('${order.order_id}')">👁️</button>
                ${currentUser && ['admin', 'manager'].includes(currentUser.user_role) ? `
                    <select onchange="actions.updateOrderStatus('${order.order_id}', this.value)" class="status-select">
                        <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Ожидает</option>
                        <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>В обработке</option>
                        <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Завершен</option>
                        <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Доставлен</option>
                        <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Отменен</option>
                    </select>
                ` : ''}
            </td>
        </tr>
    `).join('');
    },

    async loadCustomers() {
        try {
            const data = await apiRequest('/customers');
            // УБИРАЕМ appState, используем this для рендеринга
            console.log(' Customers loaded:', data.customers ? data.customers.length : 0);
            this.renderCustomersTable(data.customers || []);
        } catch (error) {
            console.error(' Error loading customers:', error);
            this.renderCustomersTable([]);
        }
    },
    async loadStaff() {
        try {
            const data = await apiRequest('/staff'); //  Правильный путь
            this.renderStaffTable(data.staff);
        } catch (error) {
            this.showError('Ошибка загрузки персонала');
        }
    },

    renderCustomersTable(customers) {
        const tbody = document.getElementById('customersTableBody');
        if (!tbody) return;

        if (customers.length === 0) {
            tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div>👥</div>
                    <p>Клиенты не найдены</p>
                    <button class="btn btn-primary btn-sm" onclick="ui.showAddUserModal('customer')">
                        Добавить первого клиента
                    </button>
                </td>
            </tr>
        `;
            return;
        }

        tbody.innerHTML = customers.map(customer => `
        <tr>
            <td>
                <strong>${customer.last_name} ${customer.first_name} ${customer.middle_name || ''}</strong>
            </td>
            <td>${customer.email}</td>
            <td>${customer.phone || '-'}</td>
            <td>${utils.formatDate(customer.created_at)}</td>
            <td>
                <span class="status status-${customer.is_active ? 'active' : 'inactive'}">
                    ${customer.is_active ? 'Активен' : 'Неактивен'}
                </span>
            </td>
            <td class="action-buttons">
                <button class="btn btn-primary btn-sm" onclick="actions.editCustomer('${customer.user_id}')">✏️</button>
                <button class="btn btn-info btn-sm" onclick="actions.viewCustomerOrders('${customer.user_id}')">📦</button>
                <button class="btn btn-danger btn-sm" onclick="actions.deleteCustomer('${customer.user_id}')">🗑️</button>
            </td>
        </tr>
    `).join('');
    },

    renderStaffTable(staff) {
        const tbody = document.getElementById('staffTableBody');
        if (!tbody) return;

        if (staff.length === 0) {
            tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <div>👔</div>
                    <p>Сотрудники не найдены</p>
                    <button class="btn btn-primary btn-sm" onclick="ui.showAddUserModal('manager')">
                        Добавить первого сотрудника
                    </button>
                </td>
            </tr>
        `;
            return;
        }

        tbody.innerHTML = staff.map(employee => `
        <tr>
            <td>
                <strong>${employee.last_name} ${employee.first_name} ${employee.middle_name || ''}</strong>
            </td>
            <td>${employee.email}</td>
            <td>${employee.position || '-'}</td>
            <td>${employee.department || '-'}</td>
            <td>${this.getRoleName(employee.user_role)}</td>
            <td>${employee.hire_date ? utils.formatDate(employee.hire_date) : '-'}</td>
            <td>
                <span class="status status-${employee.is_active ? 'active' : 'inactive'}">
                    ${employee.is_active ? 'Активен' : 'Неактивен'}
                </span>
            </td>
            <td class="action-buttons">
                <button class="btn btn-primary btn-sm" onclick="actions.editStaff('${employee.user_id}')">✏️</button>
                ${employee.email !== currentUser.email ?
                `<button class="btn btn-danger btn-sm" onclick="actions.deleteStaff('${employee.user_id}')">🗑️</button>` :
                '<button class="btn btn-secondary btn-sm" disabled title="Нельзя удалить свой аккаунт">🗑️</button>'
            }
            </td>
        </tr>
    `).join('');
    },

    async loadShipments() {
        try {
            const data = await apiRequest('/shipments');
            this.shipments = data.shipments || [];
            this.renderShipmentsTable(this.shipments);
        } catch (error) {
            this.showError('Ошибка загрузки доставок');
        }
    },

    renderShipmentsTable(shipments) {
        const tbody = document.getElementById('shipmentsTableBody');
        if (!tbody) return;

        if (shipments.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <div>🚚</div>
                        <p>Нет данных о доставках</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = shipments.map(shipment => `
            <tr data-shipment-id="${shipment.shipment_id}">
                <td><strong>${shipment.order_number || 'N/A'}</strong></td>
                <td class="tracking-number">${shipment.tracking_number || 'Не указан'}</td>
                <td>${shipment.courier_name || 'Не назначен'}</td>
                <td>${shipment.carrier || 'Не указан'}</td>
                <td>${shipment.shipment_date ? utils.formatDate(shipment.shipment_date) : '-'}</td>
                <td>${shipment.estimated_delivery ? utils.formatDate(shipment.estimated_delivery) : '-'}</td>
                <td>₽${shipment.shipping_cost || '0'}</td>
                <td>
                    <span class="status status-${shipment.status}">
                        ${this.getShipmentStatusText(shipment.status)}
                    </span>
                </td>
                <td class="action-buttons">
                    <button class="btn btn-primary btn-sm" onclick="actions.viewShipment('${shipment.shipment_id}')">👁️</button>
                    <select onchange="actions.updateShipmentStatus('${shipment.shipment_id}', this.value)" class="status-select">
                        <option value="pending" ${shipment.status === 'pending' ? 'selected' : ''}>Ожидает</option>
                        <option value="in_transit" ${shipment.status === 'in_transit' ? 'selected' : ''}>В пути</option>
                        <option value="out_for_delivery" ${shipment.status === 'out_for_delivery' ? 'selected' : ''}>У курьера</option>
                        <option value="delivered" ${shipment.status === 'delivered' ? 'selected' : ''}>Доставлен</option>
                        <option value="cancelled" ${shipment.status === 'cancelled' ? 'selected' : ''}>Отменен</option>
                    </select>
                </td>
            </tr>
        `).join('');
    },

    async loadCategories() {
        try {
            const [categoriesData, brandsData] = await Promise.all([
                apiRequest('/categories'),
                apiRequest('/brands')
            ]);

            this.renderCategoriesTable(categoriesData.categories);
            this.renderBrandsTable(brandsData.brands);

        } catch (error) {
            this.showError('Ошибка загрузки категорий и брендов');
        }
    },

    renderCategoriesTable(categories) {
        const tbody = document.getElementById('categoriesTableBody');
        if (!tbody) return;

        if (categories.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">
                        <div>📁</div>
                        <p>Категории не найдены</p>
                        <button class="btn btn-primary btn-sm" onclick="showModal('addCategoryModal')">
                            Добавить первую категорию
                        </button>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = categories.map(cat => `
            <tr>
                <td>
                    <strong>${cat.name}</strong>
                    ${cat.image_url ? `<br><img src="${cat.image_url}" alt="${cat.name}" class="product-image">` : ''}
                </td>
                <td>${cat.description || '-'}</td>
                <td>${cat.parent_name || '-'}</td>
                <td>
                    <span class="status status-${cat.is_active ? 'active' : 'inactive'}">
                        ${cat.is_active ? 'Активна' : 'Неактивна'}
                    </span>
                </td>
                <td class="action-buttons">
                    <button class="btn btn-primary btn-sm" onclick="actions.editCategory('${cat.category_id}')">✏️</button>
                    <button class="btn btn-danger btn-sm" onclick="actions.deleteCategory('${cat.category_id}')">🗑️</button>
                </td>
            </tr>
        `).join('');
    },

    renderBrandsTable(brands) {
        const tbody = document.getElementById('brandsTableBody');
        if (!tbody) return;

        if (brands.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">
                        <div>🏷️</div>
                        <p>Бренды не найдены</p>
                        <button class="btn btn-primary btn-sm" onclick="showModal('addBrandModal')">
                            Добавить первый бренд
                        </button>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = brands.map(brand => `
            <tr>
                <td>
                    <strong>${brand.name}</strong>
                    ${brand.logo_url ? `<br><img src="${brand.logo_url}" alt="${brand.name}" class="product-image">` : ''}
                </td>
                <td>${brand.description || '-'}</td>
                <td>${brand.website ? `<a href="${brand.website}" target="_blank">${brand.website}</a>` : '-'}</td>
                <td>
                    <span class="status status-${brand.is_active ? 'active' : 'inactive'}">
                        ${brand.is_active ? 'Активен' : 'Неактивен'}
                    </span>
                </td>
                <td class="action-buttons">
                    <button class="btn btn-primary btn-sm" onclick="actions.editBrand('${brand.brand_id}')">✏️</button>
                    <button class="btn btn-danger btn-sm" onclick="actions.deleteBrand('${brand.brand_id}')">🗑️</button>
                </td>
            </tr>
        `).join('');
    },

    getOrderStatusText(status) {
        const statusMap = {
            'pending': 'Ожидает', 'processing': 'В обработке', 'completed': 'Завершен',
            'delivered': 'Доставлен', 'cancelled': 'Отменен'
        };
        return statusMap[status] || status;
    },

    getShipmentStatusText(status) {
        const statusMap = {
            'pending': 'Ожидает', 'in_transit': 'В пути', 'out_for_delivery': 'У курьера',
            'delivered': 'Доставлен', 'cancelled': 'Отменен'
        };
        return statusMap[status] || status;
    },

    getRoleName(role) {
        const roles = {
            'admin': 'Администратор', 'manager': 'Менеджер', 'courier': 'Курьер',
            'content': 'Контент-менеджер', 'customer': 'Клиент'
        };
        return roles[role] || role;
    },

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden';

            // Заполняем селекты при открытии модального окна
            if (referencesLoaded) {
                this.fillAllSelects();
            }

            // Прокручиваем модальное окно в начало
            setTimeout(() => {
                const modalBody = modal.querySelector('.modal-body');
                if (modalBody) {
                    modalBody.scrollTop = 0;
                }
            }, 50);
        }
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';

            if (modalId === 'editProductModal') {
                currentEditingProductId = null;
            }
        }
    },

    showAddUserModal(userType = 'customer') {
        const modal = document.getElementById('addUserModal');
        const title = document.getElementById('userModalTitle');
        const roleSelect = document.getElementById('userRoleSelect');

        if (title) {
            title.textContent = userType === 'customer' ? 'Добавить клиента' : 'Добавить сотрудника';
        }

        if (roleSelect && userType !== 'customer') {
            roleSelect.value = userType;
            this.toggleStaffFields();
        }

        this.showModal('addUserModal');
    },

    toggleStaffFields() {
        const roleSelect = document.getElementById('userRoleSelect');
        const staffFields = document.getElementById('staffFields');
        const customerRoles = ['customer'];

        if (roleSelect && staffFields) {
            if (customerRoles.includes(roleSelect.value)) {
                staffFields.style.display = 'none';
            } else {
                staffFields.style.display = 'block';
            }
        }
    },

    showError(message) {
        alert(` ${message}`);
    },

    showSuccess(message) {
        alert(` ${message}`);
    },

    previewImage(input) {
        const preview = document.getElementById('imagePreview');
        const file = input.files[0];

        if (file) {
            const reader = new FileReader();
            reader.onload = function (e) {
                preview.innerHTML = `<img src="${e.target.result}" alt="Preview" style="max-width: 200px; max-height: 200px; border-radius: 4px;">`;
            }
            reader.readAsDataURL(file);
        } else {
            preview.innerHTML = '🖼️ Предпросмотр';
        }
    },

    toggleEditStaffFields() {
        const roleSelect = document.getElementById('editUserRoleSelect');
        const staffFields = document.getElementById('editStaffFields');
        const customerRoles = ['customer'];

        if (roleSelect && staffFields) {
            if (customerRoles.includes(roleSelect.value)) {
                staffFields.style.display = 'none';
            } else {
                staffFields.style.display = 'block';
            }
        }
    },
};

// Действия
const actions = {
    async login(event) {
        event.preventDefault();

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const submitBtn = event.target.querySelector('button[type="submit"]');

        if (!email || !password) {
            document.getElementById('loginError').textContent = 'Заполните все поля';
            document.getElementById('loginError').style.display = 'block';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Вход...';

        try {
            const data = await apiRequest('/auth/login', {
                method: 'POST',
                body: { email, password }
            });

            authToken = data.token;
            currentUser = data.user;

            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));

            ui.showAdminPanel();
            await ui.loadDashboard();

        } catch (error) {
            document.getElementById('loginError').textContent = error.message;
            document.getElementById('loginError').style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Войти';
        }
    },

    logout() {
        if (confirm('Вы уверены, что хотите выйти?')) {
            currentUser = null;
            authToken = null;
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
            ui.showLoginPage();
        }
    },

    //  РЕДАКТИРОВАНИЕ ТОВАРА
    async editProduct(productId) {
        try {
            const data = await apiRequest(`/products/${productId}`);
            this.showEditProductModal(data.product);
        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ТОВАРА
    showEditProductModal(product) {
        const modal = document.getElementById('editProductModal');
        const form = document.getElementById('editProductForm');

        if (!form) return;

        // Сохраняем ID редактируемого товара
        currentEditingProductId = product.product_id;

        // Заполняем форму данными
        form.querySelector('[name="productId"]').value = product.product_id;
        form.querySelector('[name="sku"]').value = product.sku;
        form.querySelector('[name="name"]').value = product.name;
        form.querySelector('[name="description"]').value = product.description || '';
        form.querySelector('[name="short_description"]').value = product.short_description || '';

        // Устанавливаем категорию и бренд
        setTimeout(() => {
            if (product.category_id) {
                const categorySelect = form.querySelector('[name="category_id"]');
                if (categorySelect) categorySelect.value = product.category_id;
            }
            if (product.brand_id) {
                const brandSelect = form.querySelector('[name="brand_id"]');
                if (brandSelect) brandSelect.value = product.brand_id;
            }

            // Заполняем размеры и цвета
            ui.fillSizeSelect(ui.sizes, form.querySelector('[name="default_size_id"]'));
            ui.fillColorSelect(ui.colors, form.querySelector('[name="default_color_id"]'));

            // Показываем существующие вариации
            actions.loadExistingVariants(product.product_id);
        }, 100);

        form.querySelector('[name="base_price"]').value = product.base_price;
        form.querySelector('[name="old_price"]').value = product.old_price || '';
        form.querySelector('[name="gender"]').value = product.gender || '';
        form.querySelector('[name="material"]').value = product.material || '';
        form.querySelector('[name="care_instructions"]').value = product.care_instructions || '';
        form.querySelector('[name="season"]').value = product.season || '';
        form.querySelector('[name="weight_grams"]').value = product.weight_grams || '';
        form.querySelector('[name="dimensions"]').value = product.dimensions || '';
        form.querySelector('[name="main_image_url"]').value = product.main_image_url || '';

        // Обрабатываем массивы изображений и тегов
        const imageUrls = product.image_urls ? (Array.isArray(product.image_urls) ? product.image_urls : JSON.parse(product.image_urls)) : [];
        form.querySelector('[name="image_urls"]').value = imageUrls.join('\n');

        const tags = product.tags ? (Array.isArray(product.tags) ? product.tags : JSON.parse(product.tags)) : [];
        form.querySelector('[name="tags"]').value = tags.join(', ');

        form.querySelector('[name="is_active"]').checked = product.is_active;
        form.querySelector('[name="is_featured"]').checked = product.is_featured;

        ui.showModal('editProductModal');
    },
    //  ЗАГРУЗКА СУЩЕСТВУЮЩИХ ВАРИАЦИЙ ТОВАРА
    async loadExistingVariants(productId) {
        try {
            const data = await apiRequest(`/products/${productId}`);
            const variants = data.product.variants || [];

            const variantsList = document.getElementById('existingVariantsList');
            if (variantsList) {
                if (variants.length > 0) {
                    variantsList.innerHTML = variants.map(variant => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #eee;">
                        <div>
                            <strong>${variant.size_value || 'Без размера'} / ${variant.color_name || 'Без цвета'}</strong>
                            <br>
                            <small>SKU: ${variant.sku} | Остаток: ${variant.stock_quantity} | ₽${(parseFloat(data.product.base_price) + parseFloat(variant.price_adjustment || 0)).toFixed(2)}</small>
                        </div>
                        <div>
                            <span class="status status-${variant.is_active ? 'active' : 'inactive'}">
                                ${variant.is_active ? 'Активна' : 'Неактивна'}
                            </span>
                        </div>
                    </div>
                `).join('');
                } else {
                    variantsList.innerHTML = '<p style="color: #666; text-align: center;">Нет созданных вариаций</p>';
                }
            }
        } catch (error) {
            console.error('Error loading variants:', error);
        }
    },

    //  ПОКАЗ МОДАЛЬНОГО ОКНА ДОБАВЛЕНИЯ РАЗМЕРА (ОБНОВЛЕННАЯ)
    showAddSizeModal(context = 'add') {
        const form = document.getElementById('addSizeForm');
        if (form) {
            form.reset();
            form.querySelector('[name="sort_order"]').value = (ui.sizes?.length || 0) + 1;
            // Сохраняем контекст для автоматического выбора после создания
            form.dataset.context = context;
        }
        ui.showModal('addSizeModal');
    },

    //  ПОКАЗ МОДАЛЬНОГО ОКНА ДОБАВЛЕНИЯ ЦВЕТА (ОБНОВЛЕННАЯ)
    showAddColorModal(context = 'add') {
        const form = document.getElementById('addColorForm');
        if (form) {
            form.reset();
            form.querySelector('[name="sort_order"]').value = (ui.colors?.length || 0) + 1;
            form.querySelector('[name="is_active"]').checked = true;
            // Сохраняем контекст для автоматического выбора после создания
            form.dataset.context = context;
        }
        ui.showModal('addColorModal');
    },

    //  СОЗДАНИЕ НОВОГО РАЗМЕРА (ОБНОВЛЕННАЯ)
    async createSize(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);
        const context = form.dataset.context || 'add';

        const sizeData = {
            size_value: formData.get('size_value'),
            size_type: formData.get('size_type'),
            description: formData.get('description'),
            sort_order: parseInt(formData.get('sort_order')) || 0
        };

        try {
            const result = await apiRequest('/sizes', {
                method: 'POST',
                body: sizeData
            });

            // Обновляем список размеров
            await ui.loadAllReferences();

            // Автоматически выбираем новый размер в нужной форме
            let sizeSelect;
            if (context === 'edit') {
                sizeSelect = document.querySelector('#editProductModal select[name="default_size_id"]');
            } else {
                sizeSelect = document.querySelector('#addProductModal select[name="default_size_id"]');
            }

            if (sizeSelect && result.size) {
                sizeSelect.value = result.size.size_id;
            }

            ui.closeModal('addSizeModal');

        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  СОЗДАНИЕ НОВОГО ЦВЕТА (ОБНОВЛЕННАЯ)
    async createColor(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);
        const context = form.dataset.context || 'add';

        const colorData = {
            name: formData.get('name'),
            hex_code: formData.get('hex_code'),
            sort_order: parseInt(formData.get('sort_order')) || 0,
            is_active: formData.has('is_active')
        };

        // Если HEX код не указан, генерируем случайный
        if (!colorData.hex_code) {
            const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).toUpperCase();
            colorData.hex_code = randomColor;
        }

        try {
            const result = await apiRequest('/colors', {
                method: 'POST',
                body: colorData
            });

            // Обновляем список цветов
            await ui.loadAllReferences();

            // Автоматически выбираем новый цвет в нужной форме
            let colorSelect;
            if (context === 'edit') {
                colorSelect = document.querySelector('#editProductModal select[name="default_color_id"]');
            } else {
                colorSelect = document.querySelector('#addProductModal select[name="default_color_id"]');
            }

            if (colorSelect && result.color) {
                colorSelect.value = result.color.color_id;
            }

            ui.closeModal('addColorModal');

        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  ДОБАВЛЕНИЕ НОВОЙ ВАРИАЦИИ ПРИ РЕДАКТИРОВАНИИ
    async addVariantToProduct(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);

        const variantData = {
            size_id: formData.get('size_id'),
            color_id: formData.get('color_id'),
            sku: formData.get('variant_sku'),
            stock_quantity: parseInt(formData.get('stock_quantity')) || 0,
            min_stock_level: Number(formData.get('min_stock_level')),
            price_adjustment: parseFloat(formData.get('price_adjustment')) || 0
        };

        try {
            await apiRequest(`/products/${currentEditingProductId}/variants`, {
                method: 'POST',
                body: variantData
            });

            ui.closeModal('addVariantModal');

            await this.showProductVariants(currentEditingProductId);
            await ui.loadProducts();

        } catch (error) {
            ui.showError(error.message);
        }
    },
    async showAddVariantModal(productId) {
        currentEditingProductId = productId;
        if (!referencesLoaded) await ui.loadAllReferences();
        const form = document.getElementById('addVariantForm');
        form.reset();
        ui.fillSizeSelect(ui.sizes || [], form.elements.size_id);
        ui.fillColorSelect(ui.colors || [], form.elements.color_id);
        ui.showModal('addVariantModal');
    },

    async editVariant(productId, variantId) {
        try {
            const { product } = await apiRequest(`/products/${productId}`);
            const variant = product.variants.find(v => String(v.variant_id) === String(variantId));
            if (!variant) throw new Error('Вариация не найдена');
            if (!referencesLoaded) await ui.loadAllReferences();
            const form = document.getElementById('editVariantForm');
            form.dataset.productId = productId; form.dataset.variantId = variantId;
            ui.fillSizeSelect(ui.sizes || [], form.elements.size_id); ui.fillColorSelect(ui.colors || [], form.elements.color_id);
            for (const key of ['sku', 'size_id', 'color_id', 'price_adjustment', 'stock_quantity', 'min_stock_level']) form.elements[key].value = variant[key] ?? '';
            form.elements.is_active.checked = variant.is_active;
            ui.showModal('editVariantModal');
        } catch (error) { ui.showError(error.message); }
    },
    async saveVariant(event) {
        event.preventDefault(); const form = event.target; const values = new FormData(form);
        const body = Object.fromEntries(['sku', 'size_id', 'color_id', 'price_adjustment', 'stock_quantity', 'min_stock_level'].map(key => [key, values.get(key)]));
        body.is_active = form.elements.is_active.checked;
        try { await apiRequest(`/products/${form.dataset.productId}/variants/${form.dataset.variantId}`, { method: 'PUT', body }); ui.closeModal('editVariantModal'); await this.showProductVariants(form.dataset.productId); await ui.loadProducts(); } catch (error) { ui.showError(error.message); }
    },
    async deleteVariant(productId, variantId) {
        if (!confirm('Удалить вариацию?')) return;
        try { await apiRequest(`/products/${productId}/variants/${variantId}`, { method: 'DELETE' }); await this.showProductVariants(productId); await ui.loadProducts(); } catch (error) { ui.showError(error.message); }
    },

    //  УПРАВЛЕНИЕ ВАРИАЦИЯМИ ТОВАРА
    async showProductVariants(productId) {
        try {
            const data = await apiRequest(`/products/${productId}`);
            this.showVariantsModal(data.product);
        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  МОДАЛЬНОЕ ОКНО ВАРИАЦИЙ
    showVariantsModal(product) {
        const modal = document.getElementById('variantsModal');
        const content = document.getElementById('variantsContent');

        if (!content) return;

        content.innerHTML = `
        <div class="variants-header">
            <h3>📦 Вариации товара: ${product.name}</h3>
            <p class="product-sku">SKU: ${product.sku}</p>
        </div>

        <div class="variants-actions">
            <button class="btn btn-primary btn-sm" onclick="actions.showAddVariantModal('${product.product_id}')">
                ➕ Добавить вариацию
            </button>
        </div>

        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Размер</th>
                        <th>Цвет</th>
                        <th>SKU вариации</th>
                        <th>Цена</th>
                        <th>В наличии</th>
                        <th>Зарезервировано</th>
                        <th>Статус</th><th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${product.variants && product.variants.length > 0 ?
                product.variants.map(variant => `
                            <tr>
                                <td>${variant.size_value || '-'}</td>
                                <td>
                                    ${variant.color_name || '-'}
                                    ${variant.hex_code ? `<span class="color-badge" style="background-color: ${variant.hex_code}"></span>` : ''}
                                </td>
                                <td><strong>${variant.sku}</strong></td>
                                <td>₽${(parseFloat(product.base_price) + parseFloat(variant.price_adjustment || 0)).toFixed(2)}</td>
                                <td>${variant.stock_quantity}</td>
                                <td>${variant.reserved_quantity}</td>
                                <td>
                                    <span class="status status-${variant.is_active ? 'active' : 'inactive'}">
                                        ${variant.is_active ? 'Активна' : 'Неактивна'}
                                    </span>
                                </td>
                                <td><button class="btn btn-primary btn-sm" onclick="actions.editVariant('${product.product_id}', '${variant.variant_id}')">Изменить</button> <button class="btn btn-danger btn-sm" onclick="actions.deleteVariant('${product.product_id}', '${variant.variant_id}')">Удалить</button></td>
                            </tr>
                        `).join('') :
                '<tr><td colspan="8" class="empty-state">Нет вариаций</td></tr>'
            }
                </tbody>
            </table>
        </div>
    `;

        ui.showModal('variantsModal');
    },

    //  ОБНОВЛЕНИЕ ОСТАТКОВ ТОВАРА (С ДИАГНОСТИКОЙ)
    async updateProductStock(productId, newStock) {
        console.log('🔄 updateProductStock called:', productId, newStock);

        if (!newStock || newStock < 0) {
            ui.showError('Введите корректное количество');
            return;
        }

        try {
            const result = await apiRequest(`/products/${productId}/stock`, {
                method: 'PUT',
                body: { stock_quantity: parseInt(newStock) }
            });

            console.log(' Stock update successful:', result);

            // Перезагружаем таблицу через 1 секунду
            setTimeout(() => {
                ui.loadProducts();
            }, 1000);

        } catch (error) {
            console.error(' Stock update error:', error);
            ui.showError('Ошибка обновления остатков: ' + error.message);
        }
    },

    //  СОХРАНЕНИЕ ИЗМЕНЕНИЙ ТОВАРА
    async updateProduct(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);
        const productId = formData.get('productId');

        const productData = {
            sku: formData.get('sku'),
            name: formData.get('name'),
            description: formData.get('description'),
            short_description: formData.get('short_description'),
            category_id: formData.get('category_id'),
            brand_id: formData.get('brand_id'),
            base_price: parseFloat(formData.get('base_price')),
            old_price: formData.get('old_price') ? parseFloat(formData.get('old_price')) : null,
            gender: formData.get('gender'),
            material: formData.get('material'),
            care_instructions: formData.get('care_instructions'),
            season: formData.get('season'),
            weight_grams: formData.get('weight_grams') ? parseInt(formData.get('weight_grams')) : null,
            dimensions: formData.get('dimensions'),
            main_image_url: formData.get('main_image_url'),
            image_urls: formData.get('image_urls'),
            tags: formData.get('tags'),
            is_active: formData.has('is_active'),
            is_featured: formData.has('is_featured')
        };

        // Убираем пустые поля
        Object.keys(productData).forEach(key => {
            if (productData[key] === '' || productData[key] === null) {
                delete productData[key];
            }
        });

        try {
            await apiRequest(`/products/${productId}`, {
                method: 'PUT',
                body: productData
            });

            ui.closeModal('editProductModal');
            ui.loadProducts();

        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  РЕДАКТИРОВАНИЕ КАТЕГОРИИ
    async editCategory(categoryId) {
        try {
            const data = await apiRequest(`/categories/${categoryId}`);
            this.showEditCategoryModal(data.category);
        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ КАТЕГОРИИ
    showEditCategoryModal(category) {
        const modal = document.getElementById('editCategoryModal');
        const form = document.getElementById('editCategoryForm');

        if (!form) return;

        form.querySelector('[name="categoryId"]').value = category.category_id;
        form.querySelector('[name="name"]').value = category.name;
        form.querySelector('[name="description"]').value = category.description || '';

        // Устанавливаем родительскую категорию
        setTimeout(() => {
            if (category.parent_id) {
                form.querySelector('[name="parent_id"]').value = category.parent_id;
            }
        }, 100);

        form.querySelector('[name="image_url"]').value = category.image_url || '';
        form.querySelector('[name="sort_order"]').value = category.sort_order || 0;
        form.querySelector('[name="is_active"]').checked = category.is_active;

        ui.showModal('editCategoryModal');
    },

    //  СОХРАНЕНИЕ ИЗМЕНЕНИЙ КАТЕГОРИИ
    async updateCategory(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);
        const categoryId = formData.get('categoryId');

        const categoryData = {
            name: formData.get('name'),
            description: formData.get('description'),
            parent_id: formData.get('parent_id'),
            image_url: formData.get('image_url'),
            sort_order: parseInt(formData.get('sort_order')) || 0,
            is_active: formData.has('is_active')
        };

        // Убираем пустые поля
        Object.keys(categoryData).forEach(key => {
            if (categoryData[key] === '' || categoryData[key] === null) {
                delete categoryData[key];
            }
        });

        try {
            await apiRequest(`/categories/${categoryId}`, {
                method: 'PUT',
                body: categoryData
            });

            ui.closeModal('editCategoryModal');
            ui.loadCategories();

        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  РЕДАКТИРОВАНИЕ БРЕНДА
    async editBrand(brandId) {
        try {
            const data = await apiRequest(`/brands/${brandId}`);
            this.showEditBrandModal(data.brand);
        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ БРЕНДА
    showEditBrandModal(brand) {
        const modal = document.getElementById('editBrandModal');
        const form = document.getElementById('editBrandForm');

        if (!form) return;

        form.querySelector('[name="brandId"]').value = brand.brand_id;
        form.querySelector('[name="name"]').value = brand.name;
        form.querySelector('[name="description"]').value = brand.description || '';
        form.querySelector('[name="logo_url"]').value = brand.logo_url || '';
        form.querySelector('[name="website"]').value = brand.website || '';
        form.querySelector('[name="is_active"]').checked = brand.is_active;

        ui.showModal('editBrandModal');
    },

    //  СОХРАНЕНИЕ ИЗМЕНЕНИЙ БРЕНДА
    async updateBrand(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);
        const brandId = formData.get('brandId');

        const brandData = {
            name: formData.get('name'),
            description: formData.get('description'),
            logo_url: formData.get('logo_url'),
            website: formData.get('website'),
            is_active: formData.has('is_active')
        };

        // Убираем пустые поля
        Object.keys(brandData).forEach(key => {
            if (brandData[key] === '' || brandData[key] === null) {
                delete brandData[key];
            }
        });

        try {
            await apiRequest(`/brands/${brandId}`, {
                method: 'PUT',
                body: brandData
            });

            ui.closeModal('editBrandModal');
            ui.loadCategories();

        } catch (error) {
            ui.showError(error.message);
        }
    },

    async updateOrderStatus(orderId, status) {
        try {
            await apiRequest(`/orders/${orderId}/status`, {
                method: 'PUT',
                body: { status }
            });
            ui.loadOrders();
        } catch (error) {
            ui.showError(error.message);
        }
    },

    async updateShipmentStatus(shipmentId, status) {
        try {
            await apiRequest(`/shipments/${shipmentId}/status`, {
                method: 'PUT',
                body: { status }
            });
            ui.loadShipments();
        } catch (error) {
            ui.showError(error.message);
        }
    },

    viewShipment(shipmentId) {
        const shipment = (ui.shipments || []).find(item => String(item.shipment_id) === String(shipmentId));
        if (!shipment) return ui.showError('Доставка не найдена');
        const address = [shipment.delivery_city, shipment.delivery_street, shipment.delivery_house, shipment.delivery_apartment].filter(Boolean).join(', ');
        const fields = [
            ['Заказ', shipment.order_number], ['Трек-номер', shipment.tracking_number],
            ['Статус', ui.getShipmentStatusText(shipment.status)], ['Перевозчик', shipment.carrier],
            ['Курьер', shipment.courier_name], ['Получатель', shipment.delivery_recipient],
            ['Телефон', shipment.delivery_phone], ['Адрес', address],
            ['Стоимость', shipment.shipping_cost], ['Примечания курьера', shipment.courier_notes]
        ];
        const content = document.getElementById('shipmentDetailsContent');
        content.replaceChildren();
        fields.forEach(([label, value]) => {
            const row = document.createElement('p');
            const heading = document.createElement('strong');
            heading.textContent = label + ': ';
            row.append(heading, document.createTextNode(value == null || value === '' ? 'Не указано' : String(value)));
            content.appendChild(row);
        });
        ui.showModal('shipmentDetailsModal');
    },

    async deleteProduct(productId) {
        if (confirm('Вы уверены, что хотите удалить этот товар?')) {
            try {
                await apiRequest(`/products/${productId}`, {
                    method: 'DELETE'
                });
                ui.loadProducts();
            } catch (error) {
                ui.showError(error.message);
            }
        }
    },

    async deleteCustomer(userId) {
        if (confirm('Вы уверены, что хотите удалить этого клиента?')) {
            try {
                await apiRequest(`/users/${userId}`, {
                    method: 'DELETE'
                });
                ui.loadCustomers();
            } catch (error) {
                ui.showError(error.message);
            }
        }
    },

    async deleteStaff(userId) {
        if (confirm('Вы уверены, что хотите удалить этого сотрудника?')) {
            try {
                await apiRequest(`/users/${userId}`, {
                    method: 'DELETE'
                });
                ui.loadStaff();
            } catch (error) {
                ui.showError(error.message);
            }
        }
    },

    //  РЕДАКТИРОВАНИЕ КЛИЕНТА
    async editCustomer(userId) {
        try {
            const data = await apiRequest(`/users/${userId}`);
            this.showEditUserModal(data.user, 'customer');
        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  РЕДАКТИРОВАНИЕ СОТРУДНИКА  
    async editStaff(userId) {
        try {
            const data = await apiRequest(`/users/${userId}`);
            this.showEditUserModal(data.user, 'staff');
        } catch (error) {
            ui.showError(error.message);
        }
    },

    async createUser(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);

        const userData = {
            firstName: formData.get('firstName'),
            lastName: formData.get('lastName'),
            middleName: formData.get('middleName'),
            email: formData.get('email'),
            password: formData.get('password'),
            role: formData.get('role'),
            phone: formData.get('phone'),
            department: formData.get('department'),
            position: formData.get('position'),
            hire_date: formData.get('hire_date')
        };

        try {
            await apiRequest('/users', {
                method: 'POST',
                body: userData
            });

            ui.closeModal('addUserModal');
            form.reset();

            // Обновляем соответствующую таблицу
            if (userData.role === 'customer') {
                ui.loadCustomers();
            } else {
                ui.loadStaff();
            }

        } catch (error) {
            ui.showError(error.message);
        }
    },

async createProduct(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    // Диагностика - что в FormData
    console.log('📝 FormData содержимое:');
    for (let [key, value] of formData.entries()) {
        if (value instanceof File) {
            console.log(`  ${key}: File - ${value.name} (${value.type}, ${value.size} bytes)`);
        } else {
            console.log(`  ${key}: ${value}`);
        }
    }

    try {
        // Проверяем обязательные поля
        const sku = formData.get('sku');
        const name = formData.get('name');
        const base_price = formData.get('base_price');
        const category_id = formData.get('category_id');
        const brand_id = formData.get('brand_id');

        console.log('🔍 Обязательные поля:', { sku, name, base_price, category_id, brand_id });

        if (!sku || !name || !base_price || !category_id || !brand_id) {
            ui.showError('Заполните все обязательные поля: SKU, название, цена, категория, бренд');
            return;
        }

        // Отправляем FormData напрямую - НЕ создаем новый FormData
        const productResult = await apiRequest('/products', {
            method: 'POST',
            body: formData
        });

        const productId = productResult.product.product_id;

        // Создаем вариацию, если выбраны размер и цвет
        const defaultSizeId = formData.get('default_size_id');
        const defaultColorId = formData.get('default_color_id');
        const initialStock = parseInt(formData.get('initial_stock')) || 0;
        const minStockLevel = parseInt(formData.get('min_stock_level')) || 5;

        if (defaultSizeId && defaultColorId) {
            const variantSku = `${sku}-${Date.now()}`;

            await apiRequest(`/products/${productId}/variants`, {
                method: 'POST',
                body: {
                    size_id: defaultSizeId,
                    color_id: defaultColorId,
                    sku: variantSku,
                    stock_quantity: initialStock,
                    min_stock_level: minStockLevel,
                    is_default: true
                }
            });
        }

        ui.closeModal('addProductModal');
        form.reset();
        ui.loadProducts();

    } catch (error) {
        console.error(' Ошибка создания товара:', error);
        ui.showError(error.message);
    }
},

async createCategory(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    // Получаем parent_id и обрабатываем пустые значения
    let parent_id = formData.get('parent_id');
    
    // Преобразуем пустую строку в null
    if (parent_id === '' || parent_id === 'null' || parent_id === 'undefined') {
        parent_id = null;
    }

    const categoryData = {
        name: formData.get('name'),
        description: formData.get('description'),
        parent_id: parent_id, // Используем обработанное значение
        image_url: formData.get('image_url'),
        sort_order: parseInt(formData.get('sort_order')) || 0,
        is_active: formData.has('is_active')
    };

    console.log('📝 Создание категории:', categoryData);

    try {
        await apiRequest('/categories', {
            method: 'POST',
            body: categoryData
        });

        ui.closeModal('addCategoryModal');
        form.reset();
        ui.loadCategories();

    } catch (error) {
        console.error('❌ Ошибка создания категории:', error);
        ui.showError(error.message);
    }
},

    async createBrand(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);

        const brandData = {
            name: formData.get('name'),
            description: formData.get('description'),
            logo_url: formData.get('logo_url'),
            website: formData.get('website'),
            is_active: formData.has('is_active')
        };

        try {
            await apiRequest('/brands', {
                method: 'POST',
                body: brandData
            });

            ui.closeModal('addBrandModal');
            form.reset();
            ui.loadCategories();

        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  РЕДАКТИРОВАНИЕ ПОЛЬЗОВАТЕЛЯ
    async editUser(userId) {
        try {
            const data = await apiRequest(`/users/${userId}`);
            this.showEditUserModal(data.user);
        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ПОЛЬЗОВАТЕЛЯ
    showEditUserModal(user, userType = 'customer') {
        const modal = document.getElementById('editUserModal');
        const title = document.getElementById('editUserModalTitle');
        const form = document.getElementById('editUserForm');

        if (title) {
            title.textContent = userType === 'customer' ? 'Редактировать клиента' : 'Редактировать сотрудника';
        }

        // Заполняем форму данными
        form.querySelector('[name="userId"]').value = user.user_id;
        form.querySelector('[name="firstName"]').value = user.first_name;
        form.querySelector('[name="lastName"]').value = user.last_name;
        form.querySelector('[name="middleName"]').value = user.middle_name || '';
        form.querySelector('[name="email"]').value = user.email;
        form.querySelector('[name="phone"]').value = user.phone || '';
        form.querySelector('[name="role"]').value = user.user_role;
        form.querySelector('[name="is_active"]').checked = user.is_active;

        // Заполняем поля сотрудника если есть
        if (user.department || user.position) {
            form.querySelector('[name="department"]').value = user.department || '';
            form.querySelector('[name="position"]').value = user.position || '';
            if (user.hire_date) {
                form.querySelector('[name="hire_date"]').value = user.hire_date.split('T')[0];
            }
        }

        ui.toggleEditStaffFields();
        ui.showModal('editUserModal');
    },

    //  СОХРАНЕНИЕ ИЗМЕНЕНИЙ ПОЛЬЗОВАТЕЛЯ
    async updateUser(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);
        const userId = formData.get('userId');

        const userData = {
            firstName: formData.get('firstName'),
            lastName: formData.get('lastName'),
            middleName: formData.get('middleName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            role: formData.get('role'),
            is_active: formData.has('is_active'),
            department: formData.get('department'),
            position: formData.get('position'),
            hire_date: formData.get('hire_date')
        };

        // Убираем пустые поля
        Object.keys(userData).forEach(key => {
            if (userData[key] === '' || userData[key] === null) {
                delete userData[key];
            }
        });

        console.log('Sending user update:', userData);

        try {
            await apiRequest(`/users/${userId}`, {
                method: 'PUT',
                body: userData
            });

            ui.closeModal('editUserModal');

            // Обновляем соответствующую таблицу
            if (userData.role === 'customer') {
                ui.loadCustomers();
            } else {
                ui.loadStaff();
            }

        } catch (error) {
            console.error('Update user error:', error);
            ui.showError(error.message);
        }
    },

    //  ПРОСМОТР ДЕТАЛЕЙ ЗАКАЗА
    async viewOrder(orderId) {
        try {
            const data = await apiRequest(`/orders/${orderId}`);
            this.showOrderDetailsModal(data.data);
        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  МОДАЛЬНОЕ ОКНО ДЕТАЛЕЙ ЗАКАЗА
    showOrderDetailsModal(order) {
        const modal = document.getElementById('orderDetailsModal');
        const content = document.getElementById('orderDetailsContent');

        if (!content) return;

        content.innerHTML = `
            <div class="order-details">
                <div class="order-header">
                    <h3>Заказ #${order.order_number}</h3>
                    <p class="order-date">${utils.formatDate(order.order_date)}</p>
                </div>

                <div class="order-info-grid">
                    <div class="info-section">
                        <h4>Информация о клиенте</h4>
                        <p><strong>Имя:</strong> ${order.customer_name}</p>
                        <p><strong>Email:</strong> ${order.customer_email}</p>
                        <p><strong>Телефон:</strong> ${order.customer_phone || 'Не указан'}</p>
                    </div>

                    <div class="info-section">
                        <h4>Статусы</h4>
                        <p><strong>Статус заказа:</strong> 
                            <span class="status status-${order.status}">
                                ${ui.getOrderStatusText(order.status)}
                            </span>
                        </p>
                        <p><strong>Статус оплаты:</strong> 
                            <span class="status status-${order.payment_status === 'paid' ? 'paid' : 'unpaid'}">
                                ${order.payment_status === 'paid' ? 'Оплачен' : 'Не оплачен'}
                            </span>
                        </p>
                        <p><strong>Способ оплаты:</strong> ${order.payment_method || 'Не указан'}</p>
                    </div>

                    <div class="info-section">
                        <h4>Сумма и адрес</h4>
                        <p><strong>Итоговая сумма:</strong> ₽${order.final_amount}</p>
                        <p><strong>Адрес доставки:</strong> ${[order.shipping_city, order.shipping_street, order.shipping_house, order.shipping_apartment].filter(Boolean).join(', ') || 'Не указан'}</p>
                    </div>
                </div>

                ${order.customer_notes ? `
                    <div class="info-section">
                        <h4>Примечания клиента</h4>
                        <p>${order.customer_notes}</p>
                    </div>
                ` : ''}

                <div class="order-items">
                    <h4>Товары в заказе</h4>
                    <table class="items-table">
                        <thead>
                            <tr>
                                <th>Товар</th>
                                <th>Цена</th>
                                <th>Количество</th>
                                <th>Сумма</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${order.items && order.items.map(item => `
                                <tr>
                                    <td>
                                        <strong>${item.product_name}</strong>
                                        ${item.product_sku ? `<br><small>SKU: ${item.product_sku}</small>` : ''}
                                        ${item.size_value ? `<br><small>Размер: ${item.size_value}</small>` : ''}
                                        ${item.color_name ? `<br><small>Цвет: ${item.color_name}</small>` : ''}
                                    </td>
                                    <td>₽${item.unit_price}</td>
                                    <td>${item.quantity}</td>
                                    <td>₽${(item.unit_price * item.quantity).toFixed(2)}</td>
                                </tr>
                            `).join('') || '<tr><td colspan="4">Товары не найдены</td></tr>'}
                        </tbody>
                    </table>
                </div>

                ${['admin', 'manager'].includes(currentUser.user_role) ? `
                    <div class="modal-actions">
                        <button class="btn btn-primary" onclick="actions.editOrder('${order.order_id}')">
                            Редактировать заказ
                        </button>
                    </div>
                ` : ''}
            </div>
        `;

        ui.showModal('orderDetailsModal');
    },

    //  РЕДАКТИРОВАНИЕ ЗАКАЗА
    async editOrder(orderId) {
        try {
            const data = await apiRequest(`/orders/${orderId}`);
            this.showEditOrderModal(data.data);
        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ЗАКАЗА
    showEditOrderModal(order) {
        const modal = document.getElementById('editOrderModal');
        const form = document.getElementById('editOrderForm');

        if (!form) return;

        form.querySelector('[name="orderId"]').value = order.order_id;
        form.querySelector('[name="status"]').value = order.status;
        for (const key of ['payment_status', 'payment_method', 'customer_notes', 'internal_notes']) form.elements[key].value = order[key] || '';
        form.dataset.originalStatus = order.status;


        ui.showModal('editOrderModal');
    },

    //  СОХРАНЕНИЕ ИЗМЕНЕНИЙ ЗАКАЗА
    async updateOrder(event) {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);
        const orderId = formData.get('orderId');

        const orderData = Object.fromEntries(['payment_status', 'payment_method', 'customer_notes', 'internal_notes'].map(key => [key, formData.get(key)]));

        try {
            await apiRequest(`/orders/${orderId}`, { method: 'PUT', body: orderData });
            if (formData.get('status') !== form.dataset.originalStatus) {
                await apiRequest(`/orders/${orderId}/status`, { method: 'PUT', body: { status: formData.get('status') } });
            }

            ui.closeModal('editOrderModal');
            ui.closeModal('orderDetailsModal');
            ui.loadOrders(document.getElementById('orderStatusFilter').value);

        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  ЗАКАЗЫ КЛИЕНТА
    async viewCustomerOrders(userId) {
        try {
            const data = await apiRequest(`/users/${userId}/orders`);
            this.showCustomerOrdersModal(userId, data.data || []);
        } catch (error) {
            ui.showError(error.message);
        }
    },

    //  МОДАЛЬНОЕ ОКНО ЗАКАЗОВ КЛИЕНТА
    showCustomerOrdersModal(userId, orders) {
        const modal = document.getElementById('customerOrdersModal');
        const content = document.getElementById('customerOrdersContent');

        if (!content) return;

        content.innerHTML = `
            <h3>Заказы клиента</h3>
            ${orders.length > 0 ? `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>№ Заказа</th>
                                <th>Дата</th>
                                <th>Сумма</th>
                                <th>Статус</th>
                                <th>Оплата</th>
                                <th>Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${orders.map(order => `
                                <tr>
                                    <td><strong>${order.order_number}</strong></td>
                                    <td>${utils.formatDate(order.order_date)}</td>
                                    <td>₽${order.final_amount}</td>
                                    <td>
                                        <span class="status status-${order.status}">
                                            ${ui.getOrderStatusText(order.status)}
                                        </span>
                                    </td>
                                    <td>
                                        <span class="status status-${order.payment_status === 'paid' ? 'paid' : 'unpaid'}">
                                            ${order.payment_status === 'paid' ? 'Оплачен' : 'Не оплачен'}
                                        </span>
                                    </td>
                                    <td class="action-buttons">
                                        <button class="btn btn-primary btn-sm" 
                                                onclick="actions.viewOrder('${order.order_id}')">
                                            👁️
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `
                <p class="empty-state">У клиента нет заказов</p>
            `}
        `;

        ui.showModal('customerOrdersModal');
    }
};
document.addEventListener('DOMContentLoaded', function() {
    // Обработчик для кнопки загрузки файлов
    const fileUploadButton = document.querySelector('.file-upload-button');
    const fileInput = document.getElementById('main_image_file'); // ← ИЗМЕНИТЬ ID
    
    fileUploadButton.addEventListener('click', function() {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', function(e) {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            
            // Проверяем, что файл изображение
            if (file.type === 'image/jpeg' || file.type === 'image/jpg' || file.type === 'image/png') {
                console.log('Выбран файл:', file.name);
                console.log('File object:', file);
                
                // Показываем превью
                showImagePreview(file);
                
            } else {
                alert('Пожалуйста, выберите файл в формате JPEG, JPG или PNG');
                fileInput.value = '';
            }
        }
    });
    
    const urlButton = document.querySelector('.url-button');
    urlButton.addEventListener('click', function() {
        const urlInput = document.querySelector('input[name="main_image_url"]');
        const url = urlInput.value;
        
        if (url) {
            console.log('Загрузка изображения по URL:', url);
            // Показываем превью из URL
            showUrlPreview(url);
        } else {
            alert('Пожалуйста, введите URL изображения');
        }
    });
    
    // Функция для показа превью из файла
    function showImagePreview(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const previewImage = document.querySelector('.preview-image');
            const previewPlaceholder = document.querySelector('.preview-placeholder');
            
            previewImage.src = e.target.result;
            previewImage.style.display = 'block';
            previewPlaceholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }
    
    // Функция для показа превью из URL
    function showUrlPreview(url) {
        const previewImage = document.querySelector('.preview-image');
        const previewPlaceholder = document.querySelector('.preview-placeholder');
        
        previewImage.src = url;
        previewImage.style.display = 'block';
        previewPlaceholder.style.display = 'none';
        
        // Проверяем, что изображение загружается
        previewImage.onload = function() {
            console.log('Изображение по URL успешно загружено');
        };
        
        previewImage.onerror = function() {
            alert('Ошибка загрузки изображения по URL');
            previewImage.style.display = 'none';
            previewPlaceholder.style.display = 'block';
        };
    }
});
// Инициализация
document.addEventListener('DOMContentLoaded', function () {
    console.log('DOM загружен');

    // Восстановление сессии
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('currentUser');

    if (savedToken && savedUser) {
        try {
            authToken = savedToken;
            currentUser = JSON.parse(savedUser);
            ui.showAdminPanel();
            ui.loadDashboard();
        } catch (error) {
            console.error('Ошибка восстановления сессии:', error);
            ui.showLoginPage();
        }
    } else {
        ui.showLoginPage();
    }

    // Обработчики событий
    document.getElementById('loginForm').addEventListener('submit', actions.login);

    // Навигация
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function () {
            const tabName = this.getAttribute('data-tab');
            ui.showTab(tabName);
        });
    });

    // Поиск товаров
    const productSearch = document.getElementById('productSearch');
    if (productSearch) {
        productSearch.addEventListener('input', utils.debounce(function (e) {
            ui.loadProducts(e.target.value);
        }, 500));
    }

    // Фильтр заказов
    const orderStatusFilter = document.getElementById('orderStatusFilter');
    if (orderStatusFilter) {
        orderStatusFilter.addEventListener('change', function (e) {
            ui.loadOrders(e.target.value);
        });
    }

    // Предпросмотр изображения
    const imageInput = document.getElementById('imageInput');
    if (imageInput) {
        imageInput.addEventListener('change', function () {
            ui.previewImage(this);
        });
    }

    // Обработчик изменения роли в модальном окне
    const roleSelect = document.getElementById('userRoleSelect');
    if (roleSelect) {
        roleSelect.addEventListener('change', ui.toggleStaffFields.bind(ui));
    }

    // Закрытие модального окна при клике вне его
    window.addEventListener('click', function (event) {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            if (event.target === modal) {
                ui.closeModal(modal.id);
            }
        });
    });

    // Закрытие модального окна по ESC
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            const openModal = document.querySelector('.modal[style="display: block;"]');
            if (openModal) {
                ui.closeModal(openModal.id);
            }
        }
    });

    // Глобальные функции
    window.showTab = ui.showTab.bind(ui);
    window.showModal = ui.showModal.bind(ui);
    window.closeModal = ui.closeModal.bind(ui);
    window.logout = actions.logout.bind(actions);
    window.actions = actions;
    window.ui = ui;
});

console.log(' script.js инициализирован');