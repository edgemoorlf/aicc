#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试DashScope TTS功能的专用脚本
测试WAV格式输出
"""

import os
import sys
import base64
import dashscope
from dotenv import load_dotenv

# 加载.env文件
load_dotenv()

def test_dashscope_tts():
    """测试DashScope TTS API"""
    print("🎤 测试DashScope TTS功能...")
    print("="*50)
    
    # 检查API Key
    api_key = os.getenv('DASHSCOPE_API_KEY')
    if not api_key:
        print("❌ 错误: 请设置 DASHSCOPE_API_KEY 环境变量")
        return False
        
    dashscope.api_key = api_key
    print(f"✅ API Key已设置: {api_key[:10]}...")
    
    # 测试文本
    test_text = "您好，这是一个TTS测试。请确认您能听到清晰的中文语音。"
    print(f"📝 测试文本: {test_text}")
    
    try:
        print("\n🔧 使用非流式WAV格式进行TTS测试...")
        
        # 使用非流式方式，直接生成完整的WAV格式
        response = dashscope.audio.qwen_tts.SpeechSynthesizer.call(
            model="qwen-tts",
            api_key=api_key,  # 显式传递API key
            text=test_text,
            voice="Cherry",  # 中文女声
            format='wav',  # WAV格式
            stream=False  # 非流式处理，获得完整WAV文件
        )
        
        print(f"📊 TTS响应类型: {type(response)}")
        
        # 检查response是否为None
        if response is None:
            print("❌ TTS API返回None响应")
            return False
        
        # 检查响应状态
        print(f"📊 响应状态码: {getattr(response, 'status_code', '未知')}")
        
        if hasattr(response, 'status_code') and response.status_code == 200:
            if hasattr(response, 'output') and response.output and hasattr(response.output, 'audio'):
                audio_data = response.output.audio
                print(f"📊 音频数据类型: {type(audio_data)}")
                
                wav_data = None
                if isinstance(audio_data, str):
                    # Base64编码的音频数据
                    wav_data = base64.b64decode(audio_data)
                    print(f"✅ 从字符串解码WAV数据: {len(wav_data)} bytes")
                elif hasattr(audio_data, 'data'):
                    # 音频数据在data字段中
                    wav_data = base64.b64decode(audio_data.data)
                    print(f"✅ 从data字段解码WAV数据: {len(wav_data)} bytes")
                elif isinstance(audio_data, dict):
                    # 字典格式，检查data字段
                    print(f"📊 字典键: {list(audio_data.keys())}")
                    print(f"📊 字典内容: {audio_data}")
                    
                    if 'data' in audio_data and audio_data['data']:
                        wav_data = base64.b64decode(audio_data['data'])
                        print(f"✅ 从字典data字段解码WAV数据: {len(wav_data)} bytes")
                    elif 'url' in audio_data and audio_data['url']:
                        # 如果有URL，需要下载音频
                        import requests
                        print(f"📊 从URL下载音频: {audio_data['url']}")
                        try:
                            audio_response = requests.get(audio_data['url'])
                            if audio_response.status_code == 200:
                                wav_data = audio_response.content
                                print(f"✅ 从URL下载WAV数据: {len(wav_data)} bytes")
                            else:
                                print(f"❌ URL下载失败，状态码: {audio_response.status_code}")
                                return False
                        except Exception as e:
                            print(f"❌ URL下载异常: {str(e)}")
                            return False
                    else:
                        print(f"❌ 字典中没有有效的data或url字段")
                        return False
                else:
                    print(f"❌ 音频数据格式异常: {type(audio_data)}")
                    print(f"📊 音频数据内容: {audio_data}")
                    return False
                
                if wav_data:
                    print(f"\n🎉 TTS音频生成成功!")
                    print(f"📊 WAV数据长度: {len(wav_data)} bytes")
                    
                    # 保存为测试文件
                    test_file = "test_tts_nonstream.wav"
                    with open(test_file, 'wb') as f:
                        f.write(wav_data)
                    
                    print(f"💾 TTS音频已保存为: {test_file}")
                    print(f"🔊 可以播放该文件测试音质")
                    
                    # 检查WAV文件头
                    if len(wav_data) >= 44:
                        header = wav_data[:44]
                        if header.startswith(b'RIFF') and b'WAVE' in header:
                            print("✅ WAV文件头格式正确")
                        else:
                            print("⚠️  WAV文件头格式异常")
                            print(f"文件头: {header[:20].hex()}")
                    else:
                        print("⚠️  WAV数据长度不足44字节")
                    
                    return True
                else:
                    print("❌ 无法解码音频数据")
                    return False
            else:
                print(f"❌ 响应中没有音频数据")
                print(f"📊 Response output: {getattr(response, 'output', 'None')}")
                return False
        else:
            print(f"❌ TTS API调用失败，状态码: {getattr(response, 'status_code', '未知')}")
            print(f"📊 完整响应: {response}")
            return False
            
    except Exception as e:
        print(f"❌ TTS测试失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("🚀 DashScope TTS独立测试")
    print("测试WAV格式输出")
    print()
    
    success = test_dashscope_tts()
    
    if success:
        print("\n" + "="*50)
        print("✅ TTS测试通过! DashScope语音合成功能正常")
        print("🎵 请播放 test_tts_output.wav 验证音质")
    else:
        print("\n" + "="*50)
        print("❌ TTS测试失败")
    
    sys.exit(0 if success else 1)