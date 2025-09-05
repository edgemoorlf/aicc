"""
Data Transfer Objects (DTOs) for CCC Digital Employee Chatbot Proxy
Based on Aliyun Java template structure
"""

import json
import time
import uuid
from typing import Dict, Optional, Any, List
from datetime import datetime

class BaseRequest:
    """Base request class with common fields"""
    
    def __init__(self, data: Dict[str, Any]):
        self.raw_data = data
        self.session_id = data.get('sessionId', str(uuid.uuid4()))
        self.timestamp = datetime.now().isoformat()

class BeginSessionRequest(BaseRequest):
    """Begin session request DTO - CCC Compatible"""
    
    def __init__(self, data: Dict[str, Any]):
        super().__init__(data)
        
        # CRITICAL: Extract all required CCC fields
        self.request_id = data.get('requestId', str(uuid.uuid4()))
        self.tenant_id = data.get('tenantId')
        self.instance_id = data.get('instanceId', '')
        self.script_id = data.get('scriptId', '') 
        self.session_id = data.get('sessionId', str(uuid.uuid4()))
        self.stream_id = data.get('streamId', data.get('sessionId', str(uuid.uuid4())))
        
        # Customer information (default values for missing data)
        customer_info = data.get('customerInfo', {})
        self.customer_name = customer_info.get('customerName', '客户')
        
        # Vendor parameters (CCC specific)
        vendor_params = data.get('vendorParams', {})
        self.calling_number = vendor_params.get('callingNumber', '')
        self.called_number = vendor_params.get('calledNumber', '')
        self.overdue_amount = vendor_params.get('overdueAmount', '15000元')
        self.overdue_days = vendor_params.get('overdueDays', '30')
        self.contact_history = vendor_params.get('contactHistory', '首次联系')
        
        # Call information
        call_info = data.get('callInfo', {})
        self.call_id = call_info.get('callId', vendor_params.get('conversationId', self.session_id))
        self.agent_id = call_info.get('agentId', 'digital_agent')

class DialogueRequest(BaseRequest):
    """Dialogue request DTO - CCC Compatible"""
    
    def __init__(self, data: Dict[str, Any]):
        super().__init__(data)
        
        # CRITICAL: Extract all required CCC fields
        self.request_id = data.get('requestId', str(uuid.uuid4()))
        self.session_id = data.get('sessionId', str(uuid.uuid4()))
        self.stream_id = data.get('streamId', self.session_id)
        
        # Customer input (from CCC ASR)
        self.text = data.get('text', '').strip()
        self.utterance_id = data.get('utteranceId', str(uuid.uuid4()))
        
        # Context information
        self.conversation_id = data.get('conversationId', self.session_id)
        self.turn_id = data.get('turnId', 1)
        
        # Vendor parameters for context
        vendor_params = data.get('vendorParams', {})
        self.customer_name = vendor_params.get('customerName', '客户')
        self.call_context = vendor_params.get('callContext', {})

class AbortDialogueRequest(BaseRequest):
    """Abort dialogue request DTO"""
    
    def __init__(self, data: Dict[str, Any]):
        super().__init__(data)
        
        self.reason = data.get('reason', 'user_interrupt')
        self.utterance_id = data.get('utteranceId', '')

class EndSessionRequest(BaseRequest):
    """End session request DTO"""
    
    def __init__(self, data: Dict[str, Any]):
        super().__init__(data)
        
        self.end_reason = data.get('endReason', 'normal')
        self.call_duration = data.get('callDuration', 0)
        self.dialogue_turns = data.get('dialogueTurns', 0)

class AnswerDto:
    """Answer response DTO for SSE streaming - CCC Compatible Format"""
    
    def __init__(self, answer_text: str, stream_end: bool = False, 
                 session_id: str = "", stream_id: str = "", 
                 control_params_list: List[str] = None):
        self.answer = answer_text
        self.stream_end = stream_end
        self.session_id = session_id
        self.stream_id = stream_id  
        self.updated_time = int(time.time() * 1000)  # Java compatible timestamp
        self.control_params_list = control_params_list or []
    
    def to_sse_format(self, request_id: str) -> str:
        """Convert to CCC-compatible SSE JSON format"""
        data = {
            "requestId": request_id,                    # CRITICAL: Echo request ID
            "httpStatusCode": 200,                      # CRITICAL: Always 200
            "code": "OK",                              # CRITICAL: Success code
            "message": None,                           # CRITICAL: Error message or null
            "params": None,                            # CRITICAL: Reserved field
            "data": {
                "streamEnd": self.stream_end,          # CRITICAL: Correct camelCase
                "updatedTime": self.updated_time,      # CRITICAL: Long timestamp  
                "sessionId": self.session_id,          # CRITICAL: Session ID
                "streamId": self.stream_id,            # CRITICAL: Stream ID
                "answer": self.answer,                 # CRITICAL: Response text
                "controlParamsList": self.control_params_list  # CRITICAL: List of JSON strings
            }
        }
        return json.dumps(data, ensure_ascii=False)

class GenericResponse:
    """Generic API response wrapper"""
    
    def __init__(self, success: bool = True, data: Any = None, message: str = ""):
        self.success = success
        self.data = data
        self.message = message
        self.timestamp = datetime.now().isoformat()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "success": self.success,
            "data": self.data,
            "message": self.message,
            "timestamp": self.timestamp
        }

# Collection-specific DTOs
class CustomerProfile:
    """Customer profile for debt collection context"""
    
    def __init__(self, data: Dict[str, Any]):
        self.name = data.get('name', '客户')
        self.overdue_amount = data.get('overdue_amount', '15000元')
        self.overdue_days = data.get('overdue_days', '30')
        self.contact_history = data.get('contact_history', '首次联系')
        self.payment_history = data.get('payment_history', [])
        self.risk_level = data.get('risk_level', 'medium')
    
    def format_amount_chinese(self) -> str:
        """Format amount for Chinese TTS"""
        try:
            amount = float(self.overdue_amount.replace('元', '').replace(',', ''))
            if amount >= 10000:
                return f"{amount/10000:.1f}万元".replace('.0', '')
            else:
                return f"{amount:.0f}元"
        except:
            return self.overdue_amount

class ConversationContext:
    """Conversation context for session management"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.created_at = datetime.now().isoformat()
        self.dialogue_history: List[str] = []
        self.customer_profile: Optional[CustomerProfile] = None
        self.last_intent: Optional[str] = None
        self.control_state = "active"  # active, transferred, terminated
    
    def add_dialogue_turn(self, customer_input: str, agent_response: str):
        """Add dialogue turn to history"""
        self.dialogue_history.append(f"客户: {customer_input}")
        self.dialogue_history.append(f"坐席: {agent_response}")
    
    def get_conversation_summary(self) -> Dict[str, Any]:
        """Get conversation summary for context"""
        return {
            "session_id": self.session_id,
            "duration": datetime.now().isoformat(),
            "turns": len(self.dialogue_history) // 2,
            "last_intent": self.last_intent,
            "control_state": self.control_state
        }