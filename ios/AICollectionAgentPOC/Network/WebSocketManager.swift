import Foundation
import Network

protocol WebSocketDelegate: AnyObject {
    func webSocketDidConnect()
    func webSocketDidDisconnect(error: Error?)
    func webSocketDidReceiveMessage(_ message: String)
}

class WebSocketManager: NSObject, ObservableObject {
    private var webSocket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    
    // Same connection configuration as Firefox
    private let serverURL: URL
    private let reconnectDelay: TimeInterval = 2.0
    private let maxReconnectAttempts = 5
    private var reconnectAttempts = 0
    
    // Same call context as Firefox
    private var currentCallId: String?
    @Published var isConnected = false
    
    // Delegate for UI updates
    weak var delegate: WebSocketDelegate?
    
    init(serverURL: String = "ws://localhost:3003") {
        self.serverURL = URL(string: serverURL)!
        super.init()
        setupURLSession()
    }
    
    // MARK: - Same Connection Management as Firefox
    
    func connect(completion: @escaping (Bool) -> Void) {
        guard webSocket == nil else {
            completion(isConnected)
            return
        }
        
        // Same WebSocket setup as Firefox
        var request = URLRequest(url: serverURL)
        request.setValue("ios-client", forHTTPHeaderField: "User-Agent") // vs Firefox browser
        request.setValue("ai-collection-agent/1.0", forHTTPHeaderField: "Client-Version")
        
        webSocket = urlSession?.webSocketTask(with: request)
        webSocket?.resume()
        
        // Same message listening pattern as Firefox
        receiveMessage()
        
        // Same connection handshake as Firefox
        sendConnectionHandshake { [weak self] success in
            DispatchQueue.main.async {
                self?.isConnected = success
                self?.reconnectAttempts = 0
                self?.delegate?.webSocketDidConnect()
                completion(success)
            }
        }
    }
    
    func disconnect() {
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        isConnected = false
        currentCallId = nil
        delegate?.webSocketDidDisconnect(error: nil)
    }
    
    private func setupURLSession() {
        // Same timeout configuration as Firefox
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 60
        urlSession = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }
    
    // MARK: - Enhanced Message Handling (Same Events as Firefox)
    
    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                self?.handleMessage(message)
                self?.receiveMessage() // Continue listening like Firefox
                
            case .failure(let error):
                print("WebSocket receive error: \(error)")
                self?.handleConnectionError(error)
            }
        }
    }
    
    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            handleTextMessage(text)
            
        case .data(let data):
            handleBinaryMessage(data) // Enhanced: Direct PCM binary data
            
        @unknown default:
            print("Unknown WebSocket message type")
        }
    }
    
    private func handleTextMessage(_ text: String) {
        DispatchQueue.main.async { [weak self] in
            self?.delegate?.webSocketDidReceiveMessage(text)
        }
        
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }
        
        // Same event types as Firefox POC
        switch type {
        case "connection_established":
            isConnected = true
            
        case "pcm_chunk":
            handlePCMChunk(json) // Enhanced: Direct PCM vs Firefox Opus
            
        case "pcm_segment_end":
            handleSegmentEnd(json)
            
        case "asr_result":
            handleASRResult(json) // Same as Firefox
            
        case "collection_response":
            handleCollectionResponse(json) // Same as Firefox
            
        case "call_metrics":
            handleCallMetrics(json) // Same as Firefox
            
        default:
            print("Unknown message type: \(type)")
        }
    }
    
    private func handleBinaryMessage(_ data: Data) {
        // Enhanced: Direct PCM binary data (superior to Firefox Opus)
        // Audio playback will be handled by AudioManager
        NotificationCenter.default.post(name: .pcmDataReceived, object: data)
    }
    
    // MARK: - Same Collection Call Protocol as Firefox
    
    func sendCallStart(callId: String, customerProfile: CustomerProfile) {
        currentCallId = callId
        
        // Same message structure as Firefox POC
        let message: [String: Any] = [
            "type": "ios_call_start", // Enhanced: iOS vs Firefox browser
            "callId": callId,
            "customerPhone": customerProfile.phone,
            "customerProfile": [
                "name": customerProfile.name,
                "outstandingAmount": customerProfile.outstandingAmount,
                "overdueDays": customerProfile.overduedays,
                "lastContact": Date().timeIntervalSince1970 // Same format as Firefox
            ],
            "timestamp": Date().timeIntervalSince1970
        ]
        
        sendMessage(message)
    }
    
    func sendPCMAudioChunk(_ audioData: Data, sequenceNumber: Int) {
        guard let callId = currentCallId else { return }
        
        // Enhanced: PCM vs Firefox Opus (eliminates codec overhead)
        let message: [String: Any] = [
            "type": "ios_pcm_chunk", // Enhanced: Raw PCM vs Firefox OGG/Opus
            "callId": callId,
            "audioData": audioData.base64EncodedString(),
            "sequenceNumber": sequenceNumber,
            "sampleRate": 24000, // Same as Firefox backend requirement
            "channels": 1, // Same as Firefox mono
            "format": "pcm_s16le", // Enhanced: Direct PCM vs Firefox Opus compression
            "timestamp": Date().timeIntervalSince1970
        ]
        
        sendMessage(message)
    }
    
    func sendVoiceActivityDetection(action: VADAction) {
        guard let callId = currentCallId else { return }
        
        // Same VAD as Firefox POC
        let message: [String: Any] = [
            "type": "ios_vad_interrupt",
            "callId": callId,
            "action": action.rawValue,
            "timestamp": Date().timeIntervalSince1970
        ]
        
        sendMessage(message)
    }
    
    func sendCallEnd(callId: String) {
        // Same call end as Firefox
        let message: [String: Any] = [
            "type": "ios_call_end",
            "callId": callId,
            "timestamp": Date().timeIntervalSince1970
        ]
        
        sendMessage(message)
        currentCallId = nil
    }
    
    private func sendMessage(_ messageDict: [String: Any]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: messageDict),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            return
        }
        
        webSocket?.send(.string(jsonString)) { error in
            if let error = error {
                print("WebSocket send error: \(error)")
            }
        }
    }
    
    // MARK: - Message Handlers
    
    private func handlePCMChunk(_ json: [String: Any]) {
        guard let audioDataString = json["audioData"] as? String,
              let audioData = Data(base64Encoded: audioDataString) else {
            return
        }
        
        // Enhanced performance measurement (vs Firefox)
        if let timestamp = json["timestamp"] as? TimeInterval {
            let latency = Date().timeIntervalSince1970 - timestamp
            print("PCM chunk latency: \(Int(latency * 1000))ms (should beat Firefox Opus)")
        }
        
        // Enhanced: Direct PCM playback (no decoding like Firefox)
        NotificationCenter.default.post(name: .pcmDataReceived, object: audioData)
    }
    
    private func handleSegmentEnd(_ json: [String: Any]) {
        // Same completion handling as Firefox
        NotificationCenter.default.post(name: .audioSegmentCompleted, object: nil)
    }
    
    private func handleASRResult(_ json: [String: Any]) {
        guard let text = json["text"] as? String else { return }
        
        let isPartial = json["is_partial"] as? Bool ?? false
        print("ASR Result: \(text) (partial: \(isPartial))")
    }
    
    private func handleCollectionResponse(_ json: [String: Any]) {
        guard let response = json["response"] as? String else { return }
        print("Collection Response: \(response)")
    }
    
    private func handleCallMetrics(_ json: [String: Any]) {
        print("Call Metrics: \(json)")
    }
    
    // MARK: - Connection Resilience
    
    private func handleConnectionError(_ error: Error) {
        DispatchQueue.main.async { [weak self] in
            self?.isConnected = false
            self?.delegate?.webSocketDidDisconnect(error: error)
        }
        
        // Attempt reconnection if within limits
        if reconnectAttempts < maxReconnectAttempts {
            reconnectAttempts += 1
            
            DispatchQueue.main.asyncAfter(deadline: .now() + reconnectDelay) { [weak self] in
                self?.connect { success in
                    if !success {
                        print("Reconnection failed")
                    }
                }
            }
        } else {
            print("Max reconnection attempts reached")
        }
    }
    
    private func sendConnectionHandshake(completion: @escaping (Bool) -> Void) {
        let handshake: [String: Any] = [
            "type": "mobile_handshake",
            "clientType": "ios",
            "version": "1.0.0",
            "capabilities": [
                "pcm_streaming",
                "voice_activity_detection",
                "ultra_low_latency"
            ],
            "timestamp": Date().timeIntervalSince1970
        ]
        
        sendMessage(handshake)
        
        // Wait for connection confirmation
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            completion(self.isConnected)
        }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension WebSocketManager: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        print("WebSocket connected to Qwen server (same as Firefox)")
    }
    
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        print("WebSocket disconnected: \(closeCode)")
        DispatchQueue.main.async { [weak self] in
            self?.isConnected = false
            self?.delegate?.webSocketDidDisconnect(error: nil)
        }
        
        // Attempt reconnection
        if currentCallId != nil {
            handleConnectionError(NSError(domain: "WebSocket", code: Int(closeCode.rawValue), userInfo: nil))
        }
    }
}

// MARK: - VAD Actions

enum VADAction: String {
    case stopCurrentAudio = "stop_current_audio"
    case startListening = "start_listening"
    case customerSpeaking = "customer_speaking"
    case customerStopped = "customer_stopped"
}

// MARK: - Notification Names

extension Notification.Name {
    static let pcmDataReceived = Notification.Name("pcmDataReceived")
    static let audioSegmentCompleted = Notification.Name("audioSegmentCompleted")
}