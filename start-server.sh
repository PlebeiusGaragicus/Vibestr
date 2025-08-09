#!/bin/bash

# Local Development Server
# This script starts a Python HTTP server for testing Vibestr locally

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PORT=8081
HOST="0.0.0.0"
SERVE_DIR="docs"

echo -e "${BLUE}🚀 Starting Development Server${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check that docs/ exists and has an index.html for GitHub Pages layout
if [ ! -f "$SERVE_DIR/index.html" ]; then
    echo -e "${RED}❌ Error: $SERVE_DIR/index.html not found${NC}"
    echo -e "${YELLOW}Please ensure your site files are in the '$SERVE_DIR/' directory (GitHub Pages configuration)${NC}"
    exit 1
fi

# Check Python version and start appropriate server
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
    echo -e "${GREEN}✅ Using Python 3${NC}"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
    echo -e "${GREEN}✅ Using Python 2${NC}"
else
    echo -e "${RED}❌ Error: Python not found${NC}"
    echo -e "${YELLOW}Please install Python to run the development server${NC}"
    exit 1
fi

# Display server information
echo -e "${BLUE}📍 Server Details:${NC}"
echo -e "   Host: ${GREEN}${HOST}${NC}"
echo -e "   Port: ${GREEN}${PORT}${NC}"
echo -e "   URL:  ${GREEN}http://${HOST}:${PORT}${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Function to handle cleanup on script exit
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down server...${NC}"
    echo -e "${GREEN}✅ Server stopped. Thanks for using Vibestr!${NC}"
    exit 0
}

# Set up signal handlers for graceful shutdown
trap cleanup SIGINT SIGTERM

echo -e "${GREEN}🌐 Starting HTTP server...${NC}"
echo -e "${BLUE}📝 Server logs will appear below:${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Start the server with enhanced logging
if [ "$PYTHON_CMD" = "python3" ]; then
    # Python 3 version with enhanced logging and proper cleanup
    $PYTHON_CMD -c "
import http.server
import socketserver
import socket
import os
import datetime
import signal
import sys
from urllib.parse import unquote

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f'[{timestamp}] {format % args}')
    
    def do_GET(self):
        # Log the request with more details
        client_ip = self.client_address[0]
        path = unquote(self.path)
        print(f'📥 GET {path} from {client_ip}')
        super().do_GET()
    
    def do_POST(self):
        # Log POST requests (useful for future API endpoints)
        client_ip = self.client_address[0]
        path = unquote(self.path)
        print(f'📤 POST {path} from {client_ip}')
        super().do_POST()

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True
    
    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        super().server_bind()

# Global server reference for cleanup
httpd = None

def signal_handler(signum, frame):
    print('\n🛑 Server stopped by user')
    if httpd:
        httpd.shutdown()
        httpd.server_close()
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Change to the docs directory to serve GitHub Pages structure
os.chdir('$(pwd)/docs')

# Start server with proper cleanup
try:
    httpd = ReusableTCPServer(('$HOST', $PORT), CustomHTTPRequestHandler)
    print(f'🚀 Server running at http://$HOST:$PORT/')
    print(f'📁 Serving files from: {os.getcwd()}')
    print(f'🔄 Press Ctrl+C to stop the server')
    print('━' * 50)
    httpd.serve_forever()
except OSError as e:
    if e.errno == 48:  # Address already in use
        print('❌ Port $PORT is already in use!')
        print('💡 Try killing any existing processes:')
        print('   lsof -ti:$PORT | xargs kill -9')
        print('   Or wait a few seconds and try again.')
    else:
        print(f'❌ Server error: {e}')
    sys.exit(1)
finally:
    if httpd:
        httpd.server_close()
"
else
    # Python 2 fallback
    echo -e "${YELLOW}⚠️  Using Python 2 - limited logging available${NC}"
    ( cd "$SERVE_DIR" && $PYTHON_CMD -m SimpleHTTPServer $PORT )
fi
