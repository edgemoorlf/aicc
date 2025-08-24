/**
 * AI催收助手 - Firefox OGG/Opus优化版本 (重构版)
 * 支持直接OGG/Opus流式传输，零转换延迟
 * 专为Firefox浏览器的原生OGG/Opus支持优化
 * 
 * 重构为模块化架构，提高代码可维护性和可读性
 */

class AICollectionAgentWS {
    constructor() {
        // 初始化调试日志方法（需要最先初始化）
        this.debugLog = this.createDebugLogger();
        
        // 初始化管理器组件
        this.audioManager = new AudioManager(this.debugLog);
        this.uiManager = new UIManager(this.debugLog);
        this.metricsManager = new MetricsManager(this.debugLog);
        this.webSocketManager = new WebSocketManager(this.getServerUrl(), this.debugLog);
        
        // 应用状态
        this.state = {
            isConnected: false,
            isRecording: false,
            isListening: false,
            sessionActive: false,
            customerHasResponded: false
        };
        
        // 会话数据
        this.currentCustomer = null;
        this.currentScenario = 'overdue_payment';
        this.conversationHistory = [];
        
        // ASR会话管理
        this.currentASRSessionId = null;
        this.isStreamingASRActive = false;
        this.streamingASRResults = [];
        
        // 初始化应用
        this.init();
    }

    createDebugLogger() {
        return (message) => {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[${timestamp}] ${message}`);
            
            // 同步到UI调试面板
            if (this.uiManager) {
                this.uiManager.appendDebugLog(message);
            }
        };
    }

    getServerUrl() {
        // 检查环境变量配置
        if (typeof window !== 'undefined' && window.SERVER_URL) {
            return window.SERVER_URL;
        }
        
        // 检查开发环境
        const isDevelopment = location.hostname === 'localhost' || 
                             location.hostname === '127.0.0.1' || 
                             location.hostname.includes('.local');
        
        if (isDevelopment) {
            return `ws://${location.hostname}:3004`;
        } else {
            const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${wsProtocol}//${location.host}`;
        }
    }

    async init() {
        this.debugLog('初始化AI催收助手 (WebSocket版本，重构版)...');
        
        try {
            // 初始化UI状态
            this.uiManager.initializeUIState();
            
            // 初始化延迟图表
            this.metricsManager.initLatencyChart();
            
            // 加载客户数据
            await this.uiManager.loadCustomers();
            
            // 绑定事件处理器
            this.bindEvents();
            
            // 初始化音频上下文
            await this.audioManager.initAudioContext();
            
            // 建立WebSocket连接
            await this.connectWebSocket();
            
            this.debugLog('AI催收助手初始化完成 (重构版)');
            
        } catch (error) {
            console.error('初始化失败:', error);
            this.debugLog('错误: 初始化失败 - ' + error.message);
        }
    }

    bindEvents() {
        // 创建事件处理器对象
        const eventHandlers = {
            onSessionToggle: () => {
                if (this.state.sessionActive) {
                    this.endSession();
                } else {
                    this.startSession();
                }
            },
            
            onResetSession: () => {
                this.resetSession();
            },
            
            onCustomerSelect: (customerId) => {
                this.selectCustomer(customerId);
            },
            
            onScenarioSelect: (scenario) => {
                this.currentScenario = scenario;
                this.debugLog('场景切换: ' + scenario);
            },
            
            onToggleListening: () => {
                this.toggleListening();
            },
            
            onTestAudio: () => {
                this.testAudio();
            }
        };
        
        // 绑定UI事件
        this.uiManager.bindEvents(eventHandlers);
    }

    async connectWebSocket() {
        // 设置WebSocket事件处理器
        this.setupWebSocketEventHandlers();
        
        // 连接WebSocket
        await this.webSocketManager.connect();
    }

    setupWebSocketEventHandlers() {
        // 连接状态变化
        this.webSocketManager.on('connection_status', (data) => {
            this.state.isConnected = data.status === 'online';
            this.uiManager.updateConnectionStatus(data.status, data.message);
        });

        // 文本响应
        this.webSocketManager.on('text_response', (data) => {
            this.uiManager.displayMessage('assistant', data.text);
        });

        // 延迟指标
        this.webSocketManager.on('latency_metrics', (data) => {
            this.metricsManager.updateServerLatencyMetrics(data.llm_latency, data.tts_latency);
        });

        // PCM音频块
        this.webSocketManager.on('pcm_chunk', async (data) => {
            await this.audioManager.playPCMChunkDirectly(data);
        });

        // PCM段落结束
        this.webSocketManager.on('pcm_segment_end', (data) => {
            this.debugLog(`PCM段落结束，共 ${data.chunk_count} 个数据块`);
        });

        // 用户语音识别完成 - 唯一触发AI响应的入口
        this.webSocketManager.on('user_speech_recognized', (data) => {
            this.uiManager.displayMessage('user', data.text);
            this.sendRecognizedTextToAI(data.text);
        });

        // ASR结果 - 仅用于显示实时识别结果
        this.webSocketManager.on('asr_result', (data) => {
            this.handleStreamingASRResult(data);
        });

        // ASR会话管理
        this.setupASREventHandlers();

        // 错误处理
        this.webSocketManager.on('error', (data) => {
            this.debugLog('WebSocket错误: ' + data.error);
        });
    }

    setupASREventHandlers() {
        this.webSocketManager.on('streaming_asr_started', (data) => {
            this.currentASRSessionId = data.session_id;
            this.isStreamingASRActive = true; // 🔧 修复：只有服务器确认后才设置为true
            this.debugLog(`✅ 流式ASR已启动确认 (session: ${data.session_id})`);
        });

        this.webSocketManager.on('asr_session_started', (data) => {
            this.currentASRSessionId = data.session_id;
            this.isStreamingASRActive = true; // 🔧 修复：服务器确认后设置
            this.debugLog(`✅ ASR会话已启动确认 (session: ${data.session_id})`);
        });

        this.webSocketManager.on('streaming_asr_error', (data) => {
            this.debugLog(`❌ 流式ASR错误: ${data.error}`);
            this.isStreamingASRActive = false; // 🔧 修复：错误时重置状态
            this.currentASRSessionId = null;   // 清理会话ID
        });

        this.webSocketManager.on('asr_session_failed', (data) => {
            this.debugLog(`❌ 流式ASR会话失败: ${data.error}`);
            this.isStreamingASRActive = false; // 🔧 修复：失败时重置状态  
            this.currentASRSessionId = null;   // 清理会话ID
        });

        this.webSocketManager.on('streaming_asr_stopped', (data) => {
            this.debugLog(`流式ASR已停止: ${data.session_id}`);
        });
    }

    // 客户选择
    selectCustomer(customerId) {
        if (!customerId) return;
        
        this.currentCustomer = this.uiManager.getCustomerById(customerId);
        if (this.currentCustomer) {
            this.uiManager.displayCustomerInfo(this.currentCustomer);
            this.debugLog('客户选择: ' + this.currentCustomer.name);
        }
    }

    // 会话管理
    async startSession() {
        if (!this.currentCustomer) {
            alert('请先选择一个客户');
            return;
        }

        if (!this.state.isConnected) {
            alert('WebSocket未连接，请检查服务器是否运行');
            return;
        }

        try {
            // 重置会话状态
            this.state.isListening = false;
            this.state.isRecording = false;
            this.state.customerHasResponded = false;
            this.state.sessionActive = true;
            
            // 设置会话
            this.setupSession();
            
            // 更新UI状态
            this.uiManager.updateSessionButtons(true);
            this.uiManager.updateConnectionStatus('online', 'WebSocket会话已就绪');
            
            // 开始持续监听和流式ASR - 🔧 修复：先启动ASR获取会话ID，再开始录音
            this.debugLog('📡 正在启动流式ASR...');
            await this.startStreamingASR(); // 先启动ASR获取session ID
            this.debugLog('✅ 流式ASR启动完成');
            
            await this.startContinuousListening(); // 然后启动监听和录音（现在有ASR session ID了）
            this.debugLog('✅ 持续监听已启动');
            
            this.debugLog('WebSocket会话开始 - 客户: ' + this.currentCustomer.name);
            
            // 播放初始问候语
            this.speakInitialGreeting();
            
        } catch (error) {
            console.error('启动会话失败:', error);
            
            // 如果ASR启动失败，显示具体错误信息
            let errorMessage = '会话启动失败';
            if (error.message.includes('ASR')) {
                errorMessage = `ASR初始化失败: ${error.message}`;
            } else {
                errorMessage = `会话启动失败: ${error.message}`;
            }
            
            this.uiManager.updateConnectionStatus('offline', errorMessage);
            alert(errorMessage);
            
            // 清理失败的会话状态
            this.state.sessionActive = false;
            this.uiManager.updateSessionButtons(false);
        }
    }

    setupSession() {
        this.conversationHistory = [];
        this.metricsManager.startSession();
    }

    endSession() {
        this.metricsManager.endSession();
        
        // 停止流式ASR会话
        this.stopStreamingASR();
        
        // 停止持续监听
        this.stopContinuousListening();
        
        // 停止当前播放的音频
        this.audioManager.stopCurrentAudio();
        
        this.state.sessionActive = false;
        this.uiManager.updateSessionButtons(false);
        this.uiManager.updateConnectionStatus('offline', 'WebSocket会话已结束');
        
        this.debugLog('WebSocket会话结束');
    }

    resetSession() {
        this.debugLog('正在重置会话...');
        this.endSession();
        
        // 重置数据
        this.conversationHistory = [];
        this.state = {
            isConnected: this.state.isConnected, // 保持连接状态
            isRecording: false,
            isListening: false,
            sessionActive: false,
            customerHasResponded: false
        };
        
        this.currentASRSessionId = null;
        this.isStreamingASRActive = false;
        this.streamingASRResults = [];
        
        // 重置管理器状态
        this.metricsManager.resetMetrics();
        this.uiManager.resetUI();
        
        this.currentCustomer = null;
        this.debugLog('WebSocket会话已重置');
    }

    // 监听和录音管理
    async toggleListening() {
        if (this.state.isListening) {
            this.stopContinuousListening();
        } else {
            await this.startContinuousListening();
        }
    }

    async startContinuousListening() {
        if (this.state.isListening) {
            this.debugLog('监听已在运行，跳过重复启动');
            return;
        }

        try {
            const success = await this.audioManager.startContinuousListening();
            if (success) {
                this.state.isListening = true;
                this.uiManager.updateListeningUI(true);
                
                // 开始语音活动检测
                this.audioManager.startVoiceActivityDetection((volume) => {
                    if (this.audioManager.isPlayingAudio) {
                        this.audioManager.stopCurrentAudio();
                        this.debugLog(`客户开始说话(音量: ${volume.toFixed(1)})，中断代理音频`);
                    }
                });
                
                // 开始连续录音
                await this.startContinuousRecording();
                
                this.debugLog('持续监听已开启');
            }
        } catch (error) {
            console.error('开始持续监听失败:', error);
            this.state.isListening = false;
            alert('无法开启麦克风，请确保已授权麦克风权限');
        }
    }

    stopContinuousListening() {
        if (!this.state.isListening) {
            this.debugLog('监听未在运行，跳过停止操作');
            return;
        }

        this.audioManager.stopContinuousListening();
        this.state.isListening = false;
        this.uiManager.updateListeningUI(false);
        this.debugLog('持续监听已关闭');
    }

    async startContinuousRecording() {
        if (!this.currentASRSessionId) {
            this.debugLog('ASR会话未建立，等待中...');
            // 等待ASR会话建立
            let waitCount = 0;
            while (!this.currentASRSessionId && waitCount < 10) {
                await new Promise(resolve => setTimeout(resolve, 200));
                waitCount++;
            }
            
            if (!this.currentASRSessionId) {
                this.debugLog('ASR会话建立超时');
                return;
            }
        }

        const success = await this.audioManager.startContinuousRecording(
            this.currentASRSessionId,
            async (sessionId, opusData) => {
                // 发送音频块到ASR
                return this.webSocketManager.sendOpusChunk(sessionId, opusData);
            }
        );

        if (success) {
            this.state.isRecording = true;
            this.debugLog('连续录音已启动');
        }
    }

    // 流式ASR管理
    async startStreamingASR() {
        if (this.isStreamingASRActive) {
            this.debugLog('流式ASR已激活，跳过重复启动');
            return;
        }
        
        try {
            const sessionId = `asr_${Date.now()}`;
            
            // 🔧 修复：返回Promise，等待服务器确认
            return new Promise((resolve, reject) => {
                // 设置超时
                const timeout = setTimeout(() => {
                    this.webSocketManager.off('streaming_asr_started', onSuccess);
                    this.webSocketManager.off('streaming_asr_error', onError);
                    reject(new Error('ASR启动超时'));
                }, 10000); // 10秒超时
                
                const onSuccess = (data) => {
                    clearTimeout(timeout);
                    this.webSocketManager.off('streaming_asr_started', onSuccess);
                    this.webSocketManager.off('streaming_asr_error', onError);
                    this.debugLog(`✅ ASR启动成功确认: ${data.session_id}`);
                    resolve(data);
                };
                
                const onError = (error) => {
                    clearTimeout(timeout);
                    this.webSocketManager.off('streaming_asr_started', onSuccess);
                    this.webSocketManager.off('streaming_asr_error', onError);
                    this.debugLog(`❌ ASR启动失败: ${error.error}`);
                    reject(new Error(error.error || 'ASR启动失败'));
                };
                
                // 临时监听确认事件
                this.webSocketManager.on('streaming_asr_started', onSuccess);
                this.webSocketManager.on('streaming_asr_error', onError);
                
                // 发送ASR启动请求
                this.webSocketManager.startStreamingASR(sessionId);
                this.debugLog(`📤 ASR启动请求已发送，等待服务器确认... (session: ${sessionId})`);
            });
            
        } catch (error) {
            console.error('启动流式ASR失败:', error);
            throw error; // 重新抛出错误，让调用方处理
        }
    }
    
    async stopStreamingASR() {
        if (!this.isStreamingASRActive || !this.currentASRSessionId) {
            return;
        }
        
        try {
            this.webSocketManager.stopStreamingASR(this.currentASRSessionId);
            this.isStreamingASRActive = false;
            this.currentASRSessionId = null;
            
        } catch (error) {
            console.error('停止流式ASR失败:', error);
        }
    }

    handleStreamingASRResult(data) {
        if (!data || (!data.result && !data.text)) {
            this.debugLog('收到无效的ASR结果');
            return;
        }
        
        try {
            const text = data.text || '';
            const confidence = data.confidence || 0;
            const isPartial = data.is_partial || false;
            const isFinal = data.is_final || false;
            const latency = data.latency_ms || 0;
            
            if (text) {
                this.debugLog(`🎙️ ASR实时结果: "${text}" (置信度: ${confidence.toFixed(2)}, ${isFinal ? '最终' : '部分'}, ${latency}ms)`);
                
                // 保存结果用于调试和指标
                this.streamingASRResults.push({
                    text: text,
                    confidence: confidence,
                    is_final: isFinal,
                    timestamp: Date.now(),
                    latency_ms: latency
                });
                
                // 更新ASR延迟指标
                if (latency > 0) {
                    this.metricsManager.updateASRLatencyMetrics(latency);
                }
            }
            
        } catch (error) {
            console.error('处理ASR结果失败:', error);
        }
    }

    // AI响应处理
    sendRecognizedTextToAI(text) {
        try {
            if (!text.trim()) {
                this.debugLog('识别文本为空，跳过AI处理');
                return;
            }
            
            // 停止当前播放的音频
            this.audioManager.stopCurrentAudio();
            
            // 标记客户开始回应
            this.state.customerHasResponded = true;
            
            // 记录服务器请求开始时间
            this.audioManager.serverRequestStartTime = Date.now();
            
            // 通过WebSocket发送消息进行AI处理
            this.webSocketManager.sendChatMessage({
                message: text,
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
            });
            
            // 更新会话统计
            this.updateSessionStats();
            
            this.debugLog('识别文本已发送给AI处理: ' + text);
            
        } catch (error) {
            console.error('发送识别文本到AI失败:', error);
        }
    }

    updateSessionStats() {
        // 更新对话历史
        this.conversationHistory.push({
            sender: 'user',
            text: '客户消息',
            timestamp: Date.now()
        });
        
        this.metricsManager.incrementTurnCount();
    }

    // 初始问候语
    async speakInitialGreeting() {
        try {
            const customer = this.currentCustomer;
            
            // 停止当前播放的音频
            this.audioManager.stopCurrentAudio();
            
            // 等待2秒看客户是否回应
            this.debugLog('等待客户回应...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 如果客户在2秒内没有回应，继续问候流程
            if (!this.state.customerHasResponded) {
                this.debugLog('客户未回应，继续问候流程');
                await this.continueGreetingSequence(customer);
            }
            
        } catch (error) {
            console.error('播放初始问候失败:', error);
            this.debugLog('初始问候失败: ' + error.message);
        }
    }

    async continueGreetingSequence(customer) {
        try {
            // 合并问候信息为单一连续消息
            const fullGreeting = [
                `${customer.name}您好，我是平安银行催收专员，工号888888。`,
                `根据我行记录，您有一笔${this.audioManager.formatChineseAmount(customer.balance)}的逾期本金，逾期了${customer.daysOverdue}天，已上报征信系统。`,
                `请问您现在方便谈论还款安排吗？`
            ].join('');
            
            this.debugLog(`播放完整问候语: ${fullGreeting}`);
            
            // 显示完整文本
            this.uiManager.displayMessage('assistant', fullGreeting);
            
            // 通过WebSocket生成并播放单一连续音频流
            this.webSocketManager.sendChatMessage({
                message: fullGreeting,
                messageType: 'agent_greeting'
            });
            
            this.debugLog('完整问候语已发送，等待客户回复');
            
        } catch (error) {
            console.error('问候序列播放失败:', error);
            this.debugLog('问候序列失败: ' + error.message);
        }
    }

    // 测试音频功能
    async testAudio() {
        try {
            const testMessage = '你好，这是一个测试消息。请确认你能听到清晰的中文语音。';
            
            this.webSocketManager.sendChatMessage({
                message: testMessage,
                messageType: 'agent_greeting'
            });
            
            this.debugLog('音频测试完成');
            
        } catch (error) {
            console.error('音频测试失败:', error);
            this.debugLog('音频测试失败: ' + error.message);
        }
    }

    // 获取应用状态
    getState() {
        return {
            ...this.state,
            currentCustomer: this.currentCustomer,
            currentScenario: this.currentScenario,
            conversationHistory: [...this.conversationHistory],
            currentASRSessionId: this.currentASRSessionId,
            isStreamingASRActive: this.isStreamingASRActive,
            webSocketStatus: this.webSocketManager.getConnectionStatus(),
            uiState: this.uiManager.getUIState(),
            metrics: this.metricsManager.getMetrics()
        };
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('页面加载完成，初始化AI催收助手 (WebSocket版本，重构版)...');
    window.aiAgent = new AICollectionAgentWS();
});

// 导出类以便测试
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AICollectionAgentWS;
}