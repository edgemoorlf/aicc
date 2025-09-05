#!/usr/bin/env python3
"""
CCC Digital Employee Chatbot Proxy - Text-based Implementation
Based on Aliyun's official Java template with SSE streaming

Architecture:
CCC Call → ASR (CCC) → Text → FC Chatbot → DashScope Qwen → SSE Stream → CCC TTS
"""

import os
import json
import time
import logging
from typing import Dict, Optional, Iterator, Any
from datetime import datetime
from flask import Flask, request, Response, jsonify

# DashScope imports
import dashscope

# Local imports
from chatbot_service import ChatbotService
from control_params import ControlParams
from dtos import BeginSessionRequest, DialogueRequest, AbortDialogueRequest, EndSessionRequest

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# DashScope configuration
DASHSCOPE_API_KEY = 'sk-89daa2f5ce954abba7770a87fa342db5'
if DASHSCOPE_API_KEY:
    dashscope.api_key = DASHSCOPE_API_KEY
else:
    logger.warning("⚠️ DASHSCOPE_API_KEY not set")

# Flask app initialization
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'chatbot-proxy-secret')

# Global service instance
chatbot_service = None

def initialize_service():
    """Initialize ChatbotService singleton"""
    global chatbot_service
    if chatbot_service is None:
        chatbot_service = ChatbotService()
        logger.info("✅ ChatbotService initialized")

def create_sse_response(generator: Iterator[str]) -> Response:
    """Create SSE response from generator"""
    def sse_stream():
        try:
            for chunk in generator:
                if chunk:
                    yield f"data: {chunk}\n\n"
                else:
                    break
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"❌ SSE streaming error: {e}")
            error_data = {
                "success": False,
                "message": str(e),
                "data": {"streamEnd": True}
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
    
    return Response(
        sse_stream(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    )

@app.route('/proxy/beginSession', methods=['POST'])
def begin_session():
    """
    Begin conversation session with welcome message
    Target: <200ms response time
    Protocol: SSE (Server-Sent Events)
    """
    start_time = time.time()
    
    try:
        initialize_service()
        
        request_data = request.get_json() or {}
        begin_request = BeginSessionRequest(request_data)
        
        logger.info(f"🆕 Begin session: {begin_request.session_id}")
        logger.info(f"📞 Customer: {begin_request.customer_name}, Amount: {begin_request.overdue_amount}")
        logger.info(f"🔍 Request data: {json.dumps(request_data, ensure_ascii=False, indent=2)}")
        
        # Create SSE generator
        response_generator = chatbot_service.begin_session(begin_request)
        
        processing_time = time.time() - start_time
        logger.info(f"✅ Begin session processed ({processing_time:.3f}s): {begin_request.session_id}")
        
        return create_sse_response(response_generator)
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"❌ Begin session failed ({processing_time:.3f}s): {e}")
        
        error_response = {
            "success": False,
            "message": str(e),
            "data": {"streamEnd": True}
        }
        
        def error_generator():
            yield json.dumps(error_response, ensure_ascii=False)
        
        return create_sse_response(error_generator())

@app.route('/proxy/dialogue', methods=['POST'])
def dialogue():
    """
    Process customer dialogue with DashScope streaming
    Target: <500ms first token, <600ms complete response
    Protocol: SSE (Server-Sent Events)
    """
    start_time = time.time()
    
    try:
        initialize_service()
        
        request_data = request.get_json() or {}
        dialogue_request = DialogueRequest(request_data)
        
        logger.info(f"💬 Dialogue: {dialogue_request.session_id} - '{dialogue_request.text}'")
        logger.info(f"📞 Customer: {dialogue_request.customer_name}")
        logger.info(f"🔍 Request data: {json.dumps(request_data, ensure_ascii=False, indent=2)}")
        
        # Check if session exists
        if dialogue_request.session_id not in chatbot_service.active_sessions:
            logger.warning(f"⚠️ Session not found: {dialogue_request.session_id}. Active sessions: {list(chatbot_service.active_sessions.keys())}")
        
        # Create SSE generator
        response_generator = chatbot_service.dialogue(dialogue_request)
        
        processing_time = time.time() - start_time
        logger.info(f"✅ Dialogue initiated ({processing_time:.3f}s): {dialogue_request.session_id}")
        
        return create_sse_response(response_generator)
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"❌ Dialogue failed ({processing_time:.3f}s): {e}")
        
        error_response = {
            "success": False,
            "message": str(e),
            "data": {"streamEnd": True}
        }
        
        def error_generator():
            yield json.dumps(error_response, ensure_ascii=False)
        
        return create_sse_response(error_generator())

@app.route('/proxy/abortDialogue', methods=['POST'])
def abort_dialogue():
    """
    Abort current dialogue turn
    Protocol: HTTPS (synchronous)
    """
    start_time = time.time()
    
    try:
        initialize_service()
        
        request_data = request.get_json() or {}
        abort_request = AbortDialogueRequest(request_data)
        
        logger.info(f"🚫 Abort dialogue: {abort_request.session_id}")
        
        result = chatbot_service.abort_dialogue(abort_request)
        
        processing_time = time.time() - start_time
        logger.info(f"✅ Dialogue aborted ({processing_time:.3f}s): {abort_request.session_id}")
        
        return jsonify({
            "success": True,
            "data": result,
            "processing_time": processing_time
        })
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"❌ Abort dialogue failed ({processing_time:.3f}s): {e}")
        
        return jsonify({
            "success": False,
            "message": str(e),
            "processing_time": processing_time
        }), 500

@app.route('/proxy/endSession', methods=['POST'])
def end_session():
    """
    End conversation session
    Protocol: HTTPS (synchronous)
    """
    start_time = time.time()
    
    try:
        initialize_service()
        
        request_data = request.get_json() or {}
        end_request = EndSessionRequest(request_data)
        
        logger.info(f"🏁 End session: {end_request.session_id}")
        logger.info(f"🔍 End reason: {end_request.end_reason}")
        logger.info(f"📋 Request data: {json.dumps(request_data, ensure_ascii=False, indent=2)}")
        
        # Check if session existed
        session_existed = end_request.session_id in chatbot_service.active_sessions
        logger.info(f"📊 Session existed: {session_existed}")
        
        result = chatbot_service.end_session(end_request)
        
        processing_time = time.time() - start_time
        logger.info(f"✅ Session ended ({processing_time:.3f}s): {end_request.session_id}")
        
        return jsonify({
            "success": True,
            "data": result,
            "processing_time": processing_time
        })
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"❌ End session failed ({processing_time:.3f}s): {e}")
        
        return jsonify({
            "success": False,
            "message": str(e),
            "processing_time": processing_time
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "CCC Chatbot Proxy",
        "timestamp": datetime.now().isoformat(),
        "dashscope_configured": bool(DASHSCOPE_API_KEY)
    })

@app.route('/', methods=['GET'])
def index():
    """Service information endpoint"""
    return jsonify({
        "service": "CCC Digital Employee Chatbot Proxy",
        "version": "1.0.0",
        "description": "Text-based integration with SSE streaming",
        "endpoints": {
            "beginSession": "/proxy/beginSession (POST, SSE)",
            "dialogue": "/proxy/dialogue (POST, SSE)", 
            "abortDialogue": "/proxy/abortDialogue (POST)",
            "endSession": "/proxy/endSession (POST)",
            "health": "/health (GET)"
        },
        "features": [
            "Server-Sent Events streaming",
            "DashScope Qwen integration",
            "Intent-based call control",
            "Professional collection agent"
        ]
    })

# Function Compute WSGI handler
def handler(environ, start_response):
    """Function Compute WSGI handler"""
    try:
        # Initialize service on first request
        initialize_service()
        
        # Process request with Flask app
        return app(environ, start_response)
        
    except Exception as e:
        logger.error(f"❌ WSGI handler error: {e}")
        
        error_response = json.dumps({
            "success": False,
            "message": "Internal server error",
            "error": str(e)
        }, ensure_ascii=False)
        
        start_response('500 Internal Server Error', [
            ('Content-Type', 'application/json; charset=utf-8'),
            ('Content-Length', str(len(error_response.encode('utf-8'))))
        ])
        
        return [error_response.encode('utf-8')]

# Development server
if __name__ == '__main__':
    logger.info("🚀 CCC Digital Employee Chatbot Proxy - Development Mode")
    logger.info("🎯 Features: Text-based, SSE streaming, DashScope integration")
    logger.info("📡 Architecture: CCC → Text → FC → DashScope → SSE → CCC")
    
    # Initialize service
    initialize_service()
    
    # Run Flask development server
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 7001)),
        debug=os.getenv('FLASK_ENV') == 'development',
        threaded=True
    )