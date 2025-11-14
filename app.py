from flask import Flask, request, jsonify, send_from_directory
import requests
from bs4 import BeautifulSoup
import time

app = Flask(__name__)

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
        # Fetch the URL with proper headers
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        
        # Return the HTML content
        return jsonify({
            'success': True,
            'html': response.text,
            'final_url': response.url,
            'status': 'fetched'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to fetch URL: {str(e)}'
        })

@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': time.time()})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
