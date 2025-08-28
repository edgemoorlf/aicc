import CallKit
import AVFoundation
import UIKit

class CallManager: NSObject, ObservableObject {
    private let callController = CXCallController()
    private let provider: CXProvider
    private let providerDelegate: ProviderDelegate
    
    // State management (like Firefox call state)
    @Published var activeCall: Call?
    @Published var isCallActive = false
    
    // Backend integration (same as Firefox)
    var webSocketManager: WebSocketManager?
    private let audioManager: AudioManager
    
    override init() {
        // Native iOS call configuration (vs Firefox browser constraints)
        let providerConfiguration = CXProviderConfiguration("AI Collection POC")
        providerConfiguration.supportsVideo = false
        providerConfiguration.maximumCallsPerCallGroup = 1
        providerConfiguration.supportedHandleTypes = [.phoneNumber]
        providerConfiguration.iconTemplateImageData = nil
        
        self.provider = CXProvider(configuration: providerConfiguration)
        self.audioManager = AudioManager()
        self.providerDelegate = ProviderDelegate()
        
        super.init()
        
        // Set up provider delegate
        providerDelegate.callManager = self
        provider.setDelegate(providerDelegate, queue: nil)
        
        print("CallManager initialized (Firefox-aligned but native)")
    }
    
    // MARK: - Native Call Management (vs Firefox manual controls)
    
    func startTestCall() {
        let uuid = UUID()
        let testHandle = "+8613800138000" // Same test number as Firefox POC
        
        let call = Call(uuid: uuid, customerPhone: testHandle)
        activeCall = call
        
        let startCallAction = CXStartCallAction(call: uuid, handle: CXHandle(type: .phoneNumber, value: testHandle))
        let transaction = CXTransaction(action: startCallAction)
        
        callController.request(transaction) { [weak self] error in
            if let error = error {
                print("Failed to start call: \(error)")
            } else {
                print("Native call started (superior to Firefox browser tab)")
                self?.isCallActive = true
            }
        }
    }
    
    func endCurrentCall() {
        guard let call = activeCall else { return }
        
        let endCallAction = CXEndCallAction(call: call.uuid)
        let transaction = CXTransaction(action: endCallAction)
        
        callController.request(transaction) { [weak self] error in
            if let error = error {
                print("Error ending call: \(error)")
            } else {
                self?.activeCall = nil
                self?.isCallActive = false
            }
        }
    }
    
    // MARK: - WebSocket Integration (Same as Firefox)
    
    func startCollectionCall(callId: String, customerPhone: String) {
        // Same test customer profile as Firefox POC
        let testCustomer = CustomerProfile(
            phone: customerPhone,
            name: "测试客户", // Same Chinese test data as Firefox
            outstandingAmount: 15000, // Same test amounts as Firefox
            overduedays: 30
        )
        
        // Same WebSocket message to Qwen backend as Firefox
        webSocketManager?.sendCallStart(
            callId: callId,
            customerProfile: testCustomer
        )
        
        print("Collection call initialized (same as Firefox): \(testCustomer.name)")
    }
    
    // MARK: - Audio Integration
    
    func startAudioStreaming() {
        audioManager.webSocketManager = webSocketManager
        audioManager.startRecording()
    }
    
    func stopAudioStreaming() {
        audioManager.stopAudio()
    }
}