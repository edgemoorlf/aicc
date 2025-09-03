#!/usr/bin/env python3
"""
Aliyun CCC Consolidated Server - POC Implementation
Consolidates qwen/firefox client+server logic for telephony inbound calls

Key Features:
- Handles inbound CCC calls with auto-greeting
- G.711 ↔ PCM audio conversion for 8kHz telephony
- Persistent DashScope connections (ASR/LLM/TTS)
- In-memory session state (no concurrency)
- Professional debt collection conversation flow

Architecture:
Customer Calls → CCC Inbound → Function Compute → Consolidated Server → DashScope
"""

import os
import json
import time
import logging
import base64
import tempfile
import audioop
import asyncio
from typing import Dict, Optional, Any
from pathlib import Path

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

# Aliyun CCC SDK
from alibabacloud_ccc20200701.client import Client as CccClient
from alibabacloud_ccc20200701 import models as ccc_models
from alibabacloud_tea_openapi import models as open_api_models

# DashScope imports
import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
from dashscope import Generation
import dashscope.audio.qwen_tts

# Configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('ccc_consolidated_server.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Environment variables (loaded from .env file)
DASHSCOPE_API_KEY = os.getenv('DASHSCOPE_API_KEY')
ALIYUN_ACCESS_KEY_ID = os.getenv('ALIYUN_ACCESS_KEY_ID')
ALIYUN_ACCESS_KEY_SECRET = os.getenv('ALIYUN_ACCESS_KEY_SECRET')
ALIYUN_CCC_INSTANCE_ID = os.getenv('ALIYUN_CCC_INSTANCE_ID')
ALIYUN_REGION = os.getenv('ALIYUN_REGION', 'cn-shanghai')

# Validate configuration
if not DASHSCOPE_API_KEY:
    logger.error('❌ DASHSCOPE_API_KEY not found in environment variables')
    raise ValueError('Please set DASHSCOPE_API_KEY in .env file')

if not ALIYUN_ACCESS_KEY_ID or not ALIYUN_ACCESS_KEY_SECRET:
    logger.error('❌ Aliyun access keys not found in environment variables')
    raise ValueError('Please set ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET in .env file')

# Configure DashScope API
dashscope.api_key = DASHSCOPE_API_KEY
logger.info("✅ DashScope API configured for CCC telephony integration")
logger.info(f"✅ Environment loaded: DashScope key configured, Aliyun region: {ALIYUN_REGION}")

# Global persistent connections and state
asr_session = None
llm_client = None
tts_client = None
conversation_sessions = {}  # In-memory session storage (no concurrency)

# Voice settings for professional collection agent
voice_settings = {
    'speed': 1.0,
    'pitch': 1.0, 
    'volume': 0.8,
    'voice': 'Cherry',
    'tone': 'professional',
    'emotion': 'professional'
}

class TelephonyASRProcessor:
    """Telephony ASR Processor - Adapted from FirefoxStreamingASRSession"""
    
    def __init__(self, call_id: str):
        self.call_id = call_id
        self.recognition = None
        self.is_active = False
        self.start_time = None
        
        # Sentence completion detection
        self.last_partial_text = ""
        self.last_update_time = 0
        self.sentence_timeout = 2000  # 2s timeout for sentence completion
        self.pending_final_check = None
        
        # Connection management
        self.consecutive_failures = 0
        self.max_consecutive_failures = 3
        self.last_restart_time = 0
        self.restart_cooldown = 5.0
        
        # ASR latency measurement
        self.sentence_end_time = None
        self.last_audio_time = None
        
    def start_telephony_asr(self):
        """Start telephony ASR with 8kHz PCM support"""
        try:
            logger.info(f'📞 Starting telephony ASR session: {self.call_id}')
            
            # Create callback instance
            callback = TelephonyASRCallback(self)
            
            # Create Recognition instance for telephony (8kHz PCM)
            self.recognition = Recognition(
                model="paraformer-realtime-v2",  # Supports any sampling rate
                format="wav",  # PCM WAV format from G.711 conversion
                sample_rate=8000,  # CCC telephony standard 8kHz
                callback=callback,
                # Telephony optimization parameters
                semantic_punctuation_enabled=True,
                max_sentence_silence=1500,  # 1.5s for phone conversations
                heartbeat=True,
                multi_threshold_mode_enabled=True
            )
            
            # Start recognition
            self.recognition.start()
            self.is_active = True
            self.start_time = time.time()
            
            logger.info(f'✅ Telephony ASR started: {self.call_id} (8kHz PCM)')
            return True
            
        except Exception as e:
            logger.error(f'❌ Telephony ASR startup failed: {e}')
            self.is_active = False
            self.recognition = None
            return False
    
    def send_audio_data(self, g711_audio_data: bytes) -> bool:
        """Send G.711 audio data to ASR (convert to PCM first)"""
        try:
            # Convert G.711 to PCM WAV (8kHz)
            pcm_data = g711_to_wav_8khz(g711_audio_data)
            
            if not self.recognition or not self.is_active:
                if not self.restart_telephony_asr():
                    return False
                    
            # Record audio receive time for latency calculation
            self.last_audio_time = time.time()
            
            # Send PCM data to DashScope ASR
            self.recognition.send_audio_frame(pcm_data)
            
            logger.debug(f'📤 Telephony audio processed: {len(g711_audio_data)} G.711 → {len(pcm_data)} PCM')
            return True
            
        except Exception as e:
            logger.error(f'❌ Telephony audio processing failed: {e}')
            self.consecutive_failures += 1
            self.last_restart_time = time.time()
            
            if self.recognition:
                try:
                    self.recognition.stop()
                except:
                    pass
                self.recognition = None
                self.is_active = False
            return False
    
    def restart_telephony_asr(self):
        """Restart telephony ASR with backoff"""
        try:
            current_time = time.time()
            if current_time - self.last_restart_time < self.restart_cooldown:
                logger.warning(f'ASR restart cooldown: {self.restart_cooldown - (current_time - self.last_restart_time):.1f}s remaining')
                return False
                
            if self.consecutive_failures >= self.max_consecutive_failures:
                logger.error(f'Max ASR failures reached: {self.max_consecutive_failures}')
                return False
            
            # Clean up existing connection
            if self.recognition:
                try:
                    self.recognition.stop()
                except:
                    pass
                self.recognition = None
                self.is_active = False
            
            time.sleep(2.0)  # Allow DashScope cleanup
            logger.info(f'🔄 Restarting telephony ASR: {self.call_id}')
            
            return self.start_telephony_asr()
            
        except Exception as e:
            logger.error(f'❌ Telephony ASR restart failed: {e}')
            return False
    
    def stop_telephony_asr(self):
        """Stop telephony ASR"""
        try:
            if self.recognition and self.is_active:
                self.recognition.stop()
                self.is_active = False
                logger.info(f'🛑 Telephony ASR stopped: {self.call_id}')
        except Exception as e:
            logger.error(f'❌ Stop ASR failed: {e}')

class TelephonyASRCallback(RecognitionCallback):
    """Telephony ASR Callback - Adapted from FirefoxASRCallback"""
    
    def __init__(self, asr_processor):
        self.asr_processor = asr_processor
        self.recognition_start_time = None
        
    def on_open(self):
        self.recognition_start_time = time.time()
        logger.info(f"✅ Telephony ASR connection established: {self.asr_processor.call_id}")
        
    def on_event(self, result):
        if isinstance(result, RecognitionResult):
            sentence = result.get_sentence()
            
            if sentence:
                text = sentence.get('text', '')
                confidence = sentence.get('confidence', 0.8)  # Default confidence
                is_sentence_end = sentence.get('sentence_end', False) or sentence.get('is_final', False)
                
                # Calculate ASR latency
                current_time = time.time()
                asr_latency = 200  # Default latency
                if is_sentence_end and self.asr_processor.last_audio_time:
                    asr_latency = (current_time - self.asr_processor.last_audio_time) * 1000
                    asr_latency = max(50, min(asr_latency, 3000))  # 50ms-3s range
                
                logger.info(f"📞 Telephony ASR result: '{text}' (confidence: {confidence:.2f}, latency: {asr_latency:.1f}ms, final: {is_sentence_end})")
                
                # Process complete sentences for LLM
                if text.strip() and confidence > 0.3 and is_sentence_end:
                    logger.info(f'🎯 Complete sentence recognized: {text}')
                    # Trigger LLM processing through conversation handler
                    handle_customer_speech(self.asr_processor.call_id, text)
                    
    def on_error(self, error):
        logger.error(f"❌ Telephony ASR error: {error}")
        
    def on_close(self):
        logger.info(f"🔒 Telephony ASR connection closed: {self.asr_processor.call_id}")

def g711_to_wav_8khz(g711_data: bytes) -> bytes:
    """Convert G.711 (A-law/μ-law) to 8kHz PCM WAV for DashScope ASR"""
    try:
        # Detect G.711 format (A-law vs μ-law)
        # For CCC, typically A-law for international, μ-law for North America
        # We'll try A-law first, then μ-law as fallback
        
        try:
            # Try A-law decoding first (international standard)
            pcm_16bit = audioop.alaw2lin(g711_data, 2)  # 2 bytes = 16-bit samples
            conversion_type = "A-law"
        except audioop.error:
            try:
                # Fallback to μ-law decoding (North America standard)
                pcm_16bit = audioop.ulaw2lin(g711_data, 2)  # 2 bytes = 16-bit samples
                conversion_type = "μ-law"
            except audioop.error:
                logger.error('❌ G.711 data is neither valid A-law nor μ-law')
                return b''
        
        # Create WAV header for 8kHz, 16-bit, mono PCM
        wav_header = create_wav_header(len(pcm_16bit), sample_rate=8000, channels=1, bits_per_sample=16)
        wav_data = wav_header + pcm_16bit
        
        logger.debug(f'🔄 G.711 conversion: {len(g711_data)} bytes {conversion_type} → {len(pcm_16bit)} bytes PCM → {len(wav_data)} bytes WAV (8kHz, 16-bit, mono)')
        return wav_data
        
    except Exception as e:
        logger.error(f'❌ G.711 to WAV conversion failed: {e}')
        return b''

def pcm_24khz_to_g711_8khz(pcm_data: bytes) -> bytes:
    """Downsample 24kHz PCM to 8kHz G.711 for CCC telephony output"""
    try:
        # Step 1: Resample 24kHz → 8kHz (3:1 ratio)
        # audioop.ratecv(fragment, width, nchannels, inrate, outrate, state, weightA, weightB)
        downsampled_pcm, _ = audioop.ratecv(
            pcm_data,      # Input PCM data
            2,             # Sample width (16-bit = 2 bytes)
            1,             # Mono (1 channel)
            24000,         # Input sample rate
            8000,          # Output sample rate (CCC telephony standard)
            None           # State (None for first call)
        )
        
        # Step 2: Convert 16-bit PCM to G.711 A-law (international standard)
        g711_alaw = audioop.lin2alaw(downsampled_pcm, 2)  # 2 = 16-bit input
        
        logger.debug(f'🔄 PCM to G.711 conversion: {len(pcm_data)} bytes 24kHz PCM → {len(downsampled_pcm)} bytes 8kHz PCM → {len(g711_alaw)} bytes A-law')
        return g711_alaw
        
    except Exception as e:
        logger.error(f'❌ PCM to G.711 conversion failed: {e}')
        return b''

def create_wav_header(data_length: int, sample_rate: int = 8000, channels: int = 1, bits_per_sample: int = 16) -> bytes:
    """Create WAV file header for PCM data"""
    byte_rate = sample_rate * channels * bits_per_sample // 8
    block_align = channels * bits_per_sample // 8
    
    header = b'RIFF'                                    # Chunk ID
    header += (36 + data_length).to_bytes(4, 'little') # Chunk size
    header += b'WAVE'                                   # Format
    header += b'fmt '                                   # Subchunk1 ID
    header += (16).to_bytes(4, 'little')               # Subchunk1 size
    header += (1).to_bytes(2, 'little')                # Audio format (PCM)
    header += channels.to_bytes(2, 'little')           # Channels
    header += sample_rate.to_bytes(4, 'little')        # Sample rate
    header += byte_rate.to_bytes(4, 'little')          # Byte rate
    header += block_align.to_bytes(2, 'little')        # Block align
    header += bits_per_sample.to_bytes(2, 'little')    # Bits per sample
    header += b'data'                                   # Subchunk2 ID
    header += data_length.to_bytes(4, 'little')        # Subchunk2 size
    
    return header

def initialize_persistent_connections():
    """Initialize and maintain persistent DashScope connections"""
    global asr_session, llm_client, tts_client
    
    try:
        logger.info('🔥 Initializing persistent DashScope connections...')
        
        # Pre-configure LLM client
        llm_client = Generation
        logger.info('✅ LLM client ready')
        
        # Pre-configure TTS client  
        tts_client = dashscope.audio.qwen_tts.SpeechSynthesizer
        logger.info('✅ TTS client ready')
        
        logger.info('🚀 All persistent connections initialized')
        return True
        
    except Exception as e:
        logger.error(f'❌ Persistent connection initialization failed: {e}')
        return False

def build_collection_prompt(customer_context: Dict, conversation_history: list) -> str:
    """Build professional collection agent prompt - Telephony version"""
    
    def format_chinese_amount(amount: int) -> str:
        """Format amount in Chinese: 15000 → 一万五千元"""
        if amount >= 10000:
            wan = amount // 10000
            remainder = amount % 10000
            if remainder == 0:
                return f"{wan}万元"
            else:
                return f"{wan}万{remainder}元"
        return f"{amount}元"
    
    # Build conversation history
    conversation_text = ""
    if conversation_history:
        conversation_text = "\n本次通话记录:\n"
        for i, entry in enumerate(conversation_history):
            role = "客户" if entry.get('sender') == 'customer' else "催收员"
            conversation_text += f"{i+1}. {role}: {entry.get('text', '')}\n"
    else:
        conversation_text = "\n本次通话记录:\n(开始新对话)\n"
    
    system_prompt = f"""你是平安银行信用卡中心的专业催收专员，正在进行电话催收工作。

客户档案信息:
- 客户姓名: {customer_context.get('name', '客户')}
- 逾期本金: {format_chinese_amount(customer_context.get('balance', 15000))}
- 逾期天数: {customer_context.get('daysOverdue', 30)}天
- 联系历史: {customer_context.get('previousContacts', 2)}次
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

语言要求:
- 使用大陆标准普通话，避免台湾用语
- 金额表达: 15000元说成"一万五千元"，不是"十五千元"
- 语气要专业、理解，体现人文关怀

请以专业催收员的身份，针对客户的话语给出合适的回应，推进催收对话。"""

    return system_prompt

def process_telephony_llm_and_tts(call_id: str, user_text: str):
    """Process customer speech through LLM and generate TTS response"""
    try:
        logger.info(f'💬 Processing customer speech: "{user_text}" (call: {call_id})')
        llm_start = time.time()
        
        # Get session context
        session = conversation_sessions.get(call_id, {})
        customer_context = session.get('customer_context', {
            'name': '客户',
            'balance': 15000,
            'daysOverdue': 30,
            'previousContacts': 2,
            'riskLevel': '中等'
        })
        
        conversation_history = session.get('history', [])
        
        # Build collection prompt
        system_prompt = build_collection_prompt(customer_context, conversation_history)
        
        logger.info('🧠 Calling Qwen LLM...')
        response = llm_client.call(
            model='qwen-turbo-latest',
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
            logger.info(f"💬 LLM response: '{ai_response}' (latency: {llm_latency:.1f}ms)")
            
            # Update conversation history
            session['history'].extend([
                {'sender': 'customer', 'text': user_text, 'timestamp': time.time()},
                {'sender': 'agent', 'text': ai_response, 'timestamp': time.time()}
            ])
            conversation_sessions[call_id] = session
            
            # Generate TTS audio
            generate_telephony_tts(call_id, ai_response)
            
        else:
            logger.error(f"❌ LLM call failed: status={response.status_code}")
            
    except Exception as e:
        logger.error(f"❌ LLM processing failed: {e}")
        import traceback
        traceback.print_exc()

def generate_telephony_tts(call_id: str, text: str):
    """Generate streaming TTS audio for telephony output"""
    try:
        logger.info(f'🎵 Generating telephony TTS: "{text}" (call: {call_id})')
        tts_start = time.time()
        
        # TTS parameters for telephony
        tts_params = {
            "model": "qwen-tts-latest",
            "text": text,
            "voice": voice_settings.get('voice', 'Cherry'),
            "stream": True,
            "format": "pcm",
            "sample_rate": 24000  # Will be downsampled to 8kHz for CCC
        }
        
        # Apply voice control parameters
        for param in ['speed', 'pitch', 'volume', 'tone', 'emotion']:
            if param in voice_settings and voice_settings[param] != 'neutral':
                tts_params[param] = voice_settings[param]
        
        logger.info(f'🎵 TTS parameters: {tts_params}')
        
        # Generate streaming TTS
        responses = tts_client.call(**tts_params)
        
        if responses is None:
            raise ValueError("TTS API returned None response")
        
        # Process streaming PCM chunks
        chunk_count = 0
        first_chunk_latency = None
        
        for response in responses:
            if response and "output" in response and "audio" in response["output"] and "data" in response["output"]["audio"]:
                audio_string = response["output"]["audio"]["data"]
                pcm_bytes = base64.b64decode(audio_string)
                
                if pcm_bytes:
                    if first_chunk_latency is None:
                        first_chunk_latency = (time.time() - tts_start) * 1000
                        logger.info(f'🎵 First PCM chunk latency: {first_chunk_latency:.1f}ms')
                    
                    # Convert 24kHz PCM to 8kHz G.711 for CCC output
                    g711_audio = pcm_24khz_to_g711_8khz(pcm_bytes)
                    
                    # Send to CCC (placeholder - need actual CCC audio output)
                    send_audio_to_ccc(call_id, g711_audio)
                    
                    chunk_count += 1
                    logger.debug(f'📤 Telephony TTS chunk {chunk_count}: {len(pcm_bytes)} PCM → {len(g711_audio)} G.711')
            elif response.status_code != 200:
                logger.error(f"❌ TTS streaming error: {response.status_code}")
                break
        
        total_time = (time.time() - tts_start) * 1000
        effective_latency = first_chunk_latency if first_chunk_latency else 2000
        
        logger.info(f'✅ Telephony TTS completed: {chunk_count} chunks, first chunk: {effective_latency:.1f}ms, total: {total_time:.1f}ms')
        
    except Exception as e:
        logger.error(f'❌ Telephony TTS generation failed: {e}')
        import traceback
        traceback.print_exc()

def send_audio_to_ccc(call_id: str, g711_audio: bytes):
    """Send G.711 audio to CCC for customer playback"""
    try:
        # TODO: Implement actual CCC audio output
        # This would use CCC SDK to send audio back to the customer
        logger.debug(f'📞 Sending {len(g711_audio)} bytes G.711 audio to CCC call: {call_id}')
        
        # Placeholder for CCC audio output API call
        # Real implementation would use CCC client to send audio to call
        
    except Exception as e:
        logger.error(f'❌ CCC audio output failed: {e}')

def handle_inbound_call(call_event: Dict) -> Dict:
    """Handle CCC inbound call event - Main entry point"""
    try:
        call_id = call_event.get('call_id')
        customer_phone = call_event.get('customer_phone', 'unknown')
        
        logger.info(f'📞 Handling inbound call: {call_id} from {customer_phone}')
        
        # Initialize session in memory
        conversation_sessions[call_id] = {
            'history': [],
            'customer_context': {
                'name': '客户',  # Could extract from CRM based on phone number
                'balance': 15000,
                'daysOverdue': 30,
                'previousContacts': 2,
                'riskLevel': '中等'
            },
            'start_time': time.time(),
            'asr_processor': None
        }
        
        # Initialize ASR processor for this call
        asr_processor = TelephonyASRProcessor(call_id)
        if asr_processor.start_telephony_asr():
            conversation_sessions[call_id]['asr_processor'] = asr_processor
            logger.info(f'✅ ASR processor started for call: {call_id}')
        else:
            logger.error(f'❌ Failed to start ASR for call: {call_id}')
            return {'status': 'error', 'message': 'ASR initialization failed'}
        
        # Play greeting immediately upon connection
        play_inbound_greeting(call_id)
        
        return {
            'status': 'success', 
            'message': f'Inbound call {call_id} handled successfully',
            'call_id': call_id
        }
        
    except Exception as e:
        logger.error(f'❌ Inbound call handling failed: {e}')
        return {'status': 'error', 'message': str(e)}

def play_inbound_greeting(call_id: str):
    """Play greeting upon inbound call connection - Adapted from continueGreetingSequence"""
    try:
        session = conversation_sessions.get(call_id, {})
        customer_context = session.get('customer_context', {})
        
        # Construct complete greeting message
        customer_name = customer_context.get('name', '客户')
        balance = customer_context.get('balance', 15000)
        days_overdue = customer_context.get('daysOverdue', 30)
        
        def format_chinese_amount(amount: int) -> str:
            if amount >= 10000:
                wan = amount // 10000
                remainder = amount % 10000
                if remainder == 0:
                    return f"{wan}万元"
                else:
                    return f"{wan}万{remainder}元"
            return f"{amount}元"
        
        full_greeting = ''.join([
            f"{customer_name}您好，我是平安银行催收专员，工号888888。",
            f"根据我行记录，您有一笔{format_chinese_amount(balance)}的逾期本金，逾期了{days_overdue}天，已上报征信系统。",
            f"请问您现在方便谈论还款安排吗？"
        ])
        
        logger.info(f'🎯 Playing inbound greeting: "{full_greeting}"')
        
        # Update conversation history
        session['history'].append({
            'sender': 'agent',
            'text': full_greeting,
            'timestamp': time.time()
        })
        conversation_sessions[call_id] = session
        
        # Generate and play greeting TTS
        generate_telephony_tts(call_id, full_greeting)
        
    except Exception as e:
        logger.error(f'❌ Inbound greeting failed: {e}')

def handle_customer_speech(call_id: str, speech_text: str):
    """Handle recognized customer speech - Adapted from sendRecognizedTextToAI"""
    try:
        logger.info(f'🗣️ Customer speech recognized: "{speech_text}" (call: {call_id})')
        
        if not speech_text.strip():
            logger.info('Empty speech text, skipping processing')
            return
        
        # Mark customer response in session
        session = conversation_sessions.get(call_id, {})
        session['customer_responded'] = True
        conversation_sessions[call_id] = session
        
        # Process through LLM and generate response
        process_telephony_llm_and_tts(call_id, speech_text)
        
    except Exception as e:
        logger.error(f'❌ Customer speech handling failed: {e}')

def handle_call_end(call_id: str):
    """Clean up call session when call ends"""
    try:
        logger.info(f'📞 Ending call: {call_id}')
        
        # Stop ASR processor
        session = conversation_sessions.get(call_id, {})
        asr_processor = session.get('asr_processor')
        if asr_processor:
            asr_processor.stop_telephony_asr()
        
        # Clean up session (but keep for debugging if needed)
        if call_id in conversation_sessions:
            logger.info(f'🗂️ Call session ended: {len(session.get("history", []))} conversation turns')
            # Keep session for now - in production might save to external storage
            # del conversation_sessions[call_id]
        
    except Exception as e:
        logger.error(f'❌ Call cleanup failed: {e}')

# Function Compute entry point
def handler(event, context):
    """Function Compute main handler - Entry point for CCC events"""
    try:
        logger.info(f'📡 Function Compute handler called: {event}')
        logger.debug(f'📡 Function Compute context: {context}')  # Log context for debugging
        
        # Initialize persistent connections if not already done
        if not asr_session and not llm_client:
            initialize_persistent_connections()
        
        # Parse CCC event
        event_type = event.get('event_type')
        call_data = event.get('call_data', {})
        
        if event_type == 'inbound_call':
            return handle_inbound_call(call_data)
        elif event_type == 'audio_data':
            # Handle incoming audio from customer
            call_id = call_data.get('call_id')
            audio_data = call_data.get('audio_data')  # G.711 encoded
            
            session = conversation_sessions.get(call_id, {})
            asr_processor = session.get('asr_processor')
            if asr_processor:
                asr_processor.send_audio_data(base64.b64decode(audio_data))
            
            return {'status': 'success', 'message': 'Audio processed'}
        elif event_type == 'call_end':
            call_id = call_data.get('call_id')
            handle_call_end(call_id)
            return {'status': 'success', 'message': 'Call ended'}
        else:
            logger.warning(f'Unknown event type: {event_type}')
            return {'status': 'error', 'message': f'Unknown event type: {event_type}'}
        
    except Exception as e:
        logger.error(f'❌ Function Compute handler failed: {e}')
        import traceback
        traceback.print_exc()
        return {'status': 'error', 'message': str(e)}

# Development/testing entry point
if __name__ == '__main__':
    logger.info("🚀 CCC Consolidated Server - Development Mode")
    logger.info("🎯 Features: Inbound calls, G.711↔PCM conversion, Persistent connections")
    logger.info("📞 Architecture: No concurrency, In-memory sessions, Auto-greeting")
    
    # Initialize persistent connections
    initialize_persistent_connections()
    
    # Test with sample call event
    test_event = {
        'event_type': 'inbound_call',
        'call_data': {
            'call_id': 'test_call_001',
            'customer_phone': '+86138xxxxxxxx'
        }
    }
    
    test_context = {}  # Mock context for local testing
    
    logger.info('🧪 Testing with sample inbound call...')
    result = handler(test_event, test_context)
    logger.info(f'✅ Test result: {result}')