#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试DashScope ASR功能的专用脚本
使用 tests/test-fixed-greeting.wav 作为测试音频
"""

import os
import sys
import dashscope
from dashscope.audio.asr import Recognition
from dotenv import load_dotenv

# 加载.env文件
load_dotenv()

def test_dashscope_asr():
    """测试DashScope ASR API"""
    print("🎙️ 测试DashScope ASR功能...")
    print("="*50)
    
    # 检查API Key
    api_key = os.getenv('DASHSCOPE_API_KEY')
    if not api_key:
        print("❌ 错误: 请设置 DASHSCOPE_API_KEY 环境变量")
        return False
        
    dashscope.api_key = api_key
    print(f"✅ API Key已设置: {api_key[:10]}...")
    
    # 检查测试音频文件
    test_audio_path = "/var/folders/yb/0_c4yn7n0ws6cvl85tfcwjrw0000gn/T/tmph2x6tczz.webm"
    if not os.path.exists(test_audio_path):
        print(f"❌ 错误: WebM测试文件不存在: {test_audio_path}")
        # 回退到16位测试文件
        test_audio_path = "/tmp/test_16bit.wav"
        if not os.path.exists(test_audio_path):
            print(f"❌ 错误: 16位测试文件不存在: {test_audio_path}")
            # 回退到原生成的文件
            test_audio_path = "/var/folders/yb/0_c4yn7n0ws6cvl85tfcwjrw0000gn/T/tmpda0llkmi.wav"
            if not os.path.exists(test_audio_path):
                print(f"❌ 错误: 原生成文件也不存在: {test_audio_path}")
                # 最后回退到原始测试文件
                test_audio_path = "../tests/test-fixed-greeting.wav"
                if not os.path.exists(test_audio_path):
                    print(f"❌ 错误: 所有测试文件都不存在")
                    return False
                else:
                    print(f"📁 使用原始测试文件: {test_audio_path}")
            else:
                print(f"📁 使用32位生成文件: {test_audio_path}")
        else:
            print(f"📁 使用16位转换文件: {test_audio_path}")
    else:
        print(f"📁 使用WebM测试文件: {test_audio_path}")
    
    try:
        # 创建Recognition实例
        print("\n🔧 创建Recognition实例...")
        
        # 尝试不同的模型参数
        models_to_try = [
            {
                'model': 'paraformer-realtime-8k-v2',
                'format': 'webm',
                'sample_rate': 8000,  # 8kHz模型
                'callback': None
            },
            {
                'model': 'paraformer-realtime-8k-v2',
                'format': 'wav',
                'sample_rate': 8000,  # 8kHz模型
                'callback': None
            },
            {
                'model': 'paraformer-realtime-v2',
                'format': 'webm',
                'sample_rate': 48000,  # WebM文件的实际采样率
                'callback': None
            },
            {
                'model': 'paraformer-realtime-v2',
                'format': 'webm',
                'sample_rate': 16000,  # 尝试16kHz
                'callback': None
            },
            {
                'model': 'paraformer-realtime-v2',
                'format': 'wav',
                'sample_rate': 16000,
                'callback': None
            }
        ]
        
        # 如果使用WAV格式，先转换WebM到WAV
        for i, model_config in enumerate(models_to_try):
            print(f"\n🔧 尝试模型配置 {i+1}: {model_config['model']} ({model_config['format']}@{model_config['sample_rate']}Hz)")
            
            # 确定要使用的音频文件路径
            audio_file_path = test_audio_path
            
            # 如果模型要求WAV格式但我们有WebM文件，进行转换
            if model_config['format'] == 'wav' and test_audio_path.endswith('.webm'):
                try:
                    from pydub import AudioSegment
                    import tempfile
                    
                    print(f"📁 转换WebM到WAV格式 ({model_config['sample_rate']}Hz)...")
                    
                    # 读取WebM文件
                    audio = AudioSegment.from_file(test_audio_path, format="webm")
                    
                    # 转换为指定采样率和格式
                    audio = audio.set_frame_rate(model_config['sample_rate']).set_channels(1).set_sample_width(2)
                    
                    # 保存为临时WAV文件
                    wav_file_path = test_audio_path.replace('.webm', f'_{model_config["sample_rate"]}hz.wav')
                    audio.export(wav_file_path, format="wav")
                    
                    audio_file_path = wav_file_path
                    print(f"✅ WAV转换完成: {wav_file_path}")
                    
                except Exception as convert_error:
                    print(f"❌ WAV转换失败: {convert_error}")
                    continue
            
            try:
                recognition = Recognition(**model_config)
                print(f"✅ Recognition实例创建成功: {model_config['model']}")
                
                # 进行语音识别
                print(f"\n🎯 开始语音识别 (文件: {audio_file_path})...")
                result = recognition.call(audio_file_path)
                
                print(f"📊 ASR结果类型: {type(result)}")
                print(f"📊 ASR结果内容: {result}")
                
                # 检查结果
                if hasattr(result, 'output') and result.output is not None:
                    print(f"🎉 模型 {model_config['model']} 成功返回结果!")
                    
                    # 尝试多种方式提取结果  
                    transcript = None
                    
                    if hasattr(result, 'get_sentence'):
                        try:
                            transcript = result.get_sentence()
                            print(f"✅ 通过get_sentence()获取结果: {transcript}")
                            break
                        except Exception as e:
                            print(f"⚠️  get_sentence()调用失败: {e}")
                    
                    if not transcript and hasattr(result, 'output'):
                        print(f"📊 Output类型: {type(result.output)}")
                        print(f"📊 Output内容: {result.output}")
                        
                        if hasattr(result.output, 'sentence'):
                            transcript = result.output.sentence
                            print(f"✅ 通过output.sentence获取结果: {transcript}")
                        elif isinstance(result.output, dict):
                            transcript = result.output.get('sentence', '') or result.output.get('text', '')
                            print(f"✅ 通过字典键获取结果: {transcript}")
                    
                    if transcript:
                        print(f"\n🎉 识别成功!")
                        print(f"📝 转录结果: \"{transcript}\"")
                        return True
                else:
                    print(f"❌ 模型 {model_config['model']} 返回空结果")
                    
            except Exception as e:
                print(f"❌ 模型 {model_config['model']} 测试失败: {str(e)}")
                continue
        
        print("❌ 所有模型都无法成功识别")
        return False
            
    except Exception as e:
        print(f"❌ ASR测试失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("🚀 DashScope ASR独立测试")
    print("测试音频文件: tests/test-fixed-greeting.wav")
    print()
    
    success = test_dashscope_asr()
    
    if success:
        print("\n" + "="*50)
        print("✅ ASR测试通过! DashScope语音识别功能正常")
    else:
        print("\n" + "="*50)
        print("❌ ASR测试失败")
    
    sys.exit(0 if success else 1)