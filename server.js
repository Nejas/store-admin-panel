const app = require('./src/app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(` Сервер запущен на порту ${PORT}`);
    console.log(` Админ-панель: http://localhost:${PORT}/admin`);
    console.log(`  Health check: http://localhost:${PORT}/api/health`);
});