/**
 * AudioManager - 管理所有音频相关功能
 * 包括录音、播放、PCM流处理、语音检测等
 */
class AudioManager {
    constructor(debugLog) {
        this.debugLog = debugLog;
        
        // Audio基础状态
        this.audioContext = null;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.audioChunks = [];
        this.analyser = null;
        this.currentAudio = null;
        this.isPlayingAudio = false;
        this.audioQueue = [];
        
        // PCM流式播放相关
        this.pcmAudioQueue = [];
        this.pcmIsPlaying = false;
        this.pcmGainNode = null;
        this.pcmNextStartTime = 0;
        this.pcmChunkBuffer = new Map();
        this.expectedChunkIndex = 1;
        this.currentSegmentIndex = -1;
        this.activePCMSources = [];
        
        // 时间戳用于延迟计算
        this.serverRequestStartTime = null;
        this.customerStopTime = null;
        this.agentStartTime = null;
    }

    async initAudioContext() {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass();
            this.debugLog('音频上下文初始化成功');
        } catch (error) {
            console.error('音频上下文初始化失败:', error);
            this.debugLog('错误: 音频上下文初始化失败');
        }
    }

    getBestMediaRecorderFormat() {
        const userAgent = navigator.userAgent;
        
        // Safari兼容性检查
        if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) {
            this.debugLog("警告: Safari对MediaRecorder支持有限");
            if (typeof MediaRecorder !== 'undefined' && 
                MediaRecorder.isTypeSupported && 
                MediaRecorder.isTypeSupported("audio/mp4")) {
                this.debugLog("使用Safari兼容格式: audio/mp4");
                return "audio/mp4";
            }
        }
        
        // Chrome/Firefox/Edge - 使用OGG/Opus格式
        const formats = [
            "audio/ogg;codecs=opus",   // 首选 - Firefox原生支持
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
        
        this.debugLog("回退到基础OGG格式");
        return "audio/ogg";
    }

    async startContinuousListening() {
        try {
            this.debugLog('正在启动持续监听...');
            
            this.audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 8000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true,
                    googTypingNoiseDetection: true,
                    googAudioMirroring: false
                } 
            });

            // 创建音频分析器用于语音活动检测
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = this.audioContext || new AudioContextClass();
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.8;
            source.connect(this.analyser);

            this.debugLog('持续监听已开启');
            return true;

        } catch (error) {
            console.error('开始持续监听失败:', error);
            this.debugLog('错误: 持续监听失败 - ' + error.message);
            return false;
        }
    }

    stopContinuousListening() {
        this.debugLog('正在停止持续监听...');
        
        this.stopContinuousRecording();
        
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        
        this.debugLog('持续监听已关闭');
    }

    async startContinuousRecording(asrSessionId, onAudioChunk) {
        if (!this.audioStream) {
            throw new Error('音频流未初始化');
        }

        try {
            this.debugLog('🎙️ 启动电话模式连续录音...');
            
            const mimeType = this.getBestMediaRecorderFormat();
            this.mediaRecorder = new MediaRecorder(this.audioStream, {
                mimeType: mimeType,
                audioBitsPerSecond: 48000
            });

            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    this.debugLog(`📊 MediaRecorder数据块: ${event.data.size} bytes`);
                    
                    if (onAudioChunk && asrSessionId) {
                        try {
                            const arrayBuffer = await event.data.arrayBuffer();
                            const opusData = new Uint8Array(arrayBuffer);
                            await onAudioChunk(asrSessionId, Array.from(opusData));
                        } catch (error) {
                            this.debugLog(`发送连续音频块失败: ${error.message}`);
                        }
                    }
                }
            };

            this.mediaRecorder.onerror = (event) => {
                this.debugLog(`MediaRecorder错误: ${event.error}`);
            };

            this.mediaRecorder.onstop = () => {
                this.debugLog('连续录音已停止');
            };

            this.mediaRecorder.start(100); // 100ms时间片
            
            this.debugLog('✅ 电话模式连续录音已启动');
            return true;
            
        } catch (error) {
            this.debugLog(`连续录音启动失败: ${error.message}`);
            return false;
        }
    }

    stopContinuousRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            this.debugLog('🛑 连续录音已停止');
        }
    }

    startVoiceActivityDetection(onVoiceDetected) {
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const detectVoice = () => {
            if (!this.analyser) return;

            this.analyser.getByteFrequencyData(dataArray);
            
            const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
            const interruptThreshold = 40;
            
            if (average > interruptThreshold && onVoiceDetected) {
                onVoiceDetected(average);
            }
            
            requestAnimationFrame(detectVoice);
        };

        detectVoice();
    }

    // PCM播放相关方法
    async playPCMChunkDirectly(data) {
        try {
            // 计算延迟指标 - 第一个PCM块到达时
            if (data.chunk_index === 1 && data.segment_index === 0) {
                const now = Date.now();
                
                this.stopCurrentAudio();
                this.debugLog('🛑 新的代理回复开始，停止之前的音频');
                
                if (this.serverRequestStartTime) {
                    const serverToAudioLatency = now - this.serverRequestStartTime;
                    this.debugLog(`🚀 服务器处理延迟: ${serverToAudioLatency}ms`);
                }
                
                this.resetPCMSequencing();
            }
            
            const chunkKey = `${data.segment_index}-${data.chunk_index}`;
            this.pcmChunkBuffer.set(chunkKey, data);
            
            await this.processSequentialPCMChunks();
            
        } catch (error) {
            console.error('处理PCM数据块失败:', error);
        }
    }

    resetPCMSequencing() {
        this.pcmChunkBuffer.clear();
        this.expectedChunkIndex = 1;
        this.currentSegmentIndex = -1;
        this.pcmNextStartTime = 0;
        this.debugLog('PCM序列化播放状态已重置');
    }

    async processSequentialPCMChunks() {
        while (true) {
            const targetSegment = 0;
            const expectedKey = `${targetSegment}-${this.expectedChunkIndex}`;
            const chunkData = this.pcmChunkBuffer.get(expectedKey);
            
            if (chunkData) {
                await this.playPCMChunkInSequence(chunkData);
                this.pcmChunkBuffer.delete(expectedKey);
                this.expectedChunkIndex++;
            } else {
                break;
            }
        }
    }

    async playPCMChunkInSequence(data) {
        try {
            if (!this.audioContext) {
                await this.initAudioContext();
            }
            
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            const pcmData = new Uint8Array(data.pcm_data);
            const sampleRate = data.sample_rate || 24000;
            const channels = data.channels || 1;
            const bitsPerSample = data.bits_per_sample || 16;
            
            const samples = this.convertPCMToFloat32(pcmData, bitsPerSample);
            const sampleCount = samples.length;
            
            if (sampleCount === 0) {
                this.debugLog('跳过空的PCM数据块');
                return;
            }
            
            const audioBuffer = this.audioContext.createBuffer(channels, sampleCount, sampleRate);
            audioBuffer.copyToChannel(samples, 0);
            
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            
            this.activePCMSources.push(source);
            
            if (!this.pcmGainNode) {
                this.pcmGainNode = this.audioContext.createGain();
                this.pcmGainNode.connect(this.audioContext.destination);
            }
            
            source.connect(this.pcmGainNode);
            
            const currentTime = this.audioContext.currentTime;
            const duration = sampleCount / sampleRate;
            
            let startTime;
            if (this.pcmNextStartTime === 0 || currentTime > this.pcmNextStartTime + 0.1) {
                startTime = Math.max(currentTime + 0.01, currentTime);
                this.pcmNextStartTime = startTime + duration;
            } else {
                startTime = this.pcmNextStartTime;
                this.pcmNextStartTime += duration;
            }
            
            source.start(startTime);
            
            if (data.chunk_index === 1 && data.segment_index === 0) {
                this.agentStartTime = Date.now();
                this.debugLog('代理开始流式播放PCM音频');
            }
            
            this.isPlayingAudio = true;
            this.pcmIsPlaying = true;
            
            source.onended = () => {
                const index = this.activePCMSources.indexOf(source);
                if (index > -1) {
                    this.activePCMSources.splice(index, 1);
                }
            };
            
        } catch (error) {
            console.error('序列播放PCM数据块失败:', error);
        }
    }

    convertPCMToFloat32(pcmData, bitsPerSample) {
        const samples = new Float32Array(pcmData.length / (bitsPerSample / 8));
        
        if (bitsPerSample === 16) {
            for (let i = 0; i < samples.length; i++) {
                const offset = i * 2;
                const sample = (pcmData[offset] | (pcmData[offset + 1] << 8));
                const signedSample = sample > 32767 ? sample - 65536 : sample;
                samples[i] = signedSample / 32768.0;
            }
        } else if (bitsPerSample === 8) {
            for (let i = 0; i < samples.length; i++) {
                const sample = pcmData[i];
                samples[i] = (sample - 128) / 128.0;
            }
        } else {
            throw new Error(`不支持的PCM位深: ${bitsPerSample}`);
        }
        
        return samples;
    }

    stopCurrentAudio() {
        this.debugLog(`🛑 停止所有音频播放... (活跃PCM源: ${this.activePCMSources.length})`);
        
        // 停止传统音频播放
        if (this.currentAudio && !this.currentAudio.paused) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
        }
        
        // 停止所有活跃的PCM音频源
        if (this.activePCMSources.length > 0) {
            this.activePCMSources.forEach((source, index) => {
                try {
                    source.stop();
                    source.disconnect();
                } catch (error) {
                    // 音频源可能已经结束，忽略错误
                }
            });
            this.activePCMSources = [];
        }
        
        // 停止流式PCM播放状态
        if (this.pcmIsPlaying) {
            this.pcmNextStartTime = 0;
            this.pcmIsPlaying = false;
        }
        
        // 断开增益节点连接
        if (this.audioContext && this.pcmGainNode) {
            try {
                this.pcmGainNode.disconnect();
                this.pcmGainNode = null;
            } catch (error) {
                // 忽略断开连接错误
            }
        }
        
        this.resetPCMSequencing();
        this.isPlayingAudio = false;
        this.audioQueue = [];
        this.pcmAudioQueue = [];
    }

    // 格式化中文金额
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
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioManager;
} else if (typeof window !== 'undefined') {
    window.AudioManager = AudioManager;
}