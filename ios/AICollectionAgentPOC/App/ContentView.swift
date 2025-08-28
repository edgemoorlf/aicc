import SwiftUI

struct ContentView: View {
    @StateObject private var callManager = CallManager()
    @StateObject private var webSocketManager = WebSocketManager()
    @State private var connectionStatus = "Disconnected"
    @State private var callStatus = "No active call"
    
    var body: some View {
        VStack(spacing: 30) {
            // Header (like Firefox POC interface)
            Text("AI Collection Agent POC")
                .font(.title)
                .fontWeight(.bold)
            
            Text("Firefox-Aligned iPhone Implementation")
                .font(.subheadline)
                .foregroundColor(.gray)
            
            // Connection Status (like Firefox debug panel)
            VStack(spacing: 10) {
                HStack {
                    Circle()
                        .fill(connectionStatus == "Connected" ? Color.green : Color.red)
                        .frame(width: 10, height: 10)
                    Text("Qwen Server: \(connectionStatus)")
                        .font(.body)
                }
                
                Text("Call Status: \(callStatus)")
                    .font(.body)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color.gray.opacity(0.1))
            .cornerRadius(10)
            
            // Test Controls (like Firefox buttons)
            VStack(spacing: 20) {
                Button("Connect to Qwen Server") {
                    connectToServer()
                }
                .buttonStyle(.borderedProminent)
                .disabled(connectionStatus == "Connecting")
                
                Button("Start Test Collection Call") {
                    startTestCall()
                }
                .buttonStyle(.bordered)
                .disabled(connectionStatus != "Connected")
                
                Button("End Current Call") {
                    endCurrentCall()
                }
                .buttonStyle(.bordered)
                .tint(.red)
            }
            
            Spacer()
            
            // Debug Info (like Firefox console)
            VStack(alignment: .leading, spacing: 5) {
                Text("Debug Info:")
                    .font(.caption)
                    .fontWeight(.semibold)
                Text("• PCM streaming vs Firefox Opus")
                    .font(.caption2)
                Text("• Native CallKit vs browser controls")
                    .font(.caption2)
                Text("• Same Qwen backend as Firefox POC")
                    .font(.caption2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(Color.blue.opacity(0.1))
            .cornerRadius(8)
        }
        .padding()
        .onAppear {
            setupManagers()
        }
    }
    
    private func setupManagers() {
        // Initialize WebSocket connection to same Qwen server as Firefox
        webSocketManager.delegate = self
        
        // Setup CallKit integration
        callManager.webSocketManager = webSocketManager
    }
    
    private func connectToServer() {
        connectionStatus = "Connecting"
        webSocketManager.connect { success in
            DispatchQueue.main.async {
                connectionStatus = success ? "Connected" : "Failed"
            }
        }
    }
    
    private func startTestCall() {
        callStatus = "Initiating call..."
        callManager.startTestCall()
    }
    
    private func endCurrentCall() {
        callManager.endCurrentCall()
        callStatus = "Call ended"
    }
}

// MARK: - WebSocket Delegate
extension ContentView: WebSocketDelegate {
    func webSocketDidConnect() {
        DispatchQueue.main.async {
            connectionStatus = "Connected"
        }
    }
    
    func webSocketDidDisconnect(error: Error?) {
        DispatchQueue.main.async {
            connectionStatus = "Disconnected"
        }
    }
    
    func webSocketDidReceiveMessage(_ message: String) {
        // Handle WebSocket messages from Qwen server (same as Firefox)
        print("Received message: \(message)")
    }
}

#Preview {
    ContentView()
}