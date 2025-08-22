#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试流式PCM音频播放的简单脚本
"""

import os
import sys
import base64
import time
import dashscope
from dotenv import load_dotenv
import socketio

# 加载.env文件
load_dotenv()

def test_streaming_tts():
    """测试流式TTS并通过Socket.IO发送"""
    print("🎤 测试流式TTS播放...")
    print("="*50)
    
    # 检查API Key
    api_key = os.getenv('DASHSCOPE_API_KEY')
    if not api_key:
        print("❌ 错误: 请设置 DASHSCOPE_API_KEY 环境变量")
        return False
        
    dashscope.api_key = api_key
    print(f"✅ API Key已设置")
    
    # 测试文本
    test_text = "这是一个流式TTS测试。我们将测试PCM数据的实时播放功能。"
    print(f"📝 测试文本: {test_text}")
    
    try:
        print("\n🔧 开始流式TTS测试...")
        
        # 使用流式方式，生成PCM数据流
        responses = dashscope.audio.qwen_tts.SpeechSynthesizer.call(
            model="qwen-tts",
            api_key=api_key,
            text=test_text,
            voice="Cherry",  # 中文女声
            stream=True  # 流式处理
        )
        
        if responses is None:
            raise ValueError("TTS API返回None响应")
        
        chunk_count = 0
        total_bytes = 0
        
        print("🎵 开始流式处理PCM数据...")
        for chunk in responses:
            if chunk and "output" in chunk and "audio" in chunk["output"] and "data" in chunk["output"]["audio"]:
                audio_string = chunk["output"]["audio"]["data"]
                pcm_bytes = base64.b64decode(audio_string)
                if pcm_bytes:
                    chunk_count += 1
                    chunk_size = len(pcm_bytes)
                    total_bytes += chunk_size
                    
                    print(f"  📦 数据块 {chunk_count}: {chunk_size} bytes")
                    
                    # 模拟通过WebSocket发送
                    pcm_data = {
                        'pcm_data': list(pcm_bytes),
                        'chunk_index': chunk_count,
                        'segment_index': 0,
                        'total_segments': 1,
                        'text': test_text,
                        'sample_rate': 24000,
                        'channels': 1,
                        'bits_per_sample': 16
                    }
                    
                    # 在真实场景中，这里会通过socketio.emit发送
                    print(f"  🚀 将发送PCM数据块: {len(pcm_data['pcm_data'])} samples")
                    
                    # 模拟流式延迟
                    time.sleep(0.1)
        
        print(f"\n✅ 流式TTS测试完成!")
        print(f"📊 总共生成 {chunk_count} 个数据块")
        print(f"📊 总音频数据: {total_bytes} bytes")
        print(f"📊 预计播放时长: {total_bytes / (24000 * 2):.2f} 秒")
        
        return True
        
    except Exception as e:
        print(f"❌ 流式TTS测试失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("🚀 流式PCM音频播放测试")
    print("测试DashScope TTS流式输出")
    print()
    
    success = test_streaming_tts()
    
    if success:
        print("\n" + "="*50)
        print("✅ 流式测试通过! 可以开始测试WebSocket客户端")
        print("🎵 启动服务器并在浏览器中测试实时音频播放")
    else:
        print("\n" + "="*50)
        print("❌ 流式测试失败")
    
    sys.exit(0 if success else 1)