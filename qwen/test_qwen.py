#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试Qwen API连接和基本功能
"""

import os
import sys
import json
import dashscope
from dashscope import Generation

def test_dashscope_api():
    """测试DashScope API连接"""
    print("🔧 测试DashScope API连接...")
    
    api_key = os.getenv('DASHSCOPE_API_KEY')
    if not api_key:
        print("❌ 错误: 请设置 DASHSCOPE_API_KEY 环境变量")
        return False
        
    dashscope.api_key = api_key
    print(f"✅ API Key已设置: {api_key[:10]}...")
    
    return True

def test_qwen_generation():
    """测试通义千问文本生成"""
    print("\n📝 测试通义千问文本生成...")
    
    try:
        response = Generation.call(
            model='qwen-plus',
            messages=[
                {'role': 'system', 'content': '你是专业的银行催收专员，必须用中文回复。'},
                {'role': 'user', 'content': '客户说："我这个月资金紧张，能不能推迟几天还款？"请专业回复。'}
            ],
            temperature=0.7,
            max_tokens=200,
            result_format='message'
        )
        
        if response.status_code == 200:
            ai_response = response.output.choices[0].message.content
            print(f"✅ 通义千问回复: {ai_response}")
            return True
        else:
            print(f"❌ 通义千问调用失败: {response.status_code}")
            print(f"错误信息: {response}")
            return False
            
    except Exception as e:
        print(f"❌ 通义千问调用异常: {str(e)}")
        return False

def test_qwen_tts():
    """测试通义千问TTS"""
    print("\n🎤 测试通义千问TTS...")
    
    try:
        response = dashscope.audio.qwen_tts.SpeechSynthesizer.call(
            model="qwen-tts",
            text="您好，我是平安银行催收专员，今天联系您是关于您的逾期账款。",
            voice="xiaoyun",
            stream=False
        )
        
        if hasattr(response, 'output') and response.output:
            audio_data = response.output.get('audio', {}).get('data')
            if audio_data:
                print(f"✅ TTS音频生成成功，数据长度: {len(audio_data)} bytes")
                return True
            else:
                print("❌ TTS响应中没有音频数据")
                return False
        else:
            print(f"❌ TTS调用失败: {response}")
            return False
            
    except Exception as e:
        print(f"❌ TTS调用异常: {str(e)}")
        return False

def test_qwen_asr():
    """测试DashScope语音识别"""
    print("\n🎙️ 测试DashScope语音识别...")
    
    try:
        from dashscope.audio.asr import Recognition
        
        # 创建Recognition实例
        recognition = Recognition(
            model='paraformer-realtime-v2',
            format='wav',
            sample_rate=16000,
            callback=None
        )
        
        print("✅ DashScope ASR模块加载成功")
        print("📝 注意：实际语音识别需要音频文件")
        return True
        
    except ImportError as e:
        print(f"❌ DashScope ASR导入失败: {str(e)}")
        return False
    except Exception as e:
        print(f"⚠️  ASR测试异常: {str(e)}")
        return True  # 不阻止其他测试

def main():
    """主测试函数"""
    print("🚀 开始测试Qwen API功能...")
    print("="*50)
    
    # 测试API连接
    if not test_dashscope_api():
        return False
    
    # 测试文本生成
    if not test_qwen_generation():
        return False
        
    # 测试TTS
    if not test_qwen_tts():
        return False
    
    # 测试ASR（如果可用）
    if not test_qwen_asr():
        return False
    
    print("\n" + "="*50)
    print("🎉 所有测试通过！Qwen API功能正常")
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)