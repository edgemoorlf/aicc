/**
 * AI催收助手 - HTTP版本客户端
 * 使用HTTP请求替代WebSocket连接，解决代理服务器问题
 */

class AICollectionAgent {
    constructor() {
        this.isConnected = false;
        this.isRecording = false;
        this.currentCustomer = null;
        this.currentScenario = 'overdue_payment';
        this.conversationHistory = [];
        this.metrics = {
            latency: [],
            accuracy: {},
            sessionStart: null,
            turnCount: 0
        };
        
        // HTTP服务器地址
        this.serverUrl = 'http://localhost:3002';
        
        // Audio相关
        this.audioContext = null;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.audioChunks = [];
        
        // 初始化
        this.init();
    }

    async init() {
        console.log('初始化AI催收助手 (HTTP版本)...');
        
        // 加载客户数据
        await this.loadCustomers();
        
        // 绑定事件
        this.bindEvents();
        
        // 初始化音频上下文
        this.initAudioContext();
        
        // 检查服务器连接
        await this.checkServerConnection();
        
        console.log('AI催收助手初始化完成');
        this.debugLog('系统初始化完成 (HTTP模式)');
    }

    async checkServerConnection() {
        try {
            const response = await fetch(this.serverUrl);
            if (response.ok) {
                this.isConnected = true;
                this.updateConnectionStatus('online', 'HTTP服务器已连接');
                this.debugLog('HTTP服务器连接成功');
            } else {
                throw new Error('Server not responding');
            }
        } catch (error) {
            this.isConnected = false;
            this.updateConnectionStatus('offline', 'HTTP服务器未连接');
            this.debugLog('HTTP服务器连接失败: ' + error.message);
        }
    }

    async loadCustomers() {
        try {
            // 直接嵌入客户数据，避免CORS问题
            const customers = [
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
            customers.forEach(customer => {
                const option = document.createElement('option');
                option.value = customer.id;
                option.textContent = `${customer.name} - ¥${customer.balance.toLocaleString()}`;
                select.appendChild(option);
            });
            
            this.customers = customers;
            console.log('客户数据加载完成:', customers.length, '个客户');
        } catch (error) {
            console.error('加载客户数据失败:', error);
            this.debugLog('错误: 客户数据加载失败 - ' + error.message);
        }
    }

    bindEvents() {
        // 开始会话
        document.getElementById('start-session').addEventListener('click', () => {
            this.startSession();
        });

        // 结束会话
        document.getElementById('end-session').addEventListener('click', () => {
            this.endSession();
        });

        // 重置会话
        document.getElementById('reset-session').addEventListener('click', () => {
            this.resetSession();
        });

        // 客户选择
        document.getElementById('customer-select').addEventListener('change', (e) => {
            this.selectCustomer(e.target.value);
        });

        // 场景选择
        document.getElementById('scenario-select').addEventListener('change', (e) => {
            this.currentScenario = e.target.value;
            this.debugLog('场景切换: ' + e.target.value);
        });

        // 录音按钮 - 按住说话
        const recordBtn = document.getElementById('record-btn');
        recordBtn.addEventListener('mousedown', () => this.startRecording());
        recordBtn.addEventListener('mouseup', () => this.stopRecording());
        recordBtn.addEventListener('mouseleave', () => this.stopRecording());
        
        // 触屏设备支持
        recordBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startRecording();
        });
        recordBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopRecording();
        });

        // 指标面板切换
        document.getElementById('toggle-metrics').addEventListener('click', () => {
            this.toggleMetrics();
        });

        // 调试面板
        document.getElementById('toggle-debug').addEventListener('click', () => {
            this.toggleDebug();
        });

        document.getElementById('clear-debug').addEventListener('click', () => {
            document.getElementById('debug-log').textContent = '';
        });

        // 测试按钮
        const testBtn = document.getElementById('test-btn');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.testAudio());
        }
    }

    async initAudioContext() {
        try {
            // 修复webkitAudioContext兼容性问题
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass();
            console.log('音频上下文初始化成功');
        } catch (error) {
            console.error('音频上下文初始化失败:', error);
            this.debugLog('错误: 音频上下文初始化失败');
        }
    }

    selectCustomer(customerId) {
        if (!customerId) return;
        
        this.currentCustomer = this.customers.find(c => c.id === customerId);
        if (this.currentCustomer) {
            this.displayCustomerInfo(this.currentCustomer);
            this.debugLog('客户选择: ' + this.currentCustomer.name);
        }
    }

    displayCustomerInfo(customer) {
        document.getElementById('customer-info').style.display = 'block';
        document.getElementById('customer-name').textContent = customer.name;
        document.getElementById('customer-phone').textContent = customer.phone;
        document.getElementById('customer-balance').textContent = '¥' + customer.balance.toLocaleString();
        document.getElementById('customer-overdue').textContent = customer.daysOverdue + '天';
        document.getElementById('customer-risk').textContent = this.getRiskLabel(customer.riskLevel);
        document.getElementById('customer-contacts').textContent = customer.previousContacts + '次';
    }

    getRiskLabel(level) {
        const labels = {
            'low': '低风险',
            'medium': '中风险',
            'high': '高风险'
        };
        return labels[level] || level;
    }

    async startSession() {
        if (!this.currentCustomer) {
            alert('请先选择一个客户');
            return;
        }

        if (!this.isConnected) {
            alert('HTTP服务器未连接，请检查服务器是否运行');
            return;
        }

        try {
            this.showLoading(true);
            this.updateConnectionStatus('connecting', '正在准备会话...');
            
            // 设置会话
            this.setupSession();
            
            this.showLoading(false);
            this.updateConnectionStatus('online', '会话已就绪');
            
            // 启用控制按钮
            document.getElementById('start-session').disabled = true;
            document.getElementById('end-session').disabled = false;
            document.getElementById('record-btn').disabled = false;
            
            // 显示欢迎消息
            const display = document.getElementById('conversation-display');
            display.innerHTML = '<div class="message assistant">您好！我是平安银行，工号888888，今天联系您是关于您的账户情况。</div>';
            
            this.debugLog('会话开始 - 客户: ' + this.currentCustomer.name);
            
            // 自动播放初始问候语
            setTimeout(() => {
                this.speakInitialGreeting();
            }, 1000);
            
        } catch (error) {
            console.error('启动会话失败:', error);
            this.showLoading(false);
            this.updateConnectionStatus('offline', '会话启动失败');
            alert('会话启动失败: ' + error.message);
            this.debugLog('错误: 会话启动失败 - ' + error.message);
        }
    }

    setupSession() {
        this.metrics.sessionStart = Date.now();
        this.metrics.turnCount = 0;
        this.conversationHistory = [];
        
        // 开始指标更新
        this.startMetricsUpdate();
    }

    async startRecording() {
        if (!this.isConnected || this.isRecording) return;

        try {
            // 获取麦克风权限
            this.audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                } 
            });

            // 创建MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.audioStream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            this.audioChunks = [];
            this.isRecording = true;

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.processAudioChunks();
            };

            this.mediaRecorder.start(100);

            // 更新UI
            this.updateRecordingUI(true);
            this.debugLog('开始录音...');

        } catch (error) {
            console.error('开始录音失败:', error);
            this.debugLog('错误: 录音失败 - ' + error.message);
            alert('录音失败，请确保已授权麦克风权限');
        }
    }

    stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        this.mediaRecorder.stop();
        this.audioStream.getTracks().forEach(track => track.stop());

        // 更新UI
        this.updateRecordingUI(false);
        this.debugLog('录音结束，正在处理...');
    }

    updateRecordingUI(recording) {
        const btn = document.getElementById('record-btn');
        const text = btn.querySelector('.record-text');
        
        if (recording) {
            btn.classList.add('recording');
            text.textContent = '松开结束';
        } else {
            btn.classList.remove('recording');
            text.textContent = '按住说话';
        }
    }

    async processAudioChunks() {
        if (this.audioChunks.length === 0) return;

        try {
            this.showLoading(true, '正在处理语音...');
            
            // 合并音频数据
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
            
            // 使用Speech Recognition API进行语音识别
            const transcript = await this.recognizeSpeech(audioBlob);
            
            if (transcript) {
                this.displayMessage('user', transcript);
                
                // 发送到HTTP服务器获取AI回复
                await this.sendMessageToAI(transcript);
            } else {
                this.debugLog('未识别到有效语音');
                this.showLoading(false);
            }
            
        } catch (error) {
            console.error('音频处理失败:', error);
            this.debugLog('错误: 音频处理失败 - ' + error.message);
            this.showLoading(false);
        }
    }

    async speakInitialGreeting() {
        try {
            this.showLoading(true, '正在播放初始问候...');
            
            const customer = this.currentCustomer;
            const initialMessage = `您好${customer.name}，我是平安银行催收专员，工号888888。根据我行记录，您有一笔${customer.balance.toLocaleString()}元的逾期本金，已逾期${customer.daysOverdue}天。您的逾期记录已上报征信系统，请您尽快处理还款事宜。请问您现在方便谈论还款安排吗？`;
            
            const response = await fetch(`${this.serverUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: initialMessage,
                    messageType: 'agent_greeting'
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const audioBlob = await response.blob();
            await this.playAudioResponse(audioBlob);
            
            this.showLoading(false);
            this.debugLog('初始问候完成，等待客户回复');
            
        } catch (error) {
            console.error('播放初始问候失败:', error);
            this.debugLog('初始问候失败: ' + error.message);
            this.showLoading(false);
        }
    }

    async recognizeSpeech(audioBlob) {
        try {
            // Send the recorded audio to a speech recognition service
            // For now, we'll use a simple implementation that sends audio to our server
            // The server can then use OpenAI's Whisper API for transcription
            
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            
            const response = await fetch(`${this.serverUrl}/api/transcribe`, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`Transcription failed: ${response.status}`);
            }
            
            const result = await response.json();
            return result.transcript || null;
            
        } catch (error) {
            console.error('语音识别失败:', error);
            this.debugLog('语音识别失败，使用文本输入: ' + error.message);
            
            // Fallback to text input if ASR fails
            return this.showTextInput();
        }
    }

    showTextInput() {
        return new Promise((resolve) => {
            const input = prompt('语音识别失败，请输入您想说的话：');
            if (input && input.trim()) {
                resolve(input.trim());
            } else {
                resolve(null);
            }
        });
    }

    async sendMessageToAI(message) {
        try {
            const startTime = Date.now();
            
            // Build the full contextual message with conversation history and rules
            const contextualMessage = this.buildContextualMessage(message);
            
            // Send the contextual message to the AI
            const response = await fetch(`${this.serverUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: contextualMessage,
                    messageType: 'customer_with_context',
                    customerContext: {
                        name: this.currentCustomer.name,
                        balance: this.currentCustomer.balance,
                        daysOverdue: this.currentCustomer.daysOverdue,
                        previousContacts: this.currentCustomer.previousContacts,
                        riskLevel: this.currentCustomer.riskLevel,
                        scenario: this.currentScenario
                    },
                    conversationHistory: this.conversationHistory
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const responseTime = Date.now() - startTime;
            
            // Display the customer message first
            this.displayMessage('user', message);
            
            // 获取音频响应
            const audioBlob = await response.blob();
            
            // 播放音频
            await this.playAudioResponse(audioBlob);
            
            // Record the AI response (we need to extract the text from the AI response)
            // For now, we'll add a placeholder and update it when we get the transcript
            this.displayMessage('assistant', '[语音回复]');
            
            // 更新指标
            this.updateLatencyMetrics(responseTime);
            this.updateSessionStats();
            
            this.showLoading(false);
            this.debugLog(`AI回复完成，耗时: ${responseTime}ms`);
            
        } catch (error) {
            console.error('发送消息失败:', error);
            this.debugLog('错误: AI回复失败 - ' + error.message);
            this.showLoading(false);
            
            // 显示错误消息
            this.displayMessage('assistant', '抱歉，我暂时无法回复。请稍后重试。');
        }
    }

    buildContextualMessage(userMessage) {
        const customer = this.currentCustomer;
        const scenario = this.currentScenario;
        
        const scenarios = {
            'overdue_payment': '处理逾期付款催收',
            'payment_plan': '制定还款计划',
            'difficult_customer': '处理困难客户',
            'first_contact': '首次联系客户'
        };

        // 构建对话历史
        let conversationHistoryText = '';
        if (this.conversationHistory.length > 0) {
            conversationHistoryText = '\n本次通话记录:\n';
            this.conversationHistory.forEach((entry, index) => {
                const role = entry.sender === 'user' ? '客户' : '催收员';
                conversationHistoryText += `${index + 1}. ${role}: ${entry.text}\n`;
            });
            conversationHistoryText += `${this.conversationHistory.length + 1}. 客户: ${userMessage}\n`;
        } else {
            conversationHistoryText = `\n本次通话记录:\n1. 客户: ${userMessage}\n`;
        }

        const systemContext = `你是平安银行的专业催收员，正在进行电话催收工作。

客户档案信息:
- 客户姓名: ${customer.name}
- 逾期本金: ¥${customer.balance.toLocaleString()}
- 逾期天数: ${customer.daysOverdue}天
- 联系历史: ${customer.previousContacts}次
- 风险等级: ${customer.riskLevel}

当前催收场景: ${scenarios[scenario]}
${conversationHistoryText}
催收员工作职责:
1. 明确告知客户逾期情况和还款义务
2. 了解客户还款困难和实际情况  
3. 提出具体可行的还款解决方案
4. 强调逾期对征信和法律后果的影响
5. 记录客户承诺和还款计划
6. 设定明确的后续联系时间节点
7. 不要讨论和催收无关的话题 Do NOT talk anything unrelated to collection.
8. 基于上述通话记录，避免重复询问已经讨论过的内容

专业催收话术要点:
- 使用"逾期本金"、"还款义务"、"征信记录"等专业术语
- 强调银行的合法催收权利和客户的法定义务
- 提及征信系统影响："您的逾期记录已上报征信系统"
- 法律后果警示："我行保留通过法律途径追讨的权利"
- 解决方案导向："我们可以协商制定分期还款计划"

请基于完整的通话记录，以专业催收员的身份回应客户最新的话语。要体现催收员的权威性和专业性，同时依法合规。避免重复之前已经讨论过的内容。`;

        return systemContext;
    }

    async playAudioResponse(audioBlob) {
        try {
            // 确保音频上下文已激活
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // 创建音频URL并播放
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            return new Promise((resolve, reject) => {
                audio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                    resolve();
                };
                
                audio.onerror = (error) => {
                    URL.revokeObjectURL(audioUrl);
                    reject(error);
                };
                
                audio.play().catch(reject);
            });
            
        } catch (error) {
            console.error('播放音频失败:', error);
            this.debugLog('音频播放错误: ' + error.message);
            throw error;
        }
    }

    displayMessage(sender, text) {
        const display = document.getElementById('conversation-display');
        const message = document.createElement('div');
        message.className = `message ${sender}`;
        
        const timestamp = new Date().toLocaleTimeString('zh-CN');
        message.innerHTML = `
            ${text}
            <div class="message-timestamp">${timestamp}</div>
        `;
        
        display.appendChild(message);
        display.scrollTop = display.scrollHeight;
        
        // 更新对话历史
        this.conversationHistory.push({ sender, text, timestamp: Date.now() });
        
        // 更新轮次计数
        if (sender === 'user') {
            this.metrics.turnCount++;
        }
    }

    // 测试功能
    async testAudio() {
        try {
            this.showLoading(true, '测试音频生成...');
            
            const testMessage = '你好，这是一个测试消息。请确认你能听到清晰的中文语音。';
            
            const response = await fetch(`${this.serverUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: testMessage
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const audioBlob = await response.blob();
            await this.playAudioResponse(audioBlob);
            
            this.debugLog('音频测试完成');
            this.showLoading(false);
            
        } catch (error) {
            console.error('音频测试失败:', error);
            this.debugLog('音频测试失败: ' + error.message);
            this.showLoading(false);
        }
    }

    updateLatencyMetrics(latency) {
        this.metrics.latency.push({
            total: latency,
            timestamp: Date.now()
        });
        
        document.getElementById('current-latency').textContent = latency + ' ms';
        
        // 设置等级
        let grade = 'poor';
        if (latency < 1000) grade = 'excellent';
        else if (latency < 2000) grade = 'good';
        else if (latency < 5000) grade = 'acceptable';
        
        const gradeElement = document.getElementById('latency-grade');
        gradeElement.textContent = this.getGradeText(grade);
        gradeElement.className = `metric-grade ${grade}`;
        
        // 更新平均延迟
        if (this.metrics.latency.length > 0) {
            const avgLatency = this.metrics.latency.reduce((sum, l) => sum + l.total, 0) / this.metrics.latency.length;
            document.getElementById('avg-latency').textContent = Math.round(avgLatency) + ' ms';
        }
    }

    getGradeText(grade) {
        const texts = {
            'excellent': '优秀',
            'good': '良好',
            'acceptable': '可接受',
            'poor': '较差'
        };
        return texts[grade] || grade;
    }

    updateSessionStats() {
        document.getElementById('turn-count').textContent = this.metrics.turnCount;
        
        if (this.metrics.sessionStart) {
            const duration = Date.now() - this.metrics.sessionStart;
            const minutes = Math.floor(duration / 60000);
            const seconds = Math.floor((duration % 60000) / 1000);
            document.getElementById('session-duration').textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        // 计算成功率
        const successRate = this.conversationHistory.length > 0 ? 
            Math.min(100, (this.metrics.turnCount / this.conversationHistory.length) * 100) : 0;
        document.getElementById('success-rate').textContent = Math.round(successRate) + '%';
    }

    startMetricsUpdate() {
        this.metricsInterval = setInterval(() => {
            this.updateSessionStats();
        }, 1000);
    }

    toggleMetrics() {
        const content = document.getElementById('metrics-content');
        const btn = document.getElementById('toggle-metrics');
        
        if (content.classList.contains('collapsed')) {
            content.classList.remove('collapsed');
            btn.textContent = '收起';
        } else {
            content.classList.add('collapsed');
            btn.textContent = '展开';
        }
    }

    toggleDebug() {
        const console = document.getElementById('debug-console');
        const btn = document.getElementById('toggle-debug');
        
        if (console.style.display === 'none') {
            console.style.display = 'block';
            btn.textContent = '隐藏';
        } else {
            console.style.display = 'none';
            btn.textContent = '显示';
        }
    }

    debugLog(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${message}\\n`;
        
        const debugLog = document.getElementById('debug-log');
        debugLog.textContent += logEntry;
        debugLog.scrollTop = debugLog.scrollHeight;
        
        console.log(message);
    }

    endSession() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }
        
        this.updateConnectionStatus('offline', '会话已结束');
        
        // 更新UI状态
        document.getElementById('start-session').disabled = false;
        document.getElementById('end-session').disabled = true;
        document.getElementById('record-btn').disabled = true;
        
        this.debugLog('会话结束');
    }

    resetSession() {
        this.endSession();
        
        // 重置数据
        this.conversationHistory = [];
        this.metrics = {
            latency: [],
            accuracy: {},
            sessionStart: null,
            turnCount: 0
        };
        
        // 清空UI
        document.getElementById('conversation-display').innerHTML = '<div class="welcome-message">请选择客户并开始对话</div>';
        document.getElementById('customer-select').value = '';
        document.getElementById('customer-info').style.display = 'none';
        
        // 重置指标显示
        document.getElementById('current-latency').textContent = '-- ms';
        document.getElementById('avg-latency').textContent = '-- ms';
        document.getElementById('latency-grade').textContent = '--';
        document.getElementById('turn-count').textContent = '0';
        document.getElementById('session-duration').textContent = '00:00';
        document.getElementById('success-rate').textContent = '--%';
        
        this.currentCustomer = null;
        this.debugLog('会话已重置');
    }

    updateConnectionStatus(status, text) {
        const indicator = document.getElementById('connection-indicator');
        const textElement = document.getElementById('connection-text');
        
        indicator.className = `status-indicator ${status}`;
        textElement.textContent = text;
    }

    showLoading(show, message = '处理中...') {
        const overlay = document.getElementById('loading-overlay');
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
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('页面加载完成，初始化AI催收助手 (HTTP版本)...');
    window.aiAgent = new AICollectionAgent();
});

// 导出类以便测试
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AICollectionAgent;
}