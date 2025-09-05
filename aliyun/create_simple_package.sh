#!/bin/bash
# Simple FC Deployment - Direct File Upload
# Uses ccc_consolidated_server.py directly as the FC function

echo "🚀 Simple FC Deployment for CCC AI Agent"
echo "=========================================="

# Create minimal deployment package
echo "📦 Creating minimal deployment package..."

# Clean up any existing packages
rm -f ccc-direct-*.zip

# Create timestamp for package naming
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
PACKAGE_NAME="ccc-direct-${TIMESTAMP}.zip"

echo "📋 Creating simple ZIP package: $PACKAGE_NAME"

# Create ZIP with just the essentials
zip "$PACKAGE_NAME" ccc_consolidated_server.py requirements.txt .env.example

echo "✅ Package created: $PACKAGE_NAME"
echo ""

echo "📤 Ready for Function Compute deployment:"
echo "1. Upload to FC console: $PACKAGE_NAME"
echo "2. Set Handler: ccc_consolidated_server.handler"  
echo "3. Configure environment variables from .env.example"
echo "4. Test with sample CCC event"
echo ""

echo "🎯 Function Configuration:"
echo "- Function Name: ccc-ai-collection-agent"
echo "- Runtime: Python 3.10"
echo "- Handler: ccc_consolidated_server.handler"
echo "- Memory: 2048 MB"
echo "- Timeout: 120 seconds"
echo "- CPU: 1 vCPU"
echo ""

echo "✨ This is much simpler than the fc_deployment/ package!"
echo "✨ The ccc_consolidated_server.py already IS the FC function!"