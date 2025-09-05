"""
Call Control Parameters for CCC Digital Employee Integration
Based on Aliyun Java template control parameter system
"""

import json
from typing import Dict, Any, Optional, List
from enum import Enum

class ControlType(Enum):
    """Control parameter types"""
    VOICE_CONTROL = "VOICE_CONTROL"
    TRANSFER_CONTROL = "TRANSFER_CONTROL" 
    DTMF_CONTROL = "DTMF_CONTROL"
    HANGUP_CONTROL = "HANGUP_CONTROL"
    SCHEDULE_CONTROL = "SCHEDULE_CONTROL"

class ControlParams:
    """Base class for call control parameters"""
    
    @staticmethod
    def voice_control(interruptible: bool = True, silence_timeout: int = 5000) -> List[str]:
        """
        Voice control parameters for speech interaction - CCC Compatible Format
        
        Args:
            interruptible: Whether customer can interrupt agent speech
            silence_timeout: Timeout in milliseconds for customer silence
        """
        params = {
            "type": ControlType.VOICE_CONTROL.value,
            "interruptible": interruptible,
            "silenceDetectionTimeout": silence_timeout,
            "enableVAD": True  # Voice Activity Detection
        }
        return [json.dumps(params)]  # CRITICAL: Return as JSON string in array
    
    @staticmethod
    def transfer_control(target_queue: str, transfer_message: str = "", priority: str = "normal") -> List[str]:
        """
        Transfer control parameters for human agent escalation - CCC Compatible
        
        Args:
            target_queue: Target agent queue (e.g., "collection_specialists")
            transfer_message: Message for human agent context
            priority: Transfer priority (normal, high, urgent)
        """
        params = {
            "type": ControlType.TRANSFER_CONTROL.value,
            "targetQueue": target_queue,
            "transferMessage": transfer_message,
            "priority": priority,
            "preserveContext": True,
            "waitTime": 30  # Max wait time in seconds
        }
        return [json.dumps(params)]  # CRITICAL: Return as JSON string in array
    
    @staticmethod
    def dtmf_control(prompt: str, max_digits: int = 1, timeout: int = 10000) -> List[str]:
        """
        DTMF control parameters for digit collection - CCC Compatible
        
        Args:
            prompt: Prompt to play for digit collection
            max_digits: Maximum digits to collect
            timeout: Collection timeout in milliseconds
        """
        params = {
            "type": ControlType.DTMF_CONTROL.value,
            "prompt": prompt,
            "maxDigits": max_digits,
            "timeout": timeout,
            "terminateOn": "#",  # Termination key
            "retryCount": 3  # Max retry attempts
        }
        return [json.dumps(params)]  # CRITICAL: Return as JSON string in array
    
    @staticmethod
    def hangup_control(delay_seconds: int = 3, farewell_message: str = "") -> List[str]:
        """
        Hangup control parameters for call termination - CCC Compatible
        
        Args:
            delay_seconds: Delay before hangup
            farewell_message: Final message before hangup
        """
        params = {
            "type": ControlType.HANGUP_CONTROL.value,
            "delaySeconds": delay_seconds,
            "farewellMessage": farewell_message,
            "reason": "agent_initiated"
        }
        return [json.dumps(params)]  # CRITICAL: Return as JSON string in array
    
    @staticmethod
    def schedule_control(callback_time: str, callback_number: str = "") -> List[str]:
        """
        Schedule control parameters for callback arrangement - CCC Compatible
        
        Args:
            callback_time: Preferred callback time (ISO format)
            callback_number: Callback phone number
        """
        params = {
            "type": ControlType.SCHEDULE_CONTROL.value,
            "callbackTime": callback_time,
            "callbackNumber": callback_number,
            "attempts": 1,
            "priority": "normal"
        }
        return [json.dumps(params)]  # CRITICAL: Return as JSON string in array

class CollectionControlParams:
    """Specialized control parameters for debt collection scenarios"""
    
    @staticmethod
    def payment_plan_selection() -> List[str]:
        """DTMF control for payment plan selection"""
        return ControlParams.dtmf_control(
            prompt="请选择分期方案：按1选择3期，按2选择6期，按3选择12期，按0转人工服务",
            max_digits=1,
            timeout=15000
        )
    
    @staticmethod
    def amount_confirmation(amount: str) -> List[str]:
        """DTMF control for payment amount confirmation"""
        return ControlParams.dtmf_control(
            prompt=f"确认还款金额{amount}吗？按1确认，按2重新输入，按0转人工服务",
            max_digits=1,
            timeout=10000
        )
    
    @staticmethod
    def specialist_transfer(reason: str = "客户要求专业协商") -> List[str]:
        """Transfer to collection specialist"""
        return ControlParams.transfer_control(
            target_queue="collection_specialists",
            transfer_message=f"债务协商请求: {reason}",
            priority="high"
        )
    
    @staticmethod
    def callback_scheduling() -> List[str]:
        """Schedule callback for payment discussion"""
        return ControlParams.dtmf_control(
            prompt="请选择回访时间：按1上午，按2下午，按3晚上，按0其他时间",
            max_digits=1,
            timeout=12000
        )
    
    @staticmethod
    def compliance_hangup() -> List[str]:
        """Compliant call termination"""
        return ControlParams.hangup_control(
            delay_seconds=5,
            farewell_message="感谢您的配合，我们会根据您的情况安排后续联系。再见。"
        )

class IntentControlMapping:
    """Maps detected intents to appropriate control parameters"""
    
    # Map English intent codes to control parameter functions
    INTENT_CONTROLS = {
        # Transfer intents (English codes from IntentRecognizer)
        "TRANSFER_AGENT": lambda: CollectionControlParams.specialist_transfer("客户要求转人工服务"),
        
        # Payment intents
        "PAYMENT_PLAN": lambda: CollectionControlParams.payment_plan_selection(),
        
        # Scheduling intents  
        "SCHEDULE_CALLBACK": lambda: CollectionControlParams.callback_scheduling(),
        
        # Customer resistance
        "NO_MONEY": lambda: ControlParams.voice_control(interruptible=True, silence_timeout=8000),
        
        # Termination intents
        "HANGUP": lambda: CollectionControlParams.compliance_hangup(),
        
        # Default conversation control
        "default": lambda: ControlParams.voice_control(interruptible=True, silence_timeout=5000)
    }
    
    # Legacy Chinese keyword mapping for backward compatibility
    CHINESE_KEYWORD_CONTROLS = {
        # Transfer intents (Chinese keywords)
        "转人工": lambda: CollectionControlParams.specialist_transfer("客户要求转人工服务"),
        "人工服务": lambda: CollectionControlParams.specialist_transfer("客户要求人工服务"),
        "专业咨询": lambda: CollectionControlParams.specialist_transfer("客户需要专业债务咨询"),
        
        # Payment intents
        "分期还款": lambda: CollectionControlParams.payment_plan_selection(),
        "还款计划": lambda: CollectionControlParams.payment_plan_selection(),
        "分期付款": lambda: CollectionControlParams.payment_plan_selection(),
        
        # Scheduling intents
        "稍后联系": lambda: CollectionControlParams.callback_scheduling(),
        "晚点打": lambda: CollectionControlParams.callback_scheduling(),
        "改天联系": lambda: CollectionControlParams.callback_scheduling(),
        
        # Termination intents
        "挂机": lambda: CollectionControlParams.compliance_hangup(),
        "结束通话": lambda: CollectionControlParams.compliance_hangup(),
        "不想聊": lambda: CollectionControlParams.compliance_hangup()
    }
    
    @classmethod
    def get_control_params(cls, intent: Optional[str]) -> List[str]:
        """Get control parameters for detected intent"""
        # First try English intent codes (primary system)
        if intent and intent in cls.INTENT_CONTROLS:
            return cls.INTENT_CONTROLS[intent]()
        # Then try Chinese keywords (legacy support)
        elif intent and intent in cls.CHINESE_KEYWORD_CONTROLS:
            return cls.CHINESE_KEYWORD_CONTROLS[intent]()
        else:
            return cls.INTENT_CONTROLS["default"]()
    
    @classmethod
    def get_all_intents(cls) -> list:
        """Get list of all supported intents"""
        return [intent for intent in cls.INTENT_CONTROLS.keys() if intent != "default"]

# Vendor parameter constants (matching Java template)
class VendorParams:
    """CCC vendor parameter constants"""
    
    # Customer information
    CALLING_NUMBER = "callingNumber"
    CALLED_NUMBER = "calledNumber"
    CUSTOMER_NAME = "customerName"
    
    # Collection-specific
    OVERDUE_AMOUNT = "overdueAmount"
    OVERDUE_DAYS = "overdueDays"
    CONTACT_HISTORY = "contactHistory"
    PAYMENT_HISTORY = "paymentHistory"
    RISK_LEVEL = "riskLevel"
    
    # Call context
    CALL_ID = "callId"
    AGENT_ID = "agentId"
    CALL_START_TIME = "callStartTime"
    PREVIOUS_ATTEMPTS = "previousAttempts"

# Response data types (matching Java template)
class DataType:
    """Response data type constants"""
    
    TEXT = "TEXT"
    CONTROL = "CONTROL"
    TRANSFER = "TRANSFER"
    DTMF = "DTMF"
    HANGUP = "HANGUP"
    SCHEDULE = "SCHEDULE"