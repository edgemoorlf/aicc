import os
import requests

# Set your AccessKey ID and Secret as environment variables or directly here (not recommended for security reasons)
ACCESS_KEY_ID = os.getenv('ALIBABA_CLOUD_ACCESS_KEY_ID', 'LTAI5t5kNg6eduDENdpesh8k')
ACCESS_KEY_SECRET = os.getenv('ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'i2AR5eMsL8dae0ADz7fT2ysGwOVisD')

# Define endpoints for testing
QWEN_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/qwen"
ASR_ENDPOINT = "https://nls-meta.cn-shanghai.aliyuncs.com/"
TTS_ENDPOINT = "https://nls-meta.cn-shanghai.aliyuncs.com/"

def test_api(endpoint, api_name):
    try:
        headers = {
            'Authorization': f'Bearer {ACCESS_KEY_ID}:{ACCESS_KEY_SECRET}',
            'Content-Type': 'application/json'
        }
        response = requests.get(endpoint, headers=headers)
        
        if response.status_code == 200:
            print(f"Access to {api_name} API: SUCCESS")
        else:
            print(f"Access to {api_name} API: FAILED (Status Code: {response.status_code}, Message: {response.text})")
    
    except Exception as e:
        print(f"Error testing {api_name} API: {e}")

if __name__ == "__main__":
    # Test Qwen API
    test_api(QWEN_ENDPOINT, "Qwen")
    
    # Test ASR API
    test_api(ASR_ENDPOINT, "ASR")
    
    # Test TTS API
    test_api(TTS_ENDPOINT, "TTS")