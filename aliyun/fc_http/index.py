#!/usr/bin/env python3
"""
Aliyun CCC HTTP Streaming Server - Real-time Bidirectional Audio
Implements CCC → FC → CCC streaming audio processing for AI collection agent

Key Features:
- HTTP streaming with Transfer-Encoding: chunked
- Real-time PCM audio processing (8kHz, 16-bit, mono)
- Bidirectional audio flow: CCC streams in, FC streams back
- Persistent DashScope connections for minimal latency
- Professional debt collection conversation flow

Architecture:
Customer Call → CCC → HTTP Stream → FC Function → AI Processing → Audio Stream → CCC
"""

import os
import json
import time
import logging
import base64
import tempfile
import audioop
import asyncio
from typing import Dict, Optional, Any, Generator
from pathlib import Path
import io

# DashScope imports
import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
from dashscope.audio.tts import SpeechSynthesizer
from dashscope import Generation

# Environment setup
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# DashScope configuration
DASHSCOPE_API_KEY = os.getenv('DASHSCOPE_API_KEY')
if DASHSCOPE_API_KEY:
    dashscope.api_key = DASHSCOPE_API_KEY
else:
    logger.warning("⚠️ DASHSCOPE_API_KEY not set")

# Global state for persistent connections
asr_session = None
llm_client = None
tts_client = None

# Professional collection prompt template
COLLECTION_PROMPT_TEMPLATE = """你是一名专业的银行催收专员，正在与客户进行债务催收对话。请保持礼貌但坚定的态度。

客户信息：
- 姓名：{customer_name}
- 逾期金额：{overdue_amount}
- 逾期天数：{overdue_days}
- 联系历史：{contact_history}

对话历史：
{conversation_history}

请根据以上信息，以专业的催收话术回复客户。使用适当的银行术语，如"逾期本金"、"还款义务"、"征信记录"等。
回复要求：
1. 语气礼貌但坚定
2. 提供具体的还款方案
3. 强调逾期对征信的影响
4. 保持专业的银行服务标准
5. 回复控制在50字以内，便于语音播报

客户最新发言：{customer_input}

你的回复："""

def format_chinese_amount(amount_str: str) -> str:
    """Convert numeric amount to Chinese format for TTS"""
    try:
        amount = float(amount_str.replace('元', '').replace(',', ''))
        if amount >= 10000:
            return f"{amount/10000:.1f}万元".replace('.0', '')
        else:
            return f"{amount:.0f}元"
    except:
        return amount_str

def g711_to_pcm_8khz(g711_data: bytes) -> bytes:
    """Convert G.711 A-law to 8kHz 16-bit PCM for DashScope ASR"""
    try:
        # G.711 A-law to linear PCM conversion
        pcm_data = audioop.alaw2lin(g711_data, 2)
        return pcm_data
    except Exception as e:
        logger.error(f"❌ G.711 to PCM conversion failed: {e}")
        return b''

def pcm_24khz_to_g711_8khz(pcm_data: bytes) -> bytes:
    """Convert 24kHz PCM from TTS to 8kHz G.711 A-law for telephony"""
    try:
        # Downsample 24kHz to 8kHz (1:3 ratio)
        downsampled = audioop.ratecv(pcm_data, 2, 1, 24000, 8000, None)[0]
        # Convert to G.711 A-law
        g711_data = audioop.lin2alaw(downsampled, 2)
        return g711_data
    except Exception as e:
        logger.error(f"❌ PCM to G.711 conversion failed: {e}")
        return b''

def initialize_persistent_connections():
    """Initialize DashScope connections for reuse"""
    global asr_session, llm_client, tts_client
    
    try:
        # Initialize ASR
        asr_session = Recognition(
            model='paraformer-realtime-v2',
            format='pcm',
            sample_rate=8000,
            callback=None  # Will be set per request
        )
        logger.info("✅ ASR session initialized")
        
        # Initialize LLM client (Generation API)
        llm_client = Generation()
        logger.info("✅ LLM client initialized")
        
        # Initialize TTS client
        tts_client = SpeechSynthesizer()
        logger.info("✅ TTS client initialized")
        
        logger.info("🔗 All DashScope connections initialized successfully")
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize persistent connections: {e}")

def build_collection_prompt(customer_input: str, session_data: dict) -> str:
    """Build professional collection conversation prompt"""
    return COLLECTION_PROMPT_TEMPLATE.format(
        customer_name=session_data.get('customer_name', '客户'),
        overdue_amount=format_chinese_amount(session_data.get('overdue_amount', '15000元')),
        overdue_days=session_data.get('overdue_days', '30'),
        contact_history=session_data.get('contact_history', '首次联系'),
        conversation_history='\n'.join(session_data.get('conversation_history', [])),
        customer_input=customer_input
    )

def call_streaming_asr(audio_buffer: bytes) -> Optional[str]:
    """Process audio buffer with streaming ASR"""
    try:
        # Create temporary WAV file for ASR
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            # Write PCM as WAV format
            import wave
            with wave.open(temp_file.name, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(8000)  # 8kHz
                wav_file.writeframes(audio_buffer)
            
            # Process with DashScope ASR using direct API
            from http import HTTPStatus
            import dashscope
            
            result = dashscope.audio.asr.Recognition.call(
                model='paraformer-realtime-v2',
                format='wav',
                sample_rate=8000,
                file_urls=[f'file://{temp_file.name}']
            )
            
            # Clean up temp file
            os.unlink(temp_file.name)
            
            if result.status_code == HTTPStatus.OK:
                # Extract transcription from result
                if hasattr(result, 'output') and result.output:
                    sentences = result.output.get('sentences', [])
                    if sentences:
                        transcription = sentences[0].get('text', '')
                        logger.info(f"🎙️ ASR result: {transcription}")
                        return transcription
                logger.warning("⚠️ ASR returned empty result")
                return None
            else:
                logger.error(f"❌ ASR failed: {result}")
                return None
                
    except Exception as e:
        logger.error(f"❌ Streaming ASR failed: {e}")
        return None

def call_streaming_llm(prompt: str) -> Optional[str]:
    """Generate collection agent response using LLM"""
    global llm_client
    
    try:
        if not llm_client:
            initialize_persistent_connections()
        
        response = Generation.call(
            model='qwen-plus',
            prompt=prompt,
            max_tokens=100,
            temperature=0.7
        )
        
        if response.status_code == 200 and response.output:
            reply = response.output.text.strip()
            logger.info(f"🧠 LLM response: {reply}")
            return reply
        else:
            logger.error(f"❌ LLM failed: {response}")
            return "很抱歉，我需要您重复一下您的问题。"
            
    except Exception as e:
        logger.error(f"❌ LLM processing failed: {e}")
        return "系统暂时无法处理，请稍后再试。"

def call_streaming_tts(text: str) -> Generator[bytes, None, None]:
    """Generate streaming TTS audio chunks"""
    global tts_client
    
    try:
        if not tts_client:
            initialize_persistent_connections()
        
        # Generate TTS audio
        result = SpeechSynthesizer.call(
            model='cosyvoice-v1',
            text=text,
            sample_rate=24000,
            format='pcm'
        )
        
        if result.status_code == 200 and result.output:
            # Get PCM audio data
            pcm_24khz = result.output['audio_data']
            
            # Convert to G.711 8kHz for telephony
            g711_data = pcm_24khz_to_g711_8khz(pcm_24khz)
            
            # Stream in 320-byte chunks (20ms at 8kHz)
            chunk_size = 320
            for i in range(0, len(g711_data), chunk_size):
                chunk = g711_data[i:i + chunk_size]
                if chunk:
                    yield chunk
                    time.sleep(0.02)  # 20ms delay between chunks
        else:
            logger.error(f"❌ TTS failed: {result}")
            yield b''  # Empty chunk to end stream
            
    except Exception as e:
        logger.error(f"❌ Streaming TTS failed: {e}")
        yield b''

# Session management
conversation_sessions = {}

def get_or_create_session(call_id: str) -> dict:
    """Get or create conversation session"""
    if call_id not in conversation_sessions:
        conversation_sessions[call_id] = {
            'customer_name': '客户',
            'overdue_amount': '15000元',
            'overdue_days': '30',
            'contact_history': '首次联系',
            'conversation_history': [],
            'asr_buffer': b'',
            'last_activity': time.time()
        }
        logger.info(f"📞 Created new session for call {call_id}")
    
    return conversation_sessions[call_id]

def handler(environ, start_response):
    """HTTP streaming handler for CCC bidirectional audio"""
    try:
        logger.info("🎯 HTTP streaming handler started")
        
        # Initialize connections if needed
        if not asr_session or not llm_client or not tts_client:
            initialize_persistent_connections()
        
        # Set streaming response headers
        status = '200 OK'
        headers = [
            ('Content-Type', 'audio/pcm'),
            ('Transfer-Encoding', 'chunked'),
            ('Cache-Control', 'no-cache'),
            ('Connection', 'keep-alive')
        ]
        start_response(status, headers)
        
        # Get call ID from query parameters or generate one
        query_string = environ.get('QUERY_STRING', '')
        call_id = 'streaming_call_001'  # Default for POC
        if 'call_id=' in query_string:
            call_id = query_string.split('call_id=')[1].split('&')[0]
        
        logger.info(f"📞 Processing streaming call: {call_id}")
        
        # Get session
        session = get_or_create_session(call_id)
        
        # Read incoming audio stream from CCC
        input_stream = environ['wsgi.input']
        asr_buffer = session.get('asr_buffer', b'')
        
        # Process incoming audio chunks
        while True:
            try:
                # Read 320 bytes (20ms of 8kHz G.711)
                chunk = input_stream.read(320)
                if not chunk:
                    logger.info("📡 End of audio stream")
                    break
                
                logger.debug(f"📡 Received audio chunk: {len(chunk)} bytes")
                
                # Convert G.711 to PCM
                pcm_chunk = g711_to_pcm_8khz(chunk)
                asr_buffer += pcm_chunk
                
                # Process ASR every 400ms (6400 bytes of PCM)
                if len(asr_buffer) >= 6400:
                    logger.info("🎙️ Processing ASR buffer...")
                    
                    # Call streaming ASR
                    asr_result = call_streaming_asr(asr_buffer)
                    asr_buffer = b''  # Reset buffer
                    
                    if asr_result and len(asr_result.strip()) > 0:
                        logger.info(f"👤 Customer: {asr_result}")
                        
                        # Add to conversation history
                        session['conversation_history'].append(f"客户: {asr_result}")
                        
                        # Generate AI response
                        prompt = build_collection_prompt(asr_result, session)
                        ai_response = call_streaming_llm(prompt)
                        
                        if ai_response:
                            logger.info(f"🤖 Agent: {ai_response}")
                            session['conversation_history'].append(f"坐席: {ai_response}")
                            
                            # Stream TTS response back to CCC
                            logger.info("🎵 Starting TTS streaming...")
                            for tts_chunk in call_streaming_tts(ai_response):
                                if tts_chunk:
                                    yield tts_chunk
                                else:
                                    break
                            
                            logger.info("✅ TTS streaming completed")
                
                # Update session
                session['asr_buffer'] = asr_buffer
                session['last_activity'] = time.time()
                
            except Exception as chunk_error:
                logger.error(f"❌ Chunk processing error: {chunk_error}")
                break
        
        # Send final empty chunk to end stream
        yield b''
        logger.info("🏁 HTTP streaming handler completed")
        
    except Exception as e:
        logger.error(f"❌ HTTP streaming handler failed: {e}")
        import traceback
        traceback.print_exc()
        
        # Send error response
        yield b''  # End stream

# Development/testing entry point
if __name__ == '__main__':
    logger.info("🚀 CCC HTTP Streaming Server - Development Mode")
    logger.info("🎯 Features: HTTP streaming, Bidirectional audio, Real-time processing")
    logger.info("📡 Architecture: CCC → HTTP Stream → FC → AI → Audio Stream → CCC")
    
    # Initialize persistent connections
    initialize_persistent_connections()
    
    logger.info("✅ Ready for HTTP streaming requests")