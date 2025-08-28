import Foundation

// Enhanced Call model (vs Firefox JavaScript objects)
class Call: ObservableObject {
    let uuid: UUID
    let customerPhone: String
    let startTime: Date
    @Published var isActive: Bool = false
    
    init(uuid: UUID, customerPhone: String) {
        self.uuid = uuid
        self.customerPhone = customerPhone
        self.startTime = Date()
    }
    
    func activate() {
        isActive = true
        print("Native call activated: \(customerPhone) (vs Firefox manual state)")
    }
    
    func deactivate() {
        isActive = false
        print("Native call deactivated: \(customerPhone)")
    }
}

// Same Customer Profile as Firefox POC (identical data structure)
struct CustomerProfile: Codable {
    let phone: String
    let name: String
    let outstandingAmount: Double
    let overduedays: Int
    
    // Same Chinese formatting as Firefox (consistency)
    var formattedAmount: String {
        return formatChineseAmount(outstandingAmount)
    }
}

// Same Chinese number formatting as Firefox (reuse proven logic)
func formatChineseAmount(_ amount: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    let formattedNumber = formatter.string(from: NSNumber(value: amount)) ?? "\(amount)"
    return "\(formattedNumber)元" // Same format as Firefox POC
}

// WebSocket Events (same as Firefox)
struct CallStartEvent: Codable {
    let type = "ios_call_start"
    let callId: String
    let customerProfile: CustomerProfile
    let timestamp = Date().timeIntervalSince1970
}

struct AudioChunkEvent: Codable {
    let type = "ios_pcm_chunk"
    let callId: String
    let audioData: String // Base64 PCM data
    let sequenceNumber: Int
    let sampleRate: Int = 24000
    let channels: Int = 1
    let format = "pcm_s16le"
    let timestamp = Date().timeIntervalSince1970
}

struct VADEvent: Codable {
    let type = "ios_vad_interrupt"
    let callId: String
    let action: String
    let timestamp = Date().timeIntervalSince1970
}