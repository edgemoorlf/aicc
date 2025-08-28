import CallKit
import AVFoundation

class ProviderDelegate: NSObject, CXProviderDelegate {
    weak var callManager: CallManager?
    
    // MARK: - Native CallKit Events (vs Firefox manual controls)
    
    func providerDidReset(_ provider: CXProvider) {
        print("CallKit provider reset (native system event)")
        // Clean up like Firefox page reload
        callManager?.audioManager.stopAudio()
        callManager?.webSocketManager?.disconnect()
    }
    
    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        print("Starting native call: \(action.handle.value) (vs Firefox button click)")
        
        // Native audio session (vs Firefox MediaRecorder setup)
        configureNativeAudioSession()
        
        // Same backend connection as Firefox
        callManager?.webSocketManager?.connect { [weak self] success in
            if success {
                // Same collection call setup as Firefox
                self?.startCollectionCall(
                    callId: action.callUUID.uuidString,
                    customerPhone: action.handle.value
                )
                action.fulfill()
            } else {
                print("Failed to connect to Qwen backend (same as Firefox failure)")
                action.fail()
            }
        }
    }
    
    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        print("Answering native call (vs Firefox manual control)")
        
        configureNativeAudioSession()
        
        // Start superior PCM streaming (vs Firefox Opus)
        callManager?.startAudioStreaming()
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        print("Ending native call (vs Firefox manual button)")
        
        // Same cleanup as Firefox
        callManager?.stopAudioStreaming()
        callManager?.webSocketManager?.sendCallEnd(callId: action.callUUID.uuidString)
        
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        callManager?.audioManager.setMuted(action.isMuted)
        action.fulfill()
    }
    
    // MARK: - Native Audio Configuration (Superior to Firefox Web Audio)
    
    private func configureNativeAudioSession() {
        let audioSession = AVAudioSession.sharedInstance()
        
        do {
            // Native iOS audio configuration (vs Firefox web audio constraints)
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
            try audioSession.setPreferredSampleRate(24000) // Match Firefox/Qwen backend
            try audioSession.setPreferredIOBufferDuration(0.02) // 20ms - lower latency than web
            try audioSession.setActive(true)
            print("Native VoIP audio configured (superior to Firefox web audio)")
        } catch {
            print("Native audio configuration failed: \(error)")
        }
    }
    
    // MARK: - Same Collection Call Setup as Firefox
    
    private func startCollectionCall(callId: String, customerPhone: String) {
        callManager?.startCollectionCall(callId: callId, customerPhone: customerPhone)
    }
}