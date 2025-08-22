/**
 * AI催收助手 - HTTP版本客户端
 * 使用HTTP请求替代WebSocket连接，解决代理服务器问题
 */

class AICollectionAgent {
    constructor() {
        this.isConnected = false;
        this.isRecording = false;
        this.isListening = false; // 新增：标记是否处于持续监听状态
        this.sessionActive = false; // 新增：标记会话是否活跃
        this.currentCustomer = null;
        this.currentScenario = 'overdue_payment';
        this.conversationHistory = [];
        this.metrics = {
            latency: [],
            accuracy: [],
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
        this.analyser = null; // 新增：用于语音活动检测
        this.silenceTimeout = null; // 新增：静音计时器
        this.currentAudio = null; // 新增：当前播放的音频对象
        this.isPlayingAudio = false; // 新增：标记是否正在播放音频
        
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
        // 会话切换（开始/结束）
        document.getElementById('session-toggle').addEventListener('click', () => {
            if (this.sessionActive) {
                this.endSession();
            } else {
                this.startSession();
            }
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

        // 录音按钮 - 改为切换监听模式按钮
        const recordBtn = document.getElementById('record-btn');
        recordBtn.addEventListener('click', () => this.toggleListening());
        
        // 移除触屏设备支持 (不再需要push-to-talk)
        // recordBtn.addEventListener('touchstart', (e) => {
        //     e.preventDefault();
        //     this.startRecording();
        // });
        // recordBtn.addEventListener('touchend', (e) => {
        //     e.preventDefault();
        //     this.stopRecording();
        // });

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

    // 将数字转换为大陆标准中文表达
    formatChineseAmount(amount) {
        if (amount >= 10000) {
            const wan = Math.floor(amount / 10000);
            const remainder = amount % 10000;
            if (remainder === 0) {
                return `${wan}万元`;
            } else if (remainder < 1000) {
                return `${wan}万零${remainder}元`;
            } else {
                return `${wan}万${remainder}元`;
            }
        } else if (amount >= 1000) {
            return `${amount}元`;
        } else {
            return `${amount}元`;
        }
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
            // 设置会话 (无需连接延迟，服务器保持持久连接)
            this.setupSession();
            this.sessionActive = true;
            
            this.updateConnectionStatus('online', '会话已就绪');
            
            // 更新按钮状态
            this.updateSessionButtons();
            
            // 自动开始持续监听
            await this.startContinuousListening();
            
            this.debugLog('会话开始 - 客户: ' + this.currentCustomer.name);
            
            // 立即播放初始问候语 (无延迟)
            this.speakInitialGreeting();
            
        } catch (error) {
            console.error('启动会话失败:', error);
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

    updateSessionButtons() {
        const toggleBtn = document.getElementById('session-toggle');
        const recordBtn = document.getElementById('record-btn');
        
        if (this.sessionActive) {
            toggleBtn.textContent = '结束对话';
            toggleBtn.className = 'btn btn-secondary';
            recordBtn.disabled = false;
        } else {
            toggleBtn.textContent = '开始对话';
            toggleBtn.className = 'btn btn-primary';
            recordBtn.disabled = true;
        }
    }

    // 新增方法：切换监听模式
    async toggleListening() {
        if (this.isListening) {
            this.stopContinuousListening();
        } else {
            await this.startContinuousListening();
        }
    }

    // 新增方法：开始持续监听
    async startContinuousListening() {
        if (this.isListening) return;

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

            // 创建音频分析器用于语音活动检测
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = this.audioContext || new AudioContextClass();
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            source.connect(this.analyser);

            this.isListening = true;
            this.updateListeningUI(true);
            
            // 开始语音活动检测
            this.startVoiceActivityDetection();
            
            this.debugLog('持续监听已开启');

        } catch (error) {
            console.error('开始持续监听失败:', error);
            this.debugLog('错误: 持续监听失败 - ' + error.message);
            alert('无法开启麦克风，请确保已授权麦克风权限');
        }
    }

    // 新增方法：停止持续监听
    stopContinuousListening() {
        if (!this.isListening) return;

        this.isListening = false;
        
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
        }
        
        this.updateListeningUI(false);
        this.debugLog('持续监听已关闭');
    }

    // 新增方法：语音活动检测
    startVoiceActivityDetection() {
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        let speechDetected = false;
        let silenceStart = null;

        const detectVoice = () => {
            if (!this.isListening) return;

            this.analyser.getByteFrequencyData(dataArray);
            
            // 计算音频能量
            const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
            const threshold = 30; // 语音检测阈值，可调整
            
            if (average > threshold) {
                // 检测到语音
                if (!speechDetected) {
                    speechDetected = true;
                    silenceStart = null;
                    
                    // 如果代理正在说话，立即停止
                    if (this.isPlayingAudio) {
                        this.stopCurrentAudio();
                        this.debugLog('客户开始说话，中断代理音频');
                    }
                    
                    this.startRecording();
                    this.debugLog('检测到语音，开始录音');
                }
            } else {
                // 静音状态
                if (speechDetected && !silenceStart) {
                    silenceStart = Date.now();
                }
                
                // 静音超过1.5秒，停止录音
                if (speechDetected && silenceStart && Date.now() - silenceStart > 1500) {
                    speechDetected = false;
                    silenceStart = null;
                    this.stopRecording();
                    this.debugLog('检测到静音，停止录音');
                }
            }
            
            // 继续检测
            requestAnimationFrame(detectVoice);
        };

        detectVoice();
    }

    // 更新监听UI
    updateListeningUI(listening) {
        const btn = document.getElementById('record-btn');
        const text = btn.querySelector('.record-text');
        
        if (listening) {
            btn.classList.add('listening');
            text.textContent = '正在监听';
        } else {
            btn.classList.remove('listening');
            text.textContent = '开始监听';
        }
    }

    async startRecording() {
        if (!this.isConnected || this.isRecording) return;

        try {
            // 在持续监听模式下，音频流已经存在
            if (!this.audioStream) {
                this.audioStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        sampleRate: 16000,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true
                    } 
                });
            }

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

            // 更新UI (仅在非持续监听模式下)
            if (!this.isListening) {
                this.updateRecordingUI(true);
            }
            this.debugLog('开始录音...');

        } catch (error) {
            console.error('开始录音失败:', error);
            this.debugLog('错误: 录音失败 - ' + error.message);
            if (!this.isListening) {
                alert('录音失败，请确保已授权麦克风权限');
            }
        }
    }

    stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        this.mediaRecorder.stop();
        
        // 在持续监听模式下不关闭音频流
        if (!this.isListening && this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
        }

        // 更新UI (仅在非持续监听模式下)
        if (!this.isListening) {
            this.updateRecordingUI(false);
        }
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
            // 合并音频数据
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
            
            // 使用Speech Recognition API进行语音识别
            const transcript = await this.recognizeSpeech(audioBlob);
            
            if (transcript) {
                // 发送到HTTP服务器获取AI回复 (不在这里显示消息，避免重复)
                await this.sendMessageToAI(transcript);
            } else {
                this.debugLog('未识别到有效语音');
            }
            
        } catch (error) {
            console.error('音频处理失败:', error);
            this.debugLog('错误: 音频处理失败 - ' + error.message);
        }
    }

    async speakInitialGreeting() {
        try {
            const customer = this.currentCustomer;
            
            // 停止任何当前播放的音频
            this.stopCurrentAudio();
            
            // 播放预录制的通用问候语 "喂，您好"
            const greetingAudio = new Audio('greeting.wav');
            this.currentAudio = greetingAudio;
            this.isPlayingAudio = true;
            
            await new Promise((resolve, reject) => {
                greetingAudio.onended = () => {
                    this.currentAudio = null;
                    this.isPlayingAudio = false;
                    resolve();
                };
                greetingAudio.onerror = (error) => {
                    this.currentAudio = null;
                    this.isPlayingAudio = false;
                    reject(error);
                };
                greetingAudio.play().catch(reject);
            });
            
            // 显示并播放个性化初始问候文本
            const initialMessage = `您好${customer.name}，我是平安银行催收专员，工号888888。根据我行记录，您有一笔${this.formatChineseAmount(customer.balance)}的逾期本金，已逾期${customer.daysOverdue}天。您的逾期记录已上报征信系统，请您尽快处理还款事宜。请问您现在方便谈论还款安排吗？`;
            this.displayMessage('assistant', initialMessage);

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
            
            const responseData = await response.json();
            
            // 播放个性化问候音频 (会自动停止之前的音频)
            if (responseData.audio) {
                const audioBlob = new Blob([new Uint8Array(responseData.audio)], { type: 'audio/wav' });
                await this.playAudioResponse(audioBlob);
            }
            
            this.debugLog('初始问候完成，等待客户回复');
            
        } catch (error) {
            console.error('播放初始问候失败:', error);
            this.debugLog('初始问候失败: ' + error.message);
            this.isPlayingAudio = false;
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
            
            // 获取响应 (包含音频和文本)
            const responseData = await response.json();
            
            // 播放音频
            if (responseData.audio) {
                const audioBlob = new Blob([new Uint8Array(responseData.audio)], { type: 'audio/wav' });
                await this.playAudioResponse(audioBlob);
            }
            
            // 显示AI的文本回复
            if (responseData.text) {
                this.displayMessage('assistant', responseData.text);
            } else {
                this.displayMessage('assistant', '[语音回复]');
            }
            
            // 更新指标
            this.updateLatencyMetrics(responseTime);
            this.updateSessionStats();
            
            // 评估转录准确性（如果有AI回复文本）
            if (responseData.text && message) {
                this.evaluateTranscriptAccuracy(responseData.text, message);
            }
            
            this.debugLog(`AI回复完成，耗时: ${responseTime}ms`);
            
        } catch (error) {
            console.error('发送消息失败:', error);
            this.debugLog('错误: AI回复失败 - ' + error.message);
            
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

        const systemContext = `你是平安银行信用卡中心的专业催收专员，正在进行电话催收工作。

客户档案信息:
- 客户姓名: ${customer.name}
- 逾期本金: ${this.formatChineseAmount(customer.balance)}
- 逾期天数: ${customer.daysOverdue}天
- 联系历史: ${customer.previousContacts}次
- 风险等级: ${customer.riskLevel}

当前催收场景: ${scenarios[scenario]}
${conversationHistoryText}

基于真实催收对话的标准话术:

【核实确认】
- "我看您这边的话在[日期]还了一笔，还了[金额]"
- "当前的话还差[具体金额]，没有还够"

【理解回应】  
- "也没有人说有钱不去还这个信用卡的，我可以理解"
- "可以理解，您的还款压力确实也是挺大的"

【方案提供】
- "当前的话还是属于一个内部协商"
- "银行这边可以帮您减免一部分息费"
- "还可以帮您去撤销这个余薪案件的"

【专业用语】
- 使用"您这边的话"、"当前的话"、"是吧"等真实催收用语
- 使用"内部协商"、"余薪案件"、"全额减免方案政策"等专业术语

【重要原则】
1. 保持理解耐心的态度，避免强硬施压
2. 用具体数据建立可信度  
3. 提供多种解决方案
4. 关注客户感受和实际困难
5. 使用银行专业术语增强权威性

其它注意语言事项:
- 使用大陆标准普通话，避免使用台湾或香港的用语，及台湾国语
- 15,000元应该被称为"一万五千元"，而不是"十五千元"
- 语气要专业、理解，体现人文关怀

请基于完整的通话记录和真实催收对话模式，以专业催收员的身份回应客户最新的话语。要体现催收员的专业性和人文关怀，避免重复之前已经讨论过的内容。`;

        return systemContext;
    }

    async playAudioResponse(audioBlob) {
        try {
            // 停止当前正在播放的音频
            this.stopCurrentAudio();
            
            // 确保音频上下文已激活
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // 创建音频URL并播放
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            // 设置为当前音频对象
            this.currentAudio = audio;
            this.isPlayingAudio = true;
            
            return new Promise((resolve, reject) => {
                audio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                    this.currentAudio = null;
                    this.isPlayingAudio = false;
                    resolve();
                };
                
                audio.onerror = (error) => {
                    URL.revokeObjectURL(audioUrl);
                    this.currentAudio = null;
                    this.isPlayingAudio = false;
                    reject(error);
                };
                
                // 检查是否在播放开始前就被停止了
                audio.onpause = () => {
                    if (this.currentAudio === audio) {
                        URL.revokeObjectURL(audioUrl);
                        this.currentAudio = null;
                        this.isPlayingAudio = false;
                        resolve();
                    }
                };
                
                audio.play().catch(reject);
            });
            
        } catch (error) {
            console.error('播放音频失败:', error);
            this.debugLog('音频播放错误: ' + error.message);
            this.isPlayingAudio = false;
            throw error;
        }
    }

    // 新增方法：停止当前播放的音频
    stopCurrentAudio() {
        if (this.currentAudio && !this.currentAudio.paused) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.debugLog('停止当前播放的音频');
        }
        this.isPlayingAudio = false;
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
            
        } catch (error) {
            console.error('音频测试失败:', error);
            this.debugLog('音频测试失败: ' + error.message);
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

    // 评估转录准确性
    async evaluateTranscriptAccuracy(originalText, spokenText) {
        try {
            this.debugLog('开始评估转录准确性...');
            
            const response = await fetch(`${this.serverUrl}/api/evaluate-accuracy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    originalText: originalText,
                    spokenText: spokenText,
                    context: `银行催收对话，客户: ${this.currentCustomer?.name}, 场景: ${this.currentScenario}`
                })
            });

            if (!response.ok) {
                throw new Error(`评估请求失败: ${response.status}`);
            }

            const evaluation = await response.json();
            
            // 更新准确性指标显示
            this.updateAccuracyMetrics(evaluation);
            
            this.debugLog(`准确性评估完成: ${evaluation.overall_score}分 (${evaluation.grade})`);
            
        } catch (error) {
            console.error('准确性评估失败:', error);
            this.debugLog('准确性评估失败: ' + error.message);
        }
    }

    // 更新准确性指标显示
    updateAccuracyMetrics(evaluation) {
        // 更新语音识别准确性
        const speechAccuracy = evaluation.vocabulary_accuracy || 0;
        document.getElementById('speech-accuracy').textContent = speechAccuracy + '%';
        
        // 更新回复质量（语义完整性）
        const responseQuality = evaluation.semantic_completeness || 0;
        document.getElementById('response-quality').textContent = responseQuality + '%';
        
        // 更新文化适宜性（专业术语准确性）
        const culturalScore = evaluation.terminology_accuracy || 0;
        document.getElementById('cultural-score').textContent = culturalScore + '%';
        
        // 保存评估历史用于计算平均值
        if (!this.metrics.accuracy) {
            this.metrics.accuracy = [];
        }
        
        this.metrics.accuracy.push({
            overall: evaluation.overall_score || 0,
            vocabulary: evaluation.vocabulary_accuracy || 0,
            semantic: evaluation.semantic_completeness || 0,
            terminology: evaluation.terminology_accuracy || 0,
            comprehensibility: evaluation.comprehensibility || 0,
            grade: evaluation.grade || 'unknown',
            timestamp: Date.now()
        });
        
        // 计算并显示平均准确性
        this.updateAverageAccuracy();
    }

    // 更新平均准确性显示
    updateAverageAccuracy() {
        if (!this.metrics.accuracy || this.metrics.accuracy.length === 0) return;
        
        const accuracyData = this.metrics.accuracy;
        const count = accuracyData.length;
        
        // 计算各项平均值
        const avgVocabulary = Math.round(accuracyData.reduce((sum, item) => sum + item.vocabulary, 0) / count);
        const avgSemantic = Math.round(accuracyData.reduce((sum, item) => sum + item.semantic, 0) / count);
        const avgTerminology = Math.round(accuracyData.reduce((sum, item) => sum + item.terminology, 0) / count);
        
        // 更新显示（考虑使用平均值或最新值）
        document.getElementById('speech-accuracy').textContent = avgVocabulary + '%';
        document.getElementById('response-quality').textContent = avgSemantic + '%';
        document.getElementById('cultural-score').textContent = avgTerminology + '%';
        
        // 添加等级指示器
        this.updateAccuracyGrades(avgVocabulary, avgSemantic, avgTerminology);
    }

    // 更新准确性等级指示器
    updateAccuracyGrades(vocabulary, semantic, terminology) {
        const getGradeClass = (score) => {
            if (score >= 90) return 'excellent';
            if (score >= 75) return 'good';
            if (score >= 60) return 'acceptable';
            return 'poor';
        };
        
        // 为准确性指标添加颜色编码
        const speechElement = document.getElementById('speech-accuracy');
        const responseElement = document.getElementById('response-quality');
        const culturalElement = document.getElementById('cultural-score');
        
        if (speechElement) {
            speechElement.className = `metric-value accuracy-${getGradeClass(vocabulary)}`;
        }
        if (responseElement) {
            responseElement.className = `metric-value accuracy-${getGradeClass(semantic)}`;
        }
        if (culturalElement) {
            culturalElement.className = `metric-value accuracy-${getGradeClass(terminology)}`;
        }
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
        
        // 停止持续监听
        this.stopContinuousListening();
        
        // 停止当前播放的音频
        this.stopCurrentAudio();
        
        this.sessionActive = false;
        this.updateConnectionStatus('offline', '会话已结束');
        
        // 更新按钮状态
        this.updateSessionButtons();
        
        this.debugLog('会话结束');
    }

    resetSession() {
        this.endSession();
        
        // 重置数据
        this.conversationHistory = [];
        this.sessionActive = false;
        this.metrics = {
            latency: [],
            accuracy: [],
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
        
        // 重置准确性指标显示
        document.getElementById('speech-accuracy').textContent = '--%';
        document.getElementById('response-quality').textContent = '--%';
        document.getElementById('cultural-score').textContent = '--%';
        
        // 清除准确性等级样式
        const accuracyElements = ['speech-accuracy', 'response-quality', 'cultural-score'];
        accuracyElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.className = 'metric-value';
            }
        });
        
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