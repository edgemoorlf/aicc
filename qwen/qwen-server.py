# AI催收助手 - Qwen实现服务器
# 基于Python Flask + Alibaba Cloud APIs

import os
import json
import base64
import time
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import dashscope
from dashscope import Generation
from dashscope.audio.asr import Recognition
import logging

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

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
            
        # 生成语音
        audio_data = generate_tts_audio(ai_response)
        
        logger.info(f'AI回复: {ai_response[:50]}...')
        
        return jsonify({
            'audio': audio_data,
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

语言要求:
- 使用大陆标准普通话，避免台湾用语
- 金额表达: 15000元说成"一万五千元"，不是"十五千元"
- 语气要专业、理解，体现人文关怀

请基于完整的通话记录，以专业催收员的身份回应客户最新的话语。"""

    return system_prompt

def generate_ai_response(system_prompt):
    """使用通义千问生成AI回复"""
    try:
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
        
        if response.status_code == 200:
            ai_text = response.output.choices[0].message.content
            return ai_text.strip()
        else:
            logger.error(f'通义千问API调用失败: {response.status_code}')
            return None
            
    except Exception as e:
        logger.error(f'生成AI回复错误: {str(e)}')
        return None

def generate_tts_audio(text):
    """使用通义千问TTS生成语音"""
    try:
        logger.info(f'生成TTS音频: {text[:30]}...')
        
        # 使用streaming方式，类似工作示例
        responses = dashscope.audio.qwen_tts.SpeechSynthesizer.call(
            model="qwen-tts",
            api_key=DASHSCOPE_API_KEY,  # 显式传递API key
            text=text,
            voice="Cherry",  # 中文女声 - 使用支持的声音
            stream=True  # 使用流式处理
        )
        
        # 收集所有音频数据块
        pcm_data = b''
        for chunk in responses:
            if "output" in chunk and "audio" in chunk["output"] and "data" in chunk["output"]["audio"]:
                audio_string = chunk["output"]["audio"]["data"]
                wav_bytes = base64.b64decode(audio_string)
                pcm_data += wav_bytes
        
        if pcm_data:
            logger.info(f'PCM数据长度: {len(pcm_data)} bytes')
            
            # 将PCM数据转换为WAV格式
            wav_data = create_wav_buffer(pcm_data)
            logger.info(f'WAV数据长度: {len(wav_data)} bytes')
            
            return list(wav_data)
        else:
            logger.error('TTS响应中没有音频数据')
            return []
            
    except Exception as e:
        logger.error(f'TTS生成错误: {str(e)}')
        return []

def create_wav_buffer(pcm_data):
    """将PCM16数据转换为WAV格式"""
    import struct
    
    # WAV文件参数 (基于test_qwen_tts.py中的配置)
    sample_rate = 24000  # 24kHz
    num_channels = 1     # 单声道
    bits_per_sample = 16 # 16位PCM
    data_size = len(pcm_data)
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
    return bytes(header) + pcm_data

def recognize_speech_dashscope(audio_file):
    """使用DashScope进行语音识别"""
    try:
        logger.info('开始DashScope语音识别...')
        
        # 读取音频文件内容
        audio_content = audio_file.read()
        logger.info(f'音频文件大小: {len(audio_content)} bytes')
        
        # 将WebM文件转换为WAV格式
        import tempfile
        from pydub import AudioSegment
        
        # 保存原始WebM文件
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as webm_file:
            webm_file.write(audio_content)
            webm_file_path = webm_file.name
        
        # 转换为WAV文件
        wav_file_path = webm_file_path.replace('.webm', '.wav')
        
        try:
            # 使用pydub将WebM转换为WAV
            logger.info('转换WebM到WAV格式...')
            audio = AudioSegment.from_file(webm_file_path, format="webm")
            
            # 检查音频属性
            duration_ms = len(audio)
            duration_sec = duration_ms / 1000.0
            logger.info(f'原始音频时长: {duration_sec:.2f}秒 ({duration_ms}ms)')
            logger.info(f'原始音频采样率: {audio.frame_rate}Hz, 声道数: {audio.channels}')
            
            # 检查音频是否太短
            if duration_sec < 0.5:
                logger.warning(f'音频过短({duration_sec:.2f}秒)，可能无法识别')
            elif duration_sec > 60:
                logger.warning(f'音频过长({duration_sec:.2f}秒)，可能超出限制')
            
            # 转换为16kHz单声道WAV（DashScope要求的格式）
            audio = audio.set_frame_rate(16000).set_channels(1)
            # 确保是16位PCM格式
            audio = audio.set_sample_width(2)  # 2字节 = 16位
            audio.export(wav_file_path, format="wav")
            
            logger.info(f'音频转换完成: {wav_file_path}')
            logger.info(f'转换后音频时长: {len(audio)/1000.0:.2f}秒')
            
            # 验证WAV文件是否存在并有内容
            if not os.path.exists(wav_file_path):
                logger.error(f'WAV文件不存在: {wav_file_path}')
                return None
                
            wav_size = os.path.getsize(wav_file_path)
            logger.info(f'WAV文件大小: {wav_size} bytes')
            
            if wav_size == 0:
                logger.error('WAV文件为空')
                return None
            
            # 使用DashScope ASR API识别WAV文件
            logger.info('开始调用DashScope ASR...')
            recognition = Recognition(
                model='paraformer-realtime-v2',
                format='wav',
                sample_rate=16000,
                callback=None  # 同步调用
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
            logger.error(f'音频转换或识别错误: {str(e)}')
            import traceback
            logger.error(f'错误详情: {traceback.format_exc()}')
            return None
            
        finally:
            # 清理临时文件 - 保留WAV文件用于调试
            import time
            time.sleep(1)  # 给文件系统一点时间
            try:
                if os.path.exists(webm_file_path):
                    os.unlink(webm_file_path)
                    logger.info(f'清理WebM文件: {webm_file_path}')
                # 注释掉WAV文件清理，用于调试
                # if os.path.exists(wav_file_path):
                #     os.unlink(wav_file_path)
                #     logger.info(f'清理WAV文件: {wav_file_path}')
                if os.path.exists(wav_file_path):
                    logger.info(f'保留WAV文件用于调试: {wav_file_path}')
            except Exception as cleanup_error:
                logger.error(f'清理文件失败: {cleanup_error}')
                
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

if __name__ == '__main__':
    logger.info('启动AI催收助手Qwen服务器...')
    logger.info(f'DashScope API Key: {"已设置" if DASHSCOPE_API_KEY else "未设置"}')
    app.run(host='0.0.0.0', port=3003, debug=True)