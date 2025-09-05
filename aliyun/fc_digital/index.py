#!/usr/bin/env python3
"""
Aliyun CCC Digital Employee Proxy - Third-party LLM Integration
Implements 4-API proxy pattern for CCC digital employee integration

Required APIs:
- POST /proxy/beginSession - Initialize conversation session
- POST /proxy/dialogue - Process customer input and return AI response  
- POST /proxy/abortDialogue - Abort current dialogue
- POST /proxy/endSession - End conversation session

Performance Requirements:
- beginSession: <200ms response time
- dialogue: <600ms first response time
- TTS-compatible response format
- Proper session management

Architecture:
CCC Digital Employee → FC Proxy → DashScope AI → Professional Collection Response
"""

import os
import json
import time
import logging
import uuid
from typing import Dict, Optional, Any
from datetime import datetime

# DashScope imports
import dashscope
from dashscope import Generation
from dashscope.audio.tts import SpeechSynthesizer

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

# Global session storage (in-memory for POC)
active_sessions = {}

# Professional collection context template
COLLECTION_CONTEXT = {
    'agent_role': '专业银行催收专员',
    'conversation_style': '礼貌但坚定',
    'key_terms': ['逾期本金', '还款义务', '征信记录', '内部协商', '分期还款'],
    'response_limit': '控制在30字以内，适合TTS播报',
    'customer_profile': {
        'name': '张先生',
        'overdue_amount': '15000元',
        'overdue_days': '30天',
        'contact_history': '首次联系'
    }
}

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

def build_collection_prompt(customer_input: str, session_data: dict) -> str:
    """Build professional collection conversation prompt"""
    context = session_data.get('context', COLLECTION_CONTEXT)
    profile = context['customer_profile']
    
    prompt = f"""你是一名{context['agent_role']}，正在与客户进行专业的债务催收对话。

客户信息：
- 姓名：{profile['name']}
- 逾期金额：{format_chinese_amount(profile['overdue_amount'])}
- 逾期天数：{profile['overdue_days']}
- 联系历史：{profile['contact_history']}

对话历史：
{chr(10).join(session_data.get('dialogue_history', []))}

对话要求：
1. 语气{context['conversation_style']}
2. 使用专业术语：{', '.join(context['key_terms'])}
3. 提供具体还款方案
4. 强调征信影响
5. {context['response_limit']}

客户说："{customer_input}"

请回复："""
    
    return prompt

def generate_ai_response(customer_input: str, session_data: dict) -> dict:
    """Generate AI collection agent response"""
    try:
        # Build prompt
        prompt = build_collection_prompt(customer_input, session_data)
        
        # Call DashScope LLM
        start_time = time.time()
        response = Generation.call(
            model='qwen-plus',
            prompt=prompt,
            max_tokens=80,
            temperature=0.7
        )
        
        processing_time = time.time() - start_time
        
        if response.status_code == 200 and response.output:
            ai_text = response.output.text.strip()
            
            # Update dialogue history
            session_data['dialogue_history'].append(f"客户: {customer_input}")
            session_data['dialogue_history'].append(f"坐席: {ai_text}")
            
            logger.info(f"🤖 AI Response ({processing_time:.2f}s): {ai_text}")
            
            return {
                'success': True,
                'response_text': ai_text,
                'processing_time': processing_time,
                'session_updated': True
            }
        else:
            logger.error(f"❌ LLM failed: {response}")
            return {
                'success': False,
                'response_text': "很抱歉，请您重复一下问题。",
                'processing_time': processing_time,
                'error': str(response)
            }
            
    except Exception as e:
        logger.error(f"❌ AI response generation failed: {e}")
        return {
            'success': False,
            'response_text': "系统暂时无法处理，请稍后再试。",
            'processing_time': 0.0,
            'error': str(e)
        }

def proxy_begin_session(request_data: dict) -> dict:
    """
    /proxy/beginSession - Initialize conversation session
    Performance requirement: <200ms
    """
    start_time = time.time()
    
    try:
        # Generate unique session ID
        session_id = str(uuid.uuid4())
        
        # Extract customer information from request
        customer_info = request_data.get('customer', {})
        call_info = request_data.get('call', {})
        
        # Initialize session data
        session_data = {
            'session_id': session_id,
            'created_at': datetime.now().isoformat(),
            'customer_info': customer_info,
            'call_info': call_info,
            'dialogue_history': [],
            'context': COLLECTION_CONTEXT.copy()
        }
        
        # Update customer profile if provided
        if customer_info:
            profile = session_data['context']['customer_profile']
            profile['name'] = customer_info.get('name', profile['name'])
            if 'overdue_amount' in customer_info:
                profile['overdue_amount'] = customer_info['overdue_amount']
            if 'overdue_days' in customer_info:
                profile['overdue_days'] = str(customer_info['overdue_days']) + '天'
        
        # Store session
        active_sessions[session_id] = session_data
        
        processing_time = time.time() - start_time
        
        logger.info(f"🆕 Session started: {session_id} ({processing_time:.3f}s)")
        
        # Initial greeting
        greeting = f"您好{session_data['context']['customer_profile']['name']}，我是银行催收专员。关于您{session_data['context']['customer_profile']['overdue_amount']}的逾期款项，我们需要协商还款事宜。"
        
        return {
            'code': 200,
            'success': True,
            'data': {
                'sessionId': session_id,
                'greeting': greeting,
                'processing_time': processing_time
            }
        }
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"❌ Begin session failed ({processing_time:.3f}s): {e}")
        
        return {
            'code': 500,
            'success': False,
            'message': str(e),
            'data': {
                'processing_time': processing_time
            }
        }

def proxy_dialogue(request_data: dict) -> dict:
    """
    /proxy/dialogue - Process customer input and return AI response
    Performance requirement: <600ms first response
    """
    start_time = time.time()
    
    try:
        session_id = request_data.get('sessionId')
        customer_input = request_data.get('text', '').strip()
        
        if not session_id or session_id not in active_sessions:
            return {
                'code': 404,
                'success': False,
                'message': 'Session not found',
                'data': {}
            }
        
        if not customer_input:
            return {
                'code': 400,
                'success': False,
                'message': 'Empty customer input',
                'data': {}
            }
        
        # Get session data
        session_data = active_sessions[session_id]
        
        # Generate AI response
        ai_result = generate_ai_response(customer_input, session_data)
        
        processing_time = time.time() - start_time
        
        if ai_result['success']:
            logger.info(f"💬 Dialogue processed: {session_id} ({processing_time:.3f}s)")
            
            response_data = {
                'sessionId': session_id,
                'response': ai_result['response_text'],
                'processing_time': processing_time,
                'llm_time': ai_result['processing_time']
            }
            
            # Add TTS hint for better pronunciation
            if '万' in ai_result['response_text']:
                response_data['tts_hint'] = 'currency_amount'
            
            return {
                'code': 200,
                'success': True,
                'data': response_data
            }
        else:
            logger.warning(f"⚠️ Dialogue failed: {session_id} ({processing_time:.3f}s)")
            
            return {
                'code': 500,
                'success': False,
                'message': ai_result.get('error', 'AI processing failed'),
                'data': {
                    'sessionId': session_id,
                    'response': ai_result['response_text'],
                    'processing_time': processing_time
                }
            }
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"❌ Dialogue processing failed ({processing_time:.3f}s): {e}")
        
        return {
            'code': 500,
            'success': False,
            'message': str(e),
            'data': {
                'processing_time': processing_time
            }
        }

def proxy_abort_dialogue(request_data: dict) -> dict:
    """
    /proxy/abortDialogue - Abort current dialogue
    """
    start_time = time.time()
    
    try:
        session_id = request_data.get('sessionId')
        
        if session_id and session_id in active_sessions:
            session_data = active_sessions[session_id]
            session_data['status'] = 'aborted'
            session_data['aborted_at'] = datetime.now().isoformat()
        
        processing_time = time.time() - start_time
        
        logger.info(f"🚫 Dialogue aborted: {session_id} ({processing_time:.3f}s)")
        
        return {
            'code': 200,
            'success': True,
            'data': {
                'sessionId': session_id,
                'status': 'aborted',
                'processing_time': processing_time
            }
        }
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"❌ Abort dialogue failed ({processing_time:.3f}s): {e}")
        
        return {
            'code': 500,
            'success': False,
            'message': str(e),
            'data': {
                'processing_time': processing_time
            }
        }

def proxy_end_session(request_data: dict) -> dict:
    """
    /proxy/endSession - End conversation session
    """
    start_time = time.time()
    
    try:
        session_id = request_data.get('sessionId')
        
        if session_id and session_id in active_sessions:
            session_data = active_sessions[session_id]
            session_data['status'] = 'ended'
            session_data['ended_at'] = datetime.now().isoformat()
            
            # Log conversation summary
            dialogue_count = len(session_data.get('dialogue_history', []))
            duration = time.time() - time.mktime(datetime.fromisoformat(session_data['created_at']).timetuple())
            
            logger.info(f"📊 Session summary: {session_id}")
            logger.info(f"   Duration: {duration:.1f}s")
            logger.info(f"   Dialogue exchanges: {dialogue_count//2}")
            
            # Keep session for analytics (in production, move to persistent storage)
            # del active_sessions[session_id]
        
        processing_time = time.time() - start_time
        
        logger.info(f"🏁 Session ended: {session_id} ({processing_time:.3f}s)")
        
        return {
            'code': 200,
            'success': True,
            'data': {
                'sessionId': session_id,
                'status': 'ended',
                'processing_time': processing_time
            }
        }
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"❌ End session failed ({processing_time:.3f}s): {e}")
        
        return {
            'code': 500,
            'success': False,
            'message': str(e),
            'data': {
                'processing_time': processing_time
            }
        }

def handler(environ, start_response):
    """
    Web Function handler for CCC Digital Employee Proxy
    Routes API calls to appropriate handlers
    """
    try:
        # Parse request
        method = environ.get('REQUEST_METHOD', 'GET')
        path = environ.get('PATH_INFO', '/')
        
        logger.info(f"🎯 {method} {path}")
        
        if method != 'POST':
            response_data = {
                'code': 405,
                'success': False,
                'message': 'Only POST method supported'
            }
            response_json = json.dumps(response_data, ensure_ascii=False)
            
            start_response('405 Method Not Allowed', [
                ('Content-Type', 'application/json; charset=utf-8'),
                ('Content-Length', str(len(response_json.encode('utf-8'))))
            ])
            return [response_json.encode('utf-8')]
        
        # Read request body
        content_length = int(environ.get('CONTENT_LENGTH', '0'))
        if content_length > 0:
            request_body = environ['wsgi.input'].read(content_length)
            try:
                request_data = json.loads(request_body.decode('utf-8'))
            except json.JSONDecodeError:
                request_data = {}
        else:
            request_data = {}
        
        # Route API calls
        if path == '/proxy/beginSession':
            response_data = proxy_begin_session(request_data)
        elif path == '/proxy/dialogue':
            response_data = proxy_dialogue(request_data)
        elif path == '/proxy/abortDialogue':
            response_data = proxy_abort_dialogue(request_data)
        elif path == '/proxy/endSession':
            response_data = proxy_end_session(request_data)
        else:
            response_data = {
                'code': 404,
                'success': False,
                'message': f'API endpoint not found: {path}',
                'available_endpoints': [
                    '/proxy/beginSession',
                    '/proxy/dialogue', 
                    '/proxy/abortDialogue',
                    '/proxy/endSession'
                ]
            }
        
        # Return JSON response
        response_json = json.dumps(response_data, ensure_ascii=False, indent=2)
        
        # Set response status based on code
        status_code = response_data.get('code', 200)
        if status_code == 200:
            status = '200 OK'
        elif status_code == 400:
            status = '400 Bad Request'
        elif status_code == 404:
            status = '404 Not Found'
        elif status_code == 405:
            status = '405 Method Not Allowed'
        else:
            status = '500 Internal Server Error'
        
        start_response(status, [
            ('Content-Type', 'application/json; charset=utf-8'),
            ('Content-Length', str(len(response_json.encode('utf-8')))),
            ('Cache-Control', 'no-cache')
        ])
        
        return [response_json.encode('utf-8')]
        
    except Exception as e:
        logger.error(f"❌ Handler failed: {e}")
        import traceback
        traceback.print_exc()
        
        error_response = {
            'code': 500,
            'success': False,
            'message': str(e)
        }
        response_json = json.dumps(error_response, ensure_ascii=False)
        
        start_response('500 Internal Server Error', [
            ('Content-Type', 'application/json; charset=utf-8'),
            ('Content-Length', str(len(response_json.encode('utf-8'))))
        ])
        
        return [response_json.encode('utf-8')]

# Development/testing entry point
if __name__ == '__main__':
    logger.info("🚀 CCC Digital Employee Proxy - Development Mode")
    logger.info("🎯 API Endpoints: /proxy/beginSession, /proxy/dialogue, /proxy/abortDialogue, /proxy/endSession")
    logger.info("📞 Architecture: CCC Digital Employee → FC Proxy → DashScope AI")
    logger.info("⚡ Performance: <200ms beginSession, <600ms dialogue")
    
    # Test session management
    test_customer = {
        'name': '张先生',
        'overdue_amount': '15000元',
        'overdue_days': 30
    }
    
    print("\n🧪 Testing API endpoints...")
    
    # Test beginSession
    session_result = proxy_begin_session({'customer': test_customer})
    print(f"✅ beginSession: {session_result['data']['processing_time']:.3f}s")
    
    if session_result['success']:
        session_id = session_result['data']['sessionId']
        
        # Test dialogue
        dialogue_result = proxy_dialogue({
            'sessionId': session_id,
            'text': '我现在没有钱还款'
        })
        print(f"✅ dialogue: {dialogue_result['data']['processing_time']:.3f}s")
        
        # Test endSession
        end_result = proxy_end_session({'sessionId': session_id})
        print(f"✅ endSession: {end_result['data']['processing_time']:.3f}s")
    
    print("\n🎯 Ready for CCC Digital Employee integration!")