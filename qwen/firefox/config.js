// 配置文件 - Qwen实现专用配置
window.APP_CONFIG = {
    // 开发环境配置
    development: {
        SERVER_URL: 'http://localhost:3004',  // Qwen服务器端口
        DEBUG: true
    },
    
    // 生产环境配置
    production: {
        SERVER_URL: window.location.origin,
        DEBUG: false
    },
    
    // 获取当前环境配置
    get current() {
        const isDevelopment = location.hostname === 'localhost' || 
                             location.hostname === '127.0.0.1' || 
                             location.hostname.includes('.local');
        
        return isDevelopment ? this.development : this.production;
    }
};

// 设置全局SERVER_URL供http-client.js使用
window.SERVER_URL = window.APP_CONFIG.current.SERVER_URL;