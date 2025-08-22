#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成问候语音频文件，使用Cherry声音
"""

import os
import base64
import dashscope
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

def generate_greeting_audio():
    """生成问候语音频"""
    print("🎤 生成Cherry声音的问候语...")
    
    # 设置API Key
    api_key = os.getenv('DASHSCOPE_API_KEY')
    if not api_key:
        print("❌ 错误: 请设置 DASHSCOPE_API_KEY 环境变量")
        return False
        
    dashscope.api_key = api_key
    print(f"✅ API Key已设置")
    
    # 问候语文本
    greeting_text = "您好，我这里是平安银行。请问您现在有时间吗？"
    print(f"📝 问候语文本: {greeting_text}")
    
    try:
        # 使用Cherry声音生成TTS
        response = dashscope.audio.qwen_tts.SpeechSynthesizer.call(
            model="qwen-tts",
            api_key=api_key,
            text=greeting_text,
            voice="Cherry",  # 女声
            stream=True  # 使用流式处理
        )
        
        # 收集所有音频数据块
        pcm_data = b''
        for chunk in response:
            if "output" in chunk and "audio" in chunk["output"] and "data" in chunk["output"]["audio"]:
                audio_string = chunk["output"]["audio"]["data"]
                wav_bytes = base64.b64decode(audio_string)
                pcm_data += wav_bytes
        
        if pcm_data:
            print(f"✅ TTS音频生成成功，PCM数据长度: {len(pcm_data)} bytes")
            
            # 将PCM数据转换为WAV格式
            wav_data = create_wav_buffer(pcm_data)
            print(f"✅ WAV转换完成，数据长度: {len(wav_data)} bytes")
            
            # 保存为greeting.wav文件
            with open('greeting.wav', 'wb') as f:
                f.write(wav_data)
            
            print(f"🎉 问候语音频已保存为 greeting.wav")
            return True
        else:
            print("❌ TTS响应中没有音频数据")
            return False
            
    except Exception as e:
        print(f"❌ TTS生成失败: {str(e)}")
        return False

def create_wav_buffer(pcm_data):
    """将PCM16数据转换为WAV格式"""
    import struct
    
    # WAV文件参数 (与qwen-server.py中的配置一致)
    sample_rate = 24000  # 24kHz
    num_channels = 1     # 单声道
    bits_per_sample = 16 # 16位PCM
    data_size = len(pcm_data)
    file_size = 36 + data_size
    
    # 创建WAV文件头
    header = bytearray(44)
    
    # RIFF chunk
    header[0:4] = b'RIFF'
    struct.pack_into('<I', header, 4, file_size)
    header[8:12] = b'WAVE'
    
    # fmt chunk
    header[12:16] = b'fmt '
    struct.pack_into('<I', header, 16, 16)  # fmt chunk size
    struct.pack_into('<H', header, 20, 1)   # PCM format
    struct.pack_into('<H', header, 22, num_channels)
    struct.pack_into('<I', header, 24, sample_rate)
    struct.pack_into('<I', header, 28, sample_rate * num_channels * bits_per_sample // 8)  # byte rate
    struct.pack_into('<H', header, 32, num_channels * bits_per_sample // 8)  # block align
    struct.pack_into('<H', header, 34, bits_per_sample)
    
    # data chunk
    header[36:40] = b'data'
    struct.pack_into('<I', header, 40, data_size)
    
    # 合并头部和PCM数据
    return bytes(header) + pcm_data

if __name__ == "__main__":
    print("🚀 生成平安银行问候语音频")
    print("=" * 50)
    
    success = generate_greeting_audio()
    
    if success:
        print("\n" + "=" * 50)
        print("✅ 问候语音频生成成功!")
        print("🔊 可以播放 greeting.wav 测试效果")
    else:
        print("\n" + "=" * 50)
        print("❌ 问候语音频生成失败")