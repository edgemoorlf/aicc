#!/bin/bash
# Create deployment package for CCC HTTP streaming function

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PACKAGE_NAME="ccc-http-streaming-${TIMESTAMP}.zip"

echo "🚀 Creating CCC HTTP streaming deployment package..."
echo "📦 Package: ${PACKAGE_NAME}"

# Create deployment package
cd fc_http
zip -r "../${PACKAGE_NAME}" . -x "*.pyc" "*/__pycache__/*" "test_*"

cd ..
echo "✅ Package created successfully: ${PACKAGE_NAME}"
echo ""
echo "📋 Deployment Instructions:"
echo "1. Go to Aliyun FC Console"
echo "2. Create Function → Web Function (FC 2.0)"
echo "3. Upload ${PACKAGE_NAME}"
echo "4. Set handler: index.handler"
echo "5. Configure environment: DASHSCOPE_API_KEY"
echo "6. Enable HTTP trigger with Anonymous access"
echo ""
echo "🎯 Ready for CCC streaming integration!"