# AI Call Center Collection Agent - Setup Guide

## Quick Start

1. **Open in browser**: Simply open `index.html` in a modern browser (Chrome/Firefox recommended)
2. **Select customer**: Choose from mock customers (张伟, 李娜, 王强, 刘敏)
3. **Choose scenario**: Select collection scenario (overdue payment, payment plan, etc.)
4. **Start session**: Click "开始对话" to connect to GPT-4o Realtime API
5. **Talk**: Hold "按住说话" button and speak in Chinese
6. **Monitor**: Watch real-time latency and accuracy metrics

## Features Implemented

### ✅ Core Functionality
- **GPT-4o Realtime API Integration**: Direct WebSocket connection
- **Chinese Speech Recognition**: Real-time Mandarin processing
- **Audio Recording**: Browser-based microphone capture with visualization
- **Real-time Conversation**: Bidirectional audio streaming
- **Collection Scenarios**: Specialized prompts for debt collection in Chinese

### ✅ Demo Features  
- **Customer Selection**: 4 mock customers with different risk profiles
- **Scenario Selection**: Multiple collection scenarios
- **Conversation Display**: Real-time transcript with timestamps
- **Customer Info Panel**: Account details and payment history

### ✅ Metrics Dashboard
- **Latency Tracking**: <500ms target with component breakdown
- **Accuracy Metrics**: Speech recognition, response quality, cultural appropriateness
- **Session Statistics**: Turn count, duration, success rate
- **Real-time Charts**: Live latency visualization

### ✅ Professional UI
- **Chinese Language Interface**: Full localization
- **Responsive Design**: Works on desktop and mobile
- **Audio Visualization**: Real-time microphone level display
- **Connection Status**: Live connection indicator
- **Debug Console**: Technical logging and troubleshooting

## Technical Architecture

```
Browser UI → WebSocket → GPT-4o Realtime API
     ↕                        ↕
Audio Recording           Real-time Processing
& Visualization          (Chinese ASR + LLM + TTS)
     ↕                        ↕
Metrics Collection       Audio Stream Response
```

## File Structure
```
/aicc/
├── index.html              # Main demo interface
├── realtime-client.js      # GPT-4o integration & audio processing
├── style.css              # Professional UI styling  
├── customers.json          # Mock customer database
├── README.md              # This file
└── .env                   # API configuration
```

## API Requirements

The application requires:
- **OpenAI API Key** with GPT-4o Realtime API access
- **Browser permissions** for microphone access
- **Modern browser** with WebSocket and Web Audio API support

## Next Steps for Testing

1. **Verify API Access**: Test OpenAI GPT-4o Realtime API endpoint
2. **Test Audio Pipeline**: Record → Convert to PCM16 → Stream → Receive → Play
3. **Validate Chinese Processing**: Test Mandarin speech recognition accuracy
4. **Measure Performance**: Confirm <500ms latency targets
5. **Demo Preparation**: Create backup scenarios for presentations

---

**Status**: Core implementation complete ✅  
**Ready for**: End-to-end testing and optimization
