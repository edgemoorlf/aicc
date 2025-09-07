"""
Core ChatbotService for CCC Digital Employee Integration
Implements DashScope streaming and professional collection logic
"""

import json
# import time  # ✅ REMOVED: No longer needed after removing artificial delays
import logging
from typing import Dict, Optional, Iterator, List, Any
from datetime import datetime, timedelta

# DashScope imports
import dashscope
from dashscope import Generation


DASHSCOPE_API_KEY = 'sk-89daa2f5ce954abba7770a87fa342db5'

# Local imports
from dtos import (
    BeginSessionRequest, DialogueRequest, AbortDialogueRequest, EndSessionRequest,
    AnswerDto, CustomerProfile, ConversationContext
)
from control_params import ControlParams, CollectionControlParams, IntentControlMapping

logger = logging.getLogger(__name__)

class IntentRecognizer:
    """Intent recognition for call control and collection scenarios"""
    
    COLLECTION_INTENTS = {
        # Transfer to human
        "转人工": "TRANSFER_AGENT",
        "人工服务": "TRANSFER_AGENT",
        "专业咨询": "TRANSFER_AGENT",
        "要找人": "TRANSFER_AGENT",
        
        # Payment related
        "分期还款": "PAYMENT_PLAN",
        "还款计划": "PAYMENT_PLAN", 
        "分期付款": "PAYMENT_PLAN",
        "怎么还": "PAYMENT_PLAN",
        
        # Scheduling
        "稍后联系": "SCHEDULE_CALLBACK",
        "晚点打": "SCHEDULE_CALLBACK",
        "改天联系": "SCHEDULE_CALLBACK",
        "现在不方便": "SCHEDULE_CALLBACK",
        
        # Resistance/Negotiation
        "没有钱": "NO_MONEY",
        "还不起": "NO_MONEY",
        "暂时困难": "NO_MONEY",
        
        # Termination
        "挂机": "HANGUP",
        "结束通话": "HANGUP",
        "不想聊": "HANGUP"
    }
    
    @classmethod
    def detect_intent(cls, customer_input: str) -> Optional[str]:
        """Detect customer intent from input text"""
        customer_input = customer_input.strip().lower()
        
        for keyword, intent in cls.COLLECTION_INTENTS.items():
            if keyword in customer_input:
                logger.info(f"🎯 Intent detected: {intent} (keyword: {keyword})")
                return intent
        
        return None

class ChatbotService:
    """Core chatbot service with DashScope integration"""
    
    def __init__(self):
        self.active_sessions: Dict[str, ConversationContext] = {}
        self.generation_client = Generation()
        
        # Professional collection prompt template
        self.COLLECTION_PROMPT = """你是专业的银行催收专员，正在进行债务催收对话。

客户信息：
- 姓名：{customer_name}
- 逾期金额：{overdue_amount}
- 逾期天数：{overdue_days}天
- 联系历史：{contact_history}

对话历史：
{conversation_history}

对话要求：
1. 语气专业、礼貌但坚定
2. 使用银行术语：逾期本金、还款义务、征信记录
3. 提供具体解决方案（分期还款、一次性优惠等）
4. 强调逾期对个人征信的影响
5. 回复简洁明了，适合语音播报（30字以内）
6. 保持合规，避免过度施压

客户说："{customer_input}"

请回复："""
        
        logger.info("✅ ChatbotService initialized with DashScope integration")
    
    def get_or_create_session(self, session_id: str) -> ConversationContext:
        """Get or create conversation session"""
        if session_id not in self.active_sessions:
            self.active_sessions[session_id] = ConversationContext(session_id)
            logger.info(f"📞 Created new session: {session_id}")
        
        return self.active_sessions[session_id]
    
    def format_chinese_amount(self, amount_str: str) -> str:
        """Format amount for Chinese TTS"""
        try:
            amount = float(amount_str.replace('元', '').replace(',', ''))
            if amount >= 10000:
                return f"{amount/10000:.1f}万元".replace('.0', '')
            else:
                return f"{amount:.0f}元"
        except:
            return amount_str
    
    def build_collection_context(self, request: DialogueRequest, context: ConversationContext) -> str:
        """Build professional collection conversation context"""
        # Create customer profile if not exists
        if context.customer_profile is None:
            profile_data = {
                'name': request.customer_name,
                'overdue_amount': getattr(request, 'call_context', {}).get('overdueAmount', '15000元'),
                'overdue_days': getattr(request, 'call_context', {}).get('overdueDays', '30'),
                'contact_history': '首次联系'
            }
            context.customer_profile = CustomerProfile(profile_data)
        
        profile = context.customer_profile
        
        return self.COLLECTION_PROMPT.format(
            customer_name=profile.name,
            overdue_amount=profile.format_amount_chinese(),
            overdue_days=profile.overdue_days,
            contact_history=profile.contact_history,
            conversation_history='\n'.join(context.dialogue_history[-6:]),  # Last 3 turns
            customer_input=request.text
        )
    
    def stream_qwen_response(self, prompt: str, request: DialogueRequest) -> Iterator[str]:
        """Stream DashScope Qwen LLM response with CCC-compatible format"""
        try:
            messages = [{'role': 'user', 'content': prompt}]
            
            # ✅ FIXED: Align API parameters with Java implementation
            # Java uses: .model("qwen-plus"), .incrementalOutput(false), .resultFormat(TEXT)
            responses = Generation.call(
                api_key=DASHSCOPE_API_KEY,
                model='qwen-plus',  # Same as Java
                messages=messages,
                stream=True,  # Python equivalent of Java's streaming
                result_format='text',  # Align with Java's ResultFormat.TEXT
                temperature=0.7,  # Aligned with Java (Java uses default)
                max_tokens=200,  # ✅ FIXED: Increased from 80 to prevent premature cutoff
                top_p=0.8,  # Fine for streaming
                incremental_output=True  # ✅ Better for streaming than Java's false
            )
            
            full_response = ""
            previous_length = 0
            chunk_count = 0
            
            for response in responses:
                if response.status_code == 200:
                    if response.output and hasattr(response.output, 'text'):
                        current_text = response.output.text
                        
                        # ✅ FIXED: Check finish_reason for automatic stream termination (align with Java)
                        finish_reason = getattr(response.output, 'finish_reason', None)
                        is_stream_end = (finish_reason == 'stop' or finish_reason == 'length')
                        
                        if current_text and len(current_text) > previous_length:
                            # Extract only the new delta (incremental text)
                            delta_text = current_text[previous_length:]
                            full_response = current_text
                            previous_length = len(current_text)
                            chunk_count += 1
                            
                            # ✅ FIXED: Use finish_reason for stream_end like Java (.streamEnd("stop".equals(...)))
                            answer = AnswerDto(
                                answer_text=delta_text,  # Send only the delta, not full text
                                stream_end=is_stream_end,  # ✅ Based on finish_reason, not manual
                                session_id=request.session_id,
                                stream_id=request.stream_id,
                                control_params_list=ControlParams.voice_control(interruptible=True)
                            )
                            
                            yield answer.to_sse_format(request.request_id)
                            
                            # Log completion when stream ends naturally
                            if is_stream_end:
                                logger.info(f"🏁 Stream completed naturally (finish_reason: {finish_reason})")
                                break
                            
                            # ✅ FIXED: Remove artificial delay - let natural streaming timing handle this
                            # time.sleep(0.05)  # Removed to prevent timing issues
                        elif is_stream_end and full_response.strip():
                            # Handle case where stream ends without new text
                            final_answer = AnswerDto(
                                answer_text="",
                                stream_end=True,
                                session_id=request.session_id,
                                stream_id=request.stream_id,
                                control_params_list=ControlParams.voice_control(interruptible=True)
                            )
                            yield final_answer.to_sse_format(request.request_id)
                            logger.info(f"🏁 Stream completed without new text (finish_reason: {finish_reason})")
                            break
                else:
                    logger.error(f"❌ DashScope error: {response}")
                    break
            
            # ✅ FIXED: Remove empty final response - let stream end naturally based on finish_reason
            # Stream completion is handled by the last chunk with proper finish_reason detection
            if full_response.strip():
                logger.info(f"🤖 LLM Response ({chunk_count} chunks): {full_response.strip()}")
            else:
                # Fallback response
                fallback_answer = AnswerDto(
                    answer_text="很抱歉，请您重复一下刚才的问题。",
                    stream_end=True,
                    session_id=request.session_id,
                    stream_id=request.stream_id,
                    control_params_list=ControlParams.voice_control(interruptible=True)
                )
                yield fallback_answer.to_sse_format(request.request_id)
                
        except Exception as e:
            logger.error(f"❌ Streaming LLM error: {e}")
            error_answer = AnswerDto(
                answer_text="系统暂时无法处理，请稍后再试。",
                stream_end=True,
                session_id=request.session_id,
                stream_id=request.stream_id,
                control_params_list=ControlParams.voice_control(interruptible=True)
            )
            yield error_answer.to_sse_format(request.request_id)
    
    def begin_session(self, request: BeginSessionRequest) -> Iterator[str]:
        """Begin conversation session with professional greeting"""
        try:
            # Create or get session
            context = self.get_or_create_session(request.session_id)
            
            # Create customer profile
            profile_data = {
                'name': request.customer_name,
                'overdue_amount': request.overdue_amount,
                'overdue_days': request.overdue_days,
                'contact_history': request.contact_history
            }
            context.customer_profile = CustomerProfile(profile_data)
            
            # Generate professional greeting
            formatted_amount = self.format_chinese_amount(request.overdue_amount)
            greeting = f"您好{request.customer_name}，我是银行催收专员。关于您{formatted_amount}逾期{request.overdue_days}天的款项，需要和您协商还款事宜。"
            
            # Create answer with voice control - match CCC expectations
            answer = AnswerDto(
                answer_text=greeting,
                stream_end=True,  # End the greeting stream, but conversation continues
                session_id=request.session_id,     # CRITICAL: Include session ID
                stream_id=request.stream_id,       # CRITICAL: Include stream ID
                control_params_list=ControlParams.voice_control(
                    interruptible=False,  # Don't allow interruption during greeting
                    silence_timeout=5000  # 5s timeout to match CCC behavior
                )
            )
            
            yield answer.to_sse_format(request.request_id)  # CRITICAL: Pass request ID
            
            logger.info(f"👋 Welcome message: {request.session_id} - {greeting}")
            
        except Exception as e:
            logger.error(f"❌ Begin session error: {e}")
            error_answer = AnswerDto(
                answer_text="系统初始化中，请稍等片刻。",
                stream_end=True,
                session_id=request.session_id,
                stream_id=request.stream_id,
                control_params_list=ControlParams.voice_control(interruptible=True)
            )
            yield error_answer.to_sse_format(request.request_id)
    
    def dialogue(self, request: DialogueRequest) -> Iterator[str]:
        """Process customer dialogue with intent detection and streaming response"""
        try:
            # Get session context
            context = self.get_or_create_session(request.session_id)
            
            # Detect customer intent
            intent = IntentRecognizer.detect_intent(request.text)
            context.last_intent = intent
            
            # Handle specific intents with control parameters
            if intent:
                control_params = IntentControlMapping.get_control_params(intent)
                
                # Generate intent-specific response
                if intent == "TRANSFER_AGENT":
                    response_text = "好的，我帮您转接专业的协商专员，请稍等。"
                elif intent == "PAYMENT_PLAN":
                    response_text = "我来为您介绍分期还款方案。"
                elif intent == "SCHEDULE_CALLBACK":
                    response_text = "好的，我们安排合适的时间再次联系您。"
                elif intent == "NO_MONEY":
                    response_text = "理解您的困难，我们可以协商合适的还款方案。"
                elif intent == "HANGUP":
                    response_text = "感谢您的配合，祝您生活愉快。"
                    context.control_state = "terminated"
                else:
                    # Use LLM for complex responses
                    prompt = self.build_collection_context(request, context)
                    for chunk in self.stream_qwen_response(prompt, request):
                        yield chunk
                    return
                
                # Create answer with intent-based control
                answer = AnswerDto(
                    answer_text=response_text,
                    stream_end=True,
                    session_id=request.session_id,
                    stream_id=request.stream_id,
                    control_params_list=control_params
                )
                
                yield answer.to_sse_format(request.request_id)
                
                # Update conversation history
                context.add_dialogue_turn(request.text, response_text)
                
            else:
                # No specific intent - use LLM for natural conversation
                prompt = self.build_collection_context(request, context)
                
                # ✅ FIXED: Simplify response tracking - pass response directly from stream_qwen_response
                full_ai_response = ""
                for chunk in self.stream_qwen_response(prompt, request):
                    yield chunk
                    # Extract the actual response text for history (simplified)
                    try:
                        chunk_json = json.loads(chunk)
                        chunk_text = chunk_json.get('data', {}).get('answer', '')
                        if chunk_text and not chunk_json.get('data', {}).get('streamEnd', False):
                            full_ai_response += chunk_text
                    except:
                        pass
                
                # ✅ FIXED: Simplified conversation history update
                if full_ai_response.strip():
                    context.add_dialogue_turn(request.text, full_ai_response.strip())
            
        except Exception as e:
            logger.error(f"❌ Dialogue error: {e}")
            error_answer = AnswerDto(
                answer_text="很抱歉，请您重复一下问题。",
                stream_end=True,
                session_id=request.session_id,
                stream_id=request.stream_id,
                control_params_list=ControlParams.voice_control(interruptible=True)
            )
            yield error_answer.to_sse_format(request.request_id)
    
    def abort_dialogue(self, request: AbortDialogueRequest) -> Dict[str, Any]:
        """Abort current dialogue turn"""
        try:
            context = self.get_or_create_session(request.session_id)
            context.control_state = "aborted"
            
            logger.info(f"🚫 Dialogue aborted: {request.session_id} - {request.reason}")
            
            return {
                "sessionId": request.session_id,
                "status": "aborted",
                "reason": request.reason,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Abort dialogue error: {e}")
            raise
    
    def end_session(self, request: EndSessionRequest) -> Dict[str, Any]:
        """End conversation session with summary"""
        try:
            if request.session_id in self.active_sessions:
                context = self.active_sessions[request.session_id]
                context.control_state = "ended"
                
                # Generate session summary
                summary = context.get_conversation_summary()
                
                logger.info(f"🏁 Session ended: {request.session_id}")
                logger.info(f"   📊 Duration: {summary['duration']}")
                logger.info(f"   📊 Turns: {summary['turns']}")
                logger.info(f"   📊 Last intent: {summary['last_intent']}")
                
                # Keep session for analytics (in production, move to persistent storage)
                # del self.active_sessions[request.session_id]
                
                return {
                    "sessionId": request.session_id,
                    "status": "ended",
                    "summary": summary,
                    "endReason": request.end_reason,
                    "timestamp": datetime.now().isoformat()
                }
            else:
                return {
                    "sessionId": request.session_id,
                    "status": "not_found",
                    "timestamp": datetime.now().isoformat()
                }
                
        except Exception as e:
            logger.error(f"❌ End session error: {e}")
            raise