// 基于HTTP的OpenAI Realtime API集成服务器
const express = require('express');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('.'));

// 配置multer用于处理文件上传
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB限制
    }
});

let openaiConnection = null;
let audioChunks = [];
let isProcessing = false;

// 直接连接到OpenAI API（避免代理问题）
function connectToOpenAI() {
    return new Promise((resolve, reject) => {
        console.log('🔗 直接连接到OpenAI Realtime API...');
        
        openaiConnection = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'OpenAI-Beta': 'realtime=v1'
            }
        });

        openaiConnection.on('open', () => {
            console.log('✅ OpenAI连接成功');
            resolve();
        });

        openaiConnection.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log('📥 OpenAI:', message.type);
                
                if (message.type === 'response.audio.delta' && message.delta) {
                    const audioData = Buffer.from(message.delta, 'base64');
                    audioChunks.push(audioData);
                } else if (message.type === 'response.done') {
                    isProcessing = false;
                    console.log('✅ 响应完成，音频数据ready');
                }
                
            } catch (error) {
                console.log('📥 OpenAI: 二进制数据');
                if (!isProcessing) {
                    audioChunks.push(data);
                }
            }
        });

        openaiConnection.on('error', (error) => {
            console.error('❌ OpenAI连接错误:', error);
            reject(error);
        });

        openaiConnection.on('close', () => {
            console.log('🔌 OpenAI连接关闭');
        });
    });
}

// API端点：发送消息并获取音频响应
app.post('/api/chat', async (req, res) => {
    const { message, messageType = 'user', customerContext, conversationHistory } = req.body;
    
    if (!openaiConnection || openaiConnection.readyState !== WebSocket.OPEN) {
        try {
            await connectToOpenAI();
            // 等待session.created
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 设置系统指令 - 只在第一次连接时设置
            if (customerContext) {
                // 构建对话历史
                let conversationHistoryText = '';
                if (conversationHistory && conversationHistory.length > 0) {
                    conversationHistoryText = '\n本次通话记录:\n';
                    conversationHistory.forEach((entry, index) => {
                        const role = entry.sender === 'user' ? '客户' : '催收员';
                        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
                        conversationHistoryText += `${index + 1}. ${role} (${timestamp}): ${entry.text}\n`;
                    });
                    conversationHistoryText += `${conversationHistory.length + 1}. 客户: ${message}\n`;
                } else {
                    conversationHistoryText = `\n本次通话记录:\n1. 客户: ${message}\n`;
                }

                const systemPrompt = `你是平安银行的专业催收员，工号888888，正在进行电话催收工作。

客户档案:
- 客户姓名: ${customerContext.name}
- 逾期本金: ¥${customerContext.balance.toLocaleString()}
- 逾期天数: ${customerContext.daysOverdue}天
- 历史联系: ${customerContext.previousContacts || 0}次
- 风险评级: ${customerContext.riskLevel || '中等'}
${conversationHistoryText}
催收工作要求:
1. 身份定位: 你是平安银行正式催收员，有合法催收权限
2. 催收目标: 督促客户尽快还款，减少银行损失
3. 沟通策略: 先礼后兵，以理服人，依法催收
4. 专业用语: 使用银行催收标准话术，如"逾期本金"、"还款义务"、"征信记录"等
5. 施压技巧: 提及征信影响、法律后果，但避免违法威胁
6. 解决方案: 提供分期还款、最低还款等现实选择
7. 记录工作: 记录客户态度、还款意愿、承诺时间
8. 上下文连续性: 基于上述通话记录，避免重复询问已讨论过的内容

催收话术原则:
- 坚定立场: "您的还款义务是法定的，不能逃避"
- 征信施压: "继续逾期将严重影响您的个人征信记录"
- 法律威慑: "我行保留通过法律途径追讨的权利"
- 解决导向: "我们可以协商制定合理的还款计划"
- 时限要求: "请您在XX日内联系我们确认还款安排"

禁止行为:
- 不得使用威胁恐吓语言
- 不得泄露客户隐私
- 不得在不当时间骚扰
- 不得对第三人催收
- 不要讨论和催收无关的话题

请基于完整的通话记录，针对客户最新的话语进行专业回应。如果客户说找错人，要核实身份但坚持催收立场。始终保持催收员的专业性和权威性。`;

                openaiConnection.send(JSON.stringify({
                    type: 'session.update',
                    session: {
                        modalities: ['text', 'audio'],
                        instructions: systemPrompt,
                        voice: 'alloy',
                        input_audio_format: 'pcm16',
                        output_audio_format: 'pcm16',
                        turn_detection: { type: 'server_vad' },
                        temperature: 0.7
                    }
                }));
            }
        } catch (error) {
            return res.status(500).json({ error: 'OpenAI连接失败' });
        }
    }

    // 清空之前的音频数据
    audioChunks = [];
    isProcessing = true;

    console.log('📤 发送消息到OpenAI:', message);
    console.log('📋 消息类型:', messageType);

    if (messageType === 'agent_greeting') {
        // 对于代理的问候语，使用OpenAI的TTS API而不是Realtime API
        console.log('🎤 使用OpenAI TTS API处理代理问候语');
        
        try {
            const ttsResponse = await axios.post('https://api.openai.com/v1/audio/speech', {
                model: 'tts-1',
                input: message,
                voice: 'alloy',
                response_format: 'wav'
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer',
                timeout: 30000 // 30秒超时
            });
            
            console.log(`✅ TTS API返回音频: ${ttsResponse.data.byteLength} bytes`);
            
            res.set({
                'Content-Type': 'audio/wav',
                'Content-Length': ttsResponse.data.byteLength
            });
            res.send(ttsResponse.data);
            return;
            
        } catch (error) {
            console.error('❌ TTS API调用失败:', error.message);
            if (error.response) {
                console.error('TTS API错误响应:', error.response.status, error.response.data);
            }
            
            // 回退到Realtime API
            console.log('🔄 回退到Realtime API处理问候语');
            openaiConnection.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'assistant',
                    content: [{
                        type: 'text',
                        text: message
                    }]
                }
            }));
            
            openaiConnection.send(JSON.stringify({
                type: 'response.create',
                response: {
                    modalities: ['audio']
                }
            }));
            // 继续执行后面的通用逻辑
        }
        
    } else if (messageType === 'customer') {
        // 对于客户消息，作为用户输入发送
        openaiConnection.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: message
                }]
            }
        }));
    } else if (messageType === 'customer_with_context') {
        // 对于带完整上下文的客户消息，直接发送完整提示
        openaiConnection.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: message
                }]
            }
        }));
    } else {
        // 默认处理
        openaiConnection.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: message
                }]
            }
        }));
    }

    // 请求响应
    openaiConnection.send(JSON.stringify({
        type: 'response.create',
        response: {
            modalities: ['audio', 'text']
        }
    }));

    // 等待响应完成
    let attempts = 0;
    const maxAttempts = 50; // 25秒超时
    
    while (isProcessing && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
    }

    if (audioChunks.length === 0) {
        return res.status(500).json({ error: '没有收到音频响应' });
    }

    // 合并音频数据
    const fullAudio = Buffer.concat(audioChunks);
    
    // 创建WAV文件
    const wavBuffer = createWavBuffer(fullAudio);
    
    console.log(`✅ 返回音频: ${wavBuffer.length} bytes`);
    
    res.set({
        'Content-Type': 'audio/wav',
        'Content-Length': wavBuffer.length
    });
    res.send(wavBuffer);
});

// API端点：音频转文字（使用OpenAI Whisper）
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '没有接收到音频文件' });
    }
    
    try {
        console.log('📝 开始转录音频，大小:', req.file.size, 'bytes');
        
        // 创建FormData发送给OpenAI Whisper API
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
            filename: 'audio.webm',
            contentType: req.file.mimetype
        });
        formData.append('model', 'whisper-1');
        formData.append('language', 'zh');
        formData.append('response_format', 'json');
        
        const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                ...formData.getHeaders()
            },
            timeout: 30000 // 30秒超时
        });
        
        const transcript = response.data.text;
        console.log('✅ 转录完成:', transcript);
        
        res.json({
            transcript: transcript,
            confidence: 1.0 // Whisper不返回confidence，设为1.0
        });
        
    } catch (error) {
        console.error('❌ 音频转录失败:', error.response?.data || error.message);
        res.status(500).json({ 
            error: '音频转录失败',
            details: error.response?.data?.error?.message || error.message
        });
    }
});

// 创建WAV文件格式
function createWavBuffer(pcmData) {
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;
    
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);
    header.writeUInt16LE(numChannels * bitsPerSample / 8, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    
    return Buffer.concat([header, pcmData]);
}

// 启动服务器
app.listen(3002, async () => {
    console.log('🚀 HTTP服务器启动成功！');
    console.log('📱 前端访问: http://localhost:3002');
    
    // 预先连接到OpenAI
    try {
        await connectToOpenAI();
        console.log('🔑 OpenAI连接已建立，准备就绪');
    } catch (error) {
        console.error('⚠️  OpenAI初始连接失败，将在请求时重试');
    }
});