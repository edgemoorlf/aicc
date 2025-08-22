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
let textResponse = '';
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
                } else if (message.type === 'response.audio_transcript.delta' && message.delta) {
                    // 捕获音频转录文本
                    textResponse += message.delta;
                } else if (message.type === 'response.text.delta' && message.delta) {
                    textResponse += message.delta;
                } else if (message.type === 'response.done') {
                    isProcessing = false;
                    console.log('✅ 响应完成，音频和文本数据ready');
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

                const systemPrompt = `你是平安银行信用卡中心的专业催收专员，正在进行电话催收工作。

基于真实催收对话的标准流程：

【开场环节】
1. 身份确认："您好，您这边的话是[客户姓名]先生/女士吗？"
2. 机构介绍："我是平安银行信用卡中心委托方"
3. 问题说明："这边给您确认是关于您面下办理的[产品名称]，当前的话是已经[逾期时间]了"
4. 原因探询："您这边是忘记去还款了吗？"

【核实环节】
1. 具体核实："我看您这边的话在[日期]还了一笔，还了[金额]"
2. 余额确认："当前的话还差[具体金额]，没有还够"
3. 时间约定："那您这边什么时候能补齐呢？"

【策略应对】
客户说没钱时：
- 理解表达："也没有人说有钱不去还这个信用卡的，我可以理解"
- 压力提醒："现在都已经影响了，您说怎么办，对不对？"

客户提困难时：
- 关怀回应："可以理解，您的还款压力确实也是挺大的"
- 方案引导："如果说您后续现在没有资金的情况下，您就可以先选择还最低"

【解决方案】
1. 内部协商："当前的话还是属于一个内部协商"
2. 案件撤销："您还进来的话还可以帮您去撤销这个余薪案件的"
3. 优惠政策："银行这边可以帮您减免一部分息费，给您减免[具体金额]"
4. 风险管理："将您这个账户风险给您降到最低"

【专业用语】
- "您这边的话" (礼貌询问)
- "当前的话" (现状描述)  
- "是吧" (确认回应)
- "对对对" (理解表达)
- "内部协商"、"余薪案件"、"全额减免方案政策"

【结束话术】
- 客户关怀："看您用卡那么多年了也没有说去拖欠过"
- 特殊备注："我们帮您去备注一下您是特殊原因忘记还款的"
- 礼貌结束："那就不打扰您了，再见"

【重要原则】
1. 始终保持理解和耐心的态度
2. 用具体数据和日期建立可信度
3. 提供多种解决方案而非单一施压
4. 使用银行内部专业术语增强权威性
5. 关注客户感受，避免过度施压

请基于以上真实对话模式，以专业催收员的身份进行对话。

客户档案:
- 客户姓名: ${customerContext.name}
- 逾期本金: ${this.formatChineseAmount(customerContext.balance)}
- 逾期天数: ${customerContext.daysOverdue}天
- 历史联系: ${customerContext.previousContacts || 0}次
- 风险评级: ${customerContext.riskLevel || '中等'}
${conversationHistoryText}

语言要求:
- 必须使用大陆标准普通话，严禁使用台湾用语
- 金额表达: 15000元说成"一万五千元"，不是"十五千元"
- 使用简体中文表达，避免繁体中文用词习惯
- 语音合成使用大陆口音，不使用台湾腔调

请基于完整的通话记录和真实催收对话模式，针对客户最新的话语进行专业回应。`;

                openaiConnection.send(JSON.stringify({
                    type: 'session.update',
                    session: {
                        modalities: ['text', 'audio'],
                        instructions: systemPrompt,
                        voice: 'alloy',
                        input_audio_format: 'pcm16',
                        output_audio_format: 'pcm16',
                        turn_detection: { type: 'server_vad' },
                        temperature: 0.7,
                        input_audio_transcription: {
                            model: 'whisper-1'
                        }
                    }
                }));
            }
        } catch (error) {
            return res.status(500).json({ error: 'OpenAI连接失败' });
        }
    }

    // 清空之前的音频数据和文本响应
    audioChunks = [];
    textResponse = '';
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
            
            // 返回包含音频和文本的JSON响应
            res.json({
                audio: Array.from(new Uint8Array(ttsResponse.data)),
                text: message
            });
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
    
    console.log(`✅ 返回音频: ${wavBuffer.length} bytes，文本: "${textResponse}"`);
    
    // 返回包含音频和文本的JSON响应
    res.json({
        audio: Array.from(wavBuffer),
        text: textResponse || ''
    });
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

// 准确性评估API端点
app.post('/api/evaluate-accuracy', async (req, res) => {
    try {
        const { originalText, spokenText, context } = req.body;
        
        if (!originalText || !spokenText) {
            return res.status(400).json({ error: '缺少必要的文本参数' });
        }
        
        console.log('🔍 评估转录准确性:', { originalText: originalText.substring(0, 50) + '...', spokenText: spokenText.substring(0, 50) + '...' });
        
        // 构建评估提示
        const evaluationPrompt = `你是一个专业的语音转录准确性评估专家。请评估以下语音转录的准确性：

原始文本（AI代理说的）:
"${originalText}"

转录文本（语音识别结果）:
"${spokenText}"

对话上下文:
${context || '银行催收对话场景'}

请从以下几个维度进行评估并给出分数（0-100分）：

1. 词汇准确性 (40%权重) - 关键词是否正确转录
2. 语义完整性 (30%权重) - 意思是否完整传达
3. 专业术语准确性 (20%权重) - 银行术语是否正确
4. 整体可理解性 (10%权重) - 转录结果是否易懂

请返回JSON格式结果：
{
  "overall_score": 分数(0-100),
  "vocabulary_accuracy": 分数(0-100),
  "semantic_completeness": 分数(0-100), 
  "terminology_accuracy": 分数(0-100),
  "comprehensibility": 分数(0-100),
  "grade": "excellent|good|acceptable|poor",
  "issues": ["具体问题列表"],
  "suggestions": "改进建议"
}

注意：
- 轻微的语气词差异（如"嗯"、"啊"等）不影响评分
- 重点关注金额、日期、专业术语的准确性
- 如果核心信息完整，允许表达方式略有不同`;

        // 调用OpenAI GPT-4o进行评估
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: '你是专业的语音转录准确性评估专家，专门评估中文语音转录质量。'
                },
                {
                    role: 'user', 
                    content: evaluationPrompt
                }
            ],
            max_tokens: 1000,
            temperature: 0.1 // 低温度确保评估一致性
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const evaluationText = response.data.choices[0].message.content;
        console.log('📊 GPT-4o评估结果:', evaluationText);
        
        // 尝试解析JSON结果
        let evaluation;
        try {
            // 提取JSON部分
            const jsonMatch = evaluationText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                evaluation = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('未找到JSON格式结果');
            }
        } catch (parseError) {
            console.error('❌ JSON解析失败，使用默认评估:', parseError.message);
            // 回退到基本相似度评估
            const similarity = calculateBasicSimilarity(originalText, spokenText);
            evaluation = {
                overall_score: similarity,
                vocabulary_accuracy: similarity,
                semantic_completeness: similarity,
                terminology_accuracy: similarity,
                comprehensibility: similarity,
                grade: similarity >= 90 ? 'excellent' : similarity >= 75 ? 'good' : similarity >= 60 ? 'acceptable' : 'poor',
                issues: ['自动评估结果'],
                suggestions: '建议改进语音识别设置'
            };
        }
        
        console.log('✅ 准确性评估完成:', evaluation);
        res.json(evaluation);
        
    } catch (error) {
        console.error('❌ 准确性评估失败:', error.message);
        if (error.response) {
            console.error('OpenAI API错误:', error.response.status, error.response.data);
        }
        
        res.status(500).json({ 
            error: '准确性评估失败',
            details: error.message 
        });
    }
});

// 基本文本相似度计算（回退方案）
function calculateBasicSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    // 简单的字符级相似度计算
    const longer = text1.length > text2.length ? text1 : text2;
    const shorter = text1.length > text2.length ? text2 : text1;
    
    if (longer.length === 0) return 100;
    
    const editDistance = levenshteinDistance(longer, shorter);
    const similarity = (longer.length - editDistance) / longer.length;
    
    return Math.round(similarity * 100);
}

// 编辑距离算法
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

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
    
    // 预先建立并维持OpenAI连接
    try {
        await connectToOpenAI();
        console.log('🔑 OpenAI连接已建立，准备就绪');
        
        // 设置连接监控，断开时自动重连
        setInterval(async () => {
            if (!openaiConnection || openaiConnection.readyState !== WebSocket.OPEN) {
                console.log('🔄 检测到连接断开，正在重连...');
                try {
                    await connectToOpenAI();
                    console.log('✅ OpenAI连接已恢复');
                } catch (error) {
                    console.error('❌ 重连失败，2秒后重试');
                }
            }
        }, 2000); // 每2秒检查一次连接状态
        
    } catch (error) {
        console.error('⚠️  OpenAI初始连接失败，将在请求时重试');
    }
});