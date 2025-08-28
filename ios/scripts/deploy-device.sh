#!/bin/bash

# Deploy to connected iPhone device
# Usage: ./scripts/deploy-device.sh

echo "📱 Deploying to iPhone device (Firefox POC validation)..."

# Check for connected devices
DEVICE_COUNT=$(xcrun xctrace list devices | grep "iPhone" | grep -v "Simulator" | wc -l)

if [ $DEVICE_COUNT -eq 0 ]; then
    echo "❌ No iPhone devices connected"
    echo "📋 Please:"
    echo "1. Connect iPhone via USB"
    echo "2. Trust this Mac on iPhone"
    echo "3. Enable Developer Mode in Settings"
    exit 1
fi

echo "📋 Found $DEVICE_COUNT iPhone(s) connected"

# Deploy to first available device
DEVICE_NAME=$(xcrun xctrace list devices | grep "iPhone" | grep -v "Simulator" | head -1 | cut -d'(' -f1 | sed 's/[[:space:]]*$//')

echo "🚀 Deploying to: $DEVICE_NAME"

xcodebuild -project AICollectionAgentPOC.xcodeproj \
          -scheme AICollectionAgentPOC \
          -configuration Debug \
          -destination "platform=iOS,name=$DEVICE_NAME" \
          install

if [ $? -eq 0 ]; then
    echo "✅ Deployment successful"
    echo "📱 App installed on iPhone"
    echo "🎯 Test CallKit integration:"
    echo "1. Open app on iPhone"
    echo "2. Connect to Qwen server"
    echo "3. Start test collection call"
    echo "4. Verify native call interface appears"
else
    echo "❌ Deployment failed"
    echo "📋 Common issues:"
    echo "• Developer certificate expired (renew weekly)"
    echo "• Device not trusted"
    echo "• Bundle identifier conflicts"
    exit 1
fi