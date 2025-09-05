#!/usr/bin/env python3
"""
Function Compute Deployment Package Creator
Creates a deployment-ready package for ccc_consolidated_server.py

This script:
1. Creates a deployment directory with all dependencies
2. Packages the consolidated server for FC deployment
3. Generates requirements.txt for FC runtime
4. Creates deployment instructions and verification scripts

Usage:
    python fc_deployment_package.py
"""

import os
import shutil
import zipfile
import json
from pathlib import Path

def create_fc_deployment_package():
    """Create Function Compute deployment package"""
    
    print("🚀 Creating Function Compute deployment package...")
    
    # Create deployment directory
    deploy_dir = Path("fc_deployment")
    if deploy_dir.exists():
        shutil.rmtree(deploy_dir)
    deploy_dir.mkdir()
    
    print(f"✅ Created deployment directory: {deploy_dir}")
    
    # Copy main server file
    shutil.copy("ccc_consolidated_server.py", deploy_dir / "index.py")  # FC expects index.py
    print("✅ Copied consolidated server as index.py")
    
    # Copy .env.example as template
    if Path(".env.example").exists():
        shutil.copy(".env.example", deploy_dir / ".env.example")
        print("✅ Copied .env.example template")
    
    # Create FC-specific requirements.txt
    fc_requirements = """# Function Compute Requirements for CCC AI Collection Agent
# Core AI processing
dashscope>=1.14.0

# Aliyun CCC integration  
alibabacloud_ccc20200701>=3.0.0

# Audio processing
pydub>=0.25.1

# Environment and utilities
python-dotenv>=0.19.0
requests>=2.28.0

# Aliyun SDK core (for CCC)
alibabacloud_tea_openapi>=0.3.0
alibabacloud_tea_util>=0.3.0

# Audio conversion (built-in audioop used, but may need fallbacks)
# numpy  # Uncomment if audioop is not available in FC runtime
"""
    
    with open(deploy_dir / "requirements.txt", "w") as f:
        f.write(fc_requirements)
    print("✅ Created FC-specific requirements.txt")
    
    # Create FC function template
    template_py = '''#!/usr/bin/env python3
"""
Function Compute Handler for Aliyun CCC AI Collection Agent
Entry point wrapper for ccc_consolidated_server.py

This file serves as the FC entry point and imports the main server logic.
"""

import os
import sys
import json
import logging

# Import the consolidated server
from index import handler as ccc_handler, initialize_persistent_connections

# Configure FC logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    """
    Function Compute main entry point
    
    Args:
        event: CCC event data
        context: FC context object
    
    Returns:
        dict: Response data for CCC
    """
    try:
        # Log FC invocation
        logger.info(f"FC Handler called with event: {json.dumps(event, ensure_ascii=False)[:200]}...")
        logger.info(f"FC Context: request_id={context.request_id}, memory={context.memory_size}MB")
        
        # Call consolidated server handler
        result = ccc_handler(event, context)
        
        logger.info(f"Handler completed successfully: {result.get('status', 'unknown')}")
        return result
        
    except Exception as e:
        logger.error(f"FC Handler failed: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return {
            'status': 'error',
            'message': f'Function Compute handler failed: {str(e)}',
            'request_id': context.request_id if context else 'unknown'
        }

# Pre-initialize connections for better performance
def initialize():
    """Initialize persistent connections for FC warm instances"""
    try:
        initialize_persistent_connections()
        logger.info("✅ Persistent connections initialized for FC")
    except Exception as e:
        logger.warning(f"Failed to pre-initialize connections: {e}")

# Auto-initialize on module load (FC warm containers)
initialize()
'''
    
    # Write template (commented out since index.py already has handler)
    # with open(deploy_dir / "fc_handler.py", "w") as f:
    #     f.write(template_py)
    
    # Create FC configuration file
    fc_config = {
        "ROSTemplateFormatVersion": "2015-09-01",
        "Transform": "Aliyun::Serverless-2018-04-03",
        "Resources": {
            "ccc-ai-agent": {
                "Type": "Aliyun::Serverless::Service",
                "Properties": {
                    "Description": "AI Collection Agent for Aliyun CCC Integration"
                },
                "ccc-handler": {
                    "Type": "Aliyun::Serverless::Function", 
                    "Properties": {
                        "Description": "CCC inbound call handler with AI processing",
                        "CodeUri": "./",
                        "Handler": "index.handler",
                        "Runtime": "python3.9",
                        "Timeout": 60,
                        "MemorySize": 512,
                        "EnvironmentVariables": {
                            "DASHSCOPE_API_KEY": "{{DASHSCOPE_API_KEY}}",
                            "ALIYUN_ACCESS_KEY_ID": "{{ALIYUN_ACCESS_KEY_ID}}",
                            "ALIYUN_ACCESS_KEY_SECRET": "{{ALIYUN_ACCESS_KEY_SECRET}}",
                            "ALIYUN_CCC_INSTANCE_ID": "{{ALIYUN_CCC_INSTANCE_ID}}",
                            "ALIYUN_REGION": "cn-shanghai"
                        }
                    },
                    "Events": {
                        "http-trigger": {
                            "Type": "HTTP",
                            "Properties": {
                                "AuthType": "ANONYMOUS",
                                "Methods": ["GET", "POST"]
                            }
                        }
                    }
                }
            }
        }
    }
    
    with open(deploy_dir / "template.yaml", "w") as f:
        json.dump(fc_config, f, indent=2, ensure_ascii=False)
    print("✅ Created FC template.yaml configuration")
    
    # Create deployment instructions
    instructions = """# Function Compute Deployment Instructions

## 🚀 Pre-deployment Checklist

### 1. Environment Setup
- [ ] Aliyun account with FC and CCC services enabled
- [ ] Access key pair with appropriate permissions
- [ ] DashScope API key with ASR/LLM/TTS access
- [ ] CCC instance ID from Cloud Call Center console

### 2. Dependencies Validation
```bash
# Test local dependencies first
pip install -r requirements.txt
python index.py  # Should initialize without errors
```

## 📦 Deployment Methods

### Method A: Aliyun CLI (Recommended)
```bash
# Install Aliyun CLI
pip install aliyun-cli

# Configure credentials
aliyun configure

# Deploy function
fun deploy

# Test function
fun invoke ccc-ai-agent/ccc-handler
```

### Method B: Web Console Upload
1. Navigate to Function Compute console
2. Create new service: "ccc-ai-agent"  
3. Create new function: "ccc-handler"
4. Upload deployment package (ZIP all files)
5. Configure environment variables:
   - DASHSCOPE_API_KEY: your-dashscope-key
   - ALIYUN_ACCESS_KEY_ID: your-access-key-id
   - ALIYUN_ACCESS_KEY_SECRET: your-access-key-secret
   - ALIYUN_CCC_INSTANCE_ID: ccc-instance-id
6. Set runtime: Python 3.9
7. Set memory: 512MB, timeout: 60s
8. Create HTTP trigger for testing

### Method C: ZIP Package Upload
```bash
# Create deployment ZIP
zip -r ccc-ai-agent-deployment.zip * -x "*.pyc" "*__pycache__*" "*.git*"

# Upload via FC console
```

## 🧪 Testing & Validation

### 1. Function Test
```python
# Test event for FC function
test_event = {
    "event_type": "inbound_call",
    "call_data": {
        "call_id": "test_call_001", 
        "customer_phone": "+86138xxxxxxxx"
    }
}
```

### 2. Performance Validation
- Cold start time: <5 seconds (first invocation)
- Warm invocation: <2 seconds  
- Memory usage: <400MB
- Audio processing latency: <3 seconds end-to-end

### 3. Integration Test
```bash
# Test with curl after deployment
curl -X POST https://your-fc-endpoint/invoke \\
  -H "Content-Type: application/json" \\
  -d '{"event_type": "inbound_call", "call_data": {"call_id": "test"}}'
```

## 🔧 Troubleshooting

### Common Issues
1. **Import errors**: Check requirements.txt matches runtime environment
2. **Environment variables**: Verify all API keys are set correctly
3. **Memory errors**: Increase FC memory allocation to 1GB if needed
4. **Timeout errors**: Increase timeout to 180s for complex audio processing
5. **Cold start latency**: Enable provisioned concurrency for production

### Debug Commands
```bash
# Check function logs
fun logs -s ccc-ai-agent -f ccc-handler --tail

# Test locally
python -c "from index import handler; print(handler({'test': True}, None))"
```

## 📊 Performance Monitoring

### Key Metrics to Watch
- **Invocation success rate**: >95%
- **Average latency**: <3 seconds
- **Memory utilization**: <80%
- **Error rate**: <1%
- **Cold start frequency**: Monitor and optimize

### Optimization Tips
1. Use provisioned concurrency for consistent performance
2. Optimize import statements in index.py
3. Cache DashScope connections across invocations  
4. Monitor audio processing pipeline latency
5. Implement connection pooling for high-volume scenarios

## 🎯 Next Steps After Deployment

1. **CCC Integration**: Configure CCC to trigger FC function
2. **Phone Testing**: Test with real phone numbers
3. **Audio Quality**: Validate G.711 ↔ PCM conversion
4. **Performance Tuning**: Optimize based on real usage patterns
5. **Production Setup**: Enable monitoring, logging, and scaling
"""

    with open(deploy_dir / "DEPLOYMENT_INSTRUCTIONS.md", "w") as f:
        f.write(instructions)
    print("✅ Created deployment instructions")
    
    # Create test script
    test_script = '''#!/usr/bin/env python3
"""
FC Function Test Script
Tests the deployed function locally before FC deployment
"""

import json
import sys
import os
sys.path.insert(0, '.')

def test_fc_function():
    """Test FC function locally"""
    
    print("🧪 Testing FC function locally...")
    
    try:
        # Import the handler
        from index import handler
        
        # Test events
        test_events = [
            {
                "event_type": "inbound_call",
                "call_data": {
                    "call_id": "test_call_001",
                    "customer_phone": "+86138xxxxxxxx"
                }
            },
            {
                "event_type": "call_end", 
                "call_data": {
                    "call_id": "test_call_001"
                }
            }
        ]
        
        # Mock context
        class MockContext:
            def __init__(self):
                self.request_id = "test-request-123"
                self.memory_size = 512
        
        context = MockContext()
        
        # Test each event
        for i, event in enumerate(test_events, 1):
            print(f"\\n📋 Test {i}: {event['event_type']}")
            result = handler(event, context)
            
            if result.get('status') == 'success':
                print(f"✅ Test {i} PASSED: {result.get('message', 'Success')}")
            else:
                print(f"❌ Test {i} FAILED: {result.get('message', 'Unknown error')}")
                
        print("\\n🎉 Local function testing completed!")
        
    except Exception as e:
        print(f"❌ Function test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == "__main__":
    success = test_fc_function()
    sys.exit(0 if success else 1)
'''
    
    with open(deploy_dir / "test_fc_function.py", "w") as f:
        f.write(test_script)
    print("✅ Created function test script")
    
    # Create packaging script
    package_script = '''#!/bin/bash
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
'''
    
    with open(deploy_dir / "package.sh", "w") as f:
        f.write(package_script)
    os.chmod(deploy_dir / "package.sh", 0o755)
    print("✅ Created packaging script")
    
    # Summary report
    print("\n🎉 FC deployment package created successfully!")
    print(f"📁 Deployment directory: {deploy_dir}")
    print(f"📋 Package contents:")
    for item in sorted(deploy_dir.iterdir()):
        print(f"   - {item.name}")
    
    print("\n🚀 Next steps:")
    print("1. cd fc_deployment")
    print("2. Review DEPLOYMENT_INSTRUCTIONS.md") 
    print("3. Test: python test_fc_function.py")
    print("4. Package: ./package.sh")
    print("5. Deploy to Function Compute console")
    
    return deploy_dir

if __name__ == "__main__":
    create_fc_deployment_package()