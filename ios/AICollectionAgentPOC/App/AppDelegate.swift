import UIKit
import CallKit
import AVFoundation

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    var callManager: CallManager?
    
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Initialize CallKit manager (replacing Firefox browser controls)
        callManager = CallManager()
        
        // Configure audio session for VoIP
        configureAudioSession()
        
        print("AI Collection Agent POC started (Firefox-aligned architecture)")
        return true
    }
    
    private func configureAudioSession() {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            // Configure for VoIP calls (superior to Firefox web audio)
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
            try audioSession.setActive(true)
            print("Audio session configured for VoIP (enhanced vs Firefox)")
        } catch {
            print("Failed to configure audio session: \(error)")
        }
    }
    
    // MARK: - Background Mode Support
    func applicationDidEnterBackground(_ application: UIApplication) {
        print("App backgrounded - VoIP calls remain active")
    }
    
    func applicationWillEnterForeground(_ application: UIApplication) {
        print("App foregrounded")
    }
}