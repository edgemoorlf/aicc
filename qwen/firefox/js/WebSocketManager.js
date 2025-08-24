/**
 * WebSocketManager - 管理WebSocket连接和事件处理
 * 包括连接管理、事件监听、消息发送等
 */
class WebSocketManager {
    constructor(serverUrl, debugLog) {
        this.serverUrl = serverUrl;
        this.debugLog = debugLog;
        this.socket = null;
        this.isConnected = false;
        
        // 事件处理器存储
        this.eventHandlers = new Map();
    }

    async connect() {
        try {
            this.socket = io(this.serverUrl);
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.debugLog('WebSocket连接成功');
                this.emit('connection_status', { status: 'online', message: 'WebSocket已连接' });
            });

            this.socket.on('disconnect', () => {
                this.isConnected = false;
                this.debugLog('WebSocket连接断开');
                this.emit('connection_status', { status: 'offline', message: 'WebSocket已断开' });
            });

            this.socket.on('connected', (data) => {
                this.debugLog('服务器确认连接: ' + data.status);
            });

            // 文本响应
            this.socket.on('text_response', (data) => {
                this.debugLog('收到文本回复: ' + data.text.substring(0, 50) + '...');
                this.emit('text_response', data);
            });

            // 延迟指标
            this.socket.on('latency_metrics', (data) => {
                this.debugLog(`🔄 服务器延迟指标 - LLM: ${data.llm_latency}ms, TTS: ${data.tts_latency}ms`);
                this.emit('latency_metrics', data);
            });

            // PCM音频块
            this.socket.on('pcm_chunk', (data) => {
                this.debugLog(`收到PCM数据块 ${data.chunk_index}: ${data.pcm_data.length} bytes`);
                this.emit('pcm_chunk', data);
            });

            // PCM段落结束
            this.socket.on('pcm_segment_end', (data) => {
                this.debugLog(`PCM段落结束，共 ${data.chunk_count} 个数据块`);
                this.emit('pcm_segment_end', data);
            });

            // 流式ASR事件
            this.setupASREvents();

            // 错误处理
            this.socket.on('error', (data) => {
                console.error('WebSocket错误:', data.error);
                this.debugLog('WebSocket错误: ' + data.error);
                this.emit('error', data);
            });

        } catch (error) {
            console.error('WebSocket连接失败:', error);
            this.emit('connection_status', { status: 'offline', message: 'WebSocket连接失败' });
            this.debugLog('WebSocket连接失败: ' + error.message);
        }
    }

    setupASREvents() {
        // ASR连接状态
        this.socket.on('asr_connected', (data) => {
            this.debugLog(`流式ASR已连接: ${data.session_id}`);
            this.emit('asr_connected', data);
        });

        // ASR结果 - 仅用于显示实时识别结果，不触发AI响应
        this.socket.on('asr_result', (data) => {
            this.emit('asr_result', data);
        });

        // 用户语音识别完成 - 触发AI响应的唯一入口
        this.socket.on('user_speech_recognized', (data) => {
            this.debugLog(`✅ 完整句子识别完成: ${data.text} (方法: ${data.completion_method || 'unknown'})`);
            this.emit('user_speech_recognized', data);
        });

        // ASR会话管理
        this.socket.on('streaming_asr_started', (data) => {
            this.debugLog(`流式ASR会话启动: ${data.session_id}`);
            this.emit('streaming_asr_started', data);
        });

        this.socket.on('asr_session_started', (data) => {
            this.debugLog(`流式ASR会话启动: ${data.session_id}`);
            this.emit('asr_session_started', data);
        });

        this.socket.on('streaming_asr_error', (data) => {
            this.debugLog(`流式ASR会话启动失败: ${data.error}`);
            this.emit('streaming_asr_error', data);
        });

        this.socket.on('asr_session_failed', (data) => {
            this.debugLog(`流式ASR会话启动失败: ${data.error}`);
            this.emit('asr_session_failed', data);
        });

        this.socket.on('asr_error', (data) => {
            this.debugLog(`流式ASR错误: ${data.error}`);
            this.emit('asr_error', data);
        });

        this.socket.on('asr_completed', (data) => {
            this.debugLog(`流式ASR识别完成: ${data.session_id}`);
            this.emit('asr_completed', data);
        });

        this.socket.on('streaming_asr_stopped', (data) => {
            this.debugLog(`流式ASR已停止: ${data.session_id}`);
            this.emit('streaming_asr_stopped', data);
        });
    }

    // 事件发射器
    emit(eventName, data) {
        const handlers = this.eventHandlers.get(eventName);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`事件处理器错误 [${eventName}]:`, error);
                }
            });
        }
    }

    // 事件监听器
    on(eventName, handler) {
        if (!this.eventHandlers.has(eventName)) {
            this.eventHandlers.set(eventName, []);
        }
        this.eventHandlers.get(eventName).push(handler);
    }

    // 移除事件监听器
    off(eventName, handler) {
        const handlers = this.eventHandlers.get(eventName);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    // WebSocket消息发送方法
    sendChatMessage(data) {
        if (!this.isConnected) {
            throw new Error('WebSocket未连接');
        }
        this.socket.emit('chat_message', data);
        this.debugLog('发送聊天消息: ' + JSON.stringify(data).substring(0, 100) + '...');
    }

    startStreamingASR(sessionId) {
        if (!this.isConnected) {
            throw new Error('WebSocket未连ected');
        }
        this.socket.emit('start_streaming_asr', { session_id: sessionId });
        this.debugLog('启动流式ASR请求已发送');
    }

    stopStreamingASR(sessionId) {
        if (!this.isConnected) {
            return;
        }
        this.socket.emit('stop_streaming_asr', { session_id: sessionId });
        this.debugLog('流式ASR停止请求已发送');
    }

    sendOpusChunk(sessionId, opusData) {
        if (!this.isConnected || !sessionId) {
            return false;
        }
        
        this.socket.emit('send_opus_chunk', {
            session_id: sessionId,
            opus_data: opusData
        });
        
        return true;
    }

    sendAudioData(sessionId, audioData) {
        if (!this.isConnected || !sessionId) {
            return false;
        }
        
        this.socket.emit('audio_data', {
            session_id: sessionId,
            audio: audioData
        });
        
        return true;
    }

    // Dead code removed - transcribeAudio method
    // All transcription now uses streaming ASR via sendOpusChunk

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.eventHandlers.clear();
        this.debugLog('WebSocket连接已断开');
    }

    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            serverUrl: this.serverUrl
        };
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketManager;
} else if (typeof window !== 'undefined') {
    window.WebSocketManager = WebSocketManager;
}