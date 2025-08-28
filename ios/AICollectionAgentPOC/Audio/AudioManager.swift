import AVFoundation
import Accelerate

protocol AudioStreamingDelegate: AnyObject {
    func didReceivePCMData(_ data: Data)
    func didCompleteAudioSegment()
}

class AudioManager: NSObject, AudioStreamingDelegate {
    private let audioEngine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let inputNode: AVAudioInputNode
    
    // WebSocket integration
    weak var webSocketManager: WebSocketManager?
    
    // Streaming configuration (same as Firefox backend requirements)
    private let sampleRate: Double = 24000
    private let channels: UInt32 = 1
    private let bitDepth: UInt32 = 16
    
    // Audio processing
    private var audioFormat: AVAudioFormat!
    private var playbackFormat: AVAudioFormat!
    private var sequenceNumber = 0
    private var isRecording = false
    private var isPlaying = false
    
    // Voice Activity Detection
    private var vadProcessor: VADProcessor?
    
    // Audio buffer management
    private let bufferSize: AVAudioFrameCount = 1024
    
    override init() {
        self.inputNode = audioEngine.inputNode
        
        super.init()
        
        setupAudioFormats()
        setupAudioEngine()
        setupVAD()
        setupNotifications()
        
        print("AudioManager initialized with PCM streaming (superior to Firefox Opus)")
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
    
    // MARK: - Audio Engine Setup
    
    private func setupAudioFormats() {
        // Input format for recording (capture from microphone)
        audioFormat = AVAudioFormat(
            pcmFormat: .float32,
            sampleRate: sampleRate,
            channels: channels,
            interleaved: false
        )
        
        // Playback format for received PCM (same as input)
        playbackFormat = AVAudioFormat(
            pcmFormat: .float32,
            sampleRate: sampleRate,
            channels: channels,
            interleaved: false
        )
        
        print("Audio formats configured: \(sampleRate)Hz, \(channels) channel(s)")
    }
    
    private func setupAudioEngine() {
        audioEngine.attach(playerNode)
        audioEngine.connect(playerNode, to: audioEngine.mainMixerNode, format: playbackFormat)
        
        print("Audio engine configured (enhanced vs Firefox web audio)")
    }
    
    private func setupVAD() {
        vadProcessor = VADProcessor { [weak self] vadAction in
            self?.handleVADEvent(vadAction)
        }
    }
    
    private func setupNotifications() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handlePCMData(_:)),
            name: .pcmDataReceived,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioSegmentCompleted),
            name: .audioSegmentCompleted,
            object: nil
        )
    }
    
    // MARK: - Recording (Customer Audio → Backend)
    
    func startRecording() {
        guard !isRecording else { return }
        
        do {
            // Configure input tap for recording (superior to Firefox MediaRecorder)
            let inputFormat = inputNode.outputFormat(forBus: 0)
            inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, time in
                self?.processInputAudio(buffer, time: time)
            }
            
            try audioEngine.start()
            isRecording = true
            sequenceNumber = 0
            
            print("Started PCM recording for WebSocket streaming (superior to Firefox Opus)")
        } catch {
            print("Failed to start audio engine: \(error)")
        }
    }
    
    func stopRecording() {
        guard isRecording else { return }\n        \n        audioEngine.stop()\n        inputNode.removeTap(onBus: 0)\n        isRecording = false\n        \n        print(\"Stopped PCM recording\")\n    }\n    \n    private func processInputAudio(_ buffer: AVAudioPCMBuffer, time: AVAudioTime) {\n        guard isRecording else { return }\n        \n        // Convert to 16-bit PCM for backend compatibility (same as Firefox backend expects)\n        guard let pcmData = convertToPCM16(buffer) else { return }\n        \n        // Voice Activity Detection\n        vadProcessor?.processAudioBuffer(buffer)\n        \n        // Stream to backend via WebSocket (superior to Firefox Opus streaming)\n        webSocketManager?.sendPCMAudioChunk(pcmData, sequenceNumber: sequenceNumber)\n        sequenceNumber += 1\n        \n        // Performance logging\n        if sequenceNumber % 50 == 0 {\n            print(\"Streamed \\(sequenceNumber) PCM chunks (no codec overhead vs Firefox)\")\n        }\n    }\n    \n    private func convertToPCM16(_ buffer: AVAudioPCMBuffer) -> Data? {\n        guard let floatData = buffer.floatChannelData?[0] else { return nil }\n        \n        let frameCount = Int(buffer.frameLength)\n        var pcmData = Data(capacity: frameCount * 2) // 16-bit = 2 bytes per sample\n        \n        // Convert float32 to int16 (same format as Firefox backend expects)\n        for i in 0..<frameCount {\n            let sample = Int16(max(-32768, min(32767, floatData[i] * 32767.0)))\n            pcmData.append(contentsOf: withUnsafeBytes(of: sample.littleEndian) { Array($0) })\n        }\n        \n        return pcmData\n    }\n    \n    // MARK: - Playback (Backend → Customer Audio)\n    \n    @objc private func handlePCMData(_ notification: Notification) {\n        guard let pcmData = notification.object as? Data else { return }\n        didReceivePCMData(pcmData)\n    }\n    \n    @objc private func handleAudioSegmentCompleted() {\n        didCompleteAudioSegment()\n    }\n    \n    func didReceivePCMData(_ data: Data) {\n        // Convert PCM data to AVAudioPCMBuffer for playback\n        guard let buffer = convertPCMToBuffer(data) else { return }\n        \n        // Schedule immediate playback for ultra-low latency (superior to Firefox)\n        scheduleBufferPlayback(buffer)\n    }\n    \n    func didCompleteAudioSegment() {\n        // Audio segment completed - can implement segment-based processing if needed\n        print(\"Audio segment completed (same as Firefox handling)\")\n    }\n    \n    private func convertPCMToBuffer(_ pcmData: Data) -> AVAudioPCMBuffer? {\n        let frameCount = pcmData.count / 2 // 16-bit = 2 bytes per sample\n        \n        guard let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frameCount)) else {\n            return nil\n        }\n        \n        buffer.frameLength = AVAudioFrameCount(frameCount)\n        \n        guard let floatData = buffer.floatChannelData?[0] else { return nil }\n        \n        // Convert int16 PCM to float32 for AVAudioEngine playback\n        pcmData.withUnsafeBytes { bytes in\n            let int16Samples = bytes.bindMemory(to: Int16.self)\n            for i in 0..<frameCount {\n                floatData[i] = Float(int16Samples[i]) / 32767.0\n            }\n        }\n        \n        return buffer\n    }\n    \n    private func scheduleBufferPlayback(_ buffer: AVAudioPCMBuffer) {\n        if !isPlaying {\n            do {\n                try audioEngine.start()\n                playerNode.play()\n                isPlaying = true\n                print(\"Started PCM playback (no decoding overhead vs Firefox)\")\n            } catch {\n                print(\"Failed to start playback: \\(error)\")\n                return\n            }\n        }\n        \n        // Schedule buffer for immediate playback (ultra-low latency)\n        playerNode.scheduleBuffer(buffer) {\n            // Buffer completed callback - could add completion metrics here\n        }\n    }\n    \n    // MARK: - Voice Activity Detection\n    \n    private func handleVADEvent(_ action: VADAction) {\n        switch action {\n        case .customerSpeaking:\n            // Customer started speaking - interrupt AI audio (same as Firefox)\n            stopCurrentAIAudio()\n            webSocketManager?.sendVoiceActivityDetection(action: .stopCurrentAudio)\n            print(\"VAD: Customer speaking - interrupting AI (same as Firefox behavior)\")\n            \n        case .customerStopped:\n            // Customer stopped speaking - AI can respond (same as Firefox)\n            webSocketManager?.sendVoiceActivityDetection(action: .startListening)\n            print(\"VAD: Customer stopped - AI can respond (same as Firefox behavior)\")\n            \n        default:\n            break\n        }\n    }\n    \n    private func stopCurrentAIAudio() {\n        if isPlaying {\n            playerNode.stop()\n            isPlaying = false\n        }\n    }\n    \n    // MARK: - Call Controls (same interface as Firefox)\n    \n    func pauseAudio() {\n        if isPlaying {\n            playerNode.pause()\n        }\n        \n        if isRecording {\n            // Pause recording but keep engine running\n            inputNode.removeTap(onBus: 0)\n        }\n        \n        print(\"Audio paused\")\n    }\n    \n    func resumeAudio() {\n        if audioEngine.isRunning && !isPlaying {\n            playerNode.play()\n            isPlaying = true\n        }\n        \n        if !isRecording && audioEngine.isRunning {\n            // Resume recording tap\n            let inputFormat = inputNode.outputFormat(forBus: 0)\n            inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, time in\n                self?.processInputAudio(buffer, time: time)\n            }\n            isRecording = true\n        }\n        \n        print(\"Audio resumed\")\n    }\n    \n    func setMuted(_ muted: Bool) {\n        audioEngine.mainMixerNode.outputVolume = muted ? 0.0 : 1.0\n        print(\"Audio muted: \\(muted)\")\n    }\n    \n    func stopAudio() {\n        stopRecording()\n        \n        if isPlaying {\n            playerNode.stop()\n            isPlaying = false\n        }\n        \n        audioEngine.stop()\n        print(\"All audio stopped\")\n    }\n}\n\n// MARK: - Voice Activity Detection Processor\n\nclass VADProcessor {\n    private let vadCallback: (VADAction) -> Void\n    \n    // VAD parameters (tuned for collection calls)\n    private let energyThreshold: Float = 0.01\n    private let silenceTimeout: TimeInterval = 1.0\n    \n    // State tracking\n    private var isSpeechActive = false\n    private var lastSpeechTime: Date?\n    private var silenceTimer: Timer?\n    \n    init(vadCallback: @escaping (VADAction) -> Void) {\n        self.vadCallback = vadCallback\n    }\n    \n    func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {\n        guard let floatData = buffer.floatChannelData?[0] else { return }\n        \n        let frameCount = Int(buffer.frameLength)\n        let energy = calculateRMSEnergy(floatData, frameCount: frameCount)\n        \n        let speechDetected = energy > energyThreshold\n        \n        if speechDetected != isSpeechActive {\n            if speechDetected {\n                // Speech started\n                handleSpeechStart()\n            } else {\n                // Speech stopped\n                handleSpeechStop()\n            }\n        }\n        \n        if speechDetected {\n            lastSpeechTime = Date()\n        }\n    }\n    \n    private func calculateRMSEnergy(_ samples: UnsafePointer<Float>, frameCount: Int) -> Float {\n        var rms: Float = 0.0\n        vDSP_rmsqv(samples, 1, &rms, vDSP_Length(frameCount))\n        return rms\n    }\n    \n    private func handleSpeechStart() {\n        isSpeechActive = true\n        silenceTimer?.invalidate()\n        vadCallback(.customerSpeaking)\n    }\n    \n    private func handleSpeechStop() {\n        // Start silence timer before confirming speech end\n        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceTimeout, repeats: false) { [weak self] _ in\n            self?.confirmSpeechEnd()\n        }\n    }\n    \n    private func confirmSpeechEnd() {\n        isSpeechActive = false\n        vadCallback(.customerStopped)\n    }\n}"