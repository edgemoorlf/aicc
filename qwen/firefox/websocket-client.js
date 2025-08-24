/**
 * AI催收助手 - Firefox OGG/Opus优化版本
 * 支持直接OGG/Opus流式传输，零转换延迟
 * 专为Firefox浏览器的原生OGG/Opus支持优化
 */

class AICollectionAgentWS {
    constructor() {
        this.isConnected = false;
        this.isRecording = false;
        this.isListening = false;
        this.sessionActive = false;
        this.currentCustomer = null;
        this.currentScenario = 'overdue_payment';
        this.conversationHistory = [];
        this.customerHasResponded = false;
        this.metrics = {
            latency: [],
            accuracy: [],
            sessionStart: null,
            turnCount: 0,
            // 详细延迟指标
            asrLatency: [],
            llmLatency: [],
            ttsLatency: [],
            endToEndLatency: []
        };
        
        // WebSocket相关
        this.socket = null;
        this.serverUrl = this.getServerUrl();
        
        // Audio相关
        this.audioContext = null;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.audioChunks = [];
        this.analyser = null;
        this.silenceTimeout = null;
        this.currentAudio = null;
        this.isPlayingAudio = false;
        this.audioQueue = [];
        
        // 流式PCM播放相关
        this.pcmAudioQueue = [];
        this.pcmIsPlaying = false;
        this.pcmGainNode = null;
        this.pcmNextStartTime = 0;
        this.pcmChunkBuffer = new Map(); // 缓存乱序到达的PCM块
        this.expectedChunkIndex = 1; // 期望的下一个块索引
        this.currentSegmentIndex = -1; // 当前段落索引
        this.activePCMSources = []; // 🔧 新增：跟踪所有活跃的PCM音频源
        
        // 延迟图表相关
        this.latencyChart = null;
        this.latencyChartData = [];
        this.maxLatencyDataPoints = 20;
        
        // 流式ASR相关
        this.currentASRSessionId = null;
        this.isStreamingASRActive = false;
        this.streamingASRResults = [];
        
        // 初始化
        this.init();
    }

    getServerUrl() {
        // 检查是否有环境变量配置
        if (typeof window !== 'undefined' && window.SERVER_URL) {
            return window.SERVER_URL;
        }
        
        // 检查是否在开发环境
        const isDevelopment = location.hostname === 'localhost' || 
                             location.hostname === '127.0.0.1' || 
                             location.hostname.includes('.local');
        
        if (isDevelopment) {
            return `ws://${location.hostname}:3004`;
        } else {
            // Convert HTTP to WebSocket protocol
            const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${wsProtocol}//${location.host}`;
        }
    }

    async init() {
        console.log('初始化AI催收助手 (WebSocket版本)...');
        
        // 初始化UI状态
        this.initializeUIState();
        
        // 加载客户数据
        await this.loadCustomers();
        
        // 绑定事件
        this.bindEvents();
        
        // 初始化音频上下文
        this.initAudioContext();
        
        // 建立WebSocket连接
        await this.connectWebSocket();
        
        console.log('AI催收助手初始化完成');
        this.debugLog('系统初始化完成 (WebSocket模式)');
    }

    initializeUIState() {
        // 确保指标面板初始状态正确 - 默认隐藏，对话区域占满宽度
        const mainInterface = document.getElementById('main-interface');
        const dashboard = document.getElementById('metrics-dashboard');
        
        if (dashboard && dashboard.style.display === 'none') {
            mainInterface.classList.add('metrics-hidden');
        }
        
        // 初始化延迟图表
        this.initLatencyChart();
    }

    initLatencyChart() {
        const canvas = document.getElementById('latency-chart');
        if (!canvas) return;
        
        this.latencyChart = {
            canvas: canvas,
            ctx: canvas.getContext('2d'),
            width: canvas.width,
            height: canvas.height
        };
        
        // 设置画布样式
        const ctx = this.latencyChart.ctx;
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, this.latencyChart.width, this.latencyChart.height);
        
        // 绘制初始网格和标签
        this.drawLatencyChartGrid();
        
        this.debugLog('延迟图表初始化完成');
    }

    drawLatencyChartGrid() {
        const { ctx, width, height } = this.latencyChart;
        
        // 清空画布
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, width, height);
        
        // 设置网格样式
        ctx.strokeStyle = '#e9ecef';
        ctx.lineWidth = 1;
        
        // 绘制水平网格线（延迟值）
        const maxLatency = 5000; // 最大显示5秒延迟
        const gridLines = 5;
        for (let i = 0; i <= gridLines; i++) {
            const y = (height - 20) * i / gridLines + 10;
            ctx.beginPath();
            ctx.moveTo(30, y);
            ctx.lineTo(width - 10, y);
            ctx.stroke();
            
            // 绘制延迟标签
            const latencyValue = maxLatency - (maxLatency * i / gridLines);
            ctx.fillStyle = '#6c757d';
            ctx.font = '10px Arial';
            ctx.fillText(`${Math.round(latencyValue)}ms`, 2, y + 3);
        }
        
        // 绘制垂直网格线（时间轴）
        const timeGridLines = 4;
        for (let i = 0; i <= timeGridLines; i++) {
            const x = 30 + (width - 40) * i / timeGridLines;
            ctx.beginPath();
            ctx.moveTo(x, 10);
            ctx.lineTo(x, height - 10);
            ctx.stroke();
        }
        
        // 添加标题
        ctx.fillStyle = '#495057';
        ctx.font = '12px Arial';
        ctx.fillText('实时延迟 (ms)', 5, height - 2);
    }

    updateLatencyChart(newLatency) {
        if (!this.latencyChart) return;
        
        // 添加新的数据点
        this.latencyChartData.push({
            latency: newLatency,
            timestamp: Date.now()
        });
        
        // 保持最大数据点数量
        if (this.latencyChartData.length > this.maxLatencyDataPoints) {
            this.latencyChartData.shift();
        }
        
        // 重新绘制图表
        this.drawLatencyChart();
    }

    drawLatencyChart() {
        if (!this.latencyChart || this.latencyChartData.length === 0) return;
        
        const { ctx, width, height } = this.latencyChart;
        
        // 重绘网格
        this.drawLatencyChartGrid();
        
        // 准备绘制数据线
        const maxLatency = 5000; // 最大显示5秒延迟
        const chartWidth = width - 40;
        const chartHeight = height - 20;
        const dataPoints = this.latencyChartData.length;
        
        if (dataPoints < 2) return;
        
        // 绘制延迟曲线
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        for (let i = 0; i < dataPoints; i++) {
            const latency = Math.min(this.latencyChartData[i].latency, maxLatency);
            const x = 30 + (chartWidth * i / (this.maxLatencyDataPoints - 1));
            const y = 10 + chartHeight * (1 - latency / maxLatency);
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        
        // 绘制数据点
        ctx.fillStyle = '#007bff';
        for (let i = 0; i < dataPoints; i++) {
            const latency = Math.min(this.latencyChartData[i].latency, maxLatency);
            const x = 30 + (chartWidth * i / (this.maxLatencyDataPoints - 1));
            const y = 10 + chartHeight * (1 - latency / maxLatency);
            
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // 显示最新延迟值
        if (dataPoints > 0) {
            const latestLatency = this.latencyChartData[dataPoints - 1].latency;
            ctx.fillStyle = '#28a745';
            ctx.font = 'bold 12px Arial';
            ctx.fillText(`${latestLatency}ms`, width - 60, 25);
        }
    }

    async connectWebSocket() {
        try {
            // 使用Socket.IO客户端
            this.socket = io(this.serverUrl);
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.updateConnectionStatus('online', 'WebSocket已连接');
                this.debugLog('WebSocket连接成功');
            });

            this.socket.on('disconnect', () => {
                this.isConnected = false;
                this.updateConnectionStatus('offline', 'WebSocket已断开');
                this.debugLog('WebSocket连接断开');
            });

            this.socket.on('connected', (data) => {
                this.debugLog('服务器确认连接: ' + data.status);
            });

            this.socket.on('text_response', (data) => {
                // 显示完整文本回复
                this.displayMessage('assistant', data.text);
                this.debugLog('收到文本回复: ' + data.text.substring(0, 50) + '...');
            });

            this.socket.on('latency_metrics', (data) => {
                // 接收服务器端延迟指标
                this.debugLog(`🔄 服务器延迟指标 - LLM: ${data.llm_latency}ms, TTS: ${data.tts_latency}ms`);
                this.updateServerLatencyMetrics(data.llm_latency, data.tts_latency);
            });

            this.socket.on('pcm_chunk', async (data) => {
                // 接收并立即播放PCM数据块
                this.debugLog(`收到PCM数据块 ${data.chunk_index} (段落 ${data.segment_index + 1}/${data.total_segments}): ${data.pcm_data.length} bytes`);
                await this.playPCMChunkDirectly(data);
            });

            this.socket.on('pcm_segment_end', (data) => {
                // PCM段落结束
                this.debugLog(`PCM段落 ${data.segment_index + 1}/${data.total_segments} 结束，共 ${data.chunk_count} 个数据块`);
            });

            this.socket.on('audio_segment', (data) => {
                // 兼容旧版本音频段落（非流式）
                this.debugLog(`收到音频段落 ${data.segment_index + 1}/${data.total_segments}`);
                this.audioQueue.push(data);
                this.processAudioQueue();
            });

            // ====== 流式ASR事件处理 ======
            this.socket.on('asr_connected', (data) => {
                this.debugLog(`流式ASR已连接: ${data.session_id}`);
            });

            this.socket.on('asr_result', (data) => {
                this.handleStreamingASRResult(data);
            });

            this.socket.on('user_speech_recognized', (data) => {
                // 🚨 关键：这是触发AI响应的唯一入口！
                // 服务器端已完成句子完整性检测，确保不会重复响应
                this.displayMessage('user', data.text);
                this.debugLog(`✅ 完整句子识别完成: ${data.text} (方法: ${data.completion_method || 'unknown'})`);
                
                // 发送给AI处理 - 这是唯一应该触发AI响应的地方
                this.sendRecognizedTextToAI(data.text);
            });

            this.socket.on('streaming_asr_started', (data) => {
                this.currentASRSessionId = data.session_id;
                this.debugLog(`流式ASR会话启动: ${data.session_id}`);
            });

            this.socket.on('asr_session_started', (data) => {
                this.currentASRSessionId = data.session_id;
                this.debugLog(`流式ASR会话启动: ${data.session_id}`);
            });

            this.socket.on('streaming_asr_error', (data) => {
                this.debugLog(`流式ASR会话启动失败: ${data.error}`);
            });

            this.socket.on('asr_session_failed', (data) => {
                this.debugLog(`流式ASR会话启动失败: ${data.error}`);
            });

            this.socket.on('asr_error', (data) => {
                this.debugLog(`流式ASR错误: ${data.error}`);
            });

            this.socket.on('asr_completed', (data) => {
                this.debugLog(`流式ASR识别完成: ${data.session_id}`);
            });
            // ====== 结束流式ASR事件处理 ======

            this.socket.on('error', (data) => {
                console.error('WebSocket错误:', data.error);
                this.debugLog('WebSocket错误: ' + data.error);
            });

        } catch (error) {
            console.error('WebSocket连接失败:', error);
            this.updateConnectionStatus('offline', 'WebSocket连接失败');
            this.debugLog('WebSocket连接失败: ' + error.message);
        }
    }

    async processAudioQueue() {
        // 如果当前正在播放音频，等待完成
        if (this.isPlayingAudio) {
            return;
        }

        // 播放队列中的下一个音频段落
        if (this.audioQueue.length > 0) {
            const audioData = this.audioQueue.shift();
            await this.playAudioSegment(audioData);
            
            // 播放完成后，检查是否还有更多段落
            if (this.audioQueue.length > 0) {
                setTimeout(() => this.processAudioQueue(), 100);
            }
        }
    }

    async playPCMChunkDirectly(data) {
        try {
            // 计算多种延迟指标 - 第一个PCM块到达时计算
            if (data.chunk_index === 1 && data.segment_index === 0) {
                const now = Date.now();
                
                // 🔧 关键修复：新的代理回复开始，停止任何之前的音频播放
                this.stopCurrentAudio();
                this.debugLog('🛑 新的代理回复开始，停止之前的音频');
                
                // 1. 真实流式延迟：从服务器请求到首个音频块
                if (this.serverRequestStartTime) {
                    const serverToAudioLatency = now - this.serverRequestStartTime;
                    this.debugLog(`🚀 服务器处理延迟: ${serverToAudioLatency}ms (请求→音频)`);
                    this.updateLatencyMetrics(serverToAudioLatency);
                }
                
                // 2. 端到端延迟：从客户停止说话到音频开始
                if (this.customerStopTime) {
                    const endToEndLatency = now - this.customerStopTime;
                    this.debugLog(`⏱️ 端到端延迟: ${endToEndLatency}ms (停止说话→音频)`);
                }
                
                // 3. ASR处理时间：从停止说话到发送请求
                if (this.customerStopTime && this.serverRequestStartTime) {
                    const asrProcessingTime = this.serverRequestStartTime - this.customerStopTime;
                    this.debugLog(`🎤 ASR处理时间: ${asrProcessingTime}ms (停止说话→请求发送)`);
                }
                
                // 重置序列化播放状态 - 新的音频流开始
                this.resetPCMSequencing();
            }
            
            // 将PCM块添加到缓存中，等待按序播放
            const chunkKey = `${data.segment_index}-${data.chunk_index}`;
            this.pcmChunkBuffer.set(chunkKey, data);
            
            this.debugLog(`收到PCM块: 段落${data.segment_index + 1}, 块${data.chunk_index}, 缓存大小: ${this.pcmChunkBuffer.size}`);
            
            // 尝试播放缓存中的顺序块
            await this.processSequentialPCMChunks();
            
        } catch (error) {
            console.error('处理PCM数据块失败:', error);
            this.debugLog('PCM处理错误: ' + error.message);
        }
    }

    resetPCMSequencing() {
        // 清空缓存和重置状态
        this.pcmChunkBuffer.clear();
        this.expectedChunkIndex = 1;
        this.currentSegmentIndex = -1;
        this.pcmNextStartTime = 0; // 重置播放时间基准
        this.debugLog('PCM序列化播放状态已重置');
    }

    async processSequentialPCMChunks() {
        let processedAny = false;
        
        // 由于现在使用单一连续流，所有块都属于segment 0
        // 只需要按chunk_index顺序处理即可
        while (true) {
            const targetSegment = 0; // 始终使用segment 0
            const expectedKey = `${targetSegment}-${this.expectedChunkIndex}`;
            const chunkData = this.pcmChunkBuffer.get(expectedKey);
            
            if (chunkData) {
                // 找到期望的块，立即播放
                await this.playPCMChunkInSequence(chunkData);
                this.pcmChunkBuffer.delete(expectedKey);
                this.expectedChunkIndex++;
                processedAny = true;
                
                this.debugLog(`播放连续PCM块: 块${this.expectedChunkIndex - 1}`);
            } else {
                // 没有找到期望的块，等待后续块到达
                break;
            }
        }
        
        if (processedAny) {
            this.debugLog(`连续流处理完成，剩余缓存: ${this.pcmChunkBuffer.size} 块`);
        }
    }

    async playPCMChunkInSequence(data) {
        try {
            // 确保音频上下文已激活
            if (!this.audioContext) {
                await this.initAudioContext();
            }
            
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // 创建PCM数据的AudioBuffer
            const pcmData = new Uint8Array(data.pcm_data);
            const sampleRate = data.sample_rate || 24000;
            const channels = data.channels || 1;
            const bitsPerSample = data.bits_per_sample || 16;
            
            // 将PCM数据转换为Float32Array
            const samples = this.convertPCMToFloat32(pcmData, bitsPerSample);
            const sampleCount = samples.length;
            
            if (sampleCount === 0) {
                this.debugLog('跳过空的PCM数据块');
                return;
            }
            
            // 创建AudioBuffer
            const audioBuffer = this.audioContext.createBuffer(channels, sampleCount, sampleRate);
            audioBuffer.copyToChannel(samples, 0);
            
            // 创建音频源
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            
            // 🔧 跟踪音频源以便后续停止
            this.activePCMSources.push(source);
            
            // 创建增益节点用于音量控制
            if (!this.pcmGainNode) {
                this.pcmGainNode = this.audioContext.createGain();
                this.pcmGainNode.connect(this.audioContext.destination);
            }
            
            source.connect(this.pcmGainNode);
            
            // 计算精确的播放时间，确保无缝连接
            const currentTime = this.audioContext.currentTime;
            const duration = sampleCount / sampleRate;
            
            // 对于第一个块，立即开始播放
            let startTime;
            if (this.pcmNextStartTime === 0 || currentTime > this.pcmNextStartTime + 0.1) {
                // 第一个块或时间过期，立即开始
                startTime = Math.max(currentTime + 0.01, currentTime); // 小缓冲避免immediate start问题
                this.pcmNextStartTime = startTime + duration;
            } else {
                // 连续播放，确保无间隙
                startTime = this.pcmNextStartTime;
                this.pcmNextStartTime += duration;
            }
            
            // 播放PCM数据块
            source.start(startTime);
            
            // 记录第一个PCM块开始播放的时间
            if (data.chunk_index === 1 && data.segment_index === 0) {
                this.agentStartTime = Date.now();
                this.debugLog('代理开始流式播放PCM音频');
            }
            
            this.debugLog(`序列播放PCM: ${pcmData.length}字节, 时长: ${duration.toFixed(3)}s, 开始时间: ${startTime.toFixed(3)}s, 活跃源: ${this.activePCMSources.length}`);
            
            // 标记正在播放
            this.isPlayingAudio = true;
            this.pcmIsPlaying = true;
            
            // 设置播放结束回调 - 从活跃源列表中移除
            source.onended = () => {
                const index = this.activePCMSources.indexOf(source);
                if (index > -1) {
                    this.activePCMSources.splice(index, 1);
                }
                this.debugLog(`PCM块播放完成: 段落${data.segment_index + 1}, 块${data.chunk_index}, 剩余源: ${this.activePCMSources.length}`);
            };
            
        } catch (error) {
            console.error('序列播放PCM数据块失败:', error);
            this.debugLog('PCM序列播放错误: ' + error.message);
        }
    }

    convertPCMToFloat32(pcmData, bitsPerSample) {
        const samples = new Float32Array(pcmData.length / (bitsPerSample / 8));
        
        if (bitsPerSample === 16) {
            // 16位PCM转换
            for (let i = 0; i < samples.length; i++) {
                const offset = i * 2;
                const sample = (pcmData[offset] | (pcmData[offset + 1] << 8));
                // 转换为有符号16位
                const signedSample = sample > 32767 ? sample - 65536 : sample;
                // 归一化到[-1, 1]
                samples[i] = signedSample / 32768.0;
            }
        } else if (bitsPerSample === 8) {
            // 8位PCM转换
            for (let i = 0; i < samples.length; i++) {
                const sample = pcmData[i];
                // 8位PCM通常是无符号的，范围0-255
                samples[i] = (sample - 128) / 128.0;
            }
        } else {
            throw new Error(`不支持的PCM位深: ${bitsPerSample}`);
        }
        
        return samples;
    }

    async playAudioSegment(audioData) {
        try {
            if (!audioData.audio || audioData.audio.length === 0) {
                this.debugLog('音频段落为空，跳过播放');
                return;
            }

            // 停止当前正在播放的音频
            this.stopCurrentAudio();
            
            // 确保音频上下文已激活
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // 创建音频Blob并播放
            const audioBlob = new Blob([new Uint8Array(audioData.audio)], { type: 'audio/wav' });
            return await this.playAudioResponse(audioBlob);
            
        } catch (error) {
            console.error('播放音频段落失败:', error);
            this.debugLog('音频段落播放错误: ' + error.message);
            this.isPlayingAudio = false;
            throw error;
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

        // 指标面板切换（内部切换）
        document.getElementById('toggle-metrics').addEventListener('click', () => {
            this.toggleMetrics();
        });

        // 指标监控切换（显示/隐藏整个面板）
        document.getElementById('metrics-toggle').addEventListener('click', () => {
            this.toggleMetricsDashboard();
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

    getBestMediaRecorderFormat() {
        // 基于兼容性分析的格式选择策略
        const userAgent = navigator.userAgent;
        
        // Safari兼容性检查
        if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) {
            this.debugLog("警告: Safari对MediaRecorder支持有限");
            // Safari主要支持MP4格式
            if (typeof MediaRecorder !== 'undefined' && 
                MediaRecorder.isTypeSupported && 
                MediaRecorder.isTypeSupported("audio/mp4")) {
                this.debugLog("使用Safari兼容格式: audio/mp4");
                return "audio/mp4";
            } else {
                this.debugLog("Safari MediaRecorder支持检测失败，使用WebM回退");
            }
        }
        
        // Chrome/Firefox/Edge - 使用WebM/Opus格式 (73.4%市场覆盖)
        const formats = [
            "audio/ogg;codecs=opus",   // 首选 - Firefox原生支持，零延迟
            "audio/ogg"                // 回退 - OGG基础格式
        ];
        
        for (const format of formats) {
            if (typeof MediaRecorder !== 'undefined' && 
                MediaRecorder.isTypeSupported && 
                MediaRecorder.isTypeSupported(format)) {
                this.debugLog(`选择MediaRecorder格式: ${format}`);
                return format;
            }
        }
        
        // 最后回退 - 基础WebM格式
        this.debugLog("回退到基础WebM格式");
        return "audio/ogg";
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
            alert('WebSocket未连接，请检查服务器是否运行');
            return;
        }

        try {
            // 确保监听状态重置
            this.isListening = false;
            this.isRecording = false;
            this.customerHasResponded = false;
            
            // 设置会话
            this.setupSession();
            this.sessionActive = true;
            
            this.updateConnectionStatus('online', 'WebSocket会话已就绪');
            
            // 更新按钮状态
            this.updateSessionButtons();
            
            // 自动开始持续监听
            await this.startContinuousListening();
            
            // 启动流式ASR会话
            await this.startStreamingASR();
            
            this.debugLog('WebSocket会话开始 - 客户: ' + this.currentCustomer.name);
            
            // 立即播放初始问候语
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
        this.audioQueue = [];
        
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

    // 切换监听模式
    async toggleListening() {
        if (this.isListening) {
            this.stopContinuousListening();
        } else {
            await this.startContinuousListening();
        }
    }

    // 开始持续监听
    async startContinuousListening() {
        if (this.isListening) {
            this.debugLog('监听已在运行，跳过重复启动');
            return;
        }

        try {
            this.debugLog('正在启动持续监听...');
            
            // 获取麦克风权限 - 配置为8kHz以匹配DashScope 8k模型
            this.audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 8000,  // 改为8kHz匹配paraformer-realtime-8k-v2
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true, // 自动增益控制
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true, // 高通滤波器，过滤低频噪音
                    googTypingNoiseDetection: true, // 键盘噪音检测
                    googAudioMirroring: false
                } 
            });

            // 创建音频分析器用于语音活动检测
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = this.audioContext || new AudioContextClass();
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;  // 🔧 增加FFT大小，提高频率分析精度
            this.analyser.smoothingTimeConstant = 0.8;  // 🔧 平滑处理，减少噪音波动
            source.connect(this.analyser);

            this.isListening = true;
            this.updateListeningUI(true);
            
            // 开始语音活动检测
            this.startVoiceActivityDetection();
            
            this.debugLog('持续监听已开启，状态: ' + this.isListening);

        } catch (error) {
            console.error('开始持续监听失败:', error);
            this.debugLog('错误: 持续监听失败 - ' + error.message);
            this.isListening = false; // 确保失败时状态正确
            alert('无法开启麦克风，请确保已授权麦克风权限');
        }
    }

    // 停止持续监听
    stopContinuousListening() {
        if (!this.isListening) {
            this.debugLog('监听未在运行，跳过停止操作');
            return;
        }

        this.debugLog('正在停止持续监听...');
        this.isListening = false;
        
        // 停止连续录音
        this.stopContinuousRecording();
        
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        
        this.updateListeningUI(false);
        this.debugLog('持续监听已关闭，状态: ' + this.isListening);
    }

    // 语音活动检测
    startVoiceActivityDetection() {
        // 🔧 电话模式：始终录音，让DashScope处理语音检测和句子分割
        // 客户端只负责在人声时中断代理播放（电话礼貌）
        
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const detectVoice = () => {
            if (!this.isListening) return;

            this.analyser.getByteFrequencyData(dataArray);
            
            // 简单音量检测 - 只用于中断代理播放，不控制录音开关
            const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
            const interruptThreshold = 40; // 降低阈值，任何人声都会中断代理
            
            if (average > interruptThreshold) {
                // 如果代理正在说话，立即停止（电话礼貌：客户说话时代理停止）
                if (this.isPlayingAudio) {
                    this.stopCurrentAudio();
                    this.debugLog(`客户开始说话(音量: ${average.toFixed(1)})，中断代理音频`);
                }
            }
            
            requestAnimationFrame(detectVoice);
        };

        // 🔧 电话模式：立即开始连续录音，让DashScope ASR处理一切
        this.startContinuousRecording();
        detectVoice();
    }

    // 电话模式：持续录音并实时发送到DashScope ASR
    async startContinuousRecording() {
        if (this.isRecording) {
            this.debugLog('连续录音已在运行，跳过重复启动');
            return;
        }

        try {
            this.debugLog('🎙️ 启动电话模式连续录音...');
            
            // 创建MediaRecorder用于连续录音 - 使用OGG/Opus格式
            const mimeType = this.getBestMediaRecorderFormat();
            this.mediaRecorder = new MediaRecorder(this.audioStream, {
                mimeType: mimeType,
                audioBitsPerSecond: 16000  // 16kbps适合语音
            });

            this.isRecording = true;
            this.audioChunks = [];
            
            // 设置数据处理 - 每100ms获取一次音频数据
            this.mediaRecorder.ondataavailable = async (event) => {
                
                if (event.data.size > 0) {
                    this.debugLog(`📊 MediaRecorder数据块: ${event.data.size} bytes, Type: ${event.data.type}`);
                    // 检查ASR会话是否已就绪，如果没有则等待
                    if (!this.currentASRSessionId && this.isStreamingASRActive) {
                        this.debugLog('⏳ 等待ASR会话建立...');
                        // 等待最多500ms让ASR会话建立
                        let waitCount = 0;
                        while (!this.currentASRSessionId && waitCount < 5) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                            waitCount++;
                        }
                    }
                    
                    if (this.currentASRSessionId) {
                        // 立即发送OGG/Opus数据到服务器ASR
                        try {
                            const arrayBuffer = await event.data.arrayBuffer();
                            const opusData = new Uint8Array(arrayBuffer);
                            
                            // 直接发送到DashScope ASR（零转换延迟）
                            this.socket.emit('send_opus_chunk', {
                                session_id: this.currentASRSessionId,
                                opus_data: Array.from(opusData)
                            });
                            
                            this.debugLog(`📤 发送连续OGG/Opus块: ${opusData.length} bytes`);
                        } catch (error) {
                            this.debugLog(`发送连续音频块失败: ${error.message}`);
                        }
                    } else {
                        this.debugLog('⚠️ ASR会话未建立，跳过音频块');
                    }
                } else {
                    // this.debugLog('⚠️ 接收到空音频块');
                }
            };

            this.mediaRecorder.onerror = (event) => {
                this.debugLog(`MediaRecorder错误: ${event.error}`);
            };

            this.mediaRecorder.onstop = () => {
                this.debugLog('连续录音已停止');
                this.isRecording = false;
            };

            // 启动连续录音 - 每100ms发送一个数据块
            this.mediaRecorder.start(100); // 100ms时间片
            
            this.debugLog('✅ 电话模式连续录音已启动 (100ms时间片)');
            this.debugLog(`🎤 MediaRecorder状态: ${this.mediaRecorder.state}, MimeType: ${mimeType}`);
            this.debugLog(`📡 ASR会话状态: StreamingActive=${this.isStreamingASRActive}, SessionId=${this.currentASRSessionId || 'pending'}`);
            
        } catch (error) {
            this.debugLog(`连续录音启动失败: ${error.message}`);
            this.isRecording = false;
        }
    }

    // 停止连续录音
    stopContinuousRecording() {
        if (this.isRecording && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            this.debugLog('🛑 连续录音已停止');
        }
        this.isRecording = false;
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
                        sampleRate: 8000,  // 改为8kHz匹配paraformer-realtime-8k-v2
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true
                    } 
                });
            }

            // 创建MediaRecorder - 使用优化的格式检测
            const mimeType = this.getBestMediaRecorderFormat();
            this.mediaRecorder = new MediaRecorder(this.audioStream, {
                mimeType: mimeType,
                audioBitsPerSecond: 16000  // 16kbps for speech, forces lower sample rate
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
        
        // 记录客户停止说话的时间点
        this.customerStopTime = Date.now();
        
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
            // 使用流式ASR处理音频
            if (this.isStreamingASRActive && this.currentASRSessionId) {
                await this.processAudioChunksForStreamingOpus();  // 🔄 使用WebM处理
            } else {
                // 回退到批处理ASR（用于兼容性）
                await this.processAudioChunksBatch();
            }
            
        } catch (error) {
            console.error('音频处理失败:', error);
            this.debugLog('错误: 音频处理失败 - ' + error.message);
        }
    }

    async processAudioChunksBatch() {
        // 原有的批处理ASR逻辑（作为备用）
        try {
            // 合并音频数据 - 现在是WebM/Opus格式
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/ogg;codecs=opus' });
            
            // 停止任何当前播放的音频
            this.stopCurrentAudio();
            
            // 标记客户开始回应
            this.customerHasResponded = true;
            
            // 记录ASR开始时间
            const asrStartTime = Date.now();
            
            // 使用Speech Recognition API进行语音识别
            const transcript = await this.recognizeSpeech(audioBlob);
            
            // 计算ASR延迟
            const asrLatency = Date.now() - asrStartTime;
            this.updateASRLatencyMetrics(asrLatency);
            this.debugLog(`🎤 批处理ASR完成: ${asrLatency}ms`);
            
            if (transcript) {
                // 发送到WebSocket服务器获取AI回复
                await this.sendMessageToAI(transcript);
            } else {
                this.debugLog('未识别到有效语音');
            }
            
        } catch (error) {
            console.error('批处理ASR失败:', error);
            this.debugLog('批处理ASR失败: ' + error.message);
        }
    }

    // ====== 流式ASR实现 ======
    
    async startStreamingASR() {
        // 启动流式ASR会话
        if (this.isStreamingASRActive) {
            this.debugLog('流式ASR已激活，跳过重复启动');
            return;
        }
        
        try {
            this.debugLog('启动流式ASR会话...');
            
            // 生成会话ID
            const sessionId = `asr_${Date.now()}`;
            
            // 发送启动请求到服务器
            this.socket.emit('start_streaming_asr', {
                session_id: sessionId
            });
            
            this.isStreamingASRActive = true;
            this.debugLog('流式ASR启动请求已发送');
            
        } catch (error) {
            console.error('启动流式ASR失败:', error);
            this.debugLog('流式ASR启动失败: ' + error.message);
        }
    }
    
    async stopStreamingASR() {
        // 停止流式ASR会话
        if (!this.isStreamingASRActive) {
            return;
        }
        
        try {
            if (this.currentASRSessionId) {
                this.socket.emit('stop_streaming_asr', {
                    session_id: this.currentASRSessionId
                });
                
                this.debugLog('流式ASR停止请求已发送');
            }
            
            this.isStreamingASRActive = false;
            this.currentASRSessionId = null;
            
        } catch (error) {
            console.error('停止流式ASR失败:', error);
            this.debugLog('流式ASR停止失败: ' + error.message);
        }
    }
    
    async processAudioChunksForStreamingOpus() {
        // 🎯 直接处理OGG/Opus数据 - 无需WebM→PCM转换
        if (this.audioChunks.length === 0) return;

        try {
            // 合并OGG/Opus音频数据
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/ogg;codecs=opus' });
            this.debugLog(`开始处理OGG/Opus音频用于流式ASR: ${audioBlob.size} bytes`);
            
            if (audioBlob.size > 0 && this.currentASRSessionId) {
                // 🚀 直接发送OGG/Opus数据到服务器
                await this.sendOpusDataToASR(audioBlob);
            }
            
        } catch (error) {
            console.error('流式ASR音频处理失败:', error);
            this.debugLog('流式ASR音频处理失败: ' + error.message);
        }
    }
    
    async sendOpusDataToASR(audioBlob) {
        // 直接发送OGG/Opus数据到服务器
        try {
            this.debugLog('直接发送OGG/Opus数据到ASR...');
            
            // 读取OGG/Opus二进制数据
            const arrayBuffer = await audioBlob.arrayBuffer();
            const opusData = new Uint8Array(arrayBuffer);
            
            // 分块发送OGG/Opus数据（保持合理的块大小以确保及时传输）
            const chunkSize = 4096; // 4KB块大小，适合网络传输
            const totalChunks = Math.ceil(opusData.length / chunkSize);
            
            this.debugLog(`开始发送OGG/Opus数据: ${opusData.length} bytes, 分为 ${totalChunks} 个块`);
            
            for (let i = 0; i < opusData.length; i += chunkSize) {
                const chunk = opusData.slice(i, i + chunkSize);
                const chunkIndex = Math.floor(i / chunkSize) + 1;
                
                // 发送Opus块到服务器
                this.socket.emit('send_opus_chunk', {
                    session_id: this.currentASRSessionId,
                    opus_data: Array.from(chunk)  // 转换为数组以便JSON传输
                });
                
                this.debugLog(`发送OGG/Opus块 ${chunkIndex}/${totalChunks}: ${chunk.length} bytes`);
                
                // 添加小延迟避免网络拥塞
                await new Promise(resolve => setTimeout(resolve, 5));
            }
            
            this.debugLog('OGG/Opus数据发送完成');
            
        } catch (error) {
            console.error('发送OGG/Opus数据失败:', error);
            this.debugLog('OGG/Opus数据发送失败: ' + error.message);
        }
    }
    
    handleStreamingASRResult(data) {
        // 🔧 修复：asr_result事件仅用于显示实时识别结果，不触发AI响应
        // AI响应只通过 user_speech_recognized 事件触发（服务器端已处理句子完整性检测）
        
        if (data == undefined || (!data.result && !data.text)) {
            this.debugLog('收到无效的ASR结果');
            return;
        }
        
        try {
            // 处理新格式的ASR结果（直接包含text等字段）
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
                    this.updateASRLatencyMetrics(latency);
                }
                
                // 🚨 关键：不在这里触发AI响应！
                // AI响应仅通过 user_speech_recognized 事件触发，
                // 该事件已由服务器端的句子完整性检测逻辑处理
            }
            
        } catch (error) {
            console.error('处理ASR结果失败:', error);
            this.debugLog('处理ASR结果失败: ' + error.message);
        }
    }
    
    sendRecognizedTextToAI(text) {
        // 将识别的文本发送给AI处理
        try {
            if (!text.trim()) {
                this.debugLog('识别文本为空，跳过AI处理');
                return;
            }
            
            // 停止任何当前播放的音频
            this.stopCurrentAudio();
            
            // 标记客户开始回应
            this.customerHasResponded = true;
            
            // 记录服务器请求开始时间（用于延迟计算）
            this.serverRequestStartTime = Date.now();
            
            // 通过WebSocket发送消息进行AI处理
            this.socket.emit('chat_message', {
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
            this.debugLog('发送文本到AI失败: ' + error.message);
        }
    }
    
    // ====== 结束流式ASR实现 ======

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
            
            // 等待2秒看客户是否回应
            this.debugLog('等待客户回应...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 如果客户在2秒内没有回应，继续说话
            if (!this.customerHasResponded) {
                this.debugLog('客户未回应，继续问候流程');
                await this.continueGreetingSequence(customer);
            }
            
        } catch (error) {
            console.error('播放初始问候失败:', error);
            this.debugLog('初始问候失败: ' + error.message);
            this.isPlayingAudio = false;
        }
    }

    async continueGreetingSequence(customer) {
        try {
            // 合并问候信息为单一连续消息
            const fullGreeting = [
                `${customer.name}您好，我是平安银行催收专员，工号888888。`,
                `根据我行记录，您有一笔${this.formatChineseAmount(customer.balance)}的逾期本金，逾期了${customer.daysOverdue}天，已上报征信系统。`,
                `请问您现在方便谈论还款安排吗？`
            ].join('');
            
            this.debugLog(`播放完整问候语: ${fullGreeting}`);
            
            // 显示完整文本
            this.displayMessage('assistant', fullGreeting);
            
            // 通过WebSocket生成并播放单一连续音频流
            this.socket.emit('chat_message', {
                message: fullGreeting,
                messageType: 'agent_greeting'
            });
            
            this.debugLog('完整问候语已发送，等待客户回复');
            
        } catch (error) {
            console.error('问候序列播放失败:', error);
            this.debugLog('问候序列失败: ' + error.message);
        }
    }

    async recognizeSpeech(audioBlob) {
        try {
            // Send the recorded OGG/Opus audio to speech recognition service
            // The server can then use DashScope ASR for transcription
            
            // Firefox优化：使用WebSocket进行转录，消除HTTP开销
            const promise = new Promise((resolve, reject) => {
                // 转换音频为Base64
                const reader = new FileReader();
                reader.onload = () => {
                    const audioBase64 = reader.result.split(',')[1];
                    
                    // 发送音频数据通过WebSocket
                    this.socket.emit('transcribe_audio', {
                        audio: audioBase64,
                        format: 'ogg/opus'
                    });
                    
                    // 监听转录结果
                    const handleTranscribeResult = (data) => {
                        this.socket.off('transcribe_result', handleTranscribeResult);
                        this.socket.off('transcribe_error', handleTranscribeError);
                        resolve(data);
                    };
                    
                    const handleTranscribeError = (error) => {
                        this.socket.off('transcribe_result', handleTranscribeResult);
                        this.socket.off('transcribe_error', handleTranscribeError);
                        reject(new Error(error.message || '转录失败'));
                    };
                    
                    this.socket.on('transcribe_result', handleTranscribeResult);
                    this.socket.on('transcribe_error', handleTranscribeError);
                    
                    // 超时处理
                    setTimeout(() => {
                        this.socket.off('transcribe_result', handleTranscribeResult);
                        this.socket.off('transcribe_error', handleTranscribeError);
                        reject(new Error('转录超时'));
                    }, 10000);
                };
                reader.readAsDataURL(audioBlob);
            });
            
            const result = await promise;
            const transcript = result.transcript;
            
            // 过滤无关内容
            if (transcript && this.isValidTranscript(transcript)) {
                return transcript;
            } else {
                this.debugLog(`转录内容被过滤: "${transcript}"`);
                return null;
            }
            
        } catch (error) {
            console.error('语音识别失败:', error);
            this.debugLog('语音识别失败，使用文本输入: ' + error.message);
            
            // Fallback to text input if ASR fails
            return this.showTextInput();
        }
    }

    // 验证转录内容是否有效
    isValidTranscript(transcript) {
        if (!transcript || transcript.trim().length < 2) {
            return false;
        }
        
        // 过滤明显无关的内容
        const irrelevantPatterns = [
            /字幕由.*提供/,
            /谢谢观看/,
            /下集再见/,
            /请不吝点赞/,
            /订阅.*转发/,
            /打赏支持/,
            /明镜.*点点栏目/,
            /amara\\.org/i,
            /subtitle/i,
            /^[。，、！？\\s]*$/, // 只有标点符号
            /^[a-zA-Z\\s]*$/, // 只有英文字母
            /^\\d+[\\s\\d]*$/, // 只有数字
            /音乐/,
            /背景音/,
            /\\[.*\\]/, // 括号内容（通常是描述音效等）
            /（.*）/, // 中文括号内容
        ];
        
        for (const pattern of irrelevantPatterns) {
            if (pattern.test(transcript)) {
                return false;
            }
        }
        
        // 检查是否包含中文字符（催收对话应该主要是中文）
        const hasChinese = /[\\u4e00-\\u9fff]/.test(transcript);
        if (!hasChinese && transcript.length > 10) {
            return false; // 长文本没有中文字符，可能是无关内容
        }
        
        return true;
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
            if (!this.isConnected) {
                throw new Error('WebSocket未连接');
            }

            // Display the customer message first
            this.displayMessage('user', message);
            
            // 记录准确的服务器请求开始时间（用于真实流式延迟计算）
            this.serverRequestStartTime = Date.now();
            
            // 通过WebSocket发送消息
            this.socket.emit('chat_message', {
                message: message,
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
            
            this.debugLog('通过WebSocket发送消息: ' + message);
            
        } catch (error) {
            console.error('发送消息失败:', error);
            this.debugLog('错误: 消息发送失败 - ' + error.message);
            
            // 显示错误消息
            this.displayMessage('assistant', '抱歉，我暂时无法回复。请稍后重试。');
        }
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
                    console.error('音频播放错误详情:', error);
                    console.error('音频数据大小:', audioBlob.size, 'bytes');
                    console.error('音频类型:', audioBlob.type);
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
                
                // 记录代理开始说话的时间点
                audio.onplay = () => {
                    this.agentStartTime = Date.now();
                    this.debugLog('代理开始播放音频');
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

    // 停止当前播放的音频
    stopCurrentAudio() {
        this.debugLog(`🛑 停止所有音频播放... (活跃PCM源: ${this.activePCMSources.length})`);
        
        // 停止传统音频播放
        if (this.currentAudio && !this.currentAudio.paused) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.debugLog('停止传统音频播放');
        }
        
        // 🔧 关键修复：停止所有活跃的PCM音频源
        if (this.activePCMSources.length > 0) {
            this.activePCMSources.forEach((source, index) => {
                try {
                    source.stop();
                    source.disconnect();
                    this.debugLog(`停止PCM音频源 ${index + 1}`);
                } catch (error) {
                    // 音频源可能已经结束，忽略错误
                    this.debugLog(`PCM音频源 ${index + 1} 已停止: ${error.message}`);
                }
            });
            this.activePCMSources = []; // 清空源列表
        }
        
        // 停止流式PCM播放状态
        if (this.pcmIsPlaying) {
            // 重置PCM播放时间戳，停止后续PCM块的播放
            this.pcmNextStartTime = 0;
            this.pcmIsPlaying = false;
            this.debugLog('重置PCM流式播放状态');
        }
        
        // 如果有Web Audio API上下文，断开增益节点
        if (this.audioContext && this.pcmGainNode) {
            try {
                // 断开增益节点连接但不销毁，因为后续还需要使用
                this.pcmGainNode.disconnect();
                this.pcmGainNode = null;
                this.debugLog('断开PCM增益节点');
            } catch (error) {
                this.debugLog(`断开PCM增益节点时出错: ${error.message}`);
            }
        }
        
        // 清空PCM缓存和重置序列状态
        this.resetPCMSequencing();
        
        this.isPlayingAudio = false;
        
        // 清空音频队列
        this.audioQueue = [];
        this.pcmAudioQueue = [];
        this.debugLog('清空音频队列和PCM缓存');
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
            
            this.socket.emit('chat_message', {
                message: testMessage,
                messageType: 'agent_greeting'
            });
            
            this.debugLog('音频测试完成');
            
        } catch (error) {
            console.error('音频测试失败:', error);
            this.debugLog('音频测试失败: ' + error.message);
        }
    }

    updateASRLatencyMetrics(asrLatency) {
        this.metrics.asrLatency.push({
            latency: asrLatency,
            timestamp: Date.now()
        });
        
        // 更新ASR延迟显示
        document.getElementById('asr-latency').textContent = asrLatency + ' ms';
        this.debugLog(`ASR延迟记录: ${asrLatency}ms`);
    }

    updateServerLatencyMetrics(llmLatency, ttsLatency) {
        this.metrics.llmLatency.push({
            latency: llmLatency,
            timestamp: Date.now()
        });
        
        this.metrics.ttsLatency.push({
            latency: ttsLatency,
            timestamp: Date.now()
        });
        
        // 更新LLM和TTS延迟显示
        document.getElementById('llm-latency').textContent = llmLatency + ' ms';
        document.getElementById('tts-latency').textContent = ttsLatency + ' ms';
        
        this.debugLog(`服务器延迟记录 - LLM: ${llmLatency}ms, TTS: ${ttsLatency}ms`);
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
        
        // 更新延迟图表
        this.updateLatencyChart(latency);
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

    toggleMetricsDashboard() {
        const dashboard = document.getElementById('metrics-dashboard');
        const btn = document.getElementById('metrics-toggle');
        const mainInterface = document.getElementById('main-interface');
        
        if (dashboard.style.display === 'none') {
            dashboard.style.display = 'block';
            btn.textContent = '隐藏指标';
            mainInterface.classList.remove('metrics-hidden');
        } else {
            dashboard.style.display = 'none';
            btn.textContent = '指标监控';
            mainInterface.classList.add('metrics-hidden');
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
        
        // 停止流式ASR会话
        this.stopStreamingASR();
        
        // 停止持续监听
        this.stopContinuousListening();
        
        // 停止当前播放的音频
        this.stopCurrentAudio();
        
        this.sessionActive = false;
        this.updateConnectionStatus('offline', 'WebSocket会话已结束');
        
        // 更新按钮状态
        this.updateSessionButtons();
        
        this.debugLog('WebSocket会话结束');
    }

    resetSession() {
        this.debugLog('正在重置会话...');
        this.endSession();
        
        // 重置数据
        this.conversationHistory = [];
        this.sessionActive = false;
        this.isListening = false;
        this.isRecording = false;
        this.audioQueue = [];
        this.metrics = {
            latency: [],
            accuracy: [],
            sessionStart: null,
            turnCount: 0,
            // 详细延迟指标
            asrLatency: [],
            llmLatency: [],
            ttsLatency: [],
            endToEndLatency: []
        };
        
        // 清空UI
        document.getElementById('conversation-display').innerHTML = '<div class="welcome-message">请选择客户并开始对话</div>';
        document.getElementById('customer-select').value = '';
        document.getElementById('customer-info').style.display = 'none';
        
        // 重置指标显示
        document.getElementById('current-latency').textContent = '-- ms';
        document.getElementById('avg-latency').textContent = '-- ms';
        document.getElementById('latency-grade').textContent = '--';
        document.getElementById('asr-latency').textContent = '-- ms';
        document.getElementById('llm-latency').textContent = '-- ms';
        document.getElementById('tts-latency').textContent = '-- ms';
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
        this.debugLog('WebSocket会话已重置');
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
    console.log('页面加载完成，初始化AI催收助手 (WebSocket版本)...');
    window.aiAgent = new AICollectionAgentWS();
});

// 导出类以便测试
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AICollectionAgentWS;
}