# AI催收助手 - Qwen实现服务器
# 基于Python Flask + Alibaba Cloud APIs

import os
import re
import json
import base64
import time
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import dashscope
from dashscope import Generation
from dashscope.audio.asr import Recognition
import logging

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# 配置
DASHSCOPE_API_KEY = os.getenv('DASHSCOPE_API_KEY')
if not DASHSCOPE_API_KEY:
    logger.error('DASHSCOPE_API_KEY 环境变量未设置')
    raise ValueError('请设置 DASHSCOPE_API_KEY 环境变量')

dashscope.api_key = DASHSCOPE_API_KEY

# 全局变量
conversation_history = []

# 静态文件服务
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('.', filename)

def merge_wav_audio(wav_segments):
    """合并多个WAV音频段落为一个完整的WAV文件"""
    if not wav_segments:
        return []
    
    if len(wav_segments) == 1:
        return wav_segments[0]
    
    import struct
    
    # 收集所有PCM数据（跳过每个WAV的44字节头）
    all_pcm_data = b''
    
    for wav_data in wav_segments:
        if len(wav_data) > 44:  # 确保有WAV头
            pcm_data = bytes(wav_data[44:])  # 跳过44字节的WAV头
            all_pcm_data += pcm_data
        else:
            # 如果数据太短，当作PCM数据处理
            all_pcm_data += bytes(wav_data)
    
    # 创建新的WAV头用于合并的音频
    sample_rate = 24000  # 24kHz（与DashScope TTS一致）
    num_channels = 1     # 单声道
    bits_per_sample = 16 # 16位PCM
    data_size = len(all_pcm_data)
    file_size = 36 + data_size
    
    # 创建WAV文件头
    header = bytearray(44)
    
    # RIFF chunk
    header[0:4] = b'RIFF'
    struct.pack_into('<I', header, 4, file_size)
    header[8:12] = b'WAVE'
    
    # fmt chunk
    header[12:16] = b'fmt '
    struct.pack_into('<I', header, 16, 16)  # fmt chunk size
    struct.pack_into('<H', header, 20, 1)   # PCM format
    struct.pack_into('<H', header, 22, num_channels)
    struct.pack_into('<I', header, 24, sample_rate)
    struct.pack_into('<I', header, 28, sample_rate * num_channels * bits_per_sample // 8)  # byte rate
    struct.pack_into('<H', header, 32, num_channels * bits_per_sample // 8)  # block align
    struct.pack_into('<H', header, 34, bits_per_sample)
    
    # data chunk
    header[36:40] = b'data'
    struct.pack_into('<I', header, 40, data_size)
    
    # 合并头部和PCM数据
    merged_wav = bytes(header) + all_pcm_data
    
    logger.info(f'合并WAV音频: {len(wav_segments)}个段落 -> {len(merged_wav)} bytes')
    return list(merged_wav)

def segment_ai_response(ai_text):
    """将AI回复按照催收员标记分段，并清理格式"""
    import re
    
    # 分割文本，查找 "催收员:" 模式（可能前面有数字编号）
    # 匹配模式：可选的数字和点，然后是"催收员:"
    segments = re.split(r'\d*\.?\s*催收员[：:]\s*', ai_text)
    
    # 过滤掉空段落并清理
    clean_segments = []
    for segment in segments:
        segment = segment.strip()
        if segment:  # 只保留非空段落
            clean_segments.append(segment)
    
    logger.info(f'AI回复分段: 原文长度={len(ai_text)}, 分段数={len(clean_segments)}')
    for i, seg in enumerate(clean_segments):
        logger.info(f'段落{i+1}: "{seg[:50]}..."')
    
    return clean_segments

# API端点：发送消息并获取音频响应
@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        message = data.get('message', '')
        message_type = data.get('messageType', 'user')
        customer_context = data.get('customerContext', {})
        conversation_history = data.get('conversationHistory', [])
        
        logger.info(f'收到消息: {message[:50]}... 类型: {message_type}')
        
        # 对于代理问候语，直接使用TTS
        if message_type == 'agent_greeting':
            audio_data = generate_tts_audio(message)
            return jsonify({
                'audio': audio_data,
                'text': message
            })
        
        # 构建对话上下文
        system_prompt = build_collection_prompt(customer_context, conversation_history, message)
        
        # 调用通义千问生成回复
        ai_response = generate_ai_response(system_prompt)
        
        if not ai_response:
            return jsonify({'error': '生成AI回复失败'}), 500
        
        # 将AI回复分段
        segments = segment_ai_response(ai_response)
        
        if not segments:
            # 如果没有分段，直接使用原文
            segments = [ai_response]
        
        # 为第一个段落生成语音并立即返回（低延迟优先）
        if segments:
            first_segment = segments[0]
            logger.info(f'生成第1段语音（优先返回）: {first_segment[:30]}...')
            first_audio = generate_tts_audio(first_segment)
            
            # 如果有多个段落，记录剩余段落（可以后续通过其他机制处理）
            if len(segments) > 1:
                logger.info(f'剩余{len(segments)-1}个段落将被跳过，优先低延迟响应')
                # TODO: 可以考虑通过WebSocket或其他机制发送剩余段落
            
            logger.info(f'AI回复: {ai_response[:50]}... (立即返回第1段，共{len(segments)}段)')
            
            return jsonify({
                'audio': first_audio if first_audio else [],
                'text': ai_response  # 返回完整文本用于显示
            })
        else:
            # 没有分段，返回空音频
            logger.warning('没有找到有效的AI回复段落')
            return jsonify({
                'audio': [],
                'text': ai_response
            })
        
    except Exception as e:
        logger.error(f'聊天处理错误: {str(e)}')
        return jsonify({'error': f'处理失败: {str(e)}'}), 500

# API端点：语音转文字
@app.route('/api/transcribe', methods=['POST'])
def transcribe():
    try:
        if 'audio' not in request.files:
            return jsonify({'error': '没有接收到音频文件'}), 400
            
        audio_file = request.files['audio']
        logger.info(f'开始转录音频，大小: {len(audio_file.read())} bytes')
        audio_file.seek(0)  # 重置文件指针
        
        # 使用DashScope语音识别API
        transcript = recognize_speech_dashscope(audio_file)
        
        if transcript:
            logger.info(f'转录完成: {transcript}')
            return jsonify({
                'transcript': transcript,
                'confidence': 0.95
            })
        else:
            logger.error('语音识别失败')
            return jsonify({
                'error': '语音识别失败',
                'transcript': '',  # 返回空字符串而不是错误
                'confidence': 0.0
            }), 200  # 返回200但置信度为0
        
    except Exception as e:
        logger.error(f'音频转录失败: {str(e)}')
        return jsonify({
            'error': '音频转录失败',
            'details': str(e),
            'transcript': '',  # 提供空的转录结果
            'confidence': 0.0
        }), 200  # 返回200让客户端可以继续处理

# API端点：准确性评估
@app.route('/api/evaluate-accuracy', methods=['POST'])
def evaluate_accuracy():
    try:
        data = request.get_json()
        original_text = data.get('originalText', '')
        spoken_text = data.get('spokenText', '')
        context = data.get('context', '银行催收对话')
        
        logger.info(f'评估准确性: 原文长度={len(original_text)}, 识别长度={len(spoken_text)}')
        
        # 使用通义千问进行准确性评估
        evaluation = evaluate_transcript_accuracy(original_text, spoken_text, context)
        
        logger.info(f'评估完成: {evaluation.get("overall_score", 0)}分')
        
        return jsonify(evaluation)
        
    except Exception as e:
        logger.error(f'准确性评估失败: {str(e)}')
        return jsonify({
            'error': '准确性评估失败',
            'details': str(e)
        }), 500

def build_collection_prompt(customer_context, conversation_history, user_message):
    """构建催收专员的系统提示"""
    
    # 格式化金额
    def format_chinese_amount(amount):
        if amount >= 10000:
            wan = amount // 10000
            remainder = amount % 10000
            if remainder == 0:
                return f"{wan}万元"
            else:
                return f"{wan}万{remainder}元"
        return f"{amount}元"
    
    # 构建对话历史
    conversation_text = ""
    if conversation_history:
        conversation_text = "\n本次通话记录:\n"
        for i, entry in enumerate(conversation_history):
            role = "客户" if entry.get('sender') == 'user' else "催收员"
            conversation_text += f"{i+1}. {role}: {entry.get('text', '')}\n"
        conversation_text += f"{len(conversation_history)+1}. 客户: {user_message}\n"
    else:
        conversation_text = f"\n本次通话记录:\n1. 客户: {user_message}\n"
    
    system_prompt = f"""你是平安银行信用卡中心的专业催收专员，正在进行电话催收工作。

客户档案信息:
- 客户姓名: {customer_context.get('name', '客户')}
- 逾期本金: {format_chinese_amount(customer_context.get('balance', 0))}
- 逾期天数: {customer_context.get('daysOverdue', 0)}天
- 联系历史: {customer_context.get('previousContacts', 0)}次
- 风险等级: {customer_context.get('riskLevel', '中等')}

{conversation_text}

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
6. 每一次回答尽量简练，不要超过4句话，最好在1-2句，避免长篇大论，确保客户能听懂
7. **严禁重复之前已经说过的内容** - 仔细查看通话记录，避免重复相同的话术、问题或信息
8. **根据对话进展调整策略** - 每次回复都要基于客户的最新回应，推进对话而不是重复

【防重复指南】
- 如果客户已经表达了某种态度或立场，不要重复询问相同的问题
- 如果已经提到过某种解决方案，不要再次重复介绍
- 根据客户的具体回应，选择新的角度或更深入的探讨
- 避免使用完全相同的开场白或结束语

语言要求:
- 使用大陆标准普通话，避免台湾用语
- 金额表达: 15000元说成"一万五千元"，不是"十五千元"
- 语气要专业、理解，体现人文关怀

请仔细分析完整的通话记录，确保不重复之前的内容，以专业催收员的身份针对客户最新话语给出新的、有进展的回应。"""

    return system_prompt

def generate_ai_response(system_prompt):
    """使用通义千问生成AI回复"""
    try:
        llm_start_time = time.time()
        
        response = Generation.call(
            model='qwen-plus',
            messages=[
                {'role': 'system', 'content': '你是专业的银行催收专员，必须使用中文回复。'},
                {'role': 'user', 'content': system_prompt}
            ],
            temperature=0.7,
            max_tokens=500,
            result_format='message'
        )
        
        llm_latency = int((time.time() - llm_start_time) * 1000)
        
        if response.status_code == 200:
            ai_text = response.output.choices[0].message.content
            ai_text = ai_text.strip()
            logger.info(f'通义千问LLM处理完成: {llm_latency}ms')
            return ai_text, llm_latency
        else:
            logger.error(f'通义千问API调用失败: {response.status_code}')
            return None, 0
            
    except Exception as e:
        logger.error(f'生成AI回复错误: {str(e)}')
        return None, 0

def generate_tts_audio_streaming(text, segment_index=0, total_segments=1):
    """使用通义千问TTS生成语音，实时流式发送PCM数据"""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            logger.info(f'开始流式TTS音频生成 (尝试 {attempt + 1}/{max_retries}): {text[:30]}...')
            
            tts_start_time = time.time()
            
            # 使用流式方式，生成PCM数据流
            responses = dashscope.audio.qwen_tts.SpeechSynthesizer.call(
                model="qwen-tts",
                api_key=DASHSCOPE_API_KEY,  # 显式传递API key
                text=text,
                voice="Cherry",  # 中文女声 - 使用支持的声音
                stream=True  # 使用流式处理，实时返回PCM数据
            )
            
            # 检查responses是否为None
            if responses is None:
                raise ValueError("TTS API返回None响应")
            
            # 实时流式发送PCM数据块
            chunk_count = 0
            first_chunk_time = None
            
            for chunk in responses:
                if chunk and "output" in chunk and "audio" in chunk["output"] and "data" in chunk["output"]["audio"]:
                    audio_string = chunk["output"]["audio"]["data"]
                    pcm_bytes = base64.b64decode(audio_string)
                    if pcm_bytes:
                        chunk_count += 1
                        
                        # 记录第一个块的时间（TTS首次响应延迟）
                        if first_chunk_time is None:
                            first_chunk_time = time.time()
                            tts_first_chunk_latency = int((first_chunk_time - tts_start_time) * 1000)
                        
                        logger.info(f'流式发送TTS PCM数据块 {chunk_count}: {len(pcm_bytes)} bytes')
                        
                        # 立即通过WebSocket发送PCM数据块
                        socketio.emit('pcm_chunk', {
                            'pcm_data': list(pcm_bytes),
                            'chunk_index': chunk_count,
                            'segment_index': segment_index,
                            'total_segments': total_segments,
                            'text': text,
                            'sample_rate': 24000,  # DashScope TTS输出24kHz
                            'channels': 1,
                            'bits_per_sample': 16
                        })
            
            if chunk_count > 0:
                tts_total_latency = int((time.time() - tts_start_time) * 1000)
                logger.info(f'流式TTS完成 (尝试 {attempt + 1}): 发送了{chunk_count}个PCM数据块')
                logger.info(f'TTS延迟指标 - 首块: {tts_first_chunk_latency if first_chunk_time else 0}ms, 总计: {tts_total_latency}ms')
                
                # 发送段落结束信号
                socketio.emit('pcm_segment_end', {
                    'segment_index': segment_index,
                    'total_segments': total_segments,
                    'chunk_count': chunk_count
                })
                
                # 返回TTS首次响应延迟（用于延迟指标）
                return tts_first_chunk_latency if first_chunk_time else tts_total_latency
            else:
                raise ValueError("TTS响应中没有音频数据")
                
        except Exception as e:
            logger.error(f'流式TTS生成失败 (尝试 {attempt + 1}/{max_retries}): {str(e)}')
            if attempt == max_retries - 1:
                logger.error('流式TTS重试次数已用完，生成失败')
                return False
            else:
                logger.info(f'等待1秒后重试...')
                import time
                time.sleep(1)

def generate_tts_audio(text):
    """兼容性函数：使用通义千问TTS生成语音，返回PCM数据块列表"""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            logger.info(f'生成TTS音频 (尝试 {attempt + 1}/{max_retries}): {text[:30]}...')
            
            # 使用流式方式，生成PCM数据流
            responses = dashscope.audio.qwen_tts.SpeechSynthesizer.call(
                model="qwen-tts",
                api_key=DASHSCOPE_API_KEY,  # 显式传递API key
                text=text,
                voice="Cherry",  # 中文女声 - 使用支持的声音
                stream=True  # 使用流式处理，实时返回PCM数据
            )
            
            # 检查responses是否为None
            if responses is None:
                raise ValueError("TTS API返回None响应")
            
            # 流式返回PCM数据块
            pcm_chunks = []
            for chunk in responses:
                if chunk and "output" in chunk and "audio" in chunk["output"] and "data" in chunk["output"]["audio"]:
                    audio_string = chunk["output"]["audio"]["data"]
                    pcm_bytes = base64.b64decode(audio_string)
                    if pcm_bytes:
                        pcm_chunks.append(list(pcm_bytes))
                        logger.info(f'TTS PCM数据块: {len(pcm_bytes)} bytes')
            
            if pcm_chunks:
                logger.info(f'TTS音频生成成功 (尝试 {attempt + 1}): 总共{len(pcm_chunks)}个PCM数据块')
                return pcm_chunks  # 返回PCM数据块列表
            else:
                raise ValueError("TTS响应中没有音频数据")
                
        except Exception as e:
            logger.error(f'TTS生成失败 (尝试 {attempt + 1}/{max_retries}): {str(e)}')
            if attempt == max_retries - 1:
                logger.error('TTS重试次数已用完，生成失败')
                return []
            else:
                logger.info(f'等待1秒后重试...')
                import time
                time.sleep(1)

def recognize_speech_dashscope(audio_file):
    """使用DashScope进行语音识别"""
    try:
        logger.info('开始DashScope语音识别...')
        
        # 读取音频文件内容
        audio_content = audio_file.read()
        logger.info(f'音频文件大小: {len(audio_content)} bytes')
        
        # 直接使用WebM格式进行ASR
        # 直接使用WebM格式进行ASR
        import tempfile
        
        # 保存原始WebM文件
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as webm_file:
            webm_file.write(audio_content)
            webm_file_path = webm_file.name
        
        logger.info(f'WebM文件大小: {len(audio_content)} bytes location: {webm_file_path}')
        logger.info(f'WebM文件大小: {len(audio_content)} bytes location: {webm_file_path}')
        
        try:
            logger.info('使用8kHz WebM直接识别...')
            
            # 直接使用8k模型处理8kHz WebM
            recognition = Recognition(
                model='paraformer-realtime-8k-v2',
                format='webm',
                sample_rate=8000,  # 客户端现在生成8kHz WebM
                callback=None
            )
            
            result = recognition.call(webm_file_path)
            logger.info(f'8kHz WebM识别完成，状态: {getattr(result, "status_code", "未知")}')
            logger.info('使用8kHz WebM直接识别...')
            
            # 直接使用8k模型处理8kHz WebM
            recognition = Recognition(
                model='paraformer-realtime-8k-v2',
                format='webm',
                sample_rate=8000,  # 客户端现在生成8kHz WebM
                callback=None
            )
            
            result = recognition.call(webm_file_path)
            logger.info(f'8kHz WebM识别完成，状态: {getattr(result, "status_code", "未知")}')
            
            # 检查8kHz WebM识别是否成功
            if hasattr(result, 'get_sentence') and result.get_sentence():
                sentences = result.get_sentence()
                logger.info(f'8kHz WebM识别成功，识别到 {len(sentences)} 个句子')
                
                transcript_parts = []
                for sentence_obj in sentences:
                    if isinstance(sentence_obj, dict) and 'text' in sentence_obj:
                        transcript_parts.append(sentence_obj['text'])
                
                transcript = ''.join(transcript_parts)
                if transcript.strip():
                    logger.info(f'8kHz WebM识别结果: {transcript}')
                    return transcript.strip()
            
            elif hasattr(result, 'output') and result.output and hasattr(result.output, 'sentence') and result.output.sentence:
                sentences = result.output.sentence
                transcript_parts = []
                for sentence_obj in sentences:
                    if isinstance(sentence_obj, dict) and 'text' in sentence_obj:
                        transcript_parts.append(sentence_obj['text'])
                
                transcript = ''.join(transcript_parts)
                if transcript.strip():
                    logger.info(f'8kHz WebM识别结果: {transcript}')
                    return transcript.strip()
            
            logger.warning('8kHz WebM识别失败，回退到WAV转换')
            
        except Exception as webm_error:
            logger.warning(f'8kHz WebM识别异常，回退到WAV转换: {str(webm_error)}')
        
        # 回退方案：转换为WAV
        try:
            logger.info('使用WebM转WAV + 8kHz模型进行ASR...')
            
            # 转换WebM到8kHz WAV
            from pydub import AudioSegment
            wav_file_path = webm_file_path.replace('.webm', '_8khz.wav')
            
            audio = AudioSegment.from_file(webm_file_path, format="webm")
            audio = audio.set_frame_rate(8000).set_channels(1).set_sample_width(2)
            audio.export(wav_file_path, format="wav")
            
            logger.info(f'WAV转换完成: {wav_file_path}')
            
            # 使用8kHz模型进行识别
            # 检查8kHz WebM识别是否成功
            if hasattr(result, 'get_sentence') and result.get_sentence():
                sentences = result.get_sentence()
                logger.info(f'8kHz WebM识别成功，识别到 {len(sentences)} 个句子')
                
                transcript_parts = []
                for sentence_obj in sentences:
                    if isinstance(sentence_obj, dict) and 'text' in sentence_obj:
                        transcript_parts.append(sentence_obj['text'])
                
                transcript = ''.join(transcript_parts)
                if transcript.strip():
                    logger.info(f'8kHz WebM识别结果: {transcript}')
                    return transcript.strip()
            
            elif hasattr(result, 'output') and result.output and hasattr(result.output, 'sentence') and result.output.sentence:
                sentences = result.output.sentence
                transcript_parts = []
                for sentence_obj in sentences:
                    if isinstance(sentence_obj, dict) and 'text' in sentence_obj:
                        transcript_parts.append(sentence_obj['text'])
                
                transcript = ''.join(transcript_parts)
                if transcript.strip():
                    logger.info(f'8kHz WebM识别结果: {transcript}')
                    return transcript.strip()
            
            logger.warning('8kHz WebM识别失败，回退到WAV转换')
            
        except Exception as webm_error:
            logger.warning(f'8kHz WebM识别异常，回退到WAV转换: {str(webm_error)}')
        
        # 回退方案：转换为WAV
        try:
            logger.info('使用WebM转WAV + 8kHz模型进行ASR...')
            
            # 转换WebM到8kHz WAV
            from pydub import AudioSegment
            wav_file_path = webm_file_path.replace('.webm', '_8khz.wav')
            
            audio = AudioSegment.from_file(webm_file_path, format="webm")
            audio = audio.set_frame_rate(8000).set_channels(1).set_sample_width(2)
            audio.export(wav_file_path, format="wav")
            
            logger.info(f'WAV转换完成: {wav_file_path}')
            
            # 使用8kHz模型进行识别
            recognition = Recognition(
                model='paraformer-realtime-8k-v2',
                format='wav',
                sample_rate=8000,
                callback=None
            )
            
            # 进行语音识别
            result = recognition.call(wav_file_path)
            logger.info(f'ASR调用完成，结果状态: {getattr(result, "status_code", "未知")}')
            
            if hasattr(result, 'get_sentence') and result.get_sentence():
                sentences = result.get_sentence()
                logger.info(f'识别到 {len(sentences)} 个句子')
                
                # 合并所有句子的文本
                transcript_parts = []
                for sentence_obj in sentences:
                    if isinstance(sentence_obj, dict) and 'text' in sentence_obj:
                        transcript_parts.append(sentence_obj['text'])
                
                transcript = ''.join(transcript_parts)
                logger.info(f'识别结果: {transcript}')
                return transcript.strip()
                
            elif hasattr(result, 'output') and result.output:
                logger.info(f'ASR output类型: {type(result.output)}')
                logger.info(f'ASR output内容: {result.output}')
                
                # 尝试从output中获取结果
                if hasattr(result.output, 'sentence') and result.output.sentence:
                    sentences = result.output.sentence
                    transcript_parts = []
                    for sentence_obj in sentences:
                        if isinstance(sentence_obj, dict) and 'text' in sentence_obj:
                            transcript_parts.append(sentence_obj['text'])
                    
                    transcript = ''.join(transcript_parts)
                    if transcript:
                        logger.info(f'从output获取识别结果: {transcript}')
                        return transcript.strip()
                
                elif isinstance(result.output, dict):
                    transcript = result.output.get('sentence', '') or result.output.get('text', '')
                    if transcript:
                        logger.info(f'从字典获取识别结果: {transcript}')
                        return transcript.strip()
            
            logger.error(f'DashScope ASR未返回预期结果: {result}')
            logger.error(f'结果详情 - status_code: {getattr(result, "status_code", "N/A")}, output: {getattr(result, "output", "N/A")}')
            return None
            
        except Exception as e:
            logger.error(f'WebM语音识别错误: {str(e)}')
            logger.error(f'WebM语音识别错误: {str(e)}')
            import traceback
            logger.error(f'错误详情: {traceback.format_exc()}')
            return None
            
        finally:
            # 清理临时WebM文件
            import time
            time.sleep(1)  # 给文件系统一点时间
            # try:
            #     if os.path.exists(webm_file_path):
            #         os.unlink(webm_file_path)
            #         logger.info(f'清理WebM文件: {webm_file_path}')
            # except Exception as cleanup_error:
            #     logger.error(f'清理文件失败: {cleanup_error}')
                
    except Exception as e:
        logger.error(f'DashScope语音识别错误: {str(e)}')
        return None

def evaluate_transcript_accuracy(original_text, spoken_text, context):
    """使用通义千问评估转录准确性"""
    try:
        evaluation_prompt = f"""你是专业的语音转录准确性评估专家。请评估以下语音转录的准确性：

原始文本（AI代理说的）:
"{original_text}"

转录文本（语音识别结果）:
"{spoken_text}"

对话上下文:
{context}

请从以下几个维度进行评估并给出分数（0-100分）：

1. 词汇准确性 (40%权重) - 关键词是否正确转录
2. 语义完整性 (30%权重) - 意思是否完整传达
3. 专业术语准确性 (20%权重) - 银行术语是否正确
4. 整体可理解性 (10%权重) - 转录结果是否易懂

请返回JSON格式结果：
{{
  "overall_score": 分数(0-100),
  "vocabulary_accuracy": 分数(0-100),
  "semantic_completeness": 分数(0-100), 
  "terminology_accuracy": 分数(0-100),
  "comprehensibility": 分数(0-100),
  "grade": "excellent|good|acceptable|poor",
  "issues": ["具体问题列表"],
  "suggestions": "改进建议"
}}

注意：
- 轻微的语气词差异（如"嗯"、"啊"等）不影响评分
- 重点关注金额、日期、专业术语的准确性
- 如果核心信息完整，允许表达方式略有不同"""

        response = Generation.call(
            model='qwen-plus',
            messages=[
                {'role': 'system', 'content': '你是专业的语音转录准确性评估专家，专门评估中文语音转录质量。返回标准JSON格式。'},
                {'role': 'user', 'content': evaluation_prompt}
            ],
            temperature=0.1,
            max_tokens=800,
            result_format='message'
        )
        
        if response.status_code == 200:
            evaluation_text = response.output.choices[0].message.content
            # 尝试解析JSON
            try:
                # 提取JSON部分
                import re
                json_match = re.search(r'\{.*\}', evaluation_text, re.DOTALL)
                if json_match:
                    evaluation = json.loads(json_match.group())
                    return evaluation
                else:
                    raise ValueError('未找到JSON格式结果')
            except (json.JSONDecodeError, ValueError) as e:
                logger.error(f'JSON解析失败: {e}')
                # 返回默认评估结果
                similarity = calculate_basic_similarity(original_text, spoken_text)
                return {
                    "overall_score": similarity,
                    "vocabulary_accuracy": similarity,
                    "semantic_completeness": similarity,
                    "terminology_accuracy": similarity,
                    "comprehensibility": similarity,
                    "grade": "good" if similarity >= 75 else "acceptable" if similarity >= 60 else "poor",
                    "issues": ["AI评估解析错误"],
                    "suggestions": "建议检查语音识别设置"
                }
        else:
            logger.error(f'评估API调用失败: {response.status_code}')
            return {"error": "评估失败"}
            
    except Exception as e:
        logger.error(f'评估转录准确性错误: {str(e)}')
        return {"error": str(e)}

def calculate_basic_similarity(text1, text2):
    """基础相似度计算（回退方案）"""
    if not text1 or not text2:
        return 0
    
    # 简单的字符级相似度
    longer = text1 if len(text1) > len(text2) else text2
    shorter = text2 if len(text1) > len(text2) else text1
    
    if len(longer) == 0:
        return 100
    
    # 计算编辑距离（简化版本）
    matches = sum(1 for a, b in zip(shorter, longer) if a == b)
    similarity = (matches / len(longer)) * 100
    
    return int(similarity)

# WebSocket事件处理
@socketio.on('connect')
def handle_connect():
    logger.info('客户端连接WebSocket')
    emit('connected', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    logger.info('客户端断开WebSocket连接')

def clean_ai_response_for_tts(ai_text):
    """清理AI回复文本，移除催收员前缀但保留所有内容"""
    # 移除"催收员："前缀和编号，但保留所有内容作为连续文本
    cleaned_text = re.sub(r'\d*\.?\s*催收员[：:]\s*', '', ai_text)
    
    # 清理多余的空白和换行
    cleaned_text = ' '.join(cleaned_text.split())
    
    logger.info(f'AI回复清理: 原文长度={len(ai_text)}, 清理后长度={len(cleaned_text)}')
    logger.info(f'清理后内容: "{cleaned_text[:100]}..."')
    
    return cleaned_text.strip()

@socketio.on('chat_message')
def handle_chat_message(data):
    """处理聊天消息并流式返回连续音频"""
    try:
        message = data.get('message', '')
        message_type = data.get('messageType', 'user')
        customer_context = data.get('customerContext', {})
        conversation_history = data.get('conversationHistory', [])
        
        logger.info(f'WebSocket收到消息: {message[:50]}... 类型: {message_type}')
        
        # 对于代理问候语，使用流式TTS
        if message_type == 'agent_greeting':
            logger.info('处理代理问候语，使用连续流式TTS')
            generate_tts_audio_streaming(message, 0, 1)
            return
        
        # 构建对话上下文
        system_prompt = build_collection_prompt(customer_context, conversation_history, message)
        
        # 调用通义千问生成回复
        ai_response, llm_latency = generate_ai_response(system_prompt)
        
        if not ai_response:
            emit('error', {'error': '生成AI回复失败'})
            return
        
        # 清理AI回复 - 移除"催收员："前缀但保留内容
        cleaned_response = clean_ai_response_for_tts(ai_response)
        
        # 先发送完整文本用于显示
        emit('text_response', {'text': cleaned_response})
        
        # 将整个回复作为单一连续音频流处理
        logger.info(f'WebSocket连续流式处理完整回复: {cleaned_response[:50]}...')
        tts_latency = generate_tts_audio_streaming(cleaned_response, 0, 1)
        
        if tts_latency is None or tts_latency <= 0:
            logger.error('连续流式音频生成失败')
            tts_latency = 0
        
        # 发送延迟指标到客户端
        emit('latency_metrics', {
            'llm_latency': llm_latency,
            'tts_latency': tts_latency
        })
        
        logger.info(f'WebSocket完成AI回复连续流式处理: {cleaned_response[:50]}... (LLM: {llm_latency}ms, TTS: {tts_latency}ms)')
        
    except Exception as e:
        logger.error(f'WebSocket聊天处理错误: {str(e)}')
        emit('error', {'error': f'处理失败: {str(e)}'})

if __name__ == '__main__':
    logger.info('启动AI催收助手Qwen服务器 (WebSocket支持)...')
    logger.info(f'DashScope API Key: {"已设置" if DASHSCOPE_API_KEY else "未设置"}')
    socketio.run(app, host='0.0.0.0', port=3003, debug=True, allow_unsafe_werkzeug=True)