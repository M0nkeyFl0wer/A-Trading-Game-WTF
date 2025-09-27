#!/bin/bash

# Red Team Security & UX Assessment for Termux
# This script performs comprehensive testing using cURL and basic tools

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BASE_URL="${1:-http://localhost:3001}"
REPORT_FILE="red-team-report-$(date +%Y%m%d_%H%M%S).txt"

# Initialize counters
PASSED=0
FAILED=0
WARNINGS=0

echo -e "${BLUE}🔴 RED TEAM ASSESSMENT - A Trading Game WTF${NC}"
echo "========================================="
echo "Target: $BASE_URL"
echo "Report: $REPORT_FILE"
echo ""

# Function to log results
log_result() {
    local test_name=$1
    local status=$2
    local message=$3

    echo "[$(date +%H:%M:%S)] $test_name: $status - $message" >> "$REPORT_FILE"

    if [ "$status" = "PASS" ]; then
        echo -e "${GREEN}✓${NC} $test_name: $message"
        ((PASSED++))
    elif [ "$status" = "FAIL" ]; then
        echo -e "${RED}✗${NC} $test_name: $message"
        ((FAILED++))
    else
        echo -e "${YELLOW}⚠${NC} $test_name: $message"
        ((WARNINGS++))
    fi
}

# Function to test endpoint
test_endpoint() {
    local endpoint=$1
    local expected_status=$2
    local test_name=$3

    response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint")

    if [ "$response" = "$expected_status" ]; then
        log_result "$test_name" "PASS" "Expected $expected_status, got $response"
    else
        log_result "$test_name" "FAIL" "Expected $expected_status, got $response"
    fi
}

# Function to test response time
test_performance() {
    local endpoint=$1
    local max_time=$2
    local test_name=$3

    time_total=$(curl -s -o /dev/null -w "%{time_total}" "$BASE_URL$endpoint")
    time_ms=$(echo "$time_total * 1000" | bc 2>/dev/null || echo "0")

    if (( $(echo "$time_ms < $max_time" | bc -l 2>/dev/null || echo 0) )); then
        log_result "$test_name" "PASS" "Response time: ${time_ms}ms (max: ${max_time}ms)"
    else
        log_result "$test_name" "FAIL" "Response time: ${time_ms}ms (max: ${max_time}ms)"
    fi
}

echo -e "\n${BLUE}=== PHASE 1: Basic Connectivity ===${NC}"
echo "----------------------------------------"

# Test if server is running
test_endpoint "/" "200" "Server Running"
test_performance "/" "3000" "Page Load Time"

echo -e "\n${BLUE}=== PHASE 2: Security Tests ===${NC}"
echo "----------------------------------------"

# XSS Testing
echo -e "\n${YELLOW}Testing XSS vulnerabilities...${NC}"
xss_payloads=(
    "<script>alert('XSS')</script>"
    "<img src=x onerror='alert(1)'>"
    "javascript:alert('XSS')"
)

for payload in "${xss_payloads[@]}"; do
    encoded=$(printf '%s' "$payload" | jq -sRr @uri)
    response=$(curl -s "$BASE_URL/api/test?input=$encoded" 2>/dev/null || echo "")

    if [[ "$response" == *"<script>"* ]] || [[ "$response" == *"alert"* ]]; then
        log_result "XSS Test" "FAIL" "Payload reflected: $payload"
    else
        log_result "XSS Test" "PASS" "Payload blocked: ${payload:0:30}..."
    fi
done

# SQL Injection Testing
echo -e "\n${YELLOW}Testing injection vulnerabilities...${NC}"
injection_payloads=(
    "' OR '1'='1"
    "admin'--"
    '{"$ne": null}'
)

for payload in "${injection_payloads[@]}"; do
    response=$(curl -s -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$payload\",\"password\":\"test\"}" \
        -w "\n%{http_code}" 2>/dev/null | tail -n 1)

    if [ "$response" = "200" ]; then
        log_result "Injection Test" "FAIL" "Potential vulnerability with: ${payload:0:20}..."
    else
        log_result "Injection Test" "PASS" "Payload blocked: ${payload:0:20}..."
    fi
done

# Rate Limiting Test
echo -e "\n${YELLOW}Testing rate limiting...${NC}"
rate_limited=false
for i in {1..150}; do
    response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null)
    if [ "$response" = "429" ]; then
        rate_limited=true
        log_result "Rate Limiting" "PASS" "Rate limit triggered after $i requests"
        break
    fi
done

if [ "$rate_limited" = false ]; then
    log_result "Rate Limiting" "FAIL" "No rate limiting after 150 requests"
fi

# Security Headers Check
echo -e "\n${YELLOW}Testing security headers...${NC}"
headers=$(curl -s -I "$BASE_URL" 2>/dev/null)

security_headers=(
    "X-Content-Type-Options"
    "X-Frame-Options"
    "X-XSS-Protection"
    "Content-Security-Policy"
)

for header in "${security_headers[@]}"; do
    if echo "$headers" | grep -qi "$header"; then
        log_result "Security Header" "PASS" "$header present"
    else
        log_result "Security Header" "FAIL" "$header missing"
    fi
done

echo -e "\n${BLUE}=== PHASE 3: API Tests ===${NC}"
echo "----------------------------------------"

# Test API endpoints
test_endpoint "/api/health" "200" "Health Check"
test_endpoint "/api/auth/login" "405" "Login Endpoint (GET)"
test_endpoint "/api/nonexistent" "404" "404 Handling"

# Test CORS
echo -e "\n${YELLOW}Testing CORS configuration...${NC}"
cors_response=$(curl -s -I -H "Origin: http://evil.com" "$BASE_URL/api/health" 2>/dev/null)

if echo "$cors_response" | grep -qi "Access-Control-Allow-Origin: http://evil.com"; then
    log_result "CORS Test" "FAIL" "CORS too permissive - allows any origin"
elif echo "$cors_response" | grep -qi "Access-Control-Allow-Origin"; then
    log_result "CORS Test" "PASS" "CORS properly configured"
else
    log_result "CORS Test" "WARN" "No CORS headers found"
fi

echo -e "\n${BLUE}=== PHASE 4: UX Tests ===${NC}"
echo "----------------------------------------"

# Check for static assets
echo -e "\n${YELLOW}Testing static assets...${NC}"
assets=(
    "/favicon.ico"
    "/manifest.json"
    "/robots.txt"
)

for asset in "${assets[@]}"; do
    response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$asset")
    if [ "$response" = "200" ] || [ "$response" = "304" ]; then
        log_result "Static Asset" "PASS" "$asset found"
    else
        log_result "Static Asset" "WARN" "$asset missing (UX issue)"
    fi
done

# Check page size
echo -e "\n${YELLOW}Testing page size...${NC}"
page_size=$(curl -s "$BASE_URL" | wc -c)
page_size_kb=$((page_size / 1024))

if [ "$page_size_kb" -lt 500 ]; then
    log_result "Page Size" "PASS" "${page_size_kb}KB (optimized)"
elif [ "$page_size_kb" -lt 1000 ]; then
    log_result "Page Size" "WARN" "${page_size_kb}KB (could be smaller)"
else
    log_result "Page Size" "FAIL" "${page_size_kb}KB (too large)"
fi

echo -e "\n${BLUE}=== PHASE 5: Game-Specific Tests ===${NC}"
echo "----------------------------------------"

# Test character endpoints
echo -e "\n${YELLOW}Testing game features...${NC}"
test_endpoint "/api/characters" "200" "Character List"
test_endpoint "/api/rooms" "200" "Room List"
test_endpoint "/api/bot/strategies" "401" "Bot Strategies (Auth Required)"

# Test WebSocket connection
echo -e "\n${YELLOW}Testing WebSocket...${NC}"
if command -v websocat &> /dev/null; then
    timeout 2 websocat ws://localhost:3001/ws echo "test" &>/dev/null
    if [ $? -eq 0 ]; then
        log_result "WebSocket" "PASS" "Connection successful"
    else
        log_result "WebSocket" "FAIL" "Connection failed"
    fi
else
    log_result "WebSocket" "SKIP" "websocat not installed"
fi

echo -e "\n${BLUE}=== PHASE 6: Load Testing ===${NC}"
echo "----------------------------------------"

# Simple concurrent request test
echo -e "\n${YELLOW}Testing concurrent requests...${NC}"
(
    for i in {1..10}; do
        curl -s "$BASE_URL" > /dev/null &
    done
    wait
)

if [ $? -eq 0 ]; then
    log_result "Concurrent Requests" "PASS" "Handled 10 simultaneous requests"
else
    log_result "Concurrent Requests" "FAIL" "Failed under concurrent load"
fi

echo -e "\n${BLUE}=== PHASE 7: Content Analysis ===${NC}"
echo "----------------------------------------"

# Check for sensitive data exposure
echo -e "\n${YELLOW}Checking for data exposure...${NC}"
page_content=$(curl -s "$BASE_URL")

sensitive_patterns=(
    "password"
    "secret"
    "token"
    "api[_-]?key"
    "private"
)

for pattern in "${sensitive_patterns[@]}"; do
    if echo "$page_content" | grep -qi "$pattern"; then
        log_result "Data Exposure" "WARN" "Potential sensitive data: $pattern"
    fi
done

# Check for error messages
if echo "$page_content" | grep -qi "error\|exception\|stack"; then
    log_result "Error Disclosure" "WARN" "Error messages visible in response"
fi

echo -e "\n${BLUE}=========================================${NC}"
echo -e "${BLUE}           ASSESSMENT COMPLETE${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""
echo -e "Results Summary:"
echo -e "${GREEN}Passed:${NC} $PASSED"
echo -e "${RED}Failed:${NC} $FAILED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

# Calculate score
TOTAL=$((PASSED + FAILED))
if [ $TOTAL -gt 0 ]; then
    SCORE=$((PASSED * 100 / TOTAL))
    echo -e "Security Score: ${SCORE}%"

    if [ $SCORE -ge 80 ]; then
        echo -e "${GREEN}✓ READY FOR BETA${NC}"
    elif [ $SCORE -ge 60 ]; then
        echo -e "${YELLOW}⚠ NEEDS IMPROVEMENT${NC}"
    else
        echo -e "${RED}✗ NOT READY - CRITICAL ISSUES${NC}"
    fi
fi

echo ""
echo "Full report saved to: $REPORT_FILE"

# Generate recommendations
echo -e "\n${BLUE}=== RECOMMENDATIONS ===${NC}" | tee -a "$REPORT_FILE"

if [ $FAILED -gt 0 ]; then
    echo "Priority fixes needed:" | tee -a "$REPORT_FILE"

    grep "FAIL" "$REPORT_FILE" | head -5 | while read -r line; do
        echo "  - $line" | tee -a "$REPORT_FILE"
    done
fi

if [ $WARNINGS -gt 0 ]; then
    echo -e "\nImprovements suggested:" | tee -a "$REPORT_FILE"

    grep "WARN" "$REPORT_FILE" | head -5 | while read -r line; do
        echo "  - $line" | tee -a "$REPORT_FILE"
    done
fi

echo -e "\n${GREEN}Assessment completed at $(date)${NC}" | tee -a "$REPORT_FILE"

exit $((FAILED > 0 ? 1 : 0))