const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const validateProductData = (data) => {
    const errors = [];
    
    if (!data.name || data.name.trim().length < 2) {
        errors.push('Название товара обязательно (мин. 2 символа)');
    }
    
    if (!data.sku || data.sku.trim().length === 0) {
        errors.push('SKU товара обязательно');
    }
    
    if (!data.base_price || data.base_price < 0) {
        errors.push('Базовая цена должна быть положительной');
    }
    
    return errors;
};

const validateUserData = (data) => {
    const errors = [];
    
    if (!data.email || !validateEmail(data.email)) {
        errors.push('Некорректный email');
    }
    
    if (!data.first_name || data.first_name.trim().length < 2) {
        errors.push('Имя обязательно (мин. 2 символа)');
    }
    
    if (!data.last_name || data.last_name.trim().length < 2) {
        errors.push('Фамилия обязательна (мин. 2 символа)');
    }
    
    return errors;
};

module.exports = {
    validateEmail,
    validateProductData,
    validateUserData
};