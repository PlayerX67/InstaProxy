from flask import Flask, request, jsonify, send_from_directory
from playwright.async_api import async_playwright
import asyncio
import threading
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
import time

app = Flask(__name__)

# Thread pool for async operations
executor = ThreadPoolExecutor(max_workers=4)

def run_async(coro):
    """Run async function in sync context"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()

async def fetch_url_async(url):
    """Fetch and render URL using Playwright"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        )
        
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        )
        
        page = await context.new_page()
        
        try:
            # Navigate to URL with timeout
            await page.goto(url, wait_until='networkidle', timeout=30000)
            
            # Wait a bit more for dynamic content
            await page.wait_for_timeout(2000)
            
            # Get fully rendered HTML
            html_content = await page.content()
            
            # Get final URL after redirects
            final_url = page.url
            
            return {
                'success': True,
                'html': html_content,
                'final_url': final_url,
                'status': 'rendered'
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'status': 'error'
            }
        finally:
            await browser.close()

@app.route('/')
def serve_frontend():
    return send_from_directory('static', 'index.html')

@app.route('/fetch', methods=['POST'])
def fetch_url():
    data = request.get_json()
    url = data.get('url', '').strip()
    
    if not url:
        return jsonify({'success': False, 'error': 'URL is required'})
    
    # Validate URL format
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    
    try:
        # Run async function in thread pool
        result = run_async(fetch_url_async(url))
        return jsonify(result)
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to fetch URL: {str(e)}'
        })

@app.route('/proxy')
def proxy_url():
    """Alternative endpoint for GET requests"""
    url = request.args.get('url', '').strip()
    
    if not url:
        return "URL parameter is required", 400
    
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    
    try:
        result = run_async(fetch_url_async(url))
        if result['success']:
            return result['html']
        else:
            return f"Error fetching URL: {result['error']}", 400
    except Exception as e:
        return f"Server error: {str(e)}", 500

@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': time.time()})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
