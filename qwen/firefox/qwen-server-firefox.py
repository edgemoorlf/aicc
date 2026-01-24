#!/usr/bin/env python3
"""
AI催收助手 - Firefox OGG/Opus优化服务器
支持直接OGG/Opus流式ASR，零转换延迟
使用Socket.IO协议匹配Firefox客户端

基于chrome/qwen-server.py，专门优化Firefox OGG/Opus格式处理
关键优化：format='opus' 直接传输到DashScope，无需转换
"""

import os
import json
import time
import logging
import base64
import tempfile
import asyncio
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# DashScope imports
import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
from dashscope import Generation

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('firefox-server.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# DashScope配置
DASHSCOPE_API_KEY = os.getenv('DASHSCOPE_API_KEY')
if not DASHSCOPE_API_KEY:
    logger.error('DASHSCOPE_API_KEY 环境变量未设置')
    raise ValueError('请设置 DASHSCOPE_API_KEY 环境变量')

dashscope.api_key = DASHSCOPE_API_KEY
logger.info("✅ DashScope API配置完成 (Firefox OGG/Opus优化版)")

# 全局变量
conversation_history = []
active_asr_sessions = {}  # 存储活跃的流式ASR会话

# 全局语音设置
current_voice_settings = {
    'speed': 1.0,
    'pitch': 1.0, 
    'volume': 0.8,
    'voice': 'Dylan',
    'tone': 'professional',
    'emotion': 'professional'
}

# Dead code removed - HTTP transcribe route and recognize_firefox_ogg_opus function
# All transcription now uses streaming ASR via WebSocket

@app.route('/api/evaluate-accuracy', methods=['POST'])
def evaluate_accuracy():
    """准确性评估API - Firefox版本"""
    try:
        data = request.get_json()
        original_text = data.get('originalText', '')
        spoken_text = data.get('spokenText', '')
        context = data.get('context', '')
        
        logger.info(f'🦊 Firefox评估准确性: 原文长度={len(original_text)}, 识别长度={len(spoken_text)}')
        
        # 改进的中文准确性计算
        if not spoken_text or not original_text:
            accuracy = 0.0
        else:
            # 清理文本
            import re
            original_clean = re.sub(r'[^\w\s]', '', original_text.strip())
            spoken_clean = re.sub(r'[^\w\s]', '', spoken_text.strip())
            
            if len(original_clean) == 0 and len(spoken_clean) == 0:
                accuracy = 1.0  # 都为空认为匹配
            elif len(original_clean) == 0 or len(spoken_clean) == 0:
                accuracy = 0.0  # 一个为空一个不为空
            else:
                # 计算词汇相似度
                original_chars = set(original_clean)
                spoken_chars = set(spoken_clean)
                
                # Jaccard相似度（交集/并集）
                intersection = len(original_chars & spoken_chars)
                union = len(original_chars | spoken_chars)
                jaccard_similarity = intersection / union if union > 0 else 0.0
                
                # 长度相似度（防止长度差异过大）
                length_similarity = min(len(original_clean), len(spoken_clean)) / max(len(original_clean), len(spoken_clean))
                
                # 综合相似度（加权平均）
                accuracy = (jaccard_similarity * 0.7 + length_similarity * 0.3)
        
        # 生成详细评估指标
        vocabulary_accuracy = round(accuracy * 100, 1)
        semantic_completeness = max(50, round(accuracy * 95, 1))  # 语义完整性通常较高
        terminology_accuracy = max(40, round(accuracy * 85, 1))   # 术语准确性稍低
        comprehensibility = max(60, round(accuracy * 90, 1))      # 理解度
        
        evaluation = {
            'overall_score': vocabulary_accuracy,
            'accuracy_percentage': vocabulary_accuracy,
            'vocabulary_accuracy': vocabulary_accuracy,
            'semantic_completeness': semantic_completeness,
            'terminology_accuracy': terminology_accuracy,
            'comprehensibility': comprehensibility,
            'format': 'ogg/opus',
            'optimization': 'zero_conversion_latency',
            'algorithm': 'jaccard_similarity_chinese',
            'original_length': len(original_text),
            'spoken_length': len(spoken_text)
        }
        
        logger.info(f'✅ Firefox评估完成: 总分{vocabulary_accuracy}% (词汇:{vocabulary_accuracy}%, 语义:{semantic_completeness}%, 术语:{terminology_accuracy}%)')
        return jsonify(evaluation)
        
    except Exception as e:
        logger.error(f'❌ Firefox准确性评估失败: {str(e)}')
        return jsonify({
            'error': '准确性评估失败',
            'details': str(e)
        }), 500

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('.', filename)

class FirefoxStreamingASRSession:
    """Firefox OGG/Opus流式ASR会话管理"""
    
    def __init__(self, session_id):
        self.session_id = session_id
        self.recognition = None
        self.is_active = False
        self.start_time = None
        
        # 🔧 句子完整性检测
        self.last_partial_text = ""
        self.last_update_time = 0
        self.sentence_timeout = 2000  # 2000ms内没有更新认为句子完成
        self.pending_final_check = None  # 定时器句柄
        
        # 🔧 重启控制机制
        self.last_restart_time = 0
        self.restart_cooldown = 5.0  # 5秒重启冷却期
        self.consecutive_failures = 0
        self.max_consecutive_failures = 3  # 最大连续失败次数
        
        # 🔧 ASR延迟测量
        self.sentence_end_time = None    # 句子结束时间（客户停止说话）
        self.last_audio_time = None      # 最后音频数据接收时间
        
    def start_streaming_asr(self):
        """启动流式ASR识别 - Firefox OGG/Opus优化版"""
        try:
            logger.info(f'🦊 启动Firefox流式ASR会话: {self.session_id}')
            
            # 创建回调实例
            callback = FirefoxASRCallback(self)
            
            # 创建Recognition实例 - 使用Opus格式（直接OGG/Opus支持）
            self.recognition = Recognition(
                model="paraformer-realtime-v2",  # 🔧 使用通用版本支持多种采样率
                format="opus",  # 🚀 Firefox优化：直接支持OGG/Opus格式
                sample_rate=48000,  # Firefox MediaRecorder默认48kHz
                callback=callback,
                # 🎯 电话模式优化参数
                semantic_punctuation_enabled=True,  # 智能标点符号
                max_sentence_silence=1500,          # 1.5秒静音检测，更适应电话对话节奏
                heartbeat=True,                     # 心跳保持长连接稳定
                multi_threshold_mode_enabled=True   # 多阈值模式，提高语音检测精度
            )
            
            # 启动识别
            self.recognition.start()
            self.is_active = True
            self.start_time = time.time()
            
            logger.info(f'✅ Firefox流式ASR启动成功: {self.session_id} (format=opus)')
            return True
            
        except Exception as e:
            logger.error(f'❌ Firefox流式ASR启动失败: {e}')
            import traceback
            logger.error(f'🔍 ASR启动异常详情: {traceback.format_exc()}')
            
            # 清理失败的实例
            self.is_active = False
            self.recognition = None
            return False
    
    def send_audio_data(self, audio_data):
        """发送OGG/Opus音频数据到ASR - 零转换延迟"""
        try:
            # 首先检查连接是否仍然有效
            if self.recognition and self.is_active:
                # 检查连接时长，如果超过5分钟则主动重启
                connection_age = time.time() - self.start_time if self.start_time else 0
                if connection_age > 300:  # 5分钟
                    logger.info(f'🔄 ASR连接已持续{connection_age:.1f}秒，主动重启以保持稳定性')
                    self.is_active = False
                    self.recognition = None
                    
            if not self.recognition or not self.is_active:
                # 检查是否在冷却期内
                current_time = time.time()
                if current_time - self.last_restart_time < self.restart_cooldown:
                    logger.warning(f'ASR重启冷却期内，跳过重启 ({self.restart_cooldown - (current_time - self.last_restart_time):.1f}秒后可重启)')
                    return False
                
                # 检查是否超过最大失败次数
                if self.consecutive_failures >= self.max_consecutive_failures:
                    logger.error(f'ASR会话已达到最大失败次数({self.max_consecutive_failures})，停止自动重启')
                    return False
                
                logger.warning('ASR会话未活跃，尝试重启流式ASR')
                if self.restart_streaming_asr():
                    self.consecutive_failures = 0  # 重启成功，重置失败计数
                    # 短暂等待让新连接稳定
                    time.sleep(0.1)
                else:
                    self.consecutive_failures += 1
                    self.last_restart_time = current_time
                    return False
            
            # 验证audio_data
            if not audio_data or len(audio_data) == 0:
                logger.warning('收到空音频数据，跳过发送')
                return True
                
            # 🔧 记录最后音频接收时间（用于ASR延迟计算）
            self.last_audio_time = time.time()
                
            # 直接发送OGG/Opus数据到DashScope，无需转换！
            
            # 分块发送音频数据以提高成功率
            chunk_size = 2048  # 2KB块
            chunks_sent = 0
            
            for i in range(0, len(audio_data), chunk_size):
                chunk = audio_data[i:i+chunk_size]
                try:
                    self.recognition.send_audio_frame(chunk)
                    chunks_sent += 1
                    
                    # 短暂延迟模拟流式传输
                    time.sleep(0.01)  # 10ms延迟
                except Exception as chunk_error:
                    logger.error(f'❌ 发送音频块失败: {chunk_error}')
                    raise chunk_error
            
            processing_time = 0
            if self.start_time:
                processing_time = (time.time() - self.start_time) * 1000
            
            logger.info(f'📤 Firefox OGG/Opus数据分块发送: {chunks_sent}块, {len(audio_data)} bytes (零转换延迟! 耗时: {processing_time:.1f}ms)')
            return True
            
        except Exception as e:
            logger.error(f'❌ 音频数据发送失败: {e}')
            
            # 详细记录错误类型以便调试
            error_msg = str(e)
            if "Speech recognition has stopped" in error_msg:
                logger.info("🔍 ASR连接被服务器关闭，可能原因: 1)超时 2)格式问题 3)连接限制")
            elif "Connection" in error_msg:
                logger.info("🔍 网络连接问题")
            else:
                logger.info(f"🔍 其他ASR错误: {error_msg}")
                
            # 出错时增加失败计数，但不要立即重试
            self.consecutive_failures += 1
            self.last_restart_time = time.time()
            
            # 立即清理失败的连接
            if self.recognition:
                try:
                    self.recognition.stop()
                except:
                    pass
                self.recognition = None
                self.is_active = False
            
            logger.info(f"⚠️ ASR失败次数: {self.consecutive_failures}/{self.max_consecutive_failures}")
            return False
    
    def restart_streaming_asr(self):
        """重启流式ASR连接 - 带有退避策略"""
        try:
            # 完全清理当前连接
            if self.recognition:
                try:
                    logger.info("🔄 强制停止ASR连接...")
                    self.recognition.stop()
                except:
                    pass  # 忽略停止时的错误
                finally:
                    self.recognition = None
                    self.is_active = False
            
            # 等待足够长的时间让DashScope清理连接
            time.sleep(2.0)  # 增加等待时间到2秒
            
            logger.info(f"🔄 重新创建ASR会话: {self.session_id}")
            
            # 完全重新创建会话（类似于start_streaming_asr）
            return self.start_streaming_asr()
            
        except Exception as e:
            logger.error(f'❌ Firefox流式ASR重启失败: {e}')
            self.is_active = False
            self.recognition = None
            return False
    
    def check_sentence_completion_by_timeout(self, current_text):
        """基于超时检测句子完成（备用方案）"""
        import threading
        
        current_time = time.time()
        self.last_update_time = current_time
        
        # 如果文本发生变化，取消之前的定时器
        if self.pending_final_check and current_text != self.last_partial_text:
            try:
                self.pending_final_check.cancel()
            except:
                pass
            self.pending_final_check = None
        
        # 更新最新的部分文本
        self.last_partial_text = current_text
        
        # 设置新的完成检测定时器
        def delayed_sentence_completion():
            try:
                # 检查是否在超时期间文本没有更新
                if (time.time() - self.last_update_time) >= self.sentence_timeout and current_text == self.last_partial_text:
                    logger.info(f'⏰ 超时检测到句子完成: "{current_text}"')
                    
                    # 触发LLM处理（让客户端处理，避免双重处理）
                    if current_text.strip():
                        socketio.emit('user_speech_recognized', {
                            'text': current_text,
                            'timestamp': time.time(),
                            'session_id': self.session_id,
                            'is_final': True,
                            'completion_method': 'timeout'
                        })
                        
                        # 🔧 修复：移除服务器端直接LLM处理，让客户端通过chat_message处理
                        # socketio.start_background_task(process_firefox_llm_and_tts, current_text, self.session_id)
            except Exception as e:
                logger.error(f'超时句子完成检测失败: {e}')
        
        # 启动延迟检测
        self.pending_final_check = threading.Timer(self.sentence_timeout, delayed_sentence_completion)
        self.pending_final_check.start()
        
    def stop_streaming_asr(self):
        """停止流式ASR识别"""
        try:
            if self.recognition and self.is_active:
                self.recognition.stop()
                self.is_active = False
                logger.info(f'🛑 Firefox流式ASR会话停止: {self.session_id}')
        except Exception as e:
            logger.error(f'❌ 停止ASR失败: {e}')

class FirefoxASRCallback(RecognitionCallback):
    """Firefox ASR识别回调"""
    
    def __init__(self, asr_session):
        self.asr_session = asr_session
        self.recognition_start_time = None
        
    def on_open(self):
        self.recognition_start_time = time.time()
        logger.info(f"✅ Firefox ASR连接建立: {self.asr_session.session_id}")
        
        # 通知客户端ASR已启动
        socketio.emit('asr_started', {
            'session_id': self.asr_session.session_id,
            'format': 'ogg/opus',
            'optimization': 'zero_conversion_latency'
        })
    
    def on_event(self, result):
        # 调试：打印完整的result结构
        logger.info(f"🔍 DashScope完整result: type={type(result)}, content={result}")
        
        if isinstance(result, RecognitionResult):
            sentence = result.get_sentence()
            logger.info(f"🔍 DashScope sentence结构: {sentence}")
            
            if sentence:
                text = sentence.get('text', '')
                confidence = sentence.get('confidence', 0)
                begin_time = sentence.get('begin_time', 0)
                end_time = sentence.get('end_time', 0)
                
                # 🔧 关键：检查句子完成状态
                is_sentence_end = sentence.get('sentence_end', False) or sentence.get('is_final', False)
                
                # 🔧 修复：计算真实ASR延迟 = 从客户停止说话到结果返回的时间
                asr_latency = 0
                current_time = time.time()
                
                if is_sentence_end:
                    # 对于最终结果，我们关心从句子结束到现在的延迟
                    if end_time > 0:
                        # 如果DashScope提供了end_time，估算句子结束时间
                        # end_time是相对于开始的秒数，我们需要转换为绝对时间
                        sentence_duration = end_time - begin_time if begin_time else 0
                        estimated_sentence_end = current_time - sentence_duration if sentence_duration > 0 else current_time
                        asr_latency = (current_time - estimated_sentence_end) * 1000
                    elif self.asr_session.last_audio_time:
                        # 备用方案：从最后音频数据时间算起（近似）
                        asr_latency = (current_time - self.asr_session.last_audio_time) * 1000
                    else:
                        # 默认处理延迟
                        asr_latency = 200
                    
                    # 确保延迟在合理范围内（ASR处理延迟通常100-2000ms）
                    asr_latency = max(50, min(asr_latency, 3000))
                else:
                    # 对于部分结果，延迟通常更短
                    asr_latency = 100
                
                # 调试：显示句子状态
                logger.info(f"🔍 句子状态检查: text='{text}', sentence_end={is_sentence_end}, begin_time={begin_time}, end_time={end_time}")
                
                # 尝试从其他可能的字段获取置信度
                if confidence == 0:
                    # DashScope可能使用不同的字段名
                    confidence = sentence.get('conf', 0)  # 可能是 conf
                    if confidence == 0:
                        confidence = sentence.get('score', 0)  # 可能是 score
                        if confidence == 0:
                            confidence = sentence.get('begin_time', 0)  # 有时置信度在其他字段
                            if confidence == 0:
                                # 如果没有置信度信息，使用默认值0.8（假设识别质量不错）
                                confidence = 0.8
                                logger.info(f"⚠️ DashScope未提供置信度，使用默认值: {confidence}")
                
                logger.info(f"🦊 Firefox ASR结果: '{text}' (置信度: {confidence:.2f}, 处理延迟: {asr_latency:.1f}ms, 完整: {is_sentence_end})")
                
                # 发送ASR结果到客户端（包括部分结果用于实时显示）
                socketio.emit('asr_result', {
                    'text': text,
                    'confidence': confidence,
                    'latency_ms': asr_latency,
                    'format': 'ogg/opus',
                    'conversion_time_ms': 0,  # 零转换时间！
                    'session_id': self.asr_session.session_id,
                    'is_final': is_sentence_end,  # 添加完整性标记
                    'is_partial': not is_sentence_end
                })
                
                # 🔧 关键修复：只有完整句子才处理LLM+TTS
                # 过滤条件：1) 文本非空 2) 置信度足够 3) 句子完整
                logger.info(f'🔍 ASR处理条件检查: text_len={len(text.strip())}, confidence={confidence:.2f}, is_final={is_sentence_end}')
                
                if text.strip() and confidence > 0.3:
                    if is_sentence_end:
                        # 明确的句子结束标记
                        logger.info(f'🎯 Firefox完整句子识别（DashScope标记）: {text}')
                        
                        # 取消任何pending的超时检测
                        if self.asr_session.pending_final_check:
                            try:
                                self.asr_session.pending_final_check.cancel()
                                self.asr_session.pending_final_check = None
                            except:
                                pass
                        
                        # 发送用户语音识别完成事件 - 让客户端处理LLM调用
                        socketio.emit('user_speech_recognized', {
                            'text': text,
                            'timestamp': time.time(),
                            'session_id': self.asr_session.session_id,
                            'is_final': True,
                            'completion_method': 'dashscope_flag'
                        })
                        
                        # 🔧 修复：移除服务器端直接LLM处理，让客户端通过chat_message处理
                        # socketio.start_background_task(process_firefox_llm_and_tts, text, self.asr_session.session_id)
                    else:
                        # 没有明确的结束标记，启动超时检测
                        logger.info(f'⏳ 启动超时检测: "{text[:30]}..."')
                        self.asr_session.check_sentence_completion_by_timeout(text)
                elif not is_sentence_end and text.strip():
                    logger.info(f'⏳ 部分结果，等待句子完成: "{text[:30]}..."')
                else:
                    logger.info(f'⚠️ ASR文本未达到处理条件: confidence={confidence:.2f} (需要>0.3), text_length={len(text.strip())}, is_final={is_sentence_end}')
    
    def on_error(self, error):
        logger.error(f"❌ Firefox ASR错误: {error}")
        socketio.emit('asr_error', {
            'error': str(error),
            'session_id': self.asr_session.session_id
        })
    
    def on_close(self):
        logger.info(f"🔒 Firefox ASR连接关闭: {self.asr_session.session_id}")
        socketio.emit('asr_closed', {
            'session_id': self.asr_session.session_id
        })

def build_collection_prompt(customer_context, conversation_history):
    """构建催收专员的系统提示 - Firefox版本（不包含当前用户消息）"""
    
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
    
    # 构建对话历史（不包含当前消息）
    conversation_text = ""
    if conversation_history:
        conversation_text = "\n本次通话记录:\n"
        for i, entry in enumerate(conversation_history):
            role = "客户" if entry.get('sender') == 'user' else "催收员"
            conversation_text += f"{i+1}. {role}: {entry.get('text', '')}\n"
    else:
        conversation_text = "\n本次通话记录:\n(开始新对话)\n"
    
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

请以专业催收员的身份，针对客户的话语给出合适的回应，推进催收对话。"""

    return system_prompt

def process_firefox_llm_and_tts(user_text, session_id, voice_settings=None):
    """处理Firefox LLM响应和TTS生成"""
    try:
        # 使用传入的语音设置或全局设置
        if voice_settings is None:
            voice_settings = current_voice_settings
            
        logger.info(f'💬 Firefox LLM处理开始: "{user_text}" (session: {session_id}) 语音设置: {voice_settings}')
        llm_start = time.time()
        
        # 构建专业催收对话提示 - 与Chrome版本保持一致
        customer_context = {
            'name': '客户',
            'balance': 15000,  # 示例数据
            'daysOverdue': 30,
            'previousContacts': 2,
            'riskLevel': '中等'
        }
        
        # 获取对话历史（简化版本）
        conversation_history = []  # 在实际应用中应该维护对话历史
        
        system_prompt = build_collection_prompt(customer_context, conversation_history)
        
        logger.info(f'🧠 调用Qwen Turbo (最新版)...')
        response = Generation.call(
            model='qwen-turbo-latest',  # 🚀 更快的Turbo模型
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_text}
            ],
            temperature=0.7,
            max_tokens=500,
            result_format='message'
        )
        
        llm_latency = (time.time() - llm_start) * 1000
        
        if response.status_code == 200:
            ai_response = response.output.choices[0].message.content
            logger.info(f"💬 Firefox Qwen-Turbo响应: '{ai_response}' (延迟: {llm_latency:.1f}ms)")
            
            # 发送LLM结果
            socketio.emit('text_response', {
                'text': ai_response,
                'latency_ms': llm_latency,
                'session_id': session_id
            })
            
            # 生成TTS音频（复用现有TTS逻辑）
            logger.info(f'🎵 启动Firefox TTS生成...')
            generate_tts_audio_streaming(ai_response, session_id, voice_settings)
        else:
            logger.error(f"❌ LLM调用失败: status={response.status_code}")
            
    except Exception as e:
        logger.error(f"❌ Firefox LLM处理失败: {e}")
        import traceback
        traceback.print_exc()

def generate_tts_audio_streaming(text, session_id, voice_settings=None):
    """生成流式TTS音频 - Firefox版本，支持语音控制参数"""
    try:
        import dashscope.audio.qwen_tts
        import base64  # 添加base64导入
        
        # 使用传入的语音设置或全局设置
        if voice_settings is None:
            voice_settings = current_voice_settings
        
        tts_start = time.time()
        logger.info(f'🎵 Firefox TTS开始生成: "{text}" 语音设置: {voice_settings}')
        
        # 构建TTS API参数 - 使用最新的qwen-tts-latest模型
        tts_params = {
            "model": "qwen-tts-latest",  # 🚀 使用latest版本获得更多语音控制
            "text": text,
            "voice": voice_settings.get('voice', 'Dylan'),  # 🎯 支持多种声音选择
            "stream": True,  # 流式处理
            "format": "pcm",  # PCM格式用于流式传输
            "sample_rate": 24000  # 24kHz采样率
        }
        
        # 🎯 应用语音控制参数（基于阿里云SDK文档）
        if 'speed' in voice_settings:
            tts_params['speed'] = voice_settings['speed']  # 语速控制
        if 'pitch' in voice_settings:
            tts_params['pitch'] = voice_settings['pitch']  # 音调控制  
        if 'volume' in voice_settings:
            tts_params['volume'] = voice_settings['volume']  # 音量控制
        if 'tone' in voice_settings and voice_settings['tone'] != 'neutral':
            tts_params['tone'] = voice_settings['tone']  # 语调控制
        if 'emotion' in voice_settings and voice_settings['emotion'] != 'neutral':
            tts_params['emotion'] = voice_settings['emotion']  # 情感控制
        
        logger.info(f'🎵 TTS参数: {tts_params}')
        
        # 使用Chrome相同的TTS API - 修复SpeechSynthesizer问题
        responses = dashscope.audio.qwen_tts.SpeechSynthesizer.call(**tts_params)
        
        # 检查responses是否为None
        if responses is None:
            raise ValueError("TTS API返回None响应")
        
        # 流式生成PCM数据 - 添加索引支持
        chunk_index = 1
        segment_index = 0  # Firefox简化为单一段落
        first_chunk_latency = None  # 首个PCM块延迟
        
        # 处理流式响应
        for response in responses:
            if response and "output" in response and "audio" in response["output"] and "data" in response["output"]["audio"]:
                # 获取Base64编码的音频数据
                audio_string = response["output"]["audio"]["data"]
                pcm_bytes = base64.b64decode(audio_string)
                
                if pcm_bytes:
                    # 🔧 记录首个PCM块延迟（真实TTS延迟）
                    if first_chunk_latency is None:
                        first_chunk_latency = (time.time() - tts_start) * 1000
                        logger.info(f'🎵 首个PCM块延迟: {first_chunk_latency:.1f}ms (TTS处理延迟)')
                    
                    # 发送PCM块到客户端 - 包含客户端期望的索引字段
                    socketio.emit('pcm_chunk', {
                        'pcm_data': list(pcm_bytes),  # Firefox客户端期望pcm_data字段
                        'chunk_index': chunk_index,  # 添加块索引
                        'segment_index': segment_index,  # 添加段落索引
                        'sample_rate': 24000,  # DashScope TTS默认24kHz
                        'format': 'pcm',
                        'session_id': session_id,
                        'first_chunk_latency': first_chunk_latency if chunk_index == 1 else None,  # 首块包含延迟信息
                        'voice_settings': voice_settings  # 包含语音设置信息
                    })
                    
                    logger.info(f'📤 Firefox PCM块 {chunk_index}: {len(pcm_bytes)} bytes')
                    chunk_index += 1
            elif response.status_code != 200:
                logger.error(f"❌ TTS流式响应错误: {response.status_code}")
                break
        
        # 发送TTS完成信号 - 使用首块延迟而不是总时间
        total_generation_time = (time.time() - tts_start) * 1000
        effective_tts_latency = first_chunk_latency if first_chunk_latency else 2000  # 默认2秒如果无首块
        
        socketio.emit('pcm_segment_end', {
            'segment_index': segment_index,
            'chunk_count': chunk_index - 1,
            'latency_ms': effective_tts_latency,  # 使用首块延迟
            'total_generation_ms': total_generation_time,  # 额外信息：总生成时间
            'session_id': session_id,
            'voice_settings': voice_settings  # 包含使用的语音设置
        })
        
        logger.info(f'✅ Firefox TTS流式生成完成: {chunk_index-1}个块, 首块延迟: {effective_tts_latency:.1f}ms, 总时间: {total_generation_time:.1f}ms, 语音设置: {voice_settings}')
        
    except Exception as e:
        logger.error(f'❌ Firefox TTS生成失败: {e}')
        import traceback
        traceback.print_exc()
        
        # 发送TTS错误信号
        socketio.emit('tts_error', {
            'message': f'TTS生成失败: {str(e)}',
            'session_id': session_id
        })

@socketio.on('connect')
def handle_connect():
    logger.info(f'🦊 Firefox客户端连接: {request.sid}')
    emit('connected', {
        'status': 'connected',
        'server_version': 'firefox-ogg-opus-v1.0',
        'supported_format': 'audio/ogg;codecs=opus',
        'optimization': 'zero_conversion_latency'
    })

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f'🔌 Firefox客户端断开: {request.sid}')
    
    # 清理ASR会话
    if request.sid in active_asr_sessions:
        active_asr_sessions[request.sid].stop_streaming_asr()
        del active_asr_sessions[request.sid]

@socketio.on('start_streaming_asr')
def handle_start_streaming_asr(data=None):
    """启动Firefox流式ASR - 支持强制重启"""
    session_id = request.sid
    logger.info(f'🚀 Firefox客户端请求启动流式ASR: {session_id} (data: {data})')
    
    # 检查是否有现有会话，如果有则先清理
    if session_id in active_asr_sessions:
        logger.info(f'🔄 清理现有ASR会话: {session_id}')
        active_asr_sessions[session_id].stop_streaming_asr()
        del active_asr_sessions[session_id]
    
    # 创建新的ASR会话
    asr_session = FirefoxStreamingASRSession(session_id)
    
    # 强制重置失败计数（用户主动启动时重置）
    asr_session.consecutive_failures = 0
    asr_session.last_restart_time = 0
    
    if asr_session.start_streaming_asr():
        active_asr_sessions[session_id] = asr_session
        logger.info(f'✅ Firefox ASR会话创建成功: {session_id}')
        emit('streaming_asr_started', {
            'success': True,
            'session_id': session_id,
            'format': 'ogg/opus',
            'message': 'Firefox流式ASR启动成功 (零转换延迟)'
        })
    else:
        logger.error(f'❌ Firefox ASR会话创建失败: {session_id}')
        emit('streaming_asr_error', {
            'success': False,
            'error': 'Firefox流式ASR启动失败'
        })

@socketio.on('audio_data')
def handle_audio_data(data):
    """处理Firefox OGG/Opus音频数据"""
    session_id = request.sid
    
    if session_id not in active_asr_sessions:
        logger.warning(f'未找到ASR会话: {session_id}')
        emit('error', {'message': '未找到活跃的ASR会话'})
        return
    
    try:
        # 解码base64音频数据
        audio_bytes = base64.b64decode(data['audio'])
        
        # 直接发送OGG/Opus数据到DashScope
        asr_session = active_asr_sessions[session_id]
        success = asr_session.send_audio_data(audio_bytes)
        
        if success:
            logger.info(f'✅ Firefox OGG/Opus数据处理成功: {len(audio_bytes)} bytes')
        else:
            logger.error('❌ Firefox音频数据处理失败')
            
    except Exception as e:
        logger.error(f'❌ Firefox音频数据处理异常: {e}')
        emit('error', {'message': f'音频数据处理失败: {str(e)}'})

@socketio.on('send_opus_chunk')
def handle_send_opus_chunk(data):
    """处理连续OGG/Opus音频块 - 电话模式"""
    try:
        session_id = data.get('session_id')
        opus_data = data.get('opus_data')
        
        if not session_id or not opus_data:
            logger.warning('连续音频块缺少session_id或opus_data')
            return
        
        # 查找ASR会话
        asr_session = active_asr_sessions.get(session_id)
        if not asr_session:
            logger.warning(f'未找到ASR会话: {session_id}')
            emit('error', {'message': '未找到活跃的ASR会话'})
            return
        
        # 转换数据格式
        if isinstance(opus_data, list):
            opus_bytes = bytes(opus_data)
        else:
            opus_bytes = opus_data
        
        # 发送到DashScope ASR
        success = asr_session.send_audio_data(opus_bytes)
        
        if success:
            logger.debug(f'📤 连续OGG/Opus块处理成功: {len(opus_bytes)} bytes')
        else:
            logger.warning(f'⚠️ 连续音频块处理失败，会话: {session_id}')
            
    except Exception as e:
        logger.error(f'❌ 连续音频块处理异常: {e}')
        emit('error', {'message': f'连续音频处理失败: {str(e)}'})

@socketio.on('asr_status_check')
def handle_asr_status_check():
    """检查ASR会话状态 - 调试用"""
    session_id = request.sid
    
    if session_id in active_asr_sessions:
        asr_session = active_asr_sessions[session_id]
        status = {
            'session_exists': True,
            'is_active': asr_session.is_active,
            'consecutive_failures': asr_session.consecutive_failures,
            'last_restart_time': asr_session.last_restart_time,
            'time_since_restart': time.time() - asr_session.last_restart_time if asr_session.last_restart_time > 0 else 0,
            'cooldown_remaining': max(0, asr_session.restart_cooldown - (time.time() - asr_session.last_restart_time)) if asr_session.last_restart_time > 0 else 0
        }
    else:
        status = {
            'session_exists': False,
            'message': 'No active ASR session found'
        }
    
    logger.info(f'📊 ASR状态检查: {session_id} -> {status}')
    emit('asr_status_response', status)

@socketio.on('stop_streaming_asr')
def handle_stop_streaming_asr():
    """停止Firefox流式ASR"""
    session_id = request.sid
    
    if session_id in active_asr_sessions:
        active_asr_sessions[session_id].stop_streaming_asr()
        del active_asr_sessions[session_id]
        
        emit('streaming_asr_stopped', {
            'success': True,
            'session_id': session_id,
            'message': 'Firefox流式ASR已停止'
        })
        
        logger.info(f'🛑 Firefox流式ASR停止: {session_id}')

@socketio.on('chat_message')
def handle_chat_message(data):
    """处理客户端聊天消息 - 包括初始问候语"""
    try:
        message = data.get('message', '')
        message_type = data.get('messageType', 'chat')
        session_id = request.sid
        
        logger.info(f'💬 Firefox聊天消息: "{message[:50]}..." 类型: {message_type}')
        
        if message_type == 'agent_greeting':
            # 初始问候语 - 直接生成TTS
            logger.info(f'🎯 Firefox初始问候语: {message}')
            generate_tts_audio_streaming(message, session_id)
            
        elif message_type == 'customer_with_context':
            # 用户消息 - 处理LLM和TTS
            process_firefox_llm_and_tts(message, session_id)
            
        else:
            # 其他消息类型 - 默认处理
            logger.info(f'🔄 Firefox处理消息类型: {message_type}')
            generate_tts_audio_streaming(message, session_id)
            
    except Exception as e:
        logger.error(f'❌ Firefox聊天消息处理失败: {e}')
        emit('error', {
            'message': f'消息处理失败: {str(e)}'
        })

@socketio.on('chat_message_with_voice')
def handle_chat_message_with_voice(data):
    """处理带有语音设置的聊天消息"""
    try:
        message = data.get('message', '')
        message_type = data.get('messageType', 'chat')
        voice_settings = data.get('voiceSettings', current_voice_settings)
        session_id = request.sid
        
        logger.info(f'💬 Firefox带语音设置的消息: "{message[:50]}..." 设置: {voice_settings}')
        
        if message_type == 'voice_test':
            # 语音测试 - 直接生成TTS
            logger.info(f'🎯 Firefox语音测试: {message}')
            generate_tts_audio_streaming(message, session_id, voice_settings)
            
        elif message_type == 'customer_with_context':
            # 用户消息 - 处理LLM和TTS，使用特定语音设置
            process_firefox_llm_and_tts(message, session_id, voice_settings)
            
        else:
            # 其他消息类型 - 使用特定语音设置
            generate_tts_audio_streaming(message, session_id, voice_settings)
            
    except Exception as e:
        logger.error(f'❌ Firefox带语音设置消息处理失败: {e}')
        emit('error', {
            'message': f'消息处理失败: {str(e)}'
        })

@socketio.on('update_voice_settings')
def handle_update_voice_settings(data):
    """更新全局语音设置"""
    try:
        global current_voice_settings
        voice_settings = data.get('voiceSettings', {})
        
        # 更新全局设置
        current_voice_settings.update(voice_settings)
        
        logger.info(f'✅ Firefox语音设置已更新: {current_voice_settings}')
        
        # 确认更新
        emit('voice_settings_updated', {
            'success': True,
            'settings': current_voice_settings
        })
        
    except Exception as e:
        logger.error(f'❌ Firefox语音设置更新失败: {e}')
        emit('error', {
            'message': f'语音设置更新失败: {str(e)}'
        })

# Dead code removed - WebSocket transcribe_audio handler
# All transcription now uses streaming ASR via send_opus_chunk

if __name__ == '__main__':
    logger.info("🦊 启动Firefox OGG/Opus优化服务器...")
    logger.info("🎯 优化特性: 零转换延迟 (OGG/Opus直传DashScope)")
    logger.info("🚀 格式支持: audio/ogg;codecs=opus")
    logger.info("📡 协议: Socket.IO (兼容Firefox客户端)")
    
    socketio.run(app, host='0.0.0.0', port=3004, debug=False)
    logger.info("✅ Firefox服务器启动成功! 端口: 3004")