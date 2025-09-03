#!/bin/bash

# Firefox-aligned build script for iPhone POC
# Usage: ./scripts/build-ios.sh

echo "🏗️ Building AI Collection Agent POC (Firefox-aligned architecture)..."

# Check if Xcode is installed
if ! command -v xcodebuild &> /dev/null; then
    echo "❌ Xcode not found. Please install Xcode from the Mac App Store"
    exit 1
fi

# Build project
echo "📱 Building iOS project..."
xcodebuild -project AICollectionAgentPOC.xcodeproj \
          -scheme AICollectionAgentPOC \
          -configuration Debug \
          build

if [ $? -eq 0 ]; then
    echo "✅ Build completed successfully"
    echo "📦 Ready for deployment to device or simulator"
else
    echo "❌ Build failed. Check Xcode project configuration."
    exit 1
fi

echo "🎯 Next steps:"
echo "1. Connect iPhone via USB"
echo "2. Run: ./scripts/deploy-device.sh"
echo "3. Test CallKit integration with Qwen backend"