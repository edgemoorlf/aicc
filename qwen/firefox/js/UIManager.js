/**
 * UIManager - 管理用户界面交互和状态显示
 * 包括按钮状态、消息显示、客户信息、面板切换等
 */
class UIManager {
    constructor(debugLog) {
        this.debugLog = debugLog;
        
        // 客户数据
        this.customers = [];
        
        // UI状态
        this.isDebugVisible = false;
        this.isMetricsVisible = false;
    }

    async loadCustomers() {
        try {
            // 直接嵌入客户数据，避免CORS问题
            this.customers = [
                {
                    "id": "DEMO_001",
                    "name": "张伟",
                    "phone": "+86-138-0013-8000",
                    "balance": 15000,
                    "lastPayment": "2024-06-15",
                    "scenario": "overdue_payment",
                    "daysOverdue": 67,
                    "previousContacts": 3,
                    "preferredLanguage": "zh-CN",
                    "riskLevel": "medium"
                },
                {
                    "id": "DEMO_002", 
                    "name": "李娜",
                    "phone": "+86-139-0013-9000",
                    "balance": 8500,
                    "lastPayment": "2024-07-20",
                    "scenario": "payment_plan",
                    "daysOverdue": 32,
                    "previousContacts": 1,
                    "preferredLanguage": "zh-CN",
                    "riskLevel": "low"
                },
                {
                    "id": "DEMO_003",
                    "name": "王强",
                    "phone": "+86-137-0013-7000", 
                    "balance": 25000,
                    "lastPayment": "2024-05-10",
                    "scenario": "difficult_customer",
                    "daysOverdue": 103,
                    "previousContacts": 7,
                    "preferredLanguage": "zh-CN",
                    "riskLevel": "high"
                },
                {
                    "id": "DEMO_004",
                    "name": "刘敏",
                    "phone": "+86-136-0013-6000",
                    "balance": 4200,
                    "lastPayment": "2024-07-28",
                    "scenario": "first_contact",
                    "daysOverdue": 24,
                    "previousContacts": 0,
                    "preferredLanguage": "zh-CN", 
                    "riskLevel": "low"
                }
            ];
            
            const select = document.getElementById('customer-select');
            if (select) {
                this.customers.forEach(customer => {
                    const option = document.createElement('option');
                    option.value = customer.id;
                    option.textContent = `${customer.name} - ¥${customer.balance.toLocaleString()}`;
                    select.appendChild(option);
                });
            }
            
            this.debugLog('客户数据加载完成: ' + this.customers.length + '个客户');
        } catch (error) {
            console.error('加载客户数据失败:', error);
            this.debugLog('错误: 客户数据加载失败 - ' + error.message);
        }
    }

    initializeUIState() {
        // 确保指标面板初始状态正确
        const mainInterface = document.getElementById('main-interface');
        const dashboard = document.getElementById('metrics-dashboard');
        
        if (dashboard && dashboard.style.display === 'none') {
            mainInterface?.classList.add('metrics-hidden');
        }
    }

    bindEvents(eventHandlers) {
        // 会话切换（开始/结束）
        const sessionToggle = document.getElementById('session-toggle');
        if (sessionToggle && eventHandlers.onSessionToggle) {
            sessionToggle.addEventListener('click', eventHandlers.onSessionToggle);
        }

        // 重置会话
        const resetSession = document.getElementById('reset-session');
        if (resetSession && eventHandlers.onResetSession) {
            resetSession.addEventListener('click', eventHandlers.onResetSession);
        }

        // 客户选择
        const customerSelect = document.getElementById('customer-select');
        if (customerSelect && eventHandlers.onCustomerSelect) {
            customerSelect.addEventListener('change', (e) => {
                eventHandlers.onCustomerSelect(e.target.value);
            });
        }

        // 场景选择
        const scenarioSelect = document.getElementById('scenario-select');
        if (scenarioSelect && eventHandlers.onScenarioSelect) {
            scenarioSelect.addEventListener('change', (e) => {
                eventHandlers.onScenarioSelect(e.target.value);
            });
        }

        // 录音按钮 - 切换监听模式
        const recordBtn = document.getElementById('record-btn');
        if (recordBtn && eventHandlers.onToggleListening) {
            recordBtn.addEventListener('click', eventHandlers.onToggleListening);
        }

        // 指标面板切换（内部切换）
        const toggleMetrics = document.getElementById('toggle-metrics');
        if (toggleMetrics) {
            toggleMetrics.addEventListener('click', () => this.toggleMetrics());
        }

        // 指标监控切换（显示/隐藏整个面板）
        const metricsToggle = document.getElementById('metrics-toggle');
        if (metricsToggle) {
            metricsToggle.addEventListener('click', () => this.toggleMetricsDashboard());
        }

        // 调试面板
        const toggleDebug = document.getElementById('toggle-debug');
        if (toggleDebug) {
            toggleDebug.addEventListener('click', () => this.toggleDebug());
        }

        const clearDebug = document.getElementById('clear-debug');
        if (clearDebug) {
            clearDebug.addEventListener('click', () => this.clearDebugLog());
        }

        // 测试按钮
        const testBtn = document.getElementById('test-btn');
        if (testBtn && eventHandlers.onTestAudio) {
            testBtn.addEventListener('click', eventHandlers.onTestAudio);
        }

        // 语音控制面板
        this.bindToneControlEvents(eventHandlers);
    }

    bindToneControlEvents(eventHandlers) {
        // 语音控制面板切换
        const toggleToneControls = document.getElementById('toggle-tone-controls');
        if (toggleToneControls) {
            toggleToneControls.addEventListener('click', () => this.toggleToneControls());
        }

        // 语速控制
        const voiceSpeed = document.getElementById('voice-speed');
        const speedValue = document.getElementById('speed-value');
        if (voiceSpeed && speedValue) {
            voiceSpeed.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                speedValue.textContent = `${value}x`;
                if (eventHandlers.onToneControlChange) {
                    eventHandlers.onToneControlChange('speed', value);
                }
            });
        }

        // 音调控制
        const voicePitch = document.getElementById('voice-pitch');
        const pitchValue = document.getElementById('pitch-value');
        if (voicePitch && pitchValue) {
            voicePitch.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                pitchValue.textContent = `${value}x`;
                if (eventHandlers.onToneControlChange) {
                    eventHandlers.onToneControlChange('pitch', value);
                }
            });
        }

        // 音量控制
        const voiceVolume = document.getElementById('voice-volume');
        const volumeValue = document.getElementById('volume-value');
        if (voiceVolume && volumeValue) {
            voiceVolume.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                volumeValue.textContent = `${Math.round(value * 100)}%`;
                if (eventHandlers.onToneControlChange) {
                    eventHandlers.onToneControlChange('volume', value);
                }
            });
        }

        // 语调选择
        const voiceTone = document.getElementById('voice-tone');
        if (voiceTone) {
            voiceTone.addEventListener('change', (e) => {
                if (eventHandlers.onToneControlChange) {
                    eventHandlers.onToneControlChange('tone', e.target.value);
                }
            });
        }

        // 声音选择
        const voiceSelection = document.getElementById('voice-selection');
        if (voiceSelection) {
            voiceSelection.addEventListener('change', (e) => {
                if (eventHandlers.onToneControlChange) {
                    eventHandlers.onToneControlChange('voice', e.target.value);
                }
            });
        }

        // 情感选择
        const voiceEmotion = document.getElementById('voice-emotion');
        if (voiceEmotion) {
            voiceEmotion.addEventListener('change', (e) => {
                if (eventHandlers.onToneControlChange) {
                    eventHandlers.onToneControlChange('emotion', e.target.value);
                }
            });
        }

        // 测试语音
        const testVoice = document.getElementById('test-voice');
        if (testVoice && eventHandlers.onTestVoice) {
            testVoice.addEventListener('click', eventHandlers.onTestVoice);
        }

        // 重置语音设置
        const resetVoice = document.getElementById('reset-voice');
        if (resetVoice) {
            resetVoice.addEventListener('click', () => this.resetVoiceSettings(eventHandlers.onToneControlChange));
        }
    }

    // 客户信息相关方法
    getCustomerById(customerId) {
        return this.customers.find(c => c.id === customerId);
    }

    displayCustomerInfo(customer) {
        const customerInfo = document.getElementById('customer-info');
        if (customerInfo) {
            customerInfo.style.display = 'block';
        }
        
        this.updateElementText('customer-name', customer.name);
        this.updateElementText('customer-phone', customer.phone);
        this.updateElementText('customer-balance', '¥' + customer.balance.toLocaleString());
        this.updateElementText('customer-overdue', customer.daysOverdue + '天');
        this.updateElementText('customer-risk', this.getRiskLabel(customer.riskLevel));
        this.updateElementText('customer-contacts', customer.previousContacts + '次');
    }

    getRiskLabel(level) {
        const labels = {
            'low': '低风险',
            'medium': '中风险',
            'high': '高风险'
        };
        return labels[level] || level;
    }

    // 会话按钮状态管理
    updateSessionButtons(sessionActive) {
        const toggleBtn = document.getElementById('session-toggle');
        const recordBtn = document.getElementById('record-btn');
        
        if (toggleBtn) {
            if (sessionActive) {
                toggleBtn.textContent = '结束对话';
                toggleBtn.className = 'btn btn-secondary';
            } else {
                toggleBtn.textContent = '开始对话';
                toggleBtn.className = 'btn btn-primary';
            }
        }
        
        if (recordBtn) {
            recordBtn.disabled = !sessionActive;
        }
    }

    // 监听UI状态更新
    updateListeningUI(listening) {
        const btn = document.getElementById('record-btn');
        if (!btn) return;
        
        const text = btn.querySelector('.record-text');
        
        if (listening) {
            btn.classList.add('listening');
            if (text) text.textContent = '正在监听';
        } else {
            btn.classList.remove('listening');
            if (text) text.textContent = '开始监听';
        }
    }

    // 录音UI状态更新
    updateRecordingUI(recording) {
        const btn = document.getElementById('record-btn');
        if (!btn) return;
        
        const text = btn.querySelector('.record-text');
        
        if (recording) {
            btn.classList.add('recording');
            if (text) text.textContent = '松开结束';
        } else {
            btn.classList.remove('recording');
            if (text) text.textContent = '按住说话';
        }
    }

    // 连接状态更新
    updateConnectionStatus(status, text) {
        const indicator = document.getElementById('connection-indicator');
        const textElement = document.getElementById('connection-text');
        
        if (indicator) {
            indicator.className = `status-indicator ${status}`;
        }
        if (textElement) {
            textElement.textContent = text;
        }
    }

    // 消息显示
    displayMessage(sender, text) {
        const display = document.getElementById('conversation-display');
        if (!display) return;
        
        const message = document.createElement('div');
        message.className = `message ${sender}`;
        
        const timestamp = new Date().toLocaleTimeString('zh-CN');
        message.innerHTML = `
            ${text}
            <div class="message-timestamp">${timestamp}</div>
        `;
        
        display.appendChild(message);
        display.scrollTop = display.scrollHeight;
    }

    // 面板切换方法
    toggleMetrics() {
        const content = document.getElementById('metrics-content');
        const btn = document.getElementById('toggle-metrics');
        
        if (content && btn) {
            if (content.classList.contains('collapsed')) {
                content.classList.remove('collapsed');
                btn.textContent = '收起';
            } else {
                content.classList.add('collapsed');
                btn.textContent = '展开';
            }
        }
    }

    toggleMetricsDashboard() {
        const dashboard = document.getElementById('metrics-dashboard');
        const btn = document.getElementById('metrics-toggle');
        const mainInterface = document.getElementById('main-interface');
        
        if (!dashboard || !btn || !mainInterface) return;
        
        if (dashboard.style.display === 'none') {
            dashboard.style.display = 'block';
            btn.textContent = '隐藏指标';
            mainInterface.classList.remove('metrics-hidden');
            this.isMetricsVisible = true;
        } else {
            dashboard.style.display = 'none';
            btn.textContent = '指标监控';
            mainInterface.classList.add('metrics-hidden');
            this.isMetricsVisible = false;
        }
    }

    toggleDebug() {
        const console = document.getElementById('debug-console');
        const btn = document.getElementById('toggle-debug');
        
        if (!console || !btn) return;
        
        if (console.style.display === 'none') {
            console.style.display = 'block';
            btn.textContent = '隐藏';
            this.isDebugVisible = true;
        } else {
            console.style.display = 'none';
            btn.textContent = '显示';
        }
    }

    toggleToneControls() {
        const content = document.getElementById('tone-content');
        const btn = document.getElementById('toggle-tone-controls');
        
        if (content && btn) {
            if (content.style.display === 'none') {
                content.style.display = 'block';
                btn.textContent = '收起';
            } else {
                content.style.display = 'none';
                btn.textContent = '展开';
            }
        }
    }

    resetVoiceSettings(onToneControlChange) {
        // 重置所有语音控制到默认值
        const defaultSettings = {
            speed: 1.0,
            pitch: 1.0,
            volume: 0.8,
            voice: 'Cherry',
            tone: 'professional',
            emotion: 'professional'
        };

        // 更新UI控件
        const voiceSpeed = document.getElementById('voice-speed');
        const speedValue = document.getElementById('speed-value');
        if (voiceSpeed && speedValue) {
            voiceSpeed.value = defaultSettings.speed;
            speedValue.textContent = `${defaultSettings.speed}x`;
        }

        const voicePitch = document.getElementById('voice-pitch');
        const pitchValue = document.getElementById('pitch-value');
        if (voicePitch && pitchValue) {
            voicePitch.value = defaultSettings.pitch;
            pitchValue.textContent = `${defaultSettings.pitch}x`;
        }

        const voiceVolume = document.getElementById('voice-volume');
        const volumeValue = document.getElementById('volume-value');
        if (voiceVolume && volumeValue) {
            voiceVolume.value = defaultSettings.volume;
            volumeValue.textContent = `${Math.round(defaultSettings.volume * 100)}%`;
        }

        const voiceSelection = document.getElementById('voice-selection');
        if (voiceSelection) {
            voiceSelection.value = defaultSettings.voice;
        }

        const voiceTone = document.getElementById('voice-tone');
        if (voiceTone) {
            voiceTone.value = defaultSettings.tone;
        }

        const voiceEmotion = document.getElementById('voice-emotion');
        if (voiceEmotion) {
            voiceEmotion.value = defaultSettings.emotion;
        }

        // 通知主应用重置设置
        if (onToneControlChange) {
            Object.keys(defaultSettings).forEach(key => {
                onToneControlChange(key, defaultSettings[key]);
            });
        }

        this.debugLog('语音设置已重置为默认值');
    }

    clearDebugLog() {
        const debugLog = document.getElementById('debug-log');
        if (debugLog) {
            debugLog.textContent = '';
        }
    }

    // 调试日志显示
    appendDebugLog(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${message}\n`;
        
        const debugLog = document.getElementById('debug-log');
        if (debugLog) {
            debugLog.textContent += logEntry;
            debugLog.scrollTop = debugLog.scrollHeight;
        }
    }

    // 加载指示器
    showLoading(show, message = '处理中...') {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        
        if (show) {
            overlay.style.display = 'flex';
            const loadingText = overlay.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = message;
            }
        } else {
            overlay.style.display = 'none';
        }
    }

    // 重置UI状态
    resetUI() {
        // 清空对话显示
        const conversationDisplay = document.getElementById('conversation-display');
        if (conversationDisplay) {
            conversationDisplay.innerHTML = '<div class="welcome-message">请选择客户并开始对话</div>';
        }
        
        // 重置客户选择
        const customerSelect = document.getElementById('customer-select');
        if (customerSelect) {
            customerSelect.value = '';
        }
        
        // 隐藏客户信息
        const customerInfo = document.getElementById('customer-info');
        if (customerInfo) {
            customerInfo.style.display = 'none';
        }
        
        // 重置按钮状态
        this.updateSessionButtons(false);
        this.updateListeningUI(false);
        this.updateRecordingUI(false);
        
        this.debugLog('UI状态已重置');
    }

    // 获取表单数据
    getSelectedCustomerId() {
        const select = document.getElementById('customer-select');
        return select ? select.value : null;
    }

    getSelectedScenario() {
        const select = document.getElementById('scenario-select');
        return select ? select.value : 'overdue_payment';
    }

    // 工具方法
    updateElementText(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
        }
    }

    updateElementHTML(elementId, html) {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = html;
        }
    }

    getElementById(elementId) {
        return document.getElementById(elementId);
    }

    // 获取UI状态
    getUIState() {
        return {
            isDebugVisible: this.isDebugVisible,
            isMetricsVisible: this.isMetricsVisible,
            selectedCustomerId: this.getSelectedCustomerId(),
            selectedScenario: this.getSelectedScenario()
        };
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIManager;
} else if (typeof window !== 'undefined') {
    window.UIManager = UIManager;
}