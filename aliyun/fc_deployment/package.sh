#!/bin/bash
"""
Package CCC AI Agent for Function Compute Deployment
Creates a deployment-ready ZIP package
"""

echo "📦 Packaging CCC AI Agent for FC deployment..."

# Clean up any existing packages
rm -f ccc-ai-agent-*.zip

# Create timestamp for package naming
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
PACKAGE_NAME="ccc-ai-agent-${TIMESTAMP}.zip"

echo "📋 Package contents:"
ls -la

echo "🔍 Validating package structure..."

# Check required files exist
REQUIRED_FILES=("index.py" "requirements.txt")
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing required file: $file"
        exit 1
    fi
    echo "✅ Found: $file"
done

# Test function locally first
echo "🧪 Testing function locally..."
python test_fc_function.py
if [ $? -ne 0 ]; then
    echo "❌ Local function test failed. Fix issues before deployment."
    exit 1
fi

# Create ZIP package
echo "📦 Creating ZIP package: $PACKAGE_NAME"
zip -r "$PACKAGE_NAME" . -x "*.pyc" "*__pycache__*" "*.git*" "test_*" "*.log" "*.zip"

# Validate ZIP contents
echo "📋 ZIP package contents:"
unzip -l "$PACKAGE_NAME"

echo "✅ Package created successfully: $PACKAGE_NAME"
echo "🚀 Ready for Function Compute deployment!"

# Upload instructions
echo ""
echo "📤 Deployment options:"
echo "1. Web Console: Upload $PACKAGE_NAME to FC console"
echo "2. Aliyun CLI: fun deploy (requires template.yaml)"  
echo "3. Direct API: Use FC deployment APIs"
echo ""
echo "💡 See DEPLOYMENT_INSTRUCTIONS.md for detailed steps"
